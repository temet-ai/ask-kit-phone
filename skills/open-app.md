Open an app or a deep link on the phone and wait until it is in front

1. `await scripts.run("status")`. Stop with the reconnect line if it is not connected. If `screen` is "off", `await phone.wake()` first (act); if the foreground says denied or the lock screen shows, say that the person has to unlock the phone and stop.
2. Find the package if the request gives only a name: `await scripts.run("apps", { filter: "<word>" })`. More than one match: say which you chose.
3. `await phone.open("<package or word>")`, or for a link `await phone.open("scheme://path")`. tel:, sms:, mailto: and content: links are refused. Opening an app does not read it.
4. The result has `now`: the foreground after 0.7 seconds. If it is not the app yet, wait and look again with `await phone.foreground()` up to four times (about two seconds apart); a cold start of a large app takes several seconds.
5. If the foreground is a denied app after opening, say that it is open and that its screen is not readable here.
6. The answer: which package is in front, and the activity.
