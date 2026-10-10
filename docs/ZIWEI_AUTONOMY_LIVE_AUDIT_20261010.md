# 知微 Hermes 自主运行现场核查（2026-10-10）

## 证据范围与结论

本报告通过 GitHub 仓库源码和 Railway 连接器只读检查形成；**未进入容器终端、未读取 /data 持久卷中的实时文件、未触发模型调用、未创建 Cron job、未发送通知**。因此“自主唤醒成功”目前 **NOT VERIFIED**，不是 FAILED。以下严格区分代码存在、服务启动与端到端成功。

- 测试环境：Railway `ziwei-hermes-test`，服务 `d0a928bf-3db2-4085-9812-8a28be4d0b1b`，环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`。
- 实际运行镜像：部署 `6e97202e-209f-4006-a593-1915a54f7b9c`，`SUCCESS`，来源 `feat/ziwei-native-browser-persistence-v1@50634ef869ecc7166257fe4f896f45c31c102506`；构建目录 `/hermes_native`，原有 `/data` 持久卷保留。
- Gateway 和 `ziwei-guardian` 启动有真实日志；但启动横幅包含 “cron scheduler” **不能证明** Cron job 已配置或运行。
- 当前部署日志出现终端、记忆、MCP 工具调用，部分失败、重试、浏览器超时和对话修复警告；不能把交互会话中的工具调用归因为无人值守唤醒。
- 旧部署日志曾出现 `[Errno 28] No space left on device`（2026-10-10 04:20 Asia/Bangkok）；**不能推断当前磁盘仍满**，应只读核实。
- 当前 Gateway 启动日志警告 API Server 监听 `0.0.0.0` 且终端后端 `local` 未沙箱化；存在扩大凭据泄露后影响面的风险，需单独安全评估，不应在本次验收中直接改配置。

## 代码核查

- `hermes_native/config.yaml`：`cron.allow_agent_scheduling: true`、`max_parallel_jobs: 1`；`memory.memory_char_limit: 6000`，这是模板的字符预算，并不能独立证明当前 `MEMORY.md` 所说的 90% 是哪种计量；已有持久 profile 不会被模板覆盖。
- `hermes_native/bootstrap.py`：首次启动时才种下 `scripts/autonomy_gate.py`，**已有脚本不会自动覆盖**。故仓库中修复不代表当前持久卷脚本同步更新。
- `hermes_native/autonomy_gate.py`：读取 `workspace/tasks.json`、`cron/jobs.json`、`workspace/diary/YYYY-MM-DD.md`，检查任务证据，限制每日最多六次机会、连续三次 Cron 失败停止，输出 `wakeAgent` 并尝试写 `logs/autonomy_preflight.jsonl`。注意：这是**预检机会**，不是“模型成功执行次数”。
- `hermes_native/README.md` 记载测试 profile 计划在 Asia/Bangkok 08/10/12/14/16/18 运行；**当前真实 `cron/jobs.json` 未读，不能据此声称线上存在六个任务**。
- 文档说明 `deliver=local` 仅本地保存，不等于通知送达；当前没有已证实的用户主动通知渠道。

## 尚待在运行容器中完成的只读证据检查

1. **任务是否存在**：读取 `$HERMES_HOME/cron/jobs.json`（只输出 job id、名称、启用状态、时间表达式、脚本名、最近执行状态；过滤 prompt/secret），核实使用 `script=autonomy_gate.py`。
2. **是否触发过**：读取 `$HERMES_HOME/logs/autonomy_preflight.jsonl` 和官方 Cron job 运行历史；关联 job ID、计划时间、真实触发时间、`wakeAgent`、运行结果，明确区分 API 聊天触发。
3. **任务连续性**：只读核对 `workspace/tasks.json` 的状态/ID/证据路径与后续运行日志；不要输出私人任务正文、记忆或密钥。完成项应有实际非空文件证据；下次运行需明确读取同一任务 ID。
4. **持久化**：只读核对 `workspace/diary`、`memories/MEMORY.md` 的文件存在性、大小、更新时间；如需跨重启验收，先单独安排安全窗口，不能擅自重启带卷服务。
5. **资源**：检查 `df -h /data` 和相关目录用量；只记录容量，不读取 Cookie/浏览器数据库内容。
6. **主动通知**：先确认渠道与已授权收件人；没有渠道就标记 BLOCKED，不能把 `deliver=local` 当作送达。

## 验收标准（每项必须附证据）

| 阶段 | 合格证据 | 当前状态 |
| --- | --- | --- |
| Cron 已配置 | 持久卷真实 jobs.json 中存在启用 job | 未验证 |
| 无人值守触发 | 官方 Cron 历史与预检日志时间对应，无用户消息触发 | 未验证 |
| 决策与执行 | 对应 job 的模型调用、工具回执及非空产出 | 未验证 |
| 任务接续 | 两次不同唤醒关联同一 task ID 和状态变化 | 未验证 |
| 记忆保存 | 运行时文件回读；跨重启须单独实测 | 未验证 |
| 主动联系 | 通知服务发出回执与用户端收到的证据 | 未验证 |

## 安全边界

不清空卷、不重置 profile、不删除记忆、不修改 SOUL/USER、不创建第二个 Agent loop、不部署、不重启、不向 GitHub 提交真实记忆或 Cookie、不直接公开 API Key/GitHub Token。当前工作只补充审计证据；后续修复应独立 PR 并有回归测试。旧生产环境与 main 保持不变。
