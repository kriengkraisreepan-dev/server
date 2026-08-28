// How far back a member's point trail is read when nobody asked for a date range. Longer than the
// three months the bill and audit screens default to, because this is what gets opened when a
// customer questions their balance, and a balance argument is rarely about last week.
const DEFAULT_POINT_HISTORY_MONTHS = 12;

// The member list itself stays in store.json: it is looked up on nearly every request and grows
// with the customer base rather than with transactions. The point ledger does grow per transaction,
// so it lives in month files — see infrastructure/history-store.js, and MemberService's
// pointBatches/pointsDueTotal/pointsExpiredTotal, which is what let expiry stop scanning it.
class JsonMemberRepository {
  constructor({ getStore, save, history = null }) { this.getStore=getStore; this.save=save; this.history=history; }
  members(){const s=this.getStore();if(!Array.isArray(s.members))s.members=[];return s.members;}
  points(){const s=this.getStore();if(!Array.isArray(s.memberPointTransactions))s.memberPointTransactions=[];return s.memberPointTransactions;}
  findById(id){return this.members().find(m=>m.id===id)||null;}
  saveMember(member){const a=this.members(),i=a.findIndex(m=>m.id===member.id);if(i<0)a.unshift(member);else a[i]=member;this.save();return member;}
  addPoint(tx){this.points().unshift(tx);this.save();return tx;}

  // One member's transactions, newest first, across the working set and the archive.
  pointsForMember(memberId, { from = "", to = "", months = DEFAULT_POINT_HISTORY_MONTHS } = {}) {
    const mine = tx => tx.memberId === memberId;
    const hot = this.points().filter(mine);
    if (!this.history) return hot;
    const archived = (from || to
      ? this.history.inRange("memberPointTransactions", from || null, to || null)
      : this.history.recent("memberPointTransactions", months)).filter(mine);
    const seen = new Set(hot.map(tx => tx.id));
    return [...hot, ...archived.filter(tx => !seen.has(tx.id))]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  // Every member's transactions in a date range — the reporting view.
  pointsInRange(fromDay, toDay) {
    return this.history ? this.history.inRange("memberPointTransactions", fromDay, toDay) : this.points();
  }
}
module.exports={JsonMemberRepository, DEFAULT_POINT_HISTORY_MONTHS};
