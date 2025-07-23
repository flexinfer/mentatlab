from services.orchestrator.app.plugins.base import Plugin

class EchoPlugin(Plugin):
    def execute(self, inputs: dict) -> dict:
        print(f"EchoPlugin received inputs: {inputs}")
        return inputs