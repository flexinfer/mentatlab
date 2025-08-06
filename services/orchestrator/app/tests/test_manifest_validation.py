import pytest
import json
import yaml
from pathlib import Path
from services.orchestrator.app.manifest_validator import (
    ManifestValidator, 
    ValidationMode, 
    validate_agent_manifest
)

def test_valid_echo_agent_manifest():
    """Test validation of the echo agent manifest."""
    # Load the echo agent manifest
    echo_manifest_path = Path(__file__).parents[4] / "services" / "agents" / "echo" / "manifest.yaml"
    
    with open(echo_manifest_path, 'r') as f:
        manifest_data = yaml.safe_load(f)
    
    # Test validation
    result = validate_agent_manifest(manifest_data)
    
    assert result.is_valid, f"Echo agent manifest should be valid. Errors: {result.errors}"
    assert len(result.errors) == 0
    print(f"✓ Echo agent manifest validation passed")

def test_invalid_manifest():
    """Test validation of an invalid manifest."""
    invalid_manifest = {
        "id": "test.invalid",
        # Missing required fields: version, image, description, inputs, outputs
    }
    
    result = validate_agent_manifest(invalid_manifest)
    
    assert not result.is_valid
    assert len(result.errors) > 0
    print(f"✓ Invalid manifest correctly rejected with {len(result.errors)} errors")

def test_validation_modes():
    """Test different validation modes."""
    from services.orchestrator.app.manifest_validator import get_validator
    
    invalid_manifest = {
        "id": "test.invalid",
        "version": "1.0.0",
        "image": "test:latest",  # This should trigger a warning about explicit tags
        "description": "Test agent",
        "inputs": [],
        "outputs": []
    }
    
    # Get the validator instance
    validator = get_validator()
    
    # Test strict mode
    validator.set_validation_mode(ValidationMode.STRICT)
    strict_result = validate_agent_manifest(invalid_manifest)
    assert not strict_result.is_valid
    
    # Test permissive mode
    validator.set_validation_mode(ValidationMode.PERMISSIVE)
    permissive_result = validate_agent_manifest(invalid_manifest)
    assert permissive_result.is_valid  # Should pass but with warnings
    assert len(permissive_result.warnings) > 0
    
    # Test disabled mode
    validator.set_validation_mode(ValidationMode.DISABLED)
    disabled_result = validate_agent_manifest(invalid_manifest)
    assert disabled_result.is_valid
    assert len(disabled_result.errors) == 0
    assert len(disabled_result.warnings) == 0
    
    # Reset to strict mode for other tests
    validator.set_validation_mode(ValidationMode.STRICT)
    
    print(f"✓ All validation modes work correctly")

def test_semantic_validation():
    """Test semantic validation rules."""
    from services.orchestrator.app.manifest_validator import get_validator
    
    manifest_with_issues = {
        "id": "test.semantic",
        "version": "1.0.0",
        "image": "myimage:latest",  # Should warn about latest tag
        "description": "Test agent",
        "inputs": [
            {"name": "input1", "type": "string"},
            {"name": "input1", "type": "number"}  # Duplicate name
        ],
        "outputs": [
            {"name": "output1", "type": "string"}
        ],
        "env": [
            "VALID_VAR=value",
            "INVALID_VAR"  # Missing = sign
        ]
    }
    
    # Ensure we're in strict mode
    validator = get_validator()
    validator.set_validation_mode(ValidationMode.STRICT)
    
    result = validate_agent_manifest(manifest_with_issues)
    
    assert not result.is_valid
    
    # Check for specific semantic issues
    error_messages = " ".join(result.errors)
    assert "latest" in error_messages.lower() or "explicit tag" in error_messages.lower()
    assert "unique" in error_messages.lower()
    assert "KEY=VALUE" in error_messages
    
    print(f"✓ Semantic validation rules work correctly")

if __name__ == "__main__":
    """Run tests manually."""
    try:
        test_valid_echo_agent_manifest()
        test_invalid_manifest()
        test_validation_modes()
        test_semantic_validation()
        print("\n🎉 All validation tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        raise