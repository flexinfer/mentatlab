# Streaming UI Mode

The Psyche Simulation now supports two UI modes:
- **Legacy UI**: The original tabbed interface (default)
- **Streaming UI**: A new single-page realtime interface with expandable sections

## Switching UI Modes

Set the `PSYCHE_UI_MODE` environment variable before starting the application:

```bash
# Use streaming UI
export PSYCHE_UI_MODE=streaming
python psyche_simulation.py

# Use legacy UI (default)
export PSYCHE_UI_MODE=legacy
python psyche_simulation.py

# Or omit the variable to use legacy by default
python psyche_simulation.py
```

## Features Comparison

### Legacy UI
- Tabbed interface with separate sections
- Traditional page-based navigation
- Established and tested functionality

### Streaming UI  
- Single-page application with expandable sections
- Optimized for real-time updates
- Modern, streamlined interface
- Better animation and visual feedback
- Improved mobile responsiveness

## Technical Details

- Both UIs share the same backend and WebSocket infrastructure
- Authentication and session management work identically
- Redis state persistence is consistent across both modes
- The UI mode is selected at startup and cannot be changed during runtime

## Development

To modify UI behavior:
- Legacy UI: Edit `ui/main_window.py`
- Streaming UI: Edit `ui/streaming_main_window.py`
- Shared components: Edit `ui/components.py` and `ui/auth_components.py`