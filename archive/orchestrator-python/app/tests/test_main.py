import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.tests.mock_scheduling import MockSchedulingService

# Mock the scheduling service for all tests
mock_scheduling_service = MockSchedulingService()

# Patch the get_scheduling_service function
with patch('app.main.get_scheduling_service', return_value=mock_scheduling_service):
    client = TestClient(app)

def test_execute_workflow_endpoint():
    # Assuming a workflow_id that exists or a mock for the workflow execution
    # For a basic test, we'll just check the endpoint exists and returns 200
    # In a real scenario, you'd mock the workflow execution logic.
    workflow_id = "test_workflow"
    inputs = {"text": "Hello, World!"}  # Add required inputs parameter
    response = client.post(f"/execute/{workflow_id}", json=inputs)
    assert response.status_code == 200
    # Further assertions could be added here based on expected response body
    assert "success" in response.json()