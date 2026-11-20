#!/bin/sh
# goal-loop installer — one line, straight from GitHub:
#
#   curl -fsSL https://raw.githubusercontent.com/paumkim/goal-loop/main/install.sh | sh
#
# It puts the goal-loop CLI in ~/.local/bin (override with GOAL_LOOP_BIN_DIR)
# and then runs `goal-loop install`, which registers the plugin in your
# OpenCode config. Idempotent: running it again is a no-op.
#
# Remove everything with: goal-loop uninstall --self
#
# Escape hatches (for tests and offline use):
#   GOAL_LOOP_SOURCE   file path or URL of the CLI (default: the GitHub raw URL)
#   GOAL_LOOP_REF      git ref to fetch (default: main)
#   GOAL_LOOP_BIN_DIR  where to put the script (default: $HOME/.local/bin)
#   GOAL_LOOP_NO_RUN=1 install the CLI only; do not touch the OpenCode config
set -eu

REPO="paumkim/goal-loop"
REF="${GOAL_LOOP_REF:-main}"
BIN_DIR="${GOAL_LOOP_BIN_DIR:-$HOME/.local/bin}"
SOURCE="${GOAL_LOOP_SOURCE:-https://raw.githubusercontent.com/$REPO/$REF/bin/goal-loop.mjs}"
TARGET="$BIN_DIR/goal-loop"

say() { printf '%s\n' "$*"; }
die() { printf 'goal-loop: %s\n' "$*" >&2; exit 1; }

# The CLI is a single dependency-free file that needs a JS runtime.
RUNTIME=""
if command -v node >/dev/null 2>&1; then
  RUNTIME=node
elif command -v bun >/dev/null 2>&1; then
  RUNTIME=bun
else
  die "need node or bun on PATH to run the goal-loop CLI"
fi

mkdir -p "$BIN_DIR"
TMP="$TARGET.tmp.$$"
trap 'rm -f "$TMP"' EXIT INT TERM

case "$SOURCE" in
  http://*|https://*)
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$SOURCE" -o "$TMP"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$SOURCE" -O "$TMP"
    else
      die "need curl or wget to download $SOURCE"
    fi
    ;;
  *)
    [ -f "$SOURCE" ] || die "no such file: $SOURCE"
    cp "$SOURCE" "$TMP"
    ;;
esac

[ -s "$TMP" ] || die "downloaded an empty file from $SOURCE"
head -n 1 "$TMP" | grep -q '^#!' || die "$SOURCE is not the goal-loop CLI"

# Point the shebang at a runtime that exists on this machine.
if [ "$RUNTIME" = "bun" ]; then
  sed '1s|.*|#!/usr/bin/env bun|' "$TMP" > "$TMP.bun" && mv "$TMP.bun" "$TMP"
fi
chmod 755 "$TMP"
mv "$TMP" "$TARGET"
say "installed the CLI: $TARGET ($RUNTIME)"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "note: $BIN_DIR is not on PATH; add it or run $TARGET directly" ;;
esac

if [ "${GOAL_LOOP_NO_RUN:-0}" = "1" ]; then
  say "next: goal-loop install"
  exit 0
fi

"$TARGET" install "$@"
case " $* " in
  *" --dry-run "*) ;;
  *) say "restart opencode, then use /goal or /goal-loop" ;;
esac