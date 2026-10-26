/* ================= AURA — клиент ================= */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const TOOL_ICONS = {
    run_command: "i-terminal", system_info: "i-cpu", list_dir: "i-folder", read_file: "i-chat",
    write_file: "i-chat", search_files: "i-search", open_path: "i-folder", open_app: "i-app",
    screenshot: "i-image", list_processes: "i-cpu", close_process: "i-close",
    media_control: "i-volume", power_action: "i-power", clipboard: "i-chat", notify: "i-alert",
    web_search: "i-search", http_get: "i-globe", weather: "i-globe", news: "i-news",
    current_time: "i-clock", remember: "i-brain", recall: "i-brain", forget: "i-trash",
    set_timer: "i-timer", cancel_timer: "i-timer", list_timers: "i-timer",
  };

  const TOOL_TITLES = {
    run_command: "Команда в терминале", system_info: "Система", list_dir: "Папка",
    read_file: "Чтение файла", write_file: "Запись файла", search_files: "Поиск файлов",
    open_path: "Открытие", open_app: "Запуск программы", screenshot: "Скриншот",
    list_processes: "Процессы", close_process: "Завершение процесса", media_control: "Звук",
    power_action: "Питание", clipboard: "Буфер обмена", notify: "Уведомление",
    web_search: "Поиск в интернете", http_get: "Интернет", weather: "Погода", news: "Новости",
    current_time: "Время", remember: "Запомнить", recall: "Память", forget: "Забыть",
    set_timer: "Таймер", cancel_timer: "Таймер", list_timers: "Таймеры",
  };

  const ICON_SVG = (id, cls = "icon") => `<svg class="${cls}"><use href="#${id}"/></svg>`;

  const S = {
    config: null,
    voice: { edge_tts: false, faster_whisper: false, voices: [] },
    tools: [],
    models: [],
    ollama: { online: false },
    sessionId: null,
    sessions: [],
    busy: false,
    abort: null,
    currentMsg: null,
    confirmRequest: null,
    view: "chat",
    autoSpeak: localStorage.getItem("aura.autoSpeak") === "1",
    ttsWarned: false,
    autoSend: localStorage.getItem("aura.autoSend") === "1",
    accent: localStorage.getItem("aura.accent") || "violet",
    recording: null,
    speaking: false,
    lastAssistantText: "",
    pendingSpeak: false,
    sysTimer: null,
    timerTicker: null,
    eventSource: null,
  };

  /* ---------------------------------------------------------- утилиты */
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {},
      ...options,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const error = new Error((data && (data.detail || data.error || data.message)) || `HTTP ${res.status}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function md(text) {
    if (!text) return "";
    let src = escapeHtml(text);
    const codeBlocks = [];
    src = src.replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    });

    src = src
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s>])(https?:\/\/[^\s<]+[^\s<.,!?)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

    const lines = src.split("\n");
    const out = [];
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${paragraph.join("<br>")}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) { out.push(`</${listType}>`); listType = null; }
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      if (/^\u0000CB\d+\u0000$/.test(line.trim())) { flushParagraph(); closeList(); out.push(line.trim()); continue; }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(4, heading[1].length) + 2;
        out.push(`<h${level}>${heading[2]}</h${level}>`);
        continue;
      }
      if (/^\s*([-*_]){3,}\s*$/.test(line)) { flushParagraph(); closeList(); out.push("<hr>"); continue; }
      const quote = line.match(/^&gt;\s?(.*)$/);
      if (quote) { flushParagraph(); closeList(); out.push(`<blockquote>${quote[1]}</blockquote>`); continue; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        flushParagraph();
        if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
        out.push(`<li>${ul[1]}</li>`);
        continue;
      }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushParagraph();
        if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
        out.push(`<li>${ol[1]}</li>`);
        continue;
      }
      paragraph.push(line.trim());
    }
    flushParagraph();
    closeList();
    let html = out.join("");
    html = html.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);
    return html;
  }

  function timeText(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function toast(kind, title, message = "", timeout = 4200) {
    const icons = { ok: "i-check", error: "i-alert", info: "i-sparkle", timer: "i-timer", warn: "i-alert" };
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.innerHTML = `${ICON_SVG(icons[kind] || "i-sparkle")}<div>${title ? `<b>${escapeHtml(title)}</b>` : ""}${message ? `<p>${escapeHtml(message)}</p>` : ""}</div>`;
    const box = $("#toasts");
    box.appendChild(node);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add("out");
      setTimeout(() => node.remove(), 320);
    }, timeout);
  }

  function fmtSize(gb) {
    if (!gb) return "";
    return `${gb} ГБ`;
  }

  function humanSeconds(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* ---------------------------------------------------------- вкладки и меню */
  function switchView(view) {
    S.view = view;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("#view-chat").hidden = view !== "chat";
    $("#view-memory").hidden = view !== "memory";
    $("#view-settings").hidden = view !== "settings";
    const railHidden = localStorage.getItem("aura.railHidden") === "1";
    $("#app").classList.toggle("rail-hidden", view !== "chat" || railHidden);
    if (view === "memory") loadMemory();
    if (view === "settings") fillSettings();
    if (view === "chat") scrollToBottom(true);
    closeSidebar();
  }

  function openSidebar() { $("#app").classList.add("sidebar-open"); }
  function closeSidebar() { $("#app").classList.remove("sidebar-open"); }

  /* ---------------------------------------------------------- приветствие */
  const QUICK_ACTIONS = [
    { icon: "i-cpu", title: "Состояние ПК", sub: "память, диск, температура", prompt: "Покажи состояние компьютера: загрузку процессора, память и диски" },
    { icon: "i-app", title: "Открыть программу", sub: "калькулятор, браузер, код", prompt: "Открой калькулятор" },
    { icon: "i-image", title: "Скриншот", sub: "снимок экрана в чат", prompt: "Сделай скриншот экрана" },
    { icon: "i-folder", title: "Порядок в файлах", sub: "что лежит в папке", prompt: "Покажи, что находится в моей домашней папке" },
    { icon: "i-timer", title: "Таймер", sub: "напомнить через 10 минут", prompt: "Поставь таймер на 10 минут с подписью «сделать перерыв»" },
    { icon: "i-volume", title: "Управление звуком", sub: "тише, громче, пауза", prompt: "Сделай звук тише" },
  ];

  function renderQuickActions() {
    const grid = $("#quick-actions");
    grid.innerHTML = QUICK_ACTIONS.map(
      (a) => `<button class="quick-card" data-prompt="${escapeHtml(a.prompt)}">
        ${ICON_SVG(a.icon)}<b>${escapeHtml(a.title)}</b><small>${escapeHtml(a.sub)}</small></button>`
    ).join("");
    grid.onclick = (event) => {
      const card = event.target.closest(".quick-card");
      if (!card) return;
      sendMessage(card.dataset.prompt);
    };
  }

  function renderRailActions() {
    const actions = [
      { icon: "i-cpu", label: "Проверить систему", prompt: "Как дела с компьютером? Проверь процессор и память" },
      { icon: "i-terminal", label: "Открыть терминал", prompt: "Открой терминал PowerShell" },
      { icon: "i-image", label: "Скриншот экрана", prompt: "Сделай скриншот" },
      { icon: "i-timer", label: "Таймер 5 минут", prompt: "Поставь таймер на 5 минут" },
      { icon: "i-globe", label: "Погода", prompt: "Какая сейчас погода?" },
      { icon: "i-news", label: "Новости", prompt: "Расскажи свежие новости" },
    ];
    const box = $("#rail-actions");
    box.innerHTML = actions.map(
      (a) => `<button class="rail-action" data-prompt="${escapeHtml(a.prompt)}">${ICON_SVG(a.icon)}<span>${escapeHtml(a.label)}</span></button>`
    ).join("");
    box.onclick = (e) => {
      const btn = e.target.closest(".rail-action");
      if (btn) { switchView("chat"); sendMessage(btn.dataset.prompt); }
    };
  }

  /* ---------------------------------------------------------- сессии */
  async function loadSessions(select = false) {
    try {
      const data = await api("/api/sessions");
      S.sessions = data.sessions || [];
      renderSessions();
      if (!S.sessionId && S.sessions.length) {
        await openSession(S.sessions[0].id, false);
      } else if (!S.sessionId) {
        await newSession(false);
      }
    } catch (err) {
      toast("error", "Не удалось загрузить историю", err.message);
    }
  }

  function renderSessions() {
    const box = $("#sessions");
    box.innerHTML = S.sessions.map(
      (s) => `<button class="session-item ${s.id === S.sessionId ? "active" : ""}" data-id="${s.id}">
        ${ICON_SVG("i-chat")}<span>${escapeHtml(s.title || "Диалог")}</span>
        <i class="del" data-del="${s.id}" title="Удалить">${ICON_SVG("i-trash")}</i>
      </button>`
    ).join("") || `<p class="muted small" style="padding:8px 10px">Пока пусто</p>`;
  }

  async function newSession(notify = true) {
    try {
      const data = await api("/api/sessions", { method: "POST", body: JSON.stringify({}) });
      S.sessionId = data.session.id;
      S.sessions.unshift({ ...data.session, message_count: 0 });
      renderSessions();
      clearChatUI();
      setTitle("Новый диалог", "Аура слушает и готова помочь");
      if (notify) toast("ok", "Новый диалог", "Можно начинать");
      switchView("chat");
      $("#input").focus();
    } catch (err) {
      toast("error", "Ошибка", err.message);
    }
  }

  async function openSession(id, scroll = true) {
    try {
      const data = await api(`/api/sessions/${id}`);
      S.sessionId = id;
      renderSessions();
      clearChatUI();
      const session = data.session;
      setTitle(session.title || "Диалог", `${session.message_count || 0} сообщений · ${timeText(session.updated)}`);
      (session.messages || []).forEach((m) => renderStoredMessage(m));
      toggleWelcome();
      if (scroll) scrollToBottom(true);
      if (data.pending) showConfirm(data.pending);
    } catch (err) {
      toast("error", "Не удалось открыть диалог", err.message);
    }
  }

  async function deleteSession(id) {
    try {
      await api(`/api/sessions/${id}`, { method: "DELETE" });
      S.sessions = S.sessions.filter((s) => s.id !== id);
      renderSessions();
      if (S.sessionId === id) {
        S.sessionId = null;
        if (S.sessions.length) await openSession(S.sessions[0].id);
        else await newSession(false);
      }
      toast("ok", "Диалог удалён");
    } catch (err) {
      toast("error", "Ошибка", err.message);
    }
  }

  function setTitle(title, subtitle) {
    $("#chat-title").textContent = title || "Диалог";
    if (subtitle !== undefined) $("#chat-subtitle").textContent = subtitle;
  }

  /* ---------------------------------------------------------- сообщения */
  function clearChatUI() {
    $("#messages").innerHTML = "";
    S.currentMsg = null;
    toggleWelcome();
  }

  function toggleWelcome() {
    const has = $("#messages").children.length > 0;
    $("#welcome").classList.toggle("compact", has);
  }

  function scrollToBottom(force = false) {
    const box = $("#chat-scroll");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
    if (force || nearBottom) box.scrollTop = box.scrollHeight;
  }

  function makeMessageEl(role) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const body = document.createElement("div");
    body.className = "bubble-wrap";
    body.innerHTML = `<div class="tool-stack"></div><div class="bubble"></div><div class="shots"></div><div class="msg-meta"></div>`;
    wrap.append(avatar, body);
    return wrap;
  }

  function bubbleEl(msgEl) { return msgEl.querySelector(".bubble"); }

  function addUserMessage(text) {
    const el = makeMessageEl("user");
    const bubble = bubbleEl(el);
    bubble.innerHTML = md(text);
    el.querySelector(".msg-meta").innerHTML = `${timeText(Date.now() / 1000)}`;
    $("#messages").appendChild(el);
    toggleWelcome();
    scrollToBottom(true);
    return el;
  }

  function addAssistantMessage() {
    const el = makeMessageEl("assistant");
    const bubble = bubbleEl(el);
    bubble.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
    const meta = el.querySelector(".msg-meta");
    meta.innerHTML = `<span class="status-text">Аура думает…</span>`;
    $("#messages").appendChild(el);
    toggleWelcome();
    scrollToBottom(true);
    return el;
  }

  function setStatus(msgEl, text) {
    if (!msgEl) return;
    const status = msgEl.querySelector(".status-text");
    if (status) status.textContent = text;
  }

  function toolCard(name, args, preview) {
    const card = document.createElement("div");
    card.className = "tool-card running";
    const icon = TOOL_ICONS[name] || "i-terminal";
    card.innerHTML = `
      <div class="tool-head">
        ${ICON_SVG(icon, "icon tool-icon")}
        <b>${escapeHtml(TOOL_TITLES[name] || name)}</b>
        <span class="tool-preview">${escapeHtml(preview || "")}</span>
        <span class="tool-status"><span class="spinner"></span></span>
        ${ICON_SVG("i-chevron", "icon chev")}
      </div>
      <div class="tool-body"><pre>Выполняется…</pre><div class="tool-meta-line"><span class="dur"></span><span class="oktext"></span></div></div>`;
    card.querySelector(".tool-head").addEventListener("click", () => card.classList.toggle("open"));
    return card;
  }

  function updateToolCard(card, result) {
    if (!card) return;
    card.classList.remove("running");
    card.classList.add(result.ok ? "ok" : "error");
    if (!result.ok) card.classList.add("open");
    const status = card.querySelector(".tool-status");
    status.innerHTML = result.ok ? ICON_SVG("i-check") : ICON_SVG("i-alert");
    const pre = card.querySelector(".tool-body pre");
    pre.textContent = result.output || (result.ok ? "Готово" : "Ошибка");
    card.querySelector(".dur").textContent = result.duration != null ? `${result.duration} с` : "";
    card.querySelector(".oktext").textContent = result.ok ? "успешно" : "ошибка";
    if (result.url && result.name === "screenshot") {
      const img = document.createElement("img");
      img.className = "shot";
      img.src = result.url + `?t=${Date.now()}`;
      img.alt = "Скриншот экрана";
      const shots = card.closest(".bubble-wrap").querySelector(".shots");
      (shots || card.closest(".bubble-wrap")).appendChild(img);
    }
  }

  function finalizeAssistant(msgEl, payload) {
    const bubble = bubbleEl(msgEl);
    const tools = payload.tools || [];
    if (payload.content) {
      bubble.innerHTML = md(payload.content);
    } else if (!tools.length) {
      bubble.innerHTML = `<p class="muted">Готово.</p>`;
    } else {
      bubble.innerHTML = "";
      bubble.style.display = "none";
    }
    const stats = payload.stats || {};
    const meta = msgEl.querySelector(".msg-meta");
    const parts = [`<span>${timeText(payload.ts || Date.now() / 1000)}</span>`];
    if (payload.model) parts.push(`<span class="sep">·</span><span>${escapeHtml(payload.model)}</span>`);
    if (payload.duration) parts.push(`<span class="sep">·</span><span>${payload.duration} с</span>`);
    if (stats.tokens_per_second) parts.push(`<span class="sep">·</span><span>${stats.tokens_per_second} т/с</span>`);
    if (payload.content) {
      parts.push(`<button class="copy-btn" data-copy="1">копировать</button>`);
      parts.push(`<button class="speak-btn" data-speak="1" title="Озвучить">${ICON_SVG("i-volume")}</button>`);
    }
    meta.innerHTML = parts.join("");
    meta.querySelector("[data-copy]")?.addEventListener("click", () => {
      navigator.clipboard.writeText(payload.content).then(() => toast("ok", "Скопировано"));
    });
    meta.querySelector("[data-speak]")?.addEventListener("click", () => speak(payload.content));
    msgEl.classList.remove("typing-active");
  }

  function renderStoredMessage(m) {
    if (m.role === "user") {
      const el = makeMessageEl("user");
      bubbleEl(el).innerHTML = md(m.content);
      el.querySelector(".msg-meta").innerHTML = `<span>${timeText(m.ts)}</span>`;
      $("#messages").appendChild(el);
      return;
    }
    const el = makeMessageEl("assistant");
    const stack = el.querySelector(".tool-stack");
    const shots = el.querySelector(".shots");
    (m.tools || []).forEach((t) => {
      const card = toolCard(t.name, t.arguments, t.arguments ? Object.values(t.arguments).join(" ").slice(0, 120) : "");
      stack.appendChild(card);
      updateToolCard(card, { ok: t.ok, output: t.output, name: t.name });
      if (t.url) {
        const img = document.createElement("img");
        img.className = "shot";
        img.src = t.url;
        img.alt = "Скриншот";
        shots.appendChild(img);
      }
    });
    if (m.content) bubbleEl(el).innerHTML = md(m.content);
    else bubbleEl(el).style.display = "none";
    el.querySelector(".msg-meta").innerHTML = m.content
      ? `<span>${timeText(m.ts)}</span>${m.model ? `<span class="sep">·</span><span>${escapeHtml(m.model)}</span>` : ""}<button class="speak-btn" data-speak="1">${ICON_SVG("i-volume")}</button>`
      : `<span>${timeText(m.ts)}</span>`;
    el.querySelector("[data-speak]")?.addEventListener("click", () => speak(m.content));
    $("#messages").appendChild(el);
  }

  /* ---------------------------------------------------------- отправка и стрим */
  async function sendMessage(rawText) {
    let text = (rawText ?? $("#input").value).trim();
    if (!text) return;
    if (S.busy) {
      toast("info", "Аура ещё занята", "Дождитесь ответа или остановите выполнение");
      return;
    }
    if (!S.sessionId) await newSession(false);

    S.busy = true;
    setBusyUI(true);
    $("#input").value = "";
    autoGrow();
    addUserMessage(text);
    if (S.speaking) stopSpeaking();

    const msgEl = addAssistantMessage();
    S.currentMsg = msgEl;
    const stack = msgEl.querySelector(".tool-stack");
    const cards = new Map();
    let firstToken = true;
    let buffer = "";

    const controller = new AbortController();
    S.abort = controller;

    const handle = (event) => {
      switch (event.type) {
        case "start":
          if (event.session_id) {
            S.sessionId = event.session_id;
            renderSessions();
          }
          break;
        case "status":
          setStatus(msgEl, event.text || "Работаю…");
          break;
        case "token": {
          if (firstToken) {
            firstToken = false;
            bubbleEl(msgEl).innerHTML = "";
          }
          buffer += event.text;
          bubbleEl(msgEl).innerHTML = md(buffer);
          scrollToBottom();
          break;
        }
        case "thinking":
          setStatus(msgEl, "Размышляю над задачей…");
          break;
        case "tool_start": {
          setStatus(msgEl, `${TOOL_TITLES[event.name] || event.name}…`);
          const card = toolCard(event.name, event.arguments, event.preview);
          stack.appendChild(card);
          cards.set(event.id, card);
          if (firstToken) {
            bubbleEl(msgEl).innerHTML = "";
            firstToken = false;
          }
          scrollToBottom();
          break;
        }
        case "tool_result": {
          const card = cards.get(event.id);
          updateToolCard(card, event);
          if (event.ok) toast("ok", TOOL_TITLES[event.name] || event.name, "Выполнено", 2600);
          else toast("error", TOOL_TITLES[event.name] || event.name, "Не получилось — подробности в чате", 5000);
          if (["set_timer", "cancel_timer", "list_timers"].includes(event.name)) loadTimers();
          if (event.name === "remember" || event.name === "forget") updateMemoryCount();
          if (event.name === "system_info") pollSystem();
          scrollToBottom();
          break;
        }
        case "confirm":
          showConfirm(event.request);
          break;
        case "confirm_result":
          hideConfirm();
          break;
        case "assistant_end": {
          const message = event.message || {};
          finalizeAssistant(msgEl, message);
          S.lastAssistantText = message.content || "";
          if (S.autoSpeak && S.lastAssistantText) speak(S.lastAssistantText);
          scrollToBottom();
          break;
        }
        case "error":
          bubbleEl(msgEl).innerHTML = `<p>${escapeHtml(event.message || "Ошибка")}</p>`;
          bubbleEl(msgEl).style.display = "";
          msgEl.querySelector(".msg-meta").innerHTML = `<span style="color:var(--danger)">ошибка</span>`;
          toast("error", "Ошибка", event.message || "");
          if (event.model_missing) toast("info", "Как исправить", "Откройте настройки и скачайте модель.");
          break;
        case "done":
          break;
        default:
          break;
      }
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, session_id: S.sessionId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Сервер ответил ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = rest.indexOf("\n\n")) >= 0) {
          const chunk = rest.slice(0, idx);
          rest = rest.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try { handle(JSON.parse(dataLine.slice(6))); } catch (err) { console.warn("bad event", err); }
        }
      }
      const meta = msgEl.querySelector(".msg-meta");
      if (!meta.innerHTML.trim() || meta.innerHTML.includes("думает")) {
        finalizeAssistant(msgEl, { content: buffer || "Готово.", ts: Date.now() / 1000, tools: [] });
      }
      await loadSessions(false);
      if (S.sessionId) {
        const current = S.sessions.find((s) => s.id === S.sessionId);
        if (current) setTitle(current.title, "Аура на связи");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        toast("error", "Сбой соединения", err.message);
        setStatus(msgEl, "Соединение прервано");
      } else {
        setStatus(msgEl, "Остановлено");
        if (!buffer) bubbleEl(msgEl).innerHTML = `<p class="muted">Остановлено.</p>`;
      }
    } finally {
      S.busy = false;
      S.abort = null;
      setBusyUI(false);
      hideConfirm();
      toggleWelcome();
    }
  }

  function setBusyUI(busy) {
    $("#stop-btn").hidden = !busy;
    $("#send-btn").disabled = busy;
    $("#input").disabled = false;
  }

  function stopGeneration() {
    if (!S.busy) return;
    api("/api/stop", { method: "POST", body: JSON.stringify({ session_id: S.sessionId, approved: false }) }).catch(() => {});
    setTimeout(() => S.abort?.abort(), 220);
  }

  /* ---------------------------------------------------------- подтверждения */
  function showConfirm(request) {
    S.confirmRequest = request;
    $("#confirm-title").textContent = request.title || "Действие";
    $("#confirm-tool").textContent = request.tool || "";
    const risk = $("#confirm-risk");
    const safe = request.risk === "safe";
    risk.textContent = request.risk_text || request.risk || "—";
    risk.classList.toggle("safe", safe);
    const fields = request.fields || [];
    const box = $("#confirm-preview");
    if (fields.length) {
      box.classList.add("fields");
      box.innerHTML = fields.map(
        (f) => `<div class="confirm-field"><span>${escapeHtml(f.label)}</span><code>${escapeHtml(f.value)}</code></div>`
      ).join("");
    } else {
      box.classList.remove("fields");
      box.textContent = request.preview || "—";
    }
    $("#confirm-reason").textContent = request.reason || "";
    $("#confirm-remember-row").hidden = !request.can_remember;
    $("#confirm-remember").checked = false;
    $("#confirm-modal").hidden = false;
    setTimeout(() => $("#confirm-title").closest(".confirm").focus(), 60);
  }

  function hideConfirm() {
    $("#confirm-modal").hidden = true;
    S.confirmRequest = null;
  }

  async function answerConfirm(approved) {
    const request = S.confirmRequest;
    if (!request) return;
    const remember = $("#confirm-remember").checked;
    hideConfirm();
    try {
      await api("/api/confirm", {
        method: "POST",
        body: JSON.stringify({ session_id: S.sessionId, approved, remember }),
      });
    } catch (err) {
      toast("error", "Не удалось отправить ответ", err.message);
    }
  }

  /* ---------------------------------------------------------- голос: TTS */
  function ttsEngine() {
    const engine = (S.config?.tts?.engine || "auto");
    if (engine === "off") return "off";
    if (engine === "browser") return "browser";
    if (engine === "edge") return S.voice.edge_tts ? "edge" : "browser";
    if (S.voice.edge_tts) return "edge";
    return "browser";
  }

  async function speak(text) {
    if (!text) return;
    const engine = ttsEngine();
    if (engine === "off") return;
    stopSpeaking();
    if (engine === "edge") {
      try {
        setSpeakingState(true);
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: S.config?.tts?.voice }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Синтез речи недоступен");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const player = $("#player");
        player.src = url;
        player.onended = () => { setSpeakingState(false); URL.revokeObjectURL(url); };
        await player.play();
        return;
      } catch (err) {
        console.warn("edge tts failed", err);
        if (!S.ttsWarned) {
          S.ttsWarned = true;
          toast("info", "Голос Edge недоступен", "Озвучиваю голосом браузера. Можно выбрать в настройках.");
        }
      }
    }
    browserSpeak(text);
  }

  function browserSpeak(text) {
    if (!("speechSynthesis" in window)) {
      setSpeakingState(false);
      return;
    }
    const clean = text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*#_`>|]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "ссылка")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean.slice(0, 3000));
    const voices = speechSynthesis.getVoices();
    const ru = voices.find((v) => /ru[-_]/i.test(v.lang));
    if (ru) utter.voice = ru;
    utter.lang = ru ? ru.lang : "ru-RU";
    const rateMap = { "-20%": 0.8, "-10%": 0.9, "+0%": 1, "+10%": 1.1, "+25%": 1.25 };
    utter.rate = rateMap[S.config?.tts?.rate] || 1;
    utter.onstart = () => setSpeakingState(true);
    utter.onend = () => setSpeakingState(false);
    utter.onerror = () => setSpeakingState(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }

  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch { /* noop */ }
    const player = $("#player");
    if (player) { player.pause(); player.currentTime = 0; }
    setSpeakingState(false);
  }

  function setSpeakingState(on) {
    S.speaking = on;
    document.body.classList.toggle("speaking", on);
    const btn = $("#speak-toggle");
    btn.classList.toggle("speaking", on);
    btn.classList.toggle("active", !on && S.autoSpeak && ttsEngine() !== "off");
    btn.title = on ? "Остановить озвучку" : S.autoSpeak ? "Автоозвучка включена" : "Включить автоозвучку";
  }

  /* ---------------------------------------------------------- голос: STT */
  function sttMode() {
    const engine = S.config?.stt?.engine || "auto";
    const whisper = S.voice.faster_whisper;
    if (engine === "browser") return "browser";
    if (engine === "whisper") return whisper ? "whisper" : "browser";
    return whisper ? "whisper" : "browser";
  }

  async function startRecording() {
    if (S.recording) { stopRecording(true); return; }
    if (ttsEngine() !== "off") stopSpeaking();
    const mode = sttMode();
    if (mode === "browser" && !("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast("error", "Голосовой ввод недоступен", "Браузер не поддерживает распознавание. Установите faster-whisper на сервере.");
      return;
    }
    if (mode === "whisper") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: "audio/webm" });
          if (S.recording?.cancelled) return;
          await transcribeBlob(blob);
        };
        recorder.start();
        beginRecordingUI({ stream, recorder, cancelled: false, mode });
      } catch (err) {
        toast("error", "Нет доступа к микрофону", err.message);
      }
      return;
    }
    // браузерное распознавание
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = "ru-RU";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) $("#rec-hint").textContent = interim.slice(-60);
      if (final) {
        finishVoiceText(final.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        toast("error", "Распознавание не удалось", event.error);
      }
      endRecordingUI();
    };
    recognition.onend = () => {
      if (S.recording) {
        endRecordingUI();
        if (S.recording?.cancelled) return;
        if (!S.recording?.text) toast("info", "Не расслышала", "Попробуйте ещё раз");
      }
    };
    try {
      recognition.start();
      beginRecordingUI({ recognition, mode: "browser" });
    } catch (err) {
      toast("error", "Микрофон недоступен", err.message);
    }
  }

  function beginRecordingUI(payload) {
    S.recording = { ...payload, started: Date.now() };
    $("#recording-bar").hidden = false;
    $("#mic-btn").classList.add("recording");
    $("#rec-hint").textContent = payload.mode === "whisper" ? "Говорите…" : "Говорите…";
    $("#rec-time").textContent = "0:00";
    clearInterval(S.recTimer);
    S.recTimer = setInterval(() => {
      $("#rec-time").textContent = humanSeconds((Date.now() - S.recording.started) / 1000);
      if (Date.now() - S.recording.started > 120000) stopRecording(true);
    }, 250);
  }

  function endRecordingUI() {
    clearInterval(S.recTimer);
    S.recording = null;
    $("#recording-bar").hidden = true;
    $("#mic-btn").classList.remove("recording");
  }

  function stopRecording(send = true) {
    const rec = S.recording;
    if (!rec) return;
    rec.cancelled = !send;
    endRecordingUI();
    if (rec.recorder && rec.recorder.state !== "inactive") {
      rec.recorder.stop();
    }
    if (rec.recognition) {
      try { rec.recognition.stop(); } catch { /* noop */ }
    }
    if (!send) toast("info", "Запись отменена");
  }

  async function transcribeBlob(blob) {
    if (!blob.size) return;
    toast("info", "Распознаю речь…", "", 2200);
    try {
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      const res = await fetch("/api/stt", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.detail || "Ошибка распознавания");
      if (!data.text) {
        toast("info", "Не расслышала", "Попробуйте сказать ближе к микрофону");
        return;
      }
      finishVoiceText(data.text);
    } catch (err) {
      toast("error", "Распознавание не удалось", err.message);
    }
  }

  function finishVoiceText(text) {
    const input = $("#input");
    const merged = (input.value ? input.value + " " : "") + text;
    input.value = merged;
    autoGrow();
    input.focus();
    if (S.autoSend) sendMessage(merged);
    else toast("ok", "Распознано", text.slice(0, 120));
  }

  /* ---------------------------------------------------------- настройки */
  function applyAccent(accent) {
    S.accent = accent;
    document.documentElement.dataset.accent = accent;
    localStorage.setItem("aura.accent", accent);
    $$("#accent-picker .accent-swatch").forEach((b) => b.classList.toggle("active", b.dataset.accent === accent));
  }

  function segmented(el, value, onChange) {
    if (!el) return;
    $$("button", el).forEach((b) => {
      b.type = "button";
      b.classList.toggle("active", b.dataset.value === value);
      b.onclick = () => {
        $$("button", el).forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        onChange(b.dataset.value);
      };
    });
  }

  function fillSettings() {
    const c = S.config || {};
    applyAccent(S.accent);
    $("#cfg-ollama-url").value = c.ollama_url || "";
    $("#cfg-temperature").value = c.temperature ?? 0.6;
    $("#temp-value").textContent = Number(c.temperature ?? 0.6).toFixed(2);
    $("#cfg-num-ctx").value = c.num_ctx || 8192;
    $("#cfg-assistant-name").value = c.assistant_name || "";
    $("#cfg-user-name").value = c.user_name || "";
    $("#cfg-persona").value = c.persona || "";
    $("#cfg-workspace").value = c.safety?.workspace || "";
    $("#auto-speak").checked = S.autoSpeak;
    $("#auto-send").checked = S.autoSend;

    const modelSelect = $("#cfg-model");
    const names = S.models.map((m) => m.name);
    if (c.model && !names.includes(c.model)) names.unshift(c.model);
    modelSelect.innerHTML = names.length
      ? names.map((n) => `<option value="${escapeHtml(n)}" ${n === c.model ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")
      : `<option value="">— нет моделей —</option>`;

    const voiceSelect = $("#cfg-voice");
    voiceSelect.innerHTML = (S.voice.voices || []).map(
      (v) => `<option value="${v.id}" ${v.id === c.tts?.voice ? "selected" : ""}>${escapeHtml(v.name)} — ${v.gender}${v.tag ? ", " + v.tag : ""}</option>`
    ).join("");
    $("#cfg-rate").value = c.tts?.rate || "+0%";
    $("#cfg-whisper-size").value = c.stt?.model_size || "small";

    segmented($("#tts-engine"), c.tts?.engine || "auto");
    segmented($("#stt-engine"), c.stt?.engine || "auto");
    segmented($("#demo-mode"), c.demo_mode || "auto");
    $$('input[name="safety"]').forEach((r) => { r.checked = r.value === (c.safety?.mode || "confirm"); });
    $$("#accent-picker .accent-swatch").forEach((b) => b.classList.toggle("active", b.dataset.accent === S.accent));
    $("#stt-hint").textContent = S.voice.faster_whisper
      ? "Whisper установлен — распознавание идёт на вашем компьютере."
      : "Whisper не установлен (pip install faster-whisper), используется движок браузера.";
    $("#safe-note").innerHTML = `${ICON_SVG("i-shield")} ${c.safety?.mode === "auto" ? "автовыполнение включено" : c.safety?.mode === "strict" ? "строгий режим" : "подтверждение опасных действий"}`;
  }

  async function saveSettings() {
    const ttsEngine = $("#tts-engine button.active")?.dataset.value || "auto";
    const sttEngine = $("#stt-engine button.active")?.dataset.value || "auto";
    const demoMode = $("#demo-mode button.active")?.dataset.value || "auto";
    const safety = $$('input[name="safety"]').find((r) => r.checked)?.value || "confirm";
    const patch = {
      ollama_url: $("#cfg-ollama-url").value.trim() || "http://127.0.0.1:11434",
      model: $("#cfg-model").value,
      temperature: Number($("#cfg-temperature").value),
      num_ctx: Number($("#cfg-num-ctx").value) || 8192,
      assistant_name: $("#cfg-assistant-name").value.trim() || "Аура",
      user_name: $("#cfg-user-name").value.trim(),
      persona: $("#cfg-persona").value.trim(),
      demo_mode: demoMode,
      tts: { engine: ttsEngine, voice: $("#cfg-voice").value, rate: $("#cfg-rate").value },
      stt: { engine: sttEngine, model_size: $("#cfg-whisper-size").value },
      safety: { mode: safety, workspace: $("#cfg-workspace").value.trim() },
    };
    try {
      const data = await api("/api/config", { method: "PUT", body: JSON.stringify({ patch }) });
      S.config = data.config;
      applyConfigToHeader();
      toast("ok", "Настройки сохранены", "Изменения применяются сразу");
      refreshModels();
    } catch (err) {
      toast("error", "Не удалось сохранить", err.message);
    }
  }

  async function applyConfigToHeader() {
    const c = S.config || {};
    $("#model-chip-text").textContent = c.model || "модель не выбрана";
    $("#brand-name") && ($("#brand-name").textContent = c.assistant_name || "АУРА");
    setSpeakingState(false);
    $("#safe-note").innerHTML = `${ICON_SVG("i-shield")} ${c.safety?.mode === "auto" ? "автовыполнение включено" : c.safety?.mode === "strict" ? "строгий режим" : "подтверждение опасных действий"}`;
    const btnSpeak = $("#speak-toggle");
    btnSpeak.classList.remove("speaking");
    btnSpeak.classList.toggle("active", S.autoSpeak && ttsEngine() !== "off");
    btnSpeak.title = S.autoSpeak ? "Автоозвучка включена" : "Включить автоозвучку";
  }

  /* ---------------------------------------------------------- модели */
  async function refreshModels() {
    try {
      const data = await api("/api/models");
      S.ollama = data;
      S.models = data.models || [];
      updateOllamaPill(data.online, S.models.length, data.version);
      renderModelModal();
      if (S.view === "settings") fillSettings();
      $("#setup-card").hidden = data.online && S.models.length > 0;
      applyConfigToHeader();
    } catch (err) {
      console.warn(err);
    }
  }

  function updateOllamaPill(online, count, version) {
    const pill = $("#ollama-pill");
    pill.classList.remove("online", "offline", "demo");
    if (online && count > 0) {
      pill.classList.add("online");
      pill.querySelector("span").textContent = `Ollama ${version || ""} · ${count} модел${count === 1 ? "ь" : count < 5 ? "и" : "ей"}`;
    } else if (online && count === 0) {
      pill.classList.add("demo");
      pill.querySelector("span").textContent = "Ollama работает, но нет моделей";
    } else {
      pill.classList.add("offline");
      pill.querySelector("span").textContent = "Ollama не запущена · демо-режим";
    }
  }

  function renderModelModal() {
    const box = $("#model-list");
    if (!S.models.length) {
      box.innerHTML = `<p class="muted small">Моделей нет. Скачайте модель в настройках, например <code>qwen2.5:7b</code>.</p>`;
      return;
    }
    box.innerHTML = S.models.map(
      (m) => `<button class="model-item ${m.name === S.config?.model ? "active" : ""}" data-model="${escapeHtml(m.name)}">
        <span class="m-name">${escapeHtml(m.name)}</span>
        <span class="m-tag ${m.tools ? "" : "no"}">${m.tools ? "инструменты" : "только текст"}</span>
        ${m.parameters ? `<span class="m-size">${escapeHtml(m.parameters)}</span>` : ""}
        <span class="m-size">${fmtSize(m.size_gb)}</span>
      </button>`
    ).join("");
    box.onclick = async (event) => {
      const item = event.target.closest(".model-item");
      if (!item) return;
      const model = item.dataset.model;
      try {
        const data = await api("/api/config", { method: "PUT", body: JSON.stringify({ patch: { model } }) });
        S.config = data.config;
        applyConfigToHeader();
        renderModelModal();
        $("#model-modal").hidden = true;
        toast("ok", "Модель выбрана", model);
      } catch (err) {
        toast("error", "Ошибка", err.message);
      }
    };
  }

  async function pullModel() {
    const name = $("#pull-model").value.trim();
    if (!name) { toast("info", "Укажите модель", "Например: llama3.2:3b"); return; }
    const progress = $("#pull-progress");
    const status = $("#pull-status");
    progress.hidden = false;
    progress.firstElementChild.style.width = "2%";
    status.textContent = "запуск…";
    try {
      const res = await fetch(`/api/models/pull?model=${encodeURIComponent(name)}`);
      if (!res.ok || !res.body) throw new Error("Сервер не принял запрос");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = rest.indexOf("\n\n")) >= 0) {
          const chunk = rest.slice(0, idx);
          rest = rest.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (data.error) {
            status.textContent = "ошибка";
            toast("error", "Не удалось скачать модель", data.error);
            progress.hidden = true;
            return;
          }
          if (data.percent != null) {
            progress.firstElementChild.style.width = `${Math.min(100, data.percent)}%`;
          }
          status.textContent = data.status || "";
          if (data.done) {
            progress.firstElementChild.style.width = "100%";
            toast("ok", "Модель скачана", name);
            setTimeout(() => { progress.hidden = true; status.textContent = ""; refreshModels(); }, 1200);
          }
        }
      }
    } catch (err) {
      toast("error", "Ошибка загрузки", err.message);
      progress.hidden = true;
    }
  }

  /* ---------------------------------------------------------- память */
  async function loadMemory(query = "") {
    try {
      const data = await api(`/api/memory?q=${encodeURIComponent(query)}`);
      const items = data.items || [];
      const box = $("#memory-list");
      box.innerHTML = items.length
        ? items.map(
            (item) => `<div class="memory-item">
              <span class="cat">${escapeHtml(item.category || "общее")}</span>
              <p>${escapeHtml(item.text)}</p>
              <button class="del" data-id="${item.id}" title="Удалить">${ICON_SVG("i-trash")}</button>
            </div>`
          ).join("")
        : `<div class="empty">Память пока пуста. Добавьте первый факт — Аура будет его помнить.</div>`;
      box.onclick = async (event) => {
        const btn = event.target.closest(".del");
        if (!btn) return;
        try {
          await api(`/api/memory/${btn.dataset.id}`, { method: "DELETE" });
          loadMemory($("#memory-search").value);
          updateMemoryCount();
        } catch (err) {
          toast("error", "Ошибка", err.message);
        }
      };
    } catch (err) {
      toast("error", "Не удалось загрузить память", err.message);
    }
  }

  async function addMemory(event) {
    event.preventDefault();
    const text = $("#memory-input").value.trim();
    if (!text) return;
    try {
      await api("/api/memory", {
        method: "POST",
        body: JSON.stringify({ text, category: $("#memory-category").value }),
      });
      $("#memory-input").value = "";
      loadMemory($("#memory-search").value);
      updateMemoryCount();
      toast("ok", "Запомнила", text.slice(0, 80));
    } catch (err) {
      toast("error", "Ошибка", err.message);
    }
  }

  async function updateMemoryCount() {
    try {
      const data = await api("/api/memory");
      $("#memory-badge").textContent = (data.items || []).length;
    } catch { /* noop */ }
  }

  /* ---------------------------------------------------------- таймеры и статистика */
  async function loadTimers() {
    try {
      const data = await api("/api/timers");
      renderTimers(data.timers || []);
    } catch { /* noop */ }
  }

  function renderTimers(timers) {
    const box = $("#timer-list");
    if (!timers.length) {
      box.innerHTML = `<p class="muted small">Активных нет</p>`;
      return;
    }
    box.innerHTML = timers.map(
      (t) => `<div class="timer-item" data-id="${t.id}" data-due="${t.due}">
        <b>${escapeHtml(t.label || "Таймер")}</b>
        <span class="t-left">${humanSeconds(t.left)}</span>
        <button data-cancel="${t.id}" title="Отменить">${ICON_SVG("i-close")}</button>
      </div>`
    ).join("");
    box.onclick = async (event) => {
      const btn = event.target.closest("[data-cancel]");
      if (!btn) return;
      try {
        await api(`/api/timers/${btn.dataset.cancel}`, { method: "DELETE" });
        loadTimers();
      } catch (err) { toast("error", "Ошибка", err.message); }
    };
  }

  function tickTimers() {
    $$("#timer-list .timer-item").forEach((row) => {
      const due = Number(row.dataset.due);
      if (!due) return;
      row.querySelector(".t-left").textContent = humanSeconds(due - Date.now() / 1000);
    });
  }

  async function pollSystem() {
    try {
      const data = await api("/api/system");
      const cpu = Math.round(data.cpu || 0);
      const ram = Math.round(data.ram || 0);
      const disk = Math.round(data.disk || 0);
      $("#cpu-value").textContent = `${cpu}%`;
      $("#ram-value").textContent = `${ram}%`;
      $("#disk-value").textContent = disk ? `${disk}%` : "—";
      setBar("#cpu-bar", cpu);
      setBar("#ram-bar", ram);
      setBar("#disk-bar", disk);
      $("#ram-detail").textContent = data.ram_total ? `${data.ram_used} из ${data.ram_total} ГБ · ${data.cores || "?"} ядер` : "";
      if (data.battery != null) {
        $("#battery-pill").hidden = false;
        $("#battery-value").textContent = `${data.battery}%${data.charging ? " ⚡" : ""}`;
      }
      if (data.disk_free != null) $("#disk-value").title = `свободно ${data.disk_free} ГБ`;
    } catch { /* noop */ }
  }

  function setBar(sel, value) {
    const bar = $(sel);
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.classList.toggle("hot", value >= 80);
  }

  async function pollState() {
    try {
      const data = await api("/api/state");
      S.config = data.config;
      S.voice = data.voice;
      S.tools = data.tools || [];
      S.ollama = data.ollama || {};
      S.models = data.ollama?.models || [];
      updateOllamaPill(S.ollama.online, S.models.length, S.ollama.version);
      $("#platform-pill").innerHTML = `${ICON_SVG("i-keyboard")}<b>${escapeHtml(data.platform.system)} ${escapeHtml(data.platform.release)}</b>`;
      $("#setup-card").hidden = !!(S.ollama.online && S.models.length);
      $("#tool-cloud").innerHTML = (data.tools || []).slice(0, 20).map((t) => `<span>${escapeHtml(TOOL_TITLES[t.name] || t.name)}</span>`).join("");
      $("#memory-badge").textContent = data.memory_count || 0;
      renderTimers(data.timers || []);
      applyConfigToHeader();
      if (S.view === "settings") fillSettings();
    } catch (err) {
      console.warn("state", err);
    }
  }

  /* ---------------------------------------------------------- события сервера */
  function connectEvents() {
    if (S.eventSource) S.eventSource.close();
    const source = new EventSource("/api/events");
    S.eventSource = source;
    source.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "timer") {
        const label = data.timer?.label || "Таймер";
        toast("timer", "⏰ Напоминание", label, 12000);
        speak(`Напоминаю: ${label}`);
        loadTimers();
      }
    };
    source.onerror = () => {
      source.close();
      S.eventSource = null;
      setTimeout(connectEvents, 6000);
    };
  }

  /* ---------------------------------------------------------- ввод */
  function autoGrow() {
    const ta = $("#input");
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }

  function bindEvents() {
    $("#composer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage();
    });
    $("#input").addEventListener("input", autoGrow);
    $("#input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    $("#mic-btn").addEventListener("click", startRecording);
    $("#rec-done").addEventListener("click", () => stopRecording(true));
    $("#rec-cancel").addEventListener("click", () => stopRecording(false));
    $("#stop-btn").addEventListener("click", stopGeneration);
    $("#speak-toggle").addEventListener("click", () => {
      if (S.speaking) { stopSpeaking(); return; }
      S.autoSpeak = !S.autoSpeak;
      localStorage.setItem("aura.autoSpeak", S.autoSpeak ? "1" : "0");
      $("#auto-speak").checked = S.autoSpeak;
      $("#speak-toggle").classList.toggle("active", S.autoSpeak);
      toast(S.autoSpeak ? "ok" : "info", S.autoSpeak ? "Автоозвучка включена" : "Автоозвучка выключена",
        S.autoSpeak ? "Аура будет читать ответы вслух" : "");
      if (S.autoSpeak && S.lastAssistantText) speak(S.lastAssistantText);
    });

    $("#new-chat").addEventListener("click", () => newSession(true));
    $("#refresh-sessions").addEventListener("click", () => loadSessions());
    $("#sessions").addEventListener("click", (event) => {
      const del = event.target.closest("[data-del]");
      if (del) { event.stopPropagation(); deleteSession(del.dataset.del); return; }
      const item = event.target.closest(".session-item");
      if (item) openSession(item.dataset.id);
    });
    $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
    $("#settings-btn").addEventListener("click", () => switchView("settings"));
    $("#menu-btn").addEventListener("click", () => {
      $("#app").classList.toggle("sidebar-open");
    });
    $("#rail-toggle").addEventListener("click", () => {
      const app = $("#app");
      if (window.innerWidth <= 1100) {
        app.classList.toggle("rail-open");
      } else {
        app.classList.toggle("rail-hidden");
        localStorage.setItem("aura.railHidden", app.classList.contains("rail-hidden") ? "1" : "0");
      }
    });

    $("#model-chip").addEventListener("click", () => {
      renderModelModal();
      $("#model-modal").hidden = false;
    });
    $("#model-close").addEventListener("click", () => { $("#model-modal").hidden = true; });
    $("#model-settings").addEventListener("click", () => {
      $("#model-modal").hidden = true;
      switchView("settings");
    });

    $("#confirm-allow").addEventListener("click", () => answerConfirm(true));
    $("#confirm-deny").addEventListener("click", () => answerConfirm(false));
    $("#setup-check").addEventListener("click", async () => {
      await pollState();
      await refreshModels();
      if (S.ollama.online) toast("ok", "Ollama на связи", S.models.length ? "Можно общаться" : "Осталось скачать модель");
      else toast("error", "Ollama не отвечает", "Запустите её командой ollama serve");
    });

    $("#save-settings").addEventListener("click", saveSettings);
    $("#save-settings-2").addEventListener("click", saveSettings);
    $("#cfg-temperature").addEventListener("input", (e) => { $("#temp-value").textContent = Number(e.target.value).toFixed(2); });
    $("#reload-models").addEventListener("click", async () => { await refreshModels(); toast("ok", "Список моделей обновлён"); });
    $("#pull-btn").addEventListener("click", pullModel);
    $$("[data-pull]").forEach((btn) => btn.addEventListener("click", () => {
      $("#pull-model").value = btn.dataset.pull;
      $("#pull-model").focus();
    }));
    $$("[data-persona]").forEach((btn) => btn.addEventListener("click", () => {
      $("#cfg-persona").value = btn.dataset.persona;
    }));
    $("#auto-speak").addEventListener("change", (e) => {
      S.autoSpeak = e.target.checked;
      localStorage.setItem("aura.autoSpeak", S.autoSpeak ? "1" : "0");
      setSpeakingState(false);
    });
    $("#auto-send").addEventListener("change", (e) => {
      S.autoSend = e.target.checked;
      localStorage.setItem("aura.autoSend", e.target.checked ? "1" : "0");
    });
    $("#test-voice").addEventListener("click", () => {
      speak("Привет! Я Аура, ваш голосовой ассистент. Готова помочь с компьютером.");
    });
    $("#clear-allowlist").addEventListener("click", async () => {
      try {
        await api("/api/config", { method: "PUT", body: JSON.stringify({ patch: { command_allowlist: [] } }) });
        toast("ok", "Список разрешённых команд очищен");
      } catch (err) { toast("error", "Ошибка", err.message); }
    });
    $$("#accent-picker .accent-swatch").forEach((btn) => btn.addEventListener("click", () => applyAccent(btn.dataset.accent)));

    $("#open-data").addEventListener("click", async () => {
      try {
        const data = await api("/api/open-data", { method: "POST" });
        if (!data.ok) toast("error", "Не удалось открыть папку", data.output || "");
      } catch (err) {
        toast("error", "Ошибка", err.message);
      }
    });

    $("#memory-form").addEventListener("submit", addMemory);
    let memoryTimer = null;
    $("#memory-search").addEventListener("input", (e) => {
      clearTimeout(memoryTimer);
      memoryTimer = setTimeout(() => loadMemory(e.target.value), 250);
    });

    $("#chat-scroll").addEventListener("scroll", () => {
      const box = $("#chat-scroll");
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      $("#chat-scroll").classList.toggle("at-bottom", atBottom);
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".modal-backdrop") && !event.target.closest(".modal")) {
        if (!$("#confirm-modal").hidden) answerConfirm(false);
        else $("#model-modal").hidden = true;
      }
      if (window.innerWidth <= 860 && $("#app").classList.contains("sidebar-open")) {
        if (!event.target.closest(".sidebar") && !event.target.closest("#menu-btn")) closeSidebar();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!$("#confirm-modal").hidden) answerConfirm(false);
        else if (!$("#model-modal").hidden) $("#model-modal").hidden = true;
        else if (window.innerWidth <= 860) closeSidebar();
        else if (S.busy) stopGeneration();
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
        event.preventDefault();
        startRecording();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        switchView("chat");
        $("#input").focus();
      }
    });

    window.addEventListener("resize", () => {
      const app = $("#app");
      if (window.innerWidth > 1100) app.classList.remove("rail-open");
      if (window.innerWidth > 860) {
        app.classList.remove("sidebar-open");
        app.classList.toggle("rail-hidden", localStorage.getItem("aura.railHidden") === "1");
      }
    });
  }

  /* ---------------------------------------------------------- запуск */
  async function boot() {
    applyAccent(S.accent);
    renderQuickActions();
    renderRailActions();
    bindEvents();

    try {
      const data = await api("/api/state");
      S.config = data.config;
      S.voice = data.voice || S.voice;
      S.tools = data.tools || [];
      S.ollama = data.ollama || {};
      S.models = data.ollama?.models || [];
      updateOllamaPill(S.ollama.online, S.models.length, S.ollama.version);
      $("#platform-pill").innerHTML = `${ICON_SVG("i-keyboard")}<b>${escapeHtml(data.platform.system)} ${escapeHtml(data.platform.release)}</b>`;
      $("#tool-cloud").innerHTML = (data.tools || []).slice(0, 20).map((t) => `<span>${escapeHtml(TOOL_TITLES[t.name] || t.name)}</span>`).join("");
      $("#memory-badge").textContent = data.memory_count || 0;
      renderTimers(data.timers || []);
      $("#setup-card").hidden = !!(S.ollama.online && S.models.length);
      applyConfigToHeader();
    } catch (err) {
      toast("error", "Сервер недоступен", err.message);
    }

    await loadSessions();

    if (!window.speechSynthesis) $("#speak-toggle").style.display = "none";
    else if (typeof speechSynthesis.onvoiceschanged !== "undefined") {
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
      speechSynthesis.getVoices();
    }

    pollSystem();
    S.sysTimer = setInterval(() => { if (S.view === "chat") pollSystem(); }, 5000);
    S.timerTicker = setInterval(tickTimers, 1000);
    setInterval(() => { if (S.view === "chat") loadTimers(); }, 15000);
    setInterval(pollState, 30000);
    connectEvents();
    setTimeout(() => $("#input").focus(), 400);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
