# Fantrax Mobile Redesign

A cleaner mobile UI for [Fantrax](https://www.fantrax.com) (NBA), delivered as an Android app and as a userscript. Unofficial and not affiliated with Fantrax.

## Install

**Android app** (Android 8.0+)
1. Download `fantrax-redesign.apk` from the [latest release](../../releases/latest) and open it.
2. Allow "Install unknown apps" for the app you opened it from.
3. Open **Fantrax** and log in with email and password (Google sign-in may be blocked inside a WebView).

The app updates itself:
- The redesign (CSS/JS) is fetched from the latest release on every launch and applied on the next launch.
- When a new app version is released, the app asks you to install it.

**Userscript** (Safari on iOS with the Userscripts or Tampermonkey extension, or Firefox on Android with Violentmonkey/Tampermonkey)

Open [fantrax-redesign.user.js](../../releases/latest/download/fantrax-redesign.user.js) in your userscript manager. It updates from the same URL.

## Develop

```
npm install
node launch.mjs            # headed, iPhone-emulated browser with a persistent login profile
node apply.mjs             # inject styles/ and scripts/ into the running page
node build.mjs             # bundle dist/fantrax-redesign.user.js
```

Android app: `android/` (plain WebView, no framework). Build with `cd android && ./gradlew assembleDebug`; `android/dev-emulator.sh` boots an emulator and installs it.

## Release

1. Push a tag: `git tag v1.2.0 && git push origin v1.2.0`.
2. GitHub Actions builds the userscript and a signed APK and attaches both to the release.

Required repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Keep a backup of the keystore: an APK signed with a different key cannot update an installed one.
