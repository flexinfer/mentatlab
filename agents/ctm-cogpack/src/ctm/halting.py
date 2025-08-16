"""
Adaptive computation controller with certainty measures.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import deque
from typing import Optional, Tuple, List
from .config import HaltingConfig


class HaltingController:
    """
    Controls adaptive halting based on certainty measures.
    """
    
    def __init__(self, config: HaltingConfig):
        self.config = config
        self.certainty_history = deque(maxlen=config.stability_window)
        self.tick_count = 0
        
    def compute_certainty(
        self, 
        attended: torch.Tensor,
        sync_scores: torch.Tensor
    ) -> float:
        """
        Compute certainty score based on current state.
        
        Args:
            attended: Attended output, shape (model_dim,)
            sync_scores: Synchronization matrix, shape (num_neurons, num_neurons)
            
        Returns:
            Certainty score (0-1)
        """
        # Component 1: Signal energy/magnitude
        signal_energy = torch.norm(attended).item()
        normalized_energy = torch.sigmoid(torch.tensor(signal_energy / 10.0)).item()
        
        # Component 2: Synchronization strength
        # Exclude diagonal for sync strength
        mask = 1 - torch.eye(sync_scores.shape[0], device=sync_scores.device)
        masked_sync = sync_scores * mask
        sync_strength = masked_sync.mean().item()
        
        # Component 3: Signal stability (low variance)
        signal_std = attended.std().item()
        stability = 1.0 / (1.0 + signal_std)  # Higher stability for lower variance
        
        # Combine components with weights
        certainty = (
            0.4 * normalized_energy +
            0.3 * sync_strength +
            0.3 * stability
        )
        
        # Store in history
        self.certainty_history.append(certainty)
        
        return certainty
    
    def should_halt(self, current_certainty: float) -> bool:
        """
        Determine if computation should halt.
        
        Args:
            current_certainty: Current certainty score
            
        Returns:
            True if should halt, False otherwise
        """
        self.tick_count += 1
        
        # Don't halt before minimum ticks
        if self.tick_count < self.config.min_ticks:
            return False
        
        # Check if certainty exceeds threshold
        if current_certainty < self.config.certainty_threshold:
            return False
        
        # Check stability over window
        if len(self.certainty_history) < self.config.stability_window:
            return False
        
        # Check if certainty is stable
        recent_certainties = list(self.certainty_history)
        mean_certainty = sum(recent_certainties) / len(recent_certainties)
        variance = sum((c - mean_certainty) ** 2 for c in recent_certainties) / len(recent_certainties)
        
        is_stable = variance < self.config.stability_epsilon
        
        return is_stable and current_certainty >= self.config.certainty_threshold
    
    def reset(self):
        """Reset the halting controller state."""
        self.certainty_history.clear()
        self.tick_count = 0
    
    def get_stats(self) -> dict:
        """Get current halting statistics."""
        recent = list(self.certainty_history)
        return {
            "tick_count": self.tick_count,
            "current_certainty": recent[-1] if recent else 0.0,
            "mean_certainty": sum(recent) / len(recent) if recent else 0.0,
            "history_length": len(recent),
            "can_halt": self.tick_count >= self.config.min_ticks,
        }


class AdaptiveHaltingController(HaltingController):
    """
    Enhanced halting controller with learned halting criteria.
    """
    
    def __init__(self, config: HaltingConfig):
        super().__init__(config)
        
        # Learned halting predictor
        self.halt_predictor = nn.Sequential(
            nn.Linear(5, 32),  # 5 input features
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )
        
        # Adaptation rate
        self.adapt_rate = 0.05
        
    def compute_learned_certainty(
        self,
        attended: torch.Tensor,
        sync_scores: torch.Tensor,
        tick: int
    ) -> float:
        """
        Compute certainty using learned predictor.
        
        Args:
            attended: Attended output, shape (model_dim,)
            sync_scores: Synchronization matrix, shape (num_neurons, num_neurons)
            tick: Current tick number
            
        Returns:
            Learned certainty score (0-1)
        """
        # Extract features
        signal_norm = torch.norm(attended).unsqueeze(0)
        signal_mean = attended.mean().unsqueeze(0)
        signal_std = attended.std().unsqueeze(0)
        sync_mean = sync_scores.mean().unsqueeze(0)
        tick_normalized = torch.tensor([tick / self.config.min_ticks], dtype=torch.float32)
        
        # Combine features
        features = torch.cat([
            signal_norm,
            signal_mean,
            signal_std,
            sync_mean,
            tick_normalized
        ])
        
        # Predict halting probability
        with torch.no_grad():
            halt_prob = self.halt_predictor(features).item()
        
        # Combine with base certainty
        base_certainty = super().compute_certainty(attended, sync_scores)
        
        # Blend learned and base certainty
        learned_certainty = (1 - self.adapt_rate) * base_certainty + self.adapt_rate * halt_prob
        
        return learned_certainty
    
    def update_threshold(self, performance_metric: float):
        """
        Update certainty threshold based on performance.
        
        Args:
            performance_metric: Performance score (0-1, higher is better)
        """
        # Adjust threshold based on performance
        if performance_metric > 0.8:
            # Good performance, can be more conservative
            self.config.certainty_threshold = min(0.95, self.config.certainty_threshold + 0.01)
        elif performance_metric < 0.5:
            # Poor performance, be less conservative
            self.config.certainty_threshold = max(0.7, self.config.certainty_threshold - 0.01)
    
    def get_halting_distribution(self, num_ticks: int) -> List[float]:
        """
        Get probability distribution over halting points.
        
        Args:
            num_ticks: Number of ticks to consider
            
        Returns:
            List of halting probabilities for each tick
        """
        if len(self.certainty_history) == 0:
            return [0.0] * num_ticks
        
        # Use softmax over certainty history
        certainties = list(self.certainty_history)
        if len(certainties) < num_ticks:
            certainties.extend([0.0] * (num_ticks - len(certainties)))
        
        certainties = certainties[:num_ticks]
        certainty_tensor = torch.tensor(certainties)
        
        # Apply temperature-scaled softmax
        temperature = 2.0
        probs = F.softmax(certainty_tensor / temperature, dim=0)
        
        return probs.tolist()