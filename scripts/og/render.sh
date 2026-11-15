#!/usr/bin/env bash
# Renders the share images of the landing page from scripts/og/og-*.html
# with a headless Chrome or Chromium: public/og.png and public/og-pt.png.
set -euo pipefail
cd "$(dirname "$0")"
CHROME=$(command -v chromium || command -v google-chrome-stable || command -v google-chrome)
for lang in en pt; do
  out=../../public/og.png
  [ "$lang" = pt ] && out=../../public/og-pt.png
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --screenshot="$out" "file://$PWD/og-$lang.html" 2>/dev/null
  echo "$out"
done
