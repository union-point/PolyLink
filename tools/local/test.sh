#!/usr/bin/env bash
# Dependency installation and the multi-stage checks; app start commands stay in README.
set -euo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
case "${1:-}" in ''|--full) ;; *) echo 'Usage: bash tools/local/test.sh [--full]' >&2; exit 1 ;; esac
if [ -r "${POLYLINK_LOCAL_DIR:-$HOME/.config/polylink}/local.env" ]; then
  source "$script_dir/env.sh"
else
  JAVA_HOME="$(python3 "$script_dir/setup.py" --java-home)"
  export JAVA_HOME
  export PATH="$JAVA_HOME/bin:$PATH"
fi
command -v node >/dev/null && command -v npm >/dev/null || { echo 'Install Node.js 22+ and npm for the checks.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22+ is required"); process.exit(1); }'
cd "$repo_dir"
python3 -m unittest discover -s tools/local -p 'test_*.py'
npm ci --prefix tools/contracts --ignore-scripts
npm test --prefix tools/contracts
state="${POLYLINK_LOCAL_DIR:-$HOME/.config/polylink}"
mkdir -p "$state"
python3 -m venv "$state/test-venv"
"$state/test-venv/bin/python" -m pip install --disable-pip-version-check -r tools/contracts/requirements.txt
"$state/test-venv/bin/python" tools/contracts/validate.py
if [ "${1:-}" = --full ]; then
  command -v docker >/dev/null || { echo 'Docker is required for --full.' >&2; exit 1; }
  docker info >/dev/null
  export DB_TEST_ADMIN_USERNAME="${DB_TEST_ADMIN_USERNAME:-${MIGRATION_DB_USERNAME:-${DB_USERNAME:-sa}}}"
  export DB_TEST_ADMIN_PASSWORD="${DB_TEST_ADMIN_PASSWORD:-${MIGRATION_DB_PASSWORD:-${DB_PASSWORD:-}}}"
  [ -n "$DB_TEST_ADMIN_PASSWORD" ] || { echo 'Set DB_TEST_ADMIN_PASSWORD for disposable SQL databases.' >&2; exit 1; }
  npm ci --prefix tools/m1 --ignore-scripts
  npx --prefix tools/m1 playwright install chromium
  python3 tools/m1/verify.py --recovery
else
  ./backend/mvnw -f backend/pom.xml verify
fi
