const test = require("node:test");
const assert = require("node:assert/strict");
const { TableConfigurationService } = require("../services/table-configuration-service");

const table = (id, status = "free") => ({ id, code:`T${String(id).padStart(2,"0")}`, name:`โต๊ะ ${id}`, relay:id, status, memberId:null, startTime:null, items:[] });

test("increasing table count creates stable sequential free tables", () => {
  const service = new TableConfigurationService();
  const result = service.resize([table(1), table(2)], 4);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => item.id), [1,2,3,4]);
  assert.equal(result[3].code, "T04");
  assert.equal(result[3].status, "free");
});

test("decreasing table count removes only trailing free unused tables", () => {
  const service = new TableConfigurationService();
  assert.deepEqual(service.resize([table(1),table(2),table(3)], 2).map(item => item.id), [1,2]);
  assert.throws(() => service.resize([table(1),table(2),table(3,"playing")], 2), { code:"TABLE_IN_USE" });
});

test("active session or reservation blocks removal and count is bounded", () => {
  const activeSession = new TableConfigurationService({ hasActiveSession:id => id === 3 });
  assert.throws(() => activeSession.resize([table(1),table(2),table(3)], 2), { code:"TABLE_IN_USE" });
  const activeReservation = new TableConfigurationService({ hasActiveReservation:id => id === 2 });
  assert.throws(() => activeReservation.resize([table(1),table(2)], 1), { code:"TABLE_IN_USE" });
  assert.throws(() => activeSession.resize([], 0), { code:"INVALID_TABLE_COUNT" });
  assert.throws(() => activeSession.resize([], 101), { code:"INVALID_TABLE_COUNT" });
});

test("settings UI submits tableCount and explains hardware mapping", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname,"..","public","js","app.js"),"utf8");
  assert.match(source, /name="tableCount"/);
  assert.match(source, /d\.tableCount=Number\(d\.tableCount\)/);
  assert.match(source, /Hardware Manager/);
});
