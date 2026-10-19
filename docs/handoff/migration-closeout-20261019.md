# 迁移收口交接 · 2026-10-19

写给 Work（PR #51）的现场材料。所有「事实」都来自本机或目标机的实际命令输出；查不到的明确标为「未核实」。

---

## 一、三台机器的实际状态

| 机器 | 公网地址 | 承接什么 | 数据目录 | 运行镜像 / 提交 | 状态 |
|---|---|---|---|---|---|
| 旧 Railway | ziwei-home-web-test-…up.railway.app | **旧网页**（她当前在用的页面）+ 旧 Hermes | `/data/hermes_native`（宿主名 6dff8f1fc94a） | 代码目录不是 git 仓库（`/data/hermes_native` 无 `.git`），**运行提交未核实** | 在跑；cron 启用 0 条；wecom 于 02:27:39 断开且未重连 |
| 新加坡 43 | `zhiweilove.me` / `43.159.36.159` | **新网页 + 微信 + 自主调度**（最终主机） | `/opt/hermes-data`（容器内 `/opt/data`）、`/opt/ziwei-web-data`（容器内 `/webdata`） | `ziwei-hermes:local` 构建于 2026-10-19T06:00:49+08；`ziwei-web:integration` 构建于 06:33:12+08；两者 **无 revision 标签，运行提交未核实** | 在跑；health 200；微信 11:29 实测收信并回复；cron 启用 1 条 |
| 香港 47 | `47.238.254.48` | 无对外职责（原微信临时宿主） | `/opt/hermes-data`（容器 681bcb5a7e63 / ziwei-test） | `ziwei-hermes:v1` 创建于 2026-10-18T19:02:33Z | 容器在跑但 wecom 已 disabled、cron 启用 0 条；待退订 |

**最终主机：新加坡 43.159.36.159。**

未核实项：两台自建机的容器内代码具体对应哪个 git 提交（镜像无 revision 标签）。要落实需在构建时写入 `org.opencontainers.image.revision`。

---

## 二、非主机停用证据

| 机器 | 自主调度 | 微信 |
|---|---|---|
| 旧 Railway | `cron/jobs.json` 启用 0 / 11 | gateway 日志：02:27:39 `wecom disconnected`；此后 0 条 wecom 收信 |
| 香港 47 | `cron/jobs.json` 启用 0 | `config.yaml`：`platforms.wecom.enabled: false`；重启后日志明确「凭据存在也不会启动适配器」 |

未删除任何服务、数据或记忆；检查期间没有重新开启旧连接。

---

## 三、未提交代码盘点

| 文件 | 来源机器 | 改了什么 |
|---|---|---|
| `hermes_native/autonomy_gate.py` | 新加坡 43（容器内 `/opt/data/scripts/autonomy_gate.py`） | ① 增加 `waiting_front` 状态识别；② 任务项不是 dict 时也判为非法；③ **历史豁免**：带 `evidence_waived` 的已完成任务跳过证据检查，并把名单写进返回的 `waived_evidence`；④ **每日上限改为读配置** `_daily_opportunities()`，读 `$HERMES_HOME/autonomy_gate.json` 的 `daily_opportunities`，默认 15，范围 1–48；⑤ 所有拒绝也给时间戳 |
| `deploy/docker-compose.host.yml` | 新加坡 43 实测 | 把手工 `docker run` 的容器写成文件；含「wecom 四项必须走容器环境变量」这条坑的记录 |
| `deploy/tools/backup.sh` | 新加坡 43 实测 | 每日 04:00 用 sqlite backup API 快照四个库 + 配置/记忆/密钥副本 + 容器 inspect，保留 7 天 |
| `deploy/tools/prechange.sh` | 新加坡 43 实测 | 改动前快照：库 + 配置 + 容器定义 + 自动生成《回滚说明.txt》 |

香港 47 与旧 Railway 没有未提交的源码修改：旧 Railway 上该文件属 root、权限 444、目录带 sticky 位，本用户无权改写，也未被改写。

---

## 四、运行配置脱敏对照

| 配置项 | 旧 Railway | 新加坡 43 | 说明 |
|---|---|---|---|
| `agent.max_turns`（全局迭代上限） | 12 | 24 | 12 是「Iteration budget exhausted (12/12)」的来源 |
| `agent.run_budget_seconds` | 420 | 420 | 单次运行墙钟预算 |
| 作业 `ziwei-daily-ten-opportunities` 的任务级上限 | 无覆盖 | 无覆盖 | 走全局 24 |
| 该作业调度点 | 0,2,4,7,9,12,15,18,20,22（10 个） | **0,2,4,6,8,10,12,14,16,17,18,19,20,21,22（15 个）** | 她 2026-10-19 决定改 15 |
| 该作业工作目录 | `/data/hermes_native/workspace` | `/opt/data/workspace` | 旧路径曾致回退报错 |
| 作业 `ziwei-dev-continuation` 独立上限 | `max_iterations: 24`、`run_budget_seconds: 900` | 同左 | 目前停用 |
| 工作目录 `/opt/data/workspace/dev/wt-cron` | — | 存在性**未核实** | 该作业停用中，启用前需核 |
| 闸门每日上限 | 脚本内写死 6 | `autonomy_gate.json` 的 `daily_opportunities = 15` | 读不到配置时默认 15 |
| 历史豁免判定 | 无此逻辑 | 任务项含 `evidence_waived` → 跳过证据检查并在日志记名 | 仅 8 条历史任务设置，见下 |

八条历史豁免（`evidence_waived`）：`home-raven-only-time`、`action-timeline-above-bubble`、`ci-fix-remaining-workflows`、`branch-audit-17`、`backend-ci-work-webkit`、`vision-routing-fix`、`web-polish-batch1-remain`、`hermes-impressions-route`。豁免只作用于这八条；新完成的任务没有证据仍会被拦。
另有两条改指到归档后的真实文件：`deploy-web-305d4e3-202610152339` → `notes/archive/superseded/会话交接-20261015.md`；`web-save-strand-fix-20261016` → `notes/archive/superseded/web-save-fix-20261016.md`。

不含：密钥、完整 `.env`、私人聊天正文、数据库文件。

---

## 五、验证到底证明了什么

| 说法 | 证据 | 证明了什么 / 没证明什么 |
|---|---|---|
| 启动成功 | `curl http://127.0.0.1:8642/health` → 200 | 网关进程起来并响应；不证明平台适配器全部连上 |
| 闸门放行 | `evaluate()` 返回 `wakeAgent: true`，state 写入 `wakes` | 预检通过并记了一次机会；不证明本轮活动有产出 |
| 额度生效 | cron run 日志出现 `Iteration budget exhausted (24/24)` | 进程实际加载 24 而非 12；同一次运行的 `Ran now: succeeded` 是指作业收尾成功，**不是**任务目标全部达成 |
| 活动完成 | `hermes cron run <job>` 返回 `Ran now: succeeded` | 该轮 agent 正常收尾；此前的 12/12 那次返回 `failed`，因为预算耗尽 |
| 成果保存 | 产物文件存在且非空（如 `autonomy_gate_state.json` 记 `wakes`、日记文件非空） | 有落盘产物；**不证明**外部投递成功（如微信送达需另查对方侧） |

特别说明两天前那次：`24/24` 耗尽与 `succeeded` 同时出现，实际产物是当轮 agent 的收尾摘要 + 状态文件计数递增，没有可交付的外部文件。

---

## 六、剩余项（不属本次交接范围）

1. 运行提交未与 git 关联：镜像需在构建时写入 revision 标签。
2. 网页增量同步与入口切换：她明确「网页先不搬」，暂不动。
3. 老对话附件未挂回：新旧消息 id 体系不同（`native-<hash>` vs UUID），文件与记录已就位，关联 0 条。
4. `/opt/data/workspace/dev/wt-cron` 工作目录存在性待核。
5. Bark 通知与 PWA 推送未迁移。
