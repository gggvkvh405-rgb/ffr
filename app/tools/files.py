"""Работа с файлами и папками."""
from __future__ import annotations

import fnmatch
import os
import time
from pathlib import Path

from ..safety import guard_path
from .base import Tool, boolean, fail, integer, obj, ok, text

SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "AppData", "Windows", "System32",
    "__pycache__", ".cache", "$Recycle.Bin", "Program Files", "Program Files (x86)",
}


def _human_size(num: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if num < 1024:
            return f"{num:.0f} {unit}" if unit == "Б" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} ПБ"


def _list_dir(path: str = ".", show_hidden: bool = False) -> dict:
    ok_path, error, resolved = guard_path(path or ".", write=False)
    if not ok_path or resolved is None:
        return fail(error)
    if not resolved.exists():
        return fail(f"Папка не найдена: {resolved}")
    if not resolved.is_dir():
        return fail(f"Это не папка: {resolved}")

    entries = []
    try:
        for item in sorted(resolved.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if not show_hidden and item.name.startswith("."):
                continue
            try:
                stat = item.stat()
                kind = "папка" if item.is_dir() else item.suffix.lstrip(".") or "файл"
                entries.append(
                    {
                        "name": item.name,
                        "kind": kind,
                        "size": stat.st_size,
                        "modified": time.strftime("%d.%m.%Y %H:%M", time.localtime(stat.st_mtime)),
                    }
                )
            except OSError:
                continue
            if len(entries) >= 250:
                break
    except PermissionError:
        return fail(f"Нет доступа к папке: {resolved}")

    lines = [f"Содержимое {resolved} ({len(entries)} объектов):"]
    for entry in entries:
        size = "" if entry["kind"] == "папка" else f" — {_human_size(entry['size'])}"
        lines.append(f"• {entry['name']} [{entry['kind']}]{size}")
    if not entries:
        lines.append("(пусто)")
    return ok("\n".join(lines), path=str(resolved), entries=entries)


def _read_file(path: str, max_chars: int = 12000) -> dict:
    ok_path, error, resolved = guard_path(path, write=False)
    if not ok_path or resolved is None:
        return fail(error)
    if not resolved.exists():
        return fail(f"Файл не найден: {resolved}")
    if resolved.is_dir():
        return fail("Это папка, а не файл. Используй list_dir.")
    try:
        if resolved.stat().st_size > 40 * 1024 * 1024:
            return fail("Файл слишком большой (>40 МБ)")
        raw = resolved.read_bytes()
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось прочитать файл: {exc}")
    if b"\x00" in raw[:2048]:
        return fail("Похоже, это бинарный файл, текстом его не прочитать")
    content = raw.decode("utf-8", errors="replace")
    truncated = len(content) > max_chars
    if truncated:
        content = content[:max_chars] + f"\n… (показаны первые {max_chars} символов)"
    return ok(f"Файл {resolved}:\n\n{content}", path=str(resolved), truncated=truncated)


def _write_file(path: str, content: str, append: bool = False) -> dict:
    ok_path, error, resolved = guard_path(path, write=True)
    if not ok_path or resolved is None:
        return fail(error)
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with resolved.open(mode, encoding="utf-8", newline="\n") as handle:
            handle.write(content)
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось записать файл: {exc}")
    action = "дописан" if append else "сохранён"
    return ok(f"Файл {action}: {resolved} ({len(content)} символов)", path=str(resolved))


def _search_files(pattern: str, root: str = "", max_results: int = 30) -> dict:
    base = root or str(Path.home())
    ok_path, error, resolved = guard_path(base, write=False)
    if not ok_path or resolved is None:
        return fail(error)
    if not resolved.is_dir():
        return fail(f"Стартовая папка не найдена: {resolved}")

    pattern = pattern or "*"
    matches: list[str] = []
    started = time.time()
    for current, dirs, files in os.walk(resolved):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith("$")]
        depth = len(Path(current).relative_to(resolved).parts)
        if depth >= 4:
            dirs[:] = []
        for name in files:
            if fnmatch.fnmatch(name.lower(), pattern.lower()):
                full = Path(current) / name
                try:
                    size = _human_size(full.stat().st_size)
                except OSError:
                    size = "?"
                matches.append(f"{full} ({size})")
                if len(matches) >= max_results:
                    break
        if len(matches) >= max_results or time.time() - started > 20:
            break

    if not matches:
        return ok(f"По шаблону «{pattern}» ничего не найдено в {resolved}")
    return ok(
        f"Найдено {len(matches)} файлов по шаблону «{pattern}»:\n" + "\n".join(f"• {m}" for m in matches)
    )


TOOL_LIST_DIR = Tool(
    name="list_dir",
    description="Показать содержимое папки на компьютере пользователя.",
    parameters=obj(
        {
            "path": text("Путь к папке. По умолчанию текущая рабочая папка."),
            "show_hidden": boolean("Показывать скрытые файлы"),
        }
    ),
    handler=_list_dir,
    meta={"icon": "folder"},
)

TOOL_READ_FILE = Tool(
    name="read_file",
    description="Прочитать текстовый файл с диска пользователя.",
    parameters=obj(
        {
            "path": text("Полный путь к файлу"),
            "max_chars": integer("Сколько символов вернуть, по умолчанию 12000"),
        },
        ["path"],
    ),
    handler=_read_file,
    meta={"icon": "file"},
)

TOOL_WRITE_FILE = Tool(
    name="write_file",
    description=(
        "Создать или перезаписать текстовый файл на компьютере. "
        "Требует подтверждения пользователя."
    ),
    parameters=obj(
        {
            "path": text("Полный путь к файлу"),
            "content": text("Текст файла"),
            "append": boolean("Дописать в конец вместо перезаписи"),
        },
        ["path", "content"],
    ),
    handler=_write_file,
    risk="confirm",
    meta={"icon": "edit"},
)

TOOL_SEARCH_FILES = Tool(
    name="search_files",
    description="Найти файлы на диске по имени (поддерживаются маски: *.pdf, отчёт*).",
    parameters=obj(
        {
            "pattern": text("Маска имени файла, например *.docx"),
            "root": text("Где искать. По умолчанию домашняя папка пользователя."),
            "max_results": integer("Максимум результатов, по умолчанию 30"),
        },
        ["pattern"],
    ),
    handler=_search_files,
    meta={"icon": "search"},
)
