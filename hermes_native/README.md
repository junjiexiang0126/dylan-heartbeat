# 知微：官方 Hermes 部署准备

## 已确定的部署内容

使用官方 `nousresearch/hermes-agent:stable` 的不可变镜像摘要：
`sha256:9774f4f39a9bb8c2f68ce728ed5e99ddbad282163be56764afacf88ed952b784`。
保留官方 entrypoint 和 Gateway。这里只增加配置初始化和启动检查，不实现另一套 Agent。
镜像是否满足配置，由容器检查验证；不能以本地源码检查替代镜像验收。

建议在 aware-essence 的 ziwei-hermes-test 环境中新建 `ziwei-hermes-native` 服务，
独立持久卷挂载 `/opt/data`，单副本，关闭休眠。不能复用旧生产或测试版的数据卷。
构建根目录 `/hermes_native`，Dockerfile 路径 `Dockerfile`，健康检查 `/health`，公开端口 8642。
资源名额不足时，已获用户授权接管原测试服务及其 /data 卷；HERMES_HOME 为 /data/hermes_native。
不要使用根目录旧 Dockerfile，也不要连接旧测试版的自动部署。
正式资源创建、运行、资料复制须经用户确认；本分支本身不会部署 Railway。

## 模型、入口和原生功能

DeepSeek 直接通过官方 endpoint 调用，不经过旧内部代理，不使用自建预算表。
沿用测试执行器中的模型 ID `deepseek-flash`，真实模型可用性仍须部署后用已有密钥验证。
密钥只放 Railway 变量。可以在同一环境通过服务变量引用已有测试服务的 DeepSeek 密钥，
不得导出或提交密钥。Kelivo 使用新的独立 API_SERVER_KEY，不使用 DeepSeek 密钥作为网关密码。

Kelivo：OpenAI 兼容供应商；基础 URL `https://新域名/v1`；API Key 为 API_SERVER_KEY；
先刷新模型列表，选择官方返回的模型（默认通常为 `hermes-agent`）。
流式聊天使用官方 API，关闭非标准工具进度 SSE 事件。真实 Kelivo 验收尚未进行。

原生 memory、session history、Skills、工具和 Cron 使用持久化的 HERMES_HOME。
原生 memory/Skills 写入审批打开；日记与任务成果放 workspace，通过原生文件工具读取。
完整工具由官方 toolsets 提供，但不会提供 Railway、GitHub 或旧生产管理凭据，
也不默认安装另行收费或高风险的外部集成。
原生写审批不等同于整个文件系统的访问控制：终端/文件工具可以修改工作区文件。
历史原件必须保留在旧系统和独立备份中，不能靠提示词保证原件安全。

## 身份和历史接入（尚未迁移）

1. 从已有私密资料、旧记忆和共同历史导出只读快照；记录来源、日期、大小和 SHA-256。
2. 将原件的副本放入新卷 history_archive；原来源不变。任何摘要都是派生文件。
3. 用户审阅 SOUL.md 身份和 USER.md/MEMORY.md 的精简初始资料；不自动截断或重写完整历史。
4. 原生 session_search 查新 Hermes 会话；历史文件使用原生文件搜索读取，不伪造为原生经历。
5. 迁移前后核对清单，再建立卷外备份。禁止把私密内容上传公共 GitHub 仓库。

旧代码及 242562de 的预算修复与测试保留为历史成果；旧 ¥40 预留不核销、不清零。
自建 server、worker 包装、SQLite 记忆、MCP 记忆桥、后台队列和预算代理不进入正式运行路径。

## 原生自主活动

Gateway 常驻后使用官方 Cron；不能用 Railway 休眠服务或独立自建调度器。
准备每日六次活动机会（拟定上海时间 08/10/12/14/16/18 点），
每次选择继续任务、研究、写日记、休息等，并以实际工具成果保存记录。
现在不创建 Cron job，避免上线前出现自动付费调用。部署验证后使用原生命令创建。
Kelivo API 不等同于主动推送渠道；需要用户选择并批准原生支持的通知渠道后配置。

## 集中验收及费用

自动检查：原生 Gateway 启动、鉴权、模型列表、OpenAI 流式接口、工具、跨会话记忆、
真实无人值守 Cron 成果、重启恢复、卷外备份与隔离恢复。最后仅一次 Kelivo 人工验收。
启动检查不调用模型，不能代表 DeepSeek、记忆或自主任务端到端验收。
费用按 DeepSeek 官方实际调用计费；Railway 新服务和卷产生托管费用，创建前确认。
基础监控先使用 DeepSeek 官方用量页面及 Railway 日志/指标；异常提醒渠道未配置，
不宣称已经有主动费用提醒，也不开发新的复杂预算模块。

## 回退

新服务异常时停用新入口；旧生产与原 Kelivo 配置保持可用。
新卷和历史备份保留，不删除测试成果、原记忆或 PR #1。
