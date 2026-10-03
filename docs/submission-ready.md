# 最终提交用材料

手册截止：2026 年 10 月 4 日 13:00 香港时间。建议至少提前一小时完成；正式 Submission Form 从组委会现场/参赛邮件取得，手册未提供其链接。不要使用队伍变更表代替项目提交表。

## 可复制链接

- 项目：ProcureMate
- 赛道：FinTech
- 题目：Problem Statement 1 — Give a Machine a Wallet – Agentic Commerce
- 专项奖声明：HKT
- 公开代码：https://github.com/mumu-bird/hacku-ProcureMate
- 当前发布：https://github.com/mumu-bird/hacku-ProcureMate/releases/tag/v0.2.0
- 三分钟录像：https://raw.githubusercontent.com/mumu-bird/hacku-ProcureMate/043d2c72f88768ddcafc00cf1f77fda366d7c4fe/artifacts/ProcureMate-demo.webm
- 七页 Pitch Deck：https://raw.githubusercontent.com/mumu-bird/hacku-ProcureMate/043d2c72f88768ddcafc00cf1f77fda366d7c4fe/artifacts/ProcureMate-pitch.pdf

## 项目说明（英文）

ProcureMate is a delegated procurement prototype for small teams. A manager authorizes categories, merchants, budgets, expiry and substitution rules; the procurement assistant selects timestamped catalog products, checks specifications and full delivery-inclusive costs, reserves budget and executes within those constraints. Event gifts are the main demonstration, with inventory replenishment and employee equipment using the same core. The demo completes a simulated transaction and receipt, stops a separate shipping-over-budget purchase before any payment call, and triggers a second authorized replenishment order. Current evidence includes 45 core tests, 5 browser workflows and a facilitated paired-study tool. Human comparison results and real model/payment-network integrations are still unverified. The prototype does not claim an actual HKT merchant order or company-wallet connection.

## 必须由团队填入或完成

- 队伍名称、成员姓名/学号/联系方式：按报名信息填，不从 GitHub 名称推断。
- 真人人工/代理对照：运行 `/study`；记录实际步骤、时间、费用和错误。当前没有结果，不能编造效率提升。
- 正式表单提交：团队核对链接、附件和 HKT 声明后提交，保存回执；当前未代团队提交。
- 展位代表：至少一名成员在现场；若进入前八须参加路演。
- 代码冻结：提交后按官方要求冻结。不要将功能已完成等同于已完成正式报名或提交。

## 本地彩排

1. `npm ci`，然后 `npm run dev`，打开 `http://127.0.0.1:3000`。
2. 以负责人进入。默认演示密码为 `welcome2026!`；仅本机演示使用。
3. 十人礼品、HK$2,500，生成三套方案；加入 500 ml/明确保温要求，说明筛选依据。
4. 确认授权、执行模拟交易、收货。再打开明确标注的独立运费边界测试，展示“没有发起付款”。
5. 展示日常补货的收货与领用、第二笔授权内订单、岗位配件模板和可核对记录。
6. 展示真人对照工具；没有真实结果时继续说明零样本。播放三分钟视频作为故障备用。

代码、模型凭证和人类验证是三个不同的证据来源。Stripe 接口是测试收款状态机，落地仍需真实商户结账与公司付款授权，不能把它说成能替公司在任意商户付款的钱包。
