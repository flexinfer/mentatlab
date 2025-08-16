"""
Configuration dataclasses for CTM components.
"""
from dataclasses import dataclass, asdict
from typing import Optional
import os


@dataclass
class TickConfig:
    """Configuration for tick-based temporal processing."""
    tick_interval: float = 0.1  # Seconds between ticks
    max_ticks: int = 48  # Maximum ticks before forced halt
    time_encoding_dim: int = 16  # Dimension of temporal encoding


@dataclass
class ComputeConfig:
    """Configuration for neural computation."""
    num_neurons: int = 128  # Number of neurons in the pool
    model_dim: int = 64  # Base model dimension
    hidden_dim: int = 256  # Hidden dimension for MLPs
    num_heads: int = 8  # Number of attention heads
    history_len: int = 32  # Length of sliding window memory
    dropout: float = 0.1  # Dropout rate
    oscillation_freq_range: tuple = (0.1, 10.0)  # Hz range for neuron oscillations


@dataclass
class HaltingConfig:
    """Configuration for adaptive computation halting."""
    certainty_threshold: float = 0.92  # Threshold for halting
    min_ticks: int = 5  # Minimum ticks before halting allowed
    stability_window: int = 3  # Ticks to check for stability
    stability_epsilon: float = 0.01  # Epsilon for stability check


@dataclass
class TelemetryConfig:
    """Configuration for telemetry and event streaming."""
    enabled: bool = True
    event_sample_rate: float = 0.3  # Probability of emitting detailed events
    neuron_sample_size: int = 5  # Number of neurons to sample for events
    emit_sync_events: bool = True
    emit_attention_events: bool = True


@dataclass
class CTMConfig:
    """Main CTM configuration."""
    tick: TickConfig
    compute: ComputeConfig
    halting: HaltingConfig
    telemetry: TelemetryConfig
    
    def to_dict(self) -> dict:
        """Convert config to dictionary."""
        return {
            "tick": asdict(self.tick),
            "compute": asdict(self.compute),
            "halting": asdict(self.halting),
            "telemetry": asdict(self.telemetry),
        }


def load_config_from_env() -> CTMConfig:
    """Load configuration from environment variables."""
    
    def get_env_int(key: str, default: int) -> int:
        try:
            return int(os.environ.get(key, str(default)))
        except ValueError:
            return default
    
    def get_env_float(key: str, default: float) -> float:
        try:
            return float(os.environ.get(key, str(default)))
        except ValueError:
            return default
    
    def get_env_bool(key: str, default: bool) -> bool:
        val = os.environ.get(key, str(default)).lower()
        return val in ("true", "1", "yes", "on")
    
    # Load tick config
    tick = TickConfig(
        tick_interval=get_env_float("CTM_TICK_INTERVAL", 0.1),
        max_ticks=get_env_int("CTM_MAX_TICKS", 48),
        time_encoding_dim=get_env_int("CTM_TIME_ENCODING_DIM", 16),
    )
    
    # Load compute config
    compute = ComputeConfig(
        num_neurons=get_env_int("CTM_NEURONS", 128),
        model_dim=get_env_int("CTM_MODEL_DIM", 64),
        hidden_dim=get_env_int("CTM_HIDDEN_DIM", 256),
        num_heads=get_env_int("CTM_NUM_HEADS", 8),
        history_len=get_env_int("CTM_HISTORY_LEN", 32),
        dropout=get_env_float("CTM_DROPOUT", 0.1),
    )
    
    # Load halting config
    halting = HaltingConfig(
        certainty_threshold=get_env_float("CTM_CERTAINTY_THRESHOLD", 0.92),
        min_ticks=get_env_int("CTM_MIN_TICKS", 5),
        stability_window=get_env_int("CTM_STABILITY_WINDOW", 3),
        stability_epsilon=get_env_float("CTM_STABILITY_EPSILON", 0.01),
    )
    
    # Load telemetry config
    telemetry = TelemetryConfig(
        enabled=get_env_bool("CTM_TELEMETRY_ENABLED", True),
        event_sample_rate=get_env_float("CTM_EVENT_SAMPLE_RATE", 0.3),
        neuron_sample_size=get_env_int("CTM_NEURON_SAMPLE_SIZE", 5),
        emit_sync_events=get_env_bool("CTM_EMIT_SYNC_EVENTS", True),
        emit_attention_events=get_env_bool("CTM_EMIT_ATTENTION_EVENTS", True),
    )
    
    return CTMConfig(
        tick=tick,
        compute=compute,
        halting=halting,
        telemetry=telemetry,
    )