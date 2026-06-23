# Simplified Single-Page UI Design

## Overview
A clean, modern single-page application with collapsible sections for the Psyche Simulation.

## Design Principles
1. **Minimal Complexity** - Remove unnecessary nesting and components
2. **Clear Visual Hierarchy** - Use spacing and typography effectively
3. **Responsive Layout** - Adapts to different screen sizes
4. **Real-time Ready** - Built for WebSocket updates from the ground up
5. **Accessibility** - Proper contrast and interactive elements

## Layout Structure

### Fixed Header
- Always visible at top
- Contains: App title, user info, logout
- Height: 64px
- Background: Dark gradient

### Main Content Area
- Full width container with max-width constraint
- Vertical scrolling
- Padding: 24px

### Sections

#### 1. Control Panel (Always Visible)
```
┌─────────────────────────────────────────────────────────┐
│ Situation: [_____________________] Iterations: [5] ▼    │
│                                                         │
│ [▶ Start] [⏹ Stop] [🔄 Reset] [⚡ Inject Stimulus]     │
└─────────────────────────────────────────────────────────┘
```

#### 2. Live Status Bar
```
┌─────────────────────────────────────────────────────────┐
│ ● System: ACTIVE | Messages: 42 | Network: Connected    │
└─────────────────────────────────────────────────────────┘
```

#### 3. Conversation Feed (Expandable)
```
▼ Conversation Feed ─────────────────────────────────────
│ ┌─────────────────────────────────────────────────┐   │
│ │ Agent: Shadow                                    │   │
│ │ "I sense a deeper truth beneath..."              │   │
│ └─────────────────────────────────────────────────┘   │
│                                                        │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Agent: Self                                      │   │
│ │ "Perhaps we should explore this further..."       │   │
│ └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

#### 4. Health Monitor (Expandable)
```
▶ Health Monitor ────────────────────────────────────────
```

#### 5. Visualizations (Expandable)
```
▶ Visualizations ────────────────────────────────────────
```

#### 6. Settings (Expandable)
```
▶ Settings ──────────────────────────────────────────────
```

## Color Scheme
- Background: #0f0f0f (near black)
- Surface: #1a1a1a (dark gray)
- Primary: #3b82f6 (blue)
- Success: #10b981 (green)
- Warning: #f59e0b (amber)
- Error: #ef4444 (red)
- Text Primary: #f3f4f6
- Text Secondary: #9ca3af

## Typography
- Headers: System font stack, bold
- Body: System font stack, regular
- Code: Monospace font stack

## Spacing System
- Base unit: 8px
- Spacing scale: 8, 16, 24, 32, 48, 64
- Consistent padding and margins

## Interactive Elements
- Buttons: Rounded corners, clear hover states
- Inputs: Outlined style with focus states
- Expansion panels: Smooth animations
- Status indicators: Pulsing animations for activity

## Real-time Updates
- Message animations: Fade in from bottom
- Status changes: Color transitions
- Network activity: Pulse effects
- Progress indicators: Smooth value changes

## Implementation Notes
1. Use NiceGUI's built-in components
2. Avoid deep nesting of containers
3. Keep JavaScript minimal and focused
4. Use CSS classes for consistent styling
5. Test on different screen sizes
