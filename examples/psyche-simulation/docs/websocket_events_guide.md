# WebSocket Events Guide

This guide provides comprehensive documentation for the WebSocket event system in the Psyche Simulation project.

## Overview

The WebSocket event system enables real-time communication between the simulation backend and frontend UI components. It provides structured events for agent messages, network updates, and system status monitoring.

### Key Features

- **Type-safe event schemas** using Python TypedDict
- **Thread-safe event broadcasting** with queue management
- **Redis pub/sub integration** for distributed scalability
- **Automatic event serialization** to JSON
- **Built-in performance monitoring** and metrics collection
- **Seamless NiceGUI integration** for UI updates

## Architecture

### Event Types

The system supports three main event types:

1. **Agent Message Events** (`agent_message`)
   - Broadcasts when agents send messages
   - Includes sentiment analysis data
   - Contains agent metadata and interaction history

2. **Network Update Events** (`network_update`)
   - Broadcasts on network topology changes
   - Includes connection strength and statistics
   - Supports emergency mode notifications

3. **System Status Events** (`system_status`)
   - Broadcasts system health metrics
   - Includes performance data (CPU, memory)
   - Tracks active agents and error counts

### Components

#### WebSocketEventManager

The central manager handles:
- Event queue management
- Thread-safe broadcasting
- Listener registration
- Redis pub/sub integration

```python
from utils.websocket_events import WebSocketEventManager

# Create manager with Redis support
manager = WebSocketEventManager(enable_redis=True)

# Add a listener
def handle_event(event):
    print(f"Received: {event.event_type}")

listener_id = manager.add_listener(handle_event)

# Remove listener when done
manager.remove_listener(listener_id)
```

#### WebSocketBroadcaster

Integrates with NiceGUI for UI updates:

```python
from utils.websocket_broadcaster import WebSocketBroadcaster

# Initialize with NiceGUI app
broadcaster = WebSocketBroadcaster(app)

# Connect UI clients
await broadcaster.connect_client(client)

# Disconnect on cleanup
await broadcaster.disconnect_client(client_id)
```

## Usage Examples

### Broadcasting Agent Messages

```python
from utils.websocket_events import broadcast_agent_message

# When an agent sends a message
broadcast_agent_message(
    agent_id="agent_1",
    agent_type="CognitivePsychologist",
    message="I believe we should explore...",
    sentiment_data={
        'score': 0.75,
        'label': 'positive'
    },
    metadata={
        'interaction_count': 5,
        'has_memory': True
    }
)
```

### Broadcasting Network Updates

```python
from utils.websocket_events import broadcast_network_update

# When network topology changes
connections = [
    {
        'from': 'agent_1',
        'to': 'agent_2',
        'strength': 0.8,
        'is_active': True,
        'type': 'normal'
    }
]

broadcast_network_update(
    connections=connections,
    communication_stats={
        'agent_1': {'sent': 10, 'received': 5},
        'agent_2': {'sent': 5, 'received': 10}
    },
    event_type='message_sent',
    details={
        'queue_size': 3,
        'sentiment': 0.6
    }
)
```

### Broadcasting System Status

```python
from utils.websocket_events import broadcast_system_status, SystemHealthStatus

# Regular health updates
broadcast_system_status(
    health_status=SystemHealthStatus.HEALTHY,
    performance_metrics={
        'cpu_percent': 45.2,
        'memory_percent': 62.1,
        'thread_count': 12,
        'open_files': 156
    },
    active_agents=5,
    error_count=0,
    metadata={
        'node': 'simulation-1',
        'uptime': 3600
    }
)
```

## Integration with Simulation Components

### Agent Integration

Agents automatically broadcast messages when using the base class:

```python
from agents.base import BaseAgent

class MyAgent(BaseAgent):
    def respond(self, situation, other_agents_output):
        # Response is automatically broadcasted via WebSocket
        return super().respond(situation, other_agents_output)
```

### Network Integration

The AgentNetwork class broadcasts updates on:
- Message sending
- Emergency mode activation/deactivation
- Connection strength changes

```python
from simulation.network import AgentNetwork

network = AgentNetwork()

# Messages are automatically broadcasted
network.send_message("agent_1", "agent_2", "Hello!")

# Emergency mode changes trigger broadcasts
network.update_conversation_state({'stagnation': 0.8})
```

### Performance Monitoring Integration

```python
from utils.websocket_integration import integrate_performance_monitor
from utils.performance_monitor import PerformanceMonitor

monitor = PerformanceMonitor()

# Start monitoring with WebSocket integration
integrate_performance_monitor(monitor, update_interval=5)
```

## Event Schemas

### Agent Message Event

```typescript
interface AgentMessageEvent {
    event_type: "agent_message";
    timestamp: string;  // ISO 8601
    data: {
        agent_id: string;
        agent_type: string;
        message: string;
        sentiment: {
            score: number;  // -1.0 to 1.0
            label: "positive" | "negative" | "neutral";
        };
        metadata: Record<string, any>;
    };
}
```

### Network Update Event

```typescript
interface NetworkUpdateEvent {
    event_type: "network_update";
    timestamp: string;  // ISO 8601
    data: {
        connections: Array<{
            from: string;
            to: string;
            strength: number;  // 0.0 to 1.0
            is_active: boolean;
            type: "normal" | "emergency";
        }>;
        communication_stats: Record<string, {
            sent: number;
            received: number;
        }>;
        event_type: string;
        details?: Record<string, any>;
    };
}
```

### System Status Event

```typescript
interface SystemStatusEvent {
    event_type: "system_status";
    timestamp: string;  // ISO 8601
    data: {
        health_status: "healthy" | "warning" | "error";
        performance_metrics: {
            cpu_percent: number;
            memory_percent: number;
            [key: string]: number;
        };
        active_agents: number;
        error_count: number;
        metadata: Record<string, any>;
    };
}
```

## Redis Integration

For distributed deployments, enable Redis pub/sub:

```python
# In your configuration
WEBSOCKET_CONFIG = {
    'enable_redis': True,
    'redis_channel': 'websocket_events'
}

# Events are automatically published to Redis
# Other instances will receive and broadcast to their connected clients
```

## Frontend Integration (NiceGUI)

```python
from nicegui import ui
from utils.websocket_broadcaster import WebSocketBroadcaster

app = ui.app

# Initialize broadcaster
broadcaster = WebSocketBroadcaster(app)

# In your UI components
@ui.page('/')
async def index():
    # UI elements that update on WebSocket events
    agent_messages = ui.column()
    network_graph = ui.element('div')
    
    # Events automatically update connected UI elements
```

## Performance Considerations

1. **Event Throttling**: High-frequency events (like system status) should be throttled
2. **Queue Management**: The event queue has a maximum size to prevent memory issues
3. **Thread Safety**: All broadcasting operations are thread-safe
4. **JSON Serialization**: Large data structures may impact performance

## Testing

Run the comprehensive test suite:

```bash
python -m pytest tests/test_websocket_events.py -v
```

Key test areas:
- Event creation and serialization
- Thread-safe broadcasting
- Redis integration
- Error handling
- Performance under load

## Troubleshooting

### Common Issues

1. **Events not being received**
   - Check that listeners are properly registered
   - Verify Redis connection if using pub/sub
   - Ensure event manager is running

2. **Performance degradation**
   - Monitor event queue size
   - Check for memory leaks in listeners
   - Review event frequency and size

3. **Serialization errors**
   - Ensure all event data is JSON-serializable
   - Check for circular references
   - Validate timestamp formats

### Debug Mode

Enable debug logging:

```python
import logging

logging.getLogger('websocket_events').setLevel(logging.DEBUG)
```

## Best Practices

1. **Event Design**
   - Keep events focused and single-purpose
   - Include only necessary data
   - Use consistent naming conventions

2. **Error Handling**
   - Always handle exceptions in listeners
   - Use try-except blocks for broadcasts
   - Log errors for debugging

3. **Performance**
   - Throttle high-frequency events
   - Batch updates when possible
   - Monitor queue sizes

4. **Security**
   - Validate event data before broadcasting
   - Sanitize user-generated content
   - Use authentication for WebSocket connections

## Future Enhancements

Planned improvements:
- Event replay functionality
- Persistent event storage
- Advanced filtering and routing
- WebSocket compression
- Event analytics dashboard

## API Reference

See the inline documentation in:
- `utils/websocket_events.py` - Core event system
- `utils/websocket_broadcaster.py` - NiceGUI integration
- `utils/websocket_integration.py` - Component integrations

For additional support, please refer to the project documentation or open an issue on the repository.