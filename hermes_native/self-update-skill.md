---
name: ziwei-self-update
description: 知微自主修改应用代码、测试后自动生效与故障回退。需要修复自身代码、改进工具或更新兼容源码时使用。
---

# 知微自主更新

用户授权：通过测试并保留回退版本后自动生效；失败时停止并通过 Bark 通知用户。通知只含故障类型与版本，不含私人记忆、密钥或原始日志。

1. 读取 `${HERMES_HOME}/workspace/self-update/status.json`。如果 `paused` 为 true，停止提交，告知用户故障类型，需要维护者恢复更新权限。不能修改状态绕过暂停。
2. 当前生效源码在 `/opt/ziwei-runtime/current`。原始官方源码在 `/opt/hermes`，两者仅供读取。把需要修改的完整 Python 文件写入 `${HERMES_HOME}/workspace/self-update/patches/<相对路径>`。
3. 可以修改 `agent/`、`gateway/`、`tools/`、`cron/`、`plugins/` 下的 Python 文件，以及 `run_agent.py`、`model_tools.py`、`toolsets.py`、`hermes_state.py`、`hermes_state_messages.py`。每次最多 20 个文件、合计 2 MB。不得更改身份、凭据、守护程序、启动器或依赖运行时。
4. 先运行与改动有关的测试；不要把测试通过写成已经生效。提交 `${HERMES_HOME}/workspace/self-update/<唯一任务编号>.json`，内容例如：
   `{"base":"baseline","files":["tools/example_tool.py"]}`。`base` 必须来自刚读取的 `active` 状态。提交文件不含日志或私人数据。
5. 独立守护程序会快照候选源码，以 Hermes 普通用户执行原生导入、工具定义和隔离 Gateway 启动测试，备份身份、配置、记忆及原生数据库，再切换源码并重启 Gateway。每 24 小时最多两次更新提交，避免循环修复。
6. 切换会中断正在执行的会话，用户应在重启后重新打开会话。读取状态确认 `last_result.ok=true` 和新的 `active` 后才能报告更新完成。
7. 测试失败不会切换；运行健康检查失败会恢复上一个代码版本。失败会暂停后续更新并发送 Bark 摘要。用户数据不会自动回滚，以免丢失更新后的记忆。
8. 官方镜像已经是稳定版 0.21.6。兼容当前依赖的源码改动可以按上述流程自动生效并跨容器重启保留。需要更新镜像、Python、第三方依赖或外部账号时，说明缺项并请维护者处理；容器内 `hermes update` 不能升级镜像。不得擅自新建付费账号、下载大型本地模型或复制整套依赖到数据盘。

已有浏览器、免费网页搜索、原生记忆、会话检索、技能管理、终端、代码执行、子任务、Cron 和看板工具，按需使用。不要为了“全部开启”启动无任务的循环模型调用。
