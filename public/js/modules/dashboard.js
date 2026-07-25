// =============================
// Dashboard Module
// =============================

function updateDashboard(tables, todayIncome) {

    document.getElementById("income").textContent =
        todayIncome.toFixed(2) + " บาท";

    document.getElementById("totalTables").textContent =
        tables.length;

    document.getElementById("playingTables").textContent =
        tables.filter(t => t.status === "กำลังเล่น").length;

    document.getElementById("freeTables").textContent =
        tables.filter(t => t.status === "ว่าง").length;

}