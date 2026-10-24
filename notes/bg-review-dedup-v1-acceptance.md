# 后台审查去重 V1 · 开发分支验收报告

日期：2026-10-24（Asia/Bangkok）。接手基线：`f8edcc0816bcd529920ee7a5db4ebf977eb3e6a1`。
分支：`feature/bg-review-dedup-v1`。最终提交见包含本报告的分支提交及 PR；未合并 main。

**结论：本次修复的专项与隔离 Hermes 验收通过；不代表生产验收或允许开启生产去重。**
默认 `dedup_enabled: false` 保留。没有访问、部署、重启正式 VPS，没有修改生产配置、前端、长期记忆或持久化数据。

## 1. 真实源码与接手基线

接手后先运行旧版 21 项测试，全部通过；它们没有覆盖原生队列，也未证明真实节流。旧代码在带对话/记忆/技能输入时全部放行，实际有效审查基本不能去重。

隔离使用官方 Hermes 源码 **`5894e750c3dba980d43b25aa29e3958149ba2c61`**（上游提交时间 2026-10-23），Python 3.12.14。没有把仓库里旧的 `hermes_test/hermes-dependency-lock.json` 当成生产版本证据，也没有升级生产镜像。

实际调用链（源码链接固定到已测试 SHA）：

- [`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/5894e750c3dba980d43b25aa29e3958149ba2c61/run_agent.py)：`_spawn_background_review(messages_snapshot, review_memory=False, review_skills=False, focus=None, explicit=False)`，原生入口无 `task_cfg` 参数；返回值为 `None`，不能当作任务成功标志。
- 同文件 `_spawn_background_review_now(..., task_cfg=None, _requeue_attempts=0, explicit=False)`：先 `prepare_background_review_run`，再调用线程工厂、构造线程及传播 Context。
- [`agent/review_idle_queue.py`](https://github.com/NousResearch/hermes-agent/blob/5894e750c3dba980d43b25aa29e3958149ba2c61/agent/review_idle_queue.py)：`_PendingReview.context` 保存入队 Context；一会话一槽、最新快照替换、保留最初入队年龄；派发重新检查 enabled，然后直接调用 `_spawn_background_review_now`。
- [`agent/background_review.py`](https://github.com/NousResearch/hermes-agent/blob/5894e750c3dba980d43b25aa29e3958149ba2c61/agent/background_review.py)：`spawn_background_review_thread(..., task_cfg=None, review_run=None, explicit=False)` 返回 `(target, prompt)`；`_BackgroundReviewRun` 是唯一执行令牌，`finish_background_review_run` 通过身份校验完成原生清理。

因此不再依赖 `_spawn_background_review` 入口的 ContextVar 跨队列运输指纹。会话合并键没有被当作任务 ID。

## 2. 最终行为

### 指纹与保守放行

指纹区分 profile、session 和记忆/技能/联合审查范围，覆盖：完整原始 `messages_snapshot`（包括工具调用、参数、返回内容）、实际审查 prompt、任务配置、配置文件、缓存系统提示、模型/HTTP 路由/请求参数、工具 schema、运行中的记忆条目与冻结快照、MEMORY.md/USER.md、skills 下全部文件内容摘要。

文件按内容读取，不再只比较大小和 mtime。结构化 JSON 加边界消除简单字节拼接歧义。日志仅写进程随机密钥生成的 HMAC 摘要、随机 ticket、枚举原因和数值用量；不写会话 ID、对话、focus、文件原文、密钥或异常文本。

Hermes 会在 fork 内归一化、合并对话快照；补丁保留审查开始前的独立副本用于完成校验。不会把这些原地变更误当作新的审查输入，也不会修改主聊天历史。

以下情况不能证明等价，正常运行：未知/不可序列化输入、无法读取的文件或目录、技能软链接、超过 32 MiB 的输入、外部或未知记忆管理器、动态凭证池、尚未验证的后端、显式配置的辅助模型/路由、额外工具、尚未生成缓存系统提示等。

**只有已完整完成、未取消、未报错、无新增工具调用、实际用量为一次 API 调用、结果为 `none`，且审查前后相关状态相同的结果，才允许复用。**

工具读取、记忆写入、技能更新、多调用审查都不缓存跳过；不吸收审查完成后的新文件状态来掩盖变更。默认六小时到期后，下次相同输入也重新审查。没有后台定时器凭空制造审查。

### 任务所有权、延迟与异常

- 去重决定在原生 worker target 真正启动时执行。仅入队、被合并替换、被 enabled 门丢弃或 Thread.start 失败的任务没有去重占位。
- target 闭包绑定自己的 native run；独立随机 ticket 拥有 in-flight 记录。ContextVar 只在该 target 内采集完成证据；包括显式和关闭去重的 target 都清除继承来的外层采集器。
- 同时执行中的任务不是“已成功”的证据，不据此丢掉另一个请求。native run admission 继续限制同一 Agent 的实际执行并发。
- 完成按 ticket 和 lane 对象身份结算。重复完成、超时旧任务、A→B→A 输入交错都不能释放或污染后继任务。
- 三次连续失败后对**同一完整输入**冷却 300 秒；冷却后允许恢复探测。输入变化或显式审查不受该输入冷却限制。失败不会刷新成功时间。
- 30 分钟过期的 bookkeeping 不可被晚到完成重新缓存。不会因为本地计时器到期就强行释放仍运行的原生令牌。
- 进程重启后缓存冷启动，重新审查；不从旧审计日志恢复“已完成”。

### 显式 /refine 不被 native busy 门丢弃

真实源码还发现：同一 Agent 已有运行令牌时，原生 `prepare_background_review_run` 会返回 None，连显式请求也被拒绝。

补丁在 `_spawn_background_review_now` 为 busy Agent 保存显式请求，按 FIFO、每项独立克隆快照与 Context 派发。等待原生 `request_done`，不覆盖、不提前结束当前令牌。每 Agent 最多 32 条等待项，超出或调度线程启动失败向调用者报错，不静默丢弃。这个修复在去重关闭时同样有效。

显式请求仍尊重原生入口原有的授权、enabled 和 delegate 门；这里承诺的是“不被去重或 busy admission 吞掉”，不是绕过全局授权。运行中的原生任务真正卡死时，显式请求继续等待；补丁不强杀 provider 线程。

## 3. 实际测试与证据

| 测试 | 实际结果 | 证据 |
|---|---:|---|
| 本次专项：50 项单元 + 20 项原生 HTTP 集成 | **70 通过，0 失败** | `bg-review-dedup-evidence/dedup-final.log` |
| 安装最终补丁后的 Hermes 原生相关回归 | **87 通过，0 失败** | `bg-review-dedup-evidence/upstream-overlay-tests.log` |
| 本仓库完整 Python 回归 | **290 执行：260 通过、4 失败、26 跳过** | `bg-review-dedup-evidence/native-tests-final.log` |
| 未修改 f8edcc0 的独立 detached checkout 完整回归 | **241 执行：231 通过、相同 4 失败、6 跳过** | `bg-review-dedup-evidence/native-tests-original.log` |
| 语法编译、git diff --check | 通过 | 本地实际执行；代码/上游源码摘要在 manifest |

26 个跳过包括：20 项需要显式提供 Hermes 源码的集成测试（已在单独专项运行中实际通过），以及基线上原有的 6 项环境条件跳过。不能把跳过算作通过，也不能把完整仓库说成全绿。

四项基线既有失败：

1. `test_gate_handoff.HandoffGateTests.test_cap_block_notifies_once_and_does_not_increment_counter`
2. `test_gate_handoff.HandoffGateTests.test_notice_same_reason_is_throttled_but_different_reason_is_delivered`
3. `test_github_app.TokenCacheTests.test_refreshes_when_expiring_soon`
4. `test_preflight_upgrade.UpgradeTests.test_reviewed_image_hash_matches_the_shipped_gate`：声明的审查 gate 摘要 `7a990621…` 与实际 `be60b597…` 不一致。

没有为让报表全绿修改这些无关功能或安全门。它们仍需主线负责人处置。

### 原生集成的真实性与边界

20 项测试导入完整 `run_agent.AIAgent`，使用临时 HERMES_HOME、实际文件配置、原生队列/运行令牌/Thread/Context 传播、真实 review fork、真实会话循环、SDK 和 loopback HTTP 服务。实际通过 memory 工具写入测试记忆，通过 skill_manage 在测试目录创建技能。

本地 HTTP 服务提供固定的 OpenAI 兼容响应，**不是付费模型、不是生产 Gateway/PWA 端到端或生产数据验收**。parent 进程禁止非 loopback socket；重启子进程仅提供隔离配置与本地测试凭证。没有真实 DeepSeek/OpenAI/其他厂商账单调用。

原生队列通过控制时钟与单步 `_dispatch` 进行确定性测试，保留真实 coalesce、enabled 检查和 Context 执行；没有启动无限轮询线程。原生 87 项回归同时覆盖其轮询、取消及上下文行为。

HTTP 超时测试确实让本地响应慢于配置的请求超时；为控制验收时长，测试中关闭 fork 的可选主连接重建和多分钟自动恢复阶梯，保留真实 socket 超时、原生错误处理及下次审查。没有据此声称验证了所有 provider 的完整故障转移链。

两次独立 Python 子进程在相同测试 home/session/snapshot 下各执行一次真实审查，证明进程重启后不会从日志产生虚假的已完成命中。

## 4. 去重效果与费用

以下计数来自服务端实际接收的 `/chat/completions` 请求；metadata/token-count 探测不计入。逐测试计数原样附在专项日志的 `NATIVE_HTTP_COUNTS`。

| 场景 | 触发与请求计数 | 结论 |
|---|---|---|
| 开启：完成后的同输入重复 | 2 次自动触发 → 1 次 HTTP 请求 | 确实减少重复调用 |
| 关闭：相同输入 | 2 次自动触发 → 2 次 HTTP 请求 | 对照基线 |
| 延迟队列 | 旧/新快照合并，派发新快照；再派发相同快照 → 总共 1 次请求 | 队列合并与完成缓存均有效 |
| 新对话 + 不同审查范围 | 3 次必要审查 → 3 次请求 | 未用关闭审查节省 |
| 两会话并发、随后各自重复 | 4 次触发 → 2 次请求 | 无跨会话串扰 |
| 真实记忆写入，两次审查 | 4 次请求 | 写入型审查没有被缓存吞掉 |
| 真实技能写入/再次审查 | 4 次请求 | 技能审查没有丢失 |
| 自动运行中排入两条显式请求，再发一次显式 | 总共 4 次请求，focus 顺序断言通过 | 没丢 /refine、没替换当前令牌 |
| 401 三次失败、冷却中重触发、恢复探测 | 总共 4 次请求 | 失败限流与恢复有效 |
| 超时后恢复，再重复 | 总共 2 次请求 | 超时结果没有冒充成功缓存 |
| 两个独立进程 | 各 1 次，共 2 次请求 | 重启冷启动 |

**仅在这个重复 no-op fixture 中，请求由 2 减到 1（50%）；不能外推日常总费用减少 50%。**
服务返回的 token 用量是测试 fixture 数值，不是厂商计费数据。没有实际人民币/美元节省金额，没有生产命中率、真实模型质量或日/月费用变化数据。

## 5. 修改文件

| 文件 | 原因 |
|---|---|
| `hermes_native/bg_review_dedup.py` | worker 级安全去重、完整输入摘要、owned tickets、失败冷却、显式 FIFO、隐私日志 |
| `hermes_native/tests/test_bg_review_dedup.py` | 50 项行为/故障/所有权单元测试，替换旧实现结构测试 |
| `hermes_native/tests/test_bg_review_dedup_integration.py` | 20 项真实 Hermes + HTTP/文件/线程/独立进程验收 |
| `hermes_native/tests/bg_review_integration_requirements.txt` | 锁定本次已跑通的隔离 Python 测试依赖；不安装到生产 |
| `.github/workflows/bg-review-dedup.yml` | 固定上游 SHA，自动执行专项隔离验收；只读权限、无部署 |
| `hermes_native/web_bridge.py` | 仅更新安装点说明注释；安装入口与路由未变 |
| `notes/bg-review-dedup-v1-acceptance.md` | 本报告 |
| `notes/bg-review-dedup-evidence/dedup-final.log` | 70 项专项输出与真实 HTTP 请求计数 |
| `notes/bg-review-dedup-evidence/upstream-overlay-tests.log` | 87 项已安装补丁的原生回归输出 |
| `notes/bg-review-dedup-evidence/native-tests-original.log` | 原提交完整回归，对照既有失败 |
| `notes/bg-review-dedup-evidence/native-tests-final.log` | 最终完整仓库回归 |
| `notes/bg-review-dedup-evidence/single-run-before-fix.log` | 在旧版 69a9838 上复现重复执行的 6 个回归用例输出 |
| `notes/bg-review-dedup-evidence/manifest.json` | 测试环境、源文件与证据文件 SHA256 |

## 6. 复跑

在隔离环境检出本分支，并准备官方 Hermes 对应 SHA 的源码目录（不使用生产 home）：

```sh
python -m pip install -r hermes_native/tests/bg_review_integration_requirements.txt
HERMES_REVIEW_TEST_SOURCE=/path/to/isolated/hermes-agent python -m unittest discover -s hermes_native/tests -p 'test_bg_review_dedup*.py' -v
python -m unittest discover -s hermes_native/tests -v
```

上一轮 GitHub Actions 曾通过 63 项（见第 8 节历史记录）；本轮新增异常回归后的 70 项已在本地通过，远程结果另记第 9 节。

原生 87 项通过补丁 `install()` 后，在同一 Python 进程调用 `pytest.main`，目标文件为：
`test_background_review.py`、`test_review_idle_queue.py`、`test_background_review_cost_controls.py`、`test_background_review_usage.py`、`test_background_review_summary.py`、`test_background_review_cache_parity.py`、`test_background_review_toolset_restriction.py`、`test_background_review_tool_call_guard.py`、`test_background_review_input_budget.py`（均在上游 `tests/agent/`）。

## 7. 部署条件、剩余风险与 VPS 最小证据

开发分支修复及上述隔离验收已完成。**尚不满足直接开启正式环境去重的条件**：

- 没有正式 VPS 权限，未核实其实际 Hermes SHA 或本地补丁是否等于本次隔离源。Dockerfile 的镜像 digest 不是运行中代码身份的充分证据。
- 完整仓库仍有基线既有四项失败，包括安全门摘要不一致。PR 保持待审核，不合并 main。
- 显式辅助模型/路由、外部记忆、额外工具、软链接技能等会保守放行；若生产使用这些配置，当前去重节省可能为零，审查仍执行。必须核实适用性，不能仅看开关已开启。
- 完成缓存和显式 FIFO 均为进程内 best effort。重启后缓存丢弃并重新审查；尚未派发的请求不具备磁盘持久化恢复保证。32 条显式等待上限会明确报错。
- 没有强杀原生卡死线程；等待中的显式请求可能受其影响。自动 busy admission、原生取消/重排策略继续由 Hermes 负责。
- 未覆盖生产多进程协调、iPhone/PWA 端到端或真实付费模型质量/计费；本补丁没有承诺跨进程去重。保守放行会影响节省率，不影响必要审查执行。

真正需要 VPS 助手提供的最小只读证据（无需重发已确认的队列结论或私人记录）：

1. 运行中 Hermes 源码 SHA（若无 .git 则版本标识），以及 `run_agent.py`、`agent/background_review.py`、`agent/review_idle_queue.py` 的 SHA256，用来识别本地修改。
2. 去密钥的有效配置：background_review 的 enabled/dedup_enabled/provider/model/defer/extra_tools 是否非空；主模型 API 模式；是否外部记忆、动态凭证池或技能软链接。不要提供配置全文、环境变量值或对话/记忆内容。
3. 若源码/路由与本次验证不同，在**该实际源码的隔离副本、测试 home** 上运行相同专项并回传退出码/测试摘要。这不需要重启或修改正在运行的知微。

以上通过、既有安全门回归有明确处置并经过单独部署批准之前，继续保持生产配置原样。

## 8. 上一轮代码 286db9d 的远程 CI 历史记录

代码提交：`286db9d6ceb1ddfb205e29621ed4eb1c218b5e89`；后续提交仅补充本报告及 manifest 的远程结果。PR：[\#96](https://github.com/junjiexiang0126/dylan-heartbeat/pull/96)，草稿、未合并；GitHub 确认可无冲突合并，不代表检查通过或获准合并。

| 远程流程 | 实际结果 | 依据 |
|---|---|---|
| 新增 Background review dedup acceptance | **SUCCESS：63 项通过**，Ubuntu runner 新装锁定依赖、固定上游源码 | [run 40062530390](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40062530390) |
| 原有 Official Hermes preparation | **FAILURE：283 项，4 failures、13 errors、25 skipped**；停止在 Python 测试，未进行容器构建/启动 | [run 40062530345](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40062530345) |
| 原有 Ziwei unified regression | **FAILURE：Node 33 项，32 pass、1 fail**；后续步骤跳过 | [run 40062530354](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40062530354) |

注意区分本地与远程完整回归：GitHub 测试的是与当前 main 的临时合并树，main 比功能分支另有 `def444e`（autonomy_gate 的 chown 修改）；Ubuntu runner 也不是本地 root 环境。远程新增的 13 个 error 都是 `autonomy_gate.py` 的 `os.chown(...,10000,10000)` 在非 root runner 上抛 PermissionError。远程 gate 摘要实际为 `74f0fb62…`，因此不能把远程结果错误写成本地的“仅四项失败”。

Node 失败是 `test/autonomous_integration.test.js` 的 “real gateway and worker wake without Kelivo, persist and inject activity into chat” 等待进程活动约 20 秒超时。该流程、JS 实现及测试均未被本补丁修改；未在其独立基线上复现，故不将其根因或既有性写成已确定结论。

这些失败不是专项验收通过的替代条件，也没有为此改动无关功能。正式部署条件仍为第 7 节所列事项，PR 保持草稿。

## 9. 本轮补充修复：原生执行异常不得触发第二次执行

重新读取真实代码时发现上一轮漏测：`tracked_target` 的显式、关闭去重及无 native run 的分支在 bookkeeping 的 `try/except` 内直接调用 `native_target()`。如果原生执行函数抛错，就会被误当成 bookkeeping 失败，在 except 分支再次调用。

现在把**所有实际执行移到 bookkeeping 异常捕获范围之外**；异常原样向调用方传播，不重新调用原生 target；仍在 finally 中按该任务自己的 native run 完成清理。

验证依据：在原提交 `69a9838` 的真实模块上运行六个新回归用例，复现 **4 fail、2 pass**（见 `single-run-before-fix.log`）。最终版本六个均通过，逐项覆盖 explicit、disabled、default、unbound、unproven input、tracked，并断言执行计数等于 1、原异常对象保持不变（适用项）、运行结束标志与 Context 清理正确。

新增原生测试 `test_20_native_startup_exception_is_never_reexecuted` 使用真实工厂、真实 native run，分别对显式/关闭/开启去重注入原生 startup 异常，断言原生 startup 调用一次、异常原样抛出、只清理自己的令牌；此故障发生在 HTTP 请求前，实际请求数为 0。

当前专项 **70/70（50 单元 + 20 原生集成）**，安装补丁后的上游回归 **87/87**；完整本地回归 **290 执行、260 pass、4 fail、26 skip**，四项失败名单与原始基线相同。第 8 节的旧版 63 项远程通过不能代替本轮远程验收，最新代码提交及 CI 以 PR #96 的后续记录为准。生产边界与第 7 节的部署限制保持有效。
