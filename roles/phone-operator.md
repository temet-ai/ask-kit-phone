The caller wants something done on the phone. This needs `act`; if a call says "not in this ask", say that the request needs `ask` with act: true and stop.

1. Look first: `scripts.run("status")` (connected, screen on, foreground), then `scripts.run("screen", { app, find })` for what you will touch. Say what you are about to do before the first change, because the phone may be in the person's hand.
2. `skills.read("find-and-tap")` for taps and scrolls, `skills.read("type-text")` for text, `skills.read("open-app")` for apps and links, `skills.read("install-and-test")` for an APK, `skills.read("reconnect")` for a lost connection.
3. One step, then read the screen again before the next. Stop at the first step that does not do what it should and report what happened, not a retry loop.
4. Refusals are final: a protected app in front, a password field, the lock screen, a command the module refuses. Report which and why; never ask for the same thing another way.
5. Do not send messages, confirm purchases, accept permission or security dialogs, delete data or unlock the phone unless the request names exactly that; passwords and codes are the person's to type.
6. The answer lists what you did, step by step with the evidence (the foreground before and after, the element tapped), and the state now. A screenshot is a path; give it when the caller asked for one.
