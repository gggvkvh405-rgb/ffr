"""Асинхронный клиент Ollama с поддержкой стрима и tool calling."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from .config import CONFIG

# Модели, которые не умеют tool calling — для них используем текстовый протокол.
NO_TOOLS_HINTS = (
    "gemma", "phi3", "phi:", "llava", "llava-llama3", "bakllava", "moondream",
    "mistral:7b-instruct-v0.2", "tinyllama", "smollm", "solar-pro", "nemotron",
    "dolphin", "deepseek-r1", "deepseek-coder", "starcoder", "codellama",
    "wizardcoder", "yi", "vicuna", "orca", "openchat", "samantha", "starling",
)


class OllamaError(Exception):
    def __init__(self, message: str, *, status: int = 0, code: str = "error") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class OllamaUnavailable(OllamaError):
    def __init__(self, message: str = "") -> None:
        super().__init__(
            message
            or "Ollama не запущена. Установи её с ollama.com и запусти командой `ollama serve`.",
            code="offline",
        )


class ModelMissing(OllamaError):
    def __init__(self, model: str) -> None:
        super().__init__(
            f"Модель «{model}» не загружена. Выполни в терминале: ollama pull {model}",
            status=404,
            code="model_missing",
        )


def supports_tools(model: str) -> bool:
    name = (model or "").lower()
    return not any(hint in name for hint in NO_TOOLS_HINTS)


def _normalize_tool_calls(raw: Any) -> list[dict]:
    calls: list[dict] = []
    for item in raw or []:
        function = item.get("function", item) if isinstance(item, dict) else {}
        name = (function.get("name") or "").strip()
        arguments = function.get("arguments", function.get("parameters", {}))
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments) if arguments.strip() else {}
            except json.JSONDecodeError:
                arguments = {}
        if not isinstance(arguments, dict):
            arguments = {}
        if name:
            calls.append({"name": name, "arguments": arguments})
    return calls


class OllamaClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    @property
    def base_url(self) -> str:
        return (CONFIG.get("ollama_url") or "http://127.0.0.1:11434").rstrip("/")

    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5, read=None, write=30, pool=10),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ---------------- служебное ----------------
    async def ping(self) -> dict:
        try:
            response = await self.client().get(f"{self.base_url}/api/version", timeout=3.5)
            response.raise_for_status()
            version = response.json().get("version", "?")
            models = await self.list_models()
            return {"online": True, "version": version, "models": models}
        except httpx.HTTPError as exc:
            return {"online": False, "error": str(exc), "models": []}
        except Exception as exc:  # noqa: BLE001
            return {"online": False, "error": str(exc), "models": []}

    async def list_models(self) -> list[dict]:
        try:
            response = await self.client().get(f"{self.base_url}/api/tags", timeout=8)
            response.raise_for_status()
            models = response.json().get("models", [])
        except Exception:  # noqa: BLE001
            return []
        result = []
        for model in models:
            details = model.get("details", {}) or {}
            size = model.get("size") or 0
            result.append(
                {
                    "name": model.get("name"),
                    "size": size,
                    "size_gb": round(size / 1024 ** 3, 1) if size else 0,
                    "family": details.get("family", ""),
                    "parameters": details.get("parameter_size", ""),
                    "quantization": details.get("quantization_level", ""),
                    "modified": model.get("modified_at", ""),
                    "tools": supports_tools(model.get("name", "")),
                }
            )
        result.sort(key=lambda m: m["name"] or "")
        return result

    async def show(self, model: str) -> dict:
        try:
            response = await self.client().post(
                f"{self.base_url}/api/show", json={"model": model}, timeout=15
            )
            if response.status_code == 404:
                raise ModelMissing(model)
            response.raise_for_status()
            return response.json()
        except ModelMissing:
            raise
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(f"Ollama не отвечает: {exc}") from exc

    async def pull(self, model: str) -> AsyncIterator[dict]:
        """Скачивание модели с прогрессом."""
        payload = {"model": model, "stream": True}
        try:
            async with self.client().stream(
                "POST", f"{self.base_url}/api/pull", json=payload, timeout=None
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise OllamaError(f"Не удалось скачать модель: {body}", status=response.status_code)
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(f"Ollama не отвечает: {exc}") from exc

    # ---------------- чат ----------------
    async def chat_stream(
        self,
        messages: list[dict],
        *,
        model: str,
        tools: list[dict] | None = None,
        temperature: float | None = None,
        num_ctx: int | None = None,
        format_json: bool = False,
        keep_alive: str = "30m",
    ) -> AsyncIterator[dict]:
        options = {
            "temperature": CONFIG.get("temperature", 0.6) if temperature is None else temperature,
            "num_ctx": int(CONFIG.get("num_ctx", 8192)) if num_ctx is None else num_ctx,
        }
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": options,
            "keep_alive": keep_alive,
        }
        if tools:
            payload["tools"] = tools
        if format_json:
            payload["format"] = "json"

        tool_calls: dict[int, dict] = {}
        stats: dict[str, Any] = {}
        try:
            async with self.client().stream(
                "POST", f"{self.base_url}/api/chat", json=payload, timeout=None
            ) as response:
                if response.status_code >= 400:
                    raw = (await response.aread()).decode("utf-8", "replace")
                    lowered = raw.lower()
                    if response.status_code == 404 or "not found" in lowered and "model" in lowered:
                        raise ModelMissing(model)
                    raise OllamaError(raw[:400] or "Ошибка Ollama", status=response.status_code)
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        raise OllamaError(str(chunk["error"]), code="ollama_error")
                    message = chunk.get("message") or {}
                    thinking = message.get("thinking")
                    if thinking:
                        yield {"type": "thinking", "text": thinking}
                    content = message.get("content")
                    if content:
                        yield {"type": "token", "text": content}
                    for index, call in enumerate(message.get("tool_calls") or []):
                        normalized = _normalize_tool_calls([call])
                        if not normalized:
                            continue
                        entry = tool_calls.setdefault(index, {"name": "", "arguments": {}})
                        entry["name"] = normalized[0]["name"] or entry["name"]
                        entry["arguments"].update(normalized[0]["arguments"])
                    if chunk.get("done"):
                        stats = {
                            "eval_count": chunk.get("eval_count", 0),
                            "eval_duration": chunk.get("eval_duration", 0),
                            "prompt_eval_count": chunk.get("prompt_eval_count", 0),
                            "total_duration": chunk.get("total_duration", 0),
                        }
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(f"Ollama не отвечает: {exc}") from exc

        if tool_calls:
            yield {"type": "tool_calls", "calls": list(tool_calls.values())}
        if stats:
            yield {"type": "stats", **stats}

    async def chat_once(
        self,
        messages: list[dict],
        *,
        model: str,
        temperature: float = 0.3,
        num_ctx: int | None = None,
        format_json: bool = False,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_ctx": num_ctx or int(CONFIG.get("num_ctx", 8192)),
            },
        }
        if format_json:
            payload["format"] = "json"
        try:
            response = await self.client().post(
                f"{self.base_url}/api/chat", json=payload, timeout=None
            )
            if response.status_code == 404:
                raise ModelMissing(model)
            response.raise_for_status()
            data = response.json()
            return (data.get("message") or {}).get("content", "")
        except ModelMissing:
            raise
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(f"Ollama не отвечает: {exc}") from exc

    async def embed(self, model: str, text_value: str) -> list[float] | None:
        try:
            response = await self.client().post(
                f"{self.base_url}/api/embeddings",
                json={"model": model, "prompt": text_value},
                timeout=30,
            )
            if response.status_code >= 400:
                return None
            return response.json().get("embedding")
        except Exception:  # noqa: BLE001
            return None


OLLAMA = OllamaClient()
