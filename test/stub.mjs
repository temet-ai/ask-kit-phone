// A stubbed adb that answer with the fixture files in ./fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePhone } from "../phone.mjs";

export const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const ok = (out = "") => ({ code: 0, out, err: "" });

/** A stub for adb. `s` picks the fixtures: window, power, ui, connected. */
function stub(s = {}) {
  const st = { window: "window-ok.txt", power: "power-awake.txt", ui: "ui-ok.xml", connected: true, ...s };
  const calls = [];
  const exec = async (cmd, args, o = {}) => {
    calls.push([cmd, ...args]);
    if (cmd === "pgrep") return { code: 1, out: "", err: "" };
    if (cmd !== "adb") return { code: 127, out: "", err: "no" };
    if (args[0] === "mdns") return ok(st.announced ? "List of discovered mdns services\nadb-TEST\t_adb-tls-connect._tcp.\t192.168.1.5:37000\n" : "List of discovered mdns services\n");
    if (args[0] === "connect") return st.announced || args[1] === "192.168.1.5:5555" ? ((st.connected = true), ok(`connected to ${args[1]}\n`)) : { code: 1, out: "", err: "failed to connect" };
    if (args[0] === "devices") return ok(`List of devices attached\n${st.connected ? "192.168.1.5:5555\tdevice\n" : ""}\n`);
    const a = args.slice(2);
    const line = a.join(" ");
    if (a[0] === "exec-out" && a[1] === "screencap") {
      if (o.outFile) fs.writeFileSync(o.outFile, "png");
      return ok("");
    }
    if (a[0] === "exec-out") return ok(fx(st.ui));
    if (a[0] === "install" || a[0] === "uninstall") return ok("Success\n");
    if (a[0] === "shell" && a[1] === "am") return ok("Starting: Intent\n");
    if (a[0] === "shell" && a[1] === "monkey") return ok("Events injected: 1\n");
    if (a[0] === "shell" && (a[1] === "input" || /^input /.test(a[1]))) return ok("");
    if (a[0] === "shell") {
      const c = a.slice(1);
      if (c[0] === "dumpsys" && c[1] === "window") return ok(fx(st.window));
      if (c[0] === "dumpsys" && c[1] === "power") return ok(fx(st.power));
      if (c[0] === "dumpsys" && c[1] === "battery") return ok(fx("battery.txt"));
      if (c[0] === "dumpsys" && c[1] === "package") return ok(c[2] === "com.example.devapp" ? fx("package-dev.txt") : c[2] === "com.example.tool" ? fx("package-release.txt") : "");
      if (c[0] === "getprop") return ok({ "ro.product.model": "SM-TEST", "ro.build.version.release": "14", "ro.build.version.sdk": "34", "ro.build.version.security_patch": "2026-10-01" }[c[1]] + "\n");
      if (c[0] === "df") return ok(fx("df.txt"));
      if (c[0] === "pm" && c[1] === "list") {
        const last = c[c.length - 1];
        const rows = fx("pm-list.txt").split("\n").filter((l) => l && (last.startsWith("-") || last === "packages" || l.includes(last)));
        return ok(rows.map((l) => (c.includes("--show-versioncode") ? l : l.replace(/ versionCode:\d+/, ""))).join("\n"));
      }
      if (c[0] === "pidof") return ok(c[1] === "com.example.devapp" ? "5000\n" : "");
      if (c[0] === "logcat") return ok(c.includes("-b") && c[c.indexOf("-b") + 1] === "crash" ? fx("logcat-crash.txt") : c.some((x) => x.startsWith("--uid")) ? fx("logcat-uid.txt") : "");
      return ok(`ran ${line}\n`);
    }
    return ok("");
  };
  return { exec, calls, st };
}
export const mk = (s, o = {}) => {
  const b = stub(s);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-test-"));
  return { ...b, dir, p: makePhone({ exec: b.exec, launch: (c, a) => (b.calls.push([c, ...a]), true), sleep: async () => {}, ...o }) };
};
