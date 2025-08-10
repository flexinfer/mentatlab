"""
Data Encryption Utilities for Psyche Simulation

Provides comprehensive encryption and hashing utilities for protecting
sensitive data at rest and in transit, including PII protection and
secure key management.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
from typing import Any, Dict, List, Optional, Tuple, Union
from datetime import datetime, timedelta
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
import bcrypt

from data.redis_state_manager import RedisStateManager

logger = logging.getLogger(__name__)


class EncryptionError(Exception):
    """Custom exception for encryption-related errors."""
    pass


class DataEncryption:
    """
    Comprehensive data encryption manager.
    
    Features:
    - AES-256 encryption for data at rest
    - Field-level encryption for sensitive data
    - Key rotation support
    - Secure key derivation
    - Data anonymization
    """
    
    def __init__(
        self,
        redis_manager: RedisStateManager,
        master_key: Optional[str] = None,
        key_rotation_days: int = 90
    ):
        """
        Initialize encryption manager.
        
        Args:
            redis_manager: Redis state manager
            master_key: Master encryption key (auto-generated if not provided)
            key_rotation_days: Days before key rotation is recommended
        """
        self.redis_manager = redis_manager
        self.key_rotation_days = key_rotation_days
        self.key_prefix = "psyche:encryption"
        
        # Initialize or load master key
        if master_key:
            self.master_key = base64.urlsafe_b64decode(master_key.encode())
        else:
            self.master_key = self._load_or_create_master_key()
        
        # Initialize Fernet cipher for simple encryption
        self.fernet = Fernet(base64.urlsafe_b64encode(self.master_key[:32]))
        
        # Track encryption metadata
        self.encryption_metadata: Dict[str, Dict[str, Any]] = {}
        
        # PII fields that should always be encrypted
        self.pii_fields = {
            "email", "phone", "ssn", "credit_card", "bank_account",
            "passport", "driver_license", "ip_address", "address",
            "date_of_birth", "full_name", "maiden_name"
        }
    
    def _load_or_create_master_key(self) -> bytes:
        """Load existing master key or create new one."""
        try:
            # Try to load from Redis
            key_data = self.redis_manager.get_agent_state(f"{self.key_prefix}:master")
            if key_data and "state" in key_data:
                encrypted_key = key_data["state"].get("encrypted_key")
                if encrypted_key:
                    # In production, this would be decrypted with HSM or KMS
                    return base64.urlsafe_b64decode(encrypted_key.encode())
            
            # Generate new master key
            master_key = os.urandom(32)  # 256 bits
            
            # Store encrypted (in production, use HSM/KMS)
            key_data = {
                "encrypted_key": base64.urlsafe_b64encode(master_key).decode(),
                "created_at": datetime.now().isoformat(),
                "rotation_due": (datetime.now() + timedelta(days=self.key_rotation_days)).isoformat()
            }
            
            self.redis_manager.store_agent_state(f"{self.key_prefix}:master", key_data)
            logger.info("Created new master encryption key")
            
            return master_key
            
        except Exception as e:
            logger.error(f"Error loading/creating master key: {e}")
            # Fallback to generated key (not persisted)
            return os.urandom(32)
    
    def _derive_key(self, context: Optional[str] = None) -> bytes:
        """Derive encryption key from master key and context."""
        salt = b"psyche_simulation_salt"
        if context:
            salt = salt + context.encode()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        return kdf.derive(self.master_key)
    
    def _pad_data(self, data: bytes) -> bytes:
        """Pad data to AES block size using PKCS7."""
        block_size = 16
        padding_length = block_size - (len(data) % block_size)
        padding = bytes([padding_length] * padding_length)
        return data + padding
    
    def _unpad_data(self, data: bytes) -> bytes:
        """Remove PKCS7 padding."""
        padding_length = data[-1]
        return data[:-padding_length]
    
    def encrypt_data(
        self,
        data: Union[str, bytes, Dict[str, Any]],
        context: Optional[str] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Encrypt data using AES-256.
        
        Args:
            data: Data to encrypt (string, bytes, or dict)
            context: Optional context for key derivation
            
        Returns:
            Tuple of (encrypted_data, metadata)
        """
        try:
            # Convert data to bytes
            if isinstance(data, dict):
                data_bytes = json.dumps(data).encode()
            elif isinstance(data, str):
                data_bytes = data.encode()
            else:
                data_bytes = data
            
            # Generate IV for AES
            iv = os.urandom(16)
            
            # Derive key from master key and context
            derived_key = self._derive_key(context)
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(derived_key),
                modes.CBC(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()
            
            # Pad data to AES block size
            padded_data = self._pad_data(data_bytes)
            
            # Encrypt
            encrypted = encryptor.update(padded_data) + encryptor.finalize()
            
            # Combine IV and encrypted data
            combined = iv + encrypted
            encrypted_b64 = base64.urlsafe_b64encode(combined).decode()
            
            # Create metadata
            metadata = {
                "algorithm": "AES-256-CBC",
                "context": context,
                "encrypted_at": datetime.now().isoformat(),
                "data_type": type(data).__name__
            }
            
            return encrypted_b64, metadata
            
        except Exception as e:
            logger.error(f"Encryption error: {e}")
            raise EncryptionError(f"Failed to encrypt data: {e}")
    
    def decrypt_data(
        self,
        encrypted_data: str,
        metadata: Dict[str, Any]
    ) -> Union[str, bytes, Dict[str, Any]]:
        """
        Decrypt data.
        
        Args:
            encrypted_data: Base64 encoded encrypted data
            metadata: Encryption metadata
            
        Returns:
            Decrypted data in original format
        """
        try:
            # Decode from base64
            combined = base64.urlsafe_b64decode(encrypted_data.encode())
            
            # Extract IV and encrypted data
            iv = combined[:16]
            encrypted = combined[16:]
            
            # Derive key
            context = metadata.get("context")
            derived_key = self._derive_key(context)
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(derived_key),
                modes.CBC(iv),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()
            
            # Decrypt
            padded_data = decryptor.update(encrypted) + decryptor.finalize()
            
            # Remove padding
            data_bytes = self._unpad_data(padded_data)
            
            # Convert back to original type
            data_type = metadata.get("data_type", "str")
            if data_type == "dict":
                return json.loads(data_bytes.decode())
            elif data_type == "str":
                return data_bytes.decode()
            else:
                return data_bytes
                
        except Exception as e:
            logger.error(f"Decryption error: {e}")
            raise EncryptionError(f"Failed to decrypt data: {e}")
    
    def encrypt_field(
        self,
        field_name: str,
        field_value: Any,
        record_id: Optional[str] = None
    ) -> str:
        """
        Encrypt a specific field value.
        
        Args:
            field_name: Name of the field
            field_value: Value to encrypt
            record_id: Optional record ID for context
            
        Returns:
            Encrypted field value
        """
        context = f"{field_name}:{record_id}" if record_id else field_name
        encrypted, metadata = self.encrypt_data(str(field_value), context)
        
        # Store metadata for audit
        self._store_encryption_metadata(field_name, record_id, metadata)
        
        return encrypted
    
    def decrypt_field(
        self,
        field_name: str,
        encrypted_value: str,
        record_id: Optional[str] = None
    ) -> str:
        """
        Decrypt a specific field value.
        
        Args:
            field_name: Name of the field
            encrypted_value: Encrypted value
            record_id: Optional record ID
            
        Returns:
            Decrypted field value
        """
        # Retrieve metadata
        metadata = self._get_encryption_metadata(field_name, record_id)
        if not metadata:
            metadata = {
                "context": f"{field_name}:{record_id}" if record_id else field_name
            }
        
        return str(self.decrypt_data(encrypted_value, metadata))
    
    def encrypt_pii(
        self,
        data: Dict[str, Any],
        additional_fields: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Automatically encrypt PII fields in a data dictionary.
        
        Args:
            data: Data dictionary
            additional_fields: Additional fields to encrypt
            
        Returns:
            Dictionary with PII fields encrypted
        """
        encrypted_data = data.copy()
        fields_to_encrypt = self.pii_fields.copy()
        
        if additional_fields:
            fields_to_encrypt.update(additional_fields)
        
        for field in fields_to_encrypt:
            if field in encrypted_data and encrypted_data[field]:
                encrypted_data[field] = self.encrypt_field(field, encrypted_data[field])
                encrypted_data[f"{field}_encrypted"] = True
        
        return encrypted_data
    
    def decrypt_pii(
        self,
        data: Dict[str, Any],
        authorized: bool = False
    ) -> Dict[str, Any]:
        """
        Decrypt PII fields if authorized.
        
        Args:
            data: Data dictionary with encrypted PII
            authorized: Whether user is authorized to decrypt PII
            
        Returns:
            Dictionary with PII decrypted or masked
        """
        decrypted_data = data.copy()
        
        for field, value in data.items():
            if field.endswith("_encrypted") and data.get(field) is True:
                original_field = field[:-10]  # Remove "_encrypted"
                
                if authorized and original_field in decrypted_data:
                    try:
                        decrypted_data[original_field] = self.decrypt_field(
                            original_field,
                            decrypted_data[original_field]
                        )
                        del decrypted_data[field]
                    except Exception as e:
                        logger.error(f"Error decrypting {original_field}: {e}")
                        decrypted_data[original_field] = "**DECRYPTION_ERROR**"
                else:
                    # Mask the data if not authorized
                    decrypted_data[original_field] = "**REDACTED**"
        
        return decrypted_data
    
    def anonymize_data(
        self,
        data: Union[str, Dict[str, Any]],
        method: str = "hash"
    ) -> str:
        """
        Anonymize data for privacy-preserving analytics.
        
        Args:
            data: Data to anonymize
            method: Anonymization method (hash, truncate, mask)
            
        Returns:
            Anonymized data
        """
        if isinstance(data, dict):
            data_str = json.dumps(data, sort_keys=True)
        else:
            data_str = str(data)
        
        if method == "hash":
            # Use HMAC for consistent but irreversible anonymization
            return hmac.new(
                self.master_key,
                data_str.encode(),
                hashlib.sha256
            ).hexdigest()[:16]
        
        elif method == "truncate":
            # Keep only first few characters
            return data_str[:4] + "..." if len(data_str) > 4 else data_str
        
        elif method == "mask":
            # Replace with asterisks except first/last char
            if len(data_str) <= 2:
                return "*" * len(data_str)
            return data_str[0] + "*" * (len(data_str) - 2) + data_str[-1]
        
        else:
            return "**ANONYMIZED**"
    
    def _store_encryption_metadata(
        self,
        field_name: str,
        record_id: Optional[str],
        metadata: Dict[str, Any]
    ):
        """Store encryption metadata for audit trail."""
        key = f"{field_name}:{record_id}" if record_id else field_name
        self.encryption_metadata[key] = metadata
        
        # Also store in Redis for persistence
        redis_key = f"{self.key_prefix}:metadata:{key}"
        self.redis_manager.store_agent_state(redis_key, metadata, ttl=86400 * 30)  # 30 days
    
    def _get_encryption_metadata(
        self,
        field_name: str,
        record_id: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """Retrieve encryption metadata."""
        key = f"{field_name}:{record_id}" if record_id else field_name
        
        # Check in-memory cache first
        if key in self.encryption_metadata:
            return self.encryption_metadata[key]
        
        # Try Redis
        redis_key = f"{self.key_prefix}:metadata:{key}"
        data = self.redis_manager.get_agent_state(redis_key)
        
        if data and "state" in data:
            metadata = data["state"]
            self.encryption_metadata[key] = metadata
            return metadata
        
        return None
    
    def rotate_master_key(self, new_master_key: Optional[bytes] = None) -> bool:
        """
        Rotate the master encryption key.
        
        Args:
            new_master_key: New master key (auto-generated if not provided)
            
        Returns:
            Success status
        """
        try:
            # Generate new key if not provided
            if not new_master_key:
                new_master_key = os.urandom(32)
            
            # Re-encrypt all active data with new key
            # This is a simplified version - in production, you'd need
            # to re-encrypt all data in Redis
            
            # Update master key
            old_key = self.master_key
            self.master_key = new_master_key
            self.fernet = Fernet(base64.urlsafe_b64encode(self.master_key[:32]))
            
            # Store new key
            key_data = {
                "encrypted_key": base64.urlsafe_b64encode(new_master_key).decode(),
                "created_at": datetime.now().isoformat(),
                "rotation_due": (datetime.now() + timedelta(days=self.key_rotation_days)).isoformat(),
                "rotated_from": base64.urlsafe_b64encode(old_key).decode()[:8] + "..."
            }
            
            self.redis_manager.store_agent_state(f"{self.key_prefix}:master", key_data)
            
            logger.info("Master encryption key rotated successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error rotating master key: {e}")
            return False


# Helper functions for easy encryption/decryption
def encrypt_data(
    data: Any,
    redis_manager: RedisStateManager,
    context: Optional[str] = None
) -> Tuple[str, Dict[str, Any]]:
    """
    Encrypt data using the default encryption manager.
    
    Args:
        data: Data to encrypt
        redis_manager: Redis state manager
        context: Optional encryption context
        
    Returns:
        Tuple of (encrypted_data, metadata)
    """
    encryptor = DataEncryption(redis_manager)
    return encryptor.encrypt_data(data, context)


def decrypt_data(
    encrypted_data: str,
    metadata: Dict[str, Any],
    redis_manager: RedisStateManager
) -> Any:
    """
    Decrypt data using the default encryption manager.
    
    Args:
        encrypted_data: Encrypted data
        metadata: Encryption metadata
        redis_manager: Redis state manager
        
    Returns:
        Decrypted data
    """
    encryptor = DataEncryption(redis_manager)
    return encryptor.decrypt_data(encrypted_data, metadata)


def hash_sensitive_data(data: str, salt: Optional[str] = None) -> str:
    """
    Hash sensitive data using bcrypt.
    
    Args:
        data: Data to hash
        salt: Optional salt (auto-generated if not provided)
        
    Returns:
        Hashed data
    """
    if not salt:
        salt = bcrypt.gensalt()
    else:
        salt = salt.encode() if isinstance(salt, str) else salt
    
    hashed = bcrypt.hashpw(data.encode(), salt)
    return hashed.decode()


def generate_encryption_key() -> str:
    """
    Generate a secure encryption key.
    
    Returns:
        Base64 encoded encryption key
    """
    key = os.urandom(32)  # 256 bits
    return base64.urlsafe_b64encode(key).decode()