"""
Data Export System for Psyche Simulation
Advanced multi-format export capabilities with thread-safe operations,
compression support, and integration with analytics and performance monitoring.
"""

import asyncio
import csv
import gzip
import json
import logging
import os
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Callable, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import pandas as pd

# PDF generation imports
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.charts.linecharts import HorizontalLineChart
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

# Integration imports
try:
    from analysis.real_time_analytics import get_analytics_dashboard, AnalysisType
    from utils.performance_monitor import get_performance_monitor
    from utils.circuit_breaker import CircuitBreaker
    from utils.websocket_events import get_event_manager, EventType
    from data.redis_state_manager import RedisStateManager
except ImportError as e:
    logging.warning(f"Some integrations not available: {e}")

logger = logging.getLogger(__name__)


class ExportFormat(str, Enum):
    """Supported export formats"""
    CSV = "csv"
    JSON = "json"
    PDF = "pdf"
    XLSX = "xlsx"
    HTML = "html"
    MARKDOWN = "md"


class ExportStatus(str, Enum):
    """Export operation status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CompressionType(str, Enum):
    """Compression options"""
    NONE = "none"
    GZIP = "gzip"
    ZIP = "zip"


@dataclass
class ExportRequest:
    """Export request configuration"""
    export_id: str
    format: ExportFormat
    data_types: List[str]  # analytics, conversations, performance, etc.
    filters: Dict[str, Any]
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    compression: CompressionType = CompressionType.NONE
    include_metadata: bool = True
    include_charts: bool = False  # For PDF exports
    custom_fields: Optional[List[str]] = None
    filename: Optional[str] = None
    callback: Optional[Callable] = None


@dataclass
class ExportResult:
    """Export operation result"""
    export_id: str
    status: ExportStatus
    format: ExportFormat
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    records_exported: int = 0
    duration_seconds: float = 0.0
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class DataExporter:
    """
    Thread-safe data exporter with multi-format support, compression,
    and integration with the Psyche Simulation analytics system.
    """

    def __init__(
        self,
        output_dir: str = "./exports",
        max_workers: int = 4,
        chunk_size: int = 1000,
        compression_level: int = 6,
        analytics_dashboard=None,
        performance_monitor=None,
        redis_manager=None,
        websocket_manager=None
    ):
        """
        Initialize the data exporter.

        Args:
            output_dir: Directory for export files
            max_workers: Maximum number of worker threads
            chunk_size: Records per chunk for large exports
            compression_level: Compression level (1-9)
            analytics_dashboard: Analytics dashboard instance
            performance_monitor: Performance monitor instance
            redis_manager: Redis state manager instance
            websocket_manager: WebSocket event manager instance
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.max_workers = max_workers
        self.chunk_size = chunk_size
        self.compression_level = compression_level

        # Integration components
        try:
            self.analytics_dashboard = analytics_dashboard or get_analytics_dashboard()
        except:
            self.analytics_dashboard = None
            
        try:
            self.performance_monitor = performance_monitor or get_performance_monitor()
        except:
            self.performance_monitor = None
            
        self.redis_manager = redis_manager
        
        try:
            self.websocket_manager = websocket_manager or get_event_manager()
        except:
            self.websocket_manager = None

        # Thread safety
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

        # Export tracking
        self.active_exports: Dict[str, ExportResult] = {}
        self.export_history: List[ExportResult] = []

        # Circuit breaker for resilience
        try:
            self.circuit_breaker = CircuitBreaker(
                failure_threshold=5,
                recovery_timeout=30,
                expected_exception=Exception
            )
        except:
            self.circuit_breaker = None

        logger.info(f"Data exporter initialized - output: {self.output_dir}")

    def create_export_request(
        self,
        format: ExportFormat,
        data_types: List[str],
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> ExportRequest:
        """Create a new export request with validation."""
        export_id = f"export_{int(time.time() * 1000)}"
        
        return ExportRequest(
            export_id=export_id,
            format=format,
            data_types=data_types,
            filters=filters or {},
            **kwargs
        )

    async def export_data_async(self, request: ExportRequest) -> ExportResult:
        """
        Asynchronously export data with progress tracking.
        
        Args:
            request: Export request configuration
            
        Returns:
            ExportResult with operation details
        """
        start_time = time.time()
        
        # Initialize result
        result = ExportResult(
            export_id=request.export_id,
            status=ExportStatus.PENDING,
            format=request.format
        )
        
        with self.lock:
            self.active_exports[request.export_id] = result

        try:
            # Update status
            result.status = ExportStatus.IN_PROGRESS
            self._notify_export_progress(result, 0)

            # Validate request
            if not await self._validate_request(request):
                raise ValueError("Invalid export request parameters")

            # Collect data
            logger.info(f"Starting data collection for export {request.export_id}")
            raw_data = await self._collect_data(request)
            
            if not raw_data:
                raise ValueError("No data found matching the specified criteria")

            result.records_exported = len(raw_data)
            self._notify_export_progress(result, 30)

            # Generate export file
            logger.info(f"Generating {request.format.value} export for {result.records_exported} records")
            file_path = await self._generate_export_file(request, raw_data)
            
            self._notify_export_progress(result, 80)

            # Apply compression if requested
            if request.compression != CompressionType.NONE:
                file_path = await self._apply_compression(file_path, request.compression)

            # Finalize result
            result.file_path = str(file_path)
            result.file_size = file_path.stat().st_size if file_path.exists() else 0
            result.status = ExportStatus.COMPLETED
            result.duration_seconds = time.time() - start_time

            self._notify_export_progress(result, 100)
            logger.info(f"Export {request.export_id} completed - {result.file_size} bytes")

        except Exception as e:
            result.status = ExportStatus.FAILED
            result.error_message = str(e)
            result.duration_seconds = time.time() - start_time
            logger.error(f"Export {request.export_id} failed: {e}")

        finally:
            with self.lock:
                if request.export_id in self.active_exports:
                    del self.active_exports[request.export_id]
                self.export_history.append(result)

            # Call completion callback if provided
            if request.callback:
                try:
                    if asyncio.iscoroutinefunction(request.callback):
                        await request.callback(result)
                    else:
                        request.callback(result)
                except Exception as e:
                    logger.error(f"Error in export callback: {e}")

        return result

    def export_data(self, request: ExportRequest) -> ExportResult:
        """
        Synchronous wrapper for data export.
        
        Args:
            request: Export request configuration
            
        Returns:
            ExportResult with operation details
        """
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(self.export_data_async(request))

    async def _validate_request(self, request: ExportRequest) -> bool:
        """Validate export request parameters."""
        try:
            # Check format support
            if request.format not in ExportFormat:
                logger.error(f"Unsupported export format: {request.format}")
                return False

            # Check PDF dependencies
            if request.format == ExportFormat.PDF and not REPORTLAB_AVAILABLE:
                logger.error("PDF export requires reportlab library")
                return False

            # Validate data types
            valid_data_types = [
                "analytics", "conversations", "performance", 
                "agents", "network", "system", "all"
            ]
            
            if not all(dt in valid_data_types for dt in request.data_types):
                logger.error(f"Invalid data types: {request.data_types}")
                return False

            # Validate time range
            if request.start_time and request.end_time:
                if request.start_time >= request.end_time:
                    logger.error("Invalid time range: start_time >= end_time")
                    return False

            return True

        except Exception as e:
            logger.error(f"Request validation error: {e}")
            return False

    async def _collect_data(self, request: ExportRequest) -> List[Dict[str, Any]]:
        """Collect data based on request parameters."""
        collected_data = []
        
        try:
            for data_type in request.data_types:
                if data_type == "all":
                    # Collect all available data
                    data_collectors = [
                        self._collect_analytics_data,
                        self._collect_performance_data,
                        self._collect_conversation_data,
                        self._collect_system_data
                    ]
                else:
                    # Collect specific data type
                    data_collectors = [getattr(self, f"_collect_{data_type}_data", None)]
                    data_collectors = [dc for dc in data_collectors if dc is not None]

                # Execute data collection
                for collector in data_collectors:
                    try:
                        data = await collector(request)
                        if data:
                            if isinstance(data, list):
                                collected_data.extend(data)
                            else:
                                collected_data.append(data)
                    except Exception as e:
                        logger.warning(f"Error collecting {data_type} data: {e}")

            # Apply filters
            if request.filters:
                collected_data = self._apply_filters(collected_data, request.filters)

            return collected_data

        except Exception as e:
            logger.error(f"Data collection error: {e}")
            return []

    async def _collect_analytics_data(self, request: ExportRequest) -> List[Dict[str, Any]]:
        """Collect analytics data from the dashboard."""
        if not self.analytics_dashboard:
            return []

        try:
            # Get comprehensive analytics summary
            summary = self.analytics_dashboard.get_analytics_summary()
            
            # Get detailed analysis for each type
            detailed_data = []
            for analysis_type in AnalysisType:
                analysis = self.analytics_dashboard.get_detailed_analysis(analysis_type)
                if analysis:
                    detailed_data.append({
                        "type": "analytics",
                        "analysis_type": analysis_type.value,
                        "timestamp": time.time(),
                        "data": analysis
                    })

            # Add summary data
            detailed_data.append({
                "type": "analytics",
                "analysis_type": "summary",
                "timestamp": time.time(),
                "data": summary
            })

            return detailed_data

        except Exception as e:
            logger.error(f"Error collecting analytics data: {e}")
            return []

    async def _collect_performance_data(self, request: ExportRequest) -> List[Dict[str, Any]]:
        """Collect performance monitoring data."""
        if not self.performance_monitor:
            return []

        try:
            # Get performance metrics
            start_time = request.start_time.timestamp() if request.start_time else None
            end_time = request.end_time.timestamp() if request.end_time else None
            
            # Export metrics as JSON and parse
            metrics_json = self.performance_monitor.export_metrics_json(start_time, end_time)
            metrics_data = json.loads(metrics_json)
            
            # Convert to list format
            performance_data = []
            for metric_name, metric_values in metrics_data.get("metrics", {}).items():
                for metric in metric_values:
                    performance_data.append({
                        "type": "performance",
                        "metric_name": metric_name,
                        **metric
                    })

            return performance_data

        except Exception as e:
            logger.error(f"Error collecting performance data: {e}")
            return []

    async def _collect_conversation_data(self, request: ExportRequest) -> List[Dict[str, Any]]:
        """Collect conversation data from Redis or analytics."""
        conversation_data = []

        try:
            # Try Redis first
            if self.redis_manager:
                # This would collect conversation history from Redis
                # Implementation depends on Redis schema
                pass

            # Fallback to analytics dashboard conversation data
            if self.analytics_dashboard and hasattr(self.analytics_dashboard, 'psychological_analyzer'):
                analyzer = self.analytics_dashboard.psychological_analyzer
                
                # Get conversation history
                for entry in analyzer.conversation_history:
                    conversation_data.append({
                        "type": "conversation",
                        **entry
                    })

            return conversation_data

        except Exception as e:
            logger.error(f"Error collecting conversation data: {e}")
            return []

    async def _collect_system_data(self, request: ExportRequest) -> List[Dict[str, Any]]:
        """Collect system status and health data."""
        try:
            system_data = []
            
            # Get performance snapshot
            if self.performance_monitor:
                snapshot = self.performance_monitor.get_performance_snapshot()
                system_data.append({
                    "type": "system",
                    "category": "performance_snapshot",
                    "timestamp": time.time(),
                    "data": snapshot
                })

            # Get WebSocket statistics
            if self.websocket_manager:
                stats = self.websocket_manager.get_statistics()
                system_data.append({
                    "type": "system",
                    "category": "websocket_stats",
                    "timestamp": time.time(),
                    "data": stats
                })

            return system_data

        except Exception as e:
            logger.error(f"Error collecting system data: {e}")
            return []

    def _apply_filters(self, data: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Apply filters to collected data."""
        try:
            filtered_data = data.copy()

            # Time range filtering
            if "start_time" in filters or "end_time" in filters:
                start_ts = filters.get("start_time", 0)
                end_ts = filters.get("end_time", float('inf'))
                
                if isinstance(start_ts, datetime):
                    start_ts = start_ts.timestamp()
                if isinstance(end_ts, datetime):
                    end_ts = end_ts.timestamp()

                filtered_data = [
                    item for item in filtered_data
                    if start_ts <= item.get("timestamp", 0) <= end_ts
                ]

            # Agent type filtering
            if "agent_types" in filters:
                agent_types = filters["agent_types"]
                filtered_data = [
                    item for item in filtered_data
                    if item.get("agent_type") in agent_types or 
                       item.get("from_agent") in agent_types
                ]

            # Data type filtering
            if "data_types" in filters:
                data_types = filters["data_types"]
                filtered_data = [
                    item for item in filtered_data
                    if item.get("type") in data_types
                ]

            return filtered_data

        except Exception as e:
            logger.error(f"Error applying filters: {e}")
            return data

    async def _generate_export_file(self, request: ExportRequest, data: List[Dict[str, Any]]) -> Path:
        """Generate the export file in the requested format."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = request.filename or f"psyche_export_{timestamp}"
        
        # Add format extension
        file_path = self.output_dir / f"{filename}.{request.format.value}"
        
        try:
            if request.format == ExportFormat.CSV:
                await self._generate_csv(file_path, data, request)
            elif request.format == ExportFormat.JSON:
                await self._generate_json(file_path, data, request)
            elif request.format == ExportFormat.PDF:
                await self._generate_pdf(file_path, data, request)
            elif request.format == ExportFormat.XLSX:
                await self._generate_xlsx(file_path, data, request)
            elif request.format == ExportFormat.HTML:
                await self._generate_html(file_path, data, request)
            elif request.format == ExportFormat.MARKDOWN:
                await self._generate_markdown(file_path, data, request)
            else:
                raise ValueError(f"Unsupported export format: {request.format}")

            return file_path

        except Exception as e:
            logger.error(f"Error generating {request.format.value} file: {e}")
            raise

    async def _generate_csv(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate CSV export file."""
        if not data:
            return

        # Flatten nested data and determine all possible columns
        flattened_data = []
        all_columns = set()

        for item in data:
            flattened_item = self._flatten_dict(item)
            flattened_data.append(flattened_item)
            all_columns.update(flattened_item.keys())

        # Write CSV
        with open(file_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=sorted(all_columns))
            writer.writeheader()
            writer.writerows(flattened_data)

    async def _generate_json(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate JSON export file."""
        export_data = {
            "export_metadata": {
                "export_id": request.export_id,
                "timestamp": datetime.now().isoformat(),
                "format": request.format.value,
                "data_types": request.data_types,
                "filters": request.filters,
                "record_count": len(data)
            },
            "data": data
        }

        with open(file_path, 'w', encoding='utf-8') as jsonfile:
            json.dump(export_data, jsonfile, indent=2, default=str)

    async def _generate_pdf(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate PDF export file with charts and formatting."""
        if not REPORTLAB_AVAILABLE:
            raise ImportError("PDF export requires reportlab library")

        # Create PDF document
        doc = SimpleDocTemplate(str(file_path), pagesize=letter)
        story = []
        styles = getSampleStyleSheet()

        # Title
        title = Paragraph("Psyche Simulation Export Report", styles['Title'])
        story.append(title)
        story.append(Spacer(1, 12))

        # Metadata
        metadata_text = f"""
        Export ID: {request.export_id}<br/>
        Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}<br/>
        Data Types: {', '.join(request.data_types)}<br/>
        Records: {len(data)}<br/>
        """
        
        metadata_para = Paragraph(metadata_text, styles['Normal'])
        story.append(metadata_para)
        story.append(Spacer(1, 12))

        # Group data by type for organized presentation
        data_by_type = {}
        for item in data:
            data_type = item.get('type', 'unknown')
            if data_type not in data_by_type:
                data_by_type[data_type] = []
            data_by_type[data_type].append(item)

        # Generate sections for each data type
        for data_type, items in data_by_type.items():
            # Section header
            header = Paragraph(f"{data_type.title()} Data", styles['Heading1'])
            story.append(header)
            story.append(Spacer(1, 6))

            # Create table for this data type
            if items:
                table_data = self._prepare_table_data(items, max_rows=50)
                if table_data:
                    table = Table(table_data)
                    table.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                        ('FONTSIZE', (0, 0), (-1, 0), 10),
                        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                        ('GRID', (0, 0), (-1, -1), 1, colors.black)
                    ]))
                    story.append(table)

            story.append(PageBreak())

        # Build PDF
        doc.build(story)

    async def _generate_xlsx(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate Excel export file with multiple sheets."""
        try:
            # Group data by type
            data_by_type = {}
            for item in data:
                data_type = item.get('type', 'general')
                if data_type not in data_by_type:
                    data_by_type[data_type] = []
                data_by_type[data_type].append(item)

            # Create Excel writer
            with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
                # Create metadata sheet
                metadata_df = pd.DataFrame([{
                    'Export ID': request.export_id,
                    'Generated': datetime.now().isoformat(),
                    'Data Types': ', '.join(request.data_types),
                    'Record Count': len(data),
                    'Filters': str(request.filters)
                }])
                metadata_df.to_excel(writer, sheet_name='Metadata', index=False)

                # Create sheet for each data type
                for data_type, items in data_by_type.items():
                    if items:
                        # Flatten and convert to DataFrame
                        flattened_items = [self._flatten_dict(item) for item in items]
                        df = pd.DataFrame(flattened_items)
                        
                        # Ensure sheet name is valid
                        sheet_name = data_type[:31]  # Excel sheet name limit
                        df.to_excel(writer, sheet_name=sheet_name, index=False)

        except ImportError:
            # Fallback to CSV if pandas/openpyxl not available
            logger.warning("Excel export requires pandas and openpyxl, falling back to CSV")
            csv_path = file_path.with_suffix('.csv')
            await self._generate_csv(csv_path, data, request)
            return csv_path

    async def _generate_html(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate HTML export file with styling."""
        html_content = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Psyche Simulation Export Report</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .header {{ background-color: #f0f0f0; padding: 20px; border-radius: 5px; }}
                .data-section {{ margin: 20px 0; }}
                .data-type {{ background-color: #e6f3ff; padding: 10px; border-left: 4px solid #0066cc; }}
                table {{ border-collapse: collapse; width: 100%; margin: 10px 0; }}
                th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
                th {{ background-color: #f2f2f2; }}
                .metadata {{ color: #666; font-size: 0.9em; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Psyche Simulation Export Report</h1>
                <div class="metadata">
                    <p><strong>Export ID:</strong> {request.export_id}</p>
                    <p><strong>Generated:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                    <p><strong>Data Types:</strong> {', '.join(request.data_types)}</p>
                    <p><strong>Record Count:</strong> {len(data)}</p>
                </div>
            </div>
        """

        # Group data by type
        data_by_type = {}
        for item in data:
            data_type = item.get('type', 'general')
            if data_type not in data_by_type:
                data_by_type[data_type] = []
            data_by_type[data_type].append(item)

        # Generate sections
        for data_type, items in data_by_type.items():
            html_content += f"""
            <div class="data-section">
                <div class="data-type">
                    <h2>{data_type.title()} Data ({len(items)} records)</h2>
                </div>
            """

            if items:
                # Create table
                flattened_items = [self._flatten_dict(item) for item in items[:100]]  # Limit for HTML
                if flattened_items:
                    columns = list(flattened_items[0].keys())
                    
                    html_content += "<table><thead><tr>"
                    for col in columns:
                        html_content += f"<th>{col}</th>"
                    html_content += "</tr></thead><tbody>"
                    
                    for item in flattened_items:
                        html_content += "<tr>"
                        for col in columns:
                            value = str(item.get(col, ''))[:100]  # Truncate long values
                            html_content += f"<td>{value}</td>"
                        html_content += "</tr>"
                    
                    html_content += "</tbody></table>"

            html_content += "</div>"

        html_content += """
        </body>
        </html>
        """

        with open(file_path, 'w', encoding='utf-8') as htmlfile:
            htmlfile.write(html_content)

    async def _generate_markdown(self, file_path: Path, data: List[Dict[str, Any]], request: ExportRequest):
        """Generate Markdown export file."""
        md_content = f"""# Psyche Simulation Export Report

## Export Information
- **Export ID:** {request.export_id}
- **Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Data Types:** {', '.join(request.data_types)}
- **Record Count:** {len(data)}
- **Filters:** {request.filters}

---

"""

        # Group data by type
        data_by_type = {}
        for item in data:
            data_type = item.get('type', 'general')
            if data_type not in data_by_type:
                data_by_type[data_type] = []
            data_by_type[data_type].append(item)

        # Generate sections
        for data_type, items in data_by_type.items():
            md_content += f"## {data_type.title()} Data ({len(items)} records)\n\n"

            if items:
                # Show sample data
                sample_items = items[:10]  # Show first 10 items
                for i, item in enumerate(sample_items, 1):
                    md_content += f"### Record {i}\n\n"
                    flattened = self._flatten_dict(item)
                    for key, value in flattened.items():
                        md_content += f"- **{key}:** {value}\n"
                    md_content += "\n"

                if len(items) > 10:
                    md_content += f"*... and {len(items) - 10} more records*\n\n"

            md_content += "---\n\n"

        with open(file_path, 'w', encoding='utf-8') as mdfile:
            mdfile.write(md_content)

    def _flatten_dict(self, d: Dict[str, Any], parent_key: str = '', sep: str = '.') -> Dict[str, Any]:
        """Flatten nested dictionary for CSV/tabular export."""
        items = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(self._flatten_dict(v, new_key, sep=sep).items())
            elif isinstance(v, list):
                # Convert lists to string representation
                items.append((new_key, str(v)))
            else:
                items.append((new_key, v))
        return dict(items)

    def _prepare_table_data(self, items: List[Dict[str, Any]], max_rows: int = 50) -> List[List[str]]:
        """Prepare data for table representation."""
        if not items:
            return []

        # Flatten all items
        flattened_items = [self._flatten_dict(item) for item in items[:max_rows]]
        
        if not flattened_items:
            return []

        # Get all columns
        all_columns = set()
        for item in flattened_items:
            all_columns.update(item.keys())
        
        columns = sorted(list(all_columns))
        
        # Create table data
        table_data = [columns]  # Header row
        
        for item in flattened_items:
            row = []
            for col in columns:
                value = str(item.get(col, ''))
                # Truncate long values for table display
                if len(value) > 50:
                    value = value[:47] + "..."
                row.append(value)
            table_data.append(row)
        
        return table_data

    async def _apply_compression(self, file_path: Path, compression: CompressionType) -> Path:
        """Apply compression to the export file."""
        try:
            if compression == CompressionType.GZIP:
                compressed_path = file_path.with_suffix(file_path.suffix + '.gz')
                
                with open(file_path, 'rb') as f_in:
                    with gzip.open(compressed_path, 'wb', compresslevel=self.compression_level) as f_out:
                        f_out.writelines(f_in)
                
                # Remove original file
                file_path.unlink()
                return compressed_path
                
            elif compression == CompressionType.ZIP:
                compressed_path = file_path.with_suffix('.zip')
                
                with zipfile.ZipFile(compressed_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=self.compression_level) as zf:
                    zf.write(file_path, file_path.name)
                
                # Remove original file
                file_path.unlink()
                return compressed_path
                
            return file_path

        except Exception as e:
            logger.error(f"Compression failed: {e}")
            return file_path

    def _notify_export_progress(self, result: ExportResult, progress: int):
        """Notify about export progress via WebSocket."""
        try:
            if self.websocket_manager:
                # Create progress event
                progress_data = {
                    "export_id": result.export_id,
                    "status": result.status.value,
                    "progress": progress,
                    "records_exported": result.records_exported,
                    "error_message": result.error_message
                }
                
                # Emit WebSocket event
                event = self.websocket_manager.create_system_status(
                    status="healthy",
                    active_agents=[],
                    resource_usage={
                        "cpu_percent": 0,
                        "memory_percent": 0,
                        "memory_mb": 0,
                        "active_threads": 0
                    }
                )
                event.data["export_progress"] = progress_data
                self.websocket_manager.emit_event(event)

        except Exception as e:
            logger.error(f"Error notifying export progress: {e}")

    def get_export_status(self, export_id: str) -> Optional[ExportResult]:
        """Get the status of an export operation."""
        with self.lock:
            # Check active exports
            if export_id in self.active_exports:
                return self.active_exports[export_id]
            
            # Check history
            for result in self.export_history:
                if result.export_id == export_id:
                    return result
        
        return None

    def list_exports(self, limit: int = 50) -> List[ExportResult]:
        """List recent export operations."""
        with self.lock:
            # Combine active and historical exports
            all_exports = list(self.active_exports.values()) + self.export_history
            
            # Sort by creation time and limit
            sorted_exports = sorted(all_exports, key=lambda x: x.export_id, reverse=True)
            return sorted_exports[:limit]

    def cancel_export(self, export_id: str) -> bool:
        """Cancel an active export operation."""
        with self.lock:
            if export_id in self.active_exports:
                result = self.active_exports[export_id]
                result.status = ExportStatus.CANCELLED
                return True
        return False

    def cleanup_old_exports(self, max_age_days: int = 7):
        """Clean up old export files and history."""
        try:
            cutoff_time = time.time() - (max_age_days * 24 * 3600)
            
            # Clean up files
            for file_path in self.output_dir.glob("*"):
                if file_path.is_file() and file_path.stat().st_mtime < cutoff_time:
                    try:
                        file_path.unlink()
                        logger.info(f"Cleaned up old export file: {file_path}")
                    except Exception as e:
                        logger.error(f"Error removing file {file_path}: {e}")

            # Clean up history
            with self.lock:
                self.export_history = [
                    result for result in self.export_history
                    if int(result.export_id.split('_')[1]) / 1000 > cutoff_time
                ]

        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    def get_export_statistics(self) -> Dict[str, Any]:
        """Get export system statistics."""
        with self.lock:
            total_exports = len(self.export_history) + len(self.active_exports)
            completed_exports = len([r for r in self.export_history if r.status == ExportStatus.COMPLETED])
            failed_exports = len([r for r in self.export_history if r.status == ExportStatus.FAILED])
            
            total_size = sum(
                r.file_size for r in self.export_history 
                if r.file_size and r.status == ExportStatus.COMPLETED
            )
            
            return {
                "total_exports": total_exports,
                "active_exports": len(self.active_exports),
                "completed_exports": completed_exports,
                "failed_exports": failed_exports,
                "success_rate": completed_exports / total_exports if total_exports > 0 else 0,
                "total_data_exported_bytes": total_size,
                "export_formats_used": list(set(r.format.value for r in self.export_history))
            }

    def shutdown(self):
        """Shutdown the data exporter and cleanup resources."""
        logger.info("Shutting down data exporter...")
        
        # Cancel active exports
        with self.lock:
            for export_id in list(self.active_exports.keys()):
                self.cancel_export(export_id)
        
        # Shutdown executor
        self.executor.shutdown(wait=True)
        
        logger.info("Data exporter shutdown complete")


# Global exporter instance
_global_exporter: Optional[DataExporter] = None
_exporter_lock = threading.Lock()


def get_data_exporter(
    output_dir: str = "./exports",
    **kwargs
) -> DataExporter:
    """Get or create the global data exporter instance."""
    global _global_exporter
    
    with _exporter_lock:
        if _global_exporter is None:
            _global_exporter = DataExporter(output_dir=output_dir, **kwargs)
    
    return _global_exporter


# Convenience functions
def export_analytics_data(
    format: ExportFormat = ExportFormat.JSON,
    filters: Optional[Dict[str, Any]] = None,
    **kwargs
) -> ExportResult:
    """Convenience function to export analytics data."""
    exporter = get_data_exporter()
    request = exporter.create_export_request(
        format=format,
        data_types=["analytics"],
        filters=filters,
        **kwargs
    )
    return exporter.export_data(request)


def export_all_data(
    format: ExportFormat = ExportFormat.JSON,
    compression: CompressionType = CompressionType.GZIP,
    **kwargs
) -> ExportResult:
    """Convenience function to export all available data."""
    exporter = get_data_exporter()
    request = exporter.create_export_request(
        format=format,
        data_types=["all"],
        compression=compression,
        **kwargs
    )
    return exporter.export_data(request)


# Example usage and testing
if __name__ == "__main__":
    import asyncio
    
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    async def test_data_exporter():
        """Test the data exporter with sample data."""
        print("Testing data exporter...")
        
        # Create exporter
        exporter = DataExporter(output_dir="./test_exports")
        
        # Test JSON export
        request = exporter.create_export_request(
            format=ExportFormat.JSON,
            data_types=["analytics", "performance"],
            filters={"agent_types": ["ego", "shadow"]},
            include_metadata=True
        )
        
        result = await exporter.export_data_async(request)
        
        print(f"Export result: {result}")
        print(f"Export statistics: {exporter.get_export_statistics()}")
        
        # Test CSV export
        csv_request = exporter.create_export_request(
            format=ExportFormat.CSV,
            data_types=["system"],
            compression=CompressionType.GZIP
        )
        
        csv_result = await exporter.export_data_async(csv_request)
        print(f"CSV export result: {csv_result}")
        
        # Cleanup
        exporter.shutdown()
        print("Data exporter test completed")
    
    # Run test
    asyncio.run(test_data_exporter())