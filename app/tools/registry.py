"""Реестр всех инструментов ассистента."""
from __future__ import annotations

from .base import Tool
from .files import TOOL_LIST_DIR, TOOL_READ_FILE, TOOL_SEARCH_FILES, TOOL_WRITE_FILE
from .memory_tools import (
    TOOL_CANCEL_TIMER,
    TOOL_FORGET,
    TOOL_LIST_TIMERS,
    TOOL_RECALL,
    TOOL_REMEMBER,
    TOOL_SET_TIMER,
)
from .os_actions import (
    TOOL_CLIPBOARD,
    TOOL_MEDIA_CONTROL,
    TOOL_NOTIFY,
    TOOL_OPEN_APP,
    TOOL_OPEN_PATH,
    TOOL_POWER_ACTION,
)
from .processes import TOOL_CLOSE_PROCESS, TOOL_LIST_PROCESSES
from .shell import TOOL_RUN_COMMAND
from .system import TOOL_SCREENSHOT, TOOL_SYSTEM_INFO
from .web import TOOL_HTTP_GET, TOOL_NEWS, TOOL_TIME, TOOL_WEATHER, TOOL_WEB_SEARCH

TOOLS: list[Tool] = [
    TOOL_RUN_COMMAND,
    TOOL_SYSTEM_INFO,
    TOOL_LIST_DIR,
    TOOL_READ_FILE,
    TOOL_WRITE_FILE,
    TOOL_SEARCH_FILES,
    TOOL_OPEN_PATH,
    TOOL_OPEN_APP,
    TOOL_SCREENSHOT,
    TOOL_LIST_PROCESSES,
    TOOL_CLOSE_PROCESS,
    TOOL_MEDIA_CONTROL,
    TOOL_POWER_ACTION,
    TOOL_CLIPBOARD,
    TOOL_NOTIFY,
    TOOL_WEB_SEARCH,
    TOOL_HTTP_GET,
    TOOL_WEATHER,
    TOOL_NEWS,
    TOOL_TIME,
    TOOL_REMEMBER,
    TOOL_RECALL,
    TOOL_FORGET,
    TOOL_SET_TIMER,
    TOOL_CANCEL_TIMER,
    TOOL_LIST_TIMERS,
]

TOOLS_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in TOOLS}

def tool_schemas() -> list[dict]:
    return [tool.schema() for tool in TOOLS]


def find(name: str) -> Tool | None:
    return TOOLS_BY_NAME.get(name)


def catalog_text() -> str:
    lines = []
    for tool in TOOLS:
        params = tool.parameters.get("properties", {})
        args = ", ".join(
            f"{key}: {value.get('type', 'string')}" for key, value in params.items()
        )
        lines.append(f"- {tool.name}({args}) — {tool.description}")
    return "\n".join(lines)
