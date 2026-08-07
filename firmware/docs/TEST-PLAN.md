# Test Plan

## Automated native tests

Run:

```bash
pio test -e native
```

Coverage:

- default relay count is 8;
- 2, 4, and 8 accepted;
- 1, 3, 6, and 16 rejected;
- corrupt count safely resolves to 8;
- all eight pins configure as outputs and start HIGH;
- 2-channel board accepts 1–2, rejects 3, keeps 3–8 HIGH;
- 4-channel board accepts 1–4, rejects 5, keeps 5–8 HIGH;
- 8-channel board accepts 1–8 and rejects 9;
- shrinking 8→2 first turns every pin OFF.

## Build verification

```bash
pio run -e esp32dev
```

Warnings must be reviewed. Flash only the resulting ESP32 environment image, never the native-test binary.

## Embedded API tests

For each relay count 2, 4, and 8:

1. Boot with relay inputs disconnected from mains loads.
2. Confirm all eight GPIO pins HIGH using a meter/logic analyzer.
3. Verify GET relay list length equals configured count.
4. Verify device and health return configured count.
5. Verify missing and invalid key return 401 for every POST.
6. Verify unsupported counts return 400.
7. Verify channel 0, configured count + 1, and 9 cannot change GPIO.
8. Verify the first unavailable positive channel returns 404.
9. Toggle every active channel ON/OFF and compare physical output.
10. Change count at runtime and confirm all eight pins go HIGH before response.
11. Power-cycle and verify the count persisted.
12. Corrupt NVS relay count with a service fixture; verify fallback warning, value 8, and no relay pulse.

## Safe-boot instrumentation

Use an eight-channel logic analyzer or oscilloscope. Capture GPIO 13/14/16/17/18/19/25/26 from reset through API readiness. Acceptance requires no LOW pulse on any channel.

## Watchdog

Use a temporary test-only build that deliberately stops feeding the watchdog after API startup. Confirm reset occurs and the safe-boot capture again contains no LOW pulse. Remove the injection before production build.

## API contract matrix

- relay list count: 2/4/8
- invalid relay: 404 standard error
- config POST auth: 401 without valid key
- unsupported count: 400
- valid count persists across power cycle
- config change turns all relays OFF
- device/health reflect the new count
- malformed JSON: 400
- unknown route: 404

## Production acceptance

Record board serial, firmware hash, relay board size, supply voltage, Wi-Fi RSSI, test operator, date, and evidence capture. Physical electrical and safe-boot tests cannot be replaced by native tests.
