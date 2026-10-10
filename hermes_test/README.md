# 知微 Hermes 测试版

独立实验服务，新增文件仅位于 `hermes_test/` 与专用组件测试工作流。旧 Railway 生产服务、旧记忆目录、主分支和 PR #1 不变。没有公开测试地址，没有切换生产，尚不具备正式迁移条件。

## 权限与记忆

长期记忆采用独立 SQLite 文件 `ZIWEI_DATA_DIR/ziwei.sqlite`，保存内容、版本、删除标记、操作审计和幂等记录；独立卷持久化。删除为软删除，默认检索隐藏，版本和备份仍保留。旧记忆不自动导入或改写。

| 凭证 | 权限 |
| --- | --- |
| `ZIWEI_CHAT_KEY` | 普通聊天、读取记忆、读取后台成果 |
| `ZIWEI_MEMORY_WRITE_KEY` | 普通聊天、用户明确新增与更新记忆 |
| `ZIWEI_MEMORY_DELETE_KEY` | 显式删除 API，需版本与幂等键 |
| `ZIWEI_ADMIN_KEY` | 建立后台任务、预算审计、备份下载、依赖检查 |

四个随机服务凭证至少 32 字符且必须不同，不能复用 DeepSeek Key。默认只读聊天即使使用写入凭证也不给模型记忆写权限。

实际 Hermes 使用受限 MCP 与每次运行独立、300 秒有效的程序级 capability。只读仅提供 `search_memories`、`read_dataset`；后台任务仅在管理员明确设置 `allow_memory_add:true` 时提供 `add_memory`。更新和删除永不提供给模型。服务端在事务内再次检查权限；运行结束或重启全部撤销旧 capability。Hermes 原生记忆、文件、终端、浏览器、委派等工具禁用，并核对实际工具列表，不符则失败停止。

记忆查询直接搜索全库；上下文裁剪带 `truncated` 标记，完整原文保留在数据库。配置人格可放入独立卷的 `identity/system_prompt.txt`（上限 24000 UTF-8 字节，超限报错，不能悄悄截断）。该版本尚未导入完整旧人格资料。

## Kelivo 连接

新增一个独立的 OpenAI 兼容提供商，保留现有知微配置。

- Base URL：`https://<实际测试域名>/v1`。公开域名尚未部署，这里是模板。
- API Key：服务端生成的 `ZIWEI_CHAT_KEY`，不是 DeepSeek Key。
- 模型：`ziwei-hermes`。
- 支持 `/v1/models`、`/v1/chat/completions` 的 JSON 和 SSE；SSE 为完成后分帧发送，并非实时 token 流。
- 当前仅支持文字消息，不支持客户端自带 tools/functions 或图片。
- 记忆管理可另建提供商使用 `ZIWEI_MEMORY_WRITE_KEY`；不要把管理员或删除凭证放进普通聊天。

聊天命令无需模型费用：

```text
/回忆 关键词
/后台成果
/记住 明确要持久保存的内容
/更新记忆 MEMORY_ID 当前版本号 新内容
```

`/记住` 和 `/更新记忆` 仅写入凭证可用，保存后真实读回核对。重复保存同一条用户记忆不会重复新增；删除后重新记住会创建新记录。

普通自然语言聊天必须启用模型且预算允许；当前预算锁定，因此应返回明确的 402，而不是假回复。

## 管理接口

- `GET /v1/memories`、`GET /v1/memories/{id}` 查看原文和版本。
- `PATCH /v1/memories/{id}`：写入凭证，JSON `{"content":"新内容","revision":1}`，必填 `Idempotency-Key`。
- `DELETE /v1/memories/{id}`：删除凭证，JSON `{"revision":2}`，必填 `Idempotency-Key`。
- `POST /v1/jobs`：管理员，JSON `{"prompt":"任务内容","due":UNIX时间戳,"allow_memory_add":false}`。
- `GET /v1/jobs`：管理员读取任务状态。默认单次后台任务，每两秒检查一次；可在没有聊天窗口时运行。
- `GET /admin/budget`：保守预留账本，失败请求也占预算。
- `POST /admin/inspect`：零模型调用，检查真实 Hermes 工具与原生记忆关闭状态。
- `POST /admin/backup`：生成 SQLite 一致性快照，返回文件名。
- `GET /admin/backups/{返回文件名}`：管理员下载实际 SQLite 备份。
- `/healthz` 表示服务存活；`/readyz` 表示凭证和预算允许模型，不能替代真实全链路验收。

所有接口使用 Bearer 服务凭证，默认不输出请求日志。错误信息不回传上游凭证或完整 worker stderr；保护诊断文件保存在新卷。

任务状态、结果、执行 ID 持久化。重启后运行中任务标记 `interrupted`，失败或中断任务不会自动重放，需人工核对后新建任务；已完成任务不重复执行。当前工具只读新卷中固定 `tools/dataset.csv`，不接受模型任意文件路径。文件缺失必须失败，不能编造数据。

## 模型预算

上游固定为已有隔离测试使用的 DeepSeek Flash。所有模型请求经过本服务内网预算代理；Hermes 子进程只有临时 capability，拿不到真实 DeepSeek Key。

预算修复使用实际返回的 Token 用量及版本化价格表结算，正常完成后释放多余预留；并发预留和结算由 SQLite `BEGIN IMMEDIATE` 串行保护。金额用整数纳元（1 元 = 10^9 纳元），不会按每次请求向下取整。

`GET /admin/budget` 分别返回 `settled_nano`（用量计价）、`inflight_nano`（执行中）、`uncertain_nano`（失败/中断/无可靠用量）、`historical_unverified_nano`（旧账本），以及 `limit_fen`、`remaining_nano`、`halted`。兼容字段 `reserved_fen` 为总占用向上取整后的分数；不再直接累加每行旧 `reserved_fen`。

当前采用官方 2026-10-09 Flash 高峰单价作为保守计价上界：缓存命中输入 ¥0.04/M、未命中输入 ¥2/M、输出 ¥8/M。这不是账户实际账单；空闲时段实际费用可能低一半。缺少缓存信息按全部未命中计价，统计矛盾或缺失保留预留，不退款。价格表到 2026-10-16 00:00 UTC 失效，失效后禁止新调用，需重新核对官方价格后更新代码。

调用前按 UTF-8 字节、消息/工具封装余量和输出限制计算预留；上限仍为 100000 字节、200 条消息、8 个工具、2048 输出 tokens、Hermes 4 轮。最大请求预留约 ¥0.272384，而非固定 ¥2。实际用量超界或返回未知模型时持久化停机标记，禁止进一步付费调用。

默认 `ZIWEI_BUDGET_FEN=0`。配置上限收紧为当前交接已有的 4000 分（¥40），本轮没有提高现有配置或部署。原先明确的 ¥20 限制若仍适用，应保持 2000；这里只支持当前已有上限，不能用改代码作为扩大用户授权。正预算必须导入原审计。旧 `prior-validation` ¥20 及其他旧调用均保留为未核实占用，不凭目前的估算或四舍五入截图自动核销。因此当前云端若占用 ¥40，部署本修复后仍可能禁止模型调用。需要逐次账单证据和明确核销授权，另行实施可审计的核销；本补丁不包含清零接口。

更多实现、测试与部署边界见 `BUDGET_FIX_RESULTS.md`。

## 本地开发与测试

服务与组件测试仅使用 Python 标准库；真实 Hermes 需 Python 3.14、固定源提交和固定 uv.lock，MCP extra。详情见 `hermes-dependency-lock.json`。

```bash
python -m unittest discover -s hermes_test/tests -v
python hermes_test/scripts/smoke_restart.py --output hermes_test/REAL_PROCESS_RESULTS.json
python hermes_test/scripts/smoke_real.py --source /绝对路径/hermes-agent --python /绝对路径/hermes-env/bin/python --output hermes_test/REAL_SMOKE_RESULTS.json
```

真实 Hermes 环境使用官方 PM 的 `python -m pm.build_env --source . --out /绝对路径/hermes-env --extra mcp --no-install-project`，冻结源锁文件。完整工具安装在当前宿主遇到 ffmpeg 执行权限错误，因此采用此官方 Python 环境构建入口；没有关闭哈希检查，不启用媒体或电脑控制。Docker 对应流程在 `scripts/build_runtime.sh`。

启动：在 `hermes_test` 目录配置环境变量，再执行 `python -m ziwei.server`。本地监听建议 `HOST=127.0.0.1`。Docker Compose 配置提供独立新卷；本轮环境无 Docker CLI，所以没有声称镜像构建通过。

离线恢复（先停止测试服务）：

```bash
python -m ziwei.admin backup --data /独立数据目录
python -m ziwei.admin restore --data /独立数据目录 --backup /备份文件.sqlite
```

恢复使用进程锁、完整性检查、原数据库保留副本，并保留当前和备份中较高的预算占用，不能借恢复旧快照重置额度。自动异地备份尚未配置，管理员应下载快照另存。

## 验收范围

最新恢复后的代码通过 32 项组件测试、真实 Hermes 权限检查、两个真实服务进程的重启读回。组件测试中的 CannedExecutor 仅用于调度和传输协议，不代表模型执行成功。详细证据和未完成项见 `TEST_RESULTS.md`。
