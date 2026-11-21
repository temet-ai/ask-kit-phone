// Shared helpers for the phone kit: the deny list (the one place that says which apps and screens are
// never read or driven), masking of private text, and parsers for what adb prints (the UI hierarchy,
// dumpsys battery, power, window and package, logcat).

// ---- The deny list ---------------------------------------------------------------------------------
// The phone holds private messages, banking, 2FA codes and photos, and what the kit reads goes to a
// cloud model. A foreground package or activity that matches is never read (no screen elements, no
// screenshot, no logcat) and never tapped, swiped or typed into. Edit these three lists, nothing else.

/** Package prefixes (lower case). */
export const DENY_PREFIXES = [
  // system surfaces: the notification shade, lock screen, quick settings, permission and credential dialogs
  "com.android.systemui", "com.android.keyguard", "com.samsung.android.keyguard", "com.google.android.permissioncontroller", "com.android.permissioncontroller",
  "com.samsung.android.biometrics", "com.android.credentialmanager", "com.google.android.gms.auth", "com.samsung.android.authfw",
  // banking and payment
  "com.google.android.apps.walletnfcrel", "com.samsung.android.spay", "com.paypal", "com.venmo", "com.squareup.cash", "com.revolut", "com.monzo", "com.starlingbank",
  "com.transferwise", "za.co.", "uk.co.hsbc", "com.barclays", "com.lloydsbank", "com.rbs", "com.natwest", "com.santander", "com.stripe",
  // password managers and authenticators
  "com.onepassword", "com.agilebits", "com.x8bit.bitwarden", "com.bitwarden", "org.keepassdroid", "com.kunzisoft.keepass", "com.lastpass", "com.dashlane", "com.nordpass",
  "com.samsung.android.samsungpass", "proton.android.pass", "com.google.android.apps.authenticator2", "com.azure.authenticator", "com.azure.", "com.authy", "com.duosecurity",
  "com.okta", "com.pingidentity", "com.yubico", "com.twofasapp", "com.beemdevelopment.aegis",
  // messaging, calls, contacts
  "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging", "org.thoughtcrime.securesms", "com.whatsapp", "org.telegram",
  "com.facebook.orca", "com.discord", "com.slack", "com.microsoft.teams", "com.google.android.talk", "com.skype", "com.viber", "com.snapchat", "im.vector", "org.signal",
  "com.google.android.dialer", "com.samsung.android.dialer", "com.samsung.android.incallui", "com.android.dialer", "com.google.android.contacts", "com.samsung.android.contacts", "com.android.contacts",
  // email
  "com.google.android.gm", "com.microsoft.office.outlook", "com.samsung.android.email", "com.yahoo.mobile.client.android.mail", "ch.protonmail", "com.fsck.k9",
  // photos
  "com.google.android.apps.photos", "com.sec.android.gallery3d", "com.samsung.android.gallery",
];

/** Words that deny a package or activity name when they appear anywhere in it (lower case, length 4 or more). */
export const DENY_WORDS = [
  "bank", "wallet", "password", "passcode", "credential", "keyguard", "lockscreen", "messag", "mail", "signal", "whatsapp", "telegram", "auth", "verification",
  "biometric", "fingerprint", "keepass", "bitwarden", "1password", "lastpass", "dashlane", "pingid", "dialer", "contacts", "photos", "gallery", "paypal", "revolut", "monzo",
  "capitec", "nedbank", "absa", "notification", "statusbar", "quicksettings", "bouncer",
];

/** Short words, matched only as the start of a name's parts (split at dots, case changes and symbols): "pay" matches Payments and paypal, not "display". */
export const DENY_TOKENS = ["pay", "otp", "sms", "mms", "lock", "2fa", "mfa", "totp"];

const tokens = (s) =>
  String(s ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Why a package or activity is off limits, or null. `name` is a package, an activity, or "package/activity".
 * The reason names a category, never the app.
 */
export function deniedWhy(name) {
  const s = String(name ?? "");
  if (!s) return null;
  const low = s.toLowerCase();
  const parts = low.split("/");
  if (parts.some((p) => DENY_PREFIXES.some((x) => p.startsWith(x)))) return "a banking, payment, password, authenticator, messaging, email, photo, lock screen, notification or system credential app or screen is on the deny list";
  if (DENY_WORDS.some((w) => low.includes(w))) return "its name matches the deny list (banking, payment, password, authentication, messaging, email, lock screen or notifications)";
  const t = tokens(s);
  if (DENY_TOKENS.some((w) => t.some((x) => x === w || x.startsWith(w)))) return "its name matches the deny list (payment, one-time code, SMS or lock screen)";
  return null;
}

// ---- Masking -----------------------------------------------------------------------------------------
const OTP_WORD = "(?:one[- ]?time|verification|security|login|sign[- ]?in|confirmation|authentication)?\\s*(?:code|otp|passcode|pin|token)";
const MASKS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, "[email]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[token]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[token]"],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|AKIA|ASIA|AIza|ya29)[A-Za-z0-9_.-]{12,}/g, "[token]"],
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
];

const digits = (s) => s.replace(/\D/g, "");

/** Replace one-time codes, email addresses, phone numbers, card-like digit runs and token-shaped strings. Returns {text, n}. */
export function mask(input) {
  let n = 0;
  let text = String(input ?? "");
  for (const [re, to] of MASKS) text = text.replace(re, () => (n++, to));
  // card-like runs: 13 to 19 digits, spaces or dashes between
  text = text.replace(/(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])/g, (m) => (digits(m).length >= 13 && digits(m).length <= 19 ? (n++, "[card]") : m));
  // phone numbers: 9 to 15 digits with the usual separators, not dates
  text = text.replace(/(?<![\w.])\+?\(?\d[\d ()\-.]{7,}\d(?![\w.])/g, (m) => {
    const d = digits(m).length;
    if (d < 9 || d > 15 || /^\d{4}-\d{2}-\d{2}/.test(m) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(m)) return m;
    n++;
    return "[phone]";
  });
  // one-time codes: 4 to 8 digits (a space or dash in the middle allowed) next to code, OTP, verification
  const after = new RegExp(`(\\b${OTP_WORD}\\b[^\\n\\d]{0,40})(\\d{3,4}[ -]?\\d{1,4}|\\d{4,8})\\b`, "gi");
  const before = new RegExp(`\\b(\\d{3,4}[ -]?\\d{1,4}|\\d{4,8})\\b([^\\n\\d]{0,40}\\b${OTP_WORD}\\b)`, "gi");
  text = text.replace(after, (_m, a) => (n++, `${a}[code]`)).replace(before, (_m, _d, b) => (n++, `[code]${b}`));
  return { text, n };
}

/** True for text that is only a short number: what a one-time code looks like when it sits in an element of its own. */
export const isBareCode = (s) => /^\s*\d{3,4}[ -]?\d{1,4}\s*$/.test(String(s ?? "")) && digits(s).length >= 4 && digits(s).length <= 8;
export const CODE_CONTEXT = /\b(code|otp|passcode|verification|one[- ]?time|authenticat|security code)\b/i;

// ---- The UI hierarchy ------------------------------------------------------------------------------------
const unescapeXml = (s) =>
  s.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The nodes of a uiautomator dump: [{text, desc, id, cls, pkg, clickable, editable, password, focused, checked, scrollable, bounds:[x1,y1,x2,y2], x, y}].
 * x and y are the centre in device pixels. Returns null when the text holds no hierarchy.
 */
export function parseHierarchy(xml) {
  if (!/<hierarchy\b/.test(xml)) return null;
  const out = [];
  const nodeRe = /<node((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml))) {
    const a = {};
    for (const [, k, v] of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[k] = unescapeXml(v);
    const b = (a.bounds ?? "").match(/\d+/g)?.map(Number);
    if (!b || b.length !== 4) continue;
    const cls = a.class ?? "";
    out.push({
      text: a.text ?? "", desc: a["content-desc"] ?? "", id: (a["resource-id"] ?? "").split("/").pop(), cls: cls.split(".").pop(), pkg: a.package ?? "",
      clickable: a.clickable === "true", editable: /EditText|AutoCompleteTextView|TextInputEditText/.test(cls) || a.editable === "true", password: a.password === "true",
      focused: a.focused === "true", checked: a.checked === "true", scrollable: a.scrollable === "true", bounds: b, x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2),
    });
  }
  return out;
}

/** A compact row for one element: centre, flags, text, id, class, bounds. */
export function rowOf(e) {
  const flags = [e.clickable && "C", e.editable && "E", e.password && "P", e.checked && "K", e.scrollable && "S", e.focused && "F"].filter(Boolean).join("");
  const label = e.password ? "[password field]" : e.text || e.desc;
  return `${e.x},${e.y} ${flags || "-"} ${JSON.stringify(String(label).slice(0, 70))}${e.id ? ` #${e.id}` : ""} ${e.cls} [${e.bounds.join(",")}]`;
}

// ---- dumpsys parsers ---------------------------------------------------------------------------------------
export function parseBattery(t) {
  const g = (k) => t.match(new RegExp(`^\\s*${k}: (.+)$`, "m"))?.[1].trim();
  const num = (k) => (g(k) != null && /^-?\d+$/.test(g(k)) ? Number(g(k)) : null);
  const status = { 1: "unknown", 2: "charging", 3: "discharging", 4: "not charging", 5: "full" }[num("status")] ?? null;
  const plugged = ["AC", "USB", "Wireless", "Dock"].filter((k) => g(`${k} powered`) === "true");
  const health = { 1: "unknown", 2: "good", 3: "overheat", 4: "dead", 5: "over voltage", 6: "failure", 7: "cold" }[num("health")] ?? null;
  return { level: num("level"), status, plugged, tempC: num("temperature") != null ? num("temperature") / 10 : null, health };
}

export function parseWakefulness(t) {
  const w = t.match(/mWakefulness=(\w+)/)?.[1];
  return w ? { wakefulness: w, screenOn: w === "Awake" } : { wakefulness: null, screenOn: null };
}

/** The focused window and app from `dumpsys window`: {package, activity, window, keyguard}. */
export function parseWindow(t) {
  const keyguard = /\b(mShowingLockscreen|isKeyguardShowing|mKeyguardShowing|keyguardShowing|mDreamingLockscreen)=true\b/.test(t);
  let m = t.match(/mCurrentFocus=Window\{[0-9a-f]+ u\d+ ([^}\s]+)(?: [^}]*)?\}/);
  let focus = m?.[1] ?? null;
  if (!focus) {
    m = t.match(/mFocusedApp=\S*ActivityRecord\{[0-9a-f]+ u\d+ ([^\s}]+)/);
    focus = m?.[1] ?? null;
  }
  if (!focus) return { package: null, activity: null, window: null, keyguard };
  const [pkg, act] = focus.includes("/") ? focus.split("/") : [null, null];
  const activity = act ? (act.startsWith(".") ? pkg + act : act) : null;
  return { package: pkg, activity, window: pkg ? null : focus, keyguard };
}

/** Sections `Package [name] (hash):` of `dumpsys package`: Map name -> {versionName, versionCode, firstInstall, lastUpdate, uid, debuggable, system, installer, requested, granted}. */
export function parsePackages(t) {
  const out = new Map();
  const parts = t.split(/^\s*Package \[([^\]]+)\] \([0-9a-f]+\):\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const body = parts[i + 1].split(/^\S/m)[0].split(/^ {2}Package \[/m)[0];
    const g = (re) => {
      const v = body.match(re)?.[1]?.trim();
      return v && v !== "null" ? v : null;
    };
    const flags = g(/^\s*(?:pkgFlags|flags)=\[([^\]]*)\]/m) ?? "";
    const reqBlock = body.match(/^\s*requested permissions:\n((?:\s{6,}\S.*\n?)*)/m)?.[1] ?? "";
    out.set(name, {
      versionName: g(/^\s*versionName=(.*)$/m), versionCode: Number(g(/^\s*versionCode=(\d+)/m)) || null, firstInstall: g(/^\s*firstInstallTime=(.*)$/m), lastUpdate: g(/^\s*lastUpdateTime=(.*)$/m),
      uid: g(/^\s*(?:userId|appId)=(\d+)/m), debuggable: /\bDEBUGGABLE\b/.test(flags), system: /\bSYSTEM\b/.test(flags), installer: g(/^\s*installerPackageName=(.*)$/m),
      requested: reqBlock ? reqBlock.split("\n").filter((l) => l.trim()).length : 0, granted: (body.match(/granted=true/g) ?? []).length,
    });
  }
  return out;
}

// ---- logcat ------------------------------------------------------------------------------------------------------
const LEVELS = "VDIWEFS";
/** threadtime lines: [{time, pid, level, tag, text}]. Lines that do not parse (headers, continuation) are dropped. */
export function parseLogcat(t) {
  const rows = [];
  for (const l of t.split("\n")) {
    const m = l.match(/^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?)\s*: ?(.*)$/);
    if (m) rows.push({ time: m[1], pid: Number(m[2]), level: m[4], tag: m[5], text: m[6] });
  }
  return rows;
}
export const levelAtLeast = (l, min) => LEVELS.indexOf(l) >= LEVELS.indexOf(min) && l !== "S";

/** Same message, any digits: one row with a count. */
export function dedupe(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.level}|${r.tag}|${r.text.replace(/\d{3,}/g, "#")}`;
    const e = by.get(key);
    if (e) {
      e.count++;
      e.last = r.time;
    } else by.set(key, { time: r.time, last: r.time, level: r.level, tag: r.tag, text: r.text, count: 1 });
  }
  return [...by.values()];
}

/** The newest crash or ANR in parsed rows that mention the package: {kind, time, summary, lines}. */
export function lastCrash(rows, pkg) {
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fatal = r.tag === "AndroidRuntime" && /FATAL EXCEPTION/.test(r.text);
    const anr = /\bANR in /.test(r.text) && r.text.includes(pkg);
    const native = /Fatal signal/.test(r.text) && (r.tag === "libc" || r.tag === "DEBUG");
    if (!fatal && !anr && !native) continue;
    const block = [r];
    for (let j = i + 1; j < rows.length && block.length < 14 && rows[j].pid === r.pid && (rows[j].tag === r.tag || anr); j++) block.push(rows[j]);
    const joined = block.map((x) => x.text).join("\n");
    if (!joined.includes(pkg) && !(native && block.some((x) => x.text.includes(pkg)))) {
      // a java crash names its process on the second line; others name it nowhere in the block
      if (!anr) continue;
    }
    const exception = block.map((x) => x.text).find((x) => /^[\w.$]+(Exception|Error)\b/.test(x)) ?? block[1]?.text ?? r.text;
    best = { kind: anr ? "anr" : native ? "native" : "java", time: r.time, summary: mask(exception).text.slice(0, 200), lines: block.slice(0, 10).map((x) => mask(x.text).text.slice(0, 200)) };
  }
  return best;
}

/** A regex from text the investigator wrote: a bad pattern is taken literally. */
export function rx(s) {
  try {
    return new RegExp(s, "i");
  } catch {
    return new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}
