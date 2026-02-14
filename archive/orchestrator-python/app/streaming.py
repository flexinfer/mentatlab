"""
Orchestrator streaming framework for MentatLab Phase 2 Beta milestone.

Manages streaming agent execution, WebSocket connections to agents,
message queuing, buffering, and integration with K8s scheduling.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any, Union, Tuple
from enum import Enum
from dataclasses import dataclass

import redis.asyncio as redis
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from services.orchestrator.app.scheduling import SchedulingService
from services.orchestrator.app.data_flow import DataFlowService, get_data_flow_service
from services.orchestrator.app.storage import StorageReference

logger = logging.getLogger(__name__)

# Configuration
REDIS_URL = "redis://localhost"
STREAMING_JOBS_KEY = "mentatlab:streaming_jobs"
AGENT_CONNECTIONS_KEY = "mentatlab:agent_connections"
STREAMING_HEARTBEAT_INTERVAL = 30  # seconds
MAX_RECONNECT_ATTEMPTS = 5
RECONNECT_DELAY_BASE = 2  # seconds


class StreamingJobStatus(str, Enum):
    """Status of streaming jobs."""
    PENDING = "pending"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"
    FAILED = "failed"


class AgentConnectionStatus(str, Enum):
    """Status of agent WebSocket connections."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


@dataclass
class StreamingJob:
    """Metadata for a streaming job."""
    job_id: str
    agent_id: str
    manifest: Dict[str, Any]
    stream_id: str
    status: StreamingJobStatus
    created_at: str
    updated_at: str
    k8s_resource_id: Optional[str] = None
    connection_status: AgentConnectionStatus = AgentConnectionStatus.DISCONNECTED
    reconnect_attempts: int = 0
    last_heartbeat: Optional[str] = None
    metadata: Dict[str, Any] = None


class StreamingOrchestrator:
    """Orchestrator for managing streaming agent execution."""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.scheduling_service = SchedulingService()
        self.data_flow_service = get_data_flow_service()
        self.active_jobs: Dict[str, StreamingJob] = {}
        self.agent_connections: Dict[str, Any] = {}  # agent_id -> connection info
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._health_check_task: Optional[asyncio.Task] = None
        
    async def initialize(self):
        """Initialize the streaming orchestrator."""
        try:
            self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            await self.redis_client.ping()
            logger.info("StreamingOrchestrator initialized with Redis")
            
            # Load existing streaming jobs from Redis
            await self._load_existing_jobs()
            
            # Start background tasks
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            self._health_check_task = asyncio.create_task(self._health_check_loop())
            
        except Exception as e:
            logger.error(f"Failed to initialize streaming orchestrator: {e}")
            raise
    
    async def shutdown(self):
        """Shutdown the streaming orchestrator."""
        # Cancel background tasks
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._health_check_task:
            self._health_check_task.cancel()
            
        # Stop all active streaming jobs
        for job in self.active_jobs.values():
            await self.stop_streaming_job(job.job_id)
        
        # Close Redis connection
        if self.redis_client:
            await self.redis_client.close()
            
        logger.info("StreamingOrchestrator shutdown complete")
    
    async def create_streaming_job(self, agent_manifest: Dict[str, Any], 
                                 stream_id: str, inputs: Dict[str, Any] = None) -> StreamingJob:
        """Create a new streaming job for an agent."""
        agent_id = agent_manifest.get("id", "unknown-agent")
        job_id = f"streaming_{agent_id}_{uuid.uuid4().hex[:8]}"
        
        # Process inputs through data flow service
        processed_inputs = inputs or {}
        created_references = []
        
        if inputs:
            processed_inputs, created_references = self.data_flow_service.process_agent_inputs(
                agent_manifest, inputs
            )
        
        # Create streaming job metadata
        job = StreamingJob(
            job_id=job_id,
            agent_id=agent_id,
            manifest=agent_manifest,
            stream_id=stream_id,
            status=StreamingJobStatus.PENDING,
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
            metadata={
                "inputs": processed_inputs,
                "created_references": [ref.to_dict() for ref in created_references],
                "long_running": agent_manifest.get("longRunning", True)  # Streaming agents are typically long-running
            }
        )
        
        self.active_jobs[job_id] = job
        
        # Store in Redis for persistence
        await self._store_job(job)
        
        logger.info(f"Created streaming job: {job_id} for agent {agent_id}")
        return job
    
    async def start_streaming_job(self, job_id: str) -> bool:
        """Start a streaming job by scheduling it on Kubernetes."""
        if job_id not in self.active_jobs:
            logger.error(f"Streaming job not found: {job_id}")
            return False
        
        job = self.active_jobs[job_id]
        
        try:
            job.status = StreamingJobStatus.STARTING
            job.updated_at = datetime.now(timezone.utc).isoformat()
            await self._store_job(job)
            
            # Create enhanced manifest for streaming
            streaming_manifest = self._create_streaming_manifest(job)
            
            # Schedule with orchestrator
            resource_id = self.scheduling_service.scheduleAgent(
                streaming_manifest,
                job.metadata["inputs"],
                execution_id=job_id,
                skip_validation=False
            )
            
            job.k8s_resource_id = resource_id
            job.status = StreamingJobStatus.RUNNING
            job.updated_at = datetime.now(timezone.utc).isoformat()
            await self._store_job(job)
            
            logger.info(f"Started streaming job: {job_id} with resource: {resource_id}")
            return True
            
        except Exception as e:
            job.status = StreamingJobStatus.FAILED
            job.updated_at = datetime.now(timezone.utc).isoformat()
            await self._store_job(job)
            logger.error(f"Failed to start streaming job {job_id}: {e}")
            return False
    
    async def stop_streaming_job(self, job_id: str) -> bool:
        """Stop a streaming job."""
        if job_id not in self.active_jobs:
            logger.error(f"Streaming job not found: {job_id}")
            return False
        
        job = self.active_jobs[job_id]
        
        try:
            job.status = StreamingJobStatus.STOPPING
            job.updated_at = datetime.now(timezone.utc).isoformat()
            await self._store_job(job)
            
            # Clean up Kubernetes resources
            if job.k8s_resource_id:
                success = self.scheduling_service.cleanupJob(job.k8s_resource_id)
                if not success:
                    logger.warning(f"Failed to cleanup K8s resource: {job.k8s_resource_id}")
            
            # Clean up storage references
            if job.metadata and "created_references" in job.metadata:
                references = [
                    StorageReference.from_dict(ref_dict) 
                    for ref_dict in job.metadata["created_references"]
                ]
                self.data_flow_service.cleanup_references(references)
            
            job.status = StreamingJobStatus.STOPPED
            job.updated_at = datetime.now(timezone.utc).isoformat()
            await self._store_job(job)
            
            # Remove from active jobs
            del self.active_jobs[job_id]
            
            # Remove from Redis
            if self.redis_client:
                await self.redis_client.hdel(STREAMING_JOBS_KEY, job_id)
            
            logger.info(f"Stopped streaming job: {job_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to stop streaming job {job_id}: {e}")
            return False
    
    async def pause_streaming_job(self, job_id: str) -> bool:
        """Pause a streaming job."""
        if job_id not in self.active_jobs:
            return False
        
        job = self.active_jobs[job_id]
        if job.status != StreamingJobStatus.RUNNING:
            return False
        
        job.status = StreamingJobStatus.PAUSED
        job.updated_at = datetime.now(timezone.utc).isoformat()
        await self._store_job(job)
        
        logger.info(f"Paused streaming job: {job_id}")
        return True
    
    async def resume_streaming_job(self, job_id: str) -> bool:
        """Resume a paused streaming job."""
        if job_id not in self.active_jobs:
            return False
        
        job = self.active_jobs[job_id]
        if job.status != StreamingJobStatus.PAUSED:
            return False
        
        job.status = StreamingJobStatus.RUNNING
        job.updated_at = datetime.now(timezone.utc).isoformat()
        await self._store_job(job)
        
        logger.info(f"Resumed streaming job: {job_id}")
        return True
    
    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a streaming job."""
        if job_id not in self.active_jobs:
            return None
        
        job = self.active_jobs[job_id]
        status_info = {
            "job_id": job.job_id,
            "agent_id": job.agent_id,
            "stream_id": job.stream_id,
            "status": job.status.value,
            "connection_status": job.connection_status.value,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "last_heartbeat": job.last_heartbeat,
            "reconnect_attempts": job.reconnect_attempts
        }
        
        # Add K8s resource status if available
        if job.k8s_resource_id:
            k8s_status = self.scheduling_service.getJobStatus(job.k8s_resource_id)
            status_info["k8s_status"] = k8s_status
        
        return status_info
    
    async def list_streaming_jobs(self) -> List[Dict[str, Any]]:
        """List all active streaming jobs."""
        jobs = []
        for job in self.active_jobs.values():
            job_info = await self.get_job_status(job.job_id)
            if job_info:
                jobs.append(job_info)
        return jobs
    
    def _create_streaming_manifest(self, job: StreamingJob) -> Dict[str, Any]:
        """Create an enhanced manifest for streaming execution."""
        manifest = job.manifest.copy()
        
        # Add streaming-specific environment variables
        env_vars = manifest.get("env", [])
        
        # Add streaming configuration
        streaming_env = [
            f"STREAMING_ENABLED=true",
            f"STREAM_ID={job.stream_id}",
            f"JOB_ID={job.job_id}",
            f"GATEWAY_URL=http://gateway:8001",
            f"STREAMING_ENDPOINT=/api/v1/streams/{job.stream_id}/publish"
        ]
        
        env_vars.extend(streaming_env)
        manifest["env"] = env_vars
        
        # Ensure it's marked as long-running for streaming
        manifest["longRunning"] = True
        
        # Add streaming health check configuration
        if "resources" not in manifest:
            manifest["resources"] = {}
        
        # Enhance resource requirements for streaming
        if not manifest["resources"].get("cpu"):
            manifest["resources"]["cpu"] = "200m"  # Higher CPU for streaming
        if not manifest["resources"].get("memory"):
            manifest["resources"]["memory"] = "256Mi"  # More memory for buffering
        
        return manifest
    
    async def _store_job(self, job: StreamingJob):
        """Store job metadata in Redis."""
        if self.redis_client:
            job_data = {
                "job_id": job.job_id,
                "agent_id": job.agent_id,
                "stream_id": job.stream_id,
                "status": job.status.value,
                "connection_status": job.connection_status.value,
                "created_at": job.created_at,
                "updated_at": job.updated_at,
                "k8s_resource_id": job.k8s_resource_id,
                "reconnect_attempts": job.reconnect_attempts,
                "last_heartbeat": job.last_heartbeat,
                "manifest": json.dumps(job.manifest),
                "metadata": json.dumps(job.metadata) if job.metadata else None
            }
            await self.redis_client.hset(STREAMING_JOBS_KEY, job.job_id, json.dumps(job_data))
    
    async def _load_existing_jobs(self):
        """Load existing streaming jobs from Redis."""
        if not self.redis_client:
            return
        
        try:
            job_data_map = await self.redis_client.hgetall(STREAMING_JOBS_KEY)
            
            for job_id, job_data_str in job_data_map.items():
                job_data = json.loads(job_data_str)
                
                job = StreamingJob(
                    job_id=job_data["job_id"],
                    agent_id=job_data["agent_id"],
                    manifest=json.loads(job_data["manifest"]),
                    stream_id=job_data["stream_id"],
                    status=StreamingJobStatus(job_data["status"]),
                    created_at=job_data["created_at"],
                    updated_at=job_data["updated_at"],
                    k8s_resource_id=job_data.get("k8s_resource_id"),
                    connection_status=AgentConnectionStatus(job_data.get("connection_status", "disconnected")),
                    reconnect_attempts=job_data.get("reconnect_attempts", 0),
                    last_heartbeat=job_data.get("last_heartbeat"),
                    metadata=json.loads(job_data["metadata"]) if job_data.get("metadata") else None
                )
                
                self.active_jobs[job_id] = job
                
            logger.info(f"Loaded {len(self.active_jobs)} existing streaming jobs")
            
        except Exception as e:
            logger.error(f"Failed to load existing jobs: {e}")
    
    async def _heartbeat_loop(self):
        """Background task for managing streaming job heartbeats."""
        while True:
            try:
                await asyncio.sleep(STREAMING_HEARTBEAT_INTERVAL)
                
                current_time = datetime.now(timezone.utc).isoformat()
                
                for job in self.active_jobs.values():
                    if job.status == StreamingJobStatus.RUNNING:
                        # Update heartbeat
                        job.last_heartbeat = current_time
                        await self._store_job(job)
                        
                        # Check K8s resource health
                        if job.k8s_resource_id:
                            k8s_status = self.scheduling_service.getJobStatus(job.k8s_resource_id)
                            
                            # Update job status based on K8s status
                            if k8s_status.get("status") == "failed":
                                job.status = StreamingJobStatus.FAILED
                                await self._store_job(job)
                                logger.error(f"Streaming job {job.job_id} failed in K8s")
                                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}")
    
    async def _health_check_loop(self):
        """Background task for health checks and reconnection logic."""
        while True:
            try:
                await asyncio.sleep(60)  # Health check every minute
                
                for job in list(self.active_jobs.values()):
                    if job.status == StreamingJobStatus.FAILED and job.reconnect_attempts < MAX_RECONNECT_ATTEMPTS:
                        # Attempt to restart failed jobs
                        await asyncio.sleep(RECONNECT_DELAY_BASE ** job.reconnect_attempts)
                        
                        job.reconnect_attempts += 1
                        logger.info(f"Attempting to restart failed job {job.job_id} (attempt {job.reconnect_attempts})")
                        
                        success = await self.start_streaming_job(job.job_id)
                        if success:
                            job.reconnect_attempts = 0  # Reset on successful restart
                            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health check loop: {e}")


# Global streaming orchestrator instance
_streaming_orchestrator: Optional[StreamingOrchestrator] = None

def get_streaming_orchestrator() -> StreamingOrchestrator:
    """Get the global streaming orchestrator instance."""
    global _streaming_orchestrator
    if _streaming_orchestrator is None:
        _streaming_orchestrator = StreamingOrchestrator()
    return _streaming_orchestrator