"""Оценка риска команд и защита файловой системы."""
from __future__ import annotations

import os
import re
from pathlib import Path

PLATFORM = os.name  # 'nt' | 'posix'

# Катастрофические команды — не выполняем никогда, даже с подтверждением.
BLOCKED_PATTERNS = [
    r"rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?[a-z]*\s+/(\s|$)",
    r"rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+/\s",
    r"rm\s+-rf\s+/(\s|$)",
    r"rm\s+-rf\s+/\*",
    r"rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?[a-z]*\s+~/?\s*$",
    r"rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?[a-z]*\s+~/?\*",
    r"mkfs(\.\w+)?\s",
    r"dd\s+[^|;]*of=/dev/(sd|nvme|hd|disk)",
    r"dd\s+[^|;]*of=\\\\\.\\physicaldrive",
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
    r"\bformat(\.com)?\s+[a-z]:",
    r"\bdiskpart\b",
    r"\bbcdedit\b",
    r"\bvssadmin\s+delete\b",
    r"\bcipher\s+/w\b",
    r"\bdel\s+((/[a-z]+)\s+)*[a-z]:\\\*",
    r"\brd\s+((/[a-z]+)\s+)*[a-z]:\\\s*$",
    r"\brmdir\s+((/[a-z]+)\s+)*[a-z]:\\",
    r"\bremove-item\b[^|;]*-recurse[^|;]*-force[^|;]*[a-z]:\\(\s|$|\*)",
    r"\bremove-item\b[^|;]*-force[^|;]*-recurse[^|;]*[a-z]:\\(\s|$|\*)",
    r"\breg\s+delete\s+hklm",
    r"\bwipefs\b",
    r"\bshred\s+/dev/",
    r"chmod\s+-R\s+777\s+/(\s|$)",
    r"\bcacls\s+[a-z]:\\\s*/",
    r">\s*/dev/(sd|nvme|disk)",
]

# Команды/операторы, которые меняют систему — требуют подтверждения.
WRITE_PATTERNS = [
    r"\brm\b", r"\bdel\b", r"\berase\b", r"\brmdir\b", r"\brd\b",
    r"\bmv\b", r"\bmove\b", r"\bcp\b", r"\bcopy\b", r"\bxcopy\b", r"\brobocopy\b",
    r"\bmkdir\b", r"\bmd\b", r"\btouch\b", r"\bnew-item\b", r"\bwrite\b",
    r"\bchmod\b", r"\bchown\b", r"\bicacls\b", r"\btakeown\b", r"\battrib\b",
    r"\bkill\b", r"\btaskkill\b", r"\bstop-process\b", r"\bpkill\b",
    r"\breg\s+(add|delete|import)\b", r"\bsc\s+(config|create|delete|stop|start)\b",
    r"\bnet\s+(start|stop|user|localgroup)\b", r"\bschtasks\b",
    r"\bshutdown\b", r"\breboot\b", r"\brestart-computer\b", r"\bpoweroff\b",
    r"\bsystemctl\s+(start|stop|restart|disable|enable|mask)\b",
    r"\bnpm\s+(install|i|uninstall|publish)\b", r"\bpip\s+(install|uninstall)\b",
    r"\bapt(-get)?\s+(install|remove|purge|upgrade)\b",
    r"\bwinget\s+(install|uninstall|upgrade)\b", r"\bchoco\s+(install|uninstall)\b",
    r"\bgit\s+(push|reset|clean|checkout|merge|rebase)\b",
    r"\bcurl\b.*\|\s*(ba)?sh", r"\biwr\b.*\|\s*iex", r"\bwget\b.*\|\s*(ba)?sh",
    r"\bset-executionpolicy\b", r"\bnew-service\b", r"\bstart-process\b",
    r"\bpython\b.*\b(install|setup)\b",
    r">>", r"(?<![0-9])>(?!>)\s*[^&\s]",
]

# Явно безопасные (read-only) команды — можно выполнять без подтверждения.
READONLY_PREFIXES = {
    "dir", "ls", "ll", "la", "pwd", "cd", "whoami", "hostname", "date", "time", "ver",
    "echo", "type", "cat", "head", "tail", "more", "less", "wc", "find", "where", "which",
    "ipconfig", "ifconfig", "ip", "ping", "tracert", "traceroute", "nslookup", "getmac",
    "systeminfo", "tasklist", "ps", "top", "htop", "df", "du", "free", "uname", "uptime",
    "vol", "set", "printenv", "env", "git", "python", "python3", "py", "node", "npm",
    "pip", "pip3", "powershell", "pwsh", "cmd", "wmic", "nvidia-smi", "docker", "code",
    "curl", "wget", "tree", "stat", "file", "md5sum", "sha256sum", "get-childitem",
    "get-process", "get-service", "get-content", "get-date", "get-computerinfo",
    "get-ciminstance", "get-wmiobject", "measure-object", "select-object",
}

SENSITIVE_WRITE_ROOTS = [
    r"c:\windows",
    r"c:\program files",
    r"c:\program files (x86)",
    r"c:\programdata",
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/lib",
    "/sys",
    "/proc",
    "/var/lib",
    "/system",
    "/library",
]


def _matches(patterns: list[str], text: str) -> bool:
    lowered = text.lower()
    return any(re.search(p, lowered) for p in patterns)


def classify_command(command: str) -> tuple[str, str]:
    """Возвращает (risk, reason). risk: safe | confirm | blocked."""
    cmd = (command or "").strip()
    if not cmd:
        return "blocked", "Пустая команда"

    if _matches(BLOCKED_PATTERNS, cmd):
        return "blocked", "Команда может безвозвратно повредить систему"

    # составные команды разбираем по сегментам
    segments = [s.strip() for s in re.split(r"&&|\|\||;|\n|\|", cmd) if s.strip()]
    for segment in segments:
        first = segment.split()[0].lower().lstrip("@").strip("\"'")
        if first in {"sudo", "doas", "runas"}:
            return "confirm", "Команда запрошена с повышением прав"
        if first.endswith(".exe") and Path(first).name.startswith("format"):
            return "blocked", "Команда форматирования диска"

    if _matches(WRITE_PATTERNS, cmd):
        return "confirm", "Команда изменяет файлы или состояние системы"

    first_word = cmd.split()[0].lower().lstrip("@").strip("\"'")
    first_word = first_word.rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    if first_word in READONLY_PREFIXES:
        if first_word in {"git"} and _matches([r"\bgit\s+(push|reset|clean|checkout|merge|rebase|commit|add)\b"], cmd):
            return "confirm", "Команда изменяет состояние репозитория"
        if first_word in {"python", "python3", "py", "node"}:
            if re.search(r"\s(--version|-V|-h|--help)\s*$", cmd) or re.match(r"^(python3?|py|node)\s*$", cmd):
                return "safe", "Проверка версии или интерактивный запуск"
            return "confirm", "Запуск кода через интерпретатор"
        if first_word in {"pip", "pip3"}:
            if re.match(r"^pip3?\s+(list|show|freeze|check|--version|-V|help)\b", cmd):
                return "safe", "Просмотр установленных пакетов"
            return "confirm", "Изменение пакетов Python"
        if first_word == "npm":
            if re.match(r"^npm\s+(-v|--version|ls|list|view|info|help|outdated)\b", cmd):
                return "safe", "Просмотр информации npm"
            return "confirm", "Запуск скриптов или установка пакетов npm"
        if first_word in {"powershell", "pwsh", "cmd", "set-executionpolicy"}:
            return "confirm", "Запуск командной оболочки"
        if first_word == "wmic":
            if re.search(r"\b(get|list|query)\b", cmd):
                return "safe", "Запрос информации через WMI"
            return "confirm", "WMI может запускать программы"
        if first_word in {"set", "docker", "code"}:
            return "confirm", "Команда может изменить настройки"
        return "safe", "Команда только читает информацию"

    return "confirm", "Незнакомая команда — нужно подтверждение"


def guard_path(raw_path: str, *, write: bool) -> tuple[bool, str, Path | None]:
    """Проверяет путь перед чтением/записью. Возвращает (ok, error, resolved)."""
    if not raw_path or not str(raw_path).strip():
        return False, "Путь не указан", None
    expanded = os.path.expandvars(os.path.expanduser(str(raw_path).strip().strip('"')))
    try:
        path = Path(expanded).expanduser().resolve()
    except Exception as exc:  # noqa: BLE001
        return False, f"Некорректный путь: {exc}", None

    if not write:
        return True, "", path

    normalized = str(path).lower().replace("/", "\\") if PLATFORM == "nt" else str(path).lower()
    for root in SENSITIVE_WRITE_ROOTS:
        test_root = root.lower().replace("/", "\\") if PLATFORM == "nt" else root.lower()
        if normalized == test_root or normalized.startswith(test_root + ("\\" if PLATFORM == "nt" else "/")):
            return False, f"Запись в системную папку запрещена: {path}", None

    home = Path.home().resolve()
    try:
        path.relative_to(home)
    except ValueError:
        tmp = Path(os.environ.get("TEMP", "/tmp")).resolve()
        try:
            path.relative_to(tmp)
        except ValueError:
            return False, f"Запись разрешена только в домашней папке ({home}) и временной папке", None
    return True, "", path


def describe_risk(risk: str) -> str:
    return {"safe": "безопасно", "confirm": "нужно подтверждение", "blocked": "запрещено"}.get(risk, risk)
