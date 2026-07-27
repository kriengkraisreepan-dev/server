const assert = require("assert");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { MemberService } = require("../services/member-service");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { PosOrderService } = require("../services/pos-order-service");

const store = { members: [], memberPointTransactions: [], posOrders: [] };
const save = () => {};
const members = new MemberService(new JsonMemberRepository({ getStore: () => store, save }));
const member = members.create({ memberCode: "M0001", displayName: "Member One", phone: "0810000000" }, "owner");
assert.strictEqual(members.list({ search: "M0001", status: "ACTIVE" }).length, 1);
assert.strictEqual(members.list({ search: "081", status: "ACTIVE" })[0].id, member.id);
members.status(member.id, "DISABLED", "owner");
assert.strictEqual(members.list({ status: "ACTIVE" }).length, 0);
members.status(member.id, "ACTIVE", "owner");

const inventory = { getProduct: () => null };
const orders = new PosOrderService(new JsonPosOrderRepository({ getStore: () => store, save }), inventory, { findMember: id => store.members.find(m => m.id === id) || null });
const order = orders.createOrder({ orderType: "WALK_IN", memberId: member.id }, { userId: "cashier", role: "CASHIER" });
assert.strictEqual(order.memberId, member.id);
assert.strictEqual(order.memberCode, "M0001");
assert.strictEqual(order.memberName, "Member One");
assert.throws(() => orders.createOrder({ orderType: "WALK_IN", memberId: "unknown" }, { userId: "cashier", role: "CASHIER" }), /Active member/);

const bill = { id: "bill-1", memberId: member.id, total: 100 };
members.earn(bill, "cashier");
assert.strictEqual(bill.pointsEarned, 5);
assert.strictEqual(bill.pointsBalance, 5);
members.void(bill, "owner");
members.void(bill, "owner");
assert.strictEqual(member.points, 0, "void must be idempotent");
assert.strictEqual(store.memberPointTransactions.filter(tx => tx.type === "VOID").length, 1);
console.log("Sprint 9A.1 member UI/integration tests passed");
