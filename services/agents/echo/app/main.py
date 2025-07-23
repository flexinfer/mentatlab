import asyncio
import json
import logging
import os
from typing import Dict, Any

import redis.asyncio as redis

logger = logging.getLogger(__name__)

class EchoAgent:
    def __init__(self, agent_id: str, redis_url: str = "redis://localhost"):
        self.agent_id = agent_id
        self.redis_url = redis_url
        self.redis_client = None
        self.pubsub = None
        self.task_channel = f"agent_tasks:{self.agent_id}"

    async def connect(self):
        """Establishes connection to Redis."""
        self.redis_client = redis.from_url(self.redis_url, decode_responses=True)
        self.pubsub = self.redis_client.pubsub()
        await self.pubsub.subscribe(self.task_channel)
        logger.info(f"EchoAgent {self.agent_id} connected to Redis at {self.redis_url} and subscribed to {self.task_channel}")

    async def disconnect(self):
        """Closes Redis connection."""
        if self.pubsub:
            await self.pubsub.unsubscribe(self.task_channel)
            await self.pubsub.close()
        if self.redis_client:
            await self.redis_client.close()
        logger.info(f"EchoAgent {self.agent_id} disconnected from Redis.")

    async def process_task(self, task_message: Dict[str, Any]):
        """
        Processes an incoming task message by echoing the data and publishing the result.
        """
        task_data = task_message.get("task_data", {})
        response_channel = task_message.get("response_channel")
        
        logger.info(f"EchoAgent {self.agent_id} received task: {task_data}")

        # Simulate processing by echoing the input data
        result_data = {
            "original_input": task_data.get("input"),
            "echoed_output": task_data.get("input", {}).get("text", "No text provided")
        }

        if response_channel:
            response_message = {
                "agent_id": self.agent_id,
                "result": result_data,
                "node_id": task_data.get("node_id")
            }
            await self.redis_client.publish(response_channel, json.dumps(response_message))
            logger.info(f"EchoAgent {self.agent_id} published result to {response_channel}: {response_message}")
        else:
            logger.warning(f"EchoAgent {self.agent_id}: No response channel specified for task.")

    async def run(self):
        """
        Starts the EchoAgent, listening for tasks on its dedicated channel.
        """
        await self.connect()
        try:
            async for message in self.pubsub.listen():
                if message['type'] == 'message':
                    try:
                        task_message = json.loads(message['data'])
                        await self.process_task(task_message)
                    except json.JSONDecodeError:
                        logger.error(f"EchoAgent {self.agent_id}: Failed to decode JSON message: {message['data']}")
                    except Exception as e:
                        logger.error(f"EchoAgent {self.agent_id}: Error processing message: {e}", exc_info=True)
        except asyncio.CancelledError:
            logger.info(f"EchoAgent {self.agent_id} run cancelled.")
        finally:
            await self.disconnect()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agent_id = os.getenv("AGENT_ID", "flexinfer.echo") # Default agent_id for local testing
    redis_url = os.getenv("REDIS_URL", "redis://localhost")

    echo_agent = EchoAgent(agent_id=agent_id, redis_url=redis_url)
    asyncio.run(echo_agent.run())