"""Запуск ассистента.

Из исходников:   python run.py [--host 0.0.0.0] [--port 8765] [--no-browser] [--reload]
Из собранного .exe (Windows): двойной клик — сервер поднимется, откроется браузер,
а в системном трее появится иконка Ауры с меню «Открыть / Папка данных / Выход».
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
BASE_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
if not FROZEN:
    sys.path.insert(0, str(BASE_DIR))

from app.config import CONFIG, DATA_DIR  # noqa: E402

# В windowed-сборке консоли нет: направляем вывод в data/aura.log, чтобы было где смотреть ошибки
_LOG_HANDLE = None
if FROZEN:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _LOG_HANDLE = open(DATA_DIR / "aura.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        if _LOG_HANDLE.tell() > 1_000_000:
            _LOG_HANDLE.truncate(0)
    except Exception:  # noqa: BLE001
        _LOG_HANDLE = None

if sys.stdout is None or sys.stderr is None:  # окно без консоли
    _fallback = _LOG_HANDLE or open(os.devnull, "w", encoding="utf-8")
    sys.stdout = sys.stdout or _fallback
    sys.stderr = sys.stderr or _fallback

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        pass


def log(message: str) -> None:
    try:
        print(message, flush=True)
    except Exception:  # noqa: BLE001
        pass


def local_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:  # noqa: BLE001
        return "127.0.0.1"


def already_running(host: str, port: int, browser: bool = True) -> bool:
    """Если Аура уже запущена на этом порту — открываем её и выходим."""
    url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=1.2) as response:
            data = json.loads(response.read().decode("utf-8"))
        if not data.get("ok"):
            return False
    except Exception:  # noqa: BLE001
        return False
    log(f"\n  Аура уже запущена: http://localhost:{port}\n  Открываю её в браузере.\n")
    if browser:
        try:
            webbrowser.open(f"http://localhost:{port}")
        except Exception:  # noqa: BLE001
            pass
    return True


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host if host != "0.0.0.0" else "", port))
            return True
        except OSError:
            return False


def pick_port(host: str, desired: int) -> int:
    port = desired
    for _ in range(12):
        if port_free(host, port):
            return port
        port += 1
    return desired


def open_data_folder() -> None:
    try:
        if os.name == "nt":
            os.startfile(str(DATA_DIR))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            import subprocess

            subprocess.Popen(["open", str(DATA_DIR)])
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(DATA_DIR)])
    except Exception as exc:  # noqa: BLE001
        log(f"  Не удалось открыть папку данных: {exc}")


# ---------------------------------------------------------------- системный трей
def _tray_image():
    """Иконка для трея: берём web/icon.png из сборки, иначе рисуем круг."""
    from PIL import Image, ImageDraw

    from app.config import WEB_DIR

    for name in ("icon.png", "icon.ico"):
        candidate = WEB_DIR / name
        if candidate.exists():
            try:
                return Image.open(candidate).convert("RGBA").resize((64, 64))
            except Exception:  # noqa: BLE001
                break
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((4, 4, 60, 60), fill=(124, 82, 246, 255))
    draw.ellipse((20, 20, 44, 44), fill=(255, 255, 255, 235))
    return image


def run_tray(url: str, host: str, port: int) -> bool:
    """Показывает иконку в трее. Возвращает False, если трей недоступен."""
    try:
        import pystray
        from pystray import Menu, MenuItem
    except Exception as exc:  # noqa: BLE001
        log(f"  Трей недоступен ({exc}) — работаю в фоне.")
        return False

    def on_open(icon=None, item=None):
        webbrowser.open(url)

    def on_folder(icon=None, item=None):
        open_data_folder()

    def on_quit(icon=None, item=None):
        try:
            icon.stop()
        finally:
            os._exit(0)

    menu = Menu(
        MenuItem("Открыть Ауру", on_open, default=True),
        MenuItem(f"Адрес: {url}", None, enabled=False),
        Menu.SEPARATOR,
        MenuItem("Папка данных", on_folder),
        Menu.SEPARATOR,
        MenuItem("Выход", on_quit),
    )
    icon = pystray.Icon("aura", _tray_image(), f"Аура — {url}", menu)
    threading.Thread(target=icon.run, daemon=True).start()
    return True


def run_server(host: str, port: int, reload: bool = False) -> None:
    import uvicorn

    if FROZEN:
        from app.main import app

        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        )
        uvicorn.Server(config).run()
        return

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="warning",
        access_log=False,
        ws="none",
    )


def wait_ready(host: str, port: int, timeout: float = 25.0) -> bool:
    target = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://{target}:{port}/api/health", timeout=1.0) as response:
                if json.loads(response.read().decode("utf-8")).get("ok"):
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.3)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Голосовой ИИ-ассистент Аура")
    parser.add_argument("--host", default=os.environ.get("AURA_HOST") or CONFIG.get("host", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AURA_PORT") or CONFIG.get("port", 8765)))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-tray", action="store_true", help="Не показывать иконку в трее")
    parser.add_argument("--reload", action="store_true", help="Автоперезапуск при изменении кода")
    args = parser.parse_args()

    if already_running(args.host, args.port, not args.no_browser):
        return

    port = pick_port(args.host, args.port)
    display_host = "localhost" if args.host in {"0.0.0.0", "127.0.0.1"} else args.host
    url = f"http://{display_host}:{port}"

    log(
        f"""
  ╭──────────────────────────────────────────────╮
  │   ✦  АУРА — голосовой ИИ-ассистент           │
  ╰──────────────────────────────────────────────╯
   Интерфейс : {url}
   Ollama    : {CONFIG.get('ollama_url')}
   Модель    : {CONFIG.get('model')}
   Данные    : {DATA_DIR}
   Локальная сеть: http://{local_ip()}:{port}
   Остановить: Ctrl+C{" (или меню трея → Выход)" if FROZEN else ""}
"""
    )
    if args.host in {"0.0.0.0", "::"}:
        log("   ⚠  Доступ открыт всей локальной сети: любой в ней сможет управлять")
        log("      этим компьютером через Ауру. Включайте только в доверенной сети.\n")

    use_tray = FROZEN and not args.no_tray and "--no-tray" not in sys.argv
    if use_tray:
        # сервер — в отдельном потоке, трей — в главном
        server_thread = threading.Thread(
            target=run_server, args=(args.host, port, args.reload), daemon=True
        )
        server_thread.start()
        if wait_ready(args.host, port):
            if not args.no_browser:
                try:
                    webbrowser.open(url)
                except Exception:  # noqa: BLE001
                    pass
            if not run_tray(url, args.host, port):
                log("  Работаю в фоне. Чтобы остановить — закройте этот процесс.")
        else:
            log("  Сервер не поднялся за 25 секунд. Смотрите журнал выше.")
        try:
            while server_thread.is_alive():
                server_thread.join(timeout=1.0)
        except KeyboardInterrupt:
            log("\n  Останавливаюсь…")
        return

    if not args.no_browser:
        def open_later() -> None:
            time.sleep(1.6)
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001
                pass

        threading.Thread(target=open_later, daemon=True).start()

    run_server(args.host, port, args.reload)


def _fatal(message: str) -> None:
    log(f"\n  ОШИБКА: {message}\n")
    if FROZEN and os.name == "nt":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(  # type: ignore[attr-defined]
                None,
                f"Аура не смогла запуститься.\n\n{message}\n\n"
                f"Подробности: {DATA_DIR / 'aura.log'}",
                "Аура — ошибка запуска",
                0x10,
            )
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # noqa: BLE001
        import traceback

        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            (DATA_DIR / "aura.log").write_text(
                traceback.format_exc(), encoding="utf-8"
            )
        except Exception:  # noqa: BLE001
            pass
        _fatal(f"{type(exc).__name__}: {exc}")
        raise SystemExit(1)
