#!/usr/bin/env bash
# Boots the "fx" AVD (windowed), trusts the TLS-intercepting proxy CA (if any) in the emulator's
# system store, and installs the debug APK. Usage: ./dev-emulator.sh
set -euo pipefail

export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export PATH="$ANDROID_HOME/platform-tools:$PATH"
APK="$(cd "$(dirname "$0")" && pwd)/app/build/outputs/apk/debug/app-debug.apk"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if ! adb devices | grep -q 'emulator-.*device$'; then
  nohup "$ANDROID_HOME/emulator/emulator" -avd fx -no-audio -no-snapshot-save > /tmp/emu.log 2>&1 &
fi
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 3; done

# Behind a TLS-intercepting proxy the emulator rejects the site cert; trust the served root/intermediates.
echo | openssl s_client -connect www.fantrax.com:443 -servername www.fantrax.com -showcerts 2>/dev/null |
  python3 -c "
import re,sys
for i,c in enumerate(re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',sys.stdin.read(),re.S)):
    open('$TMP/c%d.pem'%i,'w').write(c+'\n')"
adb root >/dev/null; sleep 3; adb wait-for-device
adb shell 'mkdir -p /data/local/tmp/cac && rm -f /data/local/tmp/cac/*'
for f in "$TMP"/c*.pem; do
  # Skip leaf certs (index 0); Android names CA files with the legacy subject hash.
  [ "$(basename "$f")" = c0.pem ] && continue
  h=$(openssl x509 -in "$f" -noout -subject_hash_old)
  adb push "$f" "/data/local/tmp/cac/$h.0" >/dev/null
done
adb shell '
cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cac/ 2>/dev/null
mount -t tmpfs tmpfs /system/etc/security/cacerts
cp /data/local/tmp/cac/* /system/etc/security/cacerts/
chown root:root /system/etc/security/cacerts/*; chmod 644 /system/etc/security/cacerts/*
chcon u:object_r:system_file:s0 /system/etc/security/cacerts/*
mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts
for pid in $(pidof zygote zygote64); do nsenter --mount=/proc/$pid/ns/mnt -- /bin/mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts; done'

adb install -r "$APK"
adb shell am force-stop app.fantrax.redesign
adb shell am start -n app.fantrax.redesign/.MainActivity
echo "Emulator ready."
