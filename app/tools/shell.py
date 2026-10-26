"""Выполнение команд в оболочке Windows / Linux / macOS."""
from __future__ import annotations

import asyncio
import os
import re
import signal
import subprocess
from pathlib import Path

from ..safety import PLATFORM, classify_command
from .base import Tool, fail, integer, ok, text

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")
MAX_OUTPUT = 5000


def default_workspace() -> Path:
    from ..config import CONFIG

    raw = CONFIG.get("safety.workspace") or str(Path.home())
    path = Path(os.path.expandvars(os.path.expanduser(str(raw))))
    return path if path.exists() else Path.home()


def _decode(raw: bytes | None) -> str:
    if not raw:
        return ""
    for enc in ("utf-8", "cp1251", "cp866", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _argv(command: str, shell: str) -> list[str]:
    if PLATFORM == "nt":
        if shell == "cmd":
            return ["cmd.exe", "/d", "/s", "/c", f"chcp 65001>nul & {command}"]
        exe = "powershell.exe"
        return [
            exe,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            f"[Console]::OutputEncoding=[Text.Encoding]::UTF8; {command}",
        ]
    if shell == "bash":
        return ["bash", "-lc", command]
    return ["/bin/sh", "-c", command]


def run_command_sync(command: str, shell: str, cwd: str | None, timeout: int) -> dict:
    workdir = Path(cwd).expanduser() if cwd else default_workspace()
    if not workdir.exists() or not workdir.is_dir():
        workdir = default_workspace()

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("NO_COLOR", "1")
    env["TERM"] = "dumb"

    kwargs: dict = {}
    if PLATFORM == "nt":
        kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
    else:
        kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(
            _argv(command, shell),
            cwd=str(workdir),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            **kwargs,
        )
    except FileNotFoundError:
        return fail(f"Оболочка «{shell}» не найдена на этой системе")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось запустить команду: {exc}")

    try:
        raw, _ = proc.communicate(timeout=max(1, min(timeout, 180)))
        timed_out = False
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            if PLATFORM == "nt":
                proc.kill()
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                await_deadline = 2
                try:
                    proc.wait(timeout=await_deadline)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:  # noqa: BLE001
            proc.kill()
        raw, _ = proc.communicate()

    output = ANSI_RE.sub("", _decode(raw)).replace("\r\n", "\n").strip()
    truncated = len(output) > MAX_OUTPUT
    if truncated:
        output = output[:MAX_OUTPUT] + f"\n… (обрезано, всего {len(output)} символов)"
    if not output:
        output = (
            f"Прервано по таймауту {timeout} с — команда не дала вывода."
            if timed_out
            else "Команда выполнена без вывода."
        )

    exit_code = proc.returncode
    header = f"$ {command}\n"
    if timed_out:
        header = f"$ {command}\n(прервано по таймауту {timeout} с)\n"
    body = output
    result = ok(f"{header}{body}", exit_code=exit_code, truncated=truncated)
    if timed_out or (exit_code not in (0, None)):
        result["ok"] = False
    return result


async def _run_command(
    command: str,
    shell: str = "auto",
    cwd: str | None = None,
    timeout: int = 45,
) -> dict:
    if shell == "auto":
        shell = "powershell" if PLATFORM == "nt" else "bash"
    return await asyncio.to_thread(run_command_sync, command, shell, cwd, timeout)


TOOL_RUN_COMMAND = Tool(
    name="run_command",
    description=(
        "Выполнить команду в терминале на компьютере пользователя и вернуть её вывод. "
        "Используй для любых действий в системе: управление файлами, программами, службами, "
        "установка пакетов, получение информации. Пиши команды под текущую ОС "
        f"(сейчас {'Windows' if PLATFORM == 'nt' else 'Linux/macOS'}). "
        "Не используй интерактивные команды, ожидающие ввода."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": text("Команда целиком, например: Get-ChildItem C:\\Users или ls -la ~"),
            "shell": {
                "type": "string",
                "enum": ["auto", "powershell", "cmd", "bash"],
                "description": "Оболочка. На Windows: powershell или cmd. На Linux/macOS: bash.",
            },
            "cwd": text("Рабочая папка (необязательно)"),
            "timeout": integer("Таймаут в секундах, по умолчанию 45, максимум 180"),
        },
        "required": ["command"],
    },
    handler=_run_command,
    assess=lambda args: classify_command(str(args.get("command", ""))),
    meta={"icon": "terminal"},
)
