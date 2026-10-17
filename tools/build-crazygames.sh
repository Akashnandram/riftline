#!/bin/sh
# Package Riftline for CrazyGames: dist/riftline-crazygames.zip (upload it on the CrazyGames developer portal).
# The copy of index.html in the zip switches the CrazyGames SDK on (gameplay events, ads between matches).
set -e
cd "$(dirname "$0")/.."
OUT=dist/crazygames
rm -rf "$OUT" dist/riftline-crazygames.zip
mkdir -p "$OUT"
cp -R src assets style.css og-image.jpg "$OUT"/
# flag the build and drop things a portal iframe doesn't use (app manifest, analytics)
sed -e 's#<head>#<head><script>window.RIFTLINE_PORTAL = "crazygames";</script>#' \
    -e '/rel="manifest"/d' -e '/_vercel\/insights/d' index.html > "$OUT/index.html"
(cd "$OUT" && zip -qr ../riftline-crazygames.zip .)
echo "Built dist/riftline-crazygames.zip ($(du -h dist/riftline-crazygames.zip | cut -f1))"
