"""FastAPI-приложение: API, SSE-стрим чата и раздача интерфейса."""
from __future__ import annotations

import asyncio
import json
import platform
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import memory, voice
from .chat import run_turn
from .config import CONFIG, DATA_DIR, WEB_DIR
from .ollama import OLLAMA, ModelMissing
from .safety import PLATFORM
from .sessions import STORE, Session
from .timers import TIMERS
from .tools.registry import TOOLS

try:
    import psutil
except Exception:  # noqa: BLE001
    psutil = None  # type: ignore[assignment]

APP_VERSION = "1.0.0"

app = FastAPI(title="Aura Voice Assistant", version=APP_VERSION, docs_url="/api/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "screenshots").mkdir(exist_ok=True)
(DATA_DIR / "audio").mkdir(exist_ok=True)
WEB_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/files", StaticFiles(directory=str(DATA_DIR)), name="files")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

# ------------------------------------------------------------------ шина событий
SUBSCRIBERS: set[asyncio.Queue] = set()


def broadcast(event: dict) -> None:
    for queue in list(SUBSCRIBERS):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def _timer_fired(item: dict) -> None:
    broadcast({"type": "timer", "timer": item, "ts": time.time()})


TIMERS.notify = _timer_fired


@app.on_event("startup")
async def _on_startup() -> None:
    TIMERS.bind_loop(asyncio.get_running_loop())


# ------------------------------------------------------------------ модели запросов
class ConfigPatch(BaseModel):
    patch: dict[str, Any]


class ChatRequest(BaseModel):
    text: str
    session_id: str | None = None


class ConfirmRequest(BaseModel):
    session_id: str
    approved: bool
    remember: bool = False


class StopRequest(BaseModel):
    session_id: str | None = None


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


class SessionNew(BaseModel):
    title: str | None = None


class MemoryNew(BaseModel):
    text: str
    category: str = "общее"


# ------------------------------------------------------------------ служебные
def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def public_state() -> dict:
    return {
        "version": APP_VERSION,
        "config": CONFIG.as_public(),
        "platform": {
            "system": "Windows" if PLATFORM == "nt" else platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "tools": [
            {"name": tool.name, "description": tool.description, "icon": tool.meta.get("icon", "tool")}
            for tool in TOOLS
        ],
        "voice": voice.capabilities(),
        "demo": CONFIG.get("demo_mode", "auto") != "off",
    }


@app.get("/api/state")
async def api_state() -> dict:
    state = public_state()
    state["ollama"] = await OLLAMA.ping()
    state["timers"] = TIMERS.list()
    state["memory_count"] = len(memory.all_items())
    return state


@app.get("/api/health")
async def api_health() -> dict:
    ping = await OLLAMA.ping()
    return {"ok": True, "version": APP_VERSION, "ollama_online": ping.get("online", False)}


@app.get("/api/system")
async def api_system() -> dict:
    data: dict = {"online": True}
    if psutil:
        try:
            mem = psutil.virtual_memory()
            data.update(
                cpu=psutil.cpu_percent(interval=None),
                ram=mem.percent,
                ram_used=round(mem.used / 1024 ** 3, 1),
                ram_total=round(mem.total / 1024 ** 3, 1),
                cores=psutil.cpu_count(logical=True),
            )
            try:
                root = "C:\\" if PLATFORM == "nt" else "/"
                disk = psutil.disk_usage(root)
                data["disk"] = round(disk.percent, 1)
                data["disk_free"] = round(disk.free / 1024 ** 3, 1)
            except Exception:  # noqa: BLE001
                pass
            battery = psutil.sensors_battery()
            if battery:
                data["battery"] = round(battery.percent)
                data["charging"] = bool(battery.power_plugged)
        except Exception as exc:  # noqa: BLE001
            data["error"] = str(exc)
    return data


@app.get("/api/models")
async def api_models() -> dict:
    ping = await OLLAMA.ping()
    return {
        "online": ping.get("online", False),
        "version": ping.get("version"),
        "models": ping.get("models", []),
        "selected": CONFIG.get("model"),
    }


@app.get("/api/models/pull")
async def api_pull(model: str) -> StreamingResponse:
    async def generator():
        try:
            async for chunk in OLLAMA.pull(model):
                payload = {
                    "status": chunk.get("status", ""),
                    "completed": chunk.get("completed"),
                    "total": chunk.get("total"),
                    "percent": round(
                        (chunk.get("completed") or 0) / (chunk.get("total") or 1) * 100, 1
                    )
                    if chunk.get("total")
                    else None,
                }
                yield sse(payload)
            yield sse({"status": "success", "done": True})
        except Exception as exc:  # noqa: BLE001
            yield sse({"error": str(exc), "done": True})

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.put("/api/config")
async def api_config(body: ConfigPatch) -> dict:
    CONFIG.update(body.patch)
    return {"ok": True, "config": CONFIG.as_public()}


# ------------------------------------------------------------------ сессии
@app.get("/api/sessions")
async def api_sessions() -> dict:
    return {"sessions": [s.to_public(False) for s in STORE.recent(50)]}


@app.post("/api/sessions")
async def api_session_new(body: SessionNew | None = None) -> dict:
    session = STORE.create(body.title if body and body.title else "Новый диалог")
    return {"session": session.to_public()}


@app.get("/api/sessions/{session_id}")
async def api_session(session_id: str) -> dict:
    session = STORE.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    return {"session": session.to_public(), "pending": session.pending}


@app.delete("/api/sessions/{session_id}")
async def api_session_delete(session_id: str) -> dict:
    return {"ok": STORE.delete(session_id)}


@app.post("/api/sessions/{session_id}/clear")
async def api_session_clear(session_id: str) -> dict:
    session = STORE.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    session.display.clear()
    session.history.clear()
    STORE.save()
    return {"ok": True}


# ------------------------------------------------------------------ чат
@app.post("/api/chat")
async def api_chat(body: ChatRequest) -> StreamingResponse:
    text_value = (body.text or "").strip()
    if not text_value:
        raise HTTPException(status_code=400, detail="Пустой запрос")
    session = STORE.get_or_create(body.session_id)
    if session.busy:
        raise HTTPException(status_code=409, detail="Ассистент уже выполняет задачу")
    session.busy = True

    session.display.append(
        {"id": uuid.uuid4().hex[:10], "role": "user", "content": text_value, "ts": time.time()}
    )
    STORE.touch(session)

    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    loop = asyncio.get_running_loop()
    ended = loop.create_future()

    async def emit(event: dict) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass

    async def runner() -> None:
        try:
            await run_turn(session, text_value, emit)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            await emit({"type": "error", "message": str(exc)})
        finally:
            if not ended.done():
                ended.set_result(True)

    task = asyncio.create_task(runner())

    async def generator():
        yield sse({"type": "start", "session_id": session.id, "title": session.title})
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=12)
                    yield sse(event)
                except asyncio.TimeoutError:
                    if ended.done() and queue.empty():
                        break
                    yield ": ping\n\n"
                if ended.done() and queue.empty():
                    break
            yield sse({"type": "done", "session_id": session.id, "title": session.title})
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
            STORE.touch(session)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/stop")
async def api_stop(body: StopRequest | None = None, session_id: str | None = None) -> dict:
    target = session_id or (body.session_id if body else None)
    session = STORE.get(target) if target else (STORE.recent(1)[0] if STORE.recent(1) else None)
    if not session:
        return {"ok": False, "error": "Нет активного диалога"}
    session.stop_turn()
    return {"ok": True}


@app.post("/api/confirm")
async def api_confirm(body: ConfirmRequest) -> dict:
    session = STORE.get(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    if not session.pending:
        return {"ok": False, "error": "Нет запроса на подтверждение"}
    if body.remember and body.approved and session.pending:
        session.pending["remember"] = True
    ok = session.resolve_confirmation(body.approved)
    return {"ok": ok}


@app.get("/api/events")
async def api_events() -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    SUBSCRIBERS.add(queue)

    async def generator():
        try:
            yield sse({"type": "hello", "ts": time.time()})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield sse(event)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            SUBSCRIBERS.discard(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ голос
@app.post("/api/tts")
async def api_tts(body: TTSRequest) -> Response:
    try:
        path, spoken = await voice.synthesize(body.text, body.voice)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": str(exc)})
    return FileResponse(path, media_type="audio/mpeg", headers={"X-Spoken-Text": ""})


@app.get("/api/voices")
async def api_voices() -> dict:
    return {"voices": voice.EDGE_VOICES, "edge": voice.edge_available()}


@app.post("/api/stt")
async def api_stt(request: Request, file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой аудиофайл")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Аудио слишком большое")
    language = request.query_params.get("language")
    try:
        result = await voice.transcribe(raw, language)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": str(exc)})
    return result


# ------------------------------------------------------------------ память и таймеры
@app.get("/api/memory")
async def api_memory(q: str = "") -> dict:
    return {"items": memory.search(q)}


@app.post("/api/memory")
async def api_memory_add(body: MemoryNew) -> dict:
    try:
        item = memory.add(body.text, body.category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "item": item}


@app.delete("/api/memory/{item_id}")
async def api_memory_delete(item_id: str) -> dict:
    return {"ok": memory.delete(item_id)}


@app.get("/api/timers")
async def api_timers() -> dict:
    return {"timers": TIMERS.list()}


@app.delete("/api/timers/{timer_id}")
async def api_timer_cancel(timer_id: str) -> dict:
    return {"ok": bool(TIMERS.cancel(timer_id))}


@app.post("/api/open-data")
async def api_open_data() -> dict:
    from .tools.os_actions import _open_path

    result = await asyncio.to_thread(_open_path, str(DATA_DIR))
    return {"ok": bool(result.get("ok")), "output": result.get("output", "")}


@app.get("/api/screenshot/latest")
async def api_latest_screenshot() -> dict:
    folder = DATA_DIR / "screenshots"
    shots = sorted(folder.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True) if folder.exists() else []
    if not shots:
        return {"url": None}
    return {"url": f"/files/screenshots/{shots[0].name}"}


# ------------------------------------------------------------------ фронтенд
@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/manifest.webmanifest")
async def manifest() -> FileResponse:
    return FileResponse(WEB_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(WEB_DIR / "sw.js", media_type="application/javascript")


@app.exception_handler(404)
async def not_found(request: Request, exc: Exception) -> Response:
    if request.url.path.startswith(("/api", "/files", "/static")):
        return JSONResponse(status_code=404, content={"error": "Не найдено"})
    return FileResponse(WEB_DIR / "index.html")


def create_app() -> FastAPI:
    return app
