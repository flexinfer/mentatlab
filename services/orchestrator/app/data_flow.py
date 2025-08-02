"""
Reference-based data flow system for MentatLab multimodal data.

Handles conversion of large files to storage references and resolution
during agent execution. Supports both direct data and reference-based flows.
"""

import logging
import json
import base64
from typing import Dict, Any, Optional, List, Union, Tuple
from datetime import datetime, timezone

from services.orchestrator.app.storage import (
    S3StorageService, 
    StorageReference, 
    StorageConfig,
    get_storage_service
)

logger = logging.getLogger(__name__)

# Configuration for reference conversion thresholds
REFERENCE_THRESHOLD_BYTES = {
    "audio": 10 * 1024 * 1024,   # 10MB
    "image": 5 * 1024 * 1024,    # 5MB  
    "video": 50 * 1024 * 1024,   # 50MB
    "binary": 20 * 1024 * 1024,  # 20MB
    "stream": 0  # Always use references for streams
}

class DataFlowService:
    """Service for managing reference-based data flow in multimodal pipelines."""
    
    def __init__(self, storage_service: Optional[S3StorageService] = None):
        self.storage_service = storage_service or get_storage_service()
        self._reference_cache: Dict[str, StorageReference] = {}
    
    def process_agent_inputs(self, agent_manifest: Dict[str, Any], 
                           inputs: Dict[str, Any]) -> Tuple[Dict[str, Any], List[StorageReference]]:
        """
        Process agent inputs, converting large files to references as needed.
        
        Args:
            agent_manifest: Agent manifest containing pin definitions
            inputs: Input data dictionary
            
        Returns:
            Tuple of (processed_inputs, created_references)
        """
        processed_inputs = {}
        created_references = []
        
        # Get input pin definitions
        input_pins = {pin["name"]: pin for pin in agent_manifest.get("inputs", [])}
        
        for input_name, input_value in inputs.items():
            pin_def = input_pins.get(input_name)
            if not pin_def:
                # Pass through unknown inputs unchanged
                processed_inputs[input_name] = input_value
                continue
            
            pin_type = pin_def.get("type", "string")
            
            # Handle multimodal types that might need references
            if pin_type in ["audio", "image", "video", "binary", "stream"]:
                processed_value, reference = self._process_multimodal_input(
                    input_name, input_value, pin_type, pin_def
                )
                processed_inputs[input_name] = processed_value
                if reference:
                    created_references.append(reference)
            else:
                # Pass through text-based inputs unchanged
                processed_inputs[input_name] = input_value
        
        return processed_inputs, created_references
    
    def resolve_agent_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Resolve storage references in agent inputs back to actual data.
        
        Args:
            inputs: Input data that may contain storage references
            
        Returns:
            Resolved input data with references replaced by actual content
        """
        resolved_inputs = {}
        
        for input_name, input_value in inputs.items():
            if self._is_storage_reference(input_value):
                try:
                    # Download and resolve the reference
                    resolved_value = self._resolve_reference(input_value)
                    resolved_inputs[input_name] = resolved_value
                    logger.debug(f"Resolved reference for input {input_name}")
                except Exception as e:
                    logger.error(f"Failed to resolve reference for input {input_name}: {e}")
                    # Fall back to the reference data itself
                    resolved_inputs[input_name] = input_value
            else:
                resolved_inputs[input_name] = input_value
        
        return resolved_inputs
    
    def cleanup_references(self, references: List[StorageReference]) -> int:
        """
        Clean up a list of storage references.
        
        Args:
            references: List of StorageReference objects to clean up
            
        Returns:
            Number of references successfully cleaned up
        """
        cleaned_count = 0
        
        for reference in references:
            try:
                if self.storage_service.delete_file(reference):
                    cleaned_count += 1
                    logger.debug(f"Cleaned up reference: {reference.uri}")
            except Exception as e:
                logger.warning(f"Failed to cleanup reference {reference.uri}: {e}")
        
        return cleaned_count
    
    def _process_multimodal_input(self, input_name: str, input_value: Any, 
                                pin_type: str, pin_def: Dict[str, Any]) -> Tuple[Any, Optional[StorageReference]]:
        """Process a multimodal input, converting to reference if needed."""
        
        # If input is already a reference, return as-is
        if self._is_storage_reference(input_value):
            return input_value, None
        
        # Handle different input formats
        if isinstance(input_value, bytes):
            # Raw binary data
            file_data = input_value
            filename = f"{input_name}.bin"
        elif isinstance(input_value, dict) and "data" in input_value:
            # Structured input with data and metadata
            if isinstance(input_value["data"], str):
                # Base64 encoded data
                try:
                    file_data = base64.b64decode(input_value["data"])
                except Exception as e:
                    logger.error(f"Failed to decode base64 data for {input_name}: {e}")
                    return input_value, None
            else:
                file_data = input_value["data"]
            
            filename = input_value.get("filename", f"{input_name}.bin")
        else:
            # Not a file-like input, return unchanged
            return input_value, None
        
        # Check if we should create a reference
        threshold = REFERENCE_THRESHOLD_BYTES.get(pin_type, REFERENCE_THRESHOLD_BYTES["binary"])
        if len(file_data) <= threshold and pin_type != "stream":
            # Small enough to pass directly
            return input_value, None
        
        try:
            # Create storage reference
            content_type = None
            metadata = {}
            
            # Extract metadata from structured input
            if isinstance(input_value, dict):
                content_type = input_value.get("content_type") or input_value.get("mimeType")
                if "metadata" in input_value:
                    metadata = input_value["metadata"]
            
            # Upload to storage and create reference
            reference = self.storage_service.upload_file(
                file_data=file_data,
                filename=filename,
                content_type=content_type,
                pin_type=pin_type,
                metadata=metadata
            )
            
            # Return reference data instead of original
            reference_data = {
                "type": "storage_reference",
                "reference": reference.to_dict(),
                "original_size": len(file_data),
                "pin_type": pin_type
            }
            
            logger.info(f"Created storage reference for {input_name} ({len(file_data)} bytes)")
            return reference_data, reference
            
        except Exception as e:
            logger.error(f"Failed to create storage reference for {input_name}: {e}")
            # Fall back to original data
            return input_value, None
    
    def _is_storage_reference(self, value: Any) -> bool:
        """Check if a value is a storage reference."""
        return (
            isinstance(value, dict) and 
            value.get("type") == "storage_reference" and
            "reference" in value
        )
    
    def _resolve_reference(self, reference_data: Dict[str, Any]) -> Dict[str, Any]:
        """Resolve a storage reference back to actual data."""
        reference_info = reference_data["reference"]
        reference = StorageReference.from_dict(reference_info)
        
        # Download the file content
        file_content = self.storage_service.download_file(reference)
        
        # Return structured data with content
        return {
            "data": base64.b64encode(file_content).decode('utf-8'),
            "content_type": reference.content_type,
            "size": reference.size,
            "filename": reference_info.get("filename", "data.bin"),
            "metadata": reference.metadata
        }
    
    def create_multimodal_volume_mounts(self, references: List[StorageReference]) -> List[Dict[str, Any]]:
        """
        Create Kubernetes volume mounts for multimodal files.
        
        Args:
            references: List of storage references to mount
            
        Returns:
            List of volume mount configurations for Kubernetes
        """
        volume_mounts = []
        
        # For this implementation, we'll create init containers that download files
        # In a production system, this could use S3 CSI driver or similar
        for i, reference in enumerate(references):
            volume_mounts.append({
                "name": f"multimodal-data-{i}",
                "mountPath": f"/data/multimodal/{i}",
                "reference": reference.to_dict()
            })
        
        return volume_mounts

# Global data flow service instance
_data_flow_service: Optional[DataFlowService] = None

def get_data_flow_service() -> DataFlowService:
    """Get the global data flow service instance, creating it if necessary."""
    global _data_flow_service
    if _data_flow_service is None:
        _data_flow_service = DataFlowService()
    return _data_flow_service