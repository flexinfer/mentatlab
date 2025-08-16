"""
Sliding window memory manager for pre-activation history.
"""
import torch
from collections import deque
from typing import Optional, List


class SlidingMemory:
    """
    Manages a sliding window of pre-activation history for temporal context.
    """
    
    def __init__(self, window_size: int):
        self.window_size = window_size
        self.memory = deque(maxlen=window_size)
        self.device = None
        
    def push(self, state: torch.Tensor):
        """Add a new state to the memory."""
        self.memory.append(state.detach().clone())
        if self.device is None and len(self.memory) > 0:
            self.device = state.device
            
    def get_window(self) -> Optional[torch.Tensor]:
        """
        Get the current memory window as a tensor.
        Returns None if memory is empty.
        Shape: (window_size, model_dim)
        """
        if len(self.memory) == 0:
            return None
            
        # Pad with zeros if we have fewer states than window_size
        states = list(self.memory)
        
        if len(states) < self.window_size:
            # Get shape from first state
            shape = states[0].shape
            device = states[0].device
            
            # Create zero padding
            padding_needed = self.window_size - len(states)
            zero_state = torch.zeros(shape, device=device)
            
            # Pad at the beginning (older positions)
            states = [zero_state] * padding_needed + states
            
        # Stack into tensor
        return torch.stack(states)
        
    def get_recent(self, n: int) -> List[torch.Tensor]:
        """Get the n most recent states."""
        n = min(n, len(self.memory))
        if n == 0:
            return []
        return list(self.memory)[-n:]
        
    def clear(self):
        """Clear the memory."""
        self.memory.clear()
        
    def is_full(self) -> bool:
        """Check if memory is at full capacity."""
        return len(self.memory) == self.window_size
        
    def __len__(self) -> int:
        """Get current memory size."""
        return len(self.memory)
        
    def get_attention_mask(self) -> Optional[torch.Tensor]:
        """
        Get attention mask for valid positions in memory.
        Returns tensor of shape (window_size,) with 1s for valid positions.
        """
        if len(self.memory) == 0:
            return None
            
        device = self.memory[0].device
        mask = torch.zeros(self.window_size, device=device)
        
        # Mark valid positions
        valid_start = self.window_size - len(self.memory)
        mask[valid_start:] = 1.0
        
        return mask