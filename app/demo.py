"""Демо-режим: работает без Ollama, понимает базовые команды и реально их выполняет."""
from __future__ import annotations

import re

CAPABILITIES = (
    "Я умею управлять компьютером: запускать программы, открывать файлы и папки, "
    "менять громкость, делать скриншоты, ставить таймеры, искать в интернете, "
    "показывать погоду и новости, выполнять команды в терминале."
)

CITY_HINTS = {
    "нижневартовск": "Нижневартовск", "москв": "Москва", "питер": "Санкт-Петербург",
    "спб": "Санкт-Петербург", "екатеринбург": "Екатеринбург", "новосибирск": "Новосибирск",
    "казан": "Казань", "тюмен": "Тюмень", "сургут": "Сургут", "омск": "Омск",
    "красноярск": "Красноярск", "сочи": "Сочи", "уфа": "Уфа", "самара": "Самара",
}


def _city_from(text: str) -> str:
    lowered = text.lower()
    for hint, name in CITY_HINTS.items():
        if hint in lowered:
            return name
    match = re.search(r"(?:в|во|для)\s+([А-ЯЁ][а-яё\-]{3,})", text)
    return match.group(1) if match else "Москва"


def _timer_label(text: str) -> str:
    match = re.search(
        r"(?:с подписью|подписью|чтобы|про)\s+[«\"]?([^»\"]{2,80})", text, re.I
    )
    if not match:
        # «напомни через 10 минут выпить воды» → «выпить воды»
        match = re.search(r"(?:напомни|таймер)\w*\s+(?:через\s+\d+\s*\w+\s*)?(.{3,80})", text, re.I)
    if match:
        label = match.group(1).strip(" .,!-")
        label = re.sub(r"\s+(?:на|через)\s+\d+.*$", "", label).strip()
        label = re.sub(r"^(?:на|через)\s+", "", label).strip()
        if label and not re.fullmatch(r"\d+\s*\w*", label):
            return label
    return "напоминание"


def _seconds(text: str) -> int:
    lowered = text.lower()
    match = re.search(r"(\d+)\s*(сек|мин|час|ч\b|м\b)", lowered)
    if not match:
        return 300
    value = int(match.group(1))
    unit = match.group(2)
    if unit.startswith("сек"):
        return value
    if unit.startswith("мин") or unit == "м":
        return value * 60
    return value * 3600


def plan(text: str) -> dict:
    """Возвращает {"reply": str} или {"tool": name, "arguments": {...}}."""
    lowered = (text or "").lower().strip()

    if not lowered:
        return {"reply": "Я тут. Чем помочь?"}

    if re.match(r"^(привет|здравствуй|прив|хай|добрый (день|вечер|утро)|ку)\b", lowered):
        return {
            "reply": "Привет! Я на связи. Сейчас работаю в демо-режиме без нейросети, "
            "но команды выполняю. Могу показать состояние компьютера, погоду, "
            "открыть программу или поставить таймер."
        }
    if any(word in lowered for word in ("что умеешь", "умеешь", "возможност", "что можешь", "команд", "помощь", "help")):
        return {
            "reply": CAPABILITIES
            + " Попробуй: «погода в Нижневартовске», «сколько памяти занято», "
            "«открой калькулятор», «громкость тише», «таймер на 5 минут»."
        }
    if any(word in lowered for word in ("как дела", "как ты", "как настроение")):
        return {"reply": "Все системы в норме, жду задачи. А у тебя как дела?"}
    if any(word in lowered for word in ("как тебя зовут", "кто ты", "твое имя", "твоё имя")):
        return {"reply": "Меня зовут Аура. Я живу на твоём компьютере, работаю через Ollama и умею выполнять команды."}

    # питание — проверяем раньше «системы», иначе слово «компьютер» перехватит запрос
    if any(word in lowered for word in ("выключи компьютер", "выключить компьютер", "выключи пк", "заверши работу", "shutdown")):
        return {"tool": "power_action", "arguments": {"action": "shutdown"}}
    if "перезагруз" in lowered or "reboot" in lowered:
        return {"tool": "power_action", "arguments": {"action": "restart"}}
    if "заблокир" in lowered or "lock" in lowered:
        return {"tool": "power_action", "arguments": {"action": "lock"}}
    if "выключи экран" in lowered or "погаси экран" in lowered:
        return {"tool": "power_action", "arguments": {"action": "screen_off"}}
    if "усни" in lowered or "спать" in lowered and "компьютер" in lowered:
        return {"tool": "power_action", "arguments": {"action": "sleep"}}

    if any(word in lowered for word in ("погод", "температур", "дожд", "снег")):
        return {"tool": "weather", "arguments": {"city": _city_from(text)}}
    if any(word in lowered for word in ("новост", "что нового")):
        return {"tool": "news", "arguments": {"limit": 6}}
    if re.search(r"котор\w* час|сколько времени|текущ\w* время|дата|какое сегодня|\bвремя\b", lowered):
        return {"tool": "current_time", "arguments": {"city": _city_from(text) if " в " in lowered else ""}}
    if any(word in lowered for word in ("память", "памят", "процессор", "цпу", "cpu", "систем", "компьютер", "диск", "нагрузк", "батаре", "озу", "ram")):
        return {"tool": "system_info", "arguments": {}}
    if any(word in lowered for word in ("скриншот", "снимок экрана", "скрин")):
        return {"tool": "screenshot", "arguments": {}}
    if any(word in lowered for word in ("громкость", "громче", "тише", "звук")):
        if "выключ" in lowered or "mute" in lowered or "без звука" in lowered:
            action = "mute"
        elif "громче" in lowered or "прибав" in lowered:
            action = "volume_up"
        else:
            action = "volume_down"
        return {"tool": "media_control", "arguments": {"action": action}}
    if any(word in lowered for word in ("пауза", "плей", "воспроизвед", "следующ", "трек", "музык")):
        action = "next" if "следующ" in lowered else "play_pause"
        return {"tool": "media_control", "arguments": {"action": action}}
    if "таймер" in lowered or "напомни" in lowered:
        return {"tool": "set_timer", "arguments": {"seconds": _seconds(text), "label": _timer_label(text)}}
    if "запомни" in lowered:
        fact = re.sub(r"^.*?запомни[,\s:]*", "", text, flags=re.I).strip() or text
        fact = re.sub(r"^(что|о том, что)\s+", "", fact, flags=re.I).strip() or fact
        return {"tool": "remember", "arguments": {"fact": fact, "category": "общее"}}
    if "что ты помнишь" in lowered or "что помнишь" in lowered:
        return {"tool": "recall", "arguments": {"query": ""}}
    if any(word in lowered for word in ("список файлов", "что в папке", "содержимое папки", "рабочий стол", "desktop")):
        path = "~"
        if "рабочий стол" in lowered or "desktop" in lowered:
            path = "~/Desktop"
        return {"tool": "list_dir", "arguments": {"path": path}}
    if any(word in lowered for word in ("найди в интернете", "поищи", "загугли", "найди информацию", "найди в сети")):
        query = re.sub(r"^.*?(найди в интернете|поищи|загугли|найди информацию|найди в сети)[,\s:]*", "", text, flags=re.I)
        return {"tool": "web_search", "arguments": {"query": query.strip() or text}}
    if re.match(r"^(открой|запусти|запустить|open)\b", lowered):
        app = re.sub(r"^(открой|запусти|запустить|open)\s+", "", text, flags=re.I).strip()
        if app:
            return {"tool": "open_app", "arguments": {"app": app}}

    return {
        "reply": "Сейчас я работаю в демо-режиме: полноценно думать без нейросети не могу. "
        "Запусти Ollama и выбери модель — тогда пойму любую фразу. "
        "А пока могу: «погода в Нижневартовске», «сколько памяти занято», "
        "«открой калькулятор», «громкость тише», «скриншот», «новости», «таймер на 5 минут»."
    }


def _text_system(output: str) -> str:
    cpu = re.search(r"Загрузка CPU:\s*(\d+)%", output)
    ram = re.search(r"Оперативная память: [^(]*\((\d+)% занято\)", output)
    disk = re.search(r"Диски:\s*\n\s*\S+ \([^)]*\) — [^\n]*свободно ([^\n]+)", output)
    parts = []
    if cpu:
        parts.append(f"процессор загружен на {cpu.group(1)}%")
    if ram:
        parts.append(f"память занята на {ram.group(1)}%")
    if disk:
        parts.append(f"свободно {disk.group(1).strip()} на диске")
    if parts:
        return "Смотрю, что происходит: " + ", ".join(parts) + "."
    lines = [line for line in output.splitlines() if line.strip()][:6]
    return "Вот что с системой:\n" + "\n".join(lines)


def _plural(count: int, one: str, few: str, many: str) -> str:
    if count % 10 == 1 and count % 100 != 11:
        return one
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return few
    return many


def _text_listing(output: str) -> str:
    header = re.search(r"Содержимое (.+?) \((\d+) объектов\):", output)
    names = re.findall(r"^• (.+?) \[", output, re.M)[:6]
    if header:
        folder, count = header.group(1), int(header.group(2))
        word = _plural(count, "объект", "объекта", "объектов")
        text_value = f"В папке {folder} — {count} {word}."
        if names:
            text_value += " Например: " + ", ".join(names) + "."
        return text_value
    return output


def _text_news(output: str, limit: int = 3) -> str:
    titles = re.findall(r"^• (.+?) — .+$", output, re.M)[:limit]
    if titles:
        return "Главное в новостях:\n" + "\n".join(f"{i}. {title}" for i, title in enumerate(titles, 1))
    return output


def _text_search(output: str) -> str:
    items = re.findall(r"^\d+\. (.+?)\n\s+(https?://\S+)", output, re.M)[:3]
    if items:
        return "Нашла в интернете:\n" + "\n".join(f"• {t} — {u}" for t, u in items)
    return output


def summarize(tool: str, output: str) -> str:
    output = (output or "").strip()
    if tool == "system_info":
        return _text_system(output)
    if tool == "list_dir":
        return _text_listing(output)
    if tool == "news":
        return _text_news(output)
    if tool == "web_search":
        return _text_search(output)
    if tool == "screenshot":
        return "Скриншот готов, он ниже в чате."
    if tool == "run_command":
        return output[:900]
    if tool == "open_app":
        return output
    if tool in {"weather", "current_time", "media_control", "set_timer", "remember", "recall", "open_path", "clipboard", "power_action"}:
        return output
    return output[:1500]
