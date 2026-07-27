class JsonMemberRepository {
  constructor({ getStore, save }) { this.getStore=getStore; this.save=save; }
  members(){const s=this.getStore();if(!Array.isArray(s.members))s.members=[];return s.members;}
  points(){const s=this.getStore();if(!Array.isArray(s.memberPointTransactions))s.memberPointTransactions=[];return s.memberPointTransactions;}
  findById(id){return this.members().find(m=>m.id===id)||null;}
  saveMember(member){const a=this.members(),i=a.findIndex(m=>m.id===member.id);if(i<0)a.unshift(member);else a[i]=member;this.save();return member;}
  addPoint(tx){this.points().unshift(tx);this.save();return tx;}
}
module.exports={JsonMemberRepository};
