#!/usr/bin/env bash
# Builds HelloGitty for Chrome into dist/hellogitty (load this folder unpacked in
# chrome://extensions) and zips it as dist/hellogitty-extension-<version>.zip for the Chrome Web
# Store. Running it again gives the same files and a byte-identical zip.
#
#   HELLOGITTY_CLIENT_ID=Ov23li... ./build.sh   # bakes in the OAuth app's public client ID
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="${HELLOGITTY_ROOT:-$here/../hellogitty-clone}"
root="$(cd "$root" 2>/dev/null && pwd)" || { echo "hellogitty-clone not found. Set HELLOGITTY_ROOT to your checkout." >&2; exit 1; }
page="$root/web/index.html"
[[ -f "$page" ]] || { echo "$page not found — is HELLOGITTY_ROOT correct?" >&2; exit 1; }
out="$here/dist/hellogitty"
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$here/manifest.json" | head -1)"

rm -rf "$out"
mkdir -p "$out/icons"

# The classifier: internal/work compiled to WebAssembly with the standard Go toolchain. wasm/main.go
# imports hellogitty's internal packages, which Go only allows from inside that module, so it is
# built from a temporary folder in the checkout and the folder is removed afterwards.
wasmdir="$(mktemp -d "$root/.hellogitty-ext-wasm.XXXXXX")"
trap 'rm -rf "$wasmdir"' EXIT
cp "$here/wasm/main.go" "$wasmdir/"
(cd "$root" && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$out/board.wasm" "./$(basename "$wasmdir")")
goroot="$(go env GOROOT)"
for f in "$goroot/lib/wasm/wasm_exec.js" "$goroot/misc/wasm/wasm_exec.js"; do
  if [[ -f "$f" ]]; then cp "$f" "$out/wasm_exec.js"; break; fi
done
[[ -f "$out/wasm_exec.js" ]] || { echo "wasm_exec.js not found under $goroot" >&2; exit 1; }

# The look and behaviour come from the dashboard itself: its <style> block becomes dashboard.css,
# its two <script> blocks become dashboard-head.js (theme before first paint) and dashboard.js
# (theme switch, change markers, filter and organize). Extension pages can't run inline scripts,
# hence the separate files.
# CSS templates (base-css, header-css, feed-css) are {{define}} blocks included by the <style>
# block via {{template}}. Extract their contents first, then the remaining inline styles.
{
  for tpl in base-css header-css feed-css; do
    awk -v t="$tpl" '
      $0 ~ "\\{\\{define \"" t "\"\\}\\}" {f=1; next}
      f && /\{\{end\}\}/ {f=0; next}
      f && !/\{\{/' "$page"
  done
  awk '/<style>/{f=1;next} /<\/style>/{f=0} f && !/\{\{/' "$page"
} > "$out/dashboard.css"
# theme-head define → dashboard-head.js (the before-paint theme init).
awk '/\{\{define "theme-head"\}\}.*<script>/{f=1;next} f&&/<\/script>/{f=0;next} f' "$page" > "$out/dashboard-head.js"
# theme-js define + all standalone <script> blocks → dashboard.js (theme switch, filters, etc).
{
  awk '/\{\{define "theme-js"\}\}/{f=1;next} f&&/\{\{end\}\}/{f=0;next} f' "$page"
  awk '/^[[:space:]]*<script>[[:space:]]*$/{f=1;next} /<\/script>/{f=0;next} f && !/\{\{/' "$page"
} > "$out/dashboard.js"
check() { grep -q -- "$2" "$out/$1" || { echo "$1: no \"$2\"; web/index.html changed shape" >&2; exit 1; }; }
check dashboard.css "--caution-fill"
check dashboard.css ".wi blockquote"
check dashboard.css ".head-right"
check dashboard.css "visual-theme"
check dashboard-head.js "hellogitty-theme"
check dashboard.js "data-theme-set"
check dashboard.js "hellogitty-seen"
if grep -q "{{" "$out/dashboard.css" "$out/dashboard-head.js" "$out/dashboard.js"; then
  echo "template actions found in the lifted dashboard blocks" >&2; exit 1
fi

cp "$here"/{manifest.json,background.js,config.js,board.html,board.js,extension.css} "$out/"
cp "$here"/icons/*.png "$out/icons/"
# The sign-in card's mascot window uses the dashboard's resting kitten.
mkdir -p "$out/mascot" && cp "$root/web/mascot/rest.png" "$out/mascot/rest.png"

if [[ -n "${HELLOGITTY_CLIENT_ID:-}" ]]; then
  if [[ ! "$HELLOGITTY_CLIENT_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "HELLOGITTY_CLIENT_ID has unexpected characters" >&2; exit 1
  fi
  sed -i '' -e "s/OAUTH_CLIENT_ID: \"\"/OAUTH_CLIENT_ID: \"$HELLOGITTY_CLIENT_ID\"/" "$out/config.js" 2>/dev/null ||
    sed -i -e "s/OAUTH_CLIENT_ID: \"\"/OAUTH_CLIENT_ID: \"$HELLOGITTY_CLIENT_ID\"/" "$out/config.js"
fi

if [[ -n "${HELLOGITTY_EXCHANGE_URL:-}" ]]; then
  if [[ ! "$HELLOGITTY_EXCHANGE_URL" =~ ^https:// ]]; then
    echo "HELLOGITTY_EXCHANGE_URL must start with https://" >&2; exit 1
  fi
  sed -i '' -e "s|OAUTH_EXCHANGE_URL: \"\"|OAUTH_EXCHANGE_URL: \"$HELLOGITTY_EXCHANGE_URL\"|" "$out/config.js" 2>/dev/null ||
    sed -i -e "s|OAUTH_EXCHANGE_URL: \"\"|OAUTH_EXCHANGE_URL: \"$HELLOGITTY_EXCHANGE_URL\"|" "$out/config.js"
fi

# Fixed timestamps and a sorted file list keep the zip byte-identical between builds.
find "$out" -exec touch -h -t 202001010000 {} +
zip="$here/dist/hellogitty-extension-$version.zip"
rm -f "$zip"
(cd "$out" && find . -type f | LC_ALL=C sort | zip -qX "$zip" -@)

wasm=$(wc -c < "$out/board.wasm" | tr -d ' ')
gz=$(gzip -9 -c "$out/board.wasm" | wc -c | tr -d ' ')
echo "board.wasm  $wasm bytes ($gz gzipped)"
echo "unpacked    $out"
echo "zip         $zip ($(wc -c < "$zip" | tr -d ' ') bytes, sha256 $(shasum -a 256 "$zip" | cut -c1-12))"
