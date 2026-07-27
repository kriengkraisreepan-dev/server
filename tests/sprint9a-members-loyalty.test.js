const assert=require("assert");
const {JsonMemberRepository}=require("../repositories/json-member-repository");
const {MemberService}=require("../services/member-service");
const store={members:[],memberPointTransactions:[]};const repo=new JsonMemberRepository({getStore:()=>store,save:()=>{}});const service=new MemberService(repo);
const member=service.create({memberCode:"M001",firstName:"A",lastName:"B",phone:"081",email:"a@test"},"owner");assert.strictEqual(member.points,0);assert.throws(()=>service.create({memberCode:"M002",firstName:"C",phone:"081"},"owner"),/Phone/);assert.throws(()=>service.create({memberCode:"M001",firstName:"C",phone:"082"},"owner"),/code/);assert.strictEqual(service.list({search:"081"}).length,1);
const bill={id:"b1",memberId:member.id,total:59};service.earn(bill,"cashier");assert.strictEqual(member.points,2);assert.strictEqual(store.memberPointTransactions[0].type,"EARN");service.void(bill,"owner");assert.strictEqual(member.points,0);assert.strictEqual(store.memberPointTransactions[0].type,"VOID");console.log("Sprint 9A members and loyalty tests passed");
