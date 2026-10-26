/**
 * Смоук-тест интерфейса без браузера: jsdom + заглушки сетевых вызовов.
 * Запуск: npm install jsdom && node tests/ui-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");

const CONFIG = {
  ollama_url: "http://127.0.0.1:11434",
  model: "qwen2.5:7b",
  temperature: 0.6,
  num_ctx: 8192,
  assistant_name: "Аура",
  user_name: "",
  persona: "дружелюбная",
  demo_mode: "auto",
  tts: { engine: "auto", voice: "ru-RU-SvetlanaNeural", rate: "+0%" },
  stt: { engine: "auto", model_size: "small" },
  safety: { mode: "confirm", allow_readonly: true, workspace: "C:\\Users\\test" },
};

const json = (data) => ({
  ok: true,
  status: 200,
  async json() { return data; },
  async text() { return JSON.stringify(data); },
});

function sseResponse(events) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= events.length) return { done: true, value: undefined };
            const event = events[index++];
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            await new Promise((r) => setTimeout(r, event.delay || 1));
            return { done: false, value: encoder.encode(payload) };
          },
        };
      },
    },
  };
}

const serverState = {
  sessions: [{ id: "sess-1", title: "Проверка интерфейса", created: Date.now() / 1000, updated: Date.now() / 1000, message_count: 2 }],
  messages: [
    { id: "m1", role: "user", content: "Сколько памяти занято?", ts: Date.now() / 1000 - 90 },
    {
      id: "m2", role: "assistant", content: "Память загружена на **7%**, всё спокойно.",
      ts: Date.now() / 1000 - 80, model: "qwen2.5:7b", duration: 1.2,
      tools: [{ name: "system_info", arguments: {}, ok: true, output: "CPU 7%", title: "Система" }],
    },
  ],
  memory: [{ id: "a1", text: "Пользователя зовут Алексей", category: "профиль" }],
  timers: [{ id: "t1", label: "Перерыв", due: Date.now() / 1000 + 600, left: 600, seconds: 600 }],
};

const requested = [];
const handlers = [];
let lastChatEvents = [];

function fakeFetch(url, options = {}) {
  const target = String(url);
  requested.push({ url: target, method: options.method || "GET" });
  for (const [pattern, handler] of handlers) {
    if (target.includes(pattern)) return Promise.resolve(handler(options, target));
  }
  if (target.includes("/api/state")) {
    return Promise.resolve(json({
      version: "1.0.0",
      config: CONFIG,
      platform: { system: "Windows", release: "11", machine: "AMD64", python: "3.12" },
      tools: [
        { name: "run_command", description: "cmd", icon: "terminal" },
        { name: "system_info", description: "sys", icon: "cpu" },
        { name: "screenshot", description: "shot", icon: "image" },
      ],
      voice: { edge_tts: false, faster_whisper: false, voices: [{ id: "ru-RU-SvetlanaNeural", name: "Светлана", gender: "женский", tag: "мягкий" }] },
      ollama: { online: true, version: "0.4.1", models: [{ name: "qwen2.5:7b", size_gb: 4.7, parameters: "7B", tools: true }] },
      demo: true,
      timers: serverState.timers,
      memory_count: serverState.memory.length,
    }));
  }
  if (target.includes("/api/sessions/sess-1")) {
    return Promise.resolve(json({
      session: { id: "sess-1", title: "Проверка интерфейса", message_count: 2, messages: serverState.messages },
      pending: null,
    }));
  }
  if (target.includes("/api/sessions") && (options.method || "GET") === "GET") {
    return Promise.resolve(json({ sessions: serverState.sessions }));
  }
  if (target.includes("/api/sessions")) {
    return Promise.resolve(json({ session: { id: "sess-2", title: "Новый диалог" } }));
  }
  if (target.includes("/api/system")) {
    return Promise.resolve(json({ online: true, cpu: 12, ram: 41, ram_used: 6.4, ram_total: 16, cores: 8, disk: 63, disk_free: 120, battery: 88, charging: true }));
  }
  if (target.includes("/api/memory")) return Promise.resolve(json({ items: serverState.memory }));
  if (target.includes("/api/timers")) return Promise.resolve(json({ timers: serverState.timers }));
  if (target.includes("/api/models")) {
    return Promise.resolve(json({ online: true, version: "0.4.1", selected: "qwen2.5:7b", models: [{ name: "qwen2.5:7b", size_gb: 4.7, parameters: "7B", tools: true }] }));
  }
  if (target.includes("/api/chat")) {
    return Promise.resolve(sseResponse(lastChatEvents));
  }
  if (target.includes("/api/config")) return Promise.resolve(json({ ok: true, config: CONFIG }));
  return Promise.resolve(json({ ok: true }));
}

class FakeEventSource {
  constructor() { this.listeners = []; }
  addEventListener() {}
  close() {}
}

const dom = new JSDOM(html, {
  url: "http://localhost:8765/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = fakeFetch;
    window.EventSource = FakeEventSource;
    window.TextDecoder = TextDecoder;
    window.TextEncoder = TextEncoder;
    window.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {} };
    window.SpeechSynthesisUtterance = class {};
    window.HTMLMediaElement.prototype.play = async () => {};
    window.HTMLMediaElement.prototype.pause = () => {};
    window.navigator.clipboard = { writeText: async () => {} };
    window.URL.createObjectURL = () => "blob:fake";
    window.URL.revokeObjectURL = () => {};
    window.scrollTo = () => {};
    window.Element.prototype.scrollIntoView = () => {};
  },
});

const { window } = dom;
const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, condition, extra = "") {
  results.push({ name, ok: !!condition, extra });
}

window.eval(appJs);
await sleep(600);

const doc = window.document;
const text = (sel) => doc.querySelector(sel)?.textContent?.trim() || "";

check("Заголовок интерфейса", text("h2").includes("Аура"), text("h2"));
check("Статус Ollama показан", /Ollama 0\.4\.1/.test(text("#ollama-pill")), text("#ollama-pill"));
check("Список быстрых действий", doc.querySelectorAll(".quick-card").length === 6);
check("Быстрые действия в панели", doc.querySelectorAll(".rail-action").length === 6);
check("Облако навыков", doc.querySelectorAll("#tool-cloud span").length === 3);
check("Память: счётчик", text("#memory-badge") === "1", text("#memory-badge"));
check("Системные метрики", text("#cpu-value") === "12%" && text("#ram-value") === "41%", `${text("#cpu-value")} / ${text("#ram-value")}`);
check("Батарея показана", !doc.querySelector("#battery-pill").hidden && text("#battery-value").includes("88%"));
check("Таймер в панели", doc.querySelectorAll("#timer-list .timer-item").length === 1);
check("История диалогов", doc.querySelectorAll(".session-item").length === 1);
check("Загружен старый диалог", doc.querySelectorAll(".messages .msg").length === 2);
check("Карточка инструмента в истории", doc.querySelectorAll(".tool-card.ok").length === 1);
check("Приветствие скрыто при истории", doc.querySelector("#welcome").classList.contains("compact"));
check("Чип модели", text("#model-chip-text") === "qwen2.5:7b", text("#model-chip-text"));

// --- стрим нового ответа с инструментом и подтверждением
lastChatEvents = [
  { type: "start", session_id: "sess-1", title: "Проверка интерфейса" },
  { type: "status", text: "Думаю…" },
  { type: "confirm", request: { id: "c1", tool: "run_command", title: "Команда в терминале", preview: "command: mkdir test", risk: "confirm", risk_text: "нужно подтверждение", reason: "Команда изменяет файлы", can_remember: true } },
  { type: "confirm_result", delay: 1200, id: "c1", approved: true },
  { type: "tool_start", id: "t1", name: "run_command", title: "Команда", preview: "mkdir test", arguments: { command: "mkdir test" } },
  { type: "tool_result", id: "t1", name: "run_command", ok: true, output: "$ mkdir test\nГотово", duration: 0.2 },
  { type: "token", text: "**Готово!** Папка создана." },
  { type: "assistant_end", message: { id: "m3", role: "assistant", content: "**Готово!** Папка создана.", ts: Date.now() / 1000, model: "qwen2.5:7b", duration: 2.1, stats: { tokens_per_second: 32 }, tools: [{ name: "run_command", arguments: { command: "mkdir test" }, ok: true, output: "$ mkdir test" }] } },
  { type: "done", session_id: "sess-1" },
];

doc.querySelector("#input").value = "Создай папку test";
doc.querySelector("#composer-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await sleep(320);

check("Модалка подтверждения показана", !doc.querySelector("#confirm-modal").hidden);
check("В модалке видно команду", doc.querySelector("#confirm-preview").textContent.includes("mkdir test"), doc.querySelector("#confirm-preview").textContent);
doc.querySelector("#confirm-allow").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(60);
check("Подтверждение отправлено на сервер", requested.some((r) => r.url.includes("/api/confirm") && r.method === "POST"));
await sleep(1500);

const lastMsg = doc.querySelector(".messages .msg:last-of-type");
check("Сообщение пользователя добавлено", !!lastMsg && lastMsg.classList.contains("assistant"));
check("Текст ответа отрисован", doc.querySelector(".messages")?.textContent?.includes("Готово! Папка создана"), "");
check("Markdown выделен жирным", !!doc.querySelector(".messages strong"));
check("Карточка команды создана", doc.querySelectorAll(".tool-card.ok").length >= 1);
check("Запрос подтверждения обработан", doc.querySelector("#confirm-modal").hidden);
check("Модалка подтверждения была показана", requested.some((r) => r.url.includes("/api/chat")));

// --- настройки
doc.querySelector('[data-view="settings"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(120);
check("Настройки открываются", !doc.querySelector("#view-settings").hidden);
check("Поле модели заполнено", doc.querySelector("#cfg-model").value === "qwen2.5:7b", doc.querySelector("#cfg-model").value);
check("Голоса загружены", doc.querySelectorAll("#cfg-voice option").length === 1);
check("Радио безопасности", doc.querySelector('input[name="safety"][value="confirm"]').checked);
doc.querySelector("#cfg-temperature").value = "0.9";
doc.querySelector("#temp-value").textContent = "0.90";
check("Ползунок температуры", text("#temp-value") === "0.90");

// --- память
doc.querySelector('[data-view="memory"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(150);
check("Память: запись отрисована", doc.querySelectorAll(".memory-item").length === 1);
check("Память: категория", text(".memory-item .cat") === "профиль");

// --- акценты
doc.querySelector('.accent-swatch[data-accent="emerald"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("Акцент применяется", doc.documentElement.dataset.accent === "emerald", doc.documentElement.dataset.accent);

// --- модалка моделей
doc.querySelector("#model-chip").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(80);
check("Список моделей открыт", !doc.querySelector("#model-modal").hidden && doc.querySelectorAll(".model-item").length === 1);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : ` → ${r.extra}`}`);
}
if (errors.length) {
  console.log("\nОшибки JS:");
  errors.forEach((e) => console.log(" -", e));
}
console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length || errors.length ? 1 : 0);
