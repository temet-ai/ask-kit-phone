export const meta = {
  purpose:
    "One package on the phone: installed or not, version name and code, first install and last update, installer, whether it is a debuggable build, whether it is running now and in the foreground, how many permissions it declares and how many are granted, and its last crash or ANR from logcat. The crash is read only for a debuggable build (an app the session is developing) or with `crash: true`, and never for a package on the deny list. Use it for 'is my build installed, which version, what was its last crash'.",
  params: { package: "the full package name, e.g. com.example.app", crash: "true: read the last crash of a release build too" },
  returns: "{package, installed, versionName?, versionCode?, firstInstall?, lastUpdate?, debuggable?, system?, installer?, running?, foreground?, permissions?:{requested,granted}, crash?:{kind:'java'|'native'|'anr', time, summary, lines}|null|'not read: why'}",
  example: 'await scripts.run("app", { package: "com.example.app" })',
};

export default async function ({ phone }, p = {}) {
  if (!p.package) throw new Error("pass package: the full package name; scripts.run('apps', {filter}) finds it");
  return phone.app(String(p.package), { crash: p.crash === true || p.crash === "true" });
}
