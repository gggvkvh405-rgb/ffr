"""Ядро ассистента: системный промпт, цикл с инструментами, подтверждения."""
from __future__ import annotations

import asyncio
import getpass
import inspect
import json
import platform
import pathlib
import re
import time
import uuid
from datetime import datetime
from typing import Any, Awaitable, Callable

from . import demo, memory
from .config import CONFIG
from .ollama import OLLAMA, ModelMissing, OllamaError, OllamaUnavailable, supports_tools
from .safety import PLATFORM, describe_risk
from .sessions import Session, trim_history
from .tools.registry import TOOLS, catalog_text, find, tool_schemas

Emit = Callable[[dict], Awaitable[None]]
MAX_STEPS = 8
CONFIRM_TIMEOUT = 600
MODEL_OUTPUT_LIMIT = 4000

TOOL_TITLES = {
    "run_command": "Команда в терминале",
    "system_info": "Информация о системе",
    "list_dir": "Просмотр папки",
    "read_file": "Чтение файла",
    "write_file": "Запись файла",
    "search_files": "Поиск файлов",
    "open_path": "Открытие",
    "open_app": "Запуск программы",
    "screenshot": "Скриншот",
    "list_processes": "Список процессов",
    "close_process": "Завершение процесса",
    "media_control": "Управление звуком",
    "power_action": "Питание ПК",
    "clipboard": "Буфер обмена",
    "notify": "Уведомление",
    "web_search": "Поиск в интернете",
    "http_get": "Запрос в интернет",
    "weather": "Погода",
    "news": "Новости",
    "current_time": "Дата и время",
    "remember": "Запоминание",
    "recall": "Память",
    "forget": "Удаление из памяти",
    "set_timer": "Таймер",
    "cancel_timer": "Отмена таймера",
    "list_timers": "Таймеры",
    "reply": "Ответ",
}


def _now_text() -> str:
    weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
    months = [
        "января", "февраля", "марта", "апреля", "мая", "июня", "июля",
        "августа", "сентября", "октября", "ноября", "декабря",
    ]
    now = datetime.now()
    return (
        f"{weekdays[now.weekday()]}, {now.day} {months[now.month - 1]} {now.year}, "
        f"{now.strftime('%H:%M')}"
    )


def _os_text() -> str:
    try:
        user = getpass.getuser()
    except Exception:  # noqa: BLE001
        user = "пользователь"
    if PLATFORM == "nt":
        return f"Windows ({platform.release()}), оболочка PowerShell, учётная запись {user}"
    return f"{platform.system()} ({platform.release()}), оболочка bash, учётная запись {user}"


def build_system_prompt(session: Session) -> str:
    name = CONFIG.get("assistant_name") or "Аура"
    user_name = (CONFIG.get("user_name") or "").strip()
    persona = CONFIG.get("persona") or ""
    workspace = CONFIG.get("safety.workspace") or ""
    mode = CONFIG.get("safety.mode", "confirm")
    mode_hint = {
        "confirm": "опасные действия (запись файлов, команды, питание) подтверждает пользователь через интерфейс",
        "auto": "все действия выполняются сразу, без подтверждений",
        "strict": "даже безопасные действия требуют подтверждения пользователя",
    }.get(mode, "подтверждения включены")

    tool_rules = (
        "ПРАВИЛА РАБОТЫ С ИНСТРУМЕНТАМИ:\n"
        "1. Если просьба касается компьютера, файлов, программ, системы, интернета или времени — "
        "ВЫЗЫВАЙ инструмент, а не рассказывай, как это сделать руками.\n"
        "2. Никогда не выдумывай результат: сначала вызови инструмент, потом опирайся на его вывод.\n"
        "3. Не спрашивай разрешения перед вызовом — интерфейс сам покажет подтверждение, "
        "если действие рискованное.\n"
        "4. Если инструмент вернул ошибку — попробуй другой способ (другая команда/оболочка/путь) "
        "или честно скажи, что не получилось, и предложи вариант.\n"
        "5. Не выполняй несколько разных инструментов наугад — сначала выясни нужные данные.\n"
        "6. Для команд Windows используй PowerShell-синтаксис, для Linux — bash.\n"
    )

    style = (
        "КАК ОТВЕЧАТЬ:\n"
        "• По-русски, живо и по делу. Сначала результат, потом пояснение.\n"
        "• Коротко: 1–4 предложения, если не просят подробно. Ответ читают вслух — "
        "никаких длинных таблиц и «итак, подводя итог».\n"
        "• Markdown допустим, но умеренно: списки, **жирный**, `код`.\n"
        "• Не повторяй команду и её вывод целиком, если пользователь не просил.\n"
        "• Не выдумывай факты о компьютере. Не умеешь проверить — так и скажи.\n"
    )

    memory_block = memory.context_block()
    parts = [
        f"Ты — {name}, голосовой ИИ-ассистент на персональном компьютере пользователя."
        + (f" Обращайся к пользователю по имени: {user_name}." if user_name else ""),
        persona,
        f"Сейчас: {_now_text()}. Система: {_os_text()}.",
        f"Рабочая папка по умолчанию: {workspace}. Домашняя папка: {pathlib.Path.home()}. Компьютер: {platform.node()}",
        f"Режим безопасности: {mode_hint}.",
        tool_rules,
        style,
        "ДОСТУПНЫЕ ИНСТРУМЕНТЫ:\n" + catalog_text(),
    ]
    if memory_block:
        parts.append(memory_block)
    if session.history:
        parts.append(
            "Продолжение диалога: не здоровайся заново, учитывай контекст выше."
        )
    return "\n\n".join(part for part in parts if part)


ARG_LABELS = {
    "command": "Команда",
    "shell": "Оболочка",
    "cwd": "Рабочая папка",
    "timeout": "Таймаут, с",
    "path": "Путь",
    "content": "Содержимое",
    "append": "Дописать в конец",
    "pattern": "Маска поиска",
    "root": "Где искать",
    "max_results": "Максимум результатов",
    "max_chars": "Символов",
    "app": "Программа",
    "action": "Действие",
    "text": "Текст",
    "title": "Заголовок",
    "message": "Сообщение",
    "query": "Запрос",
    "url": "Адрес",
    "city": "Город",
    "limit": "Сколько",
    "seconds": "Через",
    "label": "Подпись",
    "timer_id": "Таймер",
    "all_timers": "Все таймеры",
    "fact": "Факт",
    "category": "Категория",
    "item_id": "Запись",
    "name": "Имя процесса",
    "pid": "PID",
    "show_hidden": "Скрытые файлы",
}

ACTION_LABELS = {
    "volume_up": "Громче",
    "volume_down": "Тише",
    "mute": "Выключить звук",
    "play_pause": "Пауза / воспроизведение",
    "next": "Следующий трек",
    "prev": "Предыдущий трек",
    "stop": "Стоп",
    "lock": "Заблокировать компьютер",
    "sleep": "Спящий режим",
    "shutdown": "Выключить компьютер",
    "restart": "Перезагрузить компьютер",
    "logout": "Завершить сеанс",
    "screen_off": "Выключить экран",
    "get": "Прочитать",
    "set": "Записать",
}


def _human_fields(args: dict[str, Any]) -> list[dict]:
    fields = []
    for key, value in (args or {}).items():
        label = ARG_LABELS.get(key, key)
        if key == "action" and isinstance(value, str):
            value = ACTION_LABELS.get(value, value)
        elif isinstance(value, bool):
            value = "да" if value else "нет"
        elif key == "seconds" and isinstance(value, (int, float)):
            seconds = int(value)
            minutes, secs = divmod(seconds, 60)
            hours, minutes = divmod(minutes, 60)
            value = " ".join(
                part for part in (
                    f"{hours} ч" if hours else "",
                    f"{minutes} мин" if minutes else "",
                    f"{secs} с" if secs and not hours else "",
                ) if part
            ) or f"{seconds} с"
        else:
            value = str(value)
        if len(str(value)) > 400:
            value = str(value)[:400] + "…"
        fields.append({"label": label, "value": str(value)})
    return fields


def _human_args(args: dict[str, Any]) -> str:
    if not args:
        return ""
    pieces = []
    for key, value in args.items():
        text_value = str(value)
        if len(text_value) > 160:
            text_value = text_value[:160] + "…"
        pieces.append(f"{key}: {text_value}")
    return "; ".join(pieces)


def _truncate(text_value: str, limit: int = MODEL_OUTPUT_LIMIT) -> str:
    text_value = text_value or ""
    if len(text_value) <= limit:
        return text_value
    return text_value[:limit] + f"\n… (обрезано, всего {len(text_value)} символов)"


def _allowlisted(tool_name: str, args: dict) -> bool:
    entries = CONFIG.get("command_allowlist") or []
    if not entries:
        return False
    if tool_name == "run_command":
        command = str(args.get("command", "")).strip()
        return command in entries
    if tool_name == "open_app":
        app = str(args.get("app", "")).strip().lower()
        return f"open_app:{app}" in entries
    if tool_name == "power_action":
        return f"power_action:{args.get('action')}" in entries
    return False


def _remember_allow(tool_name: str, args: dict) -> None:
    entries = list(CONFIG.get("command_allowlist") or [])
    if tool_name == "run_command":
        entries.append(str(args.get("command", "")).strip())
    elif tool_name == "open_app":
        entries.append(f"open_app:{str(args.get('app', '')).strip().lower()}")
    elif tool_name == "power_action":
        entries.append(f"power_action:{args.get('action')}")
    else:
        return
    CONFIG.update({"command_allowlist": entries[-100:]})


def needs_confirmation(tool_name: str, args: dict) -> tuple[bool, str, str]:
    tool = find(tool_name)
    if not tool:
        return False, "blocked", "Инструмент не найден"
    risk, reason = tool.evaluate(args)
    mode = CONFIG.get("safety.mode", "confirm")
    if risk == "blocked":
        return True, risk, reason
    if mode == "auto":
        return False, risk, reason
    if _allowlisted(tool_name, args):
        return False, risk, reason
    if mode == "strict":
        return True, "confirm", reason or "Строгий режим: подтверждение для любого действия"
    if risk == "confirm":
        return True, risk, reason
    if not CONFIG.get("safety.allow_readonly", True) and tool_name not in {"recall"}:
        return True, "confirm", "Чтение данных тоже требует подтверждения"
    return False, risk, reason


async def execute_tool(tool_name: str, args: dict, emit: Emit, session: Session) -> dict:
    tool = find(tool_name)
    call_id = uuid.uuid4().hex[:8]
    if not tool:
        return {"ok": False, "output": f"Неизвестный инструмент: {tool_name}"}

    risk, reason = tool.evaluate(args)
    if risk == "blocked":
        return {"ok": False, "output": f"Действие запрещено системой безопасности: {reason}"}

    confirm, _, why = needs_confirmation(tool_name, args)
    if confirm:
        request = {
            "id": call_id,
            "tool": tool_name,
            "title": TOOL_TITLES.get(tool_name, tool_name),
            "arguments": args,
            "preview": _human_args(args),
            "fields": _human_fields(args),
            "risk": risk,
            "risk_text": describe_risk(risk),
            "reason": why,
            "can_remember": tool_name in {"run_command", "open_app", "power_action"},
        }
        future = session.ask_confirmation(request)
        await emit({"type": "confirm", "request": request})
        try:
            approved = await asyncio.wait_for(future, timeout=CONFIRM_TIMEOUT)
        except asyncio.TimeoutError:
            approved = False
            await emit({"type": "status", "text": "Подтверждение не получено — действие отменено"})
        finally:
            session.clear_pending()
        if not approved:
            await emit({"type": "confirm_result", "id": call_id, "approved": False})
            return {
                "ok": False,
                "denied": True,
                "output": "Пользователь отклонил действие. Не выполняй его снова без просьбы.",
            }
        await emit({"type": "confirm_result", "id": call_id, "approved": True})
        if request.get("remember"):
            _remember_allow(tool_name, args)

    args = _coerce_args(tool, args)
    started = time.time()
    await emit(
        {
            "type": "tool_start",
            "id": call_id,
            "name": tool_name,
            "title": TOOL_TITLES.get(tool_name, tool_name),
            "preview": _human_args(args),
            "fields": _human_fields(args),
            "arguments": args,
        }
    )
    try:
        if inspect.iscoroutinefunction(tool.handler):
            result = await tool.handler(**args)
        else:
            result = await asyncio.to_thread(lambda: tool.handler(**args))
        if asyncio.iscoroutine(result):
            result = await result
        if not isinstance(result, dict):
            result = {"ok": True, "output": str(result)}
    except TypeError as exc:
        result = {"ok": False, "output": f"Неверные аргументы инструмента: {exc}"}
    except Exception as exc:  # noqa: BLE001
        result = {"ok": False, "output": f"Ошибка выполнения: {exc}"}

    duration = round(time.time() - started, 2)
    result.setdefault("ok", True)
    result.setdefault("output", "")
    await emit(
        {
            "type": "tool_result",
            "id": call_id,
            "name": tool_name,
            "ok": bool(result.get("ok")),
            "output": _truncate(str(result.get("output", ""))),
            "url": result.get("url"),
            "duration": duration,
        }
    )
    return result


def _coerce_args(tool, args: dict) -> dict:
    """Оставляем только известные параметры и приводим их к нужному типу."""
    schema = tool.parameters or {}
    props = schema.get("properties") or {}
    clean: dict[str, Any] = {}
    for key, value in (args or {}).items():
        if props and key not in props:
            continue
        target = (props.get(key) or {}).get("type")
        try:
            if target == "integer" and not isinstance(value, int):
                clean[key] = int(float(str(value).replace(",", ".")))
            elif target == "number" and not isinstance(value, (int, float)):
                clean[key] = float(str(value).replace(",", "."))
            elif target == "boolean" and not isinstance(value, bool):
                clean[key] = str(value).strip().lower() in {"1", "true", "yes", "да", "on"}
            elif target == "string" and not isinstance(value, str):
                clean[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
            else:
                clean[key] = value
        except (TypeError, ValueError):
            clean[key] = value
    for key in schema.get("required") or []:
        if key not in clean:
            return args
    return clean


def _to_tool_message(result: dict) -> str:
    status = "OK" if result.get("ok") else "ОШИБКА"
    body = _truncate(str(result.get("output", "")))
    if result.get("url"):
        body += f"\n(ссылка для пользователя: {result['url']})"
    return f"[{status}]\n{body}"


TEXT_TOOL_INSTRUCTIONS = (
    "\n\nРЕЖИМ БЕЗ NATIVE TOOL CALLING.\n"
    "Если для выполнения просьбы нужно действие на компьютере, ответь ОДНИМ JSON-объектом "
    "и больше ничем, без пояснений и markdown:\n"
    '{"tool": "имя_инструмента", "arguments": {"параметр": "значение"}}\n'
    "После этого ты получишь результат инструмента и сможешь вызвать следующий или ответить текстом.\n"
    "Если действие не нужно — просто отвечай обычным текстом (без JSON).\n"
)


def _extract_text_tool(text_value: str) -> dict | None:
    if not text_value:
        return None
    cleaned = text_value.strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned)
    candidates = [cleaned]
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        candidates.append(match.group(0))
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("tool"):
            args = data.get("arguments") or data.get("args") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            if not isinstance(args, dict):
                args = {}
            return {"tool": str(data["tool"]), "arguments": args}
    return None


async def _stream_turn(
    session: Session,
    user_text: str,
    emit: Emit,
    model: str,
    use_native_tools: bool,
) -> dict:
    system = build_system_prompt(session)
    if not use_native_tools:
        system += TEXT_TOOL_INSTRUCTIONS

    messages: list[dict] = [{"role": "system", "content": system}]
    history = trim_history(session.history)
    if not history or history[-1].get("role") != "user":
        history.append({"role": "user", "content": user_text})
    messages.extend(history)
    await emit({"type": "status", "text": "Думаю…"})

    final_text = ""
    collected_tools: list[dict] = []
    thinking_parts: list[str] = []
    stats: dict = {}
    steps = 0

    while steps < MAX_STEPS:
        steps += 1
        if session.stop:
            final_text = final_text or "Остановлено."
            break

        buffer = ""
        calls: list[dict] = []
        stream_error: Exception | None = None
        tool_calls_supported = use_native_tools

        try:
            async for event in OLLAMA.chat_stream(
                messages,
                model=model,
                tools=tool_schemas() if tool_calls_supported else None,
            ):
                if session.stop:
                    break
                kind = event.get("type")
                if kind == "token":
                    buffer += event["text"]
                    if tool_calls_supported:
                        await emit({"type": "token", "text": event["text"]})
                    elif not buffer.lstrip().startswith("{") and len(buffer) < 2000:
                        # стримим, пока ответ явно не похож на JSON-вызов инструмента
                        await emit({"type": "token", "text": event["text"]})
                elif kind == "thinking":
                    thinking_parts.append(event["text"])
                    await emit({"type": "thinking", "text": event["text"]})
                elif kind == "tool_calls":
                    calls = event["calls"]
                elif kind == "stats":
                    stats = {k: v for k, v in event.items() if k != "type"}
        except ModelMissing:
            raise
        except OllamaUnavailable:
            raise
        except OllamaError as exc:
            message = str(exc)
            if "does not support tools" in message.lower() or "tool" in message.lower() and exc.status == 400:
                if not use_native_tools:
                    raise
                use_native_tools = False
                messages[0]["content"] = system + TEXT_TOOL_INSTRUCTIONS
                await emit({"type": "status", "text": "Модель не поддерживает инструменты, включаю текстовый режим…"})
                steps -= 1
                continue
            raise
        except Exception as exc:  # noqa: BLE001
            stream_error = exc

        if stream_error:
            raise stream_error

        if not calls and not tool_calls_supported:
            parsed = _extract_text_tool(buffer)
            if parsed:
                calls = [{"name": parsed["tool"], "arguments": parsed.get("arguments") or {}}]

        if calls:
            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": buffer,
                "tool_calls": [
                    {"function": {"name": call["name"], "arguments": call["arguments"]}}
                    for call in calls
                ],
            }
            messages.append(assistant_message)
            session.history.append(
                {"role": "assistant", "content": buffer, "tool_calls": assistant_message["tool_calls"]}
            )

            if not final_text.strip() and buffer.strip():
                final_text = buffer.strip()

            for call in calls:
                name = call.get("name") or ""
                args = call.get("arguments") or {}

                if name == "reply":
                    final_text = str(args.get("text") or buffer or "").strip()
                    steps = MAX_STEPS
                    break

                result = await execute_tool(name, args, emit, session)
                collected_tools.append(
                    {
                        "name": name,
                        "title": TOOL_TITLES.get(name, name),
                        "arguments": args,
                        "ok": bool(result.get("ok")),
                        "output": _truncate(str(result.get("output", "")), 1500),
                        "url": result.get("url"),
                    }
                )
                tool_message = {"role": "tool", "content": _to_tool_message(result)}
                messages.append(tool_message)
                session.history.append(tool_message)
            await emit({"type": "status", "text": "Думаю…"})
            continue

        final_text = (final_text + "\n\n" + buffer).strip() if final_text.strip() and not buffer.strip() else buffer.strip()
        if not final_text:
            # пустой ответ — один раз просим продолжить
            if steps < 2:
                messages.append({"role": "user", "content": "Продолжи и ответь пользователю."})
                continue
            final_text = "Не получилось сформулировать ответ. Попробуй переформулировать запрос."
        break
    else:
        if not final_text.strip():
            final_text = "Задача оказалась слишком длинной — не хватило шагов. Уточни, что сделать дальше?"

    if stats.get("eval_count") and stats.get("eval_duration"):
        stats["tokens_per_second"] = round(
            stats["eval_count"] / max(stats["eval_duration"] / 1e9, 0.001), 1
        )

    return {
        "text": final_text,
        "tools": collected_tools,
        "thinking": "".join(thinking_parts).strip(),
        "stats": stats,
    }


async def _demo_turn(session: Session, user_text: str, emit: Emit) -> dict:
    await emit({"type": "status", "text": "Демо-режим (Ollama не подключена)"})
    plan = demo.plan(user_text)
    collected_tools: list[dict] = []
    if "tool" in plan:
        name = plan["tool"]
        args = plan.get("arguments") or {}
        result = await execute_tool(name, args, emit, session)
        collected_tools.append(
            {
                "name": name,
                "title": TOOL_TITLES.get(name, name),
                "arguments": args,
                "ok": bool(result.get("ok")),
                "output": _truncate(str(result.get("output", "")), 1500),
                "url": result.get("url"),
            }
        )
        if result.get("ok"):
            text_value = demo.summarize(name, str(result.get("output", "")))
        elif result.get("denied"):
            text_value = "Хорошо, отменила. Если передумаешь — просто попроси ещё раз."
        else:
            text_value = f"Не получилось: {result.get('output', 'неизвестная ошибка')}"
    else:
        text_value = plan.get("reply", "")

    for chunk_start in range(0, len(text_value), 24):
        if session.stop:
            break
        await emit({"type": "token", "text": text_value[chunk_start: chunk_start + 24]})
        await asyncio.sleep(0.012)

    return {"text": text_value, "tools": collected_tools, "thinking": "", "stats": {}}


async def run_turn(session: Session, user_text: str, emit: Emit) -> None:
    """Полный ход диалога с событиями для UI."""
    session.stop = False
    session.busy = True
    message_id = uuid.uuid4().hex[:10]
    started = time.time()
    model = CONFIG.get("model") or "qwen2.5:7b"
    started_at = time.time()
    session.history.append({"role": "user", "content": user_text})

    try:
        status = await OLLAMA.ping()
        online = status.get("online")
        available = {m["name"] for m in status.get("models", [])} if online else set()

        if not online:
            if CONFIG.get("demo_mode", "auto") == "off":
                await emit(
                    {
                        "type": "error",
                        "message": "Ollama не запущена. Установи её с https://ollama.com и выполни `ollama serve`.",
                    }
                )
                return
            payload = await _demo_turn(session, user_text, emit)
        elif model not in available and not any(name.split(":")[0] == model.split(":")[0] for name in available):
            if not available:
                await emit(
                    {
                        "type": "error",
                        "message": f"В Ollama нет моделей. Выполни в терминале: ollama pull {model}",
                    }
                )
                return
            else:
                fallback = sorted(available)[0]
                await emit(
                    {
                        "type": "status",
                        "text": f"Модель {model} не найдена, использую {fallback}",
                    }
                )
                model = fallback
                payload = await _stream_turn(session, user_text, emit, model, supports_tools(model))
        else:
            payload = await _stream_turn(session, user_text, emit, model, supports_tools(model))

        total = round(time.time() - started, 2)
        message = {
            "id": message_id,
            "role": "assistant",
            "content": payload.get("text", ""),
            "ts": time.time(),
            "tools": payload.get("tools", []),
            "thinking": payload.get("thinking", ""),
            "stats": payload.get("stats", {}),
            "model": model,
            "duration": total,
        }
        session.display.append(message)
        if message["content"]:
            session.history.append({"role": "assistant", "content": message["content"]})

        await emit({"type": "assistant_end", "message": message, "started_at": started_at})
    except OllamaUnavailable as exc:
        await emit({"type": "error", "message": str(exc)})
    except ModelMissing as exc:
        await emit({"type": "error", "message": str(exc), "model_missing": True})
    except asyncio.CancelledError:
        await emit({"type": "status", "text": "Остановлено"})
        raise
    except Exception as exc:  # noqa: BLE001
        await emit({"type": "error", "message": f"Что-то пошло не так: {exc}"})
    finally:
        session.busy = False
        if session.pending_future and not session.pending_future.done():
            session.pending_future.set_result(False)
        session.clear_pending()


