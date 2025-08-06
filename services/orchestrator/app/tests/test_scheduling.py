import pytest
from unittest.mock import Mock, patch
from typing import Dict, Any

from services.orchestrator.app.tests.mock_scheduling import MockSchedulingService
from services.orchestrator.app.manifest_validator import ValidationMode, ValidationResult


@pytest.fixture
def scheduling_service():
    """Create a MockSchedulingService instance for testing."""
    return MockSchedulingService()


@patch('services.orchestrator.app.tests.mock_scheduling.validate_agent_manifest')
def test_agent_scheduling_with_validation(mock_validate, scheduling_service):
    """Test that agent scheduling validates manifest before scheduling."""
    agent_manifest = {
        "id": "test-agent",
        "version": "1.0.0",
        "image": "test/agent:1.0.0",
        "description": "Test agent for validation",
        "inputs": [
            {"name": "input1", "type": "string"}
        ],
        "outputs": [
            {"name": "output1", "type": "string"}
        ],
        "longRunning": False
    }
    
    inputs = {"input1": "test"}
    
    # Mock successful validation
    mock_validate.return_value = ValidationResult(
        is_valid=True,
        errors=[],
        warnings=[]
    )
    
    # Schedule the agent
    resource_id = scheduling_service.scheduleAgent(agent_manifest, inputs)
    
    # Verify validation was called
    mock_validate.assert_called_once_with(agent_manifest)
    
    # Verify job was created
    assert resource_id.startswith("test-agent-")
    assert resource_id in scheduling_service.scheduled_jobs
    assert scheduling_service.scheduled_jobs[resource_id]["type"] == "agent"
    assert scheduling_service.scheduled_jobs[resource_id]["agent_id"] == "test-agent"


@patch('services.orchestrator.app.tests.mock_scheduling.validate_agent_manifest')
def test_invalid_agent_scheduling(mock_validate, scheduling_service):
    """Test that invalid manifests are rejected during scheduling."""
    invalid_manifest = {
        "id": "test.invalid",
        # Missing required fields
    }
    
    # Mock failed validation
    mock_validate.return_value = ValidationResult(
        is_valid=False,
        errors=["Invalid agent manifest: missing required field 'image'"],
        warnings=[]
    )
    
    # Try to schedule the agent - should raise ValueError
    with pytest.raises(ValueError) as exc_info:
        scheduling_service.scheduleAgent(invalid_manifest, {})
    
    assert "Agent manifest validation failed" in str(exc_info.value)
    
    # Verify job was not created
    assert len(scheduling_service.scheduled_jobs) == 0


def test_workflow_scheduling(scheduling_service):
    """Test workflow scheduling."""
    workflow_id = "test-workflow"
    cron_schedule = "0 * * * *"
    
    # Schedule workflow
    job_id = scheduling_service.scheduleWorkflow(workflow_id, cron_schedule)
    
    # Verify job was created
    assert job_id.startswith(f"workflow-{workflow_id}-")
    assert job_id in scheduling_service.scheduled_jobs
    assert scheduling_service.scheduled_jobs[job_id]["type"] == "workflow"
    assert scheduling_service.scheduled_jobs[job_id]["workflow_id"] == workflow_id
    assert scheduling_service.scheduled_jobs[job_id]["cron_schedule"] == cron_schedule


def test_job_status_retrieval(scheduling_service):
    """Test getting job status."""
    # Schedule a job first
    agent_manifest = {"id": "test-agent", "image": "test:latest"}
    resource_id = scheduling_service.scheduleAgent(agent_manifest, {}, skip_validation=True)
    
    # Get status
    status = scheduling_service.getJobStatus(resource_id)
    assert status["status"] == "scheduled"
    
    # Test non-existent job
    status = scheduling_service.getJobStatus("non-existent-job")
    assert status["status"] == "not_found"


def test_job_cleanup(scheduling_service):
    """Test job cleanup."""
    # Schedule a job first
    agent_manifest = {"id": "test-agent", "image": "test:latest"}
    resource_id = scheduling_service.scheduleAgent(agent_manifest, {}, skip_validation=True)
    
    # Verify job exists
    assert resource_id in scheduling_service.scheduled_jobs
    
    # Cleanup job
    success = scheduling_service.cleanupJob(resource_id)
    assert success is True
    
    # Verify job is gone
    assert resource_id not in scheduling_service.scheduled_jobs
    
    # Test cleanup of non-existent job
    success = scheduling_service.cleanupJob("non-existent-job")
    assert success is False