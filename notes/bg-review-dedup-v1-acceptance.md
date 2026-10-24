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

以下情况不能证明等价，正常运行：未知/不可序列化输入、无法读取的文件或目录、未授权/失效/越界/循环的技能软链接、超过 32 MiB 的输入、外部或未知记忆管理器、动态凭证池、尚未验证的后端、显式配置的辅助模型/路由、额外工具、尚未生成缓存系统提示等。

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
| 本次专项：61 项单元 + 21 项原生 HTTP 集成 | **82 通过，0 失败** | `bg-review-dedup-evidence/dedup-final.log` |
| VPS 三个核心文件匹配版本 b1a39a1b 专项 | **82 通过，0 失败** | `bg-review-dedup-evidence/vps-adapted-tests.log` |
| 安装最终补丁后的 Hermes 原生相关回归 | **87 通过，0 失败** | `bg-review-dedup-evidence/upstream-overlay-tests.log` |
| 本仓库完整 Python 回归 | **302 执行：272 通过、3 失败、27 跳过** | `bg-review-dedup-evidence/native-tests-final.log` |
| 未修改 f8edcc0 的独立 detached checkout 完整回归 | **241 执行：231 通过、4 失败、6 跳过** | `bg-review-dedup-evidence/native-tests-original.log` |
| 语法编译、git diff --check | 通过 | 本地实际执行；代码/上游源码摘要在 manifest |

27 个跳过包括：21 项需要显式提供 Hermes 源码的集成测试（已在单独专项运行中实际通过），以及基线上原有的 6 项环境条件跳过。不能把跳过算作通过，也不能把完整仓库说成全绿。

本轮三项失败（均在原始基线失败名单内）：

1. `test_gate_handoff.HandoffGateTests.test_cap_block_notifies_once_and_does_not_increment_counter`
2. `test_gate_handoff.HandoffGateTests.test_notice_same_reason_is_throttled_but_different_reason_is_delivered`
3. `test_preflight_upgrade.UpgradeTests.test_reviewed_image_hash_matches_the_shipped_gate`：声明的审查 gate 摘要 `7a990621…` 与实际 `be60b597…` 不一致。

原始基线还曾失败的 `TokenCacheTests.test_refreshes_when_expiring_soon` 本轮通过；未修改该功能，不能声称已修复其不稳定性。没有为让报表全绿修改这些无关功能或安全门。剩余失败仍需主线负责人处置。

### 原生集成的真实性与边界

21 项测试导入完整 `run_agent.AIAgent`，使用临时 HERMES_HOME、实际文件配置、原生队列/运行令牌/Thread/Context 传播、真实 review fork、真实会话循环、SDK 和 loopback HTTP 服务。实际通过 memory 工具写入测试记忆，通过 skill_manage 在测试目录创建技能。

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
| main/空 model + 授权技能链接 | 重复两次 → 1 请求；目标等长改写且恢复 mtime → 新增 1 请求 | 内容变更不被跳过 |
| 两个独立进程 | 各 1 次，共 2 次请求 | 重启冷启动 |

**仅在这个重复 no-op fixture 中，请求由 2 减到 1（50%）；不能外推日常总费用减少 50%。**
服务返回的 token 用量是测试 fixture 数值，不是厂商计费数据。没有实际人民币/美元节省金额，没有生产命中率、真实模型质量或日/月费用变化数据。

## 5. 修改文件

| 文件 | 原因 |
|---|---|
| `hermes_native/bg_review_dedup.py` | worker 级安全去重、完整输入摘要、owned tickets、失败冷却、显式 FIFO、隐私日志；main 别名与受限技能链接兼容 |
| `hermes_native/tests/test_bg_review_dedup.py` | 61 项行为/故障/所有权单元测试，替换旧实现结构测试 |
| `hermes_native/tests/test_bg_review_dedup_integration.py` | 21 项真实 Hermes + HTTP/文件/线程/独立进程验收 |
| `hermes_native/tests/bg_review_integration_requirements.txt` | 锁定本次已跑通的隔离 Python 测试依赖；不安装到生产 |
| `.github/workflows/bg-review-dedup.yml` | 固定两个上游 SHA（含 VPS 核心匹配版），自动执行专项隔离验收；只读权限、无部署 |
| `hermes_native/web_bridge.py` | 仅更新安装点说明注释；安装入口与路由未变 |
| `notes/bg-review-dedup-v1-acceptance.md` | 本报告 |
| `notes/bg-review-dedup-evidence/dedup-final.log` | 82 项专项输出与真实 HTTP 请求计数 |
| `notes/bg-review-dedup-evidence/upstream-overlay-tests.log` | 87 项已安装补丁的原生回归输出 |
| `notes/bg-review-dedup-evidence/native-tests-original.log` | 原提交完整回归，对照既有失败 |
| `notes/bg-review-dedup-evidence/native-tests-final.log` | 最终完整仓库回归 |
| `notes/bg-review-dedup-evidence/single-run-before-fix.log` | 在旧版 69a9838 上复现重复执行的 6 个回归用例输出 |
| `notes/bg-review-dedup-evidence/vps-source-match.json` | VPS 报告的三个核心文件匹配依据、适配前后适用性边界 |
| `notes/bg-review-dedup-evidence/vps-matched-integration.log` | 适配前 70 项的匹配源码测试历史 |
| `notes/bg-review-dedup-evidence/vps-adapted-tests.log` | 适配后 82 项的匹配源码测试 |
| `notes/bg-review-dedup-evidence/manifest.json` | 测试环境、源文件与证据文件 SHA256 |

## 6. 复跑

在隔离环境检出本分支，并准备官方 Hermes 对应 SHA 的源码目录（不使用生产 home）：

```sh
python -m pip install -r hermes_native/tests/bg_review_integration_requirements.txt
HERMES_REVIEW_TEST_SOURCE=/path/to/isolated/hermes-agent python -m unittest discover -s hermes_native/tests -p 'test_bg_review_dedup*.py' -v
python -m unittest discover -s hermes_native/tests -v
```

前两轮分别为 63、70 项（历史见第 8、9 节）；本轮 82 项已在两套源码上分别通过，远程矩阵验收另记第 11 节。

原生 87 项通过补丁 `install()` 后，在同一 Python 进程调用 `pytest.main`，目标文件为：
`test_background_review.py`、`test_review_idle_queue.py`、`test_background_review_cost_controls.py`、`test_background_review_usage.py`、`test_background_review_summary.py`、`test_background_review_cache_parity.py`、`test_background_review_toolset_restriction.py`、`test_background_review_tool_call_guard.py`、`test_background_review_input_budget.py`（均在上游 `tests/agent/`）。

## 7. 部署条件、剩余风险与 VPS 最小证据

开发分支修复及上述隔离验收已完成。**尚不满足直接开启正式环境去重的条件**：

- 已据用户的只读报告匹配三个核心文件并完成隔离验收；仍未识别生产整个源码树、其他插件/依赖和运行时状态。镜像 digest 不能代替源码身份。
- 完整仓库本轮仍有三项失败（均在基线失败名单内），包括安全门摘要不一致。PR 保持待审核，不合并 main。
- main/空 model 已适配；外部技能链接须在 background_review.dedup_skill_link_roots 明确授权目标根目录。外部记忆、动态凭证池、未知路由、额外工具或未授权链接仍保守放行，节省可能为零。未修改生产配置或链接。
- 完成缓存和显式 FIFO 均为进程内 best effort。重启后缓存丢弃并重新审查；尚未派发的请求不具备磁盘持久化恢复保证。32 条显式等待上限会明确报错。
- 没有强杀原生卡死线程；等待中的显式请求可能受其影响。自动 busy admission、原生取消/重排策略继续由 Hermes 负责。
- 未覆盖生产多进程协调、iPhone/PWA 端到端或真实付费模型质量/计费；本补丁没有承诺跨进程去重。保守放行会影响节省率，不影响必要审查执行。

已收到核心文件哈希和磁盘脱敏配置，不需重复采集。仍需 VPS 助手提供的最小证据：

1. 仅返回布尔值/类型名，确认实际运行 Agent 的外部记忆是否激活、动态凭证池是否激活、实际 HTTP 模式。通过现有只读诊断取得；若无法在不打扰运行进程的条件下获取，明确标记未知，不注入代码、不重启。
2. 后续若授权开启链接指纹，仅核实链接解析后的目标根目录、是否存在/可读、是否存在越界或失效链接；不要输出技能正文。生产报告含 node_modules 的链接，全部纳入时可能超过边界，届时正常审查但没有缓存命中。
3. 正式激活前，由获准的部署流程在与生产其余依赖一致的**隔离副本和测试 home** 复跑专项；不使用长期记忆、私人对话或真实凭证。完整源码树若与官方副本不同，需指出相关补丁身份。

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

## 10. VPS 证据核对与匹配源码的增量验收

来源：用户转交 VPS 助手的只读报告，Work 未直连生产。用户提供的三个文件 SHA256 与最初测试的 `5894e750…` 均不同。随后从项目已有旧锁定版本的官方 Git 历史追溯，发现官方提交 **`b1a39a1b1bf135091ff3fd0020002bba35a9d456`** 下三个文件全部逐字节匹配 VPS 报告：

| 文件 | VPS 报告与该官方版本共同的 SHA256 |
|---|---|
| run_agent.py | `73efa221f42be96a41a6b8a1ee144caf47041e06f5c7d32b3bbd898d8dc250b2` |
| agent/background_review.py | `53d91d369762c9c4c66b63c43a53684a79226846475eaa155dcd4ef175c32f12` |
| agent/review_idle_queue.py | `88d1d41ce95cbd6a282fa7e4ec5f22956742a9c53fdde8aa46989496eb872021` |

这只证明这三个核心文件匹配；不能把整个运行中的 Hermes Git SHA 判定为 b1a39a1b，也不能通过时间戳证明其他文件未改动。无需再次要求用户导出这三个源码文件。

Work 在该官方提交的独立 detached worktree 上、使用测试 home 和 loopback provider，对适配前的 `1d792ee` 代码实际复跑：**70/70 通过，含 20 项原生集成，21.268 秒**。测试没有使用生产配置、外部记忆、真实模型或生产数据；其意义是补上核心源码版本的兼容性证据，不能证明生产配置具有节流收益。证据：`vps-matched-integration.log`、`vps-source-match.json`。

适配前版本的生产适用性有两个确定阻塞：

1. 报告中的 `background_review.provider: main`、空 model，在匹配的 Hermes 原生 resolver 中走主模型；但该版 V1 指纹 guard 只接受空/auto，因而会保守放行。按该配置启用 V1 也不会使用完成缓存。
2. 报告中的 skills 含软链接。该版 V1 明确检测链接并保守放行，并非 rglob 忽略目标内容后仍错误判断重复。它避免了错误跳过，但同样没有节流收益。

分别在适配前本地行为测试夹具中验证上述两种条件：两次触发都调用两次模拟 API，日志原因均为 `unproven_input`。这只是 guard 行为验证，不是生产 API 实测。

生产 provider 和现有技能链接保持不动；后续开发适配及测试结果见第 11 节。

报告中另有三处需要保留不确定性：
- YAML 无 RetainDB 段不能证明外部记忆未启用；插件文件或 SOUL 种子机制存在也不能证明服务已启用。
- YAML 无 credential_pool/pool 段不能证明运行时没有凭证池，应记为“配置未见，运行态未确认”。
- 磁盘 `api_mode: ''` 不能直接当成进程实际 HTTP 模式；仍需区分配置和运行态。

工具延迟加载的 defer 列表已正确与 background_review.defer 区分。V1 尚未部署时，21600 等数值仅是待部署补丁的默认值，不能声称生产已加载这些 V1 设置。

**第 10 节结论对应适配前 1d792ee；第 11 节记录本轮修复。两个版本均未部署，均不能承诺生产费用节省。**


## 11. main 别名与技能链接的最终开发适配

逐项核对两套官方源码的原生 resolver：`provider: main` 且 model 为空/未设时继承 parent。本轮允许这一个明确等价的别名；main 搭配具体 model 仍放行，不猜测路由。父 Agent 的路由、请求参数和凭证池 guard 继续生效。

新增仅用于去重的配置 `background_review.dedup_skill_link_roots`，必须为绝对、存在的目录列表；默认空。普通 skills 内部链接可覆盖，外部链接只有解析后目标位于明确允许根目录内才纳入。根目录 `/`、相对路径、失效链接、目录循环、嵌套越界、不可读取和特殊文件均放行。技能根本身是链接时也须明确允许。递归覆盖逻辑路径、目标身份与全部文件内容 HMAC，限制总输入 32 MiB、技能项 10000；不记录真实路径或正文。完成时重新计算输入，变化不缓存。本轮没有向生产写入任何允许根目录。

新增 11 项单元回归与 1 项原生 HTTP 集成：原生 `main`/空 model + 临时目录中的授权技能链接，两次重复只收到一次 HTTP；随后将链接目标改成等长内容并恢复 mtime，第三次收到第二次 HTTP。证明确实减少相同 no-op 调用，同时新技能内容不会被跳过。总计 61 单元 + 21 原生测试，在 5894e750 与三个生产核心文件匹配的 b1a39a1b 上均 **82/82 通过**。安装补丁后的上游相关回归 **87/87**；本仓库完整回归 **302 执行，272 pass、3 fail、27 skip**，详见第 3 节。

GitHub Actions 已改为固定两套源码的矩阵验收；最终远程结果补录于本节。真实模型费用、生产命中率和日/月节省仍无实测，不能外推 loopback fixture 的 50%。生产仍未部署、未启用去重；外部记忆与凭证池运行态、其他依赖与全量回归失败尚未关闭，**不满足直接开启生产去重的条件**。
