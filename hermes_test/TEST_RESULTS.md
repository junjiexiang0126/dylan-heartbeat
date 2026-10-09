# 实施与验收记录 — 2026-10-09

状态：代码已实现，本地隔离测试及真实云端镜像构建已完成，公网服务和真实模型集成验收未完成，不能正式迁移。

本轮曾出现临时工作区丢失：此前未提交的集成目录不在当前环境；远端分支当时仍指向主分支基线。已重新构建实现、分阶段提交并重跑以下测试。本记录只使用最新代码的实际输出，不沿用丢失版本的 29 项测试作为最终证据。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| 组件合同测试 | 32 项通过 | `TEST_COMPONENT_OUTPUT.txt`；真实 SQLite、HTTP、MCP stdio；调度/普通聊天 executor 明确为 test double |
| Hermes 实际进程工具列表 | 通过 | `REAL_SMOKE_RESULTS.json`；固定提交，原生 memory store 关闭 |
| 只读 Hermes 工具 | 通过 | 仅 `mcp__ziwei__search_memories`、`mcp__ziwei__read_dataset` |
| 授权新增 Hermes 工具 | 通过 | 仅额外提供 `mcp__ziwei__add_memory`；没有更新/删除工具 |
| HTTP 显式新增与新请求读回 | 通过 | 真数据库，无模型调用 |
| 两个独立服务进程重启读回 | 通过 | `REAL_PROCESS_RESULTS.json`；真实启动、终止、再次启动、通过 HTTP 回忆 |
| 备份/恢复/更高预算保留 | 通过 | 组件测试真实 SQLite 快照与恢复，活跃进程锁拒绝恢复 |
| 预算事务并发、失败保留、旧账本 | 通过 | 组件测试；正预算缺失旧审计拒绝启动 |
| 普通接口 JSON/SSE、权限错误 | 组件通过 | SSE 有结束帧和 `[DONE]`；不代表 Kelivo 真机验收 |
| 后台任务执行一次、聊天读取成果 | 组件通过 | CannedExecutor，仅调度与传输；不算模型端到端验收 |
| 新集成真实 DeepSeek 调用 | 未执行 | 本轮新增真实模型调用 0；此前 ¥20 已保守预留满额 |
| 模型驱动跨会话、工具计算、自主任务 | 待验收 | 不借用前一轮 Hermes 原生记忆隔离验证冒充新集成链路 |
| Docker 镜像构建 | 云端实际通过 | Railway 部署 `e7b09a79-c13c-44bd-a39d-7cd2bff552b0`；固定 Hermes 依赖环境成功构建 |
| Railway 独立测试服务/卷 | 已创建；启动待凭证 | 用户已批准资源；新环境 `ziwei-hermes-test`，独立 500MB 卷 `/data`；生产未改。程序因四个服务凭证缺失而拒绝启动，未生成公网地址 |
| Kelivo 真机聊天 | 未验证 | 等真实测试域名及模型预算完成后通知用户 |

Hermes 源码固定 `1744a19e0df568c647e4f3ff9c37f2a284a282fb`，pyproject 和 uv.lock 哈希与配置一致。完整工具安装因 ffmpeg 执行权限失败；使用官方 PM 的冻结 Python 环境构建成功。初次 MCP 检查发现子进程环境过滤掉 capability 配置，已通过显式 MCP env 修复，重新实际检查通过；没有关闭失败防护。

原始 DeepSeek 验证账本：10 次真实请求，31082 输入 tokens、822 输出 tokens，保守预留 2000 分。`conservative_cost_bound_cny=0.35192` 为估算，不是实际账单。账本已保留，默认新集成不启用付费调用。不能以旧估算金额为理由自动释放预算。

尚未保存/迁移旧完整人格，不提供微信/小红书发布或主动消息推送。当前自主能力范围为管理员建立的单次后台任务，经真实 Hermes 执行；模型自主挑选活动、周期性循环等未来功能不在本次已验证范围。

源码、依赖锁、配置模板、Docker/Compose/Railway 配置、测试脚本和本记录随独立分支保存；没有提交 API Key、真实服务凭证、生产数据或私有身份内容。

远端复核：代码提交 `d08b07657b88c9e0a2fdbbf0b70c58709d205ac0` 的 [GitHub Actions 组件测试](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/37908115187) 实际状态为 `completed/success`。该工作流不调用付费模型，不构建 Docker，不代表云端或 Kelivo 验收。

同轮只读检查：原生产 `https://dylan-heartbeat-production-1ff4.up.railway.app/healthz` 返回 200、`{"status":"ok"}`；PR #1 为 `open/draft`、`merged=false`，head 仍为 `092d1ae9f6aa7f4ec0ca50677e90dd62dd26bd93`。本轮没有执行生产写入、删除、部署或合并。

Railway 插件已安装且工具实际可调用；`get_status`、`get_logs` 复核了新测试服务及独立卷。启动错误为 `Service keys must be distinct and at least 32 characters`。此项不是云端端到端通过；需要确认新测试服务权限凭证后继续部署。DeepSeek 新调用仍为零。
