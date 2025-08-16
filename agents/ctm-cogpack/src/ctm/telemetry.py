"""
Event streaming and telemetry bus for CTM.
"""
import time
import uuid
import json
from typing import Dict, Any, Optional, List
from collections import deque
from dataclasses import dataclass, asdict
from .config import TelemetryConfig


@dataclass
class TelemetryEvent:
    """Base telemetry event."""
    event_id: str
    event_type: str
    timestamp: float
    tick: int
    data: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary."""
        return asdict(self)
    
    def to_json(self) -> str:
        """Convert event to JSON string."""
        return json.dumps(self.to_dict(), separators=(',', ':'))


class TelemetryBus:
    """
    Manages telemetry events and streaming.
    """
    
    def __init__(self, config: TelemetryConfig):
        self.config = config
        self.events = deque(maxlen=1000)  # Keep last 1000 events
        self.event_counts = {}
        self.start_time = time.time()
        
    def emit(
        self,
        event_type: str,
        tick: int,
        data: Dict[str, Any],
        force: bool = False
    ) -> Optional[TelemetryEvent]:
        """
        Emit a telemetry event.
        
        Args:
            event_type: Type of event
            tick: Current tick number
            data: Event data
            force: Force emission regardless of sampling
            
        Returns:
            TelemetryEvent if emitted, None otherwise
        """
        if not self.config.enabled and not force:
            return None
        
        # Check sampling rate
        import random
        if not force and random.random() > self.config.event_sample_rate:
            return None
        
        # Check event-specific filters
        if event_type == "ctm.sync.update" and not self.config.emit_sync_events:
            return None
        if event_type == "ctm.attn.route" and not self.config.emit_attention_events:
            return None
        
        # Create event
        event = TelemetryEvent(
            event_id=str(uuid.uuid4()),
            event_type=event_type,
            timestamp=time.time(),
            tick=tick,
            data=data
        )
        
        # Store event
        self.events.append(event)
        
        # Update counts
        self.event_counts[event_type] = self.event_counts.get(event_type, 0) + 1
        
        return event
    
    def get_recent_events(self, n: int = 10) -> List[TelemetryEvent]:
        """Get n most recent events."""
        return list(self.events)[-n:]
    
    def get_events_by_type(self, event_type: str) -> List[TelemetryEvent]:
        """Get all events of a specific type."""
        return [e for e in self.events if e.event_type == event_type]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get telemetry statistics."""
        elapsed = time.time() - self.start_time
        total_events = sum(self.event_counts.values())
        
        return {
            "elapsed_time": elapsed,
            "total_events": total_events,
            "events_per_second": total_events / elapsed if elapsed > 0 else 0,
            "event_counts": self.event_counts.copy(),
            "buffer_size": len(self.events),
        }
    
    def clear(self):
        """Clear event history."""
        self.events.clear()
        self.event_counts.clear()
        self.start_time = time.time()
    
    def format_for_streaming(
        self,
        event: TelemetryEvent,
        agent_id: str,
        stream_id: str,
        sequence: int
    ) -> Dict[str, Any]:
        """
        Format event for NDJSON streaming output.
        
        Args:
            event: Telemetry event
            agent_id: Agent identifier
            stream_id: Stream identifier
            sequence: Sequence number
            
        Returns:
            Formatted event dictionary
        """
        return {
            "id": event.event_id,
            "type": event.event_type,
            "timestamp": self._format_timestamp(event.timestamp),
            "agent_id": agent_id,
            "stream_id": stream_id,
            "data": event.data,
            "sequence": sequence
        }
    
    def _format_timestamp(self, timestamp: float) -> str:
        """Format timestamp as ISO string."""
        import datetime
        dt = datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc)
        return dt.isoformat().replace('+00:00', 'Z')


class EventAggregator:
    """
    Aggregates events for batch processing and analysis.
    """
    
    def __init__(self):
        self.tick_events = {}  # Events grouped by tick
        self.neuron_events = {}  # Events grouped by neuron ID
        self.event_sequences = {}  # Event sequences by type
        
    def add_event(self, event: TelemetryEvent):
        """Add event to aggregator."""
        # Group by tick
        tick = event.tick
        if tick not in self.tick_events:
            self.tick_events[tick] = []
        self.tick_events[tick].append(event)
        
        # Group by neuron if applicable
        if "neuron_id" in event.data:
            neuron_id = event.data["neuron_id"]
            if neuron_id not in self.neuron_events:
                self.neuron_events[neuron_id] = []
            self.neuron_events[neuron_id].append(event)
        
        # Track sequences
        event_type = event.event_type
        if event_type not in self.event_sequences:
            self.event_sequences[event_type] = []
        self.event_sequences[event_type].append(event)
    
    def get_tick_summary(self, tick: int) -> Dict[str, Any]:
        """Get summary of events for a specific tick."""
        if tick not in self.tick_events:
            return {"tick": tick, "event_count": 0, "events": []}
        
        events = self.tick_events[tick]
        return {
            "tick": tick,
            "event_count": len(events),
            "event_types": list(set(e.event_type for e in events)),
            "events": [e.to_dict() for e in events]
        }
    
    def get_neuron_activity(self, neuron_id: int) -> List[Dict[str, Any]]:
        """Get activity history for a specific neuron."""
        if neuron_id not in self.neuron_events:
            return []
        
        return [e.to_dict() for e in self.neuron_events[neuron_id]]
    
    def get_event_timeline(self, event_type: str) -> List[Dict[str, Any]]:
        """Get timeline of events of a specific type."""
        if event_type not in self.event_sequences:
            return []
        
        return [
            {
                "tick": e.tick,
                "timestamp": e.timestamp,
                "data": e.data
            }
            for e in self.event_sequences[event_type]
        ]
    
    def clear(self):
        """Clear all aggregated data."""
        self.tick_events.clear()
        self.neuron_events.clear()
        self.event_sequences.clear()