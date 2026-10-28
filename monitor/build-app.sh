#!/bin/zsh
# Builds (or rebuilds) the "OSS Monitor" macOS app on the Desktop.
# The app calls this repo's start.sh, so double-clicking always
# builds and runs the latest code.
set -euo pipefail

REPO_DIR="${0:A:h:h}"
START_SH="$REPO_DIR/start.sh"
APP="$HOME/Desktop/OSS Monitor.app"

if [[ ! -x "$START_SH" ]]; then
  echo "Cannot find start.sh at $START_SH" >&2
  exit 1
fi

SCRIPT_TEXT="try
	do shell script quoted form of \"$START_SH\"
on error errMsg
	display dialog \"OSS Monitor could not start:\" & return & return & errMsg buttons {\"OK\"} default button 1 with icon caution
end try"

ICON_SRC="$REPO_DIR/monitor/applet.icns"

rm -rf "$APP"
osacompile -o "$APP" -e "$SCRIPT_TEXT"

if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APP/Contents/Resources/applet.icns"
fi

echo "Built: $APP"
echo "It will run: $START_SH"
