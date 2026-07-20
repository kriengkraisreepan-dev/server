// =============================
// Timer Module
// =============================

function startTimer() {

    setInterval(() => {

        tables.forEach(table => {

            if (table.status === "กำลังเล่น") {

                table.elapsedSeconds++;

                table.currentPrice =
                    calculatePrice(table.elapsedSeconds);

            }

        });

        renderTables();

    }, 1000);

}