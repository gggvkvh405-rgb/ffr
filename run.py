"""Запуск ассистента: python run.py [--host 0.0.0.0] [--port 8765] [--no-browser]"""
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

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        pass

from app.config import CONFIG  # noqa: E402


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
    print(f"\n  Аура уже запущена: http://localhost:{port}\n  Открываю её в браузере.\n")
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Голосовой ИИ-ассистент на Ollama")
    parser.add_argument("--host", default=os.environ.get("AURA_HOST") or CONFIG.get("host", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AURA_PORT") or CONFIG.get("port", 8765)))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--reload", action="store_true", help="Автоперезапуск при изменении кода")
    args = parser.parse_args()

    if already_running(args.host, args.port, not args.no_browser):
        return

    port = args.port
    for _ in range(12):
        if port_free(args.host, port):
            break
        port += 1

    display_host = "localhost" if args.host in {"0.0.0.0", "127.0.0.1"} else args.host
    url = f"http://{display_host}:{port}"

    banner = f"""
  ╭──────────────────────────────────────────────╮
  │   ✦  AURA — голосовой ИИ-ассистент           │
  ╰──────────────────────────────────────────────╯
   Интерфейс : {url}
   Ollama    : {CONFIG.get('ollama_url')}
   Модель    : {CONFIG.get('model')}
   Локальная сеть: http://{local_ip()}:{port}
   Остановить: Ctrl+C
"""
    print(banner)
    if args.host in {"0.0.0.0", "::"}:
        print("   ⚠  Доступ открыт всей локальной сети: любой в ней сможет управлять")
        print("      этим компьютером через Ауру. Включайте только в доверенной сети.\n")

    if not args.no_browser:
        def open_later() -> None:
            time.sleep(1.6)
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001
                pass

        threading.Thread(target=open_later, daemon=True).start()

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=port,
        reload=args.reload,
        log_level="warning",
        access_log=False,
        ws="none",
    )


if __name__ == "__main__":
    main()
