Install an APK the session built and smoke-test it on the phone

1. `await scripts.run("status")`: connected, battery above 15 percent, free storage above 1 GB. Otherwise say what is missing and stop.
2. Know what is there now: `await scripts.run("app", { package: "<package>" })`. Note `versionName`, `versionCode` and `lastUpdate` before the install.
3. Install: `await phone.install("<path to the .apk>", { test: true })`. A debug build needs `test: true`. `downgrade: true` only when the request says to go to an older version. Installing replaces the app and keeps its data. The path is the one the request names; a build that does not exist is reported, not searched for.
4. Check it: `app` again. `versionName` or `versionCode` and `lastUpdate` must have changed; say what they were and are.
5. Start it: `await phone.open("<package>")`, wait for the foreground (`skills.read("open-app")`), then `await scripts.run("screen", { app: "<package>" })`. Report what the first screen shows (title, main buttons) so the caller can tell it started.
6. Look for crashes: `await scripts.run("logs", { package: "<package>" })`. Report `lastCrash` (kind, time, summary, first lines) and the most frequent error lines. A crash older than the install is not from this build: compare its time with `lastUpdate`.
7. Uninstall only when the request says so: `await phone.uninstall("<package>")` removes the app's data too.
8. The answer: before and after versions, whether it started, the first screen, and the crash or error lines with their counts.
