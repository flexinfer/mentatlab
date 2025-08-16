"""
Synchronization matrix for computing pairwise neuron synchronization.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Tuple
from .config import ComputeConfig


class SynchronizationMatrix(nn.Module):
    """
    Computes pairwise synchronization scores between neurons.
    """
    
    def __init__(self, config: ComputeConfig):
        super().__init__()
        self.config = config
        
        # Learnable synchronization kernel
        self.sync_kernel = nn.Parameter(
            torch.randn(config.model_dim, config.model_dim) / config.model_dim
        )
        
        # Temporal smoothing
        self.temporal_weight = 0.7  # Weight for current vs. history
        self.sync_history = None
        
        # Threshold for synchronization detection
        self.sync_threshold = 0.5
        
    def forward(self, neuron_outputs: torch.Tensor) -> torch.Tensor:
        """
        Compute synchronization matrix for neuron outputs.
        
        Args:
            neuron_outputs: Shape (num_neurons, model_dim)
            
        Returns:
            Synchronization matrix: Shape (num_neurons, num_neurons)
        """
        num_neurons = neuron_outputs.shape[0]
        
        # Normalize neuron outputs
        normalized = F.normalize(neuron_outputs, p=2, dim=-1)  # (num_neurons, model_dim)
        
        # Transform through sync kernel
        transformed = normalized @ self.sync_kernel  # (num_neurons, model_dim)
        
        # Compute pairwise similarities
        sync_matrix = transformed @ normalized.T  # (num_neurons, num_neurons)
        
        # Apply sigmoid for bounded scores
        sync_matrix = torch.sigmoid(sync_matrix)
        
        # Temporal smoothing
        if self.sync_history is not None:
            sync_matrix = self.temporal_weight * sync_matrix + (1 - self.temporal_weight) * self.sync_history
        
        # Update history
        self.sync_history = sync_matrix.detach()
        
        # Ensure symmetry
        sync_matrix = (sync_matrix + sync_matrix.T) / 2
        
        return sync_matrix
    
    def get_clusters(self, sync_matrix: torch.Tensor) -> Tuple[torch.Tensor, int]:
        """
        Identify synchronized clusters of neurons.
        
        Args:
            sync_matrix: Shape (num_neurons, num_neurons)
            
        Returns:
            Cluster assignments and number of clusters
        """
        num_neurons = sync_matrix.shape[0]
        
        # Threshold the matrix
        adjacency = (sync_matrix > self.sync_threshold).float()
        
        # Simple connected components algorithm
        clusters = torch.zeros(num_neurons, dtype=torch.long)
        cluster_id = 0
        visited = torch.zeros(num_neurons, dtype=torch.bool)
        
        for i in range(num_neurons):
            if not visited[i]:
                # BFS to find connected component
                queue = [i]
                visited[i] = True
                clusters[i] = cluster_id
                
                while queue:
                    node = queue.pop(0)
                    neighbors = torch.where(adjacency[node] > 0)[0]
                    
                    for neighbor in neighbors:
                        if not visited[neighbor]:
                            visited[neighbor] = True
                            clusters[neighbor] = cluster_id
                            queue.append(neighbor.item())
                
                cluster_id += 1
        
        return clusters, cluster_id
    
    def get_sync_strength(self, sync_matrix: torch.Tensor) -> float:
        """
        Compute overall synchronization strength.
        
        Args:
            sync_matrix: Shape (num_neurons, num_neurons)
            
        Returns:
            Mean synchronization strength (0-1)
        """
        # Exclude diagonal (self-synchronization)
        mask = 1 - torch.eye(sync_matrix.shape[0], device=sync_matrix.device)
        masked_sync = sync_matrix * mask
        
        # Compute mean synchronization
        num_pairs = mask.sum()
        if num_pairs > 0:
            return (masked_sync.sum() / num_pairs).item()
        return 0.0
    
    def reset_history(self):
        """Reset the synchronization history."""
        self.sync_history = None


class AdaptiveSynchronization(SynchronizationMatrix):
    """
    Enhanced synchronization with adaptive thresholds and learning.
    """
    
    def __init__(self, config: ComputeConfig):
        super().__init__(config)
        
        # Adaptive threshold network
        self.threshold_net = nn.Sequential(
            nn.Linear(config.num_neurons * 2, config.hidden_dim),
            nn.ReLU(),
            nn.Linear(config.hidden_dim, 1),
            nn.Sigmoid()
        )
        
        # Learning rate for threshold adaptation
        self.adapt_rate = 0.01
        
    def forward(self, neuron_outputs: torch.Tensor) -> torch.Tensor:
        """
        Compute synchronization with adaptive thresholds.
        
        Args:
            neuron_outputs: Shape (num_neurons, model_dim)
            
        Returns:
            Synchronization matrix: Shape (num_neurons, num_neurons)
        """
        # Get base synchronization matrix
        sync_matrix = super().forward(neuron_outputs)
        
        # Compute adaptive threshold based on current state
        state_features = torch.cat([
            neuron_outputs.mean(dim=-1),  # Mean activation per neuron
            neuron_outputs.std(dim=-1)    # Std activation per neuron
        ])
        
        adaptive_threshold = self.threshold_net(state_features).item()
        
        # Update threshold with momentum
        self.sync_threshold = (1 - self.adapt_rate) * self.sync_threshold + self.adapt_rate * adaptive_threshold
        
        return sync_matrix
    
    def compute_phase_coherence(self, neuron_outputs: torch.Tensor, tick: int) -> torch.Tensor:
        """
        Compute phase coherence between neurons based on oscillation patterns.
        
        Args:
            neuron_outputs: Shape (num_neurons, model_dim)
            tick: Current tick number
            
        Returns:
            Phase coherence matrix: Shape (num_neurons, num_neurons)
        """
        num_neurons = neuron_outputs.shape[0]
        
        # Estimate instantaneous phase from neuron outputs
        # Using Hilbert transform approximation
        phases = torch.angle(torch.fft.fft(neuron_outputs, dim=-1))
        mean_phases = phases.mean(dim=-1)  # (num_neurons,)
        
        # Compute pairwise phase differences
        phase_diff = mean_phases.unsqueeze(0) - mean_phases.unsqueeze(1)  # (num_neurons, num_neurons)
        
        # Phase coherence (1 - normalized phase difference)
        coherence = (1 + torch.cos(phase_diff)) / 2
        
        return coherence