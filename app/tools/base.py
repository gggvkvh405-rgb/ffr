"""Базовые структуры для инструментов ассистента."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

Handler = Callable[..., Awaitable[dict] | dict]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Handler
    # Оценка риска: safe | confirm | blocked (может уточняться функцией assess)
    risk: str = "safe"
    assess: Callable[[dict], tuple[str, str]] | None = None
    takes_args: bool = True
    meta: dict[str, Any] = field(default_factory=dict)

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def evaluate(self, args: dict) -> tuple[str, str]:
        if self.assess:
            return self.assess(args)
        return self.risk, ""


def obj(props: dict[str, Any] | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": props or {},
        "required": required or [],
    }


def text(description: str) -> dict:
    return {"type": "string", "description": description}


def integer(description: str) -> dict:
    return {"type": "integer", "description": description}


def boolean(description: str) -> dict:
    return {"type": "boolean", "description": description}


async def run_sync(fn: Callable, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


def ok(output: str, **extra) -> dict:
    return {"ok": True, "output": output, **extra}


def fail(output: str, **extra) -> dict:
    return {"ok": False, "output": output, **extra}
