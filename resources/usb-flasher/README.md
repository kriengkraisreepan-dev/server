# Approved release assets only

This directory is intentionally incomplete in source control. Production binaries and `manifest.json` must come from the reviewed offline release-signing process. Never commit a private signing key, real Device Key, Setup Code, Wi-Fi credential, or generated per-device NVS image.

The backend fails closed while these approved assets are absent.
