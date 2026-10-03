import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
mkdirSync("artifacts", { recursive: true });
test("event purchase, receipt, refund and independently checked shipping stop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "进入工作区" }).click();
  await expect(
    page.getByRole("heading", { name: "每一笔采购，都心里有数。" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/workspace.png", fullPage: true });
  await page.getByRole("button", { name: "生成采购方案" }).click();
  await expect(page.locator(".quote-card")).toHaveCount(3);
  const original = (await (await page.request.get("/api/state")).json())
    .quotes[0];
  expect(original.shippingCents).toBe(0);
  await page.screenshot({ path: "artifacts/quotes.png", fullPage: true });
  await page
    .locator(".quote-card")
    .first()
    .getByRole("button", { name: "确认授权并采购" })
    .click();
  await page
    .getByRole("button", { name: "确认授权并执行", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("已付款 · 待收货", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认收货入库" }).click();
  await expect(
    page.getByRole("dialog").getByText("已收货", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "申请测试退款" }).click();
  await expect(
    page.getByRole("dialog").getByText("已退款", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认整单实物退回" }).click();
  await expect(
    page.getByRole("button", { name: "确认整单实物退回" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator(".quote-card")
    .nth(1)
    .getByRole("button", { name: "演示运费使预算超限" })
    .click();
  await page
    .getByRole("button", { name: "确认授权并执行", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("已被规则拦截", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("没有发起付款", { exact: true }),
  ).toBeVisible();
  const evidence = await (await page.request.get("/api/evidence")).json();
  const stopped = evidence.orders.find((o: any) => o.status === "blocked");
  expect(stopped.quote.need.people).toBe(1);
  expect(stopped.quote.shippingCents).toBe(8000);
  expect(
    evidence.quotes.find((q: any) => q.id === original.id).need.people,
  ).toBe(10);
  expect(
    evidence.audit.some(
      (a: any) => a.target === stopped.id && a.action === "PAYMENT_AUTHORIZE",
    ),
  ).toBe(false);
  let previous = "GENESIS";
  for (const r of [...evidence.audit].reverse()) {
    expect(r.previous_hash).toBe(previous);
    expect(
      createHash("sha256")
        .update(
          JSON.stringify({
            id: r.id,
            at: r.at,
            actor: r.actor,
            action: r.action,
            target: r.target,
            detail: r.detail,
            previousHash: r.previous_hash,
          }),
        )
        .digest("hex"),
    ).toBe(r.hash);
    previous = r.hash;
  }
  await page.screenshot({ path: "artifacts/blocked.png", fullPage: false });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "授权与预算", exact: true }).click();
  const count = await page.getByRole("button", { name: "撤销授权" }).count();
  expect(count).toBeGreaterThan(0);
  await page.getByRole("button", { name: "撤销授权" }).first().click();
  await expect(page.getByText("已撤销", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "执行记录", exact: true }).click();
  await expect(page.getByText("内部一致性通过", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("replenishment receipt and consumption trigger a second authorized transaction without duplicate purchase", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入工作区" }).click();
  await page.getByRole("button", { name: /日常补货.*库存触发/ }).click();
  const generate = page.getByRole("button", { name: "生成方案", exact: true });
  await generate.first().click();
  await page
    .locator(".quote-card")
    .first()
    .getByRole("button", { name: "确认授权并采购" })
    .click();
  await page.getByLabel("累计预算（HK$）").fill("5000");
  await page.getByLabel("最短执行间隔（秒）").fill("0");
  await page
    .getByRole("button", { name: "确认授权并执行", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("已付款 · 待收货", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认收货入库" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "库存与补货", exact: true }).click();
  await expect(
    page.locator("tbody tr").first().getByText("20", { exact: true }),
  ).toBeVisible();
  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "记录领用" })
    .click();
  await page.getByRole("dialog").getByRole("spinbutton").fill("16");
  await page.getByRole("button", { name: "确认领用并检查补货" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator("tbody tr").first().getByText("4", { exact: true }),
  ).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  const replenished = state.orders.filter(
    (o: any) => o.quote.scenario === "replenishment",
  );
  expect(replenished).toHaveLength(2);
  const auto = replenished.find((o: any) => o.status === "paid");
  expect(auto).toBeTruthy();
  expect(
    state.inventory.find(
      (i: any) => i.productId === auto.quote.lines[0].productId,
    ).inTransit,
  ).toBe(16);
  await Promise.all([
    page.request.post("/api/monitor", { data: {} }),
    page.request.post("/api/monitor", { data: {} }),
  ]);
  const noDuplicates = await (await page.request.get("/api/state")).json();
  expect(
    noDuplicates.orders.filter(
      (o: any) => o.quote.scenario === "replenishment",
    ),
  ).toHaveLength(2);
  await page.screenshot({ path: "artifacts/inventory.png", fullPage: true });
  expect(
    (
      await page.request.post("/api/receive", { data: { orderId: auto.id } })
    ).status(),
  ).toBe(200);
  const closed = await (await page.request.get("/api/state")).json();
  expect(
    closed.inventory.find(
      (i: any) => i.productId === auto.quote.lines[0].productId,
    ).quantity,
  ).toBe(20);
  expect(
    closed.inventory.find(
      (i: any) => i.productId === auto.quote.lines[0].productId,
    ).inTransit,
  ).toBe(0);
});
test("onboarding variants, session access control, invalid payload and responsive layout", async ({
  page,
  request,
}) => {
  const anonymous = await request.get("/api/state");
  expect(anonymous.status()).toBe(401);
  await page.goto("/");
  await page.getByRole("button", { name: "采购成员", exact: false }).click();
  await page.getByRole("button", { name: "进入工作区" }).click();
  await page.getByRole("button", { name: /新员工配件.*按岗位需求/ }).click();
  await page.getByRole("button", { name: "生成采购方案" }).click();
  await expect(page.locator(".quote-card")).toHaveCount(3);
  const forbidden = await page.request.post("/api/mandates", { data: {} });
  expect(forbidden.status()).toBe(403);
  const revoke = await page.request.post("/api/revoke", {
    data: { mandateId: "not-real" },
  });
  expect(revoke.status()).toBe(403);
  const invalid = await page.request.post("/api/consume", {
    data: { productId: "coffee-black", quantity: -1, reason: "bad" },
  });
  expect(invalid.status()).toBe(400);
  const webhook = await page.request.post("/api/stripe/webhook", {
    data: { id: "unsigned" },
  });
  expect(webhook.status()).toBe(503);
  const origin = await page.request.post("/api/monitor", {
    headers: { origin: "https://evil.example" },
    data: {},
  });
  expect(origin.status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
