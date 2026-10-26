# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller-спецификация Ауры.

Сборка (Windows):
    pip install -r requirements.txt pyinstaller
    pyinstaller aura.spec --noconfirm

Результат:
    dist/Аура/Аура.exe           — папка со всем необходимым (рекомендуется)
    AURA_ONEFILE=1 pyinstaller aura.spec --noconfirm
    dist/Аура.exe                — один файл (запускается чуть дольше)
"""
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(os.environ.get("AURA_ROOT") or Path.cwd()).resolve()
if not (ROOT / "run.py").exists():
    ROOT = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
ONEFILE = os.environ.get("AURA_ONEFILE") == "1"
IS_WINDOWS = sys.platform.startswith("win")

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "multipart",
    "python_multipart",
    "anyio._backends._asyncio",
    "app.main",
] + collect_submodules("app")

extra_datas = []
extra_binaries = []

for package in ("edge_tts", "certifi"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
        datas_extra = pkg_datas
        extra_datas += datas_extra
        extra_binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        pass

for optional in ("faster_whisper", "pystray", "PIL", "psutil", "httpx"):
    try:
        __import__(optional)
        hiddenimports.append(optional)
    except Exception:
        pass

if IS_WINDOWS:
    hiddenimports += ["pystray._win32", "PIL.Image", "PIL.ImageDraw", "PIL.ImageWin"]

datas = [
    (str(ROOT / "web"), "web"),
] + extra_datas
icon_png = ROOT / "web" / "icon.png"
icon_ico = ROOT / "web" / "icon.ico"
icon = str(icon_ico) if icon_ico.exists() else None

a = Analysis(
    [str(ROOT / "run.py")],
    pathex=[str(ROOT)],
    binaries=extra_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "tkinter", "unittest", "pydoc", "pytest", "matplotlib", "numpy", "scipy",
        "IPython", "jupyter", "notebook", "pandas", "PySide6", "PyQt5", "PyQt6",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

EXE_NAME = "Аура" if IS_WINDOWS else "aura"

if ONEFILE:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        [],
        name=EXE_NAME,
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=not IS_WINDOWS,
        disable_windowed_traceback=False,
        icon=icon,
        version=None,
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name=EXE_NAME,
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=not IS_WINDOWS,
        disable_windowed_traceback=False,
        icon=icon,
        version=None,
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=False,
        upx_exclude=[],
        name=EXE_NAME,
    )
