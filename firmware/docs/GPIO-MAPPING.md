# GPIO Mapping — Lucky Hardware Standard v1.0

| Channel | ESP32 GPIO | Active when | OFF level | Available on board size |
|---:|---:|---|---|---|
| 1 | 13 | LOW | HIGH | 2, 4, 8 |
| 2 | 14 | LOW | HIGH | 2, 4, 8 |
| 3 | 16 | LOW | HIGH | 4, 8 |
| 4 | 17 | LOW | HIGH | 4, 8 |
| 5 | 18 | LOW | HIGH | 8 |
| 6 | 19 | LOW | HIGH | 8 |
| 7 | 25 | LOW | HIGH | 8 |
| 8 | 26 | LOW | HIGH | 8 |

Every pin is configured OUTPUT and written HIGH during the first safe-boot stage, regardless of configured relay count. Channels above `relayCount` remain HIGH and cannot be addressed by the API.

The mapping is architecture locked. Do not substitute boot-strapping pins or create board-size-specific mappings.
