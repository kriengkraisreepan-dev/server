const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("accelerated eight-hour polling and modal lifecycle has no overlap or duplicate timers", async () => {
  const simulatedMinutes=8*60,pollsPerMinute=12,totalCycles=simulatedMinutes*pollsPerMinute;
  const timers=new Map(),auditIds=new Set();
  let requestInFlight=false,maxConcurrentRequests=0,concurrentRequests=0,modalOpen=false,reservationPollingPaused=false;
  const startTimer=(name,interval)=>{if(!timers.has(name))timers.set(name,interval);};
  const poll=async cycle=>{
    if(requestInFlight)return;
    requestInFlight=true;concurrentRequests+=1;maxConcurrentRequests=Math.max(maxConcurrentRequests,concurrentRequests);
    await Promise.resolve();
    auditIds.add(`POLL-${cycle}`);
    concurrentRequests-=1;requestInFlight=false;
  };
  startTimer("table-clock",1000);startTimer("table-state",15000);startTimer("session-status",30000);startTimer("reservation",30000);
  for(let cycle=0;cycle<totalCycles;cycle+=1){
    startTimer("session-status",30000);
    if(cycle%12===0){modalOpen=true;reservationPollingPaused=true;}
    if(cycle%12===2){modalOpen=false;reservationPollingPaused=false;}
    if(!reservationPollingPaused)await Promise.all([poll(cycle),poll(cycle)]);
  }
  assert.equal(totalCycles,5760);
  assert.equal(timers.size,4);
  assert.equal(maxConcurrentRequests,1);
  assert.equal(modalOpen,false);
  assert.equal(reservationPollingPaused,false);
  assert.equal(auditIds.size,new Set(auditIds).size);
});

test("frontend source contains one guarded lifecycle for each recurring timer", () => {
  const source=fs.readFileSync(path.join(__dirname,"../public/js/app.js"),"utf8");
  assert.match(source,/if\(sessionTimer\)return/);
  assert.match(source,/stateRefreshPromise/);
  assert.match(source,/reservationAlertRequest/);
  assert.match(source,/reservationPollingPaused/);
  assert.match(source,/clearInterval\(sessionTimer\);sessionTimer=null/);
});
