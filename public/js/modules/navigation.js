// =============================
// Navigation Module
// =============================

function showComingSoon(title) {

    const tables = document.getElementById("tables");

    tables.innerHTML = `
        <div class="card">
            <h2>${title}</h2>
            <p>🚧 อยู่ระหว่างการพัฒนา</p>
        </div>
    `;

}