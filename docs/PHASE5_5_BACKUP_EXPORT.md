# Phase 5.5 Backup Export — Revision 2

Renderer has no filesystem access and does not use `window.open()` for backups. It sends one validated backup filename through the fixed preload method. Renderer cannot send a source path or destination path.

Electron Main owns `dialog.showSaveDialog`, source resolution, validation, atomic copy, and destination verification. Unsafe names, absolute/UNC paths, traversal, ADS, links, invalid JSON, invalid checksums, and portable secret fields are rejected. Destination paths inside Customer Data are rejected. Errors shown to the operator are Thai messages without raw exceptions.
