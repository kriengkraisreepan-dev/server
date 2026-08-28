const crypto=require("crypto");
const TIERS=new Set(["STANDARD","SILVER","GOLD","PLATINUM"]);
const clean=v=>String(v??"").trim();
// N months from `iso`, using the standard JS Date month-rollover rule (e.g. Jan 31 + 1 month lands
// on Mar 3, since Feb is shorter) — deliberately simple, matches how most "N months from now"
// systems behave and needs no special leap-year handling (setUTCMonth already accounts for it).
function addMonthsIso(iso,months){const date=new Date(iso);date.setUTCMonth(date.getUTCMonth()+Number(months));return date.toISOString();}
class MemberService{
 constructor(repository,{clock=()=>new Date(),audit=()=>{}}={}){this.repository=repository;this.clock=clock;this.audit=audit;}
 now(){return this.clock().toISOString();}
 normalize(){let changed=false;for(const m of this.repository.members()){if(!m.memberCode){m.memberCode=m.code||`M${String(this.repository.members().indexOf(m)+1).padStart(4,"0")}`;changed=true;}if(!m.displayName){m.displayName=m.name||[m.firstName,m.lastName].filter(Boolean).join(" ");changed=true;}for(const [k,v] of Object.entries({firstName:"",lastName:"",phone:"",email:"",birthday:"",gender:"",lineId:"",address:"",status:"ACTIVE",tier:"STANDARD",points:0,totalSpent:0,visitCount:0,lastVisitAt:null,createdBy:"SYSTEM",updatedBy:"SYSTEM"}))if(m[k]===undefined){m[k]=v;changed=true;}}if(changed)this.repository.save();}
  // Long-inactive members live in a month file with only an index row left behind, and that row is
 // checked here as well — reissuing a code or phone number that belongs to someone who might walk
 // back in would collide the moment they did.
 assertUnique(input,id){const code=clean(input.memberCode),phone=clean(input.phone),email=clean(input.email).toLowerCase();if(!code)throw new Error("Member code is required");
  const known=[...this.repository.members(),...(this.repository.archivedIndex?this.repository.archivedIndex():[])];
  if(known.some(m=>m.id!==id&&(m.memberCode||m.code)===code))throw new Error("Member code already exists");
  if(phone&&known.some(m=>m.id!==id&&clean(m.phone)===phone))throw new Error("Phone already exists");
  if(email&&known.some(m=>m.id!==id&&clean(m.email).toLowerCase()===email))throw new Error("Email already exists");}
 create(input,actor){this.normalize();const now=this.now(),firstName=clean(input.firstName||input.name),lastName=clean(input.lastName),displayName=clean(input.displayName)||[firstName,lastName].filter(Boolean).join(" ");if(!displayName)throw new Error("Member name is required");const memberCode=clean(input.memberCode)||`M${String(this.repository.members().length+1).padStart(4,"0")}`;this.assertUnique({...input,memberCode},null);const m={id:crypto.randomUUID(),memberCode,code:memberCode,firstName,lastName,displayName,name:displayName,phone:clean(input.phone),email:clean(input.email),birthday:clean(input.birthday),gender:clean(input.gender),lineId:clean(input.lineId),address:clean(input.address),status:"ACTIVE",tier:TIERS.has(input.tier)?input.tier:"STANDARD",points:0,totalSpent:0,visitCount:0,lastVisitAt:null,createdAt:now,updatedAt:now,createdBy:actor,updatedBy:actor};this.repository.saveMember(m);this.audit("MEMBER_CREATED",actor,{memberId:m.id});return m;}
 update(id,input,actor){this.normalize();const m=this.repository.findById(id);if(!m)throw new Error("Member not found");const next={...m,...Object.fromEntries(Object.entries(input).filter(([k])=>["memberCode","firstName","lastName","displayName","phone","email","birthday","gender","lineId","address","tier"].includes(k)))};if(!TIERS.has(next.tier))throw new Error("Invalid tier");next.displayName=clean(next.displayName)||[next.firstName,next.lastName].filter(Boolean).join(" ");next.name=next.displayName;next.code=next.memberCode;this.assertUnique(next,id);Object.assign(m,next,{updatedAt:this.now(),updatedBy:actor});this.repository.saveMember(m);this.audit("MEMBER_UPDATED",actor,{memberId:id});return m;}
 // Searching for a name or number reaches members who have been archived for inactivity and brings
 // their full record back, so staff never hit "no such member" for someone who simply had not been
 // in for a few years. An unfiltered list shows the working set only — that is the point of it.
 list(q={}){this.normalize();const text=clean(q.search||q.q).toLowerCase(),status=clean(q.status);
  if(text&&this.repository.restoreMatching)this.repository.restoreMatching(text);
  return this.repository.members().filter(m=>(!status||m.status===status)&&(!text||[m.memberCode,m.displayName,m.phone,m.email].some(v=>clean(v).toLowerCase().includes(text))));}
 status(id,status,actor){const m=this.repository.findById(id);if(!m)throw new Error("Member not found");if(!["ACTIVE","DISABLED"].includes(status))throw new Error("Invalid member status");m.status=status;m.updatedAt=this.now();m.updatedBy=actor;this.repository.saveMember(m);this.audit(status==="ACTIVE"?"MEMBER_ENABLED":"MEMBER_DISABLED",actor,{memberId:id});return m;}
 rewardPolicy(settings={}){const r=settings.rewards||settings;return {pointValue:Number(r.rewardPointValue||1),minimumPoints:Number(r.rewardMinimumPoints||100),allowPartialRedeem:r.allowPartialRedeem!==false,allowRedeemTable:r.allowRedeemTable!==false,allowRedeemWalkIn:r.allowRedeemWalkIn!==false,earnedRule:"floor(netTotal/20)"};}
 // For TABLE bills, redemption is capped by the bill's REMAINING table charge (bill.tableChargeSatang,
 // which already reflects any manual ฿ discount applied at checkout), not the whole bill total —
 // point redemption, like the manual discount button, only ever discounts table time, never food/drink.
 // Older bills (or synthetic preflight bill shapes) without that field fall back to the whole total.
 redeemCapSatang(bill){return Number.isInteger(bill?.tableChargeSatang)?bill.tableChargeSatang:Number(bill?.totalSatang??Math.round(Number(bill?.total||0)*100));}
 calculateMaximumRedeem(member,bill,settings){const policy=this.rewardPolicy(settings);if(!member||member.status!=="ACTIVE")throw new Error("Active member is required for rewards");if(!bill||!["awaiting_payment","pending"].includes(bill.status))throw new Error("Rewards can only be used before payment");if((bill.saleSource||"TABLE")==="TABLE"&&!policy.allowRedeemTable)throw new Error("Table redemption is disabled");if((bill.saleSource||"TABLE")==="WALK_IN"&&!policy.allowRedeemWalkIn)throw new Error("Walk-in redemption is disabled");const byTotal=Math.floor(this.redeemCapSatang(bill)/(policy.pointValue*100));const maximum=Math.max(0,Math.min(Math.floor(Number(member.points||0)),byTotal));return {maximumPoints:maximum,maximumValueSatang:Math.round(maximum*policy.pointValue*100),policy};}
 previewRedeem(bill,requestedPoints,settings){const member=this.repository.findById(bill?.memberId);const {maximumPoints,maximumValueSatang,policy}=this.calculateMaximumRedeem(member,bill,settings);const points=Number(requestedPoints);if(!Number.isInteger(points)||points<0)throw new Error("Redeem points must be a non-negative integer");if(points&&points<policy.minimumPoints)throw new Error(`Minimum redeem is ${policy.minimumPoints} points`);if(points>maximumPoints)throw new Error("Insufficient points or redemption exceeds bill total");if(!policy.allowPartialRedeem&&points!==0&&points!==maximumPoints)throw new Error("Partial redemption is disabled");const valueSatang=Math.min(Math.round(points*policy.pointValue*100),this.redeemCapSatang(bill));return {member,points,valueSatang,netTotalSatang:Math.max(0,Number(bill.totalSatang??0)-valueSatang),maximumPoints,maximumValueSatang,policy};}
 selectRedeem(bill,requestedPoints,settings,actor){if(bill.redeemSelected)return this.previewRedeem(bill,bill.redeemedPoints||0,settings);const preview=this.previewRedeem(bill,requestedPoints,settings);if(!preview.points)return preview;bill.redeemedPoints=preview.points;bill.redeemValue=Number((preview.valueSatang/100).toFixed(2));bill.redeemValueSatang=preview.valueSatang;bill.rewardPolicySnapshot=preview.policy;bill.memberBalanceBeforeRedeem=Number(preview.member.points||0);
  if(Number.isInteger(bill.tableChargeSatang)){
   // Table-charge-only bill shape: shrink tableChargeSatang/playAmount by the redeemed value, leave
   // foodAmount untouched, recompute total from the two parts, and fold the value into bill.discount
   // so it reports the combined manual-discount + point-redemption total (see discount-table-charge-only.test.js).
   bill.tableChargeSatang=Math.max(0,bill.tableChargeSatang-preview.valueSatang);
   bill.playAmountSatang=bill.tableChargeSatang;bill.playAmount=Number((bill.tableChargeSatang/100).toFixed(2));
   bill.totalSatang=bill.tableChargeSatang+Number(bill.foodAmountSatang||0);
   bill.total=Number((bill.totalSatang/100).toFixed(2));
   bill.discount=Number((Number(bill.discount||0)+preview.valueSatang/100).toFixed(2));
  } else {
   bill.totalSatang=preview.netTotalSatang;bill.total=Number((preview.netTotalSatang/100).toFixed(2));
  }
  bill.redeemSelected=true;this.audit("POINT_REDEEM_SELECTED",actor,{memberId:bill.memberId,billId:bill.id,points:preview.points});return preview;}
 redeemPoints(bill,actor){if(!bill?.redeemSelected||bill.redeemApplied)return null;const member=this.repository.findById(bill.memberId);if(!member||member.status!=="ACTIVE")throw new Error("Active member is required for redemption");const points=Number(bill.redeemedPoints||0);if(points>Number(member.points||0))throw new Error("Member no longer has enough points");const before=Number(member.points||0);member.points-=points;member.updatedAt=this.now();member.updatedBy=actor;bill.memberBalanceBeforeRedeem=before;bill.memberBalanceAfterRedeem=member.points;bill.redeemApplied=true;this.repository.saveMember(member);this.repository.addPoint({id:crypto.randomUUID(),memberId:member.id,billId:bill.id,type:"REDEEM",points:-points,balanceBefore:before,balanceAfter:member.points,createdAt:this.now(),createdBy:actor});this.audit("POINT_REDEEM",actor,{memberId:member.id,billId:bill.id,points:-points});return member;}
 rollbackRedeem(bill,actor){if(!bill?.redeemApplied||bill.redeemRolledBack)return null;const member=this.repository.findById(bill.memberId);if(!member)return null;const points=Number(bill.redeemedPoints||0),before=Number(member.points||0);member.points+=points;member.updatedAt=this.now();member.updatedBy=actor;bill.redeemRolledBack=true;this.repository.saveMember(member);this.repository.addPoint({id:crypto.randomUUID(),memberId:member.id,billId:bill.id,type:"REDEEM_ROLLBACK",points,balanceBefore:before,balanceAfter:member.points,createdAt:this.now(),createdBy:actor});this.audit("POINT_REDEEM_ROLLBACK",actor,{memberId:member.id,billId:bill.id,points});return member;}
 calculateTablePoints(playSeconds,settings={}){const loyalty=settings.loyalty||settings,interval=Math.max(1,Number(loyalty.tablePointIntervalMinutes||60))*60,pointsPerInterval=Math.max(0,Number(loyalty.tablePointsPerHour??5));const completed=Math.floor(Math.max(0,Number(playSeconds||0))/interval);return {points:completed*pointsPerInterval,completedIntervals:completed,playSeconds:Math.max(0,Number(playSeconds||0)),policy:{mode:"TABLE_TIME",tablePointsPerHour:pointsPerInterval,intervalMinutes:interval/60,rounding:"FLOOR"}};}
 earn(bill,actor,settings={}){if(!bill.memberId||bill.pointsEarnedApplied||bill.saleSource!=="TABLE")return null;const m=this.repository.findById(bill.memberId);if(!m||m.status!=="ACTIVE")return null;const earned=this.calculateTablePoints(bill.playDurationSeconds,settings),before=Number(m.points||0);
  // Each earned "batch" remembers its own expiry (earn date + pointExpiryMonths at the time it was
  // earned) — changing the setting later does not retroactively change already-earned batches.
  const expiryMonths=Number((settings.loyalty||settings).pointExpiryMonths||0),now=this.now(),expiresAt=earned.points&&expiryMonths>0?addMonthsIso(now,expiryMonths):null;
  m.points+=earned.points;m.totalHoursPlayed=Number(m.totalHoursPlayed||0)+(earned.playSeconds/3600);m.totalTablePoints=Number(m.totalTablePoints||0)+earned.points;m.visitCount=Number(m.visitCount||0)+1;m.lastVisitAt=now;m.updatedAt=now;m.updatedBy=actor;Object.assign(bill,{tablePointsEarned:earned.points,tablePlaySecondsSnapshot:earned.playSeconds,tablePlayHoursSnapshot:earned.playSeconds/3600,loyaltyPolicySnapshot:earned.policy,pointsEarned:earned.points,pointsBalance:m.points,pointsEarnedApplied:true});if(expiresAt&&earned.points){if(!Array.isArray(m.pointBatches))m.pointBatches=[];m.pointBatches.push({expiresAt,points:earned.points});}this.repository.saveMember(m);this.repository.addPoint({id:crypto.randomUUID(),memberId:m.id,billId:bill.id,type:"EARN",reason:"TABLE_TIME",points:earned.points,expiresAt,balanceBefore:before,balanceAfter:m.points,createdAt:now,createdBy:actor});this.audit("POINT_EARNED",actor,{memberId:m.id,billId:bill.id,points:earned.points,reason:"TABLE_TIME",expiresAt});return m;}
 // Expires due EARN batches for one member — "oldest batch first, never below the current balance"
 // (a deliberate approximation: it doesn't track exactly which batch a REDEEM/VOID drew down, so a
 // partial redemption that happens to straddle two batches' boundaries is only approximately right —
 // acceptable at this scale; see repository.points() for the full transaction trail if ever audited).
 // The two figures this needs — "how many earned points have come due" and "how many have already
 // been expired" — used to be recomputed by scanning the member's entire transaction history on
 // every sweep, which is why that history had to stay in the file rewritten on every click. They
 // are now carried on the member record itself and updated as things happen:
 //
 //   pointBatches       earned batches not yet due, {expiresAt, points} — bounded by the expiry
 //                      window, not by how long the shop has traded
 //   pointsDueTotal     running total of batch points that have come due
 //   pointsExpiredTotal running total of points actually taken away
 //
 // The arithmetic below is deliberately identical to the old scan: dueTotal - expiredTotal, capped
 // at the member's current balance. Capping matters — a member who spent their points before a
 // batch came due has less balance than is due, and the shortfall must stay owed so it is taken
 // from the next points they earn, exactly as before. Backfilled from the ledger by
 // backfillPointExpirySummaries() before that ledger is archived.
 // One-time rebuild of the three summary fields above from the full transaction ledger. It has to
 // run while that ledger is still in store.json — i.e. before the history migration archives it —
 // and it is what makes the switch away from scanning safe for a shop that already has points on
 // the books. Idempotent: it derives the fields from scratch rather than adding to them.
 backfillPointExpirySummaries(now=new Date()){
  const byMember=new Map();
  for(const tx of this.repository.points()){
   if(!byMember.has(tx.memberId))byMember.set(tx.memberId,[]);
   byMember.get(tx.memberId).push(tx);
  }
  let touched=0;
  for(const member of this.repository.members()){
   const transactions=byMember.get(member.id)||[];
   const earned=transactions.filter(tx=>tx.type==="EARN"&&tx.expiresAt);
   member.pointBatches=earned.filter(tx=>new Date(tx.expiresAt)>now).map(tx=>({expiresAt:tx.expiresAt,points:Number(tx.points||0)}));
   member.pointsDueTotal=earned.filter(tx=>new Date(tx.expiresAt)<=now).reduce((sum,tx)=>sum+Number(tx.points||0),0);
   member.pointsExpiredTotal=Math.abs(transactions.filter(tx=>tx.type==="EXPIRE").reduce((sum,tx)=>sum+Number(tx.points||0),0));
   touched+=1;
  }
  if(touched)this.repository.save();
  return {members:touched};
 }
 sweepExpiredPoints(member,now=new Date()){
  const batches=Array.isArray(member.pointBatches)?member.pointBatches:[];
  const due=batches.filter(batch=>batch.expiresAt&&new Date(batch.expiresAt)<=now);
  if(due.length){
   member.pointBatches=batches.filter(batch=>!(batch.expiresAt&&new Date(batch.expiresAt)<=now));
   member.pointsDueTotal=Number(member.pointsDueTotal||0)+due.reduce((sum,batch)=>sum+Number(batch.points||0),0);
  }
  const amount=Math.max(0,Math.min(Number(member.pointsDueTotal||0)-Number(member.pointsExpiredTotal||0),Number(member.points||0)));
  // Batches that came due still have to be recorded as due even when nothing can be taken yet,
  // or they would be counted again on the next sweep.
  if(!amount){if(due.length)this.repository.saveMember(member);return null;}
  const before=Number(member.points||0);
  member.points=before-amount;member.pointsExpiredTotal=Number(member.pointsExpiredTotal||0)+amount;member.updatedAt=this.now();member.updatedBy="SYSTEM";
  this.repository.saveMember(member);
  this.repository.addPoint({id:crypto.randomUUID(),memberId:member.id,billId:null,type:"EXPIRE",reason:"POINT_EXPIRY",points:-amount,balanceBefore:before,balanceAfter:member.points,createdAt:this.now(),createdBy:"SYSTEM"});
  this.audit("POINT_EXPIRED","SYSTEM",{memberId:member.id,points:-amount});
  return {memberId:member.id,expired:amount,balanceAfter:member.points};
 }
 // Runs the sweep for every member — call at boot and periodically (see index.js). No-op entirely
 // when expiry is disabled (pointExpiryMonths=0), so existing shops with it off pay zero extra cost.
 sweepAllExpiredPoints(settings={},now=new Date()){
  if(!Number((settings.loyalty||settings).pointExpiryMonths||0))return [];
  return this.repository.members().map(member=>this.sweepExpiredPoints(member,now)).filter(Boolean);
 }
 void(bill,actor){if(!bill.memberId||!bill.pointsEarnedApplied||bill.pointsVoided)return null;const m=this.repository.findById(bill.memberId);if(!m)return null;const p=Number((bill.tablePointsEarned??bill.pointsEarned)||0),seconds=Number((bill.tablePlaySecondsSnapshot??bill.playDurationSeconds)||0),before=Number(m.points||0);m.points=Math.max(0,before-p);m.totalHoursPlayed=Math.max(0,Number(m.totalHoursPlayed||0)-(seconds/3600));m.totalTablePoints=Math.max(0,Number(m.totalTablePoints||0)-p);m.updatedAt=this.now();m.updatedBy=actor;bill.pointsVoided=true;this.repository.saveMember(m);this.repository.addPoint({id:crypto.randomUUID(),memberId:m.id,billId:bill.id,type:"VOID",reason:"TABLE_TIME",points:-p,balanceBefore:before,balanceAfter:m.points,createdAt:this.now(),createdBy:actor});this.audit("POINT_VOID",actor,{memberId:m.id,billId:bill.id,points:-p,reason:"TABLE_TIME"});return m;}
 // A member's point trail spans the working set and the month files. With no date range this
 // reads the last twelve months, which is the window an owner actually questions a balance over;
 // older entries are still there and come back when a range is given.
 history(id,query={}){return this.repository.pointsForMember(id,query);}
}
module.exports={MemberService};
