#!/bin/bash
# File Database - portable launcher for macOS (no install needed).
# Opens Edge/Chrome in an app window with its data profile kept on this drive,
# so your files live on the USB stick, not on the Mac.
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="file://$HERE/app/index.html"
DATA="$HERE/data"
mkdir -p "$DATA"
ARGS=(--user-data-dir="$DATA" --allow-file-access-from-files --no-first-run --app="$URL")

if [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args "${ARGS[@]}"
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args "${ARGS[@]}"
else
  echo "Microsoft Edge or Google Chrome not found in /Applications."
  echo "Opening the app in your default browser instead (data will not be kept on the USB)."
  open "$HERE/app/index.html"
fi
