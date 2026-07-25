const { importJsonStore } = require("../json-importer");

// Future routes/IPC call this service, not repositories or SQLite directly.
function planJsonImport(sourcePath, targetPath) { return importJsonStore({ sourcePath, targetPath, dryRun: true }); }
function runJsonImport(sourcePath, targetPath) { return importJsonStore({ sourcePath, targetPath, dryRun: false }); }
module.exports = { planJsonImport, runJsonImport };
