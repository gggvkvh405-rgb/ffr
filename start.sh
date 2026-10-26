#!/usr/bin/env bash
# Запуск Ауры на Linux / macOS
set -e
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  echo "Первый запуск: создаю окружение..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip --quiet
  .venv/bin/pip install -r requirements.txt
fi

exec .venv/bin/python run.py "$@"
