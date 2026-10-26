"""Информация о системе и скриншоты."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import time
from pathlib import Path

try:
    import psutil
except Exception:  # noqa: BLE001
    psutil = None  # type: ignore[assignment]

from ..config import DATA_DIR
from ..safety import PLATFORM
from .base import Tool, fail, integer, obj, ok, text

SCREENSHOT_DIR = DATA_DIR / "screenshots"


def _human(num: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if num < 1024:
            return f"{num:.1f}".rstrip("0").rstrip(".") + " " + unit
        num /= 1024
    return f"{num:.1f} ПБ"


def _uptime_text(seconds: float) -> str:
    seconds = int(seconds)
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    parts = []
    if days:
        parts.append(f"{days} д")
    if hours:
        parts.append(f"{hours} ч")
    parts.append(f"{minutes} мин")
    return " ".join(parts)


def _cpu_name() -> str:
    name = platform.processor()
    if name and name.strip():
        return name.strip()
    try:
        if PLATFORM == "posix":
            if platform.system() == "Darwin":
                out = subprocess.run(
                    ["sysctl", "-n", "machdep.cpu.brand_string"],
                    capture_output=True, timeout=3,
                ).stdout.decode("utf-8", "replace").strip()
                if out:
                    return out
            else:
                with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        if line.lower().startswith("model name"):
                            return line.split(":", 1)[1].strip()
    except Exception:  # noqa: BLE001
        pass
    return platform.machine() or "н/д"


def _system_info() -> dict:
    os_name = f"{platform.system()} {platform.release()}"
    if PLATFORM == "nt":
        os_name = f"Windows {platform.release()} ({platform.version()})"
    lines = [
        f"Система: {os_name}",
        f"Устройство: {platform.node()} / {platform.machine()}",
        f"Процессор: {_cpu_name()}",
    ]
    data: dict = {}
    if psutil:
        lines.append(f"Ядер CPU: {psutil.cpu_count(logical=True)} (физических {psutil.cpu_count(False)})")
        cpu_percent = psutil.cpu_percent(interval=0.35)
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()
        lines.append(f"Загрузка CPU: {cpu_percent:.0f}%")
        lines.append(
            f"Оперативная память: {_human(mem.used)} из {_human(mem.total)} "
            f"({mem.percent:.0f}% занято), свободно {_human(mem.available)}"
        )
        if swap.total:
            lines.append(f"Файл подкачки: {_human(swap.used)} / {_human(swap.total)}")
        data.update(cpu=cpu_percent, ram_percent=mem.percent, ram_used=mem.used, ram_total=mem.total)

        try:
            parts = []
            for part in psutil.disk_partitions(all=False):
                if "cdrom" in part.opts.lower() or part.fstype == "":
                    continue
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                except Exception:  # noqa: BLE001
                    continue
                parts.append(
                    f"  {part.device} ({part.mountpoint}) — {_human(usage.used)} из "
                    f"{_human(usage.total)}, свободно {_human(usage.free)}"
                )
            if parts:
                lines.append("Диски:")
                lines.extend(parts[:6])
        except Exception:  # noqa: BLE001
            pass

        try:
            battery = psutil.sensors_battery()
            if battery:
                state = "заряжается" if battery.power_plugged else "от батареи"
                lines.append(f"Батарея: {battery.percent:.0f}% ({state})")
                data["battery"] = battery.percent
        except Exception:  # noqa: BLE001
            pass

        try:
            lines.append(f"Время работы: {_uptime_text(time.time() - psutil.boot_time())}")
        except Exception:  # noqa: BLE001
            pass

        try:
            procs = sorted(
                psutil.process_iter(["name", "memory_info"]),
                key=lambda p: getattr(p.info.get("memory_info"), "rss", 0) or 0,
                reverse=True,
            )[:5]
            rows = []
            for proc in procs:
                meminfo = proc.info.get("memory_info")
                if meminfo:
                    rows.append(f"  {proc.info['name']} — {_human(meminfo.rss)}")
            if rows:
                lines.append("Самые требовательные процессы:")
                lines.extend(rows)
        except Exception:  # noqa: BLE001
            pass
    return ok("\n".join(lines), **data)


def _screenshot() -> dict:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    target = SCREENSHOT_DIR / f"screen_{time.strftime('%Y%m%d_%H%M%S')}.png"

    if PLATFORM == "nt":
        script = SCREENSHOT_DIR / "_capture.ps1"
        script.write_text(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing\n"
            "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds\n"
            "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height\n"
            "$g=[System.Drawing.Graphics]::FromImage($bmp)\n"
            "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)\n"
            f"$bmp.Save('{target}',[System.Drawing.Imaging.ImageFormat]::Png)\n"
            "$g.Dispose();$bmp.Dispose()\n",
            encoding="utf-8",
        )
        try:
            subprocess.run(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                capture_output=True,
                timeout=25,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        finally:
            try:
                script.unlink()
            except OSError:
                pass
    else:
        captured = False
        try:
            from PIL import ImageGrab  # type: ignore

            img = ImageGrab.grab()
            img.save(target)
            captured = True
        except Exception:  # noqa: BLE001
            captured = False
        if not captured:
            commands = [
                ["gnome-screenshot", "-f", str(target)],
                ["spectacle", "-b", "-n", "-o", str(target)],
                ["scrot", "-z", str(target)],
                ["import", "-window", "root", str(target)],
                ["grim", str(target)],
            ]
            for command in commands:
                if shutil.which(command[0]):
                    try:
                        subprocess.run(command, capture_output=True, timeout=25)
                        captured = target.exists()
                    except Exception:  # noqa: BLE001
                        captured = False
                    if captured:
                        break

    if not target.exists():
        return fail(
            "Не удалось сделать скриншот. На Linux нужен gnome-screenshot/scrot/grim "
            "или пакет Pillow."
        )
    rel = f"/files/screenshots/{target.name}"
    return ok(f"Скриншот сохранён: {target}", path=str(target), url=rel)


TOOL_SYSTEM_INFO = Tool(
    name="system_info",
    description=(
        "Получить сведения о компьютере: ОС, процессор, загрузка CPU, оперативная память, "
        "диски, батарея, время работы, самые тяжёлые процессы."
    ),
    parameters=obj({}),
    handler=_system_info,
    meta={"icon": "cpu"},
)

TOOL_SCREENSHOT = Tool(
    name="screenshot",
    description="Сделать скриншот экрана и вернуть ссылку на изображение.",
    parameters=obj({}),
    handler=_screenshot,
    meta={"icon": "image"},
)
