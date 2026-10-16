# Sourced before every git hook command. Hooks started from an IDE or a GUI
# often get a minimal PATH without the login profile, so bun and the repo's
# own binaries would be missing. Only directories that exist are added.

_repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

_prepend_path() {
  [ -n "$1" ] && [ -d "$1" ] || return 0

  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
}

if [ -z "${HOME:-}" ]; then
  HOME=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)
  export HOME
fi

for _dir in \
  /usr/local/bin \
  /opt/homebrew/bin \
  "$HOME/.nodenv/shims" \
  "$HOME/.local/share/mise/shims" \
  "$HOME/.volta/bin" \
  "$HOME/.local/bin" \
  "$HOME/.bun/bin" \
  "$_repo_root/node_modules/.bin"; do
  _prepend_path "$_dir"
done

export PATH
unset _repo_root _dir
