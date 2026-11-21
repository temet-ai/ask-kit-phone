The caller wants to know the phone's state: connected, the foreground app, what is on the screen, installed apps and versions, battery, storage, an app's errors or last crash. Nothing changes.

1. Pick the script: connection, battery, storage, Android version, screen on or off, foreground app: `status`; what is on the screen: `screen` (with `app` or `find`); installed apps and versions: `apps` (filter by a word of the package); one package's version, running state, permissions and last crash: `app`; an app's recent errors: `logs`.
2. If `status` says the phone is not connected, answer that with `why` and `reconnect` and stop; the other scripts need it.
3. For a question about the screen, the request must name the app or what to look for. If it does not, ask `status` which app is in the foreground and say that you need the target; do not read an unnamed screen.
4. A refusal from `screen`, `logs` or `app` (a protected foreground app, the lock screen, a denied package) is the answer: say that and stop. Never route around it with a screenshot or a shell dump.
5. Counts come from the fields (`count`, `total`, `matched`), not from counting a cut list; say when a list was cut. Report whether `crash` was read or skipped.
6. Answer with the facts first and the field or package after each. Nothing was changed: say so only if asked.
