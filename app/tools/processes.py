"""Процессы: список и завершение."""
from __future__ import annotations

import subprocess

from ..safety import PLATFORM
from .base import Tool, fail, integer, obj, ok, text

try:
    import psutil
except Exception:  # noqa: BLE001
    psutil = None  # type: ignore[assignment]

PROTECTED = {
    "system", "system idle process", "svchost.exe", "csrss.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "lsass.exe", "smss.exe", "explorer.exe",
    "dwm.exe", "fontdrvhost.exe", "audiodg.exe", "rdpclip.exe", "python.exe",
    "python3", "node", "uvicorn", "systemd", "init", "kernel_task", "launchd",
}


def _human(num: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if num < 1024:
            return f"{num:.0f} {unit}"
        num /= 1024
    return f"{num:.1f} ТБ"


def _list_processes(limit: int = 25) -> dict:
    if not psutil:
        return fail("Модуль psutil не установлен. Выполните: pip install psutil")
    limit = max(5, min(int(limit or 25), 80))
    rows = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info"]):
        try:
            info = proc.info
            mem = info.get("memory_info")
            rows.append(
                {
                    "pid": info["pid"],
                    "name": info.get("name") or "?",
                    "ram": mem.rss if mem else 0,
                }
            )
        except Exception:  # noqa: BLE001
            continue
    rows.sort(key=lambda r: r["ram"], reverse=True)
    rows = rows[:limit]
    lines = [f"Запущенные процессы (топ {len(rows)} по памяти):"]
    for row in rows:
        lines.append(f"• {row['name']} — PID {row['pid']}, {_human(row['ram'])}")
    return ok("\n".join(lines), processes=rows)


def _close_process(name: str = "", pid: int = 0) -> dict:
    if not psutil:
        return fail("Модуль psutil не установлен. Выполните: pip install psutil")
    if not name and not pid:
        return fail("Укажите имя процесса или PID")

    targets = []
    if pid:
        try:
            targets = [psutil.Process(int(pid))]
        except Exception:  # noqa: BLE001
            return fail(f"Процесс с PID {pid} не найден")
    else:
        for proc in psutil.process_iter(["name"]):
            try:
                if (proc.info.get("name") or "").lower() == name.lower():
                    targets.append(proc)
            except Exception:  # noqa: BLE001
                continue
    if not targets:
        return fail(f"Процесс «{name or pid}» не найден")

    for proc in targets:
        try:
            proc_name = (proc.name() or "").lower()
        except Exception:  # noqa: BLE001
            proc_name = ""
        if proc_name in PROTECTED:
            return fail(f"Не буду закрывать системный процесс {proc_name}")

    killed, errors = [], []
    for proc in targets:
        try:
            name_now = proc.name()
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:  # noqa: BLE001
                proc.kill()
            killed.append(f"{name_now} (PID {proc.pid})")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
    if killed:
        return ok("Завершено: " + ", ".join(killed))
    return fail("Не удалось завершить: " + "; ".join(errors))


TOOL_LIST_PROCESSES = Tool(
    name="list_processes",
    description="Показать запущенные процессы с потреблением памяти.",
    parameters=obj({"limit": integer("Сколько процессов показать (по умолчанию 25)")}),
    handler=_list_processes,
    meta={"icon": "activity"},
)

TOOL_CLOSE_PROCESS = Tool(
    name="close_process",
    description="Завершить процесс по имени (chrome.exe) или PID. Требует подтверждения.",
    parameters=obj(
        {
            "name": text("Имя процесса, например chrome.exe"),
            "pid": integer("PID процесса"),
        }
    ),
    handler=_close_process,
    risk="confirm",
    meta={"icon": "x"},
)
