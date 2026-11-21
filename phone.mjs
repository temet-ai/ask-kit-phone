// A client for an Android phone reached over adb (USB or wireless): its state, its screen as a list of
// elements, and, when the caller asked for a change, operating it. The device is the PHONE_SERIAL setting,
// or the first connected one.
//
// Three checks. A call that changes the phone (tap, swipe, type, key, open, install, uninstall,
// screenshot, scrcpy, wake, any adb shell command outside the fixed read set) needs `act`. What is read
// from the screen goes to a cloud model, so a foreground app or screen on the deny list (lib.mjs) is never
// read, captured, tapped, swiped or typed into, text is masked, and nothing is typed into a password field.
// And nothing that never ends runs: logcat only with -d and a line cap, no scrcpy in a question, a timeout
// on every call, a bounded number of connect attempts.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODE_CONTEXT, dedupe, deniedWhy, isBareCode, lastCrash, levelAtLeast, mask, parseBattery, parseHierarchy, parseLogcat, parsePackages, parseWakefulness, parseWindow, rowOf, rx } from "./lib.mjs";

const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};
const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const WORD = /^[A-Za-z0-9._-]+$/;
const PROPS = new Set(["ro.product.model", "ro.product.manufacturer", "ro.product.device", "ro.build.version.release", "ro.build.version.sdk", "ro.build.version.security_patch", "ro.build.display.id", "ro.product.cpu.abi"]);
const RESTORE = "plug the phone in with USB debugging on and accept the prompt on the phone, or turn on Settings > Developer options > Wireless debugging and run `adb connect <address:port>` with the address shown there (the kit's connect() tries the phone's network announcement once). Wireless debugging switches off when the phone restarts or changes Wi-Fi. PHONE_SERIAL chooses the device when several are listed.";
const KEYCODES = { back: 4, home: 3, recents: 187, apps: 284, enter: 66, delete: 67, backspace: 67, tab: 61, power: 26, volup: 24, voldown: 25 };

// ---- adb shell: what reads, what changes, what is never run ----------------------------------------------------
const SAFE_ARG = /^[A-Za-z0-9_.:/=@%+,\-*#]+$/;
const SAFE_KEYS = new Set(["back", "home", "recents", "apps", "volup", "voldown", "power", "224", "26", "3", "4", "187", "24", "25"]);
const KEY_NAMES = new Set(["back", "home", "recents", "apps", "enter", "delete", "backspace", "tab", "power", "volup", "voldown"]);
const NEVER_CMD = new Map([
  ["su", "root shells are never run"], ["sh", "a nested shell would bypass the checks"], ["bash", "a nested shell would bypass the checks"], ["eval", "a nested shell would bypass the checks"],
  ["magisk", "root tools are never run"], ["input", "taps, text and keys go through phone.tap, phone.type and phone.key, which check the screen first"],
  ["monkey", "use phone.open"], ["screencap", "use phone.screenshot"], ["screenrecord", "screen recordings are never made"], ["uiautomator", "use phone.screen, which checks the app first"],
  ["locksettings", "lock settings are never changed"], ["service", "raw binder calls are never made"], ["reboot", "restarting the phone drops wireless debugging; the person does that themselves"],
  ["poweroff", "powering off is the person's to do"], ["shutdown", "powering off is the person's to do"], ["recovery", "recovery and wipes are never run"], ["wipe", "wiping is never run"],
  ["sqlite3", "reading app databases is never done"], ["nc", "network tools are never run"], ["netcat", "network tools are never run"],
]);
const PRIVATE_DUMPSYS = /^(notification|clipboard|account|telecom|telephony\.registry|isms|iphonesubinfo|sip|contacts|content|usagestats|credential|biometric|fingerprint|face|trust|lock_settings)$/;
const SENSITIVE_PERM = /SMS|CONTACTS|CALL_LOG|PHONE_STATE|PHONE_NUMBERS|ACCESSIBILITY|BIND_|WRITE_SECURE|READ_LOGS|MANAGE_EXTERNAL|CAMERA|RECORD_AUDIO/;

// logcat reads only with -d, a line cap, and a package (--uid, --pid) or a tag filter ending in *:S.
function logcatRead(a) {
  let d = false;
  let cap = false;
  let scoped = false;
  for (let i = 1; i < a.length; i++) {
    const x = a[i];
    if (x === "-d") d = true;
    else if (x === "-t" && /^\d+$/.test(a[i + 1] ?? "") && Number(a[i + 1]) >= 1 && Number(a[i + 1]) <= 3000) {
      cap = true;
      i++;
    } else if (x === "-v" && /^(threadtime|brief|time)$/.test(a[i + 1] ?? "")) i++;
    else if (x === "-b" && /^(main|system|crash|events)(,(main|system|crash|events))*$/.test(a[i + 1] ?? "")) i++;
    else if (/^--(uid|pid)=\d+$/.test(x)) scoped = true;
    else if (/^(\*|[\w.\-]+):[VDIWEFS]$/.test(x)) {
      if (x === "*:S") scoped = true;
    } else return false;
  }
  return d && cap && scoped;
}

/** "read", "act" or "refused: why" for an adb shell argument list, without running it. `named` are the packages the request named. */
export function shellClass(args, { named = [] } = {}) {
  const a = args.map(String);
  const [cmd = "", sub = "", sub2 = ""] = a;
  if (!cmd) return "refused: no command";
  // the fixed read set: every argument is checked, so nothing can be chained onto them
  if (cmd === "dumpsys" && ["battery", "window", "power"].includes(sub) && a.length === 2) return "read";
  if (cmd === "dumpsys" && sub === "package" && /^[A-Za-z0-9._]+$/.test(sub2) && a.length === 3) return "read";
  if (cmd === "pm" && sub === "list" && sub2 === "packages" && a.slice(3).every((x) => /^(-3|-s|-d|-e|--show-versioncode|[A-Za-z0-9._]+)$/.test(x))) return "read";
  if (cmd === "getprop") return a.length === 2 && PROPS.has(sub) ? "read" : "refused: getprop only for the fixed list of keys (model, manufacturer, device, Android release, sdk, security patch, build id, cpu abi)";
  if (cmd === "df" && a.length <= 2 && (!sub || /^\/(data|sdcard|storage\/emulated)$/.test(sub))) return "read";
  if (cmd === "pidof" && a.length === 2 && /^[A-Za-z0-9._]+$/.test(sub)) return "read";
  if (cmd === "wm" && a.length === 2 && ["size", "density"].includes(sub)) return "read";
  if (cmd === "logcat") return logcatRead(a) ? "read" : "refused: logcat only runs with -d, -t N (1 to 3000), a package filter (--uid=, --pid=) or a tag filter ending in *:S, and buffers main, system, crash or events; no -c, -f, -G or follow";
  // everything else changes things (needs act), or is refused for every ask
  if (a.some((x) => !SAFE_ARG.test(x))) return "refused: an argument has a space, quote or shell symbol (; & | $ ` < > ( ) ? ' \"); pass plain arguments and run commands one at a time";
  const line = a.join(" ");
  if (NEVER_CMD.has(cmd)) return `refused: ${cmd}: ${NEVER_CMD.get(cmd)}`;
  if (a.includes("su") || /(factory[_ -]?reset|masterclear|wipe[_-]data)/i.test(line)) return "refused: root and factory reset are never run";
  const privatePath = /(^|[ /])(data\/(data|user|user_de|system|system_ce|misc|misc_ce|media)|(sdcard|storage\/emulated\/0)\/(DCIM|Pictures))(\/|$| )/.test(` ${line}`);
  if (privatePath && !(cmd === "run-as" && named.includes(sub))) return "refused: other apps' private data and the photo folders are never read";
  if (cmd === "run-as" && !named.includes(sub)) return "refused: run-as only for a package the request named";
  if (cmd === "dumpsys" && PRIVATE_DUMPSYS.test(sub)) return `refused: dumpsys ${sub} holds private content`;
  if (cmd === "cmd" && /^(notification|clipboard|statusbar|telecom|phone|sms|contacts)$/.test(sub)) return `refused: cmd ${sub} reads or opens private content (the notification shade is never read)`;
  if (cmd === "content" && (/sms|mms|contacts|call_log|calllog|telephony|icc|calendar|media|downloads/i.test(line) || !line.includes("content://settings/"))) return "refused: content providers other than settings are not run (messages, contacts, calls, calendar and media are never read)";
  if (cmd === "settings" && /^(put|delete)$/.test(sub) && /adb|lock|setup|provision|install/i.test(line)) return "refused: that setting controls adb, the lock screen or setup";
  if (cmd === "svc" && /^(wifi|data|power|usb|nfc)$/.test(sub)) return `refused: svc ${sub} would drop the wireless connection or change radios`;
  if (cmd === "am" && sub === "broadcast") {
    const targeted = a.includes("-p") || a.includes("-n") || a.includes("--package");
    const action = a[a.indexOf("-a") + 1] ?? "";
    if (!targeted || !action || /^(android|com\.android|com\.google\.android|com\.samsung)\./.test(action)) return "refused: am broadcast only for an app's own action sent to a named package (-a action -p package)";
  }
  if (cmd === "am" && /^(start|start-activity|startservice|start-service)$/.test(sub) && /(CALL|DIAL|SENDTO|SEND_MULTIPLE|\.SEND\b|tel:|sms:|smsto:|mms:|mmsto:|mailto:)/.test(line)) return "refused: it would place a call or start a message";
  if (cmd === "pm") {
    if (sub === "clear") return named.includes(sub2) && PKG.test(sub2) ? "act" : "refused: pm clear only for a package the request named";
    if (["uninstall", "install", "install-create", "install-write", "install-commit"].includes(sub)) return "refused: use phone.install and phone.uninstall, which check the file and the package";
    if (["grant", "revoke"].includes(sub) && SENSITIVE_PERM.test(line)) return "refused: that permission gives access to messages, contacts, calls, the microphone, the camera or accessibility";
  }
  if (cmd === "rm") {
    const paths = a.slice(1).filter((x) => !x.startsWith("-"));
    const okPath = (p) => !p.includes("..") && (/^\/data\/local\/tmp\/.+/.test(p) || named.some((n) => p.startsWith(`/sdcard/Android/data/${n}/`) || p.startsWith(`/storage/emulated/0/Android/data/${n}/`)));
    if (!paths.length || !paths.every(okPath)) return "refused: rm only inside /data/local/tmp or the named app's own folder under /sdcard/Android/data";
  }
  return "act";
}

/** Real command runner: no shell, a timeout, stdin closed. */
export function realExec(cmd, args, { timeoutMs = 15_000, input, outFile } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 << 20, encoding: outFile ? "buffer" : "utf8" }, (err, stdout, stderr) => {
      if (err?.code === "ENOENT") return resolve({ code: 127, out: "", err: `${cmd} is not installed` });
      let out = outFile ? "" : String(stdout);
      if (outFile && !err) {
        try {
          fs.writeFileSync(outFile, stdout);
        } catch (e) {
          return resolve({ code: 1, out: "", err: `could not write ${outFile}: ${e.message}` });
        }
      }
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out, err: String(stderr).slice(0, 4000), ...(err?.killed ? { timedOut: true } : {}) });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

/** Start a program detached, with no output, and return at once. */
export function realLaunch(cmd, args) {
  try {
    const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
    c.on("error", () => {});
    c.unref();
    return true;
  } catch {
    return false;
  }
}

export function make({ settings, push, act, cwd }) {
  return makePhone({ push, act: !!act, cwd, serial: settings?.PHONE_SERIAL || process.env.PHONE_SERIAL || undefined });
}

export function makePhone({ exec = realExec, launch = realLaunch, push = () => {}, act = false, cwd = process.cwd(), serial: wanted, sleep = sleepReal } = {}) {
  const cacheDir = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "phone");
  let known = null;

  const ran = async (cmd, args, o = {}) => {
    const started = Date.now();
    const r = await exec(cmd, args, o);
    push({ kind: cmd, detail: `${cmd} ${args.join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
    return r;
  };
  const needAct = (what) => {
    if (!act) notInThisAsk(what);
  };

  // ---- connection ---------------------------------------------------------------------------------------------
  /** Devices adb lists: [{serial, state}]. */
  async function devices() {
    const r = await ran("adb", ["devices"], { timeoutMs: 10_000 });
    if (r.code !== 0) throw new Error(`adb devices failed: ${(r.err || r.out).trim().slice(0, 200)}`);
    return r.out.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[0]).map(([serial, st]) => ({ serial, state: st }));
  }
  const pick = (ds) => {
    const ok = ds.filter((d) => d.state === "device");
    if (wanted) return ok.find((d) => d.serial === wanted)?.serial ?? null;
    return (ok.find((d) => /^[0-9.]+:\d+$/.test(d.serial)) ?? ok[0])?.serial ?? null;
  };
  /**
   * One wireless attempt, 45 seconds at most: adb connect to PHONE_SERIAL when it is a host:port, otherwise to the address the phone announces on the network.
   * Returns the serial or throws with the reason and the reconnect advice.
   */
  async function connect() {
    let addr = wanted && /^[^\s:]+:\d+$/.test(wanted) ? wanted : null;
    let note = "";
    if (!addr) {
      const m = await ran("adb", ["mdns", "services"], { timeoutMs: 10_000 });
      addr = m.out.split("\n").map((l) => l.trim().split(/\s+/)).find((p) => p.some((x) => x.startsWith("_adb-tls-connect")))?.find((x) => /^[0-9.]+:\d+$/.test(x)) ?? null;
      if (!addr) note = "no phone announces wireless debugging on the network";
    }
    let r = { code: 1, out: "", err: "" };
    if (addr) r = await ran("adb", ["connect", addr], { timeoutMs: 45_000 });
    const s = pick(await devices());
    if (s) return (known = s);
    throw new Error(`the phone is not connected: ${note || (r.err || r.out).trim().slice(0, 200) || "no device listed"}. To reconnect: ${RESTORE}`);
  }
  async function serial() {
    const s = pick(await devices());
    if (s) return (known = s);
    return connect();
  }
  const adb = async (args, o = {}) => ran("adb", ["-s", known ?? (await serial()), ...args], o);

  // ---- adb shell ------------------------------------------------------------------------------------------------
  /**
   * adb shell with an argument list. The fixed read commands run in every ask; any other command needs act, and some are refused always (shellClass).
   * o.named: package names the request named (needed for `pm clear` and `rm` in an app's folder).
   */
  async function shell(args, o = {}) {
    if (!Array.isArray(args)) throw new Error("pass the command as an array: phone.shell(['dumpsys','battery'])");
    const kind = shellClass(args, { named: o.named ?? [] });
    if (kind.startsWith("refused")) deny(`adb shell ${args.join(" ").slice(0, 100)}: ${kind.slice(9)}`);
    if (kind === "act") needAct(`adb shell ${args.join(" ").slice(0, 80)}`);
    const r = await adb(["shell", ...args.map(String)], { timeoutMs: o.timeoutMs ?? 30_000 });
    return { code: r.code, out: r.out, err: r.err.trim(), ...(r.timedOut ? { timedOut: true } : {}) };
  }
  const readShell = async (args, timeoutMs) => {
    const r = await shell(args, { timeoutMs });
    if (r.timedOut) throw new Error(`adb shell ${args.slice(0, 2).join(" ")} timed out`);
    if (r.code !== 0 && !r.out) throw new Error(`adb shell ${args.slice(0, 2).join(" ")} failed: ${r.err.slice(0, 200)}`);
    return r.out;
  };

  // ---- reading the phone ------------------------------------------------------------------------------------------
  /** The foreground app and whether the screen is on. On a denied app or screen the package and activity are left out and `denied` says why. */
  async function foreground() {
    const w = parseWindow(await readShell(["dumpsys", "window"], 30_000));
    const p = parseWakefulness(await readShell(["dumpsys", "power"], 20_000));
    const name = w.package ? `${w.package}/${w.activity ?? ""}` : w.window ?? "";
    const why = w.keyguard ? "the lock screen is showing" : name ? deniedWhy(name) : null;
    const out = { screenOn: p.screenOn, wakefulness: p.wakefulness };
    if (why) return { ...out, denied: why, package: null, activity: null };
    return { ...out, denied: null, package: w.package, activity: w.activity, ...(w.window ? { window: w.window } : {}) };
  }
  /** Throws unless the screen is on and the foreground is a known app that is not on the deny list. Returns the foreground. */
  async function guardScreen(what) {
    const f = await foreground();
    if (f.denied) deny(`${what}: ${f.denied}. Nothing was read or done; the person has to do this themselves on the phone`);
    if (f.screenOn === false) throw new Error(`${what}: the screen is off (${f.wakefulness}). Waking it needs act (phone.wake()); unlocking is the person's`);
    if (!f.package) deny(`${what}: cannot tell which app is in the foreground, so the deny list cannot be checked`);
    return f;
  }

  async function dump() {
    const r = await adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { timeoutMs: 30_000 });
    const nodes = parseHierarchy(r.out);
    if (!nodes) throw new Error(`the UI hierarchy could not be dumped: ${mask((r.err || r.out).trim().slice(0, 200)).text || "no output"} (the screen may be animating, or a secure screen)`);
    return nodes;
  }

  /**
   * The elements on the screen now, only when the question names the app (o.app) or what to look for (o.find). Refuses on a denied foreground app or lock screen,
   * or when a denied app has a window on the screen. Text is masked, password fields have no text, system UI (status bar, heads-up notifications) is left out.
   */
  async function screen(o = {}) {
    const app = String(o.app ?? "").trim();
    const find = String(o.find ?? "").trim();
    if (!app && !find) deny("name the app (app) or what to look for (find): the phone holds private messages and banking, so the screen is not read without a target");
    const f = await guardScreen("reading the screen");
    if (app && !f.package.toLowerCase().includes(app.toLowerCase())) {
      return { mismatch: true, package: f.package, activity: f.activity, wanted: app, count: 0, elements: [], rows: [], note: `the foreground app is ${f.package}, not ${app}; nothing was read. Opening ${app} needs act` };
    }
    const nodes = await dump();
    for (const n of nodes) {
      if (n.pkg && !n.pkg.startsWith("com.android.systemui")) {
        const why = deniedWhy(n.pkg);
        if (why) deny(`reading the screen: a window of a denied app is on the screen (${why}). Nothing was read`);
      }
    }
    const appNodes = nodes.filter((n) => !n.pkg.startsWith("com.android.systemui"));
    const dropped = nodes.length - appNodes.length;
    const codeScreen = appNodes.some((n) => CODE_CONTEXT.test(`${n.text} ${n.desc}`));
    let masked = 0;
    const clean = (s) => {
      const m = mask(s);
      masked += m.n;
      return m.text;
    };
    let els = appNodes.map((n) => {
      if (n.password) return { ...n, text: "", desc: "" };
      let text = n.text;
      let desc = n.desc;
      if (codeScreen && (isBareCode(text) || isBareCode(desc))) {
        if (isBareCode(text)) text = "[code]";
        if (isBareCode(desc)) desc = "[code]";
        masked++;
      }
      return { ...n, text: clean(text), desc: clean(desc) };
    });
    const total = els.length;
    if (find) {
      const re = rx(find);
      els = els.filter((n) => re.test(n.text) || re.test(n.desc) || re.test(n.id));
    } else els = els.filter((n) => n.text || n.desc || (n.clickable && n.id) || n.editable);
    const max = o.max ?? 80;
    const shown = els.slice(0, max);
    return {
      package: f.package, activity: f.activity, count: els.length, total, shown: shown.length, ...(els.length > shown.length ? { cut: els.length - shown.length } : {}),
      ...(dropped ? { droppedSystemUi: dropped } : {}), passwordFields: appNodes.filter((n) => n.password).length, ...(masked ? { masked: `${masked} code, email, phone or card-like text(s) were replaced` } : {}),
      elements: shown, rows: shown.map(rowOf),
    };
  }

  /** Connected or not and how, then model, Android version, battery, storage, screen state and the foreground app. connect: true tries one wireless connect. */
  async function status(o = {}) {
    const ds = await devices();
    let s = pick(ds);
    if (!s && o.connect) {
      try {
        s = await connect();
      } catch (e) {
        return { connected: false, devices: ds, why: e.message.replace(/^the phone is not connected: /, "").split(". To reconnect")[0], reconnect: RESTORE };
      }
    }
    if (!s) {
      const bad = ds.filter((d) => d.state !== "device");
      return {
        connected: false, devices: ds,
        why: bad.length ? `adb lists the phone as ${bad.map((d) => d.state).join(", ")}${bad.some((d) => d.state === "unauthorized") ? ": accept the debugging prompt on the phone" : ""}` : "adb lists no device: wireless debugging is off, the phone is on another network, or it has not been connected from this machine since adb restarted",
        reconnect: RESTORE,
      };
    }
    known = s;
    const prop = async (k) => (await readShell(["getprop", k], 10_000)).trim();
    const out = { connected: true, serial: s, transport: /^[0-9.]+:\d+$/.test(s) ? "wifi" : "usb" };
    out.model = await prop("ro.product.model");
    out.android = await prop("ro.build.version.release");
    out.sdk = Number(await prop("ro.build.version.sdk")) || null;
    out.securityPatch = await prop("ro.build.version.security_patch");
    out.battery = parseBattery(await readShell(["dumpsys", "battery"], 15_000));
    const df = (await readShell(["df", "/data"], 15_000)).trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
    if (df.length >= 5 && /^\d+$/.test(df[1])) {
      const gb = (k) => Math.round((Number(k) / 1024 / 1024) * 10) / 10;
      out.storage = { totalGB: gb(df[1]), usedGB: gb(df[2]), freeGB: gb(df[3]), usedPct: df[4] };
    } else out.storage = null;
    const f = await foreground();
    out.screen = f.screenOn == null ? null : f.screenOn ? "on" : "off";
    out.foreground = f.denied ? { denied: f.denied } : { package: f.package, activity: f.activity };
    return out;
  }

  /** Installed packages with versionCode; with 15 or fewer matches also versionName and install and update times. Third-party only unless o.all. */
  async function apps(o = {}) {
    const filter = String(o.filter ?? "");
    if (filter && !/^[A-Za-z0-9._]+$/.test(filter)) deny(`not a package filter: ${filter} (letters, digits, dots and underscores)`);
    const out = await readShell(["pm", "list", "packages", ...(o.all ? [] : ["-3"]), "--show-versioncode", ...(filter ? [filter] : [])], 30_000);
    let rows = out.split("\n").map((l) => l.trim().match(/^package:(\S+)\s+versionCode:(\d+)/)).filter(Boolean).map((m) => ({ package: m[1], versionCode: Number(m[2]) }));
    rows.sort((a, b) => a.package.localeCompare(b.package));
    const total = rows.length;
    const max = o.max ?? 60;
    const cut = Math.max(0, total - max);
    rows = rows.slice(0, max);
    let detailed = false;
    if (rows.length && rows.length <= 15) {
      detailed = true;
      for (const r of rows) {
        const info = parsePackages(await readShell(["dumpsys", "package", r.package], 30_000)).get(r.package);
        if (info) Object.assign(r, { versionName: info.versionName, firstInstall: info.firstInstall, lastUpdate: info.lastUpdate, debuggable: info.debuggable });
      }
    }
    return { total, shown: rows.length, ...(cut ? { cut } : {}), detailed, ...(rows.length && !detailed ? { note: "version names and install times are given for 15 or fewer packages: pass a narrower filter" } : {}), apps: rows };
  }

  /** Recent error and crash lines for a package, deduplicated and capped. Refuses packages on the deny list. Uses logcat -d with the package's uid and a line cap. */
  async function logs(pkg, o = {}) {
    if (!PKG.test(String(pkg))) deny(`not a package name: ${pkg}`);
    const why = deniedWhy(pkg);
    if (why) deny(`logcat of ${pkg.split(".").slice(0, 2).join(".")}...: ${why}`);
    const info = parsePackages(await readShell(["dumpsys", "package", pkg], 30_000)).get(pkg);
    if (!info) throw new Error(`${pkg} is not installed on the phone`);
    const level = o.level === "W" ? "W" : "E";
    const t = Math.min(Math.max(Number(o.lines ?? 2000), 100), 3000);
    const rows = [];
    if (info.uid) rows.push(...parseLogcat(await readShell(["logcat", "-d", "-b", "main,crash", "-t", String(t), "-v", "threadtime", `--uid=${info.uid}`, "*:W"], 30_000)));
    const crashRows = parseLogcat(await readShell(["logcat", "-d", "-b", "crash", "-t", "1000", "-v", "threadtime", "AndroidRuntime:E", "DEBUG:F", "libc:F", "*:S"], 30_000));
    const anrRows = parseLogcat(await readShell(["logcat", "-d", "-b", "main", "-t", "2000", "-v", "threadtime", "ActivityManager:E", "*:S"], 30_000));
    const crash = lastCrash([...crashRows, ...anrRows], pkg) ?? lastCrash(rows, pkg);
    const lines = dedupe(rows.filter((r) => levelAtLeast(r.level, level))).map((r) => ({ ...r, text: mask(r.text).text.slice(0, 240) }));
    const max = o.max ?? 30;
    return { package: pkg, uid: info.uid, level, scanned: rows.length, matched: lines.length, ...(lines.length > max ? { cut: lines.length - max } : {}), lastCrash: crash, lines: lines.slice(-max) };
  }

  /**
   * One package: installed or not, version, first install and last update, running, a debuggable build, permission counts, and its last crash.
   * The crash is read from logcat only for a debuggable build, or when o.crash is true; never for a package on the deny list.
   */
  async function app(pkg, o = {}) {
    if (!PKG.test(String(pkg))) deny(`not a package name: ${pkg}`);
    const info = parsePackages(await readShell(["dumpsys", "package", pkg], 30_000)).get(pkg);
    if (!info) return { package: pkg, installed: false };
    const pid = (await shell(["pidof", pkg], { timeoutMs: 10_000 })).out.trim();
    let isForeground = null;
    try {
      isForeground = (await foreground()).package === pkg;
    } catch {}
    const out = {
      package: pkg, installed: true, versionName: info.versionName, versionCode: info.versionCode, firstInstall: info.firstInstall, lastUpdate: info.lastUpdate, debuggable: info.debuggable,
      system: info.system, installer: info.installer, running: pid.length > 0, foreground: isForeground, permissions: { requested: info.requested, granted: info.granted },
    };
    const why = deniedWhy(pkg);
    if (why) out.crash = `not read: ${why}`;
    else if (info.debuggable || o.crash === true) out.crash = (await logs(pkg, { max: 10 })).lastCrash;
    else out.crash = "not read: not a debuggable build; pass crash: true to read this app's logcat";
    return out;
  }

  // ---- acting ---------------------------------------------------------------------------------------------------------
  const num = (v, what) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 6000 ? Math.round(Number(v)) : deny(`${what} must be a number from 0 to 6000`));
  /** The kit's own input calls: they come after the checks on the foreground, so they do not go through shellClass. */
  const inputRun = async (args, timeoutMs = 20_000) => {
    const r = await adb(["shell", "input", ...args.map(String)], { timeoutMs });
    if (r.code !== 0) throw new Error(`adb input ${args[0]} failed: ${(r.err || r.out).trim().slice(0, 300)}`);
    return r.out.trim();
  };
  const after = async () => {
    await sleep(700);
    try {
      const f = await foreground();
      return f.denied ? { denied: f.denied } : { package: f.package, activity: f.activity, screenOn: f.screenOn };
    } catch (e) {
      return { error: e.message.slice(0, 120) };
    }
  };

  return {
    /** True when this ask may change things. */
    act,
    /** Why a package or activity name is on the deny list, or null: phone.check("com.example.app"). */
    check: (name) => deniedWhy(name),
    /** "read", "act" or "refused: why" for an adb shell argument list, without running it. */
    shellClass,
    devices, connect, shell, foreground, screen, status, apps, app, logs,

    /** Tap at a point in device pixels (the x and y of a screen row). Refuses a denied app or lock screen. Returns the foreground afterwards. */
    async tap(x, y) {
      needAct("tapping");
      const f = await guardScreen("tapping");
      await inputRun(["tap", num(x, "x"), num(y, "y")]);
      return { tapped: [Number(x), Number(y)], was: f.package, now: await after() };
    },
    /** Swipe between two points in device pixels, ms long (50 to 3000). Scroll down by swiping up. */
    async swipe(x1, y1, x2, y2, ms = 300) {
      needAct("swiping");
      const f = await guardScreen("swiping");
      const t = Math.min(3000, Math.max(50, Number(ms) || 300));
      await inputRun(["swipe", ...[x1, y1, x2, y2].map((v, i) => num(v, ["x1", "y1", "x2", "y2"][i])), t]);
      return { swiped: [x1, y1, x2, y2].map(Number), was: f.package, now: await after() };
    },
    /** Type text into the focused field (tap the field first). Refuses a denied app, a password field, and anything but printable ASCII up to 500 characters. */
    async type(text) {
      needAct("typing");
      const t = String(text);
      if (!t.length || t.length > 500 || !/^[\x20-\x7e]+$/.test(t)) deny("type 1 to 500 printable ASCII characters on one line");
      const f = await guardScreen("typing");
      const nodes = await dump();
      const pw = nodes.some((n) => n.password);
      const focused = nodes.filter((n) => n.focused && (n.editable || n.password));
      if (focused.some((n) => n.password) || (pw && !focused.length)) deny("typing: the focused field is a password field, or it cannot be told apart from one. Passwords are never typed; the person types them themselves");
      if (t.includes("%")) deny("typing: a % cannot be sent through adb input text; type the text without it");
      await adb(["shell", `input text '${t.replace(/'/g, `'\\''`).replace(/ /g, "%s")}'`], { timeoutMs: 20_000 }).then((r) => {
        if (r.code !== 0) throw new Error(`adb input text failed: ${(r.err || r.out).trim().slice(0, 300)}`);
      });
      return { typed: t.length, into: f.package, now: await after() };
    },
    /** Press a key: back, home, recents, enter, delete, tab, power, volup, voldown, or a keycode number. On a denied app only back, home, recents, power and the volume keys work. */
    async key(name) {
      needAct("pressing a key");
      const n = String(name).toLowerCase();
      if (!KEY_NAMES.has(n) && !/^\d{1,3}$/.test(n)) deny(`unknown key ${name}: back, home, recents, enter, delete, tab, power, volup, voldown or a keycode number`);
      if (!SAFE_KEYS.has(n)) await guardScreen(`pressing ${n}`);
      await inputRun(["keyevent", KEYCODES[n] ?? n]);
      return { pressed: n, now: await after() };
    },
    /** Wake the screen (keycode 224). Unlocking is never attempted: the PIN and fingerprint are the person's. */
    async wake() {
      needAct("waking the screen");
      await inputRun(["keyevent", 224]);
      await sleep(800);
      return foreground();
    },
    /** Start an app by package name or a word in it (a word is looked up among the installed packages and must match one), or open a deep link (a scheme://... URL; tel:, sms: and mailto: are refused). */
    async open(target) {
      needAct("opening an app or link");
      const t = String(target).trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
        if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s'"`\\$<>|;()]+$/i.test(t) || /^(tel|sms|smsto|mms|mmsto|mailto|content|file|intent|voicemail)/i.test(t)) deny(`not a link this kit opens: ${t.slice(0, 80)} (a scheme://path URL; tel, sms, mailto, content, file and intent are refused)`);
        const r = await adb(["shell", `am start -a android.intent.action.VIEW -d '${t}'`], { timeoutMs: 20_000 });
        if (r.code !== 0 || /Error/.test(r.out)) throw new Error(`opening the link failed: ${mask((r.out || r.err).trim().slice(0, 200)).text}`);
        return { opened: "link", scheme: t.split(":")[0], now: await after() };
      }
      if (!WORD.test(t)) deny(`not an app name or package: ${t.slice(0, 60)}`);
      let pkg = t;
      if (!PKG.test(t)) {
        const rows = (await readShell(["pm", "list", "packages"], 20_000)).split("\n").map((l) => l.trim().replace(/^package:/, "")).filter((l) => l.toLowerCase().includes(t.toLowerCase()));
        if (rows.length !== 1) throw new Error(rows.length ? `${rows.length} packages match ${t}: ${rows.slice(0, 8).join(", ")}. Name the package` : `no installed package has ${t} in its name`);
        pkg = rows[0];
      }
      const why = deniedWhy(pkg);
      if (why) deny(`opening ${pkg.split(".").slice(0, 2).join(".")}...: ${why}`);
      const r = await adb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], { timeoutMs: 30_000 });
      if (r.code !== 0 || /No activities found|Error|aborted/.test(r.out + r.err)) throw new Error(`opening ${pkg} failed: ${mask((r.out + r.err).trim().slice(0, 200)).text}`);
      return { opened: pkg, now: await after() };
    },
    /** Install an APK the caller names (adb install -r; -t for a test build with o.test). Never grants all permissions. */
    async install(apk, o = {}) {
      needAct("installing an APK");
      const p = path.resolve(cwd, String(apk));
      if (!/\.apk$/i.test(p)) deny("install takes a path to a .apk file");
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        throw new Error(`no such file: ${p}`);
      }
      if (!st.isFile() || st.size > 600 << 20) throw new Error(`${p} is not a regular file under 600 MB`);
      const r = await adb(["install", "-r", ...(o.test ? ["-t"] : []), ...(o.downgrade ? ["-d"] : []), p], { timeoutMs: 180_000 });
      const out = (r.out + r.err).trim();
      if (r.code !== 0 || !/Success/.test(out)) throw new Error(`adb install failed: ${out.slice(0, 300)}`);
      return { installed: true, apk: p, size: st.size, output: out.slice(0, 200) };
    },
    /** Uninstall a third-party package the caller names (its data goes with it unless o.keepData). Refuses system packages and the deny list. */
    async uninstall(pkg, o = {}) {
      needAct("uninstalling an app");
      if (!PKG.test(String(pkg))) deny(`not a package name: ${pkg}`);
      const why = deniedWhy(pkg);
      if (why) deny(`uninstalling ${pkg.split(".").slice(0, 2).join(".")}...: ${why}`);
      const third = (await readShell(["pm", "list", "packages", "-3", pkg], 20_000)).split("\n").map((l) => l.trim().replace(/^package:/, ""));
      if (!third.includes(pkg)) throw new Error(`${pkg} is not an installed third-party app (system apps are never uninstalled)`);
      const r = await adb(["uninstall", ...(o.keepData ? ["-k"] : []), pkg], { timeoutMs: 60_000 });
      const out = (r.out + r.err).trim();
      if (r.code !== 0 || !/Success/.test(out)) throw new Error(`adb uninstall failed: ${out.slice(0, 300)}`);
      return { uninstalled: pkg, keepData: !!o.keepData };
    },
    /** Take a screenshot to a PNG file at the phone's full resolution and return its path. The file is not read. Refuses a denied app or lock screen. */
    async screenshot(o = {}) {
      needAct("taking a screenshot");
      const f = await guardScreen("taking a screenshot");
      let p;
      if (o.file) {
        p = path.resolve(cwd, String(o.file));
        const roots = [cwd, os.tmpdir(), cacheDir].map((r) => path.resolve(r) + path.sep);
        if (!/\.png$/i.test(p) || !roots.some((r) => p.startsWith(r))) deny("the screenshot file must be a .png under the working folder, the temp folder or ~/.cache/phone");
      } else {
        fs.mkdirSync(cacheDir, { recursive: true });
        p = path.join(cacheDir, `shot-${Date.now()}.png`);
      }
      const r = await adb(["exec-out", "screencap", "-p"], { timeoutMs: 40_000, outFile: p });
      if (r.code !== 0) throw new Error(`screenshot failed: ${(r.err || r.out).trim().slice(0, 300)}`);
      return { file: p, app: f.package };
    },
    /** Show the phone in a window titled Phone on the desktop (scrcpy, started detached). Does nothing when a scrcpy window is already open. */
    async scrcpy() {
      needAct("opening the phone in a window");
      const s = known ?? (await serial());
      const open = await ran("pgrep", ["-x", "scrcpy"], { timeoutMs: 5_000 });
      if (open.code === 0 && open.out.trim()) return { started: false, note: "a scrcpy window is already open" };
      if (!launch("scrcpy", ["-s", s, "--window-title", "Phone"])) throw new Error("scrcpy could not be started (is it installed?)");
      return { started: true, window: "Phone", note: "scrcpy was started detached; closing the window ends it" };
    },
  };
}
