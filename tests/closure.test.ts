import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
const temp = mkdtempSync(join(tmpdir(), "procuremate-closure-"));
process.env.PROCUREMATE_DB = join(temp, "closure.sqlite");
process.env.PAYMENT_PROVIDER = "simulated";
delete process.env.MODEL_API_KEY;
const store = await import("../lib/db");
const { plan } = await import("../lib/planner");
const { purchase, reconcile, refund, recordPaymentEvent } =
  await import("../lib/engine");
const { simulatedPayments } = await import("../lib/payments");
import type { Actor, Mandate, Need, Order, Quote } from "../lib/types";
const actor: Actor = {
  id: "closure-manager",
  name: "闭环测试",
  role: "manager",
};
const need: Need = {
  scenario: "event",
  title: "闭环礼品",
  brief: "实用礼品",
  people: 2,
  budgetCents: 250000,
  style: "简约",
  job: "developer",
  connectors: ["USB-C", "Bluetooth"],
  address: "香港办公室",
};
async function setup() {
  const q = (await plan(need, actor.id))[0];
  const m: Mandate = {
    id: store.id("mandate"),
    name: "闭环授权",
    scenario: q.scenario,
    requestId: q.requestId,
    capCents: q.totalCents,
    totalCapCents: q.totalCents,
    categories: [...new Set(q.lines.map((l) => l.category))],
    merchants: [q.merchant],
    methods: ["card"],
    address: q.address,
    allowSubstitution: false,
    productIds: q.lines.map((l) => l.productId),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    createdAt: store.now(),
    revokedAt: null,
    version: 1,
    minIntervalSeconds: 0,
    rewardOwner: "company",
    actor: actor.id,
  };
  store.put("mandate", m);
  return { q, m };
}
function successEvent(orderId: string, paymentId: string, amount: number) {
  return {
    id: store.id("evt"),
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: paymentId,
        amount,
        currency: "hkd",
        metadata: { procuremate_order: orderId },
      },
    },
  };
}
test("cash-only orders above the observed HK$400 threshold receive zero standard shipping", async () => {
  const [q] = await plan({ ...need, people: 10 }, actor.id);
  assert.ok(q.subtotalCents >= 40000);
  assert.equal(q.shippingCents, 0);
});
test("delivery threshold is inclusive and old unverified shipping quotes cannot execute", async () => {
  const { shippingCents } = await import("../lib/shipping");
  assert.equal(shippingCents(39999), 8000);
  assert.equal(shippingCents(40000), 0);
  const { q, m } = await setup();
  delete q.shippingEvidence;
  store.put("quote", q);
  assert.equal((await purchase(actor, q.id, m.id)).status, "blocked");
});
test("payment response currency mismatch cannot execute a capture", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  const authorize = p.authorize;
  p.authorize = async (...args) => ({
    ...(await authorize(...args)),
    currency: "usd",
  });
  let called = 0;
  p.capture = async () => {
    called++;
    throw Error("must not capture");
  };
  assert.equal(
    (await purchase(actor, q.id, m.id, "success", p)).status,
    "pending",
  );
  assert.equal(called, 0);
});
test("concurrent reconciliation leases capture once and cannot overwrite the final state", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  const o = await purchase(actor, q.id, m.id, "timeout", p);
  let calls = 0;
  const capture = p.capture;
  p.capture = async (...args) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return capture(...args);
  };
  await Promise.all([reconcile(o.id, p), reconcile(o.id, p)]);
  assert.equal(calls, 1);
  assert.equal(store.get<Order>("order", o.id)!.status, "paid");
  assert.equal(store.usage(m.id).spent, q.totalCents);
});
test("payment response amount mismatch stops capture and retains reservation", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  const authorize = p.authorize;
  p.authorize = async (...args) => ({
    ...(await authorize(...args)),
    amount: 1,
  });
  let captured = 0;
  p.capture = async () => {
    captured++;
    throw Error("must not capture");
  };
  const o = await purchase(actor, q.id, m.id, "success", p);
  assert.equal(captured, 0);
  assert.equal(o.status, "pending");
  assert.equal(store.usage(m.id).reserved, q.totalCents);
});
test("a signed success event arriving before an unknown authorization response stays paid", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  p.name = "stripe-test";
  const authorize = p.authorize;
  p.authorize = async (amount, orderId, behavior) => {
    const r = await authorize(amount, orderId, behavior);
    recordPaymentEvent(successEvent(orderId, r.id, amount));
    return { ...r, state: "unknown" };
  };
  assert.equal(
    (await purchase(actor, q.id, m.id, "success", p)).status,
    "paid",
  );
  assert.equal(store.usage(m.id).spent, q.totalCents);
});
test("a confirmed capture callback is not rolled back by the network response failing", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  p.name = "stripe-test";
  p.capture = async (paymentId, orderId) => {
    recordPaymentEvent(successEvent(orderId, paymentId, q.totalCents));
    throw Error("response lost after callback");
  };
  assert.equal(
    (await purchase(actor, q.id, m.id, "success", p)).status,
    "paid",
  );
});
test("a completed refund callback is not overwritten by a refund response timeout", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  p.name = "stripe-test";
  const o = await purchase(actor, q.id, m.id, "success", p);
  p.refund = async (paymentId) => {
    recordPaymentEvent({
      id: store.id("evt"),
      type: "refund.updated",
      data: {
        object: {
          id: "re_fixture",
          payment_intent: paymentId,
          amount: q.totalCents,
          currency: "hkd",
          status: "succeeded",
        },
      },
    });
    throw Error("refund response lost");
  };
  assert.equal((await refund(actor, o.id, p)).status, "refunded");
  assert.equal(store.usage(m.id).spent, 0);
});
test("capturable callback recovers a payment ID lost during authorization timeout", async () => {
  const { q, m } = await setup();
  const p = simulatedPayments();
  p.name = "stripe-test";
  const authorize = p.authorize;
  let paymentId = "";
  p.authorize = async (...args) => {
    paymentId = (await authorize(...args)).id;
    throw Error("response lost");
  };
  const o = await purchase(actor, q.id, m.id, "success", p);
  assert.equal(o.paymentId, null);
  recordPaymentEvent({
    id: store.id("evt"),
    type: "payment_intent.amount_capturable_updated",
    data: {
      object: {
        id: paymentId,
        metadata: { procuremate_order: o.id },
        amount: q.totalCents,
        currency: "hkd",
        status: "requires_capture",
      },
    },
  });
  assert.equal(store.get<Order>("order", o.id)!.paymentId, paymentId);
  assert.equal((await reconcile(o.id, p)).status, "paid");
});
test("changing adapters cannot route an existing pending order through another provider", async () => {
  const { q, m } = await setup();
  const o = await purchase(actor, q.id, m.id, "timeout");
  const p = simulatedPayments();
  p.name = "another-provider";
  let queried = 0;
  const query = p.query;
  p.query = async (...args) => {
    queried++;
    return query(...args);
  };
  await assert.rejects(() => reconcile(o.id, p), /渠道|provider/i);
  assert.equal(queried, 0);
});
test("model output cannot change quantities or budgets; unknown catalog IDs cause disclosed fallback", async () => {
  let output: unknown = {
    productIds: [store.products().find((p) => p.category === "gift")!.id],
    quantity: 9999,
    budgetCents: 99999999,
  };
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* drain fixture request */
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.MODEL_API_KEY = "offline-contract-fixture";
  process.env.MODEL_BASE_URL = `http://127.0.0.1:${port}/v1`;
  try {
    const [q] = await plan(need, actor.id);
    assert.equal(q.planner, "model");
    assert.equal(q.need.budgetCents, need.budgetCents);
    assert.equal(q.lines[0].quantity, need.people);
    output = { productIds: ["not-in-the-catalog"] };
    const [fallback] = await plan(need, actor.id);
    assert.equal(fallback.planner, "rules");
    assert.ok(fallback.warnings.some((w) => w.includes("回退")));
  } finally {
    delete process.env.MODEL_API_KEY;
    delete process.env.MODEL_BASE_URL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("two SQLite writers preserve one internally consistent audit chain", async () => {
  const children = Array.from({ length: 2 }, (_, worker) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
      import('./lib/db.ts').then(({audit,db}) => {
        process.stdout.write('READY\\n');
        process.stdin.once('data', () => {
          for(let i=0;i<100;i++) audit('child-${worker}','CLOSURE_CONCURRENT_AUDIT','concurrency',{worker:${worker},i});
          db.close(); process.stdin.pause();
        });
      }).catch(e => { console.error(e); process.exit(1); });
    `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let error = "";
    child.stderr.on("data", (d) => {
      error += d;
    });
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d) => {
        if (String(d).includes("READY")) resolve();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code) reject(Error(error));
      });
    });
    const done = new Promise<void>((resolve, reject) =>
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(error)),
      ),
    );
    return { child, ready, done };
  });
  await Promise.all(children.map((c) => c.ready));
  children.forEach((c) => c.child.stdin.end("GO"));
  await Promise.all(children.map((c) => c.done));
  assert.equal(store.verifyAudit(), true);
});
test("evidence export includes the full chain beyond the 200-row interface limit", () => {
  assert.ok(store.auditRows().length > 200);
  assert.equal(store.snapshot().audit.length, 200);
  const evidence = store.snapshot(true);
  assert.equal(evidence.audit.length, store.auditRows().length);
  assert.equal(evidence.audit.at(-1)!.previous_hash, "GENESIS");
  assert.equal(evidence.auditValid, true);
});
after(() => {
  store.db.close();
  rmSync(temp, { recursive: true, force: true });
});
