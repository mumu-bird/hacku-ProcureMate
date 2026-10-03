import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// Loads credentials locally. Never writes keys, request headers or raw provider errors.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const runId = `integration_${randomUUID()}`;
process.env.PROCUREMATE_DB = resolve("data", `${runId}.sqlite`);
const report: {
  runId: string;
  observedAt: string;
  scope: string;
  model: Record<string, unknown>;
  stripe: Record<string, unknown>;
} = {
  runId,
  observedAt: new Date().toISOString(),
  scope:
    "真实网络验证；Stripe 仅沙箱测试收款，不是 The Club 商户订单；不证明 webhook 或支付委托可行性。",
  model: { status: "not_configured" },
  stripe: { status: "not_configured" },
};
const { db } = await import("../lib/db");
try {
  if (process.env.MODEL_API_KEY) {
    report.model = {
      status: "failed",
      model: process.env.MODEL_NAME || "gpt-4.1-mini",
    };
    try {
      const { plan } = await import("../lib/planner");
      const base = {
        scenario: "event" as const,
        title: "外部模型验证",
        brief: "采购活动礼品，不更改预算或数量",
        people: 10,
        budgetCents: 250000,
        style: "简约",
        job: "developer",
        connectors: ["USB-C"],
        address: "香港办公室",
      };
      const runs = [];
      for (const need of [
        base,
        { ...base, style: "活力", minCapacityMl: 500, requiresInsulated: true },
      ]) {
        const qs = await plan(need, "integration-verifier");
        const decision = qs[0]?.decision;
        runs.push({
          requestId: qs[0]?.requestId,
          model: decision?.model,
          productIds: qs.map((q) => q.lines.map((l) => l.productId)),
          amounts: qs.map((q) => q.totalCents),
          constraintsSatisfied: qs.every(
            (q) => q.totalCents <= need.budgetCents,
          ),
        });
      }
      report.model.runs = runs;
      report.model.status = runs.every(
        (r) => r.model?.status === "validated" && r.constraintsSatisfied,
      )
        ? "verified"
        : "failed";
    } catch {
      report.model.reason =
        "真实模型请求或目录、需求校验未通过；检查本地配置，不把规则回退算作集成成功。";
    }
  }
  if (process.env.STRIPE_SECRET_KEY) {
    report.stripe = {
      status: "failed",
      rail: "Stripe test PaymentIntent",
      states: [],
    };
    if (!process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
      report.stripe.reason = "拒绝非测试密钥；没有发起 Stripe 调用。";
    } else {
      process.env.PAYMENT_PROVIDER = "stripe";
      const states: unknown[] = [];
      report.stripe.states = states;
      let paymentId: string | undefined;
      let captured = false;
      try {
        const { paymentProvider } = await import("../lib/payments");
        const p = paymentProvider();
        const authorized = await p.authorize(10000, runId, "success");
        states.push({ stage: "authorize", ...authorized });
        paymentId = authorized.id;
        if (
          authorized.state !== "authorized" ||
          authorized.amount !== 10000 ||
          authorized.currency !== "hkd"
        )
          throw new Error("mismatch");
        const paid = await p.capture(paymentId, runId);
        states.push({ stage: "capture", ...paid });
        captured = paid.state === "succeeded";
        if (!captured) throw new Error("capture unknown");
        const queried = await p.query(paymentId);
        states.push({ stage: "query", ...queried });
        const refunded = await p.refund(paymentId, runId);
        states.push({ stage: "refund", ...refunded });
        if (queried.state !== "succeeded" || refunded.state !== "refunded")
          throw new Error("state mismatch");
        const second = await p.authorize(10000, `${runId}_cancel`, "success");
        states.push({ stage: "second-authorize", ...second });
        paymentId = second.id;
        captured = false;
        const cancelled = await p.cancel(second.id);
        states.push({ stage: "cancel", ...cancelled });
        if (cancelled.state !== "cancelled") throw new Error("cancel unknown");
        report.stripe.status = "verified";
      } catch {
        report.stripe.reason =
          "沙箱调用未全部通过。保留本地数据库和支付编号核对；不会自动重试扣款。";
        // Best effort cancellation only. An uncertain or captured payment is never blindly captured again.
        if (paymentId && !captured) {
          try {
            const { paymentProvider } = await import("../lib/payments");
            const p = paymentProvider();
            const current = await p.query(paymentId);
            states.push({ stage: "failure-query", ...current });
            if (current.state === "authorized")
              states.push({
                stage: "failure-cancel",
                ...(await p.cancel(paymentId)),
              });
          } catch {
            report.stripe.followUp =
              "支付结果仍不确定，需在 Stripe 测试 Dashboard 核对。";
          }
        }
      }
    }
  }
} finally {
  db.close();
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/integration-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      model: report.model.status,
      stripe: report.stripe.status,
      report: "artifacts/integration-verification.json",
    }),
  );
  process.exitCode =
    report.model.status === "verified" && report.stripe.status === "verified"
      ? 0
      : 2;
}
