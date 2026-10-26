#Requires -Version 5.1
<#
    Сборка Аура.exe локально на Windows.

    Запуск:
      powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
      powershell -ExecutionPolicy Bypass -File .\build-exe.ps1 -OneFile

    Результат:
      dist\Аура\Аура.exe          (обычная сборка, папка)
      dist\Аура.exe               (с -OneFile)
      Aura-Assistant-Windows-x64.zip — готовый архив для передачи другим
#>
param(
    [switch]$OneFile,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    $text" -ForegroundColor Green }

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Step "Создаю окружение"
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { py -3 -m venv .venv } else { python -m venv .venv }
}

$python = ".venv\Scripts\python.exe"

Write-Step "Ставлю зависимости"
& $python -m pip install --upgrade pip --quiet
& $python -m pip install -r requirements.txt
& $python -m pip install pyinstaller

if (-not $SkipTests) {
    Write-Step "Быстрая проверка кода"
    & $python -m compileall -q app run.py
    Write-Ok "Синтаксис в порядке"
}

Write-Step "Готовлю иконку"
& $python -c "from PIL import Image; img = Image.open('web/icon.png').convert('RGBA'); img.resize((256,256), Image.LANCZOS).save('web/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
Write-Ok "web/icon.ico"

Write-Step "Собираю .exe (2–5 минут)"
$env:AURA_ROOT = $root
$env:AURA_ONEFILE = if ($OneFile) { "1" } else { "0" }
& $python -m PyInstaller aura.spec --noconfirm --clean
if ($LASTEXITCODE -ne 0) { throw "PyInstaller завершился с ошибкой" }

Write-Step "Упаковываю архив"
New-Item -ItemType Directory -Force -Path out | Out-Null
Remove-Item out\* -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path "dist\Аура.exe") {
    Copy-Item "dist\Аура.exe" "out\Аура.exe"
    $archive = "Aura-Assistant-Windows-x64-onefile.zip"
} else {
    Copy-Item -Recurse "dist\Аура" "out\Аура"
    New-Item -ItemType Directory -Force -Path "out\Аура\data" | Out-Null
    $readme = @"
АУРА — голосовой ИИ-ассистент
================================

1. Установите Ollama: https://ollama.com/download/windows
2. Скачайте модель (один раз, в PowerShell): ollama pull qwen2.5:7b
3. Запустите Аура.exe

Интерфейс откроется в браузере: http://localhost:8765
Иконка Ауры появится в системном трее.

Настройки, история и память лежат в папке data рядом с Аура.exe.
"@
    Set-Content -Path "out\Аура\ЧИТАЙ-МЕНЯ.txt" -Value $readme -Encoding UTF8
    $archive = "Aura-Assistant-Windows-x64.zip"
}

if (Test-Path $archive) { Remove-Item $archive -Force }
Compress-Archive -Path "out\*" -DestinationPath $archive -CompressionLevel Optimal

$size = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host @"

   ╭──────────────────────────────────────────────╮
   │  Готово!                                     │
   ╰──────────────────────────────────────────────╯
   Архив : $archive ($size МБ)
   Запуск: $root\out\Аура\Аура.exe

"@ -ForegroundColor Green

$run = Read-Host "Запустить собранную Ауру сейчас? (Y/n)"
if ($run -notmatch "^[nNнН]") {
    if (Test-Path "out\Аура\Аура.exe") { Start-Process "out\Аура\Аура.exe" }
    elseif (Test-Path "out\Аура.exe") { Start-Process "out\Аура.exe" }
}
