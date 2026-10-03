import { createHash } from "node:crypto";
import { z } from "zod";
import { atomic, audit, get, id, list, now, products, put } from "./db";
import { shippingPolicy } from "./shipping";
import { plan } from "./planner";
import type { Actor, Need, Product, Quote } from "./types";
export type StudyMethod = "manual" | "agent";
export type StudyTrial = {
  method: StudyMethod;
  status: "ready" | "running" | "submitted" | "abandoned";
  startedAt?: string;
  endedAt?: string;
  seconds?: number;
  actions: { id: string; purpose: string; at: string }[];
  quoteIds?: string[];
  answer?: StudyAnswer;
  observedSteps?: number;
  helpCount?: number;
  note?: string;
  validation?: { errors: string[]; actualCostCents: number | null };
};
export type StudySession = {
  id: string;
  participant: string;
  createdAt: string;
  actor: string;
  humanConfirmed: boolean;
  population: "学生角色任务";
  taskId: string;
  digest: string;
  need: Need;
  catalog: Product[];
  policy: typeof shippingPolicy;
  trials: StudyTrial[];
};
export type StudyAnswer = {
  productId: string;
  quantity: number;
  costCents: number;
  capCents: number;
  category: string;
  merchant: string;
  expiryHours: number;
  rewardOwner: string;
  decision: "proceed" | "stop";
};
export const studyCreateSchema = z.object({
  participant: z.string().regex(/^P\d{2,3}$/),
  humanConfirmed: z.literal(true),
  first: z.enum(["manual", "agent"]),
});
export const studyFinishSchema = z
  .object({
    sessionId: z.string(),
    method: z.enum(["manual", "agent"]),
    abandoned: z.boolean().default(false),
    observedSteps: z.number().int().min(0).max(1000),
    helpCount: z.number().int().min(0).max(100),
    note: z.string().max(1000),
    answer: z
      .object({
        productId: z.string().max(100),
        quantity: z.number().int().min(0).max(1000),
        costCents: z.number().int().min(0).max(10000000),
        capCents: z.number().int().min(0).max(10000000),
        category: z.string().max(60),
        merchant: z.string().max(100),
        expiryHours: z.number().min(0).max(10000),
        rewardOwner: z.string().max(30),
        decision: z.enum(["proceed", "stop"]),
      })
      .optional(),
  })
  .refine(
    (v) => v.abandoned || v.answer,
    "提交任务必须填写方案；放弃须如实记录",
  )
  .refine(
    (v) => v.abandoned || v.observedSteps > 0,
    "提交任务须由主持人填写实际完整步骤数，不能把未观察当作零步骤",
  );
function manager(actor: Actor) {
  if (actor.role !== "manager") throw Error("对照测试须由负责人主持记录。");
}
function digest(catalog: Product[], policy: typeof shippingPolicy) {
  return createHash("sha256")
    .update(JSON.stringify({ catalog, policy }))
    .digest("hex");
}
export function createStudy(
  input: z.infer<typeof studyCreateSchema>,
  actor: Actor,
) {
  manager(actor);
  return atomic(() => {
    if (
      list<StudySession>("study").some(
        (s) => s.participant === input.participant,
      )
    )
      throw Error(
        "该匿名参与者已有记录，请继续原测试；不能覆盖或挑选较好结果。",
      );
    const catalog = products().filter((p) => p.category === "gift");
    const s: StudySession = {
      id: id("study"),
      participant: input.participant,
      createdAt: now(),
      actor: actor.id,
      humanConfirmed: true,
      population: "学生角色任务",
      taskId: "event-ten-gifts-v1",
      digest: digest(catalog, shippingPolicy),
      catalog,
      policy: shippingPolicy,
      need: {
        scenario: "event",
        title: "十人活动礼品对照",
        brief:
          "为十位年轻同事各采购一件实用简约饮水杯或瓶，准备可核对的采购方案与授权边界。",
        people: 10,
        budgetCents: 250000,
        style: "简约",
        strategy: "balanced",
        job: "developer",
        connectors: [],
        address: "香港办公室",
      },
      trials: [input.first, input.first === "manual" ? "agent" : "manual"].map(
        (method) => ({
          method: method as StudyMethod,
          status: "ready",
          actions: [],
        }),
      ),
    };
    put("study", s);
    audit(actor.id, "STUDY_CREATED", s.id, {
      participant: s.participant,
      taskId: s.taskId,
      digest: s.digest,
      humanConfirmed: true,
      order: s.trials.map((t) => t.method),
    });
    return s;
  });
}
function load(key: string, actor: Actor) {
  manager(actor);
  const s = get<StudySession>("study", key);
  if (!s) throw Error("对照测试不存在。");
  return s;
}
export function startStudy(key: string, method: StudyMethod, actor: Actor) {
  return atomic(() => {
    const s = load(key, actor);
    const index = s.trials.findIndex((t) => t.method === method);
    const t = s.trials[index];
    if (t.status !== "ready") return s;
    if (
      index > 0 &&
      !["submitted", "abandoned"].includes(s.trials[index - 1].status)
    )
      throw Error("请先结束第一条路线，按预定顺序完成对照。");
    t.status = "running";
    t.startedAt = now();
    put("study", s);
    audit(actor.id, "STUDY_STARTED", s.id, {
      method,
      startedAt: t.startedAt,
      digest: s.digest,
    });
    return s;
  });
}
export function studyAction(
  key: string,
  method: StudyMethod,
  actionId: string,
  purpose: string,
  actor: Actor,
) {
  return atomic(() => {
    const s = load(key, actor);
    const t = s.trials.find((t) => t.method === method)!;
    if (t.status !== "running") throw Error("该路线未开始或已结束。");
    if (t.actions.some((a) => a.id === actionId)) return s;
    if (t.actions.length >= 1000) throw Error("操作记录已达到上限。");
    t.actions.push({ id: actionId, purpose, at: now() });
    put("study", s);
    return s;
  });
}
export async function studyPlan(key: string, actor: Actor) {
  const s = load(key, actor);
  const t = s.trials.find((t) => t.method === "agent")!;
  if (t.status !== "running") throw Error("请先开始代理路线。");
  if (t.quoteIds?.length)
    return {
      session: s,
      quotes: t.quoteIds.map((q) => get<Quote>("quote", q)!).filter(Boolean),
    };
  if (
    digest(
      products().filter((p) => p.category === "gift"),
      shippingPolicy,
    ) !== s.digest
  )
    throw Error(
      "目录或费用规则已改变。为保持公平，本测试不能继续生成方案；请记录中断。",
    );
  const qs = await plan(s.need, actor.id);
  return atomic(() => {
    const fresh = load(key, actor);
    const trial = fresh.trials.find((t) => t.method === "agent")!;
    if (trial.status !== "running")
      throw Error("该测试已结束；新方案不计入已结束记录。");
    if (
      digest(
        products().filter((p) => p.category === "gift"),
        shippingPolicy,
      ) !== s.digest
    )
      throw Error("规划期间来源发生变化，不能用于该对照。");
    if (!trial.quoteIds?.length) trial.quoteIds = qs.map((q) => q.id);
    put("study", fresh);
    return {
      session: fresh,
      quotes: trial.quoteIds
        .map((q) => get<Quote>("quote", q)!)
        .filter(Boolean),
    };
  });
}
export function validateStudyAnswer(s: StudySession, a: StudyAnswer) {
  const p = s.catalog.find((p) => p.id === a.productId);
  const errors: string[] = [];
  const subtotal = p ? p.priceCents * a.quantity : null;
  const actualCostCents =
    subtotal === null
      ? null
      : subtotal +
        (subtotal >= s.policy.freeDeliveryThresholdCents
          ? 0
          : s.policy.baseDeliveryCents);
  if (!p) errors.push("所选商品不在固定礼品目录");
  if (a.quantity !== s.need.people) errors.push("每人一件的数量要求未满足");
  if (actualCostCents !== a.costCents)
    errors.push("所填完整费用与固定来源核算不一致");
  if (actualCostCents === null || actualCostCents > s.need.budgetCents)
    errors.push("没有满足需求预算的有效方案");
  if (
    actualCostCents === null ||
    a.capCents < actualCostCents ||
    a.capCents > s.need.budgetCents
  )
    errors.push("授权金额不足或超过需求预算");
  if (a.category !== "gift") errors.push("授权品类应为礼品");
  if (a.merchant !== "The Club") errors.push("授权商户未与商品来源一致");
  if (a.expiryHours <= 0 || a.expiryHours > 720)
    errors.push("授权有效期不在任务允许范围");
  if (a.rewardOwner !== "company") errors.push("个人奖励不能算作公司节省");
  if (a.decision !== "proceed")
    errors.push("任务终点应是准备好合规方案并说明可按授权继续，不实际付款");
  return { errors, actualCostCents };
}
export function finishStudy(
  input: z.infer<typeof studyFinishSchema>,
  actor: Actor,
) {
  return atomic(() => {
    const s = load(input.sessionId, actor);
    const t = s.trials.find((t) => t.method === input.method)!;
    if (["submitted", "abandoned"].includes(t.status)) return s;
    if (t.status !== "running" || !t.startedAt)
      throw Error("请先开始任务计时。");
    if (input.abandoned && !input.note.trim())
      throw Error("放弃或中断须填写原因。");
    t.endedAt = now();
    t.seconds = Math.max(
      0,
      (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000,
    );
    t.status = input.abandoned ? "abandoned" : "submitted";
    t.observedSteps = input.observedSteps;
    t.helpCount = input.helpCount;
    t.note = input.note;
    if (!input.abandoned && input.answer) {
      t.answer = input.answer;
      t.validation = validateStudyAnswer(s, input.answer);
    }
    put("study", s);
    audit(actor.id, "STUDY_FINISHED", s.id, {
      method: t.method,
      status: t.status,
      seconds: t.seconds,
      observedSteps: t.observedSteps,
      recordedUiActions: t.actions.length,
      validation: t.validation,
      helpCount: t.helpCount,
      digest: s.digest,
    });
    return s;
  });
}
function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const i = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[i] : (ordered[i - 1] + ordered[i]) / 2;
}
export function summarizeStudies(sessions: StudySession[]) {
  const groups = [...new Set(sessions.map((s) => s.digest))].map((d) => {
    const records = sessions.filter((s) => s.digest === d);
    const pairs = records.filter((s) =>
      s.trials.every((t) => t.status === "submitted"),
    );
    const byMethod = (method: StudyMethod) => {
      const trials = records.map((s) =>
        s.trials.find((t) => t.method === method)!,
      );
      const submitted = trials.filter((t) => t.status === "submitted");
      return {
        submitted: submitted.length,
        abandoned: trials.filter((t) => t.status === "abandoned").length,
        valid: submitted.filter((t) => t.validation?.errors.length === 0)
          .length,
        medianSeconds: median(
          pairs.map((s) => s.trials.find((t) => t.method === method)!.seconds!),
        ),
        medianObservedSteps: median(
          pairs.map(
            (s) => s.trials.find((t) => t.method === method)!.observedSteps!,
          ),
        ),
        medianActualCostCents: median(
          pairs.flatMap((s) => {
            const cost = s.trials.find((t) => t.method === method)!.validation
              ?.actualCostCents;
            return cost === null || cost === undefined ? [] : [cost];
          }),
        ),
        errors: submitted.reduce(
          (n, t) => n + (t.validation?.errors.length || 0),
          0,
        ),
        assistanceCount: trials.reduce((n, t) => n + (t.helpCount || 0), 0),
      };
    };
    return {
      digest: d,
      taskId: records[0].taskId,
      participants: records.length,
      pairedSubmissions: pairs.length,
      manual: byMethod("manual"),
      agent: byMethod("agent"),
    };
  });
  return {
    exportedAt: now(),
    participants: sessions.length,
    groups,
    sessions,
    disclosure:
      "主持人确认真人参与；系统计时与页面目的操作自动记录，完整步骤数和帮助次数由观察者填写。未独立验证参与者身份，不将自动化夹具当真人证据。费用来自固定目录；不涉及实际支付。所有失败与放弃保留，配对统计包含错误提交；不直接等同成功效率、企业需求或长期节省。不同快照分别汇总，空样本无效果指标。",
  };
}
export function studyReport(actor: Actor) {
  manager(actor);
  return summarizeStudies(list<StudySession>("study"));
}

export type StudyReport = ReturnType<typeof summarizeStudies>;
