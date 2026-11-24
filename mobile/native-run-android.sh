#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner (mobile/). Installs the debug APK, opens it online and offline,
# and records what the screen shows. Fails if the Inkwell page never appears.
set -u
APP=br.com.inkwell.app
mkdir -p evidence
adb install -r android/app/build/outputs/apk/debug/app-debug.apk | tee evidence/android-install.txt
adb shell dumpsys package $APP | grep -E "versionName|targetSdk|minSdk" | head -5 | tee evidence/android-package.txt
adb shell pm grant $APP android.permission.CAMERA || true

screen_text() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml | grep -o 'text="[^"]*"\|content-desc="[^"]*"' | sed 's/^[a-z-]*="//; s/"$//' | grep -v '^$' | tr '\n' '|'; }
wait_for() {   # $1 regex, $2 seconds
  local t=0; while [ $t -lt "$2" ]; do local s; s=$(screen_text); if echo "$s" | grep -qiE "$1"; then echo "$s"; return 0; fi; sleep 3; t=$((t+3)); done; screen_text; return 1;
}

adb logcat -c
adb shell am start -W -n $APP/.MainActivity | tee evidence/android-start.txt
ONLINE_OK=0
if wait_for "Seu lugar|Testar um deck|Cole..o|Entrar" 90 > evidence/android-online-ui.txt; then ONLINE_OK=1; fi
sleep 3; adb exec-out screencap -p > evidence/android-online.png
adb logcat -d | grep -iE "Capacitor|Loading app" | head -40 > evidence/android-logcat.txt

# no connection. dev (remote site): the app must show its own "Sem conexão" page, not a blank screen.
# release (bundled pages): the app must still open its pages.
OFFLINE_EXPECT="Sem conex"; [ "${INKWELL_TARGET:-dev}" = release ] && OFFLINE_EXPECT="Seu lugar|Testar um deck|Entrar"
adb shell svc wifi disable; adb shell svc data disable; sleep 3
adb shell am force-stop $APP; adb shell am start -W -n $APP/.MainActivity >/dev/null
OFFLINE_OK=0
if wait_for "$OFFLINE_EXPECT" 60 > evidence/android-offline-ui.txt; then OFFLINE_OK=1; fi
adb exec-out screencap -p > evidence/android-offline.png
adb shell svc wifi enable; adb shell svc data enable

echo "target=${INKWELL_TARGET:-dev} online_page=$ONLINE_OK offline_page=$OFFLINE_OK" | tee evidence/android-result.txt
python3 -m pip install --quiet pillow >/dev/null 2>&1 || true
python3 - <<'PY' || true
import base64, io
from PIL import Image
for n in ("android-online", "android-offline"):
    try:
        im = Image.open(f"evidence/{n}.png").convert("RGB"); im.thumbnail((270, 600)); b = io.BytesIO(); im.save(b, "JPEG", quality=60)
        print(f"=== {n} jpeg base64 ==="); print(base64.b64encode(b.getvalue()).decode()); print(f"=== end {n} ===")
    except Exception as e: print(n, e)
PY
echo "--- online UI text ---"; cat evidence/android-online-ui.txt | cut -c1-600
echo "--- offline UI text ---"; cat evidence/android-offline-ui.txt | cut -c1-300
[ $ONLINE_OK = 1 ] && [ $OFFLINE_OK = 1 ]
