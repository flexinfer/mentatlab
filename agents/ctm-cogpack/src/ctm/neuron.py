"""
Neuron pool with individual MLPs and oscillators.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Optional, List, Tuple
from .config import ComputeConfig


class NeuronMLP(nn.Module):
    """
    Individual MLP for a single neuron.
    """
    
    def __init__(self, input_dim: int, hidden_dim: int, output_dim: int, dropout: float = 0.1):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, hidden_dim)
        self.fc3 = nn.Linear(hidden_dim, output_dim)
        self.dropout = nn.Dropout(dropout)
        self.layer_norm = nn.LayerNorm(output_dim)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.gelu(self.fc1(x))
        x = self.dropout(x)
        x = F.gelu(self.fc2(x))
        x = self.dropout(x)
        x = self.fc3(x)
        x = self.layer_norm(x)
        return x


class Oscillator:
    """
    Oscillation dynamics for a neuron.
    """
    
    def __init__(self, frequency: float, phase: float = 0.0):
        self.frequency = frequency  # in Hz
        self.phase = phase  # in radians
        self.amplitude = 1.0
        
    def get_value(self, tick: int, tick_interval: float = 0.1) -> float:
        """Get oscillation value at given tick."""
        time = tick * tick_interval
        return self.amplitude * math.sin(2 * math.pi * self.frequency * time + self.phase)
        
    def modulate(self, signal: torch.Tensor, tick: int, tick_interval: float = 0.1) -> torch.Tensor:
        """Modulate signal with oscillation."""
        osc_value = self.get_value(tick, tick_interval)
        # Apply soft modulation (0.5 to 1.5 range)
        modulation = 1.0 + 0.5 * osc_value
        return signal * modulation


class NeuronPool(nn.Module):
    """
    Pool of neurons with individual MLPs and oscillation dynamics.
    """
    
    def __init__(self, config: ComputeConfig, device: torch.device):
        super().__init__()
        self.config = config
        self.device = device
        
        # Create individual MLPs for each neuron
        self.neurons = nn.ModuleList([
            NeuronMLP(
                input_dim=config.model_dim + config.history_len * config.model_dim,
                hidden_dim=config.hidden_dim,
                output_dim=config.model_dim,
                dropout=config.dropout
            )
            for _ in range(config.num_neurons)
        ])
        
        # Create oscillators with distributed frequencies
        freq_min, freq_max = config.oscillation_freq_range
        self.oscillators = []
        for i in range(config.num_neurons):
            # Distribute frequencies logarithmically
            freq_ratio = i / max(1, config.num_neurons - 1)
            freq = freq_min * (freq_max / freq_min) ** freq_ratio
            # Random phase offset
            phase = (i * 2.3571) % (2 * math.pi)  # Deterministic "random" phase
            self.oscillators.append(Oscillator(freq, phase))
        
        # Input projection
        self.input_proj = nn.Linear(config.model_dim, config.model_dim)
        
        # Move to device
        self.to(device)
        
    def forward(
        self, 
        input_embedding: torch.Tensor,
        pre_activations: Optional[torch.Tensor],
        tick: int
    ) -> torch.Tensor:
        """
        Process input through neuron pool.
        
        Args:
            input_embedding: Shape (batch, model_dim)
            pre_activations: Shape (history_len, model_dim) or None
            tick: Current tick number
            
        Returns:
            Neuron outputs: Shape (num_neurons, model_dim)
        """
        batch_size = input_embedding.shape[0]
        
        # Project input
        input_proj = self.input_proj(input_embedding)  # (batch, model_dim)
        
        # Prepare history context
        if pre_activations is not None:
            # Flatten history
            history_flat = pre_activations.flatten()  # (history_len * model_dim,)
            # Expand for batch
            history_flat = history_flat.unsqueeze(0).expand(batch_size, -1)
        else:
            # Use zeros if no history
            history_flat = torch.zeros(
                batch_size, 
                self.config.history_len * self.config.model_dim,
                device=self.device
            )
        
        # Concatenate input and history
        neuron_input = torch.cat([input_proj, history_flat], dim=-1)  # (batch, input_dim)
        
        # Process through each neuron
        outputs = []
        for i, (neuron, oscillator) in enumerate(zip(self.neurons, self.oscillators)):
            # Forward through MLP
            neuron_out = neuron(neuron_input)  # (batch, model_dim)
            
            # Apply oscillation modulation
            neuron_out = oscillator.modulate(neuron_out, tick)
            
            outputs.append(neuron_out)
        
        # Stack outputs
        outputs = torch.stack(outputs, dim=1)  # (batch, num_neurons, model_dim)
        
        # For simplicity, squeeze batch dimension if batch_size == 1
        if batch_size == 1:
            outputs = outputs.squeeze(0)  # (num_neurons, model_dim)
            
        return outputs
    
    def get_neuron_states(self) -> List[dict]:
        """Get current state information for each neuron."""
        states = []
        for i, oscillator in enumerate(self.oscillators):
            states.append({
                "neuron_id": i,
                "frequency": oscillator.frequency,
                "phase": oscillator.phase,
                "amplitude": oscillator.amplitude,
            })
        return states