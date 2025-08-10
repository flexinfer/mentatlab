"""
Analytics Export Integration for Psyche Simulation
Enhanced integration between real-time analytics and export system
with specialized psychology data formatting and filtering.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable

try:
    from analysis.real_time_analytics import (
        get_analytics_dashboard, RealTimeAnalyticsDashboard, 
        AnalysisType, StatisticalAnalyzer, PsychologicalAnalyzer
    )
    from utils.data_exporter import (
        DataExporter, ExportRequest, ExportResult, ExportFormat,
        ExportStatus, CompressionType, get_data_exporter
    )
    from ui.export_components import ExportDialog, ExportButton
    from utils.websocket_events import get_event_manager, EventType
    from utils.performance_monitor import get_performance_monitor
except ImportError as e:
    logging.warning(f"Some integration dependencies not available: {e}")

logger = logging.getLogger(__name__)


class AnalyticsExportManager:
    """
    Specialized manager for analytics data export with psychology-focused
    data formatting and enhanced filtering capabilities.
    """
    
    def __init__(self):
        """Initialize the analytics export manager."""
        self.analytics_dashboard = None
        self.data_exporter = None
        self.performance_monitor = None
        self.websocket_manager = None
        
        try:
            self.analytics_dashboard = get_analytics_dashboard()
            self.data_exporter = get_data_exporter()
            self.performance_monitor = get_performance_monitor()
            self.websocket_manager = get_event_manager()
        except Exception as e:
            logger.warning(f"Could not initialize all components: {e}")
    
    def create_psychology_export_request(
        self,
        format: ExportFormat = ExportFormat.JSON,
        time_range_hours: int = 24,
        agent_types: Optional[List[str]] = None,
        include_sentiment_analysis: bool = True,
        include_conversation_patterns: bool = True,
        include_psychological_metrics: bool = True,
        compression: CompressionType = CompressionType.NONE,
        **kwargs
    ) -> Optional[ExportRequest]:
        """
        Create a specialized export request for psychology data.
        
        Args:
            format: Export format
            time_range_hours: Hours of data to export
            agent_types: Specific agent types to include
            include_sentiment_analysis: Include sentiment data
            include_conversation_patterns: Include conversation analysis
            include_psychological_metrics: Include psychological metrics
            compression: Compression type
            **kwargs: Additional export parameters
        
        Returns:
            ExportRequest configured for psychology data
        """
        if not self.data_exporter:
            logger.error("Data exporter not available")
            return None
        
        # Configure data types based on psychology focus
        data_types = ["analytics"]
        
        if include_conversation_patterns:
            data_types.append("conversations")
        
        if include_psychological_metrics:
            data_types.extend(["performance", "agents"])
        
        # Configure filters
        filters = {}
        
        # Time range filter
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=time_range_hours)
        filters['start_time'] = start_time
        filters['end_time'] = end_time
        
        # Agent type filter
        if agent_types:
            filters['agent_types'] = agent_types
        
        # Psychology-specific filters
        if include_sentiment_analysis:
            filters['include_sentiment'] = True
        
        # Create request
        request = self.data_exporter.create_export_request(
            format=format,
            data_types=data_types,
            filters=filters,
            compression=compression,
            include_metadata=True,
            **kwargs
        )
        
        return request
    
    async def export_psychology_session(
        self,
        session_name: str = "psychology_session",
        format: ExportFormat = ExportFormat.JSON,
        include_charts: bool = False
    ) -> Optional[ExportResult]:
        """
        Export a complete psychology session with all relevant data.
        
        Args:
            session_name: Name for the export session
            format: Export format
            include_charts: Include charts in PDF exports
        
        Returns:
            ExportResult with session data
        """
        if not self.analytics_dashboard or not self.data_exporter:
            logger.error("Required components not available")
            return None
        
        try:
            # Create comprehensive export request
            request = self.create_psychology_export_request(
                format=format,
                time_range_hours=24,  # Full day session
                include_sentiment_analysis=True,
                include_conversation_patterns=True,
                include_psychological_metrics=True,
                include_charts=include_charts,
                filename=f"{session_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            )
            
            if not request:
                return None
            
            # Add psychology-specific callback
            request.callback = self._on_psychology_export_complete
            
            # Execute export
            result = await self.data_exporter.export_data_async(request)
            
            if result.status == ExportStatus.COMPLETED:
                logger.info(f"Psychology session export completed: {result.file_path}")
            else:
                logger.error(f"Psychology session export failed: {result.error_message}")
            
            return result
            
        except Exception as e:
            logger.error(f"Error exporting psychology session: {e}")
            return None
    
    def get_psychology_data_summary(self) -> Dict[str, Any]:
        """
        Get a summary of available psychology data for export.
        
        Returns:
            Dictionary with data availability summary
        """
        summary = {
            "analytics_available": False,
            "conversation_data_count": 0,
            "sentiment_data_points": 0,
            "agent_types": [],
            "time_range": {},
            "data_types": []
        }
        
        try:
            if self.analytics_dashboard:
                analytics_summary = self.analytics_dashboard.get_analytics_summary()
                
                summary["analytics_available"] = True
                summary["time_range"] = {
                    "start": analytics_summary.get("timestamp", 0) - 3600,  # Last hour
                    "end": analytics_summary.get("timestamp", 0)
                }
                
                # Extract conversation data info
                comm_patterns = analytics_summary.get("communication_patterns", {})
                if comm_patterns:
                    summary["conversation_data_count"] = comm_patterns.get("total_messages", 0)
                    summary["agent_types"] = list(comm_patterns.get("agent_send_counts", {}).keys())
                
                # Extract sentiment data info
                sentiment_trends = analytics_summary.get("sentiment_trends", {})
                if sentiment_trends:
                    agent_sentiments = sentiment_trends.get("agent_sentiments", {})
                    summary["sentiment_data_points"] = sum(
                        agent_data.get("count", 0) for agent_data in agent_sentiments.values()
                    )
                
                # Available data types
                summary["data_types"] = ["analytics", "conversations", "performance", "system"]
                
        except Exception as e:
            logger.error(f"Error getting psychology data summary: {e}")
        
        return summary
    
    def create_quick_export_buttons(self, container) -> List[ExportButton]:
        """
        Create quick export buttons for common psychology export scenarios.
        
        Args:
            container: UI container to add buttons to
        
        Returns:
            List of created ExportButton instances
        """
        buttons = []
        
        try:
            # Analytics JSON export
            analytics_button = ExportButton(
                container,
                label="Export Analytics",
                icon="analytics",
                default_format=ExportFormat.JSON,
                default_data_types=["analytics"],
                quick_export=True
            )
            buttons.append(analytics_button)
            
            # Conversation CSV export
            conversation_button = ExportButton(
                container,
                label="Export Conversations",
                icon="chat",
                default_format=ExportFormat.CSV,
                default_data_types=["conversations"],
                quick_export=True
            )
            buttons.append(conversation_button)
            
            # Full psychology PDF report
            report_button = ExportButton(
                container,
                label="Psychology Report",
                icon="picture_as_pdf",
                default_format=ExportFormat.PDF,
                default_data_types=["analytics", "conversations", "performance"]
            )
            buttons.append(report_button)
            
        except Exception as e:
            logger.error(f"Error creating export buttons: {e}")
        
        return buttons
    
    async def _on_psychology_export_complete(self, result: ExportResult):
        """Handle completion of psychology export."""
        try:
            if result.status == ExportStatus.COMPLETED:
                # Broadcast export completion via WebSocket
                if self.websocket_manager:
                    event_data = {
                        "export_id": result.export_id,
                        "export_type": "psychology_session",
                        "file_path": result.file_path,
                        "file_size": result.file_size,
                        "records_exported": result.records_exported,
                        "duration_seconds": result.duration_seconds
                    }
                    
                    # Create system status event with export info
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
                    event.data["psychology_export_completed"] = event_data
                    self.websocket_manager.emit_event(event)
                
                logger.info(f"Psychology export completed successfully: {result.export_id}")
            else:
                logger.error(f"Psychology export failed: {result.error_message}")
                
        except Exception as e:
            logger.error(f"Error in psychology export completion handler: {e}")
    
    def get_export_recommendations(self) -> List[Dict[str, Any]]:
        """
        Get recommendations for export based on current data state.
        
        Returns:
            List of export recommendations
        """
        recommendations = []
        
        try:
            data_summary = self.get_psychology_data_summary()
            
            # Recommend based on data availability
            if data_summary["analytics_available"]:
                if data_summary["conversation_data_count"] > 50:
                    recommendations.append({
                        "title": "Export Conversation Analysis",
                        "description": f"You have {data_summary['conversation_data_count']} conversation records ready for analysis export.",
                        "format": ExportFormat.CSV,
                        "data_types": ["conversations", "analytics"],
                        "priority": "high"
                    })
                
                if data_summary["sentiment_data_points"] > 100:
                    recommendations.append({
                        "title": "Export Sentiment Timeline",
                        "description": f"Rich sentiment data ({data_summary['sentiment_data_points']} points) available for trend analysis.",
                        "format": ExportFormat.JSON,
                        "data_types": ["analytics"],
                        "priority": "medium"
                    })
                
                if len(data_summary["agent_types"]) >= 3:
                    recommendations.append({
                        "title": "Generate Psychology Report",
                        "description": f"Complete psychological profile data for {len(data_summary['agent_types'])} agents available.",
                        "format": ExportFormat.PDF,
                        "data_types": ["analytics", "conversations", "performance"],
                        "priority": "high"
                    })
            
        except Exception as e:
            logger.error(f"Error generating export recommendations: {e}")
        
        return recommendations


# Global analytics export manager instance
_global_analytics_export_manager: Optional[AnalyticsExportManager] = None


def get_analytics_export_manager() -> AnalyticsExportManager:
    """Get or create the global analytics export manager instance."""
    global _global_analytics_export_manager
    
    if _global_analytics_export_manager is None:
        _global_analytics_export_manager = AnalyticsExportManager()
    
    return _global_analytics_export_manager


# Convenience functions for integration
def add_analytics_export_buttons(container):
    """Add analytics export buttons to a UI container."""
    manager = get_analytics_export_manager()
    return manager.create_quick_export_buttons(container)


async def export_current_psychology_session(
    format: ExportFormat = ExportFormat.JSON
) -> Optional[ExportResult]:
    """Quick function to export current psychology session."""
    manager = get_analytics_export_manager()
    return await manager.export_psychology_session(format=format)


def get_psychology_export_recommendations() -> List[Dict[str, Any]]:
    """Get export recommendations based on current data."""
    manager = get_analytics_export_manager()
    return manager.get_export_recommendations()


# Example usage and testing
if __name__ == "__main__":
    import asyncio
    
    async def test_analytics_export_integration():
        """Test the analytics export integration."""
        print("Testing analytics export integration...")
        
        # Initialize manager
        manager = AnalyticsExportManager()
        
        # Get data summary
        summary = manager.get_psychology_data_summary()
        print(f"Data summary: {json.dumps(summary, indent=2, default=str)}")
        
        # Get recommendations
        recommendations = manager.get_export_recommendations()
        print(f"Export recommendations: {len(recommendations)}")
        for rec in recommendations:
            print(f"  - {rec['title']}: {rec['description']}")
        
        # Test export request creation
        request = manager.create_psychology_export_request(
            format=ExportFormat.JSON,
            time_range_hours=1,
            agent_types=["ego", "shadow"],
            include_sentiment_analysis=True
        )
        
        if request:
            print(f"Created export request: {request.export_id}")
            print(f"Data types: {request.data_types}")
            print(f"Filters: {request.filters}")
        
        print("Analytics export integration test completed")
    
    # Run test
    asyncio.run(test_analytics_export_integration())