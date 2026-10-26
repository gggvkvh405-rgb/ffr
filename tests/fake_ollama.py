"""
Мини-заглушка Ollama для интеграционных тестов (без реальной модели).

Запуск:  .venv/bin/python -m uvicorn fake_ollama:app --app-dir tests --port 11434
Сценарии:
  • «покажи систему»          → вызов system_info
  • «запиши файл»             → вызов write_file (проверка подтверждений)
  • модель gemma*             → текстовый протокол без native tool calling
"""
import asyncio, json
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


@app.get("/api/version")
async def version():
    return {"version": "0.5.0-fake"}


@app.get("/api/tags")
async def tags():
    return {"models": [
        {"name": "qwen2.5:7b", "size": 4700000000,
         "details": {"family": "qwen2", "parameter_size": "7B", "quantization_level": "Q4_K_M"}},
        {"name": "gemma3:4b", "size": 3000000000,
         "details": {"family": "gemma3", "parameter_size": "4B", "quantization_level": "Q4_K_M"}},
    ]}


@app.post("/api/show")
async def show():
    return {"details": {"family": "qwen2"}}


def _pick_tool(messages):
    user_text = " ".join(
        str(m.get("content") or "") for m in messages if m.get("role") == "user"
    ).lower()
    if "файл" in user_text or "запиши" in user_text:
        return "write_file", {"path": "/tmp/aura_it/note.txt", "content": "привет из теста"}
    return "system_info", {}


def _chunks(messages, tools):
    if not any(m.get("role") == "tool" for m in messages):
        name, arguments = _pick_tool(messages)
        if tools:
            call = {"message": {"role": "assistant", "content": "", "tool_calls": [
                {"function": {"name": name, "arguments": arguments}}]}, "done": False}
        else:
            call = {"message": {"role": "assistant",
                                "content": json.dumps({"tool": name, "arguments": arguments},
                                                      ensure_ascii=False)},
                    "done": False}
        return [call, {"message": {"role": "assistant", "content": ""}, "done": True,
                       "eval_count": 12, "eval_duration": 400000000,
                       "prompt_eval_count": 900, "total_duration": 900000000}]
    tool_msg = next(m for m in reversed(messages) if m.get("role") == "tool")
    text = f"Проверила: {tool_msg['content'][:40]} Всё под контролем."
    lines = [{"message": {"role": "assistant", "content": w + " "}, "done": False}
             for w in text.split(" ")]
    lines.append({"message": {"role": "assistant", "content": ""}, "done": True,
                  "eval_count": 40, "eval_duration": 1000000000})
    return lines


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    lines = _chunks(body["messages"], body.get("tools") or [])

    async def gen():
        for line in lines:
            yield json.dumps(line) + "\n"
            await asyncio.sleep(0.01)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/api/embeddings")
async def embeddings():
    return {"embedding": [0.1] * 8}
