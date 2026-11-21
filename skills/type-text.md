Type text into a field on the phone

1. `await scripts.run("screen", { app: "<app>", find: "." })` and look for the field: flag E. A row with P is a password field: stop, passwords and codes are the person's to type. The kit refuses it anyway.
2. Tap the field with `await phone.tap(x, y)` so it has focus, then read again with `screen` and check that the field now has F.
3. Type with `await phone.type("<text>")`: printable ASCII, one line, up to 500 characters. For a line break, use `await phone.key("enter")` after it. For text with other characters, say that this kit cannot type it.
4. Read the field again with `screen` (find: its id) and check the text arrived. Spaces and symbols can come out wrong in some apps; say what the field shows.
5. Do not press send, search or submit unless the request says so. Pressing `enter` in a search field is submitting.
