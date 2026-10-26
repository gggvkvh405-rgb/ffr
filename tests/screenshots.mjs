/**
 * Снимки интерфейса для документации и проверки дизайна.
 * Требует запущенный сервер Ауры и опциональные пакеты:
 *   npm i -D puppeteer-core @sparticuz/chromium
 * Запуск:  node tests/screenshots.mjs  (AURA_URL=http://127.0.0.1:8765)
 */
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.AURA_URL || "http://127.0.0.1:8765";
const OUT = new URL("../docs/", import.meta.url).pathname;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = await chromium.executablePath();
const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--lang=ru-RU"],
  executablePath: exe,
  headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
});
fs.mkdirSync(OUT, { recursive: true });

const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

const view = async (name) => page.evaluate((n) => document.querySelector(`[data-view="${n}"]`).click(), name);
const shot = async (name) => {
  await page.screenshot({ path: OUT + `preview-${name}.png` });
  console.log(`✓ ${name}`);
};

await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector(".quick-card", { timeout: 20000 });
await pause(2200);
await shot("welcome");

// диалог с инструментом
await page.type("#input", "сколько памяти занято и что с диском?");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".messages .msg").length >= 2, { timeout: 30000 });
await pause(2600);
await shot("chat");

// таймер
await page.type("#input", "поставь таймер на 10 минут с подписью сделать перерыв");
await page.keyboard.press("Enter");
await pause(3000);
await shot("timer");

// окно подтверждения опасного действия
await page.type("#input", "выключи компьютер");
await page.keyboard.press("Enter");
await page.waitForSelector("#confirm-modal:not([hidden])", { timeout: 20000 });
await pause(700);
await shot("confirm");
await page.evaluate(() => document.querySelector("#confirm-deny").click());
await pause(1200);

// настройки и память
await view("settings");
await pause(1400);
await shot("settings");
await view("memory");
await pause(1000);
await shot("memory");

// мобильный вид
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await view("chat");
await pause(1200);
await shot("mobile");
await page.evaluate(() => document.querySelector("#menu-btn").click());
await pause(700);
await shot("mobile-menu");

await browser.close();
