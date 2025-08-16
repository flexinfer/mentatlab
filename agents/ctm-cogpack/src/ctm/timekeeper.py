"""
TimeKeeper module for managing tick-based temporal processing.
"""
import time
import asyncio
from typing import Optional
from .config import TickConfig


class TimeKeeper:
    """
    Manages the tick loop and temporal encoding for CTM.
    """
    
    def __init__(self, config: TickConfig):
        self.config = config
        self.current_tick = 0
        self.start_time = None
        self.tick_times = []
        
    def reset(self):
        """Reset the timekeeper state."""
        self.current_tick = 0
        self.start_time = time.time()
        self.tick_times = []
        
    def tick(self) -> int:
        """Advance to the next tick and return the current tick number."""
        if self.start_time is None:
            self.start_time = time.time()
        
        self.tick_times.append(time.time())
        tick = self.current_tick
        self.current_tick += 1
        return tick
        
    async def wait_for_next_tick(self):
        """Wait for the configured tick interval."""
        await asyncio.sleep(self.config.tick_interval)
        
    def get_elapsed_time(self) -> float:
        """Get elapsed time since start in seconds."""
        if self.start_time is None:
            return 0.0
        return time.time() - self.start_time
        
    def get_tick_rate(self) -> float:
        """Calculate the actual tick rate (ticks per second)."""
        if len(self.tick_times) < 2:
            return 0.0
        
        elapsed = self.tick_times[-1] - self.tick_times[0]
        if elapsed == 0:
            return 0.0
            
        return len(self.tick_times) / elapsed
        
    def should_continue(self) -> bool:
        """Check if we should continue ticking."""
        return self.current_tick < self.config.max_ticks
        
    def get_progress(self) -> float:
        """Get progress as a fraction of max_ticks."""
        return min(1.0, self.current_tick / self.config.max_ticks)
        
    def get_temporal_encoding(self, tick: int) -> list:
        """
        Generate a temporal encoding for the given tick.
        Uses sinusoidal position encoding.
        """
        import math
        
        encoding = []
        for i in range(self.config.time_encoding_dim // 2):
            freq = 1.0 / (10000 ** (2 * i / self.config.time_encoding_dim))
            encoding.append(math.sin(tick * freq))
            encoding.append(math.cos(tick * freq))
            
        # Ensure we have exactly time_encoding_dim values
        if len(encoding) < self.config.time_encoding_dim:
            encoding.append(0.0)
            
        return encoding[:self.config.time_encoding_dim]