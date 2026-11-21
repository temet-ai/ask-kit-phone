Find something on the phone's screen and tap it, then confirm the screen changed

1. Check the phone is there: `await scripts.run("status")`. If `connected` is false, report `why` and `reconnect` and stop.
2. Look at the target app: `await scripts.run("screen", { app: "<package or word>", find: "<text, description or id of the element>" })`. A refusal (denied app, lock screen, screen off) is final: report it and stop. `mismatch: true` means another app is in front: opening the right one needs act (`skills.read("open-app")`).
3. Pick the element from `rows`. Prefer one with C (clickable) whose text or `#id` matches exactly. If several match, take the one the request describes (the nearest to a label, the one in the right section) and say which. If none match, scroll with `await phone.swipe(540, 1800, 540, 700)` (swiping up moves the page down), read again, and stop after three scrolls.
4. Tap its centre: `await phone.tap(x, y)` with the x and y from the row. The result says which app was in front and which is now.
5. Read again with the same `screen` call, with a `find` for what the next screen should show. Check it changed: a new title, a new element, a changed state (K). If it did not change, say so; do not tap again at the same point more than once.
6. The answer: what you tapped (its text or id, never an invented label), the app before and after, and what the screen shows now.
