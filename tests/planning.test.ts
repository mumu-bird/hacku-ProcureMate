import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "procuremate-planning-"));
process.env.PROCUREMATE_DB = join(temp, "test.sqlite");
delete process.env.MODEL_API_KEY;
const { db, products, put, id, now } = await import("../lib/db");
const { plan, modelSelection } = await import("../lib/planner");
const { checks } = await import("../lib/policy");
import type { Need, Quote, Mandate } from "../lib/types";
const need: Need = {
  scenario: "event",
  title: "团队礼品",
  brief: "实用",
  people: 10,
  budgetCents: 250000,
  style: "简约",
  job: "developer",
  connectors: ["USB-A", "USB-C", "Bluetooth"],
  address: "香港办公室",
};
function mandate(q: Quote): Mandate {
  return {
    id: id("mandate"),
    name: "宽预算授权",
    scenario: q.scenario,
    requestId: q.requestId,
    capCents: 1000000,
    totalCapCents: 1000000,
    categories: ["gift"],
    merchants: [q.merchant],
    methods: ["card"],
    address: q.address,
    allowSubstitution: true,
    productIds: q.lines.map((l) => l.productId),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    createdAt: now(),
    revokedAt: null,
    version: 1,
    minIntervalSeconds: 0,
    rewardOwner: "company",
    actor: "manager",
  };
}
test("all affordable gifts are considered before three options are selected", async () => {
  const qs = await plan(need, "manager");
  assert.equal(qs.length, 3);
  assert.ok(qs.every((q) => q.totalCents <= need.budgetCents));
  assert.ok(qs.some((q) => q.lines[0].productId === "gift-tritan"));
  assert.equal(qs[0].decision?.eligibleCount, 4);
  assert.equal(qs[0].decision?.affordableCount, 3);
  assert.ok(
    qs[0].decision?.candidates.some((c) => !c.withinBudget && !c.selected),
  );
});
test("cash strategy ranks complete costs and does not pad missing feasible options", async () => {
  const qs = await plan(
    { ...need, strategy: "lowest_cost", budgetCents: 150000 },
    "manager",
  );
  assert.equal(qs.length, 1);
  assert.equal(qs[0].totalCents, 138000);
  assert.equal(qs[0].lines[0].productId, "gift-tritan");
  const one = await plan(
    { ...need, people: 1, strategy: "lowest_cost" },
    "manager",
  );
  assert.equal(one[0].totalCents, 21800);
  assert.equal(one[0].shippingCents, 8000);
});
test("capacity and observed insulation claims select only verified fits", async () => {
  const qs = await plan(
    { ...need, minCapacityMl: 500, requiresInsulated: true },
    "manager",
  );
  assert.equal(qs.length, 1);
  assert.equal(qs[0].lines[0].productId, "gift-bottle");
  assert.equal(qs[0].decision?.rejected.length, 3);
  await assert.rejects(
    plan({ ...need, minCapacityMl: 750 }, "manager"),
    /没有满足必要规格/,
  );
});
test("no affordable fit remains explicit and cannot execute under a larger mandate", async () => {
  const [q] = await plan({ ...need, budgetCents: 10000 }, "manager");
  assert.equal(q.title, "超出需求预算");
  assert.equal(q.decision?.affordableCount, 0);
  assert.equal(
    checks(q, mandate(q)).find((c) => c.code === "REQUIREMENTS")?.pass,
    false,
  );
});
test("payment gate independently rejects changed quantities and unmet specifications", async () => {
  const [q] = await plan(need, "manager");
  const m = mandate(q);
  for (const changed of [
    { ...q, need: { ...q.need, minCapacityMl: 2000 } },
    { ...q, lines: q.lines.map((l) => ({ ...l, quantity: l.quantity + 1 })) },
  ]) {
    put("quote", changed);
    assert.equal(
      checks(changed, m).find((c) => c.code === "REQUIREMENTS")?.pass,
      false,
    );
  }
});
test("validated model ranking cannot exclude affordable products or repeat candidate IDs", async () => {
  const original = globalThis.fetch;
  process.env.MODEL_API_KEY = "test-fixture-not-real-model";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                productIds: ["gift-flask", "gift-flask"],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  try {
    const result = await modelSelection(
      need,
      products().filter((p) => p.category === "gift"),
    );
    assert.deepEqual(result.ids, ["gift-flask"]);
    assert.equal(result.trace.status, "validated");
    const qs = await plan(need, "manager");
    assert.equal(qs.length, 3);
    assert.ok(qs.every((q) => q.totalCents <= need.budgetCents));
    assert.ok(qs.every((q) => q.lines[0].productId !== "gift-flask"));
  } finally {
    globalThis.fetch = original;
    delete process.env.MODEL_API_KEY;
  }
});
after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
