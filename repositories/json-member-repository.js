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

  // One line per member whose full record has been moved to a month file after three years without
  // a visit: id, code, phone, email, name and points. Everything the shop still needs them for
  // while they are away — refusing a duplicate code or phone, and counting their points as owed.
  archivedIndex(){const s=this.getStore();if(!Array.isArray(s.archivedMembers))s.archivedMembers=[];return s.archivedMembers;}
  archivedEntry(id){return this.archivedIndex().find(entry=>entry.id===id)||null;}
  // Points held by members who are not in the working set, so the outstanding-points figure stays
  // whole. They are still owed to a customer who could walk back in tomorrow.
  archivedPoints(){return this.archivedIndex().reduce((sum,entry)=>sum+Number(entry.points||0),0);}

  // Reads do not resurrect anyone: a three-year-old bill being looked at should not quietly rewrite
  // the member list. Coming back is a write (see saveMember) or a deliberate search (restoreMatching).
  findById(id){
    const hot=this.members().find(m=>m.id===id);
    if(hot||!this.history)return hot||null;
    if(!this.archivedEntry(id))return null;
    return this.history.findById("members",id).record;
  }

  // Any write about a member puts them back in the working set — earning points, a profile edit,
  // opening a table. That is what "they are a customer again" actually looks like.
  saveMember(member){
    const a=this.members(),i=a.findIndex(m=>m.id===member.id);
    if(i<0){a.unshift(member);this.forgetArchived(member.id);}else a[i]=member;
    this.save();return member;
  }
  forgetArchived(id){
    const index=this.archivedIndex();
    const at=index.findIndex(entry=>entry.id===id);
    if(at>=0)index.splice(at,1);
  }

  // Staff searching for someone means they are about to serve them, so a match on the index pulls
  // the whole record back rather than showing a half-populated row.
  restoreMatching(text){
    if(!this.history||!text)return [];
    const needle=String(text).trim().toLowerCase();
    if(!needle)return [];
    const matches=this.archivedIndex().filter(entry=>[entry.memberCode,entry.displayName,entry.phone,entry.email].some(value=>String(value||"").toLowerCase().includes(needle)));
    const restored=[];
    for(const entry of matches){
      const record=this.history.findById("members",entry.id).record;
      if(!record)continue;
      this.members().unshift(record);
      this.forgetArchived(entry.id);
      restored.push(record);
    }
    if(restored.length)this.save();
    return restored;
  }

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
