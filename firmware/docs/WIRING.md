# Wiring

> Mains wiring can cause fire, electric shock, equipment damage, or death. A qualified electrician must install and inspect all mains-voltage wiring. Firmware testing does not certify electrical safety.

## Logic-side wiring

### Physical Setup Button (acceptance pending)

For the approved ESP32 38-pin / ESP-32D board, wire `3.3V → 10kΩ → GPIO34 → momentary NO button → GND`. GPIO34 is input-only and has no internal pull-up; firmware must use `pinMode(34, INPUT)`. Never connect it to 5V, EN, or BOOT/GPIO0. The feature remains disabled by default until the physical circuit passes acceptance.

- ESP32 GPIOs connect to relay-board input channels according to `GPIO-MAPPING.md`.
- Connect a common logic ground only when required by the selected isolated relay module design.
- Use a regulated supply sized for the ESP32 and the maximum number of energized relay coils.
- The relay board is active LOW. Confirm HIGH means OFF before connecting any load.
- Prefer optocoupler-isolated modules with documented input voltage/current.
- Do not power relay coils from the ESP32 3.3 V pin.

## Relay contacts

- Use COM/NO/NC contacts according to the club's fail-safe lighting policy.
- Fit correctly rated breaker/fuse, wire gauge, enclosure, terminals, strain relief, and earth bonding.
- Keep mains and low-voltage wiring physically separated.
- Label every relay channel with table number, GPIO, circuit, and breaker.

## Commissioning sequence

1. Leave mains loads disconnected.
2. Verify supply voltage and polarity.
3. Flash firmware and capture safe boot.
4. Confirm all eight logic outputs remain HIGH/OFF.
5. Configure relay count and test only active channels.
6. Confirm disabled channels remain OFF.
7. Test API authentication and all-off command.
8. Connect one mains circuit at a time under electrician supervision.
9. Test power loss, ESP32 restart, Wi-Fi loss, and watchdog restart.

## Recommended deployment

- DIN-rail or ventilated flame-retardant enclosure
- labelled ESP32 and relay board
- regulated PSU with protection
- UPS-backed network/controller supply where operationally appropriate
- fixed Ethernet/Wi-Fi infrastructure with reserved IP
- accessible physical master isolation switch
