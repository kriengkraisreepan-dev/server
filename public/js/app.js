// =============================
// Lucky Snooker Manager v0.3
// =============================

// ตั้งค่าระบบ

// รายได้วันนี้
let todayIncome = 0;

// สร้างโต๊ะตามจำนวนที่ตั้งไว้
const tables = [];

for (let i = 1; i <= settings.tableCount; i++) {
    tables.push({

    id: i,

    code: `T${String(i).padStart(2, "0")}`,

    name: `โต๊ะ ${i}`,

    relay: i,

    status: "ว่าง",

    customer: null,

    startTime: null,

    elapsedSeconds: 0,

    currentPrice: 0

});
}

// แปลงวินาทีเป็น HH:MM:SS
function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");

    return `${h}:${m}:${s}`;
}

// แสดงโต๊ะทั้งหมด
function renderTables() {

    const container = document.getElementById("tables");

    container.innerHTML = "";

    tables.forEach(table => {

        const card = document.createElement("div");
        card.className =
    table.status === "กำลังเล่น"
        ? "table playing"
        : "table free";

        let startText = "-";

        if (table.startTime) {
            startText = table.startTime.toLocaleTimeString();
        }

        card.innerHTML = `
            <h2>🎱 ${table.name}</h2>

            <p>
    <strong>สถานะ :</strong>
    <span class="status ${
        table.status === "กำลังเล่น"
            ? "playing"
            : "free"
    }">
        ${
            table.status === "กำลังเล่น"
                ? "🟢 กำลังเล่น"
                : "🔴 ว่าง"
        }
    </span>
</p>

            <p><strong>เริ่มเล่น :</strong> ${startText}</p>

            <p><strong>เวลา :</strong> ${formatTime(table.elapsedSeconds)}</p>

            <p><strong>ยอดเงิน :</strong> ${table.currentPrice.toFixed(2)} บาท</p>

            <button class="table-btn">
                ${table.status === "ว่าง" ? "เปิดโต๊ะ" : "ปิดโต๊ะ"}
            </button>
        `;

        const btn=card.querySelector(".table-btn");
        btn.addEventListener("click",()=>toggleTable(table.id));

        container.appendChild(card);

    });

    document.getElementById("income").textContent =
    todayIncome.toFixed(2) + " บาท";

// Dashboard
document.getElementById("totalTables").textContent =
    tables.length;

document.getElementById("playingTables").textContent =
    tables.filter(t => t.status === "กำลังเล่น").length;

document.getElementById("freeTables").textContent =
    tables.filter(t => t.status === "ว่าง").length;
}
// =============================
// ระบบหน้าต่างตั้งค่า
// =============================

const settingsModal = document.getElementById("settingsModal");

const settingButton = document.getElementById("settingButton");

const closeSettings = document.getElementById("closeSettings");

const saveSettings = document.getElementById("saveSettings");

settingButton.addEventListener("click", () => {

    document.getElementById("hourlyRateInput").value =
        settings.hourlyRate;

    document.getElementById("minimumChargeInput").value =
        settings.minimumCharge;

    settingsModal.style.display = "flex";

});

closeSettings.addEventListener("click", () => {

    settingsModal.style.display = "none";

});

saveSettings.addEventListener("click", () => {

    settings.hourlyRate =
        Number(document.getElementById("hourlyRateInput").value);

    settings.minimumCharge =
        Number(document.getElementById("minimumChargeInput").value);

    // อัปเดตกล่อง "อัตราค่าบริการ"
    document.querySelector(".summary .card:nth-child(2) h2").textContent =
        settings.hourlyRate + " บาท/ชั่วโมง";

    document.querySelector(".summary .card:nth-child(2) small").textContent =
        "ขั้นต่ำ " + settings.minimumCharge + " บาท";

    // คำนวณราคาใหม่ของโต๊ะที่กำลังเล่น
    tables.forEach(table => {

        if (table.status === "กำลังเล่น") {

            table.currentPrice =
                calculatePrice(table.elapsedSeconds);

        }

    });

    renderTables();

    settingsModal.style.display = "none";

});

// เปิด/ปิดโต๊ะ
function toggleTable(id) {

    const table = tables.find(t => t.id === id);

    if (table.status === "ว่าง") {

        table.status = "กำลังเล่น";
        table.startTime = new Date();
        table.elapsedSeconds = 0;
        table.currentPrice = settings.minimumCharge;

    } else {

        todayIncome += table.currentPrice;

        table.status = "ว่าง";
        table.startTime = null;
        table.elapsedSeconds = 0;
        table.currentPrice = 0;

    }

    renderTables();

}

// เริ่มต้นโปรแกรม
renderTables();

startTimer();