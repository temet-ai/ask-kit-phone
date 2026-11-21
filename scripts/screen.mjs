export const meta = {
  purpose:
    "The elements on the phone's screen now, as compact rows: centre x,y in device pixels, flags (C clickable, E text field, P password field, K checked, S scrollable, F focused), text or description, #resource-id, class and bounds. Use it to find a button or read a screen before tapping, and again after a tap to see that the screen changed. Requires the app (`app`) or what to look for (`find`); with find only the matching elements come back. Refuses, and reads nothing, when the foreground app or screen is on the deny list (banking, payment, passwords, authenticators, messaging, email, photos, lock screen, notifications, system credential and permission dialogs), when a denied app has a window on the screen, or when the screen is off. Codes, emails, phone numbers and card numbers in the text are masked; password fields have no text. Text only, never an image.",
  params: {
    app: "the app the question is about: a package name or a word in it. If another app is in the foreground nothing is read and the result says which one",
    find: "regex on element text, description or id; only matching elements are returned",
    max: "most rows, default 80; `cut` says how many were left out",
  },
  returns: "{package, activity, count, total, shown, cut?, droppedSystemUi?, passwordFields, masked?, rows:['x,y FLAGS \"text\" #id Class [x1,y1,x2,y2]'], elements:[{text,desc,id,cls,x,y,bounds,clickable,editable,password,focused}]} or {mismatch:true, package, wanted, note}",
  example: 'await scripts.run("screen", { app: "settings", find: "wi-?fi" })',
};

export default async function ({ phone }, p = {}) {
  const r = await phone.screen({ app: p.app, find: p.find, max: p.max });
  // the rows carry everything the elements do; sending both would double the size
  const { elements, ...rest } = r;
  return rest;
}
