import os
import json
import importlib.util
from typing import Dict, Type

from services.orchestrator.app.plugins.base import Plugin

class PluginManager:
    def __init__(self, plugin_dir: str = "app/plugins"):
        self.plugin_dir = plugin_dir
        self.plugins: Dict[str, Type[Plugin]] = {}
        self._load_plugins()

    def _load_plugins(self):
        for plugin_name in os.listdir(self.plugin_dir):
            plugin_path = os.path.join(self.plugin_dir, plugin_name)
            if os.path.isdir(plugin_path):
                manifest_path = os.path.join(plugin_path, "plugin.json")
                if os.path.exists(manifest_path):
                    with open(manifest_path, "r") as f:
                        manifest = json.load(f)
                    
                    entry_point_file = manifest.get("entry_point")
                    if not entry_point_file:
                        print(f"Warning: Plugin {plugin_name} has no entry_point defined in plugin.json")
                        continue

                    entry_point_path = os.path.join(plugin_path, entry_point_file)
                    if not os.path.exists(entry_point_path):
                        print(f"Warning: Entry point file {entry_point_file} not found for plugin {plugin_name}")
                        continue

                    spec = importlib.util.spec_from_file_location(plugin_name, entry_point_path)
                    if spec and spec.loader:
                        module = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(module)
                        
                        for attr_name in dir(module):
                            attribute = getattr(module, attr_name)
                            if isinstance(attribute, type) and issubclass(attribute, Plugin) and attribute is not Plugin:
                                self.plugins[manifest["name"]] = attribute
                                print(f"Loaded plugin: {manifest['name']} (Version: {manifest.get('version', 'N/A')})")
                                break
                    else:
                        print(f"Warning: Could not load module spec for plugin {plugin_name}")

    def get_plugin_instance(self, plugin_name: str) -> Plugin:
        plugin_class = self.plugins.get(plugin_name)
        if not plugin_class:
            raise ValueError(f"Plugin '{plugin_name}' not found.")
        return plugin_class()