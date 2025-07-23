from abc import ABC, abstractmethod

class Plugin(ABC):
    @abstractmethod
    def execute(self, inputs: dict) -> dict:
        pass