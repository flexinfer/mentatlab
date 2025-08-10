# Real-Time UI Updates Integration Guide

## Overview
This guide shows how to integrate the real-time streaming features into UI components.

## Using Real-Time Updates in UI Components

### 1. Setting Up the UI Updater

```python
from utils.websocket_broadcaster import RealtimeUIUpdater, get_broadcaster

# In your UI setup
def setup_realtime_ui():
    # Get broadcaster instance
    broadcaster = get_broadcaster()
    
    # Create UI updater
    ui_updater = RealtimeUIUpdater(broadcaster)
    
    # Register UI elements
    with ui.column() as conversation_area:
        conversation_display = ui.column().classes('conversation-container overflow-y-auto h-96')
        ui_updater.register_element('conversation_display', conversation_display)
        
        status_label = ui.label('System Ready').classes('status-indicator')
        ui_updater.register_element('agent_status', status_label)
        
        message_counter = ui.label('Messages: 0')
        ui_updater.register_element('message_counter', message_counter)
    
    return ui_updater
```

### 2. Real-Time Features in Action

When an agent processes a message, the UI will automatically show:

#### A. Thinking Indicator (Immediate)
```
[Agent Icon] TestAgent is thinking...
[Spinning refresh icon]
```

#### B. Streaming Text (Progressive)
```
[Agent Icon] TestAgent is thinking...
Once upon a time, there was a robot named... [text appears word by word]
```

#### C. Final Message (Complete)
```
TestAgent [timestamp]
Once upon a time, there was a robot named Spark who dreamed of painting sunsets.
[sentiment: positive (0.75)]
```

### 3. JavaScript Integration

The UI handlers use JavaScript for smooth animations:

```javascript
// Auto-scroll conversation
const container = document.querySelector('.conversation-container');
if (container) {
    container.scrollTop = container.scrollHeight;
}

// Progress bar animation
const progress = progressPercent * 100;
card.style.background = `linear-gradient(to right, #dbeafe ${progress}%, #eff6ff ${progress}%)`;

// Fade-in animation
setTimeout(() => {
    card.classList.remove('opacity-0');
    card.classList.add('opacity-100');
}, 100);
```

### 4. Example Integration in Main Window

```python
from nicegui import ui
from utils.websocket_broadcaster import RealtimeUIUpdater

class PsycheSimulationUI:
    def __init__(self):
        self.ui_updater = None
        
    def create_conversation_area(self):
        """Create the conversation display area with real-time updates."""
        with ui.card().classes('w-full'):
            ui.label('Agent Conversation').classes('text-xl font-bold mb-4')
            
            # Status bar
            with ui.row().classes('w-full justify-between mb-2'):
                self.status_label = ui.label('Ready').classes('agent-status')
                self.message_counter = ui.label('Messages: 0')
            
            # Conversation display
            self.conversation_display = ui.column().classes(
                'conversation-container w-full h-96 overflow-y-auto bg-gray-50 p-4 rounded'
            )
            
            # Register elements for real-time updates
            if self.ui_updater:
                self.ui_updater.register_element('agent_status', self.status_label)
                self.ui_updater.register_element('message_counter', self.message_counter)
                self.ui_updater.register_element('conversation_display', self.conversation_display)
    
    def setup_realtime_updates(self):
        """Initialize real-time update system."""
        from utils.websocket_broadcaster import get_broadcaster
        
        broadcaster = get_broadcaster()
        self.ui_updater = RealtimeUIUpdater(broadcaster)
```

### 5. CSS Classes for Styling

Add these CSS classes for proper styling:

```css
/* Thinking indicator */
.agent-processing-card {
    transition: all 0.3s ease;
}

/* Streaming content */
.streaming-content {
    font-family: monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
}

/* Message cards */
.agent-message-card {
    transition: opacity 0.5s ease;
}

/* Animations */
.animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.animate-spin {
    animation: spin 1s linear infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .5; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

## Visual Flow

1. **User sends message** → UI immediately shows "Agent is thinking..."
2. **Agent starts processing** → Spinning indicator appears
3. **Text generation begins** → Words appear progressively in streaming area
4. **Progress updates** → Background gradient shows completion percentage
5. **Processing complete** → Streaming area fades out, final message appears

## Benefits for Users

- **No Frozen UI**: Interface remains responsive throughout
- **Visual Feedback**: Clear indication of system activity
- **Progressive Display**: See response forming in real-time
- **Smooth Transitions**: Professional animations between states
- **Error Handling**: Clear error messages if something goes wrong

## Testing the Integration

To verify real-time updates are working:

1. Send a message to an agent
2. Watch for immediate "thinking" indicator
3. Observe text streaming in progressively
4. Verify smooth transition to final message
5. Check that conversation auto-scrolls

## Troubleshooting

If real-time updates aren't working:

1. **Check WebSocket Events**: Verify events are being broadcast
2. **Inspect Console**: Look for JavaScript errors
3. **Verify Registration**: Ensure UI elements are properly registered
4. **Test Handlers**: Confirm event handlers are set up

The real-time UI updates transform the user experience from static waiting to dynamic engagement, keeping users informed and engaged throughout the entire agent processing lifecycle.