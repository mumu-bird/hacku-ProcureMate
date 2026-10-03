import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "procuremate-study-fixtures-"));
process.env.PROCUREMATE_DB = join(temp, "test.sqlite");
delete process.env.MODEL_API_KEY;
const store = await import("../lib/db");
const {
  createStudy,
  startStudy,
  studyAction,
  studyPlan,
  finishStudy,
  studyReport,
  studyCreateSchema,
  studyFinishSchema,
  summarizeStudies,
} = await import("../lib/study");
import type { Actor } from "../lib/types";
import type { StudyAnswer } from "../lib/study";
const manager: Actor = {
  id: "manager",
  name: "自动化测试夹具，不是真人",
  role: "manager",
};
const buyer: Actor = { id: "buyer", name: "自动化测试夹具", role: "buyer" };
const answer: StudyAnswer = {
  productId: "gift-tritan",
  quantity: 10,
  costCents: 138000,
  capCents: 250000,
  category: "gift",
  merchant: "The Club",
  expiryHours: 24,
  rewardOwner: "company",
  decision: "proceed",
};
function create(participant: string, first: "manual" | "agent" = "manual") {
  return createStudy(
    studyCreateSchema.parse({ participant, first, humanConfirmed: true }),
    manager,
  );
}
function finish(sessionId: string, method: "manual" | "agent", extra = {}) {
  return finishStudy(
    studyFinishSchema.parse({
      sessionId,
      method,
      observedSteps: 8,
      helpCount: 0,
      note: "自动化夹具；不得计作真人数据",
      answer,
      ...extra,
    }),
    manager,
  );
}
test("study creation requires explicit facilitator confirmation and manager privileges", () => {
  assert.throws(() =>
    studyCreateSchema.parse({
      participant: "P90",
      first: "manual",
      humanConfirmed: false,
    }),
  );
  assert.throws(
    () =>
      createStudy(
        { participant: "P90", first: "manual", humanConfirmed: true },
        buyer,
      ),
    /负责人/,
  );
  assert.throws(() => studyReport(buyer), /负责人/);
  assert.throws(
    () =>
      studyFinishSchema.parse({
        sessionId: "x",
        method: "manual",
        observedSteps: 0,
        helpCount: 0,
        note: "",
        answer,
      }),
    /完整步骤/,
  );
});
test("trial order, action replay and sealed submissions cannot be reset or overwritten", () => {
  const s = create("P91");
  assert.throws(() => create("P91"), /已有记录/);
  assert.throws(() => startStudy(s.id, "agent", manager), /先结束/);
  assert.throws(() => finish(s.id, "manual"), /先开始/);
  startStudy(s.id, "manual", manager);
  studyAction(s.id, "manual", "action-1", "view_source", manager);
  studyAction(s.id, "manual", "action-1", "view_source", manager);
  const ended = finish(s.id, "manual");
  assert.equal(ended.trials[0].actions.length, 1);
  assert.equal(ended.trials[0].validation?.errors.length, 0);
  assert.ok(ended.trials[0].seconds! >= 0);
  const replay = finish(s.id, "manual", {
    answer: { ...answer, costCents: 0 },
  });
  assert.deepEqual(replay.trials[0], ended.trials[0]);
  assert.throws(
    () => studyAction(s.id, "manual", "after-end", "edit_answer", manager),
    /已结束/,
  );
  assert.equal(
    startStudy(s.id, "manual", manager).trials[0].status,
    "submitted",
  );
  startStudy(s.id, "agent", manager);
  finish(s.id, "agent");
});
test("incorrect answers and abandoned routes stay visible and cannot produce a valid result", () => {
  const s = create("P92", "agent");
  startStudy(s.id, "agent", manager);
  const ended = finish(s.id, "agent", {
    answer: {
      ...answer,
      quantity: 9,
      costCents: 0,
      category: "equipment",
      rewardOwner: "personal",
    },
    helpCount: 2,
  });
  assert.equal(ended.trials[0].status, "submitted");
  assert.ok(ended.trials[0].validation!.errors.length >= 4);
  startStudy(s.id, "manual", manager);
  assert.throws(
    () => finish(s.id, "manual", { abandoned: true, note: "" }),
    /原因/,
  );
  finish(s.id, "manual", { abandoned: true, note: "夹具模拟放弃" });
  const report = studyReport(manager);
  const group = report.groups[0];
  assert.equal(group.pairedSubmissions, 1);
  assert.equal(group.manual.abandoned, 1);
  assert.equal(group.agent.assistanceCount, 2);
  assert.equal(group.agent.valid, 1);
});
test("agent uses the same frozen catalog and refuses changed source snapshots", async () => {
  const s = create("P93", "agent");
  startStudy(s.id, "agent", manager);
  const original = store.products().find((p) => p.id === "gift-tritan")!;
  store.put("product", { ...original, priceCents: original.priceCents + 100 });
  try {
    await assert.rejects(studyPlan(s.id, manager), /已改变/);
  } finally {
    store.put("product", original);
  }
  const first = await studyPlan(s.id, manager);
  assert.ok(
    first.quotes.every((q) => q.need.people === 10 && q.totalCents <= 250000),
  );
  assert.deepEqual(
    (await studyPlan(s.id, manager)).quotes.map((q) => q.id),
    first.quotes.map((q) => q.id),
  );
});
test("empty studies show no effect metrics and different source snapshots remain separate", () => {
  const empty = summarizeStudies([]);
  assert.equal(empty.participants, 0);
  assert.deepEqual(empty.groups, []);
  const sessions = store.list<import("../lib/study").StudySession>("study");
  const changed = {
    ...sessions[0],
    id: "fixture-different",
    digest: "another-snapshot",
  };
  const report = summarizeStudies([...sessions, changed]);
  assert.equal(report.groups.length, 2);
  assert.equal(
    report.groups.find((g) => g.digest === "another-snapshot")
      ?.pairedSubmissions,
    0,
  );
  assert.equal(
    report.groups.find((g) => g.digest === "another-snapshot")?.manual
      .medianSeconds,
    null,
  );
  assert.equal(store.verifyAudit(), true);
});
after(() => {
  store.db.close();
  rmSync(temp, { recursive: true, force: true });
});
