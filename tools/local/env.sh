# Source this file from Bash or Zsh; it loads private local configuration into this terminal.
if [ -n "${BASH_VERSION:-}" ]; then
  _polylink_source="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  eval '_polylink_source=${(%):-%x}'
else
  printf '%s\n' 'Use Bash or Zsh to source tools/local/env.sh.' >&2
  return 1
fi
_polylink_tools="$(cd -- "$(dirname -- "$_polylink_source")" && pwd)"
_polylink_state="${POLYLINK_LOCAL_DIR:-$HOME/.config/polylink}"
if [ ! -r "$_polylink_state/local.env" ]; then
  printf '%s\n' 'Run bash tools/local/setup.sh first.' >&2
  return 1
fi
. "$_polylink_state/local.env"
JAVA_HOME="$(python3 "$_polylink_tools/setup.py" --java-home)" || return 1
export JAVA_HOME
case ":$PATH:" in *":$JAVA_HOME/bin:"*) ;; *) export PATH="$JAVA_HOME/bin:$PATH" ;; esac
JAVA_TOOL_OPTIONS="$(python3 "$_polylink_tools/setup.py" --java-options)" || return 1
export JAVA_TOOL_OPTIONS
unset _polylink_source _polylink_tools _polylink_state
