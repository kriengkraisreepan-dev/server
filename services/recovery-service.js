class RecoveryService {
  constructor({ store, deposits, settlement, clock = () => new Date(), staleLockMinutes = 30, audit = () => {} }) {
    Object.assign(this, { store, deposits, settlement, clock, staleLockMinutes, audit });
  }
  run() {
    const actions = [], pending = [], now = this.clock().getTime();
    for (const deposit of this.deposits.list().filter(item => item.status === "LOCKED")) {
      const bill = (this.store().bills || []).find(item => item.depositId === deposit.id);
      if (bill?.status === "paid") {
        try {
          this.settlement.settle(deposit.id, bill, "SYSTEM_RECOVERY", deposit.version, deposit.lockToken);
          actions.push({ code: "LOCKED_DEPOSIT_SETTLED", depositId: deposit.id, billId: bill.id });
        } catch (error) {
          pending.push({ code: "LOCKED_DEPOSIT_SETTLEMENT_REVIEW", depositId: deposit.id, billId: bill.id, detail: error.code || error.message });
        }
        continue;
      }
      const ageMinutes = deposit.lockedAt ? (now - new Date(deposit.lockedAt).getTime()) / 60000 : Infinity;
      const hasCheckoutEvidence = Boolean(bill || deposit.settlementAttemptId);
      if (!hasCheckoutEvidence && ageMinutes >= this.staleLockMinutes) {
        try {
          this.settlement.unlock(deposit.id, "SYSTEM_RECOVERY", deposit.version, deposit.lockToken);
          actions.push({ code: "STALE_DEPOSIT_UNLOCKED", depositId: deposit.id });
        } catch (error) {
          pending.push({ code: "STALE_DEPOSIT_UNLOCK_REVIEW", depositId: deposit.id, detail: error.code || error.message });
        }
      } else pending.push({ code: "LOCKED_DEPOSIT_REVIEW", depositId: deposit.id, billId: bill?.id || null });
    }
    for (const action of actions) this.audit("RECOVERY_ACTION", "SYSTEM_RECOVERY", action);
    return { ranAt: new Date(now).toISOString(), actions, pending };
  }
}

module.exports = { RecoveryService };
