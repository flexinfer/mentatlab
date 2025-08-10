# NiceGUI Layout Nesting Error Fix Summary

## Problem
The application was encountering the error:
```
Found top level layout element "Header" inside element "Column". 
Top level layout elements can not be nested but must be direct children of the page content.
```

## Root Cause
The login UI creates nested containers (Card → Column), and when the login success callback is triggered, it executes within this container context. When `show_main_interface()` tries to create a `ui.header()`, it fails because headers are top-level layout elements that cannot be nested.

## Solution Implemented
The fix uses a **container management approach** with these key changes:

### 1. Main Container Creation
```python
# Create a main container that can be cleared between UI states
main_container = ui.column().classes('w-full')
```

### 2. Clear Container Before Transitions
```python
def show_login_interface():
    # Clear the main container first
    main_container.clear()
    
    # Create login page inside the main container
    with main_container:
        create_login_page(...)
```

### 3. Timer-Based Context Escape
```python
def on_login_success(user_profile, session_id, jwt_token):
    auth_state.login(user_profile, session_id, jwt_token)
    
    # Use a timer to escape the current UI context
    ui.timer(0.1, show_main_interface, once=True)
```

### 4. Clear Container Before Main UI
```python
def show_main_interface():
    # Clear the main container before creating the simulation interface
    main_container.clear()
    
    # Create the simulation interface (with header at top level)
    create_simulation_interface(ui_manager, auth_state, session_manager, logout)
```

## Key Changes Made

1. **ui/main_window.py**:
   - Added `main_container` as a central UI container
   - Modified `show_login_interface()` to clear container and wrap login UI
   - Modified `show_main_interface()` to clear container before creating main UI
   - Used `ui.timer()` in login callback to escape nested context
   - Updated `create_simulation_interface()` to accept additional parameters

2. **Test Scripts Created**:
   - `test_layout_diagnosis.py` - Reproduces the error in isolation
   - `test_login_page_fix.py` - Demonstrates the working fix

## How It Works

1. The `main_container` serves as a single point of UI content that can be cleared
2. Before any UI transition, the container is cleared to remove all nested elements
3. The timer in the login callback defers the UI transition, allowing NiceGUI to properly clean up the context stack
4. When the main interface is created, the header is now at the top level without any nested containers

## Alternative Approaches

If this container management approach doesn't work in all scenarios, consider:

1. **Page Routing**: Use NiceGUI's `@ui.page()` decorator to completely separate login and main interfaces
2. **Iframe Isolation**: Use iframes to isolate different UI states
3. **Full Page Reload**: Force a page reload after login to reset the UI context

## Testing

Run the test script to verify the fix:
```bash
python test_login_page_fix.py
```

The application should now transition from login to main interface without the layout nesting error.