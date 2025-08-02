import json
import logging
import os
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from enum import Enum

import jsonschema
from jsonschema import validate, ValidationError, Draft7Validator

logger = logging.getLogger(__name__)

class ValidationMode(Enum):
    """Validation modes for agent manifest validation."""
    STRICT = "strict"
    PERMISSIVE = "permissive"
    DISABLED = "disabled"

class ValidationResult:
    """Result of manifest validation."""
    
    def __init__(self, is_valid: bool, errors: List[str] = None, warnings: List[str] = None):
        self.is_valid = is_valid
        self.errors = errors or []
        self.warnings = warnings or []
    
    def __bool__(self):
        return self.is_valid
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.is_valid,
            "errors": self.errors,
            "warnings": self.warnings
        }

class ManifestValidator:
    """Agent manifest validator using JSON Schema."""
    
    def __init__(self, validation_mode: ValidationMode = ValidationMode.STRICT):
        self.validation_mode = validation_mode
        self.schema = None
        self._load_schema()
    
    def _load_schema(self) -> None:
        """Load the agent schema from the schemas directory."""
        try:
            # Find the schema file relative to the project root
            current_dir = Path(__file__).resolve()
            project_root = current_dir.parents[3]  # Go up to mentatlab root
            schema_path = project_root / "schemas" / "agent.schema.json"
            
            if not schema_path.exists():
                logger.error(f"Agent schema not found at {schema_path}")
                raise FileNotFoundError(f"Agent schema not found at {schema_path}")
            
            with open(schema_path, 'r') as f:
                self.schema = json.load(f)
            
            # Validate the schema itself
            Draft7Validator.check_schema(self.schema)
            logger.info(f"Loaded agent manifest schema from {schema_path}")
            
        except Exception as e:
            logger.error(f"Failed to load agent schema: {e}")
            raise
    
    def validate_manifest(self, manifest: Dict[str, Any]) -> ValidationResult:
        """
        Validate an agent manifest against the schema.
        
        Args:
            manifest: The agent manifest to validate
            
        Returns:
            ValidationResult with validation outcome and any errors/warnings
        """
        if self.validation_mode == ValidationMode.DISABLED:
            return ValidationResult(is_valid=True)
        
        if not self.schema:
            logger.error("Schema not loaded, cannot validate manifest")
            return ValidationResult(
                is_valid=False, 
                errors=["Schema not loaded, validation failed"]
            )
        
        try:
            # Perform JSON Schema validation
            validator = Draft7Validator(self.schema)
            schema_errors = list(validator.iter_errors(manifest))
            
            # Convert validation errors to readable messages
            error_messages = []
            warning_messages = []
            
            for error in schema_errors:
                path = " -> ".join(str(p) for p in error.absolute_path) if error.absolute_path else "root"
                message = f"At '{path}': {error.message}"
                
                if self.validation_mode == ValidationMode.STRICT:
                    error_messages.append(message)
                else:  # PERMISSIVE
                    warning_messages.append(message)
            
            # Additional semantic validations
            semantic_issues = self._validate_semantic_rules(manifest)
            
            if self.validation_mode == ValidationMode.STRICT:
                error_messages.extend(semantic_issues)
            else:  # PERMISSIVE
                warning_messages.extend(semantic_issues)
            
            is_valid = len(error_messages) == 0
            
            if not is_valid:
                logger.warning(f"Manifest validation failed with {len(error_messages)} errors")
            elif warning_messages:
                logger.info(f"Manifest validation passed with {len(warning_messages)} warnings")
            else:
                logger.debug("Manifest validation passed successfully")
            
            return ValidationResult(
                is_valid=is_valid,
                errors=error_messages,
                warnings=warning_messages
            )
            
        except Exception as e:
            logger.error(f"Unexpected error during manifest validation: {e}")
            return ValidationResult(
                is_valid=False,
                errors=[f"Validation error: {str(e)}"]
            )
    
    def _validate_semantic_rules(self, manifest: Dict[str, Any]) -> List[str]:
        """
        Validate semantic rules that go beyond JSON Schema.
        
        Args:
            manifest: The agent manifest to validate
            
        Returns:
            List of semantic validation error messages
        """
        issues = []
        
        # Validate image format
        image = manifest.get("image", "")
        if image and not self._is_valid_image_reference(image):
            issues.append(f"Image reference '{image}' should include an explicit tag or digest")
        
        # Validate pin names are unique within inputs and outputs
        inputs = manifest.get("inputs", [])
        outputs = manifest.get("outputs", [])
        
        input_names = [pin.get("name", "") for pin in inputs]
        if len(input_names) != len(set(input_names)):
            issues.append("Input pin names must be unique")
        
        output_names = [pin.get("name", "") for pin in outputs]
        if len(output_names) != len(set(output_names)):
            issues.append("Output pin names must be unique")
        
        # Validate environment variables format
        env_vars = manifest.get("env", [])
        for env_var in env_vars:
            if not isinstance(env_var, str) or "=" not in env_var:
                issues.append(f"Environment variable '{env_var}' must be in format 'KEY=VALUE'")
        
        return issues
    
    def _is_valid_image_reference(self, image: str) -> bool:
        """
        Check if image reference includes explicit tag or digest.
        
        Args:
            image: Container image reference
            
        Returns:
            True if image has explicit tag or digest
        """
        # Check for digest (sha256:...)
        if "@sha256:" in image:
            return True
        
        # Check for explicit tag (not latest or no tag)
        if ":" in image:
            parts = image.split(":")
            if len(parts) >= 2 and parts[-1] not in ["latest", ""]:
                return True
        
        return False
    
    def set_validation_mode(self, mode: ValidationMode) -> None:
        """Update the validation mode."""
        self.validation_mode = mode
        logger.info(f"Validation mode set to: {mode.value}")
    
    @classmethod
    def from_config(cls, config: Optional[Dict[str, Any]] = None) -> 'ManifestValidator':
        """
        Create validator from configuration.
        
        Args:
            config: Configuration dictionary with validation settings
            
        Returns:
            Configured ManifestValidator instance
        """
        if not config:
            # Try to get from environment variable
            mode_str = os.getenv("MENTATLAB_VALIDATION_MODE", "strict").lower()
        else:
            mode_str = config.get("validation_mode", "strict").lower()
        
        try:
            mode = ValidationMode(mode_str)
        except ValueError:
            logger.warning(f"Invalid validation mode '{mode_str}', defaulting to strict")
            mode = ValidationMode.STRICT
        
        return cls(validation_mode=mode)

# Global validator instance - initialized on first import
_validator_instance: Optional[ManifestValidator] = None

def get_validator() -> ManifestValidator:
    """Get the global validator instance, creating it if necessary."""
    global _validator_instance
    if _validator_instance is None:
        _validator_instance = ManifestValidator.from_config()
    return _validator_instance

def validate_agent_manifest(manifest: Dict[str, Any], 
                          validation_mode: Optional[ValidationMode] = None) -> ValidationResult:
    """
    Convenience function to validate an agent manifest.
    
    Args:
        manifest: Agent manifest to validate
        validation_mode: Optional validation mode override
        
    Returns:
        ValidationResult with validation outcome
    """
    validator = get_validator()
    
    if validation_mode and validation_mode != validator.validation_mode:
        # Create temporary validator with specified mode
        temp_validator = ManifestValidator(validation_mode)
        return temp_validator.validate_manifest(manifest)
    
    return validator.validate_manifest(manifest)