"""Настройки приложения: хранятся в data/config.json и мержатся с дефолтами."""
from __future__ import annotations

import copy
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

FROZEN = bool(getattr(sys, "frozen", False))


def _resource_dir() -> Path:
    """Где лежат web-файлы: рядом с исходниками или внутри .exe (PyInstaller)."""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent


def _data_dir() -> Path:
    """Пользовательские данные: рядом с .exe, а если туда нельзя писать — в профиль."""
    override = os.environ.get("AURA_DATA_DIR")
    if override:
        return Path(override)
    if not FROZEN:
        return _resource_dir() / "data"

    candidates = [Path(sys.executable).resolve().parent / "data"]
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if local:
            candidates.append(Path(local) / "Aura" / "data")
    else:
        candidates.append(Path.home() / ".local" / "share" / "aura")
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / ".write_test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return candidate
        except Exception:  # noqa: BLE001
            continue
    return candidates[-1]


BASE_DIR = Path(sys.executable).resolve().parent if FROZEN else _resource_dir()
RESOURCE_DIR = _resource_dir()
DATA_DIR = _data_dir()
WEB_DIR = RESOURCE_DIR / "web"
CONFIG_PATH = DATA_DIR / "config.json"

DEFAULTS: dict[str, Any] = {
    "ollama_url": "http://127.0.0.1:11434",
    "model": "qwen2.5:7b",
    "temperature": 0.6,
    "num_ctx": 8192,
    "host": "127.0.0.1",
    "port": 8765,
    "assistant_name": "Аура",
    "user_name": "",
    "language": "ru",
    "persona": (
        "Ты дружелюбная, но собранная. Говоришь живо, без канцелярита, "
        "не льстишь и не повторяешь вопрос."
    ),
    "demo_mode": "auto",  # auto | off
    "server_tts": True,
    "server_stt": True,
    "tts": {
        "engine": "auto",  # auto | edge | browser | off
        "voice": "ru-RU-SvetlanaNeural",
        "rate": "+0%",
        "volume": "+0%",
    },
    "stt": {
        "engine": "auto",  # auto | whisper | browser
        "model_size": "small",
        "language": "ru",
    },
    "safety": {
        "mode": "confirm",  # confirm | auto | strict
        "allow_readonly": True,
        "workspace": str(Path.home()),
    },
    "command_allowlist": [],
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class Config:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.data = copy.deepcopy(DEFAULTS)
        self.load()

    def load(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            if CONFIG_PATH.exists():
                raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                with self._lock:
                    self.data = _deep_merge(DEFAULTS, raw)
        except Exception as exc:  # noqa: BLE001
            print(f"[config] не удалось прочитать {CONFIG_PATH}: {exc}")

    def save(self) -> None:
        with self._lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = CONFIG_PATH.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            tmp.replace(CONFIG_PATH)

    def get(self, path: str, default: Any = None) -> Any:
        with self._lock:
            node: Any = self.data
            for part in path.split("."):
                if not isinstance(node, dict) or part not in node:
                    return default
                node = node[part]
            return node

    def update(self, patch: dict[str, Any]) -> dict:
        """Частичное обновление по путям вида {"tts.voice": ...} или вложенным dict."""
        flat: dict[str, Any] = {}

        def walk(prefix: str, value: Any) -> None:
            if isinstance(value, dict):
                for key, inner in value.items():
                    walk(f"{prefix}.{key}" if prefix else key, inner)
            else:
                flat[prefix] = value

        walk("", patch)
        with self._lock:
            for key, value in flat.items():
                parts = key.split(".")
                node = self.data
                for part in parts[:-1]:
                    if not isinstance(node.get(part), dict):
                        node[part] = {}
                    node = node[part]
                node[parts[-1]] = value
        self.save()
        return self.data

    def as_public(self) -> dict:
        """Настройки для клиента (без секретов их нет, отдаём почти всё)."""
        with self._lock:
            data = copy.deepcopy(self.data)
        data.pop("command_allowlist", None)
        data["allowlist_size"] = len(self.get("command_allowlist", []) or [])
        return data


CONFIG = Config()
