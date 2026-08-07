# 88 Snooker Manager

## Start

Run `npm start`, then open http://localhost:3000. On its first run the app creates `data/store.json` for local data storage.

## ESP32 relay

Set `ESP32_BASE_URL` before starting the server, for example `http://192.168.1.50`. The server sends:

`GET /relay/{channel}?state=on|off`

where the channel is configured per table. The UI records a requested relay state even when a device is not configured.

## QR payments

The checkout workflow creates a unique payment reference and keeps the table open until staff confirm payment. Connect the QR payload/image generation and bank callback of the chosen payment provider before accepting unattended payments.
