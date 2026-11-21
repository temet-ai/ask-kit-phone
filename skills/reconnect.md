Get the phone connected over adb

1. `await scripts.run("status")`. If `connected` is true, say so and stop.
2. Read `devices` and `why`. `unauthorized`: the person has to accept the debugging prompt on the phone. `offline`: `await phone.connect()` once. No device: go on.
3. `await scripts.run("status", { connect: true })` makes one bounded attempt over the network: it connects to `PHONE_SERIAL` when that is a host:port, otherwise to the address the phone announces for wireless debugging. If it connects, report the model and battery from the result.
4. If it fails ("no phone announces wireless debugging", or adb cannot connect): wireless debugging is off, or the phone is on another network. The phone has to be on the same Wi-Fi as this computer, and the person turns on Settings > Developer options > Wireless debugging (it switches off when the phone restarts or changes Wi-Fi). Say that, and stop. Do not try more addresses, do not run `adb connect` yourself, and do not retry in a loop.
5. If the failure says this computer is not paired, or no wireless debugging address is known: the person pairs once with `adb pair <address:port>` and the code shown under Wireless debugging > Pair device with pairing code, or plugs the phone in by USB with USB debugging on. Both need the person at the phone.
6. If several devices are listed and the wrong one is used, the `PHONE_SERIAL` setting names the right one (a serial from `adb devices`).
7. The answer: connected or not, the reason, and the one thing the person has to do.
