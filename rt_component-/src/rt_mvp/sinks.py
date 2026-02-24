from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable, Dict, List
import json, os

class EventSink:
    def emit(self, event: Dict[str, Any]) -> None:
        raise NotImplementedError

@dataclass
class JsonlSink(EventSink):
    path: str
    def emit(self, event: Dict[str, Any]) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")

@dataclass
class MemorySink(EventSink):
    events: List[Dict[str, Any]]
    def emit(self, event: Dict[str, Any]) -> None:
        self.events.append(event)

@dataclass
class CallbackSink(EventSink):
    cb: Callable[[Dict[str, Any]], None]
    def emit(self, event: Dict[str, Any]) -> None:
        self.cb(event)
