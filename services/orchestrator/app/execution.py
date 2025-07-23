import asyncio
import json
import logging
from typing import Dict, Any
import enum

import redis.asyncio as redis

logger = logging.getLogger(__name__)

class OrchestratorEvent(str, enum.Enum):
    NODE_RUNNING = "NODE_RUNNING"
    NODE_COMPLETED = "NODE_COMPLETED"
    NODE_FAILED = "NODE_FAILED"

UI_NOTIFICATION_CHANNEL = "orchestrator_ui_events"

class AgentRunner:
    def __init__(self, redis_url: str = "redis://localhost"):
        self.redis_url = redis_url
        self.redis_client = None
        self.pubsub = None

    async def connect(self):
        """Establishes connection to Redis."""
        self.redis_client = redis.from_url(self.redis_url, decode_responses=True)
        self.pubsub = self.redis_client.pubsub()
        logger.info(f"Connected to Redis at {self.redis_url}")

    async def disconnect(self):
        """Closes Redis connection."""
        if self.pubsub:
            await self.pubsub.close()
        if self.redis_client:
            await self.redis_client.close()
        logger.info("Disconnected from Redis.")

    async def dispatch_task(self, agent_id: str, task_data: Dict[str, Any], response_channel: str):
        """
        Dispatches a task to a specific agent via Redis Pub/Sub.
        The agent is expected to listen on a channel derived from its ID.
        """
        if not self.redis_client:
            await self.connect()

        task_message = {
            "agent_id": agent_id,
            "task_data": task_data,
            "response_channel": response_channel
        }
        channel = f"agent_tasks:{agent_id}"
        await self.redis_client.publish(channel, json.dumps(task_message))
        logger.info(f"Dispatched task to {channel}: {task_message}")

    async def publish_event(self, event_type: OrchestratorEvent, payload: Dict[str, Any]):
        """Publishes an event to the UI notification channel."""
        if not self.redis_client:
            await self.connect()
        message = {
            "event_type": event_type.value,
            "payload": payload
        }
        await self.redis_client.publish(UI_NOTIFICATION_CHANNEL, json.dumps(message))
        logger.info(f"Published UI event: {message}")

    async def process_flow_plan(self, flow_plan: Dict[str, Any]):
        """
        Processes a flow execution plan, dispatching tasks to agents and publishing UI events.
        This is a simplified POC; in a real scenario, this would involve
        topological sorting and managing dependencies.
        """
        if not self.redis_client:
            await self.connect()

        nodes = flow_plan.get("graph", {}).get("nodes", [])
        
        for node in nodes:
            node_id = node.get("id")
            node_type = node.get("type")

            if node_type == "flexinfer.echo":
                input_data = node.get("outputs", {})
                response_channel = f"orchestrator_responses:{node_id}"
                
                await self.publish_event(OrchestratorEvent.NODE_RUNNING, {"node_id": node_id})
                logger.info(f"Preparing to dispatch task for node {node_id} of type {node_type}")
                
                try:
                    await self.dispatch_task(
                        agent_id="flexinfer.echo",
                        task_data={"node_id": node_id, "input": input_data},
                        response_channel=response_channel
                    )
                    
                    await self.pubsub.subscribe(response_channel)
                    logger.info(f"Subscribed to response channel: {response_channel}")

                    response_received = False
                    async for message in self.pubsub.listen():
                        if message['type'] == 'message':
                            data = json.loads(message['data'])
                            logger.info(f"Received response on {message['channel']}: {data}")
                            await self.publish_event(OrchestratorEvent.NODE_COMPLETED, {"node_id": node_id, "result": data})
                            response_received = True
                            break
                    
                    if not response_received:
                        await self.publish_event(OrchestratorEvent.NODE_FAILED, {"node_id": node_id, "error": "No response received from agent."})

                except Exception as e:
                    logger.error(f"Error processing node {node_id}: {e}")
                    await self.publish_event(OrchestratorEvent.NODE_FAILED, {"node_id": node_id, "error": str(e)})
                finally:
                    await self.pubsub.unsubscribe(response_channel)
                    logger.info(f"Unsubscribed from response channel: {response_channel}")
            else:
                logger.info(f"Skipping non-agent node: {node_id} of type {node_type}")

        logger.info("Finished processing flow plan.")

if __name__ == "__main__":
    # Example usage for testing
    async def test_runner():
        runner = AgentRunner()
        await runner.connect()

        # A dummy flow plan for testing
        dummy_flow_plan = {
            "apiVersion": "v1alpha1",
            "kind": "Flow",
            "meta": {
                "id": "test.echo-flow",
                "name": "Test Echo Flow",
                "version": "0.1.0",
                "createdAt": "2025-07-23T00:00:00Z"
            },
            "graph": {
                "nodes": [
                    {"id": "prompt1", "type": "ui.prompt", "position": {"x": 0, "y": 0}, "outputs": {"text": "Hello from Orchestrator!"}},
                    {"id": "echo_agent_node", "type": "flexinfer.echo", "position": {"x": 0, "y": 0}, "outputs": {"text": "Initial text for echo agent"}},
                    {"id": "console1", "type": "ui.console", "position": {"x": 0, "y": 0}}
                ],
                "edges": []
            }
        }

        await runner.process_flow_plan(dummy_flow_plan)
        await runner.disconnect()

    asyncio.run(test_runner())