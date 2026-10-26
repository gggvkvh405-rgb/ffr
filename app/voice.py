"""Голос: синтез речи (edge-tts) и распознавание (faster-whisper)."""
from __future__ import annotations

import asyncio
import hashlib
import re
import time
from pathlib import Path
from typing import Any

from .config import CONFIG, DATA_DIR

AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

EDGE_VOICES = [
    {"id": "ru-RU-SvetlanaNeural", "name": "Светлана", "gender": "женский", "tag": "мягкий"},
    {"id": "ru-RU-DariyaNeural", "name": "Дарья", "gender": "женский", "tag": "энергичный"},
    {"id": "ru-RU-DmitryNeural", "name": "Дмитрий", "gender": "мужской", "tag": "спокойный"},
    {"id": "en-US-AriaNeural", "name": "Aria (EN)", "gender": "женский", "tag": "english"},
    {"id": "en-US-GuyNeural", "name": "Guy (EN)", "gender": "мужской", "tag": "english"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (UK)", "gender": "женский", "tag": "english"},
]

MD_PATTERNS = [
    (re.compile(r"```[\s\S]*?```"), " "),
    (re.compile(r"`([^`]*)`"), r"\1"),
    (re.compile(r"!?\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"^#{1,6}\s*", re.M), ""),
    (re.compile(r"\*\*([^*]+)\*\*"), r"\1"),
    (re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)"), r"\1"),
    (re.compile(r"__([^_]+)__"), r"\1"),
    (re.compile(r"^[-*+]\s+", re.M), ""),
    (re.compile(r"^\d+\.\s+", re.M), ""),
    (re.compile(r"^\s*>\s?", re.M), ""),
    (re.compile(r"https?://\S+"), "ссылка"),
    (re.compile(r"[*#_|]+"), " "),
    (re.compile(r"\n{2,}"), ". "),
    (re.compile(r"\s{2,}"), " "),
]


def text_for_speech(text_value: str, limit: int = 4000) -> str:
    result = text_value or ""
    for pattern, replacement in MD_PATTERNS:
        result = pattern.sub(replacement, result)
    result = result.strip()
    if len(result) > limit:
        cut = result[:limit]
        last_period = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
        result = cut[: last_period + 1] if last_period > limit * 0.6 else cut
    return result


def edge_available() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


async def synthesize(text_value: str, voice: str | None = None) -> tuple[Path, str]:
    """Озвучивает текст и возвращает (путь к mp3, текст, который озвучен)."""
    if not edge_available():
        raise RuntimeError(
            "edge-tts не установлен. Установи: pip install edge-tts. "
            "Или выбери озвучку браузера в настройках."
        )
    spoken = text_for_speech(text_value)
    if not spoken:
        raise RuntimeError("Нечего озвучивать")

    voice_id = voice or CONFIG.get("tts.voice") or "ru-RU-SvetlanaNeural"
    rate = CONFIG.get("tts.rate") or "+0%"
    volume = CONFIG.get("tts.volume") or "+0%"

    key = hashlib.sha1(f"{voice_id}|{rate}|{volume}|{spoken}".encode("utf-8")).hexdigest()[:20]
    target = AUDIO_DIR / f"{key}.mp3"
    if target.exists() and target.stat().st_size > 512:
        return target, spoken

    import edge_tts

    chunks = _split_for_tts(spoken)
    data = bytearray()
    try:
        for chunk in chunks:
            communicate = edge_tts.Communicate(chunk, voice_id, rate=rate, volume=volume)
            async for part in communicate.stream():
                if part.get("type") == "audio":
                    data.extend(part["data"])
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "Edge-TTS не смог озвучить: нет связи с сервером Microsoft. "
            "Проверьте интернет или включите голос браузера в настройках. "
            f"({type(exc).__name__})"
        ) from exc
    if not data:
        raise RuntimeError("Синтез не вернул аудио")
    target.write_bytes(bytes(data))
    _cleanup()
    return target, spoken


def _split_for_tts(text_value: str, chunk_size: int = 1200) -> list[str]:
    if len(text_value) <= chunk_size:
        return [text_value]
    sentences = re.split(r"(?<=[.!?…])\s+", text_value)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 > chunk_size and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current.strip())
    return chunks


def _cleanup(max_files: int = 120) -> None:
    try:
        files = sorted(AUDIO_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[max_files:]:
            old.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


# ---------------- распознавание речи ----------------
_WHISPER_MODEL: Any = None
_WHISPER_LOCK = asyncio.Lock()


def _load_whisper(size: str):
    global _WHISPER_MODEL
    if _WHISPER_MODEL is not None:
        return _WHISPER_MODEL
    from faster_whisper import WhisperModel

    _WHISPER_MODEL = WhisperModel(size, device="cpu", compute_type="int8")
    return _WHISPER_MODEL


async def transcribe(audio_bytes: bytes, language: str | None = None) -> dict:
    if not whisper_available():
        raise RuntimeError(
            "Локальное распознавание недоступно: установи faster-whisper "
            "(`pip install faster-whisper`). Пока используется распознавание браузера."
        )
    size = CONFIG.get("stt.model_size") or "small"
    lang = language or CONFIG.get("stt.language") or "ru"
    tmp = AUDIO_DIR / f"stt_{int(time.time() * 1000)}.webm"
    tmp.write_bytes(audio_bytes)
    try:
        async with _WHISPER_LOCK:
            model = await asyncio.to_thread(_load_whisper, size)
            segments, info = await asyncio.to_thread(
                model.transcribe,
                str(tmp),
                language=None if lang in {"auto", ""} else lang,
                vad_filter=True,
                beam_size=1,
            )
            parts = []
            for segment in segments:
                parts.append(segment.text.strip())
        text_value = " ".join(part for part in parts if part).strip()
        return {"text": text_value, "language": getattr(info, "language", lang)}
    finally:
        tmp.unlink(missing_ok=True)


def capabilities() -> dict:
    return {
        "edge_tts": edge_available(),
        "faster_whisper": whisper_available(),
        "voices": EDGE_VOICES,
    }
