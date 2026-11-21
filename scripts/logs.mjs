export const meta = {
  purpose:
    "Recent error and crash lines of one app from logcat -d (a dump, never a follow), filtered to the package's uid, deduplicated with a count, text masked, capped. Also the app's last crash (Java exception, native signal) or ANR with its first stack lines. Refuses packages on the deny list. Use it after an app was run or tested, to see what failed.",
  params: { package: "the full package name", level: "E (errors, default) or W (warnings too)", max: "most distinct lines, default 30", lines: "how many log lines to scan, 100 to 3000, default 2000" },
  returns: "{package, uid, level, scanned, matched, cut?, lastCrash:{kind,time,summary,lines}|null, lines:[{time,last,level,tag,text,count}]}",
  example: 'await scripts.run("logs", { package: "com.example.app" })',
};

export default async function ({ phone }, p = {}) {
  if (!p.package) throw new Error("pass package: the full package name");
  return phone.logs(String(p.package), { level: p.level, max: p.max, lines: p.lines });
}
