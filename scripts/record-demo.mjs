import { chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
mkdirSync("artifacts/video-raw", { recursive: true });
const cachedBrowser =
  "/Users/pomelo/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(cachedBrowser) ? cachedBrowser : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  baseURL: process.env.DEMO_BASE_URL || "http://127.0.0.1:3200",
  viewport: { width: 1440, height: 1080 },
  recordVideo: {
    dir: "artifacts/video-raw",
    size: { width: 1440, height: 1080 },
  },
});
const page = await context.newPage();
await page.goto(process.env.DEMO_BASE_URL || "http://127.0.0.1:3200");
const started = performance.now();
const coreReport = readFileSync("artifacts/core-test-results.txt", "utf8");
const coreCount = coreReport.match(/pass (\d+)/)?.[1];
const browserReport = JSON.parse(
  readFileSync("artifacts/browser-results.json", "utf8"),
);
if (
  !coreCount ||
  !/fail 0\b/.test(coreReport) ||
  browserReport.stats.unexpected ||
  browserReport.stats.flaky ||
  browserReport.stats.skipped
)
  throw Error("Recording requires passing test evidence.");
async function waitUntil(seconds) {
  const elapsed = (performance.now() - started) / 1000;
  if (elapsed > 240)
    throw Error(
      "Recording exceeded the demo window; inspect host delays before publishing.",
    );
  await page.waitForTimeout(Math.max(1000, (seconds - elapsed) * 1000));
}
async function caption(title, text) {
  console.log(`${Math.round((performance.now() - started) / 1000)}s ${title}`);
  await page.evaluate(
    ({ title, text }) => {
      let el = document.getElementById("demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-caption";
        el.style.cssText =
          "position:fixed;bottom:22px;left:246px;right:28px;z-index:9999;background:rgba(28,57,40,.96);color:#fff;border-radius:12px;padding:19px 25px;box-shadow:0 8px 25px #18392233;pointer-events:none;font-family:system-ui;font-size:17px";
        document.body.appendChild(el);
      }
      el.replaceChildren();
      const h = document.createElement("strong");
      h.textContent = title;
      h.style.cssText =
        "display:block;font-size:20px;margin-bottom:6px;color:#dcebcf";
      const p = document.createElement("span");
      p.textContent = text;
      el.append(h, p);
    },
    { title, text },
  );
}
try {
  await caption(
    "ProcureMate · HacKU 2026",
    "本视频为真实原型操作。模拟支付不流动资金；公司、库存和商户订单为演示数据。",
  );
  await waitUntil(7);
  await page.getByRole("button", { name: "进入工作区" }).click();
  await caption(
    "一次授权，三种采购需求",
    "活动礼品、日常补货、新员工配件，共用同一套预算、权限与支付规则。",
  );
  await waitUntil(15);
  await page.locator(".request-panel").scrollIntoViewIfNeeded();
  await caption(
    "01 · 从活动需求开始",
    "10 位年轻同事，实用简约礼品，预算 HK$2,500，统一办公室收货。需求文本不会增加采购权限。",
  );
  await waitUntil(26);
  await page.getByRole("button", { name: "生成采购方案" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".quote-card").length === 3,
  );
  await page.locator(".quote-card").first().waitFor({ state: "visible" });
  await page.evaluate(() =>
    document
      .querySelector(".quotes-section")
      ?.scrollIntoView({ block: "start" }),
  );
  await caption(
    "02 · 比较完整支出",
    "真实页面价格与派送规则分别记录采集时间。本次现金商品净额满 HK$400，按公开规则免标准运费；未确认积分不计入节省。",
  );
  await waitUntil(34);
  await page.getByLabel("最低容量（ml，可不填）").fill("500");
  await page.getByLabel("保温要求").selectOption("yes");
  await page.getByRole("button", { name: "生成采购方案" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".quote-card").length === 1,
  );
  await page.locator(".quote-card").first().waitFor({ state: "visible" });
  await page.evaluate(() =>
    document
      .querySelector(".quotes-section")
      ?.scrollIntoView({ block: "start" }),
  );
  await page
    .locator(".quote-card")
    .first()
    .getByText("查看筛选依据", { exact: true })
    .click();
  await caption(
    "必要规格是硬约束",
    "增加至少 500 ml 与来源明确标注保温要求，只剩一套符合条件的方案。可查看容量不足、保温未知和预算超限的排除依据。",
  );
  await waitUntil(42);
  await page
    .locator(".quote-card")
    .first()
    .getByRole("button", { name: "确认授权并采购" })
    .click();
  await caption(
    "03 · 负责人确认边界",
    "确认金额、品类、商户、有效期和替换权限。代理无法自行提高预算或延长授权。",
  );
  await waitUntil(56);
  await page
    .getByRole("button", { name: "确认授权并执行", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("已付款 · 待收货", { exact: true })
    .waitFor();
  await caption(
    "04 · 测试交易完成",
    "服务端先检查并预留预算，付款授权后再复核，最后确认扣款。记录保留报价与授权版本。",
  );
  await waitUntil(72);
  await page.getByRole("button", { name: "确认收货入库" }).click();
  await caption(
    "收货与资金分别记账",
    "付款成功建立在途订单；收货确认才增加库存。重复确认不会重复入库。",
  );
  await waitUntil(84);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator(".quote-card")
    .first()
    .getByRole("button", { name: "演示运费使预算超限" })
    .click();
  await caption(
    "05 · 独立小额订单边界测试",
    "这次单件商品未满 HK$400，须加 HK$80 标准运费；授权只覆盖商品金额。原来的 10 人活动需求保持不变。",
  );
  await waitUntil(96);
  await page
    .getByRole("button", { name: "确认授权并执行", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("已被规则拦截", { exact: true })
    .waitFor();
  await caption(
    "规则确实拦停了代理",
    "订单显示“没有发起付款”。可核对后端规则记录，而不是仅在前端显示一条警告。",
  );
  await waitUntil(110);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /日常补货.*库存触发/ }).click();
  await page.locator(".request-panel").scrollIntoViewIfNeeded();
  await caption(
    "06 · 库存驱动日常补货",
    "领用减少库存；达到安全线后，扣除在途量补至目标。缺少有效授权时只预警，不擅自购买。",
  );
  await page
    .getByRole("button", { name: "生成方案", exact: true })
    .first()
    .click();
  await page.locator(".quote-card").first().waitFor({ state: "visible" });
  await page.evaluate(() =>
    document
      .querySelector(".quotes-section")
      ?.scrollIntoView({ block: "start" }),
  );
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
  await page
    .getByRole("dialog")
    .getByText("已付款 · 待收货", { exact: true })
    .waitFor();
  await waitUntil(126);
  await page.getByRole("button", { name: "确认收货入库" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "库存与补货", exact: true }).click();
  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "记录领用" })
    .click();
  await page.getByRole("dialog").getByRole("spinbutton").fill("16");
  await page.getByRole("button", { name: "确认领用并检查补货" }).click();
  await caption(
    "领用触发第二笔授权内采购",
    "负责人批准累计 HK$5,000、最短间隔 0 秒。领用 16 盒后自动补货，库存 4、在途 16；再次检查不会重复付款。",
  );
  await waitUntil(138);
  await page.getByRole("button", { name: "采购工作台", exact: true }).click();
  await page.getByRole("button", { name: /新员工配件.*按岗位需求/ }).click();
  await page.getByRole("button", { name: "生成采购方案" }).click();
  await page.locator(".quote-card").first().waitFor({ state: "visible" });
  await page.evaluate(() =>
    document
      .querySelector(".quotes-section")
      ?.scrollIntoView({ block: "start" }),
  );
  await caption(
    "07 · 按岗位配置新员工配件",
    "开发、设计、行政使用不同模板。缺少设备接口时要求补充，不猜测兼容性。",
  );
  await waitUntil(153);
  await page.getByRole("button", { name: "执行记录", exact: true }).click();
  const block = page
    .locator(".audit-item")
    .filter({ hasText: "规则拦截采购" })
    .first();
  await block.scrollIntoViewIfNeeded();
  await block.locator("summary").click();
  await caption(
    "每一个决定，都有依据",
    "记录包含触发规则、金额、报价和授权版本。哈希链检查内部一致性，不声称运营者无法重写。",
  );
  const evidence = await page.request.get("/api/evidence");
  writeFileSync(
    "artifacts/demo-evidence.json",
    JSON.stringify(await evidence.json(), null, 2),
  );
  await waitUntil(164);
  await page.goto(
    new URL("/study", process.env.DEMO_BASE_URL || "http://127.0.0.1:3200")
      .href,
  );
  await page.getByRole("heading", { name: "人工与代理采购对照" }).waitFor();
  await caption(
    "真人对照工具已准备，结果仍待采集",
    "同一任务、固定商品与费用快照、服务端计时、完整步骤观察和错误记录。当前零名真人参与者；自动化测试不能代替人工路线证据。",
  );
  const study = await (await page.request.get("/api/study/report")).json();
  if (study.participants !== 0)
    throw Error("Fresh demo should not contain fabricated study participants.");
  writeFileSync(
    "artifacts/demo-study-state.json",
    JSON.stringify(study, null, 2),
  );
  await waitUntil(173);
  await page.goto(process.env.DEMO_BASE_URL || "http://127.0.0.1:3200");
  await page.getByRole("button", { name: "采购工作台", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await caption(
    "ProcureMate · 采购有条理，花钱有分寸",
    `${coreCount} 项核心测试、${browserReport.stats.expected} 条浏览器流程通过 · 16 个商品来源快照 · 当前演示为规则规划与模拟支付，真实 AI 与支付接入仍待验证。`,
  );
  await waitUntil(180);
  const video = page.video();
  await context.close();
  const path = await video.path();
  renameSync(path, "artifacts/video-raw/ProcureMate-source.webm");
  console.log(
    "Saved artifacts/video-raw/ProcureMate-source.webm; normalize and inspect before publishing.",
  );
} finally {
  await browser.close();
}
