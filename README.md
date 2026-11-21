# ask-kit-phone

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about an Android phone reached over adb (USB or wireless), and operate it when asked. A
cheap model runs adb outside your agent's context and answers with package
names, versions, the elements on the screen with their positions, and logcat lines.

Questions from its bench, of the kinds agents handle by hand with adb and scrcpy:

- Is my phone connected to this machine right now, and if it is not, what has to happen to reconnect it?
- Why does wireless debugging keep turning itself off on the phone, and what can be done so the connection lasts?
- Is the Android app I am developing installed on the phone, which version, and what was its last crash?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and `adb` on PATH. `scrcpy` is needed only to show the
phone in a window. USB debugging, or wireless debugging, has to be on, on the phone. The `PHONE_SERIAL` setting names the
device as `adb devices` lists it (a USB serial, or a host:port for a wireless phone); without it the kit uses the first
connected device, a wireless one first.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-phone
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-phone        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-phone --yes  # installs and enables it
```

Restart your agents so `ask` lists `phone`.

## What it carries

| | |
|---|---|
| Scripts | `status` (connected or not and why, how to reconnect, model, Android version, battery, storage, screen on or off, foreground app), `screen` (the screen's elements as rows: centre, flags, text, id, class, bounds; needs an app or a text to look for), `apps` (installed packages with version and install times), `app` (one package: version, running, permissions, last crash), `logs` (an app's recent error lines from logcat, deduplicated, with its last crash or ANR) |
| Skills | `find-and-tap`, `type-text`, `open-app`, `install-and-test`, `reconnect`: playbooks the investigator loads when the job calls for one |
| Roles | `phone-observer` for questions about the phone's state; `phone-operator` for requests to do something on it |

Each script also runs with no model: `ask-kit run phone status`, or `ask(do: "phone.status")` from
an agent. A shot returns at most 4,000 characters, so a long list is cut; the investigator gets the
whole result.

## What it can change

A question never changes anything. `phone.mjs` sorts every call into reading or changing, and a
changing call is refused unless the caller asked for a change (`act`). When asked, it can tap,
swipe, type text, press a key, wake the screen, open an app or a deep link, install an APK,
uninstall a third-party app, take a screenshot to a file, show the phone in a window with scrcpy,
and run adb shell commands outside the read set.

The phone holds private messages, banking, one-time codes and photos, and what the kit reads goes to
a cloud model, so `phone.mjs` checks first:

- The screen's elements are read only when the question names the app or what to look for. The kit
  refuses, and reads nothing, when the foreground app or activity is on the deny list in `lib.mjs`:
  banking and payment apps, password managers, authenticators, SMS and messaging apps, email,
  photos, the dialer and contacts, the lock screen, the notification shade, and system permission
  and credential dialogs. It matches by package prefix and by words in the package or activity name
  (bank, wallet, pay, auth, otp, password, sms, messag, mail, signal, whatsapp, telegram and more).
  A denied app's name is not given in the refusal. A window of a denied app anywhere on the screen
  refuses the whole read, and system UI such as the status bar and heads-up notifications is left out.
- Notification shade and notification dumps are never read. Screenshots are files on disk and the
  kit returns the path; it takes none of a denied app, and it does not OCR a screen.
- One-time codes near the words code, OTP or verification (and a bare number next to such a word),
  email addresses, phone numbers and card-like digit runs are replaced in returned text. A password
  field has no text.
- Tap, swipe, type, key and screenshot check the foreground first, and refuse a denied app, a screen
  that is off and the lock screen. On a denied app only back, home, recents, power and volume keys
  work. Nothing is typed into a password field. The kit never unlocks the phone.
- `phone.shell` runs a fixed set of read commands (`dumpsys` battery, window, power and package,
  `pm list packages`, `getprop` for a fixed list of keys, `df`, `pidof`, `wm size`, `logcat -d` with a
  package filter and a line cap). Other commands need `act`. Refused always: `su`, `input`, screen
  capture and `uiautomator` through the shell, reboot, factory reset and recovery, other apps'
  `/data/data` and the photo folders, content providers for messages, contacts and calls, `dumpsys
  notification` and clipboard, `am broadcast` of system actions, `am start` of calls and messages,
  `pm clear` of a package the request did not name, `rm` outside `/data/local/tmp` and a named app's
  own folder.
- Nothing runs that never ends: logcat only with `-d` and a cap of 3,000 lines, no scrcpy in a
  question, every call has a timeout, and a connect attempt is one try of at most 45 seconds.

## How well it works

`bench/questions.json` holds six questions and one script run. It has not been run on a model yet;
`ask-kit kit test phone` runs it. Its connection questions check shape only, because the phone is
not always connected. The module, the deny list, the masks and every acting call were run with no
model through a stubbed adb and fixture output (`node --test test/`, 23 tests). Against a real phone only
`status` has been run, and no phone was connected then, so it reported that nothing was connected.
