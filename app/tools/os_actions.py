"""Действия в операционной системе: программы, звук, питание, буфер обмена."""
from __future__ import annotations

import base64
import os
import shutil
import subprocess
import tempfile
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

from ..config import DATA_DIR
from ..safety import PLATFORM
from .base import Tool, fail, ok, text

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

APP_ALIASES_WINDOWS = {
    "калькулятор": "calc.exe",
    "calc": "calc.exe",
    "calculator": "calc.exe",
    "блокнот": "notepad.exe",
    "notepad": "notepad.exe",
    "проводник": "explorer.exe",
    "explorer": "explorer.exe",
    "проводник": "explorer.exe",
    "cmd": "cmd.exe",
    "командная строка": "cmd.exe",
    "powershell": "powershell.exe",
    "терминал": "wt.exe",
    "terminal": "wt.exe",
    "paint": "mspaint.exe",
    "paint": "mspaint.exe",
    "snippingtool": "snippingtool.exe",
    "диспетчер задач": "taskmgr.exe",
    "taskmgr": "taskmgr.exe",
    "параметры": "ms-settings:",
    "settings": "ms-settings:",
    "vs code": "code",
    "vscode": "code",
    "code": "code",
    "chrome": "chrome",
    "google chrome": "chrome",
    "edge": "msedge",
    "браузер": "msedge",
    "firefox": "firefox",
    "telegram": "telegram",
    "телеграм": "telegram",
    "spotify": "spotify",
    "discord": "discord",
    "steam": "steam",
    "word": "winword",
    "excel": "excel",
    "wordpad": "write.exe",
    "почта": "outlook",
}

APP_ALIASES_POSIX = {
    "калькулятор": ["gnome-calculator", "kcalc", "galculator"],
    "calc": ["gnome-calculator", "kcalc", "galculator"],
    "блокнот": ["gedit", "kate", "mousepad", "xed"],
    "notepad": ["gedit", "kate", "mousepad", "xed"],
    "проводник": ["nautilus", "dolphin", "thunar", "nemo"],
    "explorer": ["nautilus", "dolphin", "thunar", "nemo"],
    "терминал": ["gnome-terminal", "konsole", "xterm"],
    "terminal": ["gnome-terminal", "konsole", "xterm"],
    "браузер": ["xdg-open", "firefox", "google-chrome", "chromium"],
    "chrome": ["google-chrome", "chromium", "chromium-browser"],
    "code": ["code"],
    "vs code": ["code"],
    "vscode": ["code"],
    "telegram": ["telegram-desktop", "telegram"],
    "spotify": ["spotify"],
}


def _b64(value: str) -> str:
    """Кодируем текст в base64 — так кавычки и юникод не ломают PowerShell-скрипт."""
    return base64.b64encode((value or "").encode("utf-8")).decode("ascii")


def _from_b64(var: str, value: str) -> str:
    return f"${var}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{_b64(value)}'))"


def _ps(script: str, timeout: int = 20) -> tuple[bool, str]:
    """Выполнить PowerShell-скрипт через временный файл (без проблем с кавычками)."""
    if PLATFORM != "nt":
        return False, "PowerShell доступен только на Windows"
    path = Path(tempfile.gettempdir()) / f"aura_{int(time.time() * 1000)}.ps1"
    try:
        path.write_text(script, encoding="utf-8-sig")
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(path)],
            capture_output=True,
            timeout=timeout,
            creationflags=NO_WINDOW,
        )
        out = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
        err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        return proc.returncode == 0, out or err
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    finally:
        try:
            path.unlink()
        except OSError:
            pass


def _open_path(path: str) -> dict:
    target = (path or "").strip()
    if not target:
        return fail("Путь не указан")

    parsed = urlparse(target)
    if parsed.scheme in {"http", "https"}:
        webbrowser.open(target)
        return ok(f"Открываю в браузере: {target}")
    if parsed.scheme and parsed.scheme not in {"file", "ms-settings"}:
        try:
            if PLATFORM == "nt":
                os.startfile(target)  # type: ignore[attr-defined]
                return ok(f"Открываю: {target}")
            return fail(f"Неизвестная ссылка: {target}")
        except Exception as exc:  # noqa: BLE001
            return fail(f"Не удалось открыть: {exc}")

    expanded = Path(os.path.expandvars(os.path.expanduser(target)))
    if not expanded.exists() and not target.startswith(("ms-", "shell:")):
        return fail(f"Путь не найден: {expanded}")
    try:
        if PLATFORM == "nt":
            os.startfile(str(expanded))  # type: ignore[attr-defined]
        elif PLATFORM == "posix" and shutil.which("open"):
            subprocess.Popen(["open", str(expanded)])
        else:
            subprocess.Popen(["xdg-open", str(expanded)])
        return ok(f"Открываю: {expanded}")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось открыть: {exc}")


def _open_app(app: str) -> dict:
    name = (app or "").strip()
    if not name:
        return fail("Название программы не указано")
    lowered = name.lower()

    if PLATFORM == "nt":
        alias = APP_ALIASES_WINDOWS.get(lowered, name)
        if alias.startswith("ms-"):
            try:
                os.startfile(alias)  # type: ignore[attr-defined]
                return ok(f"Открываю {name}")
            except Exception as exc:  # noqa: BLE001
                return fail(f"Не удалось открыть {name}: {exc}")
        try:
            os.startfile(alias)  # type: ignore[attr-defined]
            return ok(f"Запускаю {name}")
        except Exception:
            pass
        try:
            subprocess.Popen(["cmd.exe", "/c", "start", "", alias], creationflags=NO_WINDOW)
            return ok(f"Запускаю {name}")
        except Exception as exc:  # noqa: BLE001
            return fail(f"Не удалось запустить {name}: {exc}")

    candidates = APP_ALIASES_POSIX.get(lowered, [name])
    for candidate in candidates:
        exe = shutil.which(candidate)
        if exe:
            try:
                subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return ok(f"Запускаю {name}")
            except Exception:  # noqa: BLE001
                continue
    return fail(f"Программа «{name}» не найдена на этом компьютере")


def _media_control(action: str) -> dict:
    action = (action or "").lower()
    keys = {
        "volume_up": 175,
        "volume_down": 174,
        "mute": 173,
        "play_pause": 179,
        "next": 176,
        "prev": 177,
        "stop": 178,
    }
    names = {
        "volume_up": "громкость выше",
        "volume_down": "громкость ниже",
        "mute": "звук выключен/включён",
        "play_pause": "пауза/воспроизведение",
        "next": "следующий трек",
        "prev": "предыдущий трек",
        "stop": "стоп",
    }
    if action not in keys:
        return fail("Неизвестное действие. Доступно: " + ", ".join(keys))

    if PLATFORM == "nt":
        # повторяем нажатие для заметного изменения громкости
        repeat = 5 if action in {"volume_up", "volume_down"} else 1
        script = (
            "$w = New-Object -ComObject WScript.Shell\n"
            f"for ($i=0; $i -lt {repeat}; $i++) {{ $w.SendKeys([char]{keys[action]}); Start-Sleep -Milliseconds 40 }}\n"
        )
        success, out = _ps(script)
        return ok(names[action]) if success else fail(f"Не удалось: {out}")

    if action in {"play_pause", "next", "prev", "stop"} and shutil.which("playerctl"):
        mapping = {"play_pause": "play-pause", "next": "next", "prev": "previous", "stop": "stop"}
        subprocess.run(["playerctl", mapping[action]], capture_output=True)
        return ok(names[action])
    if shutil.which("pactl"):
        step = "5%" if action == "volume_up" else "-5%"
        if action in {"volume_up", "volume_down"}:
            subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", step], capture_output=True)
            return ok(names[action])
        if action == "mute":
            subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], capture_output=True)
            return ok(names[action])
    return fail("Не нашёл способ управлять мультимедиа на этой системе (нужен pactl/playerctl)")


def _power_action(action: str) -> dict:
    action = (action or "").lower()
    if action not in {"lock", "sleep", "restart", "shutdown", "logout", "screen_off"}:
        return fail("Неизвестное действие питания")
    if PLATFORM == "nt":
        if action == "lock":
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"], creationflags=NO_WINDOW)
            return ok("Блокирую компьютер")
        if action == "sleep":
            _ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)")
            return ok("Отправляю компьютер в сон")
        if action == "screen_off":
            script = r"""Add-Type -Name Win -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);'
[Native.Win]::SendMessage(0xffff, 0x0112, 0xF170, 2) | Out-Null
"""
            _ps(script)
            return ok("Выключаю экран")
        if action == "shutdown":
            _ps("shutdown.exe /s /t 15 /c \"Выключение по команде Ауры\"")
            return ok("Выключаю компьютер через 15 секунд (отменить: shutdown /a)")
        if action == "restart":
            _ps("shutdown.exe /r /t 15 /c \"Перезагрузка по команде Ауры\"")
            return ok("Перезагружаю компьютер через 15 секунд (отменить: shutdown /a)")
        if action == "logout":
            _ps("shutdown /l")
            return ok("Завершаю сеанс пользователя")
    else:
        if action == "lock" and shutil.which("loginctl"):
            subprocess.run(["loginctl", "lock-session"], capture_output=True)
            return ok("Блокирую экран")
        if action == "sleep" and shutil.which("systemctl"):
            subprocess.run(["systemctl", "suspend"], capture_output=True)
            return ok("Отправляю компьютер в сон")
        if action == "shutdown" and shutil.which("systemctl"):
            subprocess.run(["systemctl", "poweroff"], capture_output=True)
            return ok("Выключаю компьютер")
        if action == "restart" and shutil.which("systemctl"):
            subprocess.run(["systemctl", "reboot"], capture_output=True)
            return ok("Перезагружаю компьютер")
        if action == "lock":
            for cmd in (["loginctl", "lock-session"], ["xdg-screensaver", "lock"]):
                if shutil.which(cmd[0]):
                    subprocess.run(cmd, capture_output=True)
                    return ok("Блокирую экран")
    return fail("Это действие не поддерживается на данной системе")


def _clipboard_get() -> dict:
    try:
        if PLATFORM == "nt":
            success, out = _ps("Get-Clipboard -Raw")
            return ok(out or "(буфер обмена пуст)") if success else fail(out)
        if PLATFORM == "posix" and shutil.which("pbcopy"):
            out = subprocess.run(["pbpaste"], capture_output=True, timeout=5).stdout.decode("utf-8", "replace")
            return ok(out or "(буфер обмена пуст)")
        for cmd in (["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]):
            if shutil.which(cmd[0]):
                out = subprocess.run(cmd, capture_output=True, timeout=5).stdout.decode("utf-8", "replace")
                return ok(out or "(буфер обмена пуст)")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось прочитать буфер обмена: {exc}")
    return fail("Нет утилиты для работы с буфером обмена (xclip/xsel/wl-clipboard)")


def _clipboard_set(text_value: str) -> dict:
    try:
        if PLATFORM == "nt":
            script = _from_b64("t", text_value or "") + "\nSet-Clipboard -Value $t\n"
            success, out = _ps(script)
            return ok("Скопировал в буфер обмена") if success else fail(out)
        if PLATFORM == "posix" and shutil.which("pbcopy"):
            subprocess.run(["pbcopy"], input=(text_value or "").encode("utf-8"), timeout=5)
            return ok("Скопировал в буфер обмена")
        for cmd in (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]):
            if shutil.which(cmd[0]):
                subprocess.run(cmd, input=(text_value or "").encode("utf-8"), timeout=5)
                return ok("Скопировал в буфер обмена")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Не удалось записать в буфер обмена: {exc}")
    return fail("Нет утилиты для работы с буфером обмена")


def _notify(title: str, message: str) -> dict:
    title = title or "Аура"
    message = message or ""
    if PLATFORM == "nt":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing\n"
            "$n = New-Object System.Windows.Forms.NotifyIcon\n"
            "$n.Icon = [System.Drawing.SystemIcons]::Information\n"
            "$n.Visible = $true\n"
            + _from_b64("t", title) + "\n"
            + _from_b64("m", message) + "\n"
            + "$n.ShowBalloonTip(6000, $t, $m, [System.Windows.Forms.ToolTipIcon]::Info)\n"
            "Start-Sleep -Seconds 6\n"
            "$n.Dispose()\n"
        )
        path = Path(tempfile.gettempdir()) / f"aura_notify_{int(time.time())}.ps1"
        path.write_text(script, encoding="utf-8-sig")
        try:
            subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(path)],
                creationflags=NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return ok(f"Уведомление показано: {title} — {message}")
        except Exception as exc:  # noqa: BLE001
            return fail(f"Не удалось показать уведомление: {exc}")
    if PLATFORM == "posix":
        if shutil.which("notify-send"):
            subprocess.run(["notify-send", title, message], capture_output=True)
            return ok(f"Уведомление показано: {title} — {message}")
        if shutil.which("osascript"):
            safe_message = message.replace('"', "'")
            safe_title = title.replace('"', "'")
            subprocess.run(
                ["osascript", "-e", f'display notification "{safe_message}" with title "{safe_title}"'],
                capture_output=True,
            )
            return ok(f"Уведомление показано: {title} — {message}")
    return fail("Нет утилиты для системных уведомлений")


TOOL_OPEN_PATH = Tool(
    name="open_path",
    description="Открыть файл, папку или ссылку в браузере средствами системы.",
    parameters={
        "type": "object",
        "properties": {
            "path": text("Путь к файлу/папке или URL (https://…)"),
        },
        "required": ["path"],
    },
    handler=_open_path,
    meta={"icon": "external"},
)

TOOL_OPEN_APP = Tool(
    name="open_app",
    description=(
        "Запустить программу по названию: калькулятор, блокнот, браузер, telegram, "
        "spotify, code и т.п."
    ),
    parameters={
        "type": "object",
        "properties": {"app": text("Название программы")},
        "required": ["app"],
    },
    handler=_open_app,
    meta={"icon": "app"},
)

TOOL_MEDIA_CONTROL = Tool(
    name="media_control",
    description="Управлять звуком и медиа: громкость, mute, play/pause, следующий/предыдущий трек.",
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["volume_up", "volume_down", "mute", "play_pause", "next", "prev", "stop"],
                "description": "Что сделать",
            }
        },
        "required": ["action"],
    },
    handler=_media_control,
    meta={"icon": "volume"},
)

TOOL_POWER_ACTION = Tool(
    name="power_action",
    description=(
        "Управление питанием компьютера: lock (заблокировать), sleep (сон), "
        "screen_off (выключить экран), shutdown (выключить ПК), restart (перезагрузить), "
        "logout (выйти из системы). ВСЕГДА требует подтверждения пользователя."
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["lock", "sleep", "restart", "shutdown", "logout", "screen_off"],
            }
        },
        "required": ["action"],
    },
    handler=_power_action,
    risk="confirm",
    meta={"icon": "power"},
)

TOOL_CLIPBOARD = Tool(
    name="clipboard",
    description="Прочитать или изменить буфер обмена.",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["get", "set"], "description": "get или set"},
            "text": text("Текст для записи (только для action=set)"),
        },
        "required": ["action"],
    },
    handler=lambda action, text=None: _clipboard_get() if action == "get" else _clipboard_set(text or ""),
    meta={"icon": "clipboard"},
)

TOOL_NOTIFY = Tool(
    name="notify",
    description="Показать системное уведомление на рабочем столе.",
    parameters={
        "type": "object",
        "properties": {
            "title": text("Заголовок"),
            "message": text("Текст уведомления"),
        },
        "required": ["message"],
    },
    handler=_notify,
    meta={"icon": "bell"},
)
