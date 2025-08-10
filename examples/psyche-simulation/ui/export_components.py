"""
Export UI Components for Psyche Simulation
NiceGUI-based export interface with progress tracking, file management,
and integration with the data export system.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable

from nicegui import ui, app
from nicegui.events import ValueChangeEventArguments

# Import export system
try:
    from utils.data_exporter import (
        DataExporter, ExportRequest, ExportResult, ExportFormat, 
        ExportStatus, CompressionType, get_data_exporter
    )
    from analysis.real_time_analytics import get_analytics_dashboard
    from utils.performance_monitor import get_performance_monitor
    from utils.websocket_events import get_event_manager
except ImportError as e:
    logging.warning(f"Some export dependencies not available: {e}")

logger = logging.getLogger(__name__)


class ExportDialog:
    """
    Export dialog component with format selection, filters, and progress tracking.
    """
    
    def __init__(self, parent_container=None):
        """
        Initialize the export dialog.
        
        Args:
            parent_container: Parent UI container to attach the dialog to
        """
        self.parent_container = parent_container
        self.exporter = get_data_exporter()
        self.dialog = None
        self.progress_card = None
        self.active_exports: Dict[str, Dict[str, Any]] = {}
        
        # Form state
        self.selected_format = ExportFormat.JSON
        self.selected_data_types = ["analytics"]
        self.selected_compression = CompressionType.NONE
        self.date_range_enabled = False
        self.start_date = datetime.now() - timedelta(days=7)
        self.end_date = datetime.now()
        self.agent_filters = []
        self.include_metadata = True
        self.include_charts = False
        self.custom_filename = ""
        
        # Available options
        self.format_options = [
            {"label": "JSON", "value": ExportFormat.JSON},
            {"label": "CSV", "value": ExportFormat.CSV},
            {"label": "Excel (XLSX)", "value": ExportFormat.XLSX},
            {"label": "PDF Report", "value": ExportFormat.PDF},
            {"label": "HTML", "value": ExportFormat.HTML},
            {"label": "Markdown", "value": ExportFormat.MARKDOWN}
        ]
        
        self.data_type_options = [
            {"label": "Analytics Data", "value": "analytics"},
            {"label": "Performance Metrics", "value": "performance"},
            {"label": "Conversation History", "value": "conversations"},
            {"label": "Agent States", "value": "agents"},
            {"label": "Network Data", "value": "network"},
            {"label": "System Status", "value": "system"},
            {"label": "All Data", "value": "all"}
        ]
        
        self.compression_options = [
            {"label": "No Compression", "value": CompressionType.NONE},
            {"label": "GZIP", "value": CompressionType.GZIP},
            {"label": "ZIP", "value": CompressionType.ZIP}
        ]
        
        self.agent_type_options = [
            {"label": "Ego", "value": "ego"},
            {"label": "Shadow", "value": "shadow"},
            {"label": "Persona", "value": "persona"},
            {"label": "Anima/Animus", "value": "anima_animus"},
            {"label": "Self", "value": "self"}
        ]
    
    def show(self):
        """Show the export dialog."""
        if self.dialog:
            self.dialog.close()
        
        with ui.dialog() as self.dialog:
            with ui.card().style('width: 800px; max-width: 90vw;'):
                ui.label('Export Data').classes('text-h6 q-mb-md')
                
                self._create_export_form()
                
                with ui.row().classes('q-mt-md q-gutter-sm'):
                    ui.button('Cancel', on_click=self.dialog.close).props('flat')
                    ui.button('Export', on_click=self._start_export).props('color=primary')
        
        self.dialog.open()
    
    def _create_export_form(self):
        """Create the export configuration form."""
        with ui.column().classes('q-gutter-md'):
            # Format selection
            with ui.row().classes('q-gutter-md'):
                with ui.column():
                    ui.label('Export Format').classes('text-subtitle2')
                    format_select = ui.select(
                        options=self.format_options,
                        value=self.selected_format,
                        on_change=self._on_format_change
                    ).style('min-width: 200px')
                
                with ui.column():
                    ui.label('Compression').classes('text-subtitle2')
                    compression_select = ui.select(
                        options=self.compression_options,
                        value=self.selected_compression,
                        on_change=self._on_compression_change
                    ).style('min-width: 150px')
            
            # Data type selection
            ui.label('Data Types').classes('text-subtitle2')
            with ui.row().classes('q-gutter-sm'):
                for option in self.data_type_options:
                    ui.checkbox(
                        text=option["label"],
                        value=option["value"] in self.selected_data_types,
                        on_change=lambda e, val=option["value"]: self._on_data_type_change(e, val)
                    )
            
            # Date range filter
            with ui.expansion('Date Range Filter', icon='date_range').classes('w-full'):
                with ui.column().classes('q-gutter-md q-pa-md'):
                    ui.checkbox(
                        'Enable date range filtering',
                        value=self.date_range_enabled,
                        on_change=self._on_date_range_toggle
                    )
                    
                    with ui.row().classes('q-gutter-md') as date_inputs:
                        with ui.column():
                            ui.label('Start Date')
                            start_date_input = ui.date(
                                value=self.start_date.strftime('%Y-%m-%d'),
                                on_change=self._on_start_date_change
                            )
                        
                        with ui.column():
                            ui.label('End Date')
                            end_date_input = ui.date(
                                value=self.end_date.strftime('%Y-%m-%d'),
                                on_change=self._on_end_date_change
                            )
                    
                    # Initially disable date inputs if range filtering is off
                    if not self.date_range_enabled:
                        date_inputs.set_enabled(False)
            
            # Agent filters
            with ui.expansion('Agent Filters', icon='filter_list').classes('w-full'):
                with ui.column().classes('q-gutter-sm q-pa-md'):
                    ui.label('Filter by Agent Types (leave empty for all)')
                    with ui.row().classes('q-gutter-sm'):
                        for option in self.agent_type_options:
                            ui.checkbox(
                                text=option["label"],
                                value=option["value"] in self.agent_filters,
                                on_change=lambda e, val=option["value"]: self._on_agent_filter_change(e, val)
                            )
            
            # Advanced options
            with ui.expansion('Advanced Options', icon='settings').classes('w-full'):
                with ui.column().classes('q-gutter-md q-pa-md'):
                    ui.checkbox(
                        'Include metadata',
                        value=self.include_metadata,
                        on_change=lambda e: setattr(self, 'include_metadata', e.value)
                    )
                    
                    charts_checkbox = ui.checkbox(
                        'Include charts (PDF only)',
                        value=self.include_charts,
                        on_change=lambda e: setattr(self, 'include_charts', e.value)
                    )
                    
                    # Enable charts option only for PDF
                    if self.selected_format != ExportFormat.PDF:
                        charts_checkbox.set_enabled(False)
                    
                    ui.input(
                        'Custom filename (optional)',
                        value=self.custom_filename,
                        on_change=lambda e: setattr(self, 'custom_filename', e.value)
                    ).style('width: 100%')
    
    def _on_format_change(self, e: ValueChangeEventArguments):
        """Handle format selection change."""
        self.selected_format = e.value
        
        # Update charts checkbox availability
        charts_elements = [elem for elem in ui.context.client.elements.values() 
                          if hasattr(elem, 'text') and elem.text == 'Include charts (PDF only)']
        for elem in charts_elements:
            elem.set_enabled(self.selected_format == ExportFormat.PDF)
    
    def _on_compression_change(self, e: ValueChangeEventArguments):
        """Handle compression selection change."""
        self.selected_compression = e.value
    
    def _on_data_type_change(self, e: ValueChangeEventArguments, data_type: str):
        """Handle data type selection change."""
        if e.value:
            if data_type not in self.selected_data_types:
                self.selected_data_types.append(data_type)
        else:
            if data_type in self.selected_data_types:
                self.selected_data_types.remove(data_type)
    
    def _on_date_range_toggle(self, e: ValueChangeEventArguments):
        """Handle date range toggle."""
        self.date_range_enabled = e.value
        
        # Find and enable/disable date inputs
        date_input_containers = [elem for elem in ui.context.client.elements.values() 
                               if hasattr(elem, 'set_enabled')]
        
        # This is a simplified approach - in practice, you'd need better element tracking
    
    def _on_start_date_change(self, e: ValueChangeEventArguments):
        """Handle start date change."""
        try:
            self.start_date = datetime.strptime(e.value, '%Y-%m-%d')
        except ValueError:
            pass
    
    def _on_end_date_change(self, e: ValueChangeEventArguments):
        """Handle end date change."""
        try:
            self.end_date = datetime.strptime(e.value, '%Y-%m-%d')
        except ValueError:
            pass
    
    def _on_agent_filter_change(self, e: ValueChangeEventArguments, agent_type: str):
        """Handle agent filter change."""
        if e.value:
            if agent_type not in self.agent_filters:
                self.agent_filters.append(agent_type)
        else:
            if agent_type in self.agent_filters:
                self.agent_filters.remove(agent_type)
    
    async def _start_export(self):
        """Start the export process."""
        try:
            # Validate form
            if not self.selected_data_types:
                ui.notify('Please select at least one data type', type='warning')
                return
            
            # Create export request
            filters = {}
            
            if self.date_range_enabled:
                filters['start_time'] = self.start_date
                filters['end_time'] = self.end_date
            
            if self.agent_filters:
                filters['agent_types'] = self.agent_filters
            
            request = self.exporter.create_export_request(
                format=self.selected_format,
                data_types=self.selected_data_types,
                filters=filters,
                compression=self.selected_compression,
                include_metadata=self.include_metadata,
                include_charts=self.include_charts,
                filename=self.custom_filename if self.custom_filename else None,
                callback=self._on_export_complete
            )
            
            # Close dialog and show progress
            self.dialog.close()
            self._show_progress_dialog(request.export_id)
            
            # Start export in background
            asyncio.create_task(self._run_export(request))
            
            ui.notify(f'Export started: {request.export_id}', type='info')
            
        except Exception as e:
            logger.error(f"Error starting export: {e}")
            ui.notify(f'Export failed to start: {str(e)}', type='negative')
    
    async def _run_export(self, request: ExportRequest):
        """Run the export operation."""
        try:
            result = await self.exporter.export_data_async(request)
            
            if result.status == ExportStatus.COMPLETED:
                ui.notify(f'Export completed: {result.file_path}', type='positive')
            else:
                ui.notify(f'Export failed: {result.error_message}', type='negative')
                
        except Exception as e:
            logger.error(f"Export error: {e}")
            ui.notify(f'Export failed: {str(e)}', type='negative')
    
    def _show_progress_dialog(self, export_id: str):
        """Show export progress dialog."""
        with ui.dialog() as progress_dialog:
            with ui.card().style('width: 500px'):
                ui.label('Export in Progress').classes('text-h6 q-mb-md')
                
                progress_bar = ui.linear_progress(value=0).classes('q-mb-md')
                status_label = ui.label('Initializing export...')
                
                # Store progress tracking info
                self.active_exports[export_id] = {
                    'dialog': progress_dialog,
                    'progress_bar': progress_bar,
                    'status_label': status_label,
                    'start_time': time.time()
                }
                
                with ui.row().classes('q-mt-md'):
                    ui.button('Cancel', on_click=lambda: self._cancel_export(export_id))
                    ui.button('Hide', on_click=progress_dialog.close).props('flat')
        
        progress_dialog.open()
    
    def _cancel_export(self, export_id: str):
        """Cancel an export operation."""
        if self.exporter.cancel_export(export_id):
            ui.notify('Export cancelled', type='info')
            if export_id in self.active_exports:
                self.active_exports[export_id]['dialog'].close()
                del self.active_exports[export_id]
        else:
            ui.notify('Could not cancel export', type='warning')
    
    async def _on_export_complete(self, result: ExportResult):
        """Handle export completion."""
        export_id = result.export_id
        
        if export_id in self.active_exports:
            export_info = self.active_exports[export_id]
            
            # Update progress
            export_info['progress_bar'].set_value(1.0)
            
            if result.status == ExportStatus.COMPLETED:
                export_info['status_label'].set_text(
                    f'Export completed! File: {Path(result.file_path).name}'
                )
            else:
                export_info['status_label'].set_text(
                    f'Export failed: {result.error_message}'
                )
            
            # Auto-close after a delay
            await asyncio.sleep(3)
            if export_id in self.active_exports:
                self.active_exports[export_id]['dialog'].close()
                del self.active_exports[export_id]


class ExportHistoryPanel:
    """
    Panel showing export history and allowing file downloads.
    """
    
    def __init__(self, container):
        """
        Initialize the export history panel.
        
        Args:
            container: UI container to render the panel in
        """
        self.container = container
        self.exporter = get_data_exporter()
        self.refresh_timer = None
        
        self._create_panel()
        self._start_refresh_timer()
    
    def _create_panel(self):
        """Create the export history panel."""
        with self.container:
            with ui.card().classes('w-full'):
                with ui.row().classes('items-center justify-between q-mb-md'):
                    ui.label('Export History').classes('text-h6')
                    ui.button('Refresh', on_click=self._refresh_history).props('flat size=sm')
                
                self.history_container = ui.column().classes('q-gutter-sm')
                self._refresh_history()
    
    def _refresh_history(self):
        """Refresh the export history display."""
        try:
            # Clear existing content
            self.history_container.clear()
            
            # Get export history
            exports = self.exporter.list_exports(limit=20)
            
            if not exports:
                with self.history_container:
                    ui.label('No exports found').classes('text-grey-6')
                return
            
            # Display exports
            with self.history_container:
                for export_result in exports:
                    self._create_export_item(export_result)
                    
        except Exception as e:
            logger.error(f"Error refreshing export history: {e}")
            with self.history_container:
                ui.label(f'Error loading history: {str(e)}').classes('text-negative')
    
    def _create_export_item(self, result: ExportResult):
        """Create a single export history item."""
        # Determine status color
        status_colors = {
            ExportStatus.COMPLETED: 'positive',
            ExportStatus.FAILED: 'negative',
            ExportStatus.IN_PROGRESS: 'info',
            ExportStatus.PENDING: 'warning',
            ExportStatus.CANCELLED: 'grey'
        }
        
        status_color = status_colors.get(result.status, 'grey')
        
        with ui.card().classes('w-full'):
            with ui.row().classes('items-center justify-between'):
                # Export info
                with ui.column():
                    ui.label(f'Export {result.export_id}').classes('text-weight-bold')
                    ui.label(f'Format: {result.format.value.upper()} | Records: {result.records_exported}')
                    ui.label(f'Duration: {result.duration_seconds:.1f}s').classes('text-caption')
                
                # Status and actions
                with ui.column().classes('items-end'):
                    ui.badge(result.status.value.title()).props(f'color={status_color}')
                    
                    if result.status == ExportStatus.COMPLETED and result.file_path:
                        ui.button(
                            'Download',
                            on_click=lambda r=result: self._download_file(r),
                            icon='download'
                        ).props('size=sm flat')
                    
                    if result.file_size:
                        size_mb = result.file_size / (1024 * 1024)
                        ui.label(f'{size_mb:.1f} MB').classes('text-caption')
    
    def _download_file(self, result: ExportResult):
        """Handle file download."""
        try:
            if not result.file_path or not Path(result.file_path).exists():
                ui.notify('Export file not found', type='warning')
                return
            
            # In a real implementation, this would trigger a file download
            # For now, we'll just show the file path
            ui.notify(f'File location: {result.file_path}', type='info')
            
            # Copy to clipboard if possible
            ui.run_javascript(f'''
                if (navigator.clipboard) {{
                    navigator.clipboard.writeText("{result.file_path}");
                }}
            ''')
            
        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            ui.notify(f'Download failed: {str(e)}', type='negative')
    
    def _start_refresh_timer(self):
        """Start automatic refresh timer."""
        if self.refresh_timer:
            self.refresh_timer.cancel()
        
        # Refresh every 10 seconds
        self.refresh_timer = ui.timer(10.0, self._refresh_history)
    
    def stop_refresh_timer(self):
        """Stop the refresh timer."""
        if self.refresh_timer:
            self.refresh_timer.cancel()
            self.refresh_timer = None


class ExportStatisticsCard:
    """
    Card showing export system statistics.
    """
    
    def __init__(self, container):
        """
        Initialize the statistics card.
        
        Args:
            container: UI container to render the card in
        """
        self.container = container
        self.exporter = get_data_exporter()
        self.stats_timer = None
        
        self._create_card()
        self._start_stats_timer()
    
    def _create_card(self):
        """Create the statistics card."""
        with self.container:
            with ui.card().classes('w-full'):
                ui.label('Export Statistics').classes('text-h6 q-mb-md')
                
                self.stats_container = ui.column().classes('q-gutter-sm')
                self._refresh_stats()
    
    def _refresh_stats(self):
        """Refresh the statistics display."""
        try:
            self.stats_container.clear()
            
            stats = self.exporter.get_export_statistics()
            
            with self.stats_container:
                # Key metrics
                with ui.row().classes('q-gutter-lg'):
                    with ui.column().classes('text-center'):
                        ui.label(str(stats['total_exports'])).classes('text-h4 text-primary')
                        ui.label('Total Exports').classes('text-caption')
                    
                    with ui.column().classes('text-center'):
                        ui.label(str(stats['completed_exports'])).classes('text-h4 text-positive')
                        ui.label('Completed').classes('text-caption')
                    
                    with ui.column().classes('text-center'):
                        success_rate = f"{stats['success_rate'] * 100:.1f}%"
                        ui.label(success_rate).classes('text-h4 text-info')
                        ui.label('Success Rate').classes('text-caption')
                
                # Additional stats
                ui.separator().classes('q-my-md')
                
                with ui.row().classes('q-gutter-md'):
                    ui.label(f"Active Exports: {stats['active_exports']}")
                    ui.label(f"Failed Exports: {stats['failed_exports']}")
                
                if stats['total_data_exported_bytes'] > 0:
                    data_mb = stats['total_data_exported_bytes'] / (1024 * 1024)
                    ui.label(f"Data Exported: {data_mb:.1f} MB")
                
                if stats['export_formats_used']:
                    ui.label(f"Formats Used: {', '.join(stats['export_formats_used'])}")
                    
        except Exception as e:
            logger.error(f"Error refreshing export stats: {e}")
            with self.stats_container:
                ui.label(f'Error loading stats: {str(e)}').classes('text-negative')
    
    def _start_stats_timer(self):
        """Start automatic stats refresh timer."""
        if self.stats_timer:
            self.stats_timer.cancel()
        
        # Refresh every 30 seconds
        self.stats_timer = ui.timer(30.0, self._refresh_stats)
    
    def stop_stats_timer(self):
        """Stop the stats timer."""
        if self.stats_timer:
            self.stats_timer.cancel()
            self.stats_timer = None


class ExportButton:
    """
    Simple export button component for integration into other UI panels.
    """
    
    def __init__(
        self,
        container,
        label: str = "Export",
        icon: str = "download",
        default_format: ExportFormat = ExportFormat.JSON,
        default_data_types: List[str] = None,
        quick_export: bool = False
    ):
        """
        Initialize the export button.
        
        Args:
            container: UI container to render the button in
            label: Button label
            icon: Button icon
            default_format: Default export format
            default_data_types: Default data types to export
            quick_export: If True, skip dialog and export immediately
        """
        self.container = container
        self.label = label
        self.icon = icon
        self.default_format = default_format
        self.default_data_types = default_data_types or ["analytics"]
        self.quick_export = quick_export
        
        self._create_button()
    
    def _create_button(self):
        """Create the export button."""
        with self.container:
            ui.button(
                self.label,
                on_click=self._handle_export,
                icon=self.icon
            ).tooltip('Export data')
    
    def _handle_export(self):
        """Handle export button click."""
        if self.quick_export:
            # Quick export without dialog
            self._quick_export()
        else:
            # Show export dialog
            dialog = ExportDialog()
            # Pre-populate with defaults
            dialog.selected_format = self.default_format
            dialog.selected_data_types = self.default_data_types.copy()
            dialog.show()
    
    async def _quick_export(self):
        """Perform quick export without dialog."""
        try:
            exporter = get_data_exporter()
            
            request = exporter.create_export_request(
                format=self.default_format,
                data_types=self.default_data_types,
                include_metadata=True
            )
            
            ui.notify(f'Quick export started: {request.export_id}', type='info')
            
            # Run export in background
            result = await exporter.export_data_async(request)
            
            if result.status == ExportStatus.COMPLETED:
                ui.notify(f'Export completed: {Path(result.file_path).name}', type='positive')
            else:
                ui.notify(f'Export failed: {result.error_message}', type='negative')
                
        except Exception as e:
            logger.error(f"Quick export error: {e}")
            ui.notify(f'Export failed: {str(e)}', type='negative')


class ExportManagementPage:
    """
    Complete export management page with all components.
    """
    
    def __init__(self):
        """Initialize the export management page."""
        self.dialog = None
        self.history_panel = None
        self.stats_card = None
    
    def create_page(self):
        """Create the complete export management page."""
        ui.label('Data Export Management').classes('text-h4 q-mb-lg')
        
        with ui.row().classes('w-full q-gutter-lg'):
            # Left column - Actions and Statistics
            with ui.column().classes('col-4'):
                # Export button
                with ui.card().classes('w-full q-mb-md'):
                    ui.label('Export Actions').classes('text-h6 q-mb-md')
                    
                    ui.button(
                        'New Export',
                        on_click=self._show_export_dialog,
                        icon='add'
                    ).props('color=primary size=lg').classes('full-width q-mb-sm')
                    
                    # Quick export buttons
                    with ui.row().classes('q-gutter-sm'):
                        ExportButton(
                            ui.context.slot,
                            label="Quick JSON",
                            default_format=ExportFormat.JSON,
                            quick_export=True
                        )
                        
                        ExportButton(
                            ui.context.slot,
                            label="Quick CSV",
                            default_format=ExportFormat.CSV,
                            quick_export=True
                        )
                
                # Statistics card
                self.stats_card = ExportStatisticsCard(ui.context.slot)
            
            # Right column - Export History
            with ui.column().classes('col-8'):
                self.history_panel = ExportHistoryPanel(ui.context.slot)
    
    def _show_export_dialog(self):
        """Show the export dialog."""
        if not self.dialog:
            self.dialog = ExportDialog()
        self.dialog.show()
    
    def cleanup(self):
        """Cleanup resources when page is destroyed."""
        if self.history_panel:
            self.history_panel.stop_refresh_timer()
        if self.stats_card:
            self.stats_card.stop_stats_timer()


# Integration helper functions
def add_export_button_to_container(
    container,
    data_types: List[str] = None,
    format: ExportFormat = ExportFormat.JSON
):
    """
    Add an export button to any UI container.
    
    Args:
        container: NiceGUI container to add the button to
        data_types: Data types to export
        format: Export format
    """
    ExportButton(
        container,
        default_data_types=data_types or ["analytics"],
        default_format=format
    )


def create_export_page():
    """
    Create a standalone export management page.
    
    Returns:
        ExportManagementPage instance
    """
    page = ExportManagementPage()
    page.create_page()
    return page


# Example usage and testing
if __name__ == "__main__":
    @ui.page('/')
    def main_page():
        """Test page for export components."""
        ui.label('Psyche Simulation - Export System Test').classes('text-h4 q-mb-lg')
        
        with ui.tabs().classes('w-full') as tabs:
            export_tab = ui.tab('Export Management')
            test_tab = ui.tab('Component Tests')
        
        with ui.tab_panels(tabs, value=export_tab).classes('w-full'):
            # Export management page
            with ui.tab_panel(export_tab):
                export_page = create_export_page()
            
            # Component tests
            with ui.tab_panel(test_tab):
                ui.label('Individual Component Tests').classes('text-h6 q-mb-md')
                
                with ui.row().classes('q-gutter-md'):
                    # Test export dialog
                    ui.button(
                        'Test Export Dialog',
                        on_click=lambda: ExportDialog().show()
                    )
                    
                    # Test quick export buttons
                    ExportButton(
                        ui.context.slot,
                        label="Test Analytics Export",
                        default_data_types=["analytics"],
                        quick_export=True
                    )
                    
                    ExportButton(
                        ui.context.slot,
                        label="Test Performance Export",
                        default_data_types=["performance"],
                        default_format=ExportFormat.CSV
                    )
    
    ui.run(title='Export System Test', port=8080)