export const meta = {
  purpose:
    "Is the phone connected, and how: adb's device list, then (when connected) model, Android version and patch level, battery level, charging state and temperature, storage used and free, whether the screen is on, and the foreground app and activity. When it is not connected it says why and gives the command that reconnects. Never reads the screen; a foreground app on the deny list (banking, messaging, passwords, lock screen) is reported as denied without its name.",
  params: { connect: "true: try one wireless connect (45 seconds at most) when no device is listed; default false" },
  returns: "{connected, serial?, transport?, model?, android?, sdk?, securityPatch?, battery?:{level,status,plugged,tempC,health}, storage?:{totalGB,usedGB,freeGB,usedPct}, screen?:'on'|'off', foreground?:{package,activity}|{denied}, devices?, why?, reconnect?}",
  example: 'await scripts.run("status")',
};

export default async function ({ phone }, p = {}) {
  return phone.status({ connect: p.connect === true || p.connect === "true" });
}
