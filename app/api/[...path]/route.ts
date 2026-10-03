import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actors, login, logout, session } from "@/lib/auth";
import {
  atomic,
  audit,
  db,
  get,
  id,
  inventory,
  list,
  now,
  put,
  snapshot,
  products,
} from "@/lib/db";
import { plan } from "@/lib/planner";
import { checks } from "@/lib/policy";
import {
  consume,
  monitor,
  purchase,
  receive,
  reconcile,
  refund,
  returnGoods,
  revoke,
} from "@/lib/engine";
import { mandateSchema, needSchema } from "@/lib/schemas";
import type { Mandate, Order, Quote } from "@/lib/types";
import {
  createStudy,
  startStudy,
  studyAction,
  studyPlan,
  finishStudy,
  studyReport,
  studyCreateSchema,
  studyFinishSchema,
} from "@/lib/study";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path.join("/");
  try {
    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== req.headers.get("host"))
        return NextResponse.json(
          { error: "请求来源不匹配。" },
          { status: 403 },
        );
    }
    if (path === "auth/login" && req.method === "POST") {
      const data = z
        .object({
          username: z.enum(["manager", "buyer"]),
          password: z.string().max(200),
        })
        .parse(await req.json());
      const result = login(data.username, data.password);
      if (!result)
        return NextResponse.json(
          { error: "账号或密码不正确。" },
          { status: 401 },
        );
      const response = NextResponse.json({ actor: result.actor });
      response.cookies.set("pm_session", result.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 12 * 3600,
      });
      return response;
    }
    const actor = session(req);
    if (!actor)
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    if (path === "auth/logout" && req.method === "POST") {
      logout(req);
      const r = NextResponse.json({ ok: true });
      r.cookies.delete("pm_session");
      return r;
    }
    if (path === "study/report" && req.method === "GET")
      return NextResponse.json(studyReport(actor));
    if (path === "study/create" && req.method === "POST")
      return NextResponse.json({
        session: createStudy(studyCreateSchema.parse(await req.json()), actor),
      });
    if (path === "study/start" && req.method === "POST") {
      const data = z
        .object({ sessionId: z.string(), method: z.enum(["manual", "agent"]) })
        .parse(await req.json());
      return NextResponse.json({
        session: startStudy(data.sessionId, data.method, actor),
      });
    }
    if (path === "study/action" && req.method === "POST") {
      const data = z
        .object({
          sessionId: z.string(),
          method: z.enum(["manual", "agent"]),
          actionId: z.string().min(1).max(80),
          purpose: z.enum([
            "view_source",
            "read_policy",
            "edit_selection",
            "edit_answer",
            "choose_quote",
            "use_helper",
          ]),
        })
        .parse(await req.json());
      return NextResponse.json({
        session: studyAction(
          data.sessionId,
          data.method,
          data.actionId,
          data.purpose,
          actor,
        ),
      });
    }
    if (path === "study/plan" && req.method === "POST") {
      const data = z.object({ sessionId: z.string() }).parse(await req.json());
      return NextResponse.json(await studyPlan(data.sessionId, actor));
    }
    if (path === "study/finish" && req.method === "POST")
      return NextResponse.json({
        session: finishStudy(studyFinishSchema.parse(await req.json()), actor),
      });
    if (path === "state" && req.method === "GET")
      return NextResponse.json({ ...snapshot(), actor });
    if (path === "evidence" && req.method === "GET")
      return NextResponse.json(
        {
          exportedAt: now(),
          disclosure:
            "测试公司、库存与商户订单；商品为真实来源快照。哈希链仅检查导出内部一致性，不证明运营者无法重写。",
          ...snapshot(true),
        },
        {
          headers: {
            "Content-Disposition":
              'attachment; filename="procuremate-evidence.json"',
          },
        },
      );
    if (path === "plan" && req.method === "POST") {
      const need = needSchema.parse(await req.json());
      if (need.scenario === "replenishment") {
        const stock = inventory().find((i) => i.productId === need.sku);
        if (!stock || !need.quantity || need.quantity > stock.suggestion)
          throw new Error("补货数量超过当前库存需求。");
      }
      return NextResponse.json({ quotes: await plan(need, actor.id) });
    }
    if (path === "mandates" && req.method === "POST") {
      if (actor.role !== "manager")
        return NextResponse.json(
          { error: "只有负责人可以授予采购权限。" },
          { status: 403 },
        );
      const data = mandateSchema.parse(await req.json());
      if (Date.parse(data.expiresAt) <= Date.now())
        throw new Error("新授权的有效期必须在未来。");
      if (data.totalCapCents < data.capCents)
        throw new Error("累计预算不得小于单次上限。");
      const quote = data.quoteId
        ? get<Quote>("quote", data.quoteId)
        : undefined;
      if (data.scenario !== "replenishment" && !quote)
        throw new Error("一次性授权需要指定采购需求。");
      if (quote && quote.scenario !== data.scenario)
        throw new Error("授权场景不一致。");
      if (!data.productIds.every((v) => products().some((p) => p.id === v)))
        throw new Error("授权商品不在目录内。");
      const m: Mandate = {
        ...data,
        id: id("mandate"),
        requestId: data.scenario === "replenishment" ? null : quote!.requestId,
        createdAt: now(),
        revokedAt: null,
        version: 1,
        rewardOwner: "company",
        actor: actor.id,
      };
      atomic(() => {
        put("mandate", m);
        audit(actor.id, "MANDATE_GRANTED", m.id, m);
      });
      return NextResponse.json({ mandate: m });
    }
    if (path === "checks" && req.method === "POST") {
      const data = z
        .object({ quoteId: z.string(), mandateId: z.string() })
        .parse(await req.json());
      const q = get<Quote>("quote", data.quoteId);
      const m = get<Mandate>("mandate", data.mandateId);
      if (!q || !m) throw new Error("方案或授权不存在。");
      return NextResponse.json({ checks: checks(q, m) });
    }
    if (path === "purchase" && req.method === "POST") {
      const data = z
        .object({
          quoteId: z.string(),
          mandateId: z.string(),
          behavior: z
            .enum(["success", "decline", "timeout"])
            .default("success"),
        })
        .parse(await req.json());
      return NextResponse.json({
        order: await purchase(
          actor,
          data.quoteId,
          data.mandateId,
          data.behavior,
        ),
      });
    }
    if (path === "revoke" && req.method === "POST") {
      if (actor.role !== "manager")
        return NextResponse.json(
          { error: "需要负责人权限。" },
          { status: 403 },
        );
      const data = z.object({ mandateId: z.string() }).parse(await req.json());
      return NextResponse.json({
        mandate: await revoke(actor, data.mandateId),
      });
    }
    if (path === "receive" && req.method === "POST") {
      const data = z.object({ orderId: z.string() }).parse(await req.json());
      return NextResponse.json({ order: receive(actor, data.orderId) });
    }
    if (path === "return-goods" && req.method === "POST") {
      const data = z.object({ orderId: z.string() }).parse(await req.json());
      return NextResponse.json({ order: returnGoods(actor, data.orderId) });
    }
    if (path === "refund" && req.method === "POST") {
      if (actor.role !== "manager")
        return NextResponse.json(
          { error: "需要负责人权限。" },
          { status: 403 },
        );
      const data = z.object({ orderId: z.string() }).parse(await req.json());
      return NextResponse.json({ order: await refund(actor, data.orderId) });
    }
    if (path === "reconcile" && req.method === "POST") {
      const data = z.object({ orderId: z.string() }).parse(await req.json());
      return NextResponse.json({ order: await reconcile(data.orderId) });
    }
    if (path === "consume" && req.method === "POST") {
      const data = z
        .object({
          productId: z.string(),
          quantity: z.number().int().min(1).max(10000),
          reason: z.string().min(1).max(200),
        })
        .parse(await req.json());
      consume(actor, data.productId, data.quantity, data.reason);
      return NextResponse.json({ ok: true, monitor: await monitor() });
    }
    if (path === "inventory/settings" && req.method === "POST") {
      if (actor.role !== "manager")
        return NextResponse.json(
          { error: "需要负责人权限。" },
          { status: 403 },
        );
      const data = z
        .object({
          productId: z.string(),
          safety: z.number().int().min(0).max(1000),
          target: z.number().int().min(1).max(1000),
        })
        .parse(await req.json());
      if (data.target <= data.safety)
        throw new Error("目标库存必须高于安全库存。");
      atomic(() => {
        const r = db
          .prepare("UPDATE inventory SET safety=?,target=? WHERE product_id=?")
          .run(data.safety, data.target, data.productId);
        if (!r.changes) throw new Error("库存物品不存在。");
        audit(actor.id, "INVENTORY_POLICY_UPDATED", data.productId, data);
      });
      return NextResponse.json({ ok: true });
    }
    if (path === "monitor" && req.method === "POST")
      return NextResponse.json({ results: await monitor() });
    if (path === "demo/quote-shipping" && req.method === "POST") {
      if (actor.role !== "manager")
        return NextResponse.json(
          { error: "需要负责人权限。" },
          { status: 403 },
        );
      const data = z.object({ quoteId: z.string() }).parse(await req.json());
      const original = get<Quote>("quote", data.quoteId);
      if (!original) throw new Error("方案不存在。");
      // Independent boundary case: keep the real ten-person requirement intact.
      const candidates = await plan(
        {
          ...original.need,
          scenario: "event",
          people: 1,
          title: "独立小额运费拦截测试",
          brief: "单件现金商品，授权只覆盖商品金额。原采购需求保持不变。",
        },
        actor.id,
      );
      const quote = candidates.find((q) => q.shippingCents > 0);
      if (!quote) throw new Error("当前目录没有适用于运费拦截测试的小额商品。");
      quote.warnings.push("独立小额边界测试；不改变原采购人数和方案。");
      put("quote", quote);
      audit(actor.id, "DEMO_QUOTE_CHECK", quote.id, {
        originalQuoteId: original.id,
        independentTest: true,
        shippingEvidence: quote.shippingEvidence,
      });
      return NextResponse.json({ quote });
    }
    if (path === "measurements" && req.method === "POST") {
      const data = z
        .object({
          participant: z.string().min(1).max(60),
          method: z.enum(["manual", "agent"]),
          seconds: z.number().min(0).max(86400),
          steps: z.number().int().min(0).max(1000),
          costCents: z.number().int().min(0),
          errors: z.number().int().min(0),
          note: z.string().max(1000),
        })
        .parse(await req.json());
      const m = {
        id: id("measurement"),
        ...data,
        at: now(),
        population: "学生角色任务测试",
      };
      db.prepare("INSERT INTO measurements VALUES(?,?)").run(
        m.id,
        JSON.stringify(m),
      );
      audit(actor.id, "MEASUREMENT_RECORDED", m.id, m);
      return NextResponse.json({ measurement: m });
    }
    return NextResponse.json(
      { error: "接口不存在或请求方法不支持。" },
      { status: 404 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues
                .map((v) => `${v.path.join(".")}: ${v.message}`)
                .join("；")
            : e instanceof Error
              ? e.message
              : "请求失败。",
      },
      { status: 400 },
    );
  }
}
export const GET = handle;
export const POST = handle;
