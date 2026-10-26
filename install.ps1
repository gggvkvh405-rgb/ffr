#Requires -Version 5.1
<#
    Установка Ауры на Windows.
    Запуск:  powershell -ExecutionPolicy Bypass -File .\install.ps1
    Параметры:
      -SkipModel   не предлагать скачивание модели
      -NoShortcut  не создавать ярлык на рабочем столе
#>
param(
    [switch]$SkipModel,
    [switch]$NoShortcut
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "    $text" -ForegroundColor Red }

Write-Host @"

   ╭────────────────────────────────────────────╮
   │   ✦  AURA — голосовой ИИ-ассистент         │
   │      установка на Windows                  │
   ╰────────────────────────────────────────────╯

"@ -ForegroundColor Magenta

# ---------------------------------------------------------------- Python
Write-Step "Проверяю Python"
$python = $null
foreach ($candidate in @("py -3", "python")) {
    $parts = $candidate.Split(" ")
    $exe = $parts[0]
    if (Get-Command $exe -ErrorAction SilentlyContinue) {
        try {
            $exeArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
            $version = & $exe @exeArgs --version 2>&1
            if ($version -match "3\.(1[0-9]|[89])") {
                $python = $candidate
                Write-Ok "$version ($candidate)"
                break
            }
        } catch { }
    }
}
if (-not $python) {
    Write-Err "Python 3.9+ не найден."
    Write-Warn "Скачайте с https://python.org/downloads и отметьте 'Add python.exe to PATH', затем запустите установку снова."
    Read-Host "Нажмите Enter, чтобы закрыть"
    exit 1
}

# ---------------------------------------------------------------- venv
Write-Step "Создаю виртуальное окружение (.venv)"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    $split = $python.Split(" ")
    $pyArgs = if ($split.Length -gt 1) { $split[1..($split.Length - 1)] } else { @() }
    & $split[0] @pyArgs -m venv .venv
}
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Err "Не удалось создать .venv"
    exit 1
}
Write-Ok "Готово"

# ---------------------------------------------------------------- зависимости
Write-Step "Устанавливаю зависимости (fastapi, uvicorn, psutil, edge-tts...)"
& ".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
& ".venv\Scripts\python.exe" -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Err "pip завершился с ошибкой. Проверьте интернет и повторите."
    exit 1
}
Write-Ok "Зависимости установлены"

# ---------------------------------------------------------------- Ollama
Write-Step "Проверяю Ollama"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    Write-Warn "Ollama не найдена в PATH."
    Write-Warn "Скачайте установщик: https://ollama.com/download/windows"
    Write-Warn "После установки перезапустите это окно и выполните: ollama pull qwen2.5:7b"
} else {
    Write-Ok "Ollama найдена: $($ollama.Source)"
    try {
        $models = & ollama list 2>$null
        if ($models) { Write-Ok "Загруженные модели:"; $models | ForEach-Object { Write-Host "      $_" } }
    } catch { }
    if (-not $SkipModel) {
        $answer = Read-Host "`n    Скачать рекомендуемую модель qwen2.5:7b (~4.7 ГБ)? (y/N)"
        if ($answer -match "^[yYдД]") {
            Write-Step "Скачиваю qwen2.5:7b — это может занять время"
            & ollama pull qwen2.5:7b
            Write-Ok "Модель загружена"
        }
    }
}

# ---------------------------------------------------------------- ярлык
if (-not $NoShortcut) {
    Write-Step "Создаю ярлык на рабочем столе"
    try {
        $desktop = [Environment]::GetFolderPath("Desktop")
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop "Аура.lnk"))
        $shortcut.TargetPath = "cmd.exe"
        $shortcut.Arguments = "/c `"$root\start.bat`""
        $shortcut.WorkingDirectory = $root
        $shortcut.Description = "Голосовой ИИ-ассистент Аура"
        $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
        $shortcut.Save()
        Write-Ok "Ярлык «Аура» создан на рабочем столе"
    } catch {
        Write-Warn "Не удалось создать ярлык: $_"
    }
}

Write-Host @"

   ╭────────────────────────────────────────────╮
   │  Готово! Запускайте: start.bat             │
   │  Интерфейс откроется в браузере:           │
   │  http://localhost:8765                     │
   ╰────────────────────────────────────────────╯

   Подсказки:
    • Микрофон работает в браузере — разрешите доступ к нему.
    • Хотите другой голос? Настройки → Голос.
    • Опасные действия подтверждаются в интерфейсе.

"@ -ForegroundColor Green

$launch = Read-Host "Запустить Ауру сейчас? (Y/n)"
if ($launch -notmatch "^[nNнН]") {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$root\start.bat`""
}
