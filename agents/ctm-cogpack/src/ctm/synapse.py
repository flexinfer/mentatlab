"""
Synapse aggregator for combining neuron signals.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Optional
from .config import ComputeConfig


class SynapseAggregator(nn.Module):
    """
    Aggregates signals from multiple neurons using learned weights.
    """
    
    def __init__(self, config: ComputeConfig):
        super().__init__()
        self.config = config
        
        # Learnable aggregation weights
        self.aggregation_weights = nn.Parameter(
            torch.randn(config.num_neurons) / math.sqrt(config.num_neurons)
        )
        
        # Projection layers
        self.pre_proj = nn.Linear(config.model_dim, config.model_dim)
        self.post_proj = nn.Linear(config.model_dim, config.model_dim)
        
        # Normalization
        self.layer_norm = nn.LayerNorm(config.model_dim)
        
        # Gating mechanism
        self.gate = nn.Sequential(
            nn.Linear(config.model_dim * 2, config.model_dim),
            nn.Sigmoid()
        )
        
    def forward(self, neuron_outputs: torch.Tensor) -> torch.Tensor:
        """
        Aggregate neuron outputs into a single signal.
        
        Args:
            neuron_outputs: Shape (num_neurons, model_dim)
            
        Returns:
            Aggregated signal: Shape (model_dim,)
        """
        # Project neuron outputs
        projected = self.pre_proj(neuron_outputs)  # (num_neurons, model_dim)
        
        # Apply softmax to aggregation weights for normalized combination
        weights = F.softmax(self.aggregation_weights, dim=0)  # (num_neurons,)
        
        # Weighted aggregation
        weighted = projected * weights.unsqueeze(-1)  # (num_neurons, model_dim)
        aggregated = weighted.sum(dim=0)  # (model_dim,)
        
        # Compute gating signal
        mean_signal = projected.mean(dim=0)  # (model_dim,)
        gate_input = torch.cat([aggregated, mean_signal], dim=-1)  # (model_dim * 2,)
        gate_value = self.gate(gate_input)  # (model_dim,)
        
        # Apply gating
        gated = aggregated * gate_value
        
        # Final projection and normalization
        output = self.post_proj(gated)
        output = self.layer_norm(output)
        
        return output
    
    def get_weight_distribution(self) -> torch.Tensor:
        """Get the current weight distribution for analysis."""
        return F.softmax(self.aggregation_weights, dim=0)


class AdaptiveSynapseAggregator(SynapseAggregator):
    """
    Enhanced synapse aggregator with adaptive weighting based on signal strength.
    """
    
    def __init__(self, config: ComputeConfig):
        super().__init__(config)
        
        # Additional adaptive components
        self.strength_estimator = nn.Sequential(
            nn.Linear(config.model_dim, config.hidden_dim),
            nn.ReLU(),
            nn.Linear(config.hidden_dim, 1)
        )
        
        self.adaptation_rate = 0.1
        
    def forward(self, neuron_outputs: torch.Tensor) -> torch.Tensor:
        """
        Aggregate with adaptive weighting based on signal strength.
        
        Args:
            neuron_outputs: Shape (num_neurons, model_dim)
            
        Returns:
            Aggregated signal: Shape (model_dim,)
        """
        # Estimate signal strength for each neuron
        strengths = self.strength_estimator(neuron_outputs).squeeze(-1)  # (num_neurons,)
        
        # Combine learned weights with adaptive strengths
        base_weights = F.softmax(self.aggregation_weights, dim=0)
        adaptive_weights = F.softmax(strengths, dim=0)
        
        # Blend weights
        final_weights = (1 - self.adaptation_rate) * base_weights + self.adaptation_rate * adaptive_weights
        
        # Project neuron outputs
        projected = self.pre_proj(neuron_outputs)  # (num_neurons, model_dim)
        
        # Weighted aggregation
        weighted = projected * final_weights.unsqueeze(-1)  # (num_neurons, model_dim)
        aggregated = weighted.sum(dim=0)  # (model_dim,)
        
        # Compute gating signal
        mean_signal = projected.mean(dim=0)  # (model_dim,)
        gate_input = torch.cat([aggregated, mean_signal], dim=-1)  # (model_dim * 2,)
        gate_value = self.gate(gate_input)  # (model_dim,)
        
        # Apply gating
        gated = aggregated * gate_value
        
        # Final projection and normalization
        output = self.post_proj(gated)
        output = self.layer_norm(output)
        
        return output
        
    def get_adaptive_weights(self, neuron_outputs: torch.Tensor) -> torch.Tensor:
        """Get the adaptive weights for the current neuron outputs."""
        strengths = self.strength_estimator(neuron_outputs).squeeze(-1)
        base_weights = F.softmax(self.aggregation_weights, dim=0)
        adaptive_weights = F.softmax(strengths, dim=0)
        return (1 - self.adaptation_rate) * base_weights + self.adaptation_rate * adaptive_weights