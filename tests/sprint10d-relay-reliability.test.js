const test=require("node:test");
const assert=require("node:assert/strict");
const {RelayService}=require("../services/relay-service");

test("relay retries with a limit and preserves desired state while offline",async()=>{
  let calls=0;const table={relay:1,relayActualState:"off"},events=[];
  const service=new RelayService({baseUrl:"http://esp32",attempts:3,logger:(level,event)=>events.push({level,event}),fetcher:async()=>{calls+=1;throw new Error("offline");}});
  const result=await service.set(table,"on");
  assert.equal(calls,3);assert.equal(result.failed,true);assert.equal(table.relayDesiredState,"on");assert.equal(table.relayActualState,"off");assert.equal(table.relayPending,true);
  assert.deepEqual(events,[{level:"ERROR",event:"RELAY_COMMAND_FAILED"}]);
});

test("100 on and 100 off commands never duplicate a successful attempt",async()=>{
  let calls=0;const table={relay:1};
  const service=new RelayService({baseUrl:"http://esp32",fetcher:async()=>{calls+=1;return{ok:true};}});
  for(let index=0;index<100;index+=1){await service.set(table,"on");await service.set(table,"off");}
  assert.equal(calls,200);assert.equal(table.relayDesiredState,"off");assert.equal(table.relayActualState,"off");assert.equal(table.relayPending,false);
});
