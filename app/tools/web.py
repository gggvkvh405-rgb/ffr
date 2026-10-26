"""Сеть и интернет: новости, погода, HTTP-запросы, поиск в интернете."""
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus

import httpx

from .base import Tool, fail, obj, ok, text

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
BROWSER_HEADERS = {"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"}

WEATHER_CODES = {
    0: "ясно", 1: "в основном ясно", 2: "переменная облачность", 3: "пасмурно",
    45: "туман", 48: "изморозь", 51: "лёгкая морось", 53: "морось", 55: "сильная морось",
    56: "ледяная морось", 57: "ледяная морось", 61: "небольшой дождь", 63: "дождь",
    65: "сильный дождь", 66: "ледяной дождь", 67: "ледяной дождь",
    71: "небольшой снег", 73: "снег", 75: "сильный снег", 77: "снежная крупа",
    80: "небольшие ливни", 81: "ливни", 82: "сильные ливни",
    85: "снегопады", 86: "сильные снегопады", 95: "гроза",
    96: "гроза с градом", 99: "сильная гроза с градом",
}


async def _web_search(query: str, max_results: int = 5) -> dict:
    query = (query or "").strip()
    if not query:
        return fail("Пустой поисковый запрос")
    max_results = max(1, min(int(max_results or 5), 10))
    results: list[dict] = []

    try:
        async with httpx.AsyncClient(timeout=15, headers=BROWSER_HEADERS, follow_redirects=True) as client:
            response = await client.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query, "kl": "ru-ru"},
            )
            response.raise_for_status()
            pattern = re.compile(
                r'<a[^>]+class="result__a"[^>]+href="(?P<link>[^"]+)"[^>]*>(?P<title>.*?)</a>'
                r'.*?<a[^>]+class="result__snippet"[^>]*>(?P<snippet>.*?)</a>',
                re.S,
            )
            for match in pattern.finditer(response.text):
                link = html.unescape(match.group("link"))
                if "uddg=" in link:
                    from urllib.parse import parse_qs, urlparse

                    qs = parse_qs(urlparse(link).query)
                    link = qs.get("uddg", [link])[0]
                title = re.sub(r"<[^>]+>", "", match.group("title"))
                snippet = re.sub(r"<[^>]+>", "", match.group("snippet"))
                results.append(
                    {
                        "title": html.unescape(title).strip(),
                        "url": link,
                        "snippet": html.unescape(snippet).strip(),
                    }
                )
                if len(results) >= max_results:
                    break
    except Exception as exc:  # noqa: BLE001
        return fail(f"Поиск не удался (нет интернета?): {exc}")

    if not results:
        return ok(f"По запросу «{query}» ничего не нашлось")

    lines = [f"Результаты поиска «{query}»:"]
    for index, item in enumerate(results, 1):
        lines.append(f"{index}. {item['title']}\n   {item['url']}\n   {item['snippet']}")
    return ok("\n".join(lines), results=results)


async def _http_get(url: str, max_chars: int = 4000) -> dict:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(timeout=20, headers=BROWSER_HEADERS, follow_redirects=True) as client:
            response = await client.get(url)
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            try:
                data = json.dumps(response.json(), ensure_ascii=False, indent=2)
            except Exception:  # noqa: BLE001
                data = response.text
            return ok(f"GET {url} → {response.status_code}\n{data[:max_chars]}")
        body = response.text
        body = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", body, flags=re.I)
        body = re.sub(r"<[^>]+>", " ", body)
        body = html.unescape(re.sub(r"\s+", " ", body)).strip()
        return ok(f"GET {url} → {response.status_code}\n{body[:max_chars]}")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Запрос не удался: {exc}")


async def _weather(city: str) -> dict:
    city = (city or "").strip() or "Москва"
    try:
        async with httpx.AsyncClient(timeout=15, headers=BROWSER_HEADERS) as client:
            geo = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "ru", "format": "json"},
            )
            geo_data = geo.json()
            if not geo_data.get("results"):
                return fail(f"Город «{city}» не найден")
            place = geo_data["results"][0]
            lat, lon = place["latitude"], place["longitude"]
            label = ", ".join(
                part for part in (place.get("name"), place.get("admin1"), place.get("country")) if part
            )
            forecast = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,"
                    "precipitation,weather_code,wind_speed_10m",
                    "daily": "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
                    "timezone": "auto",
                    "forecast_days": 3,
                },
            )
            data = forecast.json()
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось получить погоду: {exc}")

    current = data.get("current", {})
    code = current.get("weather_code", 0)
    lines = [
        f"Погода в {label}:",
        f"— Сейчас {current.get('temperature_2m')}°C (ощущается как {current.get('apparent_temperature')}°C), "
        f"{WEATHER_CODES.get(code, 'н/д')}",
        f"— Влажность {current.get('relative_humidity_2m')}%, ветер {current.get('wind_speed_10m')} км/ч",
    ]
    daily = data.get("daily", {})
    days = daily.get("time", [])
    for index, day in enumerate(days[:3]):
        date = datetime.fromisoformat(day)
        label_day = "Сегодня" if index == 0 else ("Завтра" if index == 1 else date.strftime("%d.%m"))
        lines.append(
            f"— {label_day}: {daily['temperature_2m_min'][index]}…{daily['temperature_2m_max'][index]}°C, "
            f"{WEATHER_CODES.get(daily['weather_code'][index], 'н/д')}, "
            f"осадки {daily['precipitation_probability_max'][index]}%"
        )
    return ok("\n".join(lines), city=label)


async def _news(topic: str = "", limit: int = 6) -> dict:
    """Простые новости через RSS ленты (без API-ключей)."""
    feeds = [
        "https://lenta.ru/rss/news",
        "https://tass.ru/rss/v2.xml",
        "https://www.kommersant.ru/RSS/news.xml",
        "https://habr.com/ru/rss/news/?fl=ru",
    ]
    items: list[dict] = []
    async with httpx.AsyncClient(timeout=15, headers=BROWSER_HEADERS, follow_redirects=True) as client:
        for feed in feeds:
            try:
                response = await client.get(feed)
                if response.status_code != 200:
                    continue
                text_body = response.text
                for match in re.finditer(r"<item[\s\S]*?</item>", text_body, re.I):
                    block = match.group(0)
                    title = re.search(r"<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>", block)
                    link = re.search(r"<link>([\s\S]*?)</link>", block)
                    pub = re.search(r"<pubDate>([\s\S]*?)</pubDate>", block)
                    if not title:
                        continue
                    headline = html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).strip()
                    if topic and topic.lower() not in headline.lower():
                        continue
                    items.append(
                        {
                            "title": headline,
                            "url": (link.group(1).strip() if link else ""),
                            "source": re.sub(r"^https?://(www\.)?([^/]+).*", r"\2", feed),
                            "published": pub.group(1).strip() if pub else "",
                        }
                    )
            except Exception:  # noqa: BLE001
                continue
    if not items:
        return fail("Не удалось получить новости (нет интернета или ленты недоступны)")

    items.sort(key=lambda i: i["published"], reverse=True)
    items = items[: max(1, min(int(limit or 6), 15))]
    lines = ["Свежие новости:"]
    for item in items:
        lines.append(f"• {item['title']} — {item['source']}\n  {item['url']}")
    return ok("\n".join(lines), items=items)


def _local_time(city: str = "") -> dict:
    now = datetime.now()
    utc_now = datetime.now(timezone.utc)
    zones = {
        "москва": 3, "moscow": 3, "nizhnevartovsk": 5, "нижневартовск": 5,
        "екатеринбург": 5, "новосибирск": 7, "красноярск": 7, "иркутск": 8,
        "владивосток": 10, "калининград": 2, "сочи": 3, "санкт-петербург": 3,
        "питер": 3, "алматы": 5, "минск": 3, "киев": 2, "токио": 9, "tokyo": 9,
        "дубай": 4, "dubai": 4, "лондон": 0, "london": 0, "нью-йорк": -5, "new york": -5,
        "берлин": 1, "berlin": 1, "париж": 1, "paris": 1, "стамбул": 3, "istanbul": 3,
    }
    if city and city.lower() in zones:
        offset = zones[city.lower()]
        local = utc_now + timedelta(hours=offset)
        return ok(
            f"Сейчас в {city.title()}: {local.strftime('%H:%M:%S')} "
            f"({local.strftime('%d.%m.%Y')}), UTC{offset:+d}"
        )
    weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
    months = [
        "января", "февраля", "марта", "апреля", "мая", "июня", "июля",
        "августа", "сентября", "октября", "ноября", "декабря",
    ]
    return ok(
        f"Сейчас {now.strftime('%H:%M')}, {weekdays[now.weekday()]}, "
        f"{now.day} {months[now.month - 1]} {now.year} (локальное время компьютера)"
    )


TOOL_WEB_SEARCH = Tool(
    name="web_search",
    description="Найти информацию в интернете (DuckDuckGo). Возвращает заголовки, ссылки и выдержки.",
    parameters=obj(
        {
            "query": text("Поисковый запрос"),
            "max_results": {"type": "integer", "description": "Сколько результатов (1–10)"},
        },
        ["query"],
    ),
    handler=_web_search,
    meta={"icon": "search"},
)

TOOL_HTTP_GET = Tool(
    name="http_get",
    description="Отправить GET-запрос к API или веб-странице и получить текст/JSON.",
    parameters=obj({"url": text("Адрес с https://")}, ["url"]),
    handler=_http_get,
    meta={"icon": "globe"},
)

TOOL_WEATHER = Tool(
    name="weather",
    description="Узнать текущую погоду и прогноз на 3 дня для города.",
    parameters=obj({"city": text("Название города")}, ["city"]),
    handler=_weather,
    meta={"icon": "cloud"},
)

TOOL_NEWS = Tool(
    name="news",
    description="Получить свежие новости (лента RSS: Lenta, ТАСС, Коммерсантъ, Хабр).",
    parameters=obj(
        {
            "topic": text("Ключевое слово для фильтра, необязательно"),
            "limit": {"type": "integer", "description": "Сколько новостей показать"},
        }
    ),
    handler=_news,
    meta={"icon": "newspaper"},
)

TOOL_TIME = Tool(
    name="current_time",
    description="Узнать текущие дату и время (можно для другого города).",
    parameters=obj({"city": text("Город, необязательно")}),
    handler=_local_time,
    meta={"icon": "clock"},
)
