"""
Интеграционный тест: поднимает заглушку Ollama и сам ассистент в отдельных процессах
с изолированной папкой данных, прогоняет основные сценарии.

Запуск:  .venv/bin/python tests/integration.py
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
PY = sys.executable
DATA_DIR = Path(tempfile.mkdtemp(prefix="aura_it_"))

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, extra: str = "") -> None:
    results.append((bool(ok), name, extra))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def wait_http(url: str, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                await client.get(url)
            return True
        except Exception:  # noqa: BLE001
            await asyncio.sleep(0.25)
    return False


async def chat(client: httpx.AsyncClient, base: str, sid: str, text: str, approve: bool | None = None) -> list[dict]:
    events: list[dict] = []
    async with client.stream("POST", f"{base}/api/chat", json={"text": text, "session_id": sid}, timeout=120) as response:
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            events.append(event)
            if event["type"] == "confirm" and approve is not None:
                await asyncio.sleep(0.15)
                await client.post(
                    f"{base}/api/confirm",
                    json={"session_id": sid, "approved": approve},
                )
    return events


async def main() -> int:
    ollama_port = free_port()
    app_port = free_port()
    base = f"http://127.0.0.1:{app_port}"

    env = os.environ.copy()
    env["AURA_DATA_DIR"] = str(DATA_DIR)
    env["PYTHONPATH"] = str(ROOT)

    ollama = subprocess.Popen(
        [PY, "-m", "uvicorn", "fake_ollama:app", "--app-dir", str(ROOT / "tests"),
         "--host", "127.0.0.1", "--port", str(ollama_port), "--log-level", "error"],
        cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    app = subprocess.Popen(
        [PY, "run.py", "--port", str(app_port), "--no-browser"],
        cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    try:
        if not await wait_http(f"http://127.0.0.1:{ollama_port}/api/version", 25):
            print("✗ заглушка Ollama не поднялась")
            return 1
        if not await wait_http(f"{base}/api/health", 35):
            print("✗ сервер ассистента не поднялся")
            return 1

        async with httpx.AsyncClient(timeout=60) as client:
            # --- 1. служебные эндпоинты ---
            state = (await client.get(f"{base}/api/state")).json()
            check("состояние отдаётся", state.get("version") == "1.0.0")
            check("инструменты перечислены", len(state.get("tools", [])) >= 20, str(len(state.get("tools", []))))
            system = (await client.get(f"{base}/api/system")).json()
            check("телеметрия ПК", "ram" in system and "cpu" in system)

            # --- 2. демо-режим (Ollama недоступна) ---
            await client.put(f"{base}/api/config", json={"patch": {"ollama_url": f"http://127.0.0.1:{free_port()}"}})
            sid = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            events = await chat(client, base, sid, "сколько памяти занято")
            tool_result = next((e for e in events if e["type"] == "tool_result"), None)
            answer = next((e for e in events if e["type"] == "assistant_end"), None)
            check("демо-режим: инструмент выполнен", tool_result and tool_result["ok"], str(tool_result)[:80])
            check("демо-режим: есть ответ", bool(answer and answer["message"]["content"]))

            # --- 3. native tool calling через Ollama ---
            await client.put(f"{base}/api/config", json={"patch": {"ollama_url": f"http://127.0.0.1:{ollama_port}", "model": "qwen2.5:7b"}})
            models = (await client.get(f"{base}/api/models")).json()
            check("модели видны", models["online"] and len(models["models"]) == 2, str(models.get("models")))
            sid2 = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            events = await chat(client, base, sid2, "как дела с компьютером?")
            kinds = [e["type"] for e in events]
            check("ollama: инструмент вызван", "tool_start" in kinds, str(kinds))
            check("ollama: стрим токенов", kinds.count("token") > 1, str(kinds.count("token")))
            final = next((e for e in events if e["type"] == "assistant_end"), None)
            check("ollama: финальный ответ", bool(final and final["message"]["content"]), (final or {}).get("message", {}).get("content", "")[:60])
            check("ollama: статистика", bool(final and final["message"]["stats"].get("tokens_per_second")))

            # --- 4. текстовый протокол для моделей без tool calling ---
            await client.put(f"{base}/api/config", json={"patch": {"model": "gemma3:4b"}})
            sid3 = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            events = await chat(client, base, sid3, "покажи систему")
            check("текстовый режим: инструмент вызван", any(e["type"] == "tool_start" for e in events))
            check("текстовый режим: ответ получен", any(e["type"] == "assistant_end" for e in events))
            await client.put(f"{base}/api/config", json={"patch": {"model": "qwen2.5:7b"}})

            # --- 5. подтверждение: отказ и согласие ---
            sid4 = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            events = await chat(client, base, sid4, "запиши файл с заметкой", approve=False)
            confirm = next((e for e in events if e["type"] == "confirm"), None)
            check("подтверждение: запрос показан", bool(confirm), str(confirm)[:80])
            check("подтверждение: поля человекочитаемы", bool(confirm and confirm["request"].get("fields")))
            check("подтверждение: отказ соблюдён", not Path("/tmp/aura_it/note.txt").exists())

            sid4b = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            events = await chat(client, base, sid4b, "запиши файл с заметкой", approve=True)
            check("подтверждение: файл записан", Path("/tmp/aura_it/note.txt").exists())

            # --- 6. память, таймеры, сессии ---
            await client.post(f"{base}/api/memory", json={"text": "Тестовый факт", "category": "тест"})
            memory = (await client.get(f"{base}/api/memory")).json()["items"]
            check("память сохраняется", len(memory) == 1 and memory[0]["text"] == "Тестовый факт")

            sid5 = (await client.post(f"{base}/api/sessions", json={})).json()["session"]["id"]
            timer_seen = asyncio.Event()

            async def listen() -> None:
                async with client.stream("GET", f"{base}/api/events", timeout=25) as stream:
                    async for line in stream.aiter_lines():
                        if line.startswith("data: ") and '"type": "timer"' in line:
                            timer_seen.set()
                            return

            listener = asyncio.create_task(listen())
            await asyncio.sleep(0.4)
            await client.put(f"{base}/api/config", json={"patch": {"ollama_url": f"http://127.0.0.1:{free_port()}"}})
            await chat(client, base, sid5, "поставь таймер на 1 секунду с подписью проверка")
            timers = (await client.get(f"{base}/api/timers")).json()["timers"]
            check("таймер создан", len(timers) == 1, str(timers))
            try:
                await asyncio.wait_for(timer_seen.wait(), timeout=8)
                check("таймер сработал (SSE)", True)
            except asyncio.TimeoutError:
                check("таймер сработал (SSE)", False)
            listener.cancel()

            sessions = (await client.get(f"{base}/api/sessions")).json()["sessions"]
            check("сессии сохраняются", len(sessions) >= 4, str(len(sessions)))
            deleted = (await client.delete(f"{base}/api/sessions/{sessions[0]['id']}")).json()
            check("сессия удаляется", deleted.get("ok") is True)

            # --- 7. защита от опасных команд ---
            await client.put(f"{base}/api/config", json={"patch": {"ollama_url": f"http://127.0.0.1:{ollama_port}"}})
            from app.safety import classify_command  # noqa: PLC0415

            check("rm -rf / заблокирована", classify_command("rm -rf /")[0] == "blocked")
            check("format C: заблокирована", classify_command("format C:")[0] == "blocked")
            check("dir безопасна", classify_command("dir")[0] == "safe")
            check("mkdir требует подтверждения", classify_command("mkdir test")[0] == "confirm")

            # --- 8. TTS/STT деградируют вежливо ---
            tts = await client.post(f"{base}/api/tts", json={"text": "тест"})
            check("TTS отвечает 200 или 503", tts.status_code in (200, 503), str(tts.status_code))
            stt = await client.post(f"{base}/api/stt", files={"file": ("a.webm", b"\x00\x01", "audio/webm")})
            check("STT отвечает 200 или 503", stt.status_code in (200, 503), str(stt.status_code))
    finally:
        for process in (app, ollama):
            process.terminate()
            try:
                process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(DATA_DIR, ignore_errors=True)
        shutil.rmtree("/tmp/aura_it", ignore_errors=True)

    failed = [r for r in results if not r[0]]
    for ok, name, extra in results:
        print(f"{'✓' if ok else '✗'} {name}{'' if ok else f' → {extra}'}")
    print(f"\nИтого: {len(results) - len(failed)}/{len(results)} проверок пройдено")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
