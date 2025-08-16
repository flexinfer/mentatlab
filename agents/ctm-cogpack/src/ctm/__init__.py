"""
CTM (Continuous Thought Machine) modules for the Cogpack.
"""

from .config import (
    CTMConfig,
    TickConfig,
    ComputeConfig,
    HaltingConfig,
    TelemetryConfig,
    load_config_from_env
)
from .timekeeper import TimeKeeper
from .memory import SlidingMemory
from .neuron import NeuronPool, NeuronMLP, Oscillator
from .synapse import SynapseAggregator, AdaptiveSynapseAggregator
from .sync import SynchronizationMatrix, AdaptiveSynchronization
from .attention import AttentionRouter, CrossAttentionRouter
from .halting import HaltingController, AdaptiveHaltingController
from .telemetry import TelemetryBus, TelemetryEvent, EventAggregator

__all__ = [
    # Config
    'CTMConfig',
    'TickConfig',
    'ComputeConfig',
    'HaltingConfig',
    'TelemetryConfig',
    'load_config_from_env',
    # Core modules
    'TimeKeeper',
    'SlidingMemory',
    'NeuronPool',
    'NeuronMLP',
    'Oscillator',
    'SynapseAggregator',
    'AdaptiveSynapseAggregator',
    'SynchronizationMatrix',
    'AdaptiveSynchronization',
    'AttentionRouter',
    'CrossAttentionRouter',
    'HaltingController',
    'AdaptiveHaltingController',
    'TelemetryBus',
    'TelemetryEvent',
    'EventAggregator',
]