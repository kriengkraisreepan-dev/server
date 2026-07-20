const express = require("express");
const path = require("path");

const app = express();

const PORT = 3000;

// ให้ Express เปิดโฟลเดอร์ public
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});