# NiceGUI Layout Fix - Complete Solution

## Problem Summary
The application was throwing a `RuntimeError` when trying to create a `ui.header()` element inside a `ui.column()` container. NiceGUI requires top-level layout elements (header, drawer, footer) to be direct children of the page content.

## Root Cause Analysis
1. `main_container` was created as `ui.column()` at the page level
2. Login form was created inside `main_container` using `with main_container:`
3. After login, `show_main_interface()` cleared the container but then called `create_simulation_interface()`
4. Inside `create_simulation_interface()`, it tried to create `ui.header()` which was still within some container context
5. This violated NiceGUI's layout rules

## Solution Implemented

### Changes to `ui/main_window.py`:

1. **Added header creation at page level (line ~331)**:
   ```python
   # Create header at page level (initially hidden)
   header_element = ui.header().classes('bg-gray-900')
   header_element.style('display: none')
   ```

2. **Modified `show_main_interface()` (line ~373)**:
   - Shows the header with `header_element.style('display: block')`
   - Creates content inside `main_container` using `with main_container:`
   - Populates header outside container context

3. **Split `create_simulation_interface()` into two functions**:
   - `populate_header()`: Populates the header content (called outside container)
   - `create_simulation_content()`: Creates the main UI content (called inside container)

4. **Updated `logout()` function (line ~437)**:
   - Hides and clears the header when logging out
   - Ensures clean state for next login

## Key Design Principles Applied

1. **Separation of Concerns**: Header and content are now managed separately
2. **Proper Layout Hierarchy**: Header is at page level, content is in containers
3. **State Management**: Header visibility is controlled based on authentication state
4. **Clean Transitions**: Header is hidden during login, shown after authentication

## Testing

Created test files:
- `test_nicegui_context_diagnosis.py`: Diagnoses context behavior
- `test_login_page_fix.py`: Tests the complete fixed implementation

## Result
The application now properly handles the transition from login to main interface without violating NiceGUI's layout rules. The header is created once at the page level and its visibility/content is managed based on the authentication state.