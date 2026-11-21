export const meta = {
  purpose:
    "Installed apps on the phone, third-party only unless `all`: package, versionCode, and, for 15 or fewer matches, versionName, first install, last update and whether it is a debuggable build. Use a filter (part of a package name) to ask about one app or one developer's apps.",
  params: { filter: "part of a package name (letters, digits, dots, underscores)", all: "true: include system packages", max: "most apps, default 60" },
  returns: "{total, shown, cut?, detailed, note?, apps:[{package, versionCode, versionName?, firstInstall?, lastUpdate?, debuggable?}]}",
  example: 'await scripts.run("apps", { filter: "example" })',
};

export default async function ({ phone }, p = {}) {
  return phone.apps({ filter: p.filter, all: p.all === true || p.all === "true", max: p.max });
}
