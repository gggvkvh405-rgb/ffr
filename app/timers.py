"""Таймеры, будильники и напоминания."""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from pathlib import Path
from typing import Awaitable, Callable

from .config import DATA_DIR

TIMERS_PATH = DATA_DIR / "timers.json"
_LOCK = threading.RLock()


class TimerBook:
    def __init__(self) -> None:
        self.items: dict[str, dict] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self.notify: Callable[[dict], Awaitable[None]] | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._load()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Запоминаем главный event loop и восстанавливаем таймеры после перезапуска."""
        self.loop = loop
        for item in list(self.items.values()):
            self._schedule(item)

    # ---------- хранение ----------
    def _load(self) -> None:
        if not TIMERS_PATH.exists():
            return
        try:
            raw = json.loads(TIMERS_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return
        now = time.time()
        for item in raw:
            if item.get("due", 0) > now:
                self.items[item["id"]] = item

    def _save(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            TIMERS_PATH.write_text(
                json.dumps(list(self.items.values()), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:  # noqa: BLE001
            pass

    # ---------- публичный API ----------
    def add(self, seconds: int, label: str = "") -> dict:
        seconds = max(1, min(int(seconds), 24 * 3600))
        # такой же таймер уже идёт — перезапускаем его, а не плодим копии
        with _LOCK:
            for existing_id, existing in list(self.items.items()):
                if existing.get("label") == (label or "Таймер").strip():
                    self.items.pop(existing_id, None)
                    task = self._tasks.pop(existing_id, None)
                    self._cancel_task(task)
        item = {
            "id": uuid.uuid4().hex[:8],
            "label": (label or "Таймер").strip(),
            "due": time.time() + seconds,
            "seconds": seconds,
            "created": time.time(),
        }
        with _LOCK:
            self.items[item["id"]] = item
            self._save()
        self._schedule(item)
        return item

    def cancel(self, timer_id: str = "", all_items: bool = False) -> int:
        with _LOCK:
            if all_items:
                ids = list(self.items.keys())
            elif timer_id:
                ids = [timer_id] if timer_id in self.items else []
            else:
                ids = list(self.items.keys())[-1:]
            for item_id in ids:
                self.items.pop(item_id, None)
                task = self._tasks.pop(item_id, None)
                self._cancel_task(task)
            self._save()
            return len(ids)

    def list(self) -> list[dict]:
        now = time.time()
        result = []
        for item in sorted(self.items.values(), key=lambda i: i["due"]):
            copy = dict(item)
            copy["left"] = max(0, int(item["due"] - now))
            result.append(copy)
        return result

    # ---------- планирование ----------
    def _cancel_task(self, task: asyncio.Task | None) -> None:
        if not task:
            return
        loop = self.loop
        if loop and loop.is_running() and loop is not asyncio.get_event_loop_policy().get_event_loop():
            try:
                loop.call_soon_threadsafe(task.cancel)
                return
            except RuntimeError:
                pass
        task.cancel()

    def _schedule(self, item: dict) -> None:
        loop = self.loop
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
                self.loop = loop
            except RuntimeError:
                return
        if loop.is_closed():
            return

        def create_task() -> None:
            delay = max(0.0, item["due"] - time.time())

            async def waiter() -> None:
                try:
                    await asyncio.sleep(delay)
                    await self._fire(item["id"])
                except asyncio.CancelledError:
                    return

            self._tasks[item["id"]] = loop.create_task(waiter())  # type: ignore[union-attr]

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            create_task()
        else:
            try:
                loop.call_soon_threadsafe(create_task)
            except RuntimeError:
                return

    async def _fire(self, timer_id: str) -> None:
        with _LOCK:
            item = self.items.pop(timer_id, None)
            self._tasks.pop(timer_id, None)
            self._save()
        if not item:
            return
        if self.notify:
            try:
                await self.notify(item)
            except Exception as exc:  # noqa: BLE001
                print(f"[timers] notify failed: {exc}")


TIMERS = TimerBook()
