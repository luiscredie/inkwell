#!/usr/bin/env bash
# macOS runner (mobile/): installs the simulator build, opens it and records what happens. Fails if the app does not
# start or the screen never leaves the splash colour.
set -u
APP=br.com.inkwell.app
mkdir -p evidence
DEV=$(xcrun simctl list devices available -j | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(x['udid'] for k,v in sorted(d.items(), reverse=True) if 'iOS' in k for x in v if x['name'].startswith('iPhone')))")
xcrun simctl list devices available | grep "$DEV" | tee evidence/ios-device.txt
xcrun simctl boot "$DEV"; xcrun simctl bootstatus "$DEV" -b >/dev/null
xcrun simctl install "$DEV" build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch "$DEV" $APP | tee evidence/ios-launch.txt
sleep 35
xcrun simctl io "$DEV" screenshot evidence/ios-online.png
xcrun simctl spawn "$DEV" log show --last 3m --style compact --predicate 'process == "App"' 2>/dev/null | grep -iE "Loading app|Capacitor|WebView|inkwell" | head -40 > evidence/ios-log.txt
python3 -m pip install --quiet --break-system-packages pillow >/dev/null 2>&1 || python3 -m pip install --quiet pillow >/dev/null 2>&1 || true
python3 - <<'PY'
import base64, io, sys
from PIL import Image
im = Image.open("evidence/ios-online.png").convert("RGB")
px = list(im.resize((90, 195)).getdata()); n = len(px)
splash = sum(1 for r, g, b in px if abs(r - 11) < 12 and abs(g - 25) < 12 and abs(b - 44) < 12) / n
light = sum(1 for r, g, b in px if r > 225 and g > 225 and b > 225) / n
colours = len(set((r // 16, g // 16, b // 16) for r, g, b in px))
ok = splash < 0.6 and colours > 25
open("evidence/ios-result.txt", "w").write(f"splash_share={splash:.2f} light_share={light:.2f} colour_buckets={colours} page_shown={int(ok)}\n")
print(open("evidence/ios-result.txt").read())
t = im.copy(); t.thumbnail((270, 600)); b = io.BytesIO(); t.save(b, "JPEG", quality=60)
print("=== ios-online jpeg base64 ==="); print(base64.b64encode(b.getvalue()).decode()); print("=== end ios-online ===")
sys.exit(0 if ok else 1)
PY
R=$?
echo "--- app log ---"; cat evidence/ios-log.txt
exit $R
