"use client";
import { useEffect, useState } from "react";
import type {
  StudySession,
  StudyAnswer,
  StudyMethod,
  StudyReport,
} from "@/lib/study";
import type { Quote } from "@/lib/types";
import "./study.css";
const money = (c: number) => `HK$${(c / 100).toFixed(2)}`;
async function api(path: string, body?: unknown) {
  const r = await fetch(
    `/api/study/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await r.json();
  if (!r.ok) throw Error(value.error || "请求失败");
  return value;
}
const empty: StudyAnswer = {
  productId: "",
  quantity: 10,
  costCents: 0,
  capCents: 250000,
  category: "",
  merchant: "",
  expiryHours: 24,
  rewardOwner: "",
  decision: "proceed",
};
export default function StudyPage() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [current, setCurrent] = useState<StudySession | null>(null);
  const [participant, setParticipant] = useState("P01");
  const [first, setFirst] = useState<StudyMethod>("manual");
  const [confirmed, setConfirmed] = useState(false);
  const [answer, setAnswer] = useState<StudyAnswer>({ ...empty });
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [steps, setSteps] = useState(0);
  const [help, setHelp] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [report, setReport] = useState<StudyReport>();
  const active = current?.trials.find((t) => t.status === "running");
  const next = current?.trials.find((t) => t.status === "ready");
  const finishedPair = current?.trials.every((t) =>
    ["submitted", "abandoned"].includes(t.status),
  );
  async function refresh() {
    const r = await api("report");
    setSessions(r.sessions);
    setReport(r);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }
  function log(purpose: string) {
    if (!current || !active) return;
    api("action", {
      sessionId: current.id,
      method: active.method,
      actionId: crypto.randomUUID(),
      purpose,
    }).catch((e) => setError(`操作记录失败：${e.message}`));
  }
  function setField<K extends keyof StudyAnswer>(
    key: K,
    value: StudyAnswer[K],
  ) {
    setAnswer((a) => ({ ...a, [key]: value }));
  }
  async function start() {
    if (!current || !next) return;
    const r = await api("start", {
      sessionId: current.id,
      method: next.method,
    });
    setCurrent(r.session);
    setAnswer({ ...empty });
    setQuotes([]);
    setSteps(0);
    setHelp(0);
    setNote("");
  }
  async function finish(abandoned = false) {
    if (!current || !active) return;
    const r = await api("finish", {
      sessionId: current.id,
      method: active.method,
      abandoned,
      observedSteps: steps,
      helpCount: help,
      note,
      ...(abandoned ? {} : { answer }),
    });
    setCurrent(r.session);
    setQuotes([]);
    await refresh();
  }
  function download() {
    if (!report) return;
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "procuremate-human-study.json";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <main className="study-shell">
      <header>
        <a href="/">← 返回采购工作台</a>
        <p className="eyebrow">同一任务 · 两条路线 · 可核对记录</p>
        <h1>人工与代理采购对照</h1>
        <p>
          由负责人登录后主持，同学完成任务。共同终点是提交采购方案与授权边界；不实际付款。开始后按服务端时间计时，主持人另外观察完整步骤与帮助次数。
        </p>
      </header>
      {error && (
        <p className="inline-error" role="alert">
          {error} 若未登录，请返回工作台以负责人身份登录。
        </p>
      )}
      <section className="panel study-create">
        <h2>安排参与者</h2>
        <div className="form-row">
          <label>
            匿名编号
            <input
              value={participant}
              onChange={(e) => {
                const value = e.target.value.toUpperCase();
                setParticipant(value);
                const n = Number(value.slice(1));
                setFirst(n % 2 ? "manual" : "agent");
              }}
              placeholder="P01"
            />
          </label>
          <label>
            预定顺序
            <select
              value={first}
              onChange={(e) => setFirst(e.target.value as StudyMethod)}
            >
              <option value="manual">人工先做，再做代理</option>
              <option value="agent">代理先做，再做人工</option>
            </select>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          主持人确认：实际同学参与，已同意记录匿名任务数据
        </label>
        <button
          className="button primary"
          disabled={busy || !confirmed}
          onClick={() =>
            run(async () => {
              const r = await api("create", {
                participant,
                first,
                humanConfirmed: confirmed,
              });
              setCurrent(r.session);
              setQuotes([]);
              await refresh();
            })
          }
        >
          创建对照任务
        </button>
        {sessions.length > 0 && (
          <label>
            继续已有记录
            <select
              value={current?.id || ""}
              onChange={(e) => {
                setCurrent(
                  sessions.find((s) => s.id === e.target.value) || null,
                );
                setQuotes([]);
                setAnswer({ ...empty });
              }}
            >
              <option value="">选择参与者</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.participant} ·{" "}
                  {s.trials
                    .map(
                      (t) =>
                        `${t.method === "manual" ? "人工" : "代理"} ${t.status}`,
                    )
                    .join(" / ")}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      {current && (
        <>
          <section className="panel">
            <h2>{current.participant} 的固定任务</h2>
            <p>
              {current.need.brief} 每人一件，共 {current.need.people}{" "}
              件，含标准派送费不超过 {money(current.need.budgetCents)}
              ，统一香港办公室收货。只用本次固定礼品目录，不使用积分、优惠券或个人奖励。授权须包含礼品品类、来源商户、金额上限和
              1–720 小时内的有效期。
            </p>
            <p className="field-note">
              任务 {current.taskId} · 商品、费用快照摘要{" "}
              {current.digest.slice(0, 16)} ·
              两条路线共享下列来源。价格与库存不是实时商户结账。
            </p>
            {!active && next && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => run(start)}
              >
                开始{next.method === "manual" ? "人工" : "代理"}路线计时
              </button>
            )}
            {active && (
              <p className="study-clock" role="status">
                正在进行{active.method === "manual" ? "人工" : "代理"}路线 ·
                显示用时{" "}
                {Math.max(
                  0,
                  Math.floor((clock - Date.parse(active.startedAt!)) / 1000),
                )}{" "}
                秒
              </p>
            )}
          </section>
          {active && (
            <div className="study-grid">
              <section className="panel">
                <h2>
                  {active.method === "manual"
                    ? "自行比较与核算"
                    : "让代理比较方案"}
                </h2>
                <p>
                  人工可用日常计算器；两条路线都可查看相同商品与派送来源。主持人须记录浏览器之外的操作。
                </p>
                <details>
                  <summary onClick={() => log("view_source")}>
                    固定商品目录与来源
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th>商品</th>
                        <th>单价</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.catalog.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <a
                              href={p.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => log("view_source")}
                            >
                              {p.name}
                            </a>
                            <small>观察时间 {p.observedAt}</small>
                          </td>
                          <td>{money(p.priceCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <details>
                  <summary onClick={() => log("read_policy")}>
                    固定标准派送规则
                  </summary>
                  <p>{current.policy.summary}</p>
                  <a
                    href={current.policy.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => log("read_policy")}
                  >
                    查看费用来源
                  </a>
                  <p className="field-note">
                    观察时间 {current.policy.observedAt}；
                    {current.policy.limitations}
                  </p>
                </details>
                {active.method === "agent" && (
                  <>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          log("use_helper");
                          const r = await api("plan", {
                            sessionId: current.id,
                          });
                          setQuotes(r.quotes);
                          setCurrent(r.session);
                        })
                      }
                    >
                      生成对照方案
                    </button>
                    {quotes.map((q) => (
                      <article className="study-option" key={q.id}>
                        <h3>{q.lines.map((l) => l.name).join(" + ")}</h3>
                        <p>{q.reason}</p>
                        <p>
                          商品 {money(q.subtotalCents)} + 派送{" "}
                          {money(q.shippingCents)} = {money(q.totalCents)}
                        </p>
                        <p className="field-note">
                          {q.planner === "model"
                            ? "模型排序经目录校验"
                            : "透明规则模式；没有真实模型推理"}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setAnswer((a) => ({
                              ...a,
                              productId: q.lines[0].productId,
                              quantity: q.lines[0].quantity,
                              costCents: q.totalCents,
                            }));
                            log("choose_quote");
                          }}
                        >
                          采用此方案
                        </button>
                      </article>
                    ))}
                  </>
                )}
              </section>
              <section className="panel">
                <h2>提交共同终点</h2>
                <p>
                  提交后封存本条路线，错误答案也会保留。此处只准备授权，不触发交易。
                </p>
                <label>
                  所选礼品
                  <select
                    value={answer.productId}
                    onChange={(e) => {
                      setField("productId", e.target.value);
                      log("edit_selection");
                    }}
                  >
                    <option value="">选择商品</option>
                    {current.catalog.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    采购数量
                    <input
                      type="number"
                      min="0"
                      value={answer.quantity}
                      onChange={(e) =>
                        setField("quantity", Number(e.target.value))
                      }
                      onBlur={() => log("edit_answer")}
                    />
                  </label>
                  <label>
                    完整现金费用（HK$）
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={answer.costCents / 100}
                      onChange={(e) =>
                        setField(
                          "costCents",
                          Math.round(Number(e.target.value) * 100),
                        )
                      }
                      onBlur={() => log("edit_answer")}
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    授权金额上限（HK$）
                    <input
                      type="number"
                      min="0"
                      value={answer.capCents / 100}
                      onChange={(e) =>
                        setField(
                          "capCents",
                          Math.round(Number(e.target.value) * 100),
                        )
                      }
                      onBlur={() => log("edit_answer")}
                    />
                  </label>
                  <label>
                    授权有效时长（小时）
                    <input
                      type="number"
                      min="0"
                      value={answer.expiryHours}
                      onChange={(e) =>
                        setField("expiryHours", Number(e.target.value))
                      }
                      onBlur={() => log("edit_answer")}
                    />
                  </label>
                </div>
                <label>
                  授权品类
                  <select
                    value={answer.category}
                    onChange={(e) => {
                      setField("category", e.target.value);
                      log("edit_answer");
                    }}
                  >
                    <option value="">选择品类</option>
                    <option value="gift">礼品</option>
                    <option value="consumable">补货用品</option>
                    <option value="equipment">设备配件</option>
                  </select>
                </label>
                <label>
                  授权商户
                  <input
                    value={answer.merchant}
                    placeholder="填写来源商户"
                    onChange={(e) => setField("merchant", e.target.value)}
                    onBlur={() => log("edit_answer")}
                  />
                </label>
                <label>
                  奖励归属
                  <select
                    value={answer.rewardOwner}
                    onChange={(e) => {
                      setField("rewardOwner", e.target.value);
                      log("edit_answer");
                    }}
                  >
                    <option value="">选择归属</option>
                    <option value="company">公司；未知积分不计节省</option>
                    <option value="personal">员工个人</option>
                  </select>
                </label>
                <label>
                  是否可以按授权继续
                  <select
                    value={answer.decision}
                    onChange={(e) => {
                      setField(
                        "decision",
                        e.target.value as StudyAnswer["decision"],
                      );
                      log("edit_answer");
                    }}
                  >
                    <option value="proceed">可以继续</option>
                    <option value="stop">应停止</option>
                  </select>
                </label>
                <hr />
                <h3>主持人观察记录</h3>
                <div className="form-row">
                  <label>
                    完整步骤数
                    <input
                      type="number"
                      min="0"
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    介入帮助次数
                    <input
                      type="number"
                      min="0"
                      value={help}
                      onChange={(e) => setHelp(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label>
                  备注／中断原因
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="记录帮助、卡顿、放弃；不要填写姓名或联系方式"
                  />
                </label>
                <div className="study-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => run(() => finish())}
                  >
                    封存任务结果
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => run(() => finish(true))}
                  >
                    记录放弃或中断
                  </button>
                </div>
              </section>
            </div>
          )}
          <section className="panel">
            <h2>该参与者原始结果</h2>
            {current.trials.map((t) => (
              <article key={t.method} className="study-result">
                <h3>
                  {t.method === "manual" ? "人工" : "代理"} · {t.status}
                </h3>
                {t.seconds !== undefined && (
                  <p>
                    {t.seconds.toFixed(1)} 秒 · 完整步骤 {t.observedSteps} ·
                    页面目的操作 {t.actions.length} · 帮助 {t.helpCount} 次
                  </p>
                )}
                {t.validation && finishedPair && (
                  <>
                    <p>
                      来源核算费用{" "}
                      {t.validation.actualCostCents === null
                        ? "未知"
                        : money(t.validation.actualCostCents)}
                      ；所填费用 {money(t.answer!.costCents)}；校验错误{" "}
                      {t.validation.errors.length} 项
                    </p>
                    {t.validation.errors.map((e) => (
                      <p key={e}>{e}</p>
                    ))}
                  </>
                )}
                <p>{t.note}</p>
                {t.status === "submitted" && !finishedPair && (
                  <p>
                    本条路线已封存；第二条路线结束后再展示答案校验，避免提前反馈影响对照。
                  </p>
                )}
              </article>
            ))}
          </section>
        </>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>全部匿名记录</h2>
          <button
            className="button secondary"
            disabled={!report}
            onClick={download}
          >
            导出对照证据
          </button>
        </div>
        <p>
          当前 {report?.participants || 0}{" "}
          名已创建参与者；已创建不代表已完成或已独立核实真人身份。不同商品快照分别汇总，不合并成效果指标。
        </p>
        {(!current || finishedPair) &&
          report?.groups.map((g) => (
            <article key={g.digest} className="study-result">
              <h3>
                快照 {g.digest.slice(0, 12)} · 配对提交 {g.pairedSubmissions} 人
              </h3>
              <p>
                人工：提交 {g.manual.submitted}，合规 {g.manual.valid}，放弃{" "}
                {g.manual.abandoned}；代理：提交 {g.agent.submitted}，合规{" "}
                {g.agent.valid}，放弃 {g.agent.abandoned}。
              </p>
              <p>
                配对提交中位时间：人工 {g.manual.medianSeconds ?? "暂无"}{" "}
                秒，代理 {g.agent.medianSeconds ?? "暂无"} 秒；步骤{" "}
                {g.manual.medianObservedSteps ?? "暂无"} /{" "}
                {g.agent.medianObservedSteps ?? "暂无"}。
              </p>
              <p>
                配对方案现金中位数：人工{" "}
                {g.manual.medianActualCostCents === null
                  ? "暂无"
                  : money(g.manual.medianActualCostCents)}
                ，代理{" "}
                {g.agent.medianActualCostCents === null
                  ? "暂无"
                  : money(g.agent.medianActualCostCents)}
                。全部失败、错误与帮助记录保留；这些数据不能直接证明成功效率或商业节省。
              </p>
            </article>
          ))}
        <p className="field-note">
          {report?.disclosure || "尚无真人对照证据，不展示效率提升或费用节省。"}
        </p>
      </section>
    </main>
  );
}
