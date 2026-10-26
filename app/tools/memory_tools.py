"""Инструменты памяти и напоминаний."""
from __future__ import annotations

from .. import memory
from ..timers import TIMERS
from .base import Tool, fail, integer, obj, ok, text


def _remember(fact: str, category: str = "общее") -> dict:
    try:
        item = memory.add(fact, category)
    except ValueError as exc:
        return fail(str(exc))
    return ok(f"Запомнил: {item['text']}")


def _recall(query: str = "") -> dict:
    items = memory.search(query)
    if not items:
        return ok("В памяти пока ничего нет по этому запросу")
    lines = [f"• [{item['category']}] {item['text']}" for item in items]
    return ok("Вот что я помню:\n" + "\n".join(lines))


def _forget(item_id: str) -> dict:
    return ok("Удалил из памяти") if memory.delete(item_id) else fail("Такой записи нет")


def _set_timer(seconds: int, label: str = "") -> dict:
    item = TIMERS.add(seconds, label)
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    pretty = " ".join(
        part for part in (
            f"{hours} ч" if hours else "",
            f"{minutes} мин" if minutes else "",
            f"{secs} с" if secs and not hours else "",
        ) if part
    )
    return ok(f"Таймер «{item['label']}» установлен на {pretty}", timer_id=item["id"])


def _cancel_timer(timer_id: str = "", all_timers: bool = False) -> dict:
    count = TIMERS.cancel(timer_id, all_timers)
    if not count:
        return fail("Активных таймеров с таким id нет")
    return ok(f"Отменено таймеров: {count}")


def _list_timers() -> dict:
    items = TIMERS.list()
    if not items:
        return ok("Активных таймеров нет")
    lines = []
    for item in items:
        minutes, secs = divmod(item["left"], 60)
        lines.append(f"• «{item['label']}» — осталось {minutes} мин {secs} с (id {item['id']})")
    return ok("Активные таймеры:\n" + "\n".join(lines), timers=items)


TOOL_REMEMBER = Tool(
    name="remember",
    description=(
        "Сохранить важный факт о пользователе в долговременную память "
        "(имя, предпочтения, привычки, проекты). Используй, когда пользователь просит запомнить."
    ),
    parameters=obj(
        {
            "fact": text("Факт для запоминания"),
            "category": text("Категория: профиль, предпочтения, работа, другое"),
        },
        ["fact"],
    ),
    handler=_remember,
    meta={"icon": "brain"},
)

TOOL_RECALL = Tool(
    name="recall",
    description="Вспомнить факты из долговременной памяти о пользователе.",
    parameters=obj({"query": text("Ключевое слово для поиска, пусто — всё подряд")}),
    handler=_recall,
    meta={"icon": "brain"},
)

TOOL_FORGET = Tool(
    name="forget",
    description="Удалить запись из памяти по её id.",
    parameters=obj({"item_id": text("id записи")}, ["item_id"]),
    handler=_forget,
    risk="confirm",
    meta={"icon": "trash"},
)

TOOL_SET_TIMER = Tool(
    name="set_timer",
    description=(
        "Поставить таймер или напоминание через N секунд. Когда время выйдет, "
        "ассистент сам озвучит напоминание."
    ),
    parameters=obj(
        {
            "seconds": integer("Через сколько секунд напомнить"),
            "label": text("Что напомнить, например «выпить воды»"),
        },
        ["seconds"],
    ),
    handler=_set_timer,
    meta={"icon": "timer"},
)

TOOL_CANCEL_TIMER = Tool(
    name="cancel_timer",
    description="Отменить таймер по id или все сразу.",
    parameters=obj(
        {
            "timer_id": text("id таймера"),
            "all_timers": {"type": "boolean", "description": "Отменить все таймеры"},
        }
    ),
    handler=_cancel_timer,
    risk="confirm",
    meta={"icon": "timer"},
)

TOOL_LIST_TIMERS = Tool(
    name="list_timers",
    description="Показать активные таймеры и сколько осталось.",
    parameters=obj({}),
    handler=_list_timers,
    meta={"icon": "timer"},
)
