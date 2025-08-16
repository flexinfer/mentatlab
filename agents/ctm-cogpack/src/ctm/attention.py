"""
Attention router using latent queries.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Optional
from .config import ComputeConfig


class AttentionRouter(nn.Module):
    """
    Routes information using multi-head attention with latent queries.
    """
    
    def __init__(self, config: ComputeConfig, device: torch.device):
        super().__init__()
        self.config = config
        self.device = device
        
        # Check that model_dim is divisible by num_heads
        assert config.model_dim % config.num_heads == 0, \
            f"model_dim ({config.model_dim}) must be divisible by num_heads ({config.num_heads})"
        
        self.head_dim = config.model_dim // config.num_heads
        
        # Latent query embeddings
        self.num_queries = 16  # Number of latent queries
        self.latent_queries = nn.Parameter(
            torch.randn(self.num_queries, config.model_dim) / math.sqrt(config.model_dim)
        )
        
        # Multi-head attention layers
        self.q_proj = nn.Linear(config.model_dim, config.model_dim)
        self.k_proj = nn.Linear(config.model_dim, config.model_dim)
        self.v_proj = nn.Linear(config.model_dim, config.model_dim)
        self.out_proj = nn.Linear(config.model_dim, config.model_dim)
        
        # Dropout and normalization
        self.dropout = nn.Dropout(config.dropout)
        self.layer_norm = nn.LayerNorm(config.model_dim)
        
        # Sync-aware gating
        self.sync_gate = nn.Sequential(
            nn.Linear(1, config.hidden_dim),
            nn.ReLU(),
            nn.Linear(config.hidden_dim, config.model_dim),
            nn.Sigmoid()
        )
        
        # Move to device
        self.to(device)
        
    def forward(
        self, 
        aggregated: torch.Tensor,
        sync_scores: torch.Tensor
    ) -> torch.Tensor:
        """
        Route information through attention mechanism.
        
        Args:
            aggregated: Aggregated signal, shape (model_dim,)
            sync_scores: Synchronization matrix, shape (num_neurons, num_neurons)
            
        Returns:
            Attended output: Shape (model_dim,)
        """
        # Expand aggregated for batch processing
        if aggregated.dim() == 1:
            aggregated = aggregated.unsqueeze(0)  # (1, model_dim)
        
        batch_size = aggregated.shape[0]
        
        # Prepare queries from latent embeddings
        queries = self.latent_queries.unsqueeze(0).expand(batch_size, -1, -1)  # (batch, num_queries, model_dim)
        
        # Use aggregated signal as both key and value
        keys = aggregated.unsqueeze(1)  # (batch, 1, model_dim)
        values = aggregated.unsqueeze(1)  # (batch, 1, model_dim)
        
        # Project to multi-head format
        Q = self.q_proj(queries)  # (batch, num_queries, model_dim)
        K = self.k_proj(keys)  # (batch, 1, model_dim)
        V = self.v_proj(values)  # (batch, 1, model_dim)
        
        # Reshape for multi-head attention
        Q = Q.view(batch_size, self.num_queries, self.config.num_heads, self.head_dim).transpose(1, 2)
        K = K.view(batch_size, 1, self.config.num_heads, self.head_dim).transpose(1, 2)
        V = V.view(batch_size, 1, self.config.num_heads, self.head_dim).transpose(1, 2)
        # Shapes: (batch, num_heads, seq_len, head_dim)
        
        # Compute attention scores
        scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.head_dim)
        # Shape: (batch, num_heads, num_queries, 1)
        
        # Apply softmax
        attn_weights = F.softmax(scores, dim=-1)
        attn_weights = self.dropout(attn_weights)
        
        # Apply attention to values
        attn_output = torch.matmul(attn_weights, V)
        # Shape: (batch, num_heads, num_queries, head_dim)
        
        # Reshape back
        attn_output = attn_output.transpose(1, 2).contiguous()
        attn_output = attn_output.view(batch_size, self.num_queries, self.config.model_dim)
        
        # Output projection
        attn_output = self.out_proj(attn_output)  # (batch, num_queries, model_dim)
        
        # Average over queries
        attn_output = attn_output.mean(dim=1)  # (batch, model_dim)
        
        # Apply sync-aware gating
        mean_sync = sync_scores.mean().unsqueeze(0).unsqueeze(0)  # (1, 1)
        gate = self.sync_gate(mean_sync)  # (1, model_dim)
        gated_output = attn_output * gate
        
        # Add residual and normalize
        output = self.layer_norm(gated_output + aggregated)
        
        # Squeeze batch dimension if needed
        if batch_size == 1:
            output = output.squeeze(0)  # (model_dim,)
        
        return output
    
    def get_attention_weights(
        self,
        aggregated: torch.Tensor
    ) -> torch.Tensor:
        """
        Get attention weights for visualization.
        
        Args:
            aggregated: Aggregated signal, shape (model_dim,)
            
        Returns:
            Attention weights: Shape (num_heads, num_queries)
        """
        if aggregated.dim() == 1:
            aggregated = aggregated.unsqueeze(0)
        
        batch_size = 1
        
        # Prepare queries and keys
        queries = self.latent_queries.unsqueeze(0)
        keys = aggregated.unsqueeze(1)
        
        # Project
        Q = self.q_proj(queries)
        K = self.k_proj(keys)
        
        # Reshape for multi-head
        Q = Q.view(batch_size, self.num_queries, self.config.num_heads, self.head_dim).transpose(1, 2)
        K = K.view(batch_size, 1, self.config.num_heads, self.head_dim).transpose(1, 2)
        
        # Compute scores
        scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.head_dim)
        attn_weights = F.softmax(scores, dim=-1)
        
        # Shape: (batch, num_heads, num_queries, 1)
        return attn_weights.squeeze(0).squeeze(-1)  # (num_heads, num_queries)


class CrossAttentionRouter(AttentionRouter):
    """
    Enhanced attention router with cross-attention between memory and current state.
    """
    
    def __init__(self, config: ComputeConfig, device: torch.device):
        super().__init__(config, device)
        
        # Additional cross-attention layers
        self.cross_q_proj = nn.Linear(config.model_dim, config.model_dim)
        self.cross_k_proj = nn.Linear(config.model_dim, config.model_dim)
        self.cross_v_proj = nn.Linear(config.model_dim, config.model_dim)
        
        # Memory fusion
        self.fusion_gate = nn.Sequential(
            nn.Linear(config.model_dim * 2, config.model_dim),
            nn.Sigmoid()
        )
        
        self.to(device)
        
    def forward_with_memory(
        self,
        aggregated: torch.Tensor,
        sync_scores: torch.Tensor,
        memory_states: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Route with cross-attention to memory states.
        
        Args:
            aggregated: Aggregated signal, shape (model_dim,)
            sync_scores: Synchronization matrix, shape (num_neurons, num_neurons)
            memory_states: Historical states, shape (history_len, model_dim) or None
            
        Returns:
            Attended output: Shape (model_dim,)
        """
        # Get base attention output
        base_output = super().forward(aggregated, sync_scores)
        
        if memory_states is None or memory_states.shape[0] == 0:
            return base_output
        
        # Cross-attention with memory
        if aggregated.dim() == 1:
            aggregated = aggregated.unsqueeze(0)
        if base_output.dim() == 1:
            base_output = base_output.unsqueeze(0)
        
        batch_size = 1
        
        # Current state as query, memory as keys/values
        Q = self.cross_q_proj(base_output.unsqueeze(1))  # (batch, 1, model_dim)
        K = self.cross_k_proj(memory_states.unsqueeze(0))  # (batch, history_len, model_dim)
        V = self.cross_v_proj(memory_states.unsqueeze(0))  # (batch, history_len, model_dim)
        
        # Reshape for multi-head
        Q = Q.view(batch_size, 1, self.config.num_heads, self.head_dim).transpose(1, 2)
        K = K.view(batch_size, -1, self.config.num_heads, self.head_dim).transpose(1, 2)
        V = V.view(batch_size, -1, self.config.num_heads, self.head_dim).transpose(1, 2)
        
        # Compute cross-attention
        scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.head_dim)
        attn_weights = F.softmax(scores, dim=-1)
        cross_output = torch.matmul(attn_weights, V)
        
        # Reshape back
        cross_output = cross_output.transpose(1, 2).contiguous()
        cross_output = cross_output.view(batch_size, 1, self.config.model_dim)
        cross_output = cross_output.squeeze(1)  # (batch, model_dim)
        
        # Fuse base and cross outputs
        fusion_input = torch.cat([base_output, cross_output], dim=-1)
        fusion_gate = self.fusion_gate(fusion_input)
        
        output = fusion_gate * base_output + (1 - fusion_gate) * cross_output
        
        if batch_size == 1:
            output = output.squeeze(0)
        
        return output