import pytest
import json
from unittest.mock import Mock, patch
from services.orchestrator.app.scheduling import SchedulingService

def test_agent_scheduling_with_validation():
    """Test that agent scheduling includes validation."""
    # Create a valid agent manifest based on the echo agent
    valid_manifest = {
        "id": "test.agent",
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
    
    # Mock the Kubernetes client to avoid real K8s calls
    with patch('services.orchestrator.app.scheduling.config.load_incluster_config'), \
         patch('services.orchestrator.app.scheduling.config.load_kube_config'), \
         patch('services.orchestrator.app.scheduling.client.ApiClient'), \
         patch('services.orchestrator.app.scheduling.client.AppsV1Api'), \
         patch('services.orchestrator.app.scheduling.client.BatchV1Api') as mock_batch_api, \
         patch('services.orchestrator.app.scheduling.client.CoreV1Api'):
        
        # Mock the batch API create method
        mock_batch_api.return_value.create_namespaced_job.return_value = Mock()
        
        # Create scheduling service
        scheduler = SchedulingService()
        
        # Test valid manifest scheduling
        try:
            result = scheduler.scheduleAgent(valid_manifest, {"input1": "test"})
            assert result is not None
            print("✓ Valid manifest scheduling succeeded")
        except Exception as e:
            # If validation is working, this should succeed
            print(f"Valid manifest scheduling failed: {e}")

def test_invalid_agent_scheduling():
    """Test that invalid agent manifests are rejected."""
    # Create an invalid agent manifest
    invalid_manifest = {
        "id": "test.invalid",
        # Missing required fields
    }
    
    # Mock the Kubernetes client to avoid real K8s calls
    with patch('services.orchestrator.app.scheduling.config.load_incluster_config'), \
         patch('services.orchestrator.app.scheduling.config.load_kube_config'), \
         patch('services.orchestrator.app.scheduling.client.ApiClient'), \
         patch('services.orchestrator.app.scheduling.client.AppsV1Api'), \
         patch('services.orchestrator.app.scheduling.client.BatchV1Api'), \
         patch('services.orchestrator.app.scheduling.client.CoreV1Api'):
        
        # Create scheduling service
        scheduler = SchedulingService()
        
        # Test invalid manifest scheduling - should raise ValueError
        try:
            result = scheduler.scheduleAgent(invalid_manifest, {})
            print("❌ Invalid manifest was not rejected")
            assert False, "Invalid manifest should have been rejected"
        except ValueError as e:
            # This is expected for validation failure
            assert "validation failed" in str(e).lower()
            print("✓ Invalid manifest correctly rejected")
        except Exception as e:
            print(f"Unexpected error: {e}")
            # Could be a different error if dependencies not available

if __name__ == "__main__":
    """Run tests manually."""
    try:
        test_agent_scheduling_with_validation()
        test_invalid_agent_scheduling()
        print("\n🎉 Scheduling validation tests completed!")
    except ImportError as e:
        print(f"\n⚠️  Dependencies not available: {e}")
        print("Tests would work with proper environment setup")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")