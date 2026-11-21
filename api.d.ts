interface PhoneElement {
  text: string; desc: string; id: string; cls: string; pkg: string; // text and desc have codes, emails, phone numbers and card numbers masked; a password field has none
  clickable: boolean; editable: boolean; password: boolean; focused: boolean; checked: boolean; scrollable: boolean;
  bounds: [number, number, number, number]; x: number; y: number; // device pixels; x, y is the centre, what phone.tap takes
}
interface PhoneForeground {
  screenOn: boolean | null; wakefulness: string | null;
  denied: string | null; // why the foreground app or screen is on the deny list; then package and activity are null (the name is not given)
  package: string | null; activity: string | null; window?: string;
}
interface PhoneCrash { kind: "java" | "native" | "anr"; time: string; summary: string; lines: string[] }
interface CmdResult { code: number; out: string; err: string; timedOut?: boolean }

declare const phone: {
  act: boolean; // true when this ask may change things

  // ---- reading: allowed in every ask ----

  // adb's device list: [{serial, state}] where state is device, offline or unauthorized. Does not connect.
  devices(): Promise<{ serial: string; state: string }[]>;
  // One wireless connect attempt (adb connect to PHONE_SERIAL when it is host:port, else to the address the phone announces on the network), 45 seconds at most. Returns the serial, or throws with the reason and the reconnect instructions.
  // Every other call that needs the phone does this itself when no device is listed.
  connect(): Promise<string>;
  // The same data as the `status` script: connected or not and why, model, Android version, battery, storage, screen on or off, foreground app. connect: true tries one wireless connect.
  status(o?: { connect?: boolean }): Promise<any>;
  // The foreground app and whether the screen is on. When the foreground is on the deny list the package is null and `denied` says why. Reads dumpsys window and power only.
  foreground(): Promise<PhoneForeground>;
  // Why a package or activity name is on the deny list (banking, payment, password managers, authenticators, SMS and messaging, email, photos, dialer and contacts, lock screen,
  // notification shade, system credential and permission dialogs), or null. phone.check("com.example.app") is null.
  check(name: string): string | null;

  // The elements on the screen now. Needs o.app (a package or a word in it) or o.find (regex on text, description or id), else it throws: the screen is never read without a target.
  // Throws, and reads nothing, when the foreground app or screen is on the deny list, when a denied app has a window on the screen, when the screen is off, or when the lock screen shows.
  // If o.app does not match the foreground package it returns {mismatch: true, package, wanted, note} and reads nothing. System UI (status bar, heads-up notifications) is left out.
  // Codes near the words code, OTP or verification, emails, phone numbers and card numbers are masked in text and description; password fields have no text. max defaults to 80.
  // `rows` are the same elements as compact strings: 'x,y FLAGS "text" #id Class [x1,y1,x2,y2]' with C clickable, E text field, P password, K checked, S scrollable, F focused.
  screen(o: { app?: string; find?: string; max?: number }): Promise<{
    package: string; activity: string | null; count: number; total: number; shown: number; cut?: number; droppedSystemUi?: number; passwordFields: number; masked?: string;
    elements: PhoneElement[]; rows: string[];
  } | { mismatch: true; package: string; activity: string | null; wanted: string; count: 0; elements: []; rows: []; note: string }>;

  // Installed packages (third-party unless o.all) with versionCode, filtered by part of a package name; for 15 or fewer also versionName, firstInstall, lastUpdate and debuggable.
  apps(o?: { filter?: string; all?: boolean; max?: number }): Promise<{ total: number; shown: number; cut?: number; detailed: boolean; note?: string; apps: { package: string; versionCode: number; versionName?: string | null; firstInstall?: string | null; lastUpdate?: string | null; debuggable?: boolean }[] }>;
  // One package: installed, version, first install and last update, debuggable build, running, foreground, permission counts, last crash. {installed: false} when it is not there.
  // The crash comes from logcat only for a debuggable build or with o.crash true, never for a deny-listed package (then crash is a string saying why it was not read).
  app(pkg: string, o?: { crash?: boolean }): Promise<any>;
  // Recent error lines of one app: logcat -d, its uid, a line cap, deduplicated with counts, masked, plus the last crash or ANR. level "E" (default) or "W". Refuses deny-listed packages.
  logs(pkg: string, o?: { level?: "E" | "W"; max?: number; lines?: number }): Promise<{ package: string; uid: string | null; level: string; scanned: number; matched: number; cut?: number; lastCrash: PhoneCrash | null; lines: { time: string; last: string; level: string; tag: string; text: string; count: number }[] }>;

  // adb shell with an argument array, no host shell: phone.shell(["dumpsys", "battery"]). The fixed read commands run in every ask: dumpsys battery, window, power, package <name>;
  // pm list packages with -3 -s -d -e --show-versioncode and a filter; getprop of ro.product.model, manufacturer, device, ro.build.version.release, sdk, security_patch, ro.build.display.id, ro.product.cpu.abi;
  // df, df /data; pidof <package>; wm size; logcat only with -d, -t N (1 to 3000), --uid= or --pid= or a tag filter ending in *:S, -b main, system, crash or events.
  // Anything else needs act. Refused always: su, input (use tap, type, key), screencap, uiautomator, reboot and power commands, factory reset and recovery, sqlite3, locksettings, raw binder calls,
  // dumpsys notification, clipboard and account, cmd notification and statusbar, content providers other than settings (messages, contacts, calls, calendar, media), other apps' /data/data and the photo folders,
  // rm outside /data/local/tmp or a named app's own folder, pm clear of a package not in o.named, am broadcast of a system action or without a target package, am start of a call or message, pm install and uninstall,
  // svc wifi and data, settings that control adb or the lock. Arguments with spaces, quotes or shell symbols are refused: run one plain command at a time. o.named: packages the request named.
  shell(args: string[], o?: { named?: string[]; timeoutMs?: number }): Promise<CmdResult>;
  // "read", "act" or "refused: why" for an adb shell argument array, without running it.
  shellClass(args: string[], o?: { named?: string[] }): string;

  // ---- acting: each throws "not in this ask" unless act is true ----
  // tap, swipe, type, key and screenshot first check the foreground: the screen must be on, the app known and not on the deny list. They return the foreground afterwards ({now}), so
  // the next step can check that the screen changed (read it again with screen). Coordinates are device pixels, the x and y of a screen row.

  tap(x: number, y: number): Promise<{ tapped: [number, number]; was: string | null; now: any }>;
  swipe(x1: number, y1: number, x2: number, y2: number, ms?: number): Promise<{ swiped: number[]; was: string | null; now: any }>; // scroll down by swiping up
  // Types into the focused field: tap the field first. Printable ASCII, 1 to 500 characters. Refused when the focused field is a password field (or a password field is on screen and the focus is unclear).
  type(text: string): Promise<{ typed: number; into: string; now: any }>;
  // back, home, recents, enter, delete, tab, power, volup, voldown, or a keycode number. On a deny-listed app only back, home, recents, power and the volume keys.
  key(name: string): Promise<{ pressed: string; now: any }>;
  // Wakes the screen (keycode 224). Unlocking is never attempted: the PIN and fingerprint are the person's.
  wake(): Promise<PhoneForeground>;
  // An app by package name or a word in it (a word must match exactly one installed package), or a deep link scheme://path (tel, sms, mailto, content, file and intent are refused). Opening an app does not read it.
  open(target: string): Promise<{ opened: string; now: any } | { opened: "link"; scheme: string; now: any }>;
  // adb install -r of a .apk path (relative to the working folder); o.test adds -t for a test build, o.downgrade -d. Never grants all permissions.
  install(apk: string, o?: { test?: boolean; downgrade?: boolean }): Promise<{ installed: boolean; apk: string; size: number; output: string }>;
  // adb uninstall of a third-party package; its data goes with it unless o.keepData. Refuses system packages and deny-listed packages.
  uninstall(pkg: string, o?: { keepData?: boolean }): Promise<{ uninstalled: string; keepData: boolean }>;
  // A screenshot saved to a PNG file at the phone's full resolution: returns the path. The kit does not read the file. Refused on a deny-listed app or lock screen.
  // o.file must be a .png under the working folder, the temp folder or ~/.cache/phone; by default it is named under ~/.cache/phone.
  screenshot(o?: { file?: string }): Promise<{ file: string; app: string }>;
  // The phone in a window titled Phone on the desktop (scrcpy, detached); does nothing when a scrcpy window is already open. Never run in a question.
  scrcpy(): Promise<{ started: boolean; window: string; note: string }>;
};
