#!/usr/bin/env python3
"""
Comprehensive cache clearing and restart script for Psyche Simulation
This will ensure all changes are properly loaded
"""

import os
import sys
import subprocess
import shutil
import time
import signal
from pathlib import Path

def print_section(title):
    """Print a section header"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def run_command(cmd, description):
    """Run a command and show the result"""
    print(f"🔧 {description}...")
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ {description} - SUCCESS")
            if result.stdout:
                print(f"   Output: {result.stdout.strip()}")
        else:
            print(f"❌ {description} - FAILED")
            if result.stderr:
                print(f"   Error: {result.stderr.strip()}")
        return result.returncode == 0
    except Exception as e:
        print(f"❌ {description} - ERROR: {e}")
        return False

def main():
    print("🧹 Psyche Simulation - Complete Cache Clear and Restart")
    print("=" * 60)
    
    # Step 1: Kill any running Python processes
    print_section("Step 1: Stopping Running Processes")
    
    # Find and kill psyche_simulation processes
    run_command(
        "pkill -f psyche_simulation || true",
        "Kill psyche_simulation processes"
    )
    
    # Kill any Python processes on port 8000
    run_command(
        "lsof -ti:8000 | xargs kill -9 2>/dev/null || true",
        "Kill processes on port 8000"
    )
    
    # Wait a moment for processes to die
    time.sleep(2)
    
    # Step 2: Clear Python cache
    print_section("Step 2: Clearing Python Cache")
    
    # Remove all __pycache__ directories
    cache_count = 0
    for root, dirs, files in os.walk('.'):
        if '__pycache__' in dirs:
            cache_path = os.path.join(root, '__pycache__')
            try:
                shutil.rmtree(cache_path)
                cache_count += 1
                print(f"   Removed: {cache_path}")
            except Exception as e:
                print(f"   Failed to remove {cache_path}: {e}")
    
    print(f"✅ Removed {cache_count} __pycache__ directories")
    
    # Remove .pyc files
    pyc_count = 0
    for root, dirs, files in os.walk('.'):
        for file in files:
            if file.endswith('.pyc'):
                file_path = os.path.join(root, file)
                try:
                    os.remove(file_path)
                    pyc_count += 1
                except Exception as e:
                    print(f"   Failed to remove {file_path}: {e}")
    
    print(f"✅ Removed {pyc_count} .pyc files")
    
    # Step 3: Clear NiceGUI cache if it exists
    print_section("Step 3: Clearing NiceGUI Cache")
    
    nicegui_cache_paths = [
        '.nicegui',
        os.path.expanduser('~/.nicegui'),
        os.path.expanduser('~/.cache/nicegui')
    ]
    
    for cache_path in nicegui_cache_paths:
        if os.path.exists(cache_path):
            try:
                shutil.rmtree(cache_path)
                print(f"✅ Removed NiceGUI cache: {cache_path}")
            except Exception as e:
                print(f"❌ Failed to remove {cache_path}: {e}")
    
    # Step 4: Verify new files exist
    print_section("Step 4: Verifying New Files")
    
    critical_files = [
        'utils/broadcast.py',
        'ui/components.py',
        'utils/websocket_broadcaster.py',
        'utils/websocket_events.py'
    ]
    
    all_files_present = True
    for file_path in critical_files:
        if os.path.exists(file_path):
            print(f"✅ File exists: {file_path}")
        else:
            print(f"❌ Missing file: {file_path}")
            all_files_present = False
    
    if not all_files_present:
        print("\n⚠️  WARNING: Some critical files are missing!")
        print("   The real-time features won't work without these files.")
        return
    
    # Step 5: Test imports
    print_section("Step 5: Testing Imports")
    
    test_imports = [
        "from utils.broadcast import broadcast",
        "from ui.components import UIManager",
        "from utils.websocket_broadcaster import WebSocketBroadcaster, RealtimeUIUpdater",
        "from utils.websocket_events import EventType"
    ]
    
    for import_stmt in test_imports:
        try:
            exec(import_stmt)
            print(f"✅ Import successful: {import_stmt}")
        except Exception as e:
            print(f"❌ Import failed: {import_stmt}")
            print(f"   Error: {e}")
    
    # Step 6: Clear browser cache instructions
    print_section("Step 6: Browser Cache")
    
    print("⚠️  IMPORTANT: Clear your browser cache!")
    print("   1. Open your browser's developer tools (F12)")
    print("   2. Right-click the refresh button")
    print("   3. Select 'Empty Cache and Hard Reload'")
    print("   Or use:")
    print("   - Chrome/Edge: Ctrl+Shift+R (Cmd+Shift+R on Mac)")
    print("   - Firefox: Ctrl+F5 (Cmd+Shift+R on Mac)")
    print("   - Safari: Cmd+Option+R")
    
    # Step 7: Environment variables
    print_section("Step 7: Environment Check")
    
    env_vars = {
        'REDIS_URL': os.getenv('REDIS_URL', 'Not set - using default'),
        'STORAGE_SECRET': 'SET' if os.getenv('STORAGE_SECRET') else 'NOT SET - REQUIRED!'
    }
    
    for var, value in env_vars.items():
        print(f"   {var}: {value}")
    
    # Step 8: Start instructions
    print_section("Ready to Start!")
    
    print("✅ All caches cleared and files verified!")
    print("\n🚀 To start the application with fresh code:")
    print("   python psyche_simulation.py")
    print("\n📝 Or to see detailed output:")
    print("   python psyche_simulation.py 2>&1 | tee app.log")
    print("\n🔍 Watch for:")
    print("   - 'WebSocket endpoint registered' message")
    print("   - 'Broadcaster initialized' message")
    print("   - Any import errors at startup")
    
    # Optional: Ask if user wants to start now
    print("\n" + "="*60)
    response = input("\n🚀 Start the application now? (y/n): ").strip().lower()
    
    if response == 'y':
        print("\n🚀 Starting Psyche Simulation...")
        print("   Press Ctrl+C to stop\n")
        
        try:
            # Start the application
            subprocess.run([sys.executable, 'psyche_simulation.py'])
        except KeyboardInterrupt:
            print("\n\n✅ Application stopped by user")

if __name__ == "__main__":
    main()