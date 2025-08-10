"""
Real-time Analytics Dashboard
Advanced statistical analysis and visualization for the Psyche simulation system
"""

import time
import json
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict, deque
from enum import Enum
import asyncio
import threading

logger = logging.getLogger(__name__)


class AnalysisType(Enum):
    """Types of analytics available"""
    COMMUNICATION_PATTERNS = "communication_patterns"
    SENTIMENT_TRENDS = "sentiment_trends"
    AGENT_PERFORMANCE = "agent_performance"
    NETWORK_TOPOLOGY = "network_topology"
    PSYCHOLOGICAL_METRICS = "psychological_metrics"
    SYSTEM_HEALTH = "system_health"
    CONVERSATION_QUALITY = "conversation_quality"


@dataclass
class AnalyticsMetric:
    """Individual analytics metric"""
    name: str
    value: float
    unit: str
    timestamp: float
    category: AnalysisType
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        data = asdict(self)
        data['timestamp_iso'] = datetime.fromtimestamp(self.timestamp).isoformat()
        return data


@dataclass
class TrendAnalysis:
    """Trend analysis results"""
    metric_name: str
    trend_direction: str  # 'increasing', 'decreasing', 'stable'
    trend_strength: float  # 0.0 to 1.0
    correlation_coefficient: float
    p_value: float
    predictions: List[float]
    confidence_interval: Tuple[float, float]
    window_size: int
    analysis_timestamp: float


class StatisticalAnalyzer:
    """Advanced statistical analysis engine"""
    
    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        self.data_buffer: Dict[str, deque] = defaultdict(lambda: deque(maxlen=window_size))
        self.lock = threading.RLock()
    
    def add_data_point(self, metric_name: str, value: float, timestamp: float = None):
        """Add a data point for analysis"""
        if timestamp is None:
            timestamp = time.time()
        
        with self.lock:
            self.data_buffer[metric_name].append((timestamp, value))
    
    def calculate_trend(self, metric_name: str) -> Optional[TrendAnalysis]:
        """Calculate trend analysis for a metric"""
        with self.lock:
            if metric_name not in self.data_buffer or len(self.data_buffer[metric_name]) < 10:
                return None
            
            data = list(self.data_buffer[metric_name])
            timestamps = np.array([d[0] for d in data])
            values = np.array([d[1] for d in data])
            
            # Normalize timestamps to start from 0
            timestamps = timestamps - timestamps[0]
            
            # Calculate linear regression
            correlation_matrix = np.corrcoef(timestamps, values)
            correlation_coefficient = correlation_matrix[0, 1]
            
            # Calculate trend
            slope, intercept = np.polyfit(timestamps, values, 1)
            
            # Determine trend direction
            if abs(slope) < 0.001:
                trend_direction = "stable"
                trend_strength = 0.0
            elif slope > 0:
                trend_direction = "increasing"
                trend_strength = min(1.0, abs(correlation_coefficient))
            else:
                trend_direction = "decreasing"
                trend_strength = min(1.0, abs(correlation_coefficient))
            
            # Simple predictions (linear extrapolation)
            future_timestamps = np.linspace(timestamps[-1], timestamps[-1] + 300, 10)  # Next 5 minutes
            predictions = slope * future_timestamps + intercept
            
            # Confidence interval (simplified)
            std_error = np.std(values - (slope * timestamps + intercept))
            confidence_interval = (predictions[-1] - 2*std_error, predictions[-1] + 2*std_error)
            
            return TrendAnalysis(
                metric_name=metric_name,
                trend_direction=trend_direction,
                trend_strength=trend_strength,
                correlation_coefficient=correlation_coefficient,
                p_value=0.05,  # Simplified for demo
                predictions=predictions.tolist(),
                confidence_interval=confidence_interval,
                window_size=len(data),
                analysis_timestamp=time.time()
            )
    
    def calculate_statistics(self, metric_name: str) -> Dict[str, float]:
        """Calculate comprehensive statistics for a metric"""
        with self.lock:
            if metric_name not in self.data_buffer:
                return {}
            
            values = [d[1] for d in self.data_buffer[metric_name]]
            if not values:
                return {}
            
            values_array = np.array(values)
            
            return {
                "count": len(values),
                "mean": np.mean(values_array),
                "median": np.median(values_array),
                "std": np.std(values_array),
                "min": np.min(values_array),
                "max": np.max(values_array),
                "p25": np.percentile(values_array, 25),
                "p75": np.percentile(values_array, 75),
                "p95": np.percentile(values_array, 95),
                "p99": np.percentile(values_array, 99),
                "variance": np.var(values_array),
                "skewness": self._calculate_skewness(values_array),
                "kurtosis": self._calculate_kurtosis(values_array)
            }
    
    def _calculate_skewness(self, data: np.ndarray) -> float:
        """Calculate skewness of data"""
        mean = np.mean(data)
        std = np.std(data)
        if std == 0:
            return 0.0
        return np.mean(((data - mean) / std) ** 3)
    
    def _calculate_kurtosis(self, data: np.ndarray) -> float:
        """Calculate kurtosis of data"""
        mean = np.mean(data)
        std = np.std(data)
        if std == 0:
            return 0.0
        return np.mean(((data - mean) / std) ** 4) - 3


class PsychologicalAnalyzer:
    """Analyzer for psychological metrics and patterns"""
    
    def __init__(self):
        self.conversation_history = deque(maxlen=1000)
        self.agent_interactions = defaultdict(list)
        self.sentiment_patterns = defaultdict(list)
        self.lock = threading.RLock()
    
    def add_conversation_data(self, from_agent: str, to_agent: str, content: str, 
                           sentiment: Dict[str, float], timestamp: float = None):
        """Add conversation data for analysis"""
        if timestamp is None:
            timestamp = time.time()
        
        with self.lock:
            conversation_entry = {
                'timestamp': timestamp,
                'from_agent': from_agent,
                'to_agent': to_agent,
                'content': content,
                'sentiment': sentiment,
                'word_count': len(content.split()) if content else 0
            }
            
            self.conversation_history.append(conversation_entry)
            self.agent_interactions[from_agent].append(conversation_entry)
            self.sentiment_patterns[from_agent].append(sentiment)
    
    def analyze_communication_patterns(self) -> Dict[str, Any]:
        """Analyze communication patterns between agents"""
        with self.lock:
            if not self.conversation_history:
                return {}
            
            # Communication frequency matrix
            comm_matrix = defaultdict(lambda: defaultdict(int))
            total_messages = 0
            
            for entry in self.conversation_history:
                comm_matrix[entry['from_agent']][entry['to_agent']] += 1
                total_messages += 1
            
            # Calculate communication dominance
            agent_send_counts = defaultdict(int)
            agent_receive_counts = defaultdict(int)
            
            for from_agent, targets in comm_matrix.items():
                for to_agent, count in targets.items():
                    agent_send_counts[from_agent] += count
                    agent_receive_counts[to_agent] += count
            
            # Most active communicators
            most_talkative = max(agent_send_counts.items(), key=lambda x: x[1]) if agent_send_counts else None
            most_popular = max(agent_receive_counts.items(), key=lambda x: x[1]) if agent_receive_counts else None
            
            return {
                "total_messages": total_messages,
                "communication_matrix": dict(comm_matrix),
                "agent_send_counts": dict(agent_send_counts),
                "agent_receive_counts": dict(agent_receive_counts),
                "most_talkative_agent": most_talkative,
                "most_popular_agent": most_popular,
                "communication_balance": self._calculate_communication_balance(agent_send_counts, agent_receive_counts)
            }
    
    def analyze_sentiment_trends(self) -> Dict[str, Any]:
        """Analyze sentiment trends over time"""
        with self.lock:
            if not self.conversation_history:
                return {}
            
            # Overall sentiment trend
            recent_sentiments = []
            agent_sentiment_trends = defaultdict(list)
            
            for entry in self.conversation_history:
                if 'score' in entry['sentiment']:
                    recent_sentiments.append(entry['sentiment']['score'])
                    agent_sentiment_trends[entry['from_agent']].append(entry['sentiment']['score'])
            
            if not recent_sentiments:
                return {}
            
            # Calculate sentiment statistics
            overall_sentiment = {
                "mean": np.mean(recent_sentiments),
                "std": np.std(recent_sentiments),
                "trend": self._calculate_sentiment_trend(recent_sentiments),
                "volatility": np.std(np.diff(recent_sentiments)) if len(recent_sentiments) > 1 else 0
            }
            
            # Per-agent sentiment analysis
            agent_sentiments = {}
            for agent, sentiments in agent_sentiment_trends.items():
                if sentiments:
                    agent_sentiments[agent] = {
                        "mean": np.mean(sentiments),
                        "std": np.std(sentiments),
                        "count": len(sentiments),
                        "trend": self._calculate_sentiment_trend(sentiments)
                    }
            
            return {
                "overall_sentiment": overall_sentiment,
                "agent_sentiments": agent_sentiments,
                "sentiment_distribution": self._calculate_sentiment_distribution(recent_sentiments)
            }
    
    def analyze_conversation_quality(self) -> Dict[str, Any]:
        """Analyze the quality and depth of conversations"""
        with self.lock:
            if not self.conversation_history:
                return {}
            
            # Word count analysis
            word_counts = [entry['word_count'] for entry in self.conversation_history]
            avg_word_count = np.mean(word_counts) if word_counts else 0
            
            # Response time analysis (simplified)
            response_times = []
            for i in range(1, len(self.conversation_history)):
                time_diff = self.conversation_history[i]['timestamp'] - self.conversation_history[i-1]['timestamp']
                if time_diff < 300:  # Less than 5 minutes
                    response_times.append(time_diff)
            
            avg_response_time = np.mean(response_times) if response_times else 0
            
            # Topic diversity (simplified - based on unique words)
            all_words = set()
            for entry in self.conversation_history:
                if entry['content']:
                    words = entry['content'].lower().split()
                    all_words.update(words)
            
            return {
                "average_message_length": avg_word_count,
                "total_vocabulary": len(all_words),
                "average_response_time": avg_response_time,
                "conversation_frequency": len(self.conversation_history) / 3600 if self.conversation_history else 0,  # messages per hour
                "quality_score": self._calculate_quality_score(avg_word_count, len(all_words), avg_response_time)
            }
    
    def _calculate_communication_balance(self, send_counts: Dict, receive_counts: Dict) -> float:
        """Calculate how balanced communication is across agents"""
        if not send_counts:
            return 0.0
        
        send_values = list(send_counts.values())
        receive_values = list(receive_counts.values())
        
        send_balance = 1.0 - (np.std(send_values) / np.mean(send_values)) if np.mean(send_values) > 0 else 0
        receive_balance = 1.0 - (np.std(receive_values) / np.mean(receive_values)) if np.mean(receive_values) > 0 else 0
        
        return (send_balance + receive_balance) / 2
    
    def _calculate_sentiment_trend(self, sentiments: List[float]) -> str:
        """Calculate sentiment trend direction"""
        if len(sentiments) < 2:
            return "stable"
        
        # Simple trend calculation
        recent_half = sentiments[len(sentiments)//2:]
        earlier_half = sentiments[:len(sentiments)//2]
        
        recent_avg = np.mean(recent_half)
        earlier_avg = np.mean(earlier_half)
        
        if recent_avg > earlier_avg + 0.1:
            return "improving"
        elif recent_avg < earlier_avg - 0.1:
            return "declining"
        else:
            return "stable"
    
    def _calculate_sentiment_distribution(self, sentiments: List[float]) -> Dict[str, int]:
        """Calculate sentiment distribution"""
        positive = sum(1 for s in sentiments if s > 0.1)
        negative = sum(1 for s in sentiments if s < -0.1)
        neutral = len(sentiments) - positive - negative
        
        return {
            "positive": positive,
            "negative": negative,
            "neutral": neutral
        }
    
    def _calculate_quality_score(self, avg_length: float, vocabulary: int, response_time: float) -> float:
        """Calculate an overall conversation quality score"""
        # Normalized scoring (0-1)
        length_score = min(1.0, avg_length / 50)  # Normalize to 50 words
        vocab_score = min(1.0, vocabulary / 1000)  # Normalize to 1000 unique words
        time_score = max(0.0, 1.0 - response_time / 60)  # Penalty for slow responses
        
        return (length_score + vocab_score + time_score) / 3


class RealTimeAnalyticsDashboard:
    """Main analytics dashboard coordinator"""
    
    def __init__(self, performance_monitor=None, websocket_manager=None, redis_manager=None):
        self.performance_monitor = performance_monitor
        self.websocket_manager = websocket_manager
        self.redis_manager = redis_manager
        
        # Analytics engines
        self.statistical_analyzer = StatisticalAnalyzer()
        self.psychological_analyzer = PsychologicalAnalyzer()
        
        # Metrics storage
        self.metrics = defaultdict(list)
        self.analytics_cache = {}
        self.cache_ttl = 30  # Cache analytics for 30 seconds
        
        # Background processing
        self.update_interval = 10  # Update every 10 seconds
        self.running = False
        self.update_task = None
        
        logger.info("Real-time analytics dashboard initialized")
    
    def start(self):
        """Start the analytics dashboard"""
        self.running = True
        self.update_task = asyncio.create_task(self._analytics_loop())
        logger.info("Analytics dashboard started")
    
    def stop(self):
        """Stop the analytics dashboard"""
        self.running = False
        if self.update_task:
            self.update_task.cancel()
        logger.info("Analytics dashboard stopped")
    
    async def _analytics_loop(self):
        """Main analytics processing loop"""
        while self.running:
            try:
                await self._update_analytics()
                await asyncio.sleep(self.update_interval)
            except Exception as e:
                logger.error(f"Error in analytics loop: {e}")
                await asyncio.sleep(5)
    
    async def _update_analytics(self):
        """Update all analytics"""
        current_time = time.time()
        
        # Clear old cache
        self.analytics_cache = {
            k: v for k, v in self.analytics_cache.items()
            if current_time - v.get('timestamp', 0) < self.cache_ttl
        }
        
        # Update psychological analytics
        comm_patterns = self.psychological_analyzer.analyze_communication_patterns()
        sentiment_trends = self.psychological_analyzer.analyze_sentiment_trends()
        conversation_quality = self.psychological_analyzer.analyze_conversation_quality()
        
        # Cache results
        self.analytics_cache.update({
            'communication_patterns': {'data': comm_patterns, 'timestamp': current_time},
            'sentiment_trends': {'data': sentiment_trends, 'timestamp': current_time},
            'conversation_quality': {'data': conversation_quality, 'timestamp': current_time}
        })
        
        # Broadcast updates via WebSocket if available
        if self.websocket_manager:
            try:
                from utils.websocket_events import broadcast_system_status
                analytics_summary = self.get_analytics_summary()
                broadcast_system_status(
                    is_running=True,
                    performance_data=analytics_summary,
                    active_agents=list(comm_patterns.get('agent_send_counts', {}).keys())
                )
            except Exception as e:
                logger.warning(f"Could not broadcast analytics update: {e}")
    
    def add_conversation_data(self, from_agent: str, to_agent: str, content: str, sentiment: Dict[str, float]):
        """Add conversation data for analysis"""
        self.psychological_analyzer.add_conversation_data(from_agent, to_agent, content, sentiment)
        
        # Add to statistical analyzer
        if 'score' in sentiment:
            self.statistical_analyzer.add_data_point(f'sentiment_{from_agent}', sentiment['score'])
    
    def add_performance_metric(self, name: str, value: float, category: AnalysisType):
        """Add a performance metric for analysis"""
        metric = AnalyticsMetric(
            name=name,
            value=value,
            unit="",
            timestamp=time.time(),
            category=category
        )
        
        self.metrics[name].append(metric)
        self.statistical_analyzer.add_data_point(name, value)
    
    def get_analytics_summary(self) -> Dict[str, Any]:
        """Get comprehensive analytics summary"""
        current_time = time.time()
        
        # Get cached results
        comm_patterns = self.analytics_cache.get('communication_patterns', {}).get('data', {})
        sentiment_trends = self.analytics_cache.get('sentiment_trends', {}).get('data', {})
        conversation_quality = self.analytics_cache.get('conversation_quality', {}).get('data', {})
        
        # Get trend analyses for key metrics
        trends = {}
        key_metrics = ['sentiment_ego', 'sentiment_shadow', 'response_time', 'message_frequency']
        for metric in key_metrics:
            trend = self.statistical_analyzer.calculate_trend(metric)
            if trend:
                trends[metric] = {
                    'direction': trend.trend_direction,
                    'strength': trend.trend_strength,
                    'predictions': trend.predictions[-3:] if trend.predictions else []
                }
        
        return {
            'timestamp': current_time,
            'communication_patterns': comm_patterns,
            'sentiment_trends': sentiment_trends,
            'conversation_quality': conversation_quality,
            'metric_trends': trends,
            'system_health': {
                'analytics_running': self.running,
                'cache_size': len(self.analytics_cache),
                'data_points': sum(len(data) for data in self.statistical_analyzer.data_buffer.values())
            }
        }
    
    def get_detailed_analysis(self, analysis_type: AnalysisType) -> Dict[str, Any]:
        """Get detailed analysis for a specific type"""
        if analysis_type == AnalysisType.COMMUNICATION_PATTERNS:
            return self.psychological_analyzer.analyze_communication_patterns()
        elif analysis_type == AnalysisType.SENTIMENT_TRENDS:
            return self.psychological_analyzer.analyze_sentiment_trends()
        elif analysis_type == AnalysisType.CONVERSATION_QUALITY:
            return self.psychological_analyzer.analyze_conversation_quality()
        else:
            return {}
    
    def export_analytics_data(self, start_time: Optional[float] = None, 
                            end_time: Optional[float] = None) -> str:
        """Export analytics data as JSON"""
        try:
            current_time = time.time()
            start_time = start_time or (current_time - 3600)  # Last hour by default
            end_time = end_time or current_time
            
            export_data = {
                'export_timestamp': current_time,
                'time_range': {'start': start_time, 'end': end_time},
                'analytics_summary': self.get_analytics_summary(),
                'detailed_metrics': {},
                'statistical_summaries': {}
            }
            
            # Add detailed metrics for each category
            for analysis_type in AnalysisType:
                detailed = self.get_detailed_analysis(analysis_type)
                if detailed:
                    export_data['detailed_metrics'][analysis_type.value] = detailed
            
            # Add statistical summaries
            for metric_name in self.statistical_analyzer.data_buffer.keys():
                stats = self.statistical_analyzer.calculate_statistics(metric_name)
                if stats:
                    export_data['statistical_summaries'][metric_name] = stats
            
            return json.dumps(export_data, indent=2, default=str)
            
        except Exception as e:
            logger.error(f"Error exporting analytics data: {e}")
            return json.dumps({'error': str(e)})


# Global analytics instance
_global_analytics: Optional[RealTimeAnalyticsDashboard] = None
_analytics_lock = threading.Lock()


def get_analytics_dashboard(performance_monitor=None, websocket_manager=None, redis_manager=None) -> RealTimeAnalyticsDashboard:
    """Get or create the global analytics dashboard instance"""
    global _global_analytics
    
    with _analytics_lock:
        if _global_analytics is None:
            _global_analytics = RealTimeAnalyticsDashboard(
                performance_monitor=performance_monitor,
                websocket_manager=websocket_manager,
                redis_manager=redis_manager
            )
    
    return _global_analytics


# Example usage and testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create analytics dashboard
    dashboard = RealTimeAnalyticsDashboard()
    
    # Add sample data
    print("Testing real-time analytics system...")
    
    # Simulate conversation data
    agents = ['ego', 'shadow', 'persona', 'anima_animus', 'self']
    sentiments = [0.8, -0.3, 0.5, 0.2, 0.7]
    
    for i in range(50):
        from_agent = agents[i % len(agents)]
        to_agent = agents[(i + 1) % len(agents)]
        content = f"Sample message {i} from {from_agent}"
        sentiment = {'score': sentiments[i % len(sentiments)] + np.random.normal(0, 0.1)}
        
        dashboard.add_conversation_data(from_agent, to_agent, content, sentiment)
        
        # Add performance metrics
        dashboard.add_performance_metric(
            f'response_time_{from_agent}', 
            100 + np.random.normal(0, 20), 
            AnalysisType.AGENT_PERFORMANCE
        )
    
    # Get analytics summary
    summary = dashboard.get_analytics_summary()
    print(f"Analytics Summary: {json.dumps(summary, indent=2, default=str)[:500]}...")
    
    # Export data
    exported = dashboard.export_analytics_data()
    print(f"Exported data size: {len(exported)} characters")
    
    print("Real-time analytics test completed")