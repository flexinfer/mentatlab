"""Mock implementation of SchedulingService for testing."""
import uuid
from typing import Dict, Any, Optional, List
from services.orchestrator.app.manifest_validator import validate_agent_manifest


class MockSchedulingService:
    """Mock scheduling service that doesn't require Kubernetes."""
    
    def __init__(self):
        """Initialize mock service."""
        self.scheduled_jobs = {}
        self.namespace = "test-namespace"
        self._initialized = True
    
    def _ensure_initialized(self):
        """Mock initialization check."""
        pass
    
    def scheduleWorkflow(self, workflow_id: str, cron_schedule: str) -> str:
        """Mock workflow scheduling."""
        job_id = f"workflow-{workflow_id}-{uuid.uuid4().hex[:8]}"
        self.scheduled_jobs[job_id] = {
            "type": "workflow",
            "workflow_id": workflow_id,
            "cron_schedule": cron_schedule,
            "status": "scheduled"
        }
        return job_id
    
    def scheduleAgent(self, agent_manifest: Dict[str, Any], inputs: Dict[str, Any],
                     execution_id: Optional[str] = None, skip_validation: bool = False) -> str:
        """Mock agent scheduling."""
        agent_id = agent_manifest.get("id", "unknown-agent")
        
        # Validate agent manifest unless explicitly skipped
        if not skip_validation:
            validation_result = validate_agent_manifest(agent_manifest)
            
            if not validation_result.is_valid:
                error_msg = f"Agent manifest validation failed for {agent_id}: {'; '.join(validation_result.errors)}"
                raise ValueError(error_msg)
        
        if execution_id:
            resource_id = f"{agent_id}-{execution_id}"
        else:
            resource_id = f"{agent_id}-{uuid.uuid4().hex[:8]}"
        
        self.scheduled_jobs[resource_id] = {
            "type": "agent",
            "agent_id": agent_id,
            "inputs": inputs,
            "status": "scheduled",
            "longRunning": agent_manifest.get("longRunning", False)
        }
        
        return resource_id
    
    def getJobStatus(self, job_id: str) -> Dict[str, Any]:
        """Mock job status retrieval."""
        if job_id not in self.scheduled_jobs:
            return {"status": "not_found", "message": f"Resource {job_id} not found"}
        
        job = self.scheduled_jobs[job_id]
        return {
            "status": job["status"],
            "active": 1 if job["status"] == "running" else 0,
            "succeeded": 1 if job["status"] == "succeeded" else 0,
            "failed": 1 if job["status"] == "failed" else 0
        }
    
    def cleanupJob(self, job_id: str) -> bool:
        """Mock job cleanup."""
        if job_id in self.scheduled_jobs:
            del self.scheduled_jobs[job_id]
            return True
        return False