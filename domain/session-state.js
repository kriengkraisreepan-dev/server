const STATES = Object.freeze({ AVAILABLE: "AVAILABLE", ACTIVE: "ACTIVE", PAUSED: "PAUSED", AWAITING_PAYMENT: "AWAITING_PAYMENT", CLOSED: "CLOSED", CANCELLED: "CANCELLED" });
const transitions = Object.freeze({ AVAILABLE: ["OPEN"], ACTIVE: ["PAUSE", "AWAIT_PAYMENT", "CANCEL"], PAUSED: ["RESUME", "AWAIT_PAYMENT", "CANCEL"], AWAITING_PAYMENT: ["CLOSE", "CANCEL"], CLOSED: [], CANCELLED: [] });
function nextState(current, action) { if (!transitions[current]?.includes(action)) throw new Error(`Invalid session transition: ${current} -> ${action}`); return ({ OPEN: STATES.ACTIVE, PAUSE: STATES.PAUSED, RESUME: STATES.ACTIVE, AWAIT_PAYMENT: STATES.AWAITING_PAYMENT, CLOSE: STATES.CLOSED, CANCEL: STATES.CANCELLED })[action]; }
function isOpenState(state) { return state === STATES.ACTIVE || state === STATES.PAUSED || state === STATES.AWAITING_PAYMENT; }
module.exports = { STATES, transitions, nextState, isOpenState };
