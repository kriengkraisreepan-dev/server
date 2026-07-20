// =============================
// Billing Module
// =============================

function calculatePrice(seconds) {

    const price =
        (seconds / 3600) * settings.hourlyRate;

    return Math.max(
        settings.minimumCharge,
        price
    );

}