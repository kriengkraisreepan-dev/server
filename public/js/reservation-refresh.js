(function attachReservationRefresh(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ReservationRefresh = api;
})(typeof window !== "undefined" ? window : globalThis, function reservationRefreshFactory() {
  function patchReservationLiveContent(documentRef, nextHtml) {
    const form = documentRef.querySelector("#reservationForm");
    const liveContent = documentRef.querySelector("#reservationLiveContent");
    if (!form || !liveContent) return false;
    liveContent.innerHTML = nextHtml;
    return true;
  }

  return { patchReservationLiveContent };
});
