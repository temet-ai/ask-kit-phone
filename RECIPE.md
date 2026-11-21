# Recipe: phone kit

## What it answers

The state of an Android phone reached over adb (USB or wireless): connected or not and
how, model, Android version, battery, storage, screen on or off, the foreground app, the elements
on the screen with their positions, installed apps and versions, one app's version, running state,
permissions and last crash, and an app's recent logcat errors. It operates the phone when asked: tap,
swipe, type, keys, open an app or link, install and uninstall an APK, screenshot, scrcpy window.

## What it needs

- Linux and `adb` on PATH. `scrcpy` for showing the phone in a window.
- USB debugging, or wireless debugging with this machine paired once (`adb pair`), on the phone.
- The optional `PHONE_SERIAL` setting: the device as `adb devices` lists it. A host:port value is also the address
  `connect()` tries.
- No keys, no build step.

## What it reads and runs

- Runs `adb` through `phone.mjs` (no shell on this machine, a timeout on every call), and starts `scrcpy` detached
  when asked. `adb shell` arguments are checked one by one: a fixed read set, everything else needs `act`, and
  some commands are refused always. Taps, swipes, text and keys are the kit's own `adb shell input` calls, made after
  the foreground checks.
- Writes nothing itself. Screenshots go to `~/.cache/phone` or to a `.png` path under the working folder or the temp
  folder, at the phone's full resolution.
- Refuses a changing call unless the ask may act; refuses apps and screens on the deny list in
  `lib.mjs`; masks codes, emails, phone numbers and card-like numbers.

## Rebuild it from an empty folder

Write `ask-kit.toml` with one `module` source named `phone`, `requires` `adb`,
`platforms = ["linux"]`, the `PHONE_SERIAL` setting and `acts` written as prose. `lib.mjs` holds the deny list (package
prefixes, words, and short tokens that match only the start of a name's parts), the masks, a regex
parser for `uiautomator dump` XML, parsers for `dumpsys battery`, `power`, `window` and `package`,
and for `logcat -v threadtime` with deduplication and crash grouping. `phone.mjs` exports
`make({settings, push, act, cwd})` returning a client with `status`, `foreground`, `screen`, `apps`, `app`,
`logs`, `shell` (with `shellClass` deciding read, act or refused), and the acting calls. Its `exec`
is injectable so everything is tested through `test/stub.mjs` and the fixtures in `test/fixtures`.

Scripts: `status`, `screen`, `apps`, `app`, `logs`. Skills in `skills/`: find-and-tap, type-text,
open-app, install-and-test, reconnect. Roles: phone-observer, phone-operator. Describe the module
exactly in `api.d.ts`.

Facts the module relies on, not yet checked against a connected phone: `dumpsys window` prints
`mCurrentFocus=Window{... u0 package/activity}`; `dumpsys power` prints `mWakefulness=`; `dumpsys
package <name>` has a `Package [name] (hash):` section with `versionName`, `firstInstallTime`,
`lastUpdateTime` and `flags=[ DEBUGGABLE ... ]`; `logcat --uid=N` works on the phone's Android
version; `uiautomator dump /dev/tty` prints the hierarchy XML. Checked against adb itself: `adb devices`, with no device connected.

## Bench

`bench/questions.json`: six questions of the kinds agents handle by hand, with
shape-only expectations, and one script run (`status`). No content from the phone is kept.
