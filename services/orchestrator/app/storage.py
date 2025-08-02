"""
S3-compatible object storage integration for MentatLab multimodal data.

Supports AWS S3, MinIO, and other S3-compatible storage backends.
Handles file upload/download, reference generation, and cleanup.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Union, BinaryIO
from urllib.parse import urlparse
import hashlib
import mimetypes

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from botocore.config import Config

logger = logging.getLogger(__name__)

class StorageConfig:
    """Configuration for S3-compatible storage."""
    
    def __init__(self):
        self.endpoint_url = os.getenv("MENTATLAB_S3_ENDPOINT")
        self.access_key = os.getenv("MENTATLAB_S3_ACCESS_KEY")
        self.secret_key = os.getenv("MENTATLAB_S3_SECRET_KEY")
        self.bucket_name = os.getenv("MENTATLAB_S3_BUCKET", self._get_default_bucket())
        self.region = os.getenv("MENTATLAB_S3_REGION", "us-east-1")
        self.use_ssl = os.getenv("MENTATLAB_S3_USE_SSL", "true").lower() == "true"
        
        # File size limits per media type (in bytes)
        self.max_file_sizes = {
            "audio": int(os.getenv("MENTATLAB_MAX_AUDIO_SIZE", "100") or "100") * 1024 * 1024,  # 100MB
            "image": int(os.getenv("MENTATLAB_MAX_IMAGE_SIZE", "50") or "50") * 1024 * 1024,   # 50MB
            "video": int(os.getenv("MENTATLAB_MAX_VIDEO_SIZE", "1000") or "1000") * 1024 * 1024, # 1GB
            "binary": int(os.getenv("MENTATLAB_MAX_BINARY_SIZE", "200") or "200") * 1024 * 1024  # 200MB
        }
        
        # Supported MIME types
        self.supported_mime_types = {
            "audio": ["audio/wav", "audio/mp3", "audio/mpeg", "audio/ogg", "audio/flac"],
            "image": ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
            "video": ["video/mp4", "video/webm", "video/avi", "video/mov", "video/mkv"],
        }
        
        # Cleanup settings
        self.reference_ttl_hours = int(os.getenv("MENTATLAB_REFERENCE_TTL_HOURS", "24"))
    
    def _get_default_bucket(self) -> str:
        """Generate default bucket name based on environment."""
        env = os.getenv("MENTATLAB_ENVIRONMENT", "dev")
        return f"mentatlab-{env}-media"
    
    def validate(self) -> bool:
        """Validate required configuration is present."""
        if not self.access_key or not self.secret_key:
            logger.error("S3 credentials not configured (MENTATLAB_S3_ACCESS_KEY, MENTATLAB_S3_SECRET_KEY)")
            return False
        
        if not self.bucket_name:
            logger.error("S3 bucket name not configured")
            return False
        
        return True

class StorageReference:
    """Represents a reference to a file in object storage."""
    
    def __init__(self, uri: str, content_type: str, size: int, checksum: str, metadata: Optional[Dict[str, Any]] = None):
        self.uri = uri
        self.content_type = content_type
        self.size = size
        self.checksum = checksum
        self.metadata = metadata or {}
        self.created_at = datetime.now(timezone.utc)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "uri": self.uri,
            "content_type": self.content_type,
            "size": self.size,
            "checksum": self.checksum,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StorageReference':
        """Create from dictionary representation."""
        ref = cls(
            uri=data["uri"],
            content_type=data["content_type"],
            size=data["size"],
            checksum=data["checksum"],
            metadata=data.get("metadata", {})
        )
        if "created_at" in data:
            ref.created_at = datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))
        return ref

class S3StorageService:
    """S3-compatible object storage service for multimodal data."""
    
    def __init__(self, config: Optional[StorageConfig] = None):
        self.config = config or StorageConfig()
        self._client = None
        self._initialized = False
    
    def _initialize(self) -> bool:
        """Initialize S3 client connection."""
        if self._initialized:
            return True
        
        if not self.config.validate():
            return False
        
        try:
            # Configure S3 client
            client_config = Config(
                region_name=self.config.region,
                signature_version='s3v4',
                retries={'max_attempts': 3}
            )
            
            self._client = boto3.client(
                's3',
                endpoint_url=self.config.endpoint_url,
                aws_access_key_id=self.config.access_key,
                aws_secret_access_key=self.config.secret_key,
                config=client_config,
                use_ssl=self.config.use_ssl
            )
            
            # Test connection and create bucket if needed
            self._ensure_bucket_exists()
            self._initialized = True
            logger.info(f"S3 storage service initialized for bucket: {self.config.bucket_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize S3 storage service: {e}")
            return False
    
    def _ensure_bucket_exists(self) -> None:
        """Ensure the storage bucket exists."""
        try:
            self._client.head_bucket(Bucket=self.config.bucket_name)
            logger.debug(f"Bucket {self.config.bucket_name} exists")
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                try:
                    # Create bucket
                    if self.config.region == 'us-east-1':
                        self._client.create_bucket(Bucket=self.config.bucket_name)
                    else:
                        self._client.create_bucket(
                            Bucket=self.config.bucket_name,
                            CreateBucketConfiguration={'LocationConstraint': self.config.region}
                        )
                    logger.info(f"Created bucket: {self.config.bucket_name}")
                except ClientError as create_error:
                    logger.error(f"Failed to create bucket {self.config.bucket_name}: {create_error}")
                    raise
            else:
                logger.error(f"Failed to access bucket {self.config.bucket_name}: {e}")
                raise
    
    def upload_file(self, file_data: Union[bytes, BinaryIO], 
                   filename: str, 
                   content_type: Optional[str] = None,
                   pin_type: str = "binary",
                   metadata: Optional[Dict[str, Any]] = None) -> StorageReference:
        """
        Upload file data to object storage and return a reference.
        
        Args:
            file_data: File content as bytes or file-like object
            filename: Original filename
            content_type: MIME type (auto-detected if not provided)
            pin_type: Pin type for validation (audio, image, video, binary)
            metadata: Additional metadata
            
        Returns:
            StorageReference containing URI and metadata
            
        Raises:
            ValueError: If file validation fails
            RuntimeError: If upload fails
        """
        if not self._initialize():
            raise RuntimeError("Storage service not initialized")
        
        # Handle file-like objects
        if hasattr(file_data, 'read'):
            file_data = file_data.read()
        
        # Validate file
        self._validate_file(file_data, filename, content_type, pin_type)
        
        # Generate content type if not provided
        if not content_type:
            content_type, _ = mimetypes.guess_type(filename)
            if not content_type:
                content_type = "application/octet-stream"
        
        # Generate unique object key
        file_ext = Path(filename).suffix
        object_key = f"media/{pin_type}/{uuid.uuid4().hex}{file_ext}"
        
        # Calculate checksum
        checksum = hashlib.sha256(file_data).hexdigest()
        
        # Prepare metadata
        s3_metadata = {
            "original-filename": filename,
            "pin-type": pin_type,
            "checksum": checksum,
            "uploaded-at": datetime.now(timezone.utc).isoformat()
        }
        
        if metadata:
            # Add custom metadata with mentatlab prefix
            for key, value in metadata.items():
                s3_metadata[f"mentatlab-{key}"] = str(value)
        
        try:
            # Upload to S3
            self._client.put_object(
                Bucket=self.config.bucket_name,
                Key=object_key,
                Body=file_data,
                ContentType=content_type,
                Metadata=s3_metadata
            )
            
            # Generate reference URI
            uri = f"s3://{self.config.bucket_name}/{object_key}"
            
            logger.info(f"Uploaded file {filename} to {uri} ({len(file_data)} bytes)")
            
            return StorageReference(
                uri=uri,
                content_type=content_type,
                size=len(file_data),
                checksum=checksum,
                metadata=metadata or {}
            )
            
        except ClientError as e:
            logger.error(f"Failed to upload file {filename}: {e}")
            raise RuntimeError(f"Upload failed: {e}")
    
    def download_file(self, reference: Union[StorageReference, str]) -> bytes:
        """
        Download file content from object storage.
        
        Args:
            reference: StorageReference or URI string
            
        Returns:
            File content as bytes
            
        Raises:
            ValueError: If reference is invalid
            RuntimeError: If download fails
        """
        if not self._initialize():
            raise RuntimeError("Storage service not initialized")
        
        # Extract URI
        if isinstance(reference, StorageReference):
            uri = reference.uri
        else:
            uri = reference
        
        # Parse S3 URI
        object_key = self._parse_s3_uri(uri)
        
        try:
            response = self._client.get_object(
                Bucket=self.config.bucket_name,
                Key=object_key
            )
            
            content = response['Body'].read()
            logger.debug(f"Downloaded {len(content)} bytes from {uri}")
            return content
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                raise ValueError(f"File not found: {uri}")
            else:
                logger.error(f"Failed to download file {uri}: {e}")
                raise RuntimeError(f"Download failed: {e}")
    
    def delete_file(self, reference: Union[StorageReference, str]) -> bool:
        """
        Delete file from object storage.
        
        Args:
            reference: StorageReference or URI string
            
        Returns:
            True if successful, False otherwise
        """
        if not self._initialize():
            return False
        
        # Extract URI
        if isinstance(reference, StorageReference):
            uri = reference.uri
        else:
            uri = reference
        
        try:
            object_key = self._parse_s3_uri(uri)
            
            self._client.delete_object(
                Bucket=self.config.bucket_name,
                Key=object_key
            )
            
            logger.info(f"Deleted file: {uri}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete file {uri}: {e}")
            return False
    
    def cleanup_expired_references(self) -> int:
        """
        Clean up files older than the configured TTL.
        
        Returns:
            Number of files cleaned up
        """
        if not self._initialize():
            return 0
        
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=self.config.reference_ttl_hours)
        cleaned_count = 0
        
        try:
            # List objects in the media prefix
            paginator = self._client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=self.config.bucket_name, Prefix='media/')
            
            objects_to_delete = []
            
            for page in pages:
                if 'Contents' not in page:
                    continue
                
                for obj in page['Contents']:
                    if obj['LastModified'].replace(tzinfo=timezone.utc) < cutoff_time:
                        objects_to_delete.append({'Key': obj['Key']})
                        
                        # Delete in batches of 1000 (S3 limit)
                        if len(objects_to_delete) >= 1000:
                            self._delete_objects_batch(objects_to_delete)
                            cleaned_count += len(objects_to_delete)
                            objects_to_delete = []
            
            # Delete remaining objects
            if objects_to_delete:
                self._delete_objects_batch(objects_to_delete)
                cleaned_count += len(objects_to_delete)
            
            if cleaned_count > 0:
                logger.info(f"Cleaned up {cleaned_count} expired files")
            
            return cleaned_count
            
        except Exception as e:
            logger.error(f"Failed to cleanup expired references: {e}")
            return 0
    
    def _delete_objects_batch(self, objects: List[Dict[str, str]]) -> None:
        """Delete a batch of objects."""
        self._client.delete_objects(
            Bucket=self.config.bucket_name,
            Delete={'Objects': objects}
        )
    
    def _validate_file(self, file_data: bytes, filename: str, content_type: Optional[str], pin_type: str) -> None:
        """Validate file against size and type constraints."""
        # Check file size
        file_size = len(file_data)
        max_size = self.config.max_file_sizes.get(pin_type, self.config.max_file_sizes["binary"])
        
        if file_size > max_size:
            raise ValueError(f"File size {file_size} bytes exceeds limit {max_size} bytes for {pin_type}")
        
        # Check MIME type for typed pins
        if pin_type in self.config.supported_mime_types and content_type:
            supported_types = self.config.supported_mime_types[pin_type]
            if content_type not in supported_types:
                raise ValueError(f"MIME type {content_type} not supported for {pin_type}. Supported: {supported_types}")
    
    def _parse_s3_uri(self, uri: str) -> str:
        """Parse S3 URI and extract object key."""
        parsed = urlparse(uri)
        if parsed.scheme != 's3':
            raise ValueError(f"Invalid S3 URI: {uri}")
        
        # Remove leading slash from path
        object_key = parsed.path.lstrip('/')
        if not object_key:
            raise ValueError(f"Invalid S3 URI (missing object key): {uri}")
        
        return object_key

# Global storage service instance
_storage_service: Optional[S3StorageService] = None

def get_storage_service() -> S3StorageService:
    """Get the global storage service instance, creating it if necessary."""
    global _storage_service
    if _storage_service is None:
        _storage_service = S3StorageService()
    return _storage_service