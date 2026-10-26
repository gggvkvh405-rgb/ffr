@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Аура — голосовой ИИ-ассистент

if exist ".venv\Scripts\python.exe" goto run

echo.
echo  Первый запуск: готовлю окружение, это займёт пару минут...
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -m venv .venv
) else (
    python -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo  [ОШИБКА] Python не найден.
    echo  Скачайте его с https://python.org/downloads и при установке
    echo  отметьте галочку "Add python.exe to PATH".
    echo.
    pause
    exit /b 1
)

echo  Устанавливаю зависимости...
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Не удалось установить зависимости. Проверьте интернет.
    echo.
    pause
    exit /b 1
)

:run
".venv\Scripts\python.exe" run.py %*
if errorlevel 1 pause
