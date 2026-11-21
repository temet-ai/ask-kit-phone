// Tests with no phone and no model: a stubbed executor answers with the fixture files in ./fixtures.
// Run: node --test test/
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deniedWhy, mask, parseHierarchy } from "../lib.mjs";
import { shellClass } from "../phone.mjs";

import { mk } from "./stub.mjs";

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const changing = (calls) => calls.filter((c) => c[0] === "scrcpy" || (c[0] === "adb" && (["install", "uninstall"].includes(c[3]) || (c[3] === "exec-out" && c[4] === "screencap") || (c[3] === "shell" && /^(input|monkey)/.test(c[4])))));

test("without act, every changing call is held and nothing reaches the phone", async () => {
  const { p, calls } = mk();
  for (const f of [() => p.tap(10, 10), () => p.swipe(1, 2, 3, 4), () => p.type("hi"), () => p.key("back"), () => p.open("notes"), () => p.install("/tmp/a.apk"), () => p.uninstall("com.example.tool"), () => p.screenshot(), () => p.scrcpy(), () => p.wake(), () => p.shell(["rm", "-rf", "/data/local/tmp/x"]), () => p.shell(["am", "force-stop", "com.example.tool"])]) {
    await assert.rejects(f, /not in this ask/);
  }
  assert.deepEqual(changing(calls), []);
  assert.equal(calls.filter((c) => c[0] === "adb" && c[3] === "shell" && !["dumpsys", "pm"].includes(c[4])).length, 0);
});

test("status reads: model, version, battery, storage, screen, foreground", async () => {
  const { p } = mk();
  const s = await p.status();
  assert.equal(s.connected, true);
  assert.equal(s.model, "SM-TEST");
  assert.equal(s.android, "14");
  assert.deepEqual(s.battery, { level: 71, status: "charging", plugged: ["USB"], tempC: 28.7, health: "good" });
  assert.deepEqual(s.storage, { totalGB: 215.5, usedGB: 93.5, freeGB: 121.1, usedPct: "44%" });
  assert.equal(s.screen, "on");
  assert.equal(s.foreground.package, "com.example.notes");
});

test("status when not connected says why and gives the reconnect command, and does not try to connect", async () => {
  const { p, calls } = mk({ connected: false });
  const s = await p.status();
  assert.equal(s.connected, false);
  assert.match(s.why, /no device/);
  assert.match(s.reconnect, /adb connect/);
  assert.equal(calls.filter((c) => c[0] === "adb" && c[1] === "connect").length, 0);
  const t = await p.status({ connect: true });
  assert.equal(t.connected, false);
  assert.match(t.why, /no phone announces/);
  assert.equal(calls.filter((c) => c[0] === "adb" && c[1] === "mdns").length, 1);
  await assert.rejects(() => p.apps(), /not connected/);
});

test("status hides the name of a denied foreground app", async () => {
  const { p } = mk({ window: "window-denied.txt" });
  const s = await p.status();
  assert.ok(s.foreground.denied);
  assert.ok(!JSON.stringify(s).includes("whatsapp"));
});

test("screen needs a target, and returns rows with centres, ids and masked text", async () => {
  const { p } = mk();
  await assert.rejects(() => p.screen(), /name the app/);
  const r = await p.screen({ app: "notes" });
  assert.equal(r.package, "com.example.notes");
  assert.equal(r.droppedSystemUi, 2);
  assert.ok(r.rows.some((x) => x.startsWith("970,2070 C") && x.includes("Add note") && x.includes("#add")));
  const body = r.elements.find((e) => e.id === "body");
  assert.match(body.text, /^Call \[phone\] or mail \[email\]$/);
  assert.ok(!JSON.stringify(r).includes("systemui") && !JSON.stringify(r).includes("New message"));
  const f = await p.screen({ find: "search" });
  assert.equal(f.count, 1);
  assert.equal(f.elements[0].text, "Search & filter");
  assert.equal(f.elements[0].editable, true);
  const cut = await p.screen({ app: "notes", max: 1 });
  assert.equal(cut.shown, 1);
  assert.ok(cut.cut >= 1);
});

test("screen of another app than the one named reads nothing", async () => {
  const { p, calls } = mk();
  const r = await p.screen({ app: "camera" });
  assert.equal(r.mismatch, true);
  assert.equal(r.elements.length, 0);
  assert.equal(calls.filter((c) => c.includes("exec-out")).length, 0);
});

test("screen refuses a denied app, the lock screen, the notification shade, a screen that is off, and a denied overlay", async () => {
  for (const [s, re] of [[{ window: "window-denied.txt" }, /deny list/], [{ window: "window-keyguard.txt" }, /lock screen/], [{ window: "window-shade.txt" }, /deny list|notifications/], [{ power: "power-asleep.txt" }, /screen is off/], [{ ui: "ui-overlay.xml" }, /denied app/]]) {
    const { p, calls } = mk(s);
    await assert.rejects(() => p.screen({ app: "x", find: "y" }), re);
    if (!s.ui) assert.equal(calls.filter((c) => c.includes("exec-out")).length, 0, "no dump was taken");
  }
  const { p } = mk({ window: "window-denied.txt" });
  await assert.rejects(() => p.screen({ find: "a" }), (e) => !/whatsapp/i.test(e.message));
});

test("screen masks a code that sits in an element of its own, and card numbers; a password field has no text", async () => {
  const c = await mk({ ui: "ui-code.xml" }).p.screen({ find: "." });
  const all = JSON.stringify(c.elements);
  assert.ok(!all.includes("482") && !all.includes("4111"));
  assert.match(all, /\[code\]/);
  assert.match(all, /\[card\]/);
  const w = await mk({ ui: "ui-password.xml" }).p.screen({ find: "." });
  assert.equal(w.passwordFields, 1);
  assert.ok(!JSON.stringify(w.elements).includes("•"));
  assert.ok(w.rows.some((r) => r.includes("[password field]")));
});

test("mask: codes next to words, emails, phones, cards; not dates or versions", () => {
  assert.equal(mask("Your code is 482913").text, "Your code is [code]");
  assert.equal(mask("482913 is your verification code").text, "[code] is your verification code");
  assert.equal(mask("OTP: 1234").text, "OTP: [code]");
  assert.equal(mask("mail me at ann@example.com").text, "mail me at [email]");
  assert.equal(mask("call +27 82 123 4567 now").text, "call [phone] now");
  assert.equal(mask("4111 1111 1111 1111").text, "[card]");
  assert.equal(mask("2026-11-20 12:00:00").text, "2026-11-20 12:00:00");
  assert.equal(mask("version 1.4.2 build 4821").text, "version 1.4.2 build 4821");
});

test("deny list: prefixes, words and short tokens, and no false hit on plain names", () => {
  for (const n of ["com.whatsapp/.Main", "com.google.android.gm", "com.example.mybank/.Home", "com.x.PaymentsActivity", "com.android.systemui", "NotificationShade", "com.some.otpreader", "com.example.app/.PasswordResetActivity", "com.samsung.android.messaging", "org.signal.x", "com.example.app/.SmsActivity"]) {
    assert.ok(deniedWhy(n), `${n} should be denied`);
  }
  for (const n of ["com.example.notes/.ui.MainActivity", "com.example.devapp", "org.sample.player", "com.android.settings/.Settings", "com.example.display.DisplayActivity", "com.example.footprint"]) {
    assert.equal(deniedWhy(n), null, `${n} should be allowed`);
  }
});

test("hierarchy parser reads attributes, escapes and centres", () => {
  const n = parseHierarchy(fx("ui-ok.xml"));
  assert.equal(n.length, 7);
  const s = n.find((x) => x.id === "search");
  assert.deepEqual([s.x, s.y, s.clickable, s.editable, s.focused], [540, 240, true, true, true]);
  assert.equal(parseHierarchy("ERROR: could not get idle state"), null);
});

test("apps: versionCode for all, names and times for 15 or fewer, filter checked", async () => {
  const { p } = mk();
  const a = await p.apps();
  assert.equal(a.total, 3);
  assert.equal(a.detailed, true);
  assert.equal(a.apps.find((x) => x.package === "com.example.devapp").versionName, "1.4.2-debug");
  assert.equal(a.apps.find((x) => x.package === "com.example.devapp").debuggable, true);
  assert.equal((await p.apps({ filter: "example" })).total, 2);
  await assert.rejects(() => p.apps({ filter: "a; rm" }), /not a package filter/);
});

test("app: a debuggable build gets its last crash, a release build does not unless asked, a denied package never", async () => {
  const { p } = mk();
  const d = await p.app("com.example.devapp");
  assert.equal(d.installed, true);
  assert.equal(d.running, true);
  assert.deepEqual(d.permissions, { requested: 3, granted: 2 });
  assert.equal(d.crash.kind, "java");
  assert.match(d.crash.summary, /IllegalStateException/);
  assert.ok(!JSON.stringify(d.crash).includes("RuntimeException: boom"));
  const r = await p.app("com.example.tool");
  assert.match(r.crash, /not read/);
  assert.equal(r.running, false);
  assert.equal((await p.app("com.example.tool", { crash: true })).crash, null);
  assert.equal((await p.app("com.example.nothere")).installed, false);
  assert.match((await p.app("com.whatsapp")).crash ?? "not installed", /not installed|not read/);
});

test("logs: deduplicated, masked, capped, crash found; denied package refused", async () => {
  const { p, calls } = mk();
  const l = await p.logs("com.example.devapp");
  assert.equal(l.level, "E");
  const sync = l.lines.find((x) => x.tag === "NotesSync");
  assert.equal(sync.count, 2);
  assert.ok(!JSON.stringify(l).includes("sam@example.com") && !JSON.stringify(l).includes("482913"));
  assert.ok(!l.lines.some((x) => x.level === "W" || x.level === "I"));
  assert.equal(l.lastCrash.kind, "java");
  const lc = calls.filter((c) => c.includes("logcat"));
  assert.ok(lc.length === 3 && lc.every((c) => c.includes("-d") && c.includes("-t")));
  assert.equal((await p.logs("com.example.devapp", { max: 1 })).cut, 1);
  await assert.rejects(() => p.logs("com.whatsapp"), /deny list/);
  await assert.rejects(() => p.logs("com.example.nothere"), /not installed/);
  await assert.rejects(() => p.logs("x; reboot"), /not a package name/);
});

test("shell: the fixed read set runs, everything else is classified", () => {
  const read = [["dumpsys", "battery"], ["dumpsys", "window"], ["dumpsys", "package", "com.a.b"], ["pm", "list", "packages", "-3", "foo"], ["getprop", "ro.product.model"], ["df", "/data"], ["logcat", "-d", "-t", "200", "--uid=10001", "*:W"], ["logcat", "-d", "-t", "50", "AndroidRuntime:E", "*:S"], ["pidof", "com.a.b"]];
  for (const a of read) assert.equal(shellClass(a), "read", a.join(" "));
  const refused = [
    ["logcat"], ["logcat", "-t", "100", "--uid=1"], ["logcat", "-d", "-t", "100"], ["logcat", "-c"], ["logcat", "-d", "-t", "9000", "*:S"], ["logcat", "-d", "-b", "radio", "-t", "10", "*:S"],
    ["su", "-c", "id"], ["input", "text", "x"], ["screencap", "-p"], ["uiautomator", "dump"], ["dumpsys", "notification"], ["dumpsys", "notification", "--noredact"], ["cmd", "statusbar", "expand-notifications"],
    ["getprop", "ro.serialno"], ["getprop"], ["rm", "-rf", "/sdcard/Download"], ["rm", "-rf", "/data/local/tmp/../x"], ["pm", "clear", "com.a.b"], ["ls", "/data/data/com.other"], ["cat", "/data/data/com.x/shared_prefs/a.xml"],
    ["ls", "/sdcard/DCIM"], ["content", "query", "--uri", "content://sms/inbox"], ["content", "query", "--uri", "content://com.android.contacts/contacts"], ["content", "query", "--uri", "content://call_log/calls"],
    ["am", "broadcast", "-a", "android.intent.action.BOOT_COMPLETED"], ["am", "broadcast", "-a", "com.example.PING"], ["am", "start", "-a", "android.intent.action.CALL", "-d", "tel:123"],
    ["reboot"], ["svc", "wifi", "disable"], ["dumpsys", "battery;", "reboot"], ["pm", "uninstall", "com.a.b"], ["pm", "grant", "com.a.b", "android.permission.READ_SMS"], ["recovery", "--wipe_data"], ["settings", "put", "global", "adb_wifi_enabled", "0"],
  ];
  for (const a of refused) assert.match(shellClass(a), /^refused/, a.join(" "));
  assert.equal(shellClass(["pm", "clear", "com.a.b"], { named: ["com.a.b"] }), "act");
  assert.equal(shellClass(["rm", "-rf", "/data/local/tmp/work"]), "act");
  assert.equal(shellClass(["rm", "/sdcard/Android/data/com.a.b/files/x"], { named: ["com.a.b"] }), "act");
  assert.equal(shellClass(["am", "force-stop", "com.a.b"]), "act");
  assert.equal(shellClass(["am", "broadcast", "-a", "com.example.PING", "-p", "com.example"]), "act");
  assert.equal(shellClass(["run-as", "com.a.b", "ls", "files"], { named: ["com.a.b"] }), "act");
  assert.equal(shellClass(["run-as", "com.other", "ls"], { named: ["com.a.b"] }).slice(0, 7), "refused");
});

test("with act: tap sends device pixels, and refuses a denied app", async () => {
  const { p, calls } = mk({}, { act: true });
  const r = await p.tap(970, 2070);
  assert.deepEqual(calls.find((c) => c[4] === "input" && c[5] === "tap"), ["adb", "-s", "192.168.1.5:5555", "shell", "input", "tap", "970", "2070"]);
  assert.equal(r.now.package, "com.example.notes");
  const d = mk({ window: "window-denied.txt" }, { act: true });
  await assert.rejects(() => d.p.tap(1, 1), /deny list/);
  await assert.rejects(() => d.p.swipe(1, 1, 5, 5), /deny list/);
  await assert.rejects(() => d.p.type("hello"), /deny list/);
  await assert.rejects(() => d.p.screenshot(), /deny list/);
  assert.deepEqual(changing(d.calls), []);
  await assert.rejects(() => mk({ power: "power-asleep.txt" }, { act: true }).p.tap(1, 1), /screen is off/);
  await assert.rejects(() => p.tap("a", 1), /number/);
});

test("with act: swipe, key, type, open, wake", async () => {
  const { p, calls } = mk({}, { act: true });
  await p.swipe(540, 1800, 540, 600, 400);
  assert.deepEqual(calls.find((c) => c[5] === "swipe").slice(3), ["shell", "input", "swipe", "540", "1800", "540", "600", "400"]);
  await p.key("back");
  assert.deepEqual(calls.find((c) => c[5] === "keyevent").slice(3), ["shell", "input", "keyevent", "4"]);
  await assert.rejects(() => p.key("rm -rf"), /unknown key/);
  await p.type("hello world");
  assert.deepEqual(calls.find((c) => /^input text/.test(c[4])).slice(3), ["shell", "input text 'hello%sworld'"]);
  await p.type("it's");
  assert.ok(calls.some((c) => c[4] === `input text 'it'\\''s'`));
  await assert.rejects(() => p.type("100%"), /%/);
  await assert.rejects(() => p.type("a\nb"), /printable ASCII/);
  await assert.rejects(() => p.type("x".repeat(501)), /500/);
  const o = await p.open("player");
  assert.deepEqual(calls.find((c) => c[4] === "monkey").slice(3), ["shell", "monkey", "-p", "org.sample.player", "-c", "android.intent.category.LAUNCHER", "1"]);
  assert.equal(o.opened, "org.sample.player");
  const l = await p.open("https://example.com/a?b=1&c=2");
  assert.equal(l.scheme, "https");
  assert.ok(calls.some((c) => c.includes("shell") && /am start -a android.intent.action.VIEW -d 'https:\/\/example.com\/a\?b=1&c=2'/.test(c[c.length - 1])));
  for (const bad of ["tel:123456", "sms://123", "mailto:a@b.c", "https://x.com/a'b", "https://x.com/a b", "notes; reboot"]) await assert.rejects(() => p.open(bad), /not (a link|an app)/, bad);
  await p.wake();
  assert.deepEqual(calls.filter((c) => c[5] === "keyevent").pop().slice(3), ["shell", "input", "keyevent", "224"]);
});

test("with act: keys on a denied app are limited to back, home, recents, power and volume", async () => {
  const { p, calls } = mk({ window: "window-denied.txt" }, { act: true });
  await p.key("home");
  await assert.rejects(() => p.key("enter"), /deny list/);
  await assert.rejects(() => p.key("66"), /deny list/);
  assert.deepEqual(calls.filter((c) => c[5] === "keyevent").map((c) => c[6]), ["3"]);
});

test("with act: typing is refused into a password field, and when a password field cannot be told from the focus", async () => {
  const w = mk({ ui: "ui-password.xml" }, { act: true });
  await assert.rejects(() => w.p.type("secret"), /password field/);
  assert.equal(w.calls.filter((c) => /^input text/.test(c[4])).length, 0);
  const ok2 = mk({ ui: "ui-ok.xml" }, { act: true });
  await ok2.p.type("fine");
  assert.equal(ok2.calls.filter((c) => /^input text/.test(c[4])).length, 1);
});

test("with act: install checks the file, uninstall checks the package", async () => {
  const { p, calls, dir } = mk({}, { act: true, cwd: undefined });
  const apk = path.join(dir, "app-debug.apk");
  fs.writeFileSync(apk, "x");
  const i = await p.install(apk, { test: true });
  assert.equal(i.installed, true);
  assert.deepEqual(calls.find((c) => c[3] === "install"), ["adb", "-s", "192.168.1.5:5555", "install", "-r", "-t", apk]);
  await assert.rejects(() => p.install(path.join(dir, "nope.apk")), /no such file/);
  await assert.rejects(() => p.install(path.join(dir, "x.zip")), /\.apk/);
  assert.equal((await p.uninstall("com.example.tool")).uninstalled, "com.example.tool");
  assert.ok(calls.some((c) => c[3] === "uninstall" && c[4] === "com.example.tool"));
  await assert.rejects(() => p.uninstall("com.whatsapp"), /deny list/);
  await assert.rejects(() => p.uninstall("com.android.chrome"), /third-party/);
});

test("with act: screenshot returns a path under allowed folders, scrcpy is started detached", async () => {
  const { p, calls, dir } = mk({}, { act: true });
  const f = path.join(dir, "s.png");
  assert.equal((await p.screenshot({ file: f })).file, f);
  await assert.rejects(() => p.screenshot({ file: "/etc/passwd.png" }), /must be a \.png under/);
  await assert.rejects(() => p.screenshot({ file: path.join(dir, "s.txt") }), /\.png/);
  await p.scrcpy();
  assert.deepEqual(calls.find((c) => c[0] === "scrcpy"), ["scrcpy", "-s", "192.168.1.5:5555", "--window-title", "Phone"]);
  assert.ok(fs.existsSync(f));
});

test("with act: adb shell outside the read set runs, and the always-refused ones still do not", async () => {
  const { p, calls } = mk({}, { act: true });
  await p.shell(["am", "force-stop", "com.example.tool"]);
  assert.ok(calls.some((c) => c.includes("force-stop")));
  await assert.rejects(() => p.shell(["su", "-c", "id"]), /not allowed/);
  await assert.rejects(() => p.shell(["input", "text", "x"]), /not allowed/);
  await assert.rejects(() => p.shell(["pm", "clear", "com.other.app"]), /named/);
  await p.shell(["pm", "clear", "com.example.tool"], { named: ["com.example.tool"] });
});

test("PHONE_SERIAL picks the device; connect uses the announced address, or the serial when it is host:port", async () => {
  const a = mk({}, { serial: "192.168.1.5:5555" });
  assert.equal((await a.p.status()).serial, "192.168.1.5:5555");
  const b = mk({}, { serial: "R58M123" });
  assert.equal((await b.p.status()).connected, false);
  const c = mk({ connected: false, announced: true });
  const s = await c.p.status({ connect: true });
  assert.equal(s.connected, true);
  assert.deepEqual(c.calls.find((x) => x[1] === "connect"), ["adb", "connect", "192.168.1.5:37000"]);
  const d = mk({ connected: false }, { serial: "192.168.1.5:5555" });
  assert.equal((await d.p.status({ connect: true })).connected, true);
  assert.deepEqual(d.calls.find((x) => x[1] === "connect"), ["adb", "connect", "192.168.1.5:5555"]);
});
