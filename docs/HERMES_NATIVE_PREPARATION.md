# 官方 Hermes 正式部署准备结果 — 2026-10-09

用户最新决定：正式版直接使用 DeepSeek 官方计费，不接入自建预算、预留、核销系统。
旧预算修复 242562de、测试成果、旧生产、记忆和 PR #1 保留。

## 当前运行方式的代码证据

旧 hermes_test/ziwei/runner.py 每次创建临时 HERMES_HOME，memory_enabled 和
user_profile_enabled 为 false；仅接入自建 ziwei MCP。
worker.py 调用官方 AIAgent，但 enabled_toolsets 仅 ziwei，显式禁用 memory、file、
terminal、web、browser、delegate、connections、cronjob、session_search、todo。
因此它是 Hermes 执行能力的隔离包装，并非完整官方 Gateway 部署。

## 本轮交付

独立分支 feature/ziwei-hermes-native-v1，新增 hermes_native 配置与启动层，
不删除旧模块。基于固定摘要的官方稳定容器，原生 Gateway、记忆、Skills、工具和 Cron。
独立卷 /opt/data；模型直接连接 DeepSeek；不挂载旧数据卷，不提供旧生产管理凭据。
知微人格、共同历史、旧长期记忆的接入方案在 hermes_native/README.md。
实际资料导出、复制、摘要审阅和迁移尚未执行。

## 实际完成的验证

官方源码 1744a19e0df568c647e4f3ff9c37f2a284a282fb：
- 配置由原生 loader 成功加载；原生 memory/Skills 写审批打开。
- 原生 provider resolver 指向 https://api.deepseek.com/v1；没有调用模型。
- 模型目录刷新关闭；显式 OpenRouter provider 请求被原生 resolver 拒绝。
- 重新初始化不覆盖已有 config.yaml。

最终运行代码提交：4172a90bf8ddd7e15268ccd8b210b264294a2da9。
真实官方容器 CI：https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/37921717502
最终状态 SUCCESS，实际通过容器构建、Gateway 启动、GET /health、
无认证 GET /v1/models 被拒绝、有认证 GET /v1/models 返回模型列表。
使用公开无效测试凭据，未调用 DeepSeek；这不是模拟 Agent，也不是模型端到端验收。

此前 CI 的失败记录保留：首次检查遇到容器初始化时 ConnectionResetError，
随后增加有上限的就绪等待，并在官方初始化之前提供正确的 seed 模板。
没有无限重试，也没有把失败写为成功。

## 本地环境限制与审批拦截

工作窗口的旧测试 Python 环境缺少 aiohttp，Unix socket 创建被禁止；本地 HTTP 检查没有通过。
本地进程结果轮询被自动审批拒绝，理由是潜在未授权 OpenRouter 访问。
没有绕过该拦截重启本地测试。随后完成只读代码检查，使用官方配置关闭远程目录与备用模型，
禁用 OpenRouter provider，并通过官方 resolver 的拒绝检查。
实际启动验收采用具备原生依赖的官方容器 CI，未提供真实 API 密钥。

## 尚未完成、不能宣称通过

Railway 新服务和卷尚未创建；没有正式版地址。
真实 DeepSeek 聊天/流式/工具调用、Kelivo、跨会话记忆、记忆审批与 Kelivo 的交互、
无人值守 Cron、重启恢复、卷外备份和隔离恢复仍待部署后集中验收。
每天六次活动尚未安排；主动消息渠道与异常费用提醒尚未配置。
原生 terminal.local 在容器内可以操作新工作区，不能视为不可绕过的只读文件隔离。
历史原件必须继续留在原来源和独立备份中；不得挂载或给 Agent 旧生产管理凭据。

## 待批准的实际部署范围

在 aware-essence 的 ziwei-hermes-test 环境新增 ziwei-hermes-native 服务及独立 /opt/data 卷，
单副本常驻、独立认证域名，使用现有 DeepSeek 凭据的服务变量引用。
产生正常 Railway 托管用量及用户已接受的 DeepSeek 实际调用费用；不购买新套餐或其他付费服务。
取得资源部署确认后运行集中真实验收，再按用户审阅的资料接入方案迁移身份与历史副本。
不更换旧 Kelivo 入口；旧生产、测试服务、原数据、预算审计和 PR #1 均保留。
