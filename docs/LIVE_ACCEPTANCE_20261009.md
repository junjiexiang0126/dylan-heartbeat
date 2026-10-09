# 官方 Hermes 第一阶段：实际部署与验收记录

记录时间：2026-10-09（Asia/Bangkok）。本记录区分线上实测、容器 CI 和尚未通过的验收。未新增 Railway 服务，未改旧生产、PR #1 或旧数据。

## 当前版本与部署

- 仓库：junjiexiang0126/dylan-heartbeat；分支：feature/ziwei-hermes-native-v1。
- 本记录之前最新代码提交：74397dedef15608cf8ed0f58fd6606a05d3e40cc。
- 实际运行代码：4784957afe43482487a6f8de03ff5c6435b512aa，官方 Hermes 0.21.6。
- 当前已观察到 SUCCESS 的部署：18674cc9-6daa-446c-baa6-305e506c2d96。通过现有成功部署 cf129fc7-aa98-4938-a9bd-31a3bf7eb33e 的 redeploy 恢复，未调用失效的 accept-deploy 表单。
- 测试服务 ziwei-hermes-test；原卷继续挂载 /data；新 Profile /data/hermes_native。旧测试数据库等未清空、未移动。
- 旧生产最新部署仍为 17fbd11a-8792-462e-b07d-b29b47607d78，SUCCESS，代码 7c8b0b8350cc53587f5aa95dc792306b50d47b62。

## 已通过的真实检查

| 检查 | 证据 | 范围 |
|---|---|---|
| 官方 Gateway 健康 | /health HTTP 200，版本 0.21.6 | 恢复部署后实测 |
| 基本鉴权 | 未认证模型列表 401；认证后 200 | 未认证检查于此前成功部署完成；认证检查于恢复后再验证 |
| DeepSeek 真实流式聊天 | HTTP 200，回复 ZIWEI_NATIVE_CONNECTED，[DONE]；14023 输入、50 输出 Token | 一次真实付费调用，不推算为已核对费用 |
| 原生会话持久化 | 恢复部署后 /api/sessions 与会话 messages 均 200；原会话 api-3f5c4edb7d7bec78 和回复仍存在 | 会话历史，不等于长期记忆迁移 |
| 原生 terminal 工具调用 | 会话 api-dd9f58ecbea3d4fc：assistant tool_calls；两条 role=tool/name=terminal，exit_code=0 | 真实只读目录诊断，无记忆或文件写入 |
| 容器启动与重启 CI | https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/37925330122 ：SUCCESS | 74397 的 CI；不能代替现有云端目录兼容性验收 |

## 未解决的备份权限问题

线上真实工具输出：
- 运行用户 uid/gid=10000 (hermes)。
- /data/hermes_native/backups 与 backups/config 属主 uid/gid=0，权限 0755。
- 当前用户写权限 False；sudo 不存在。
- 启动日志存在备份 config.yaml 的 Permission denied。

修复提交 74397 在已有云端 Profile 上拒绝启动：
Existing profile does not match this deployment; refusing initialization.
失败尝试部署 e00e9392-592a-403b-a264-5ad863e3f142。精确字节比对不足以识别已经初始化的原生配置；不能以 CI 成功宣称线上修复成功。没有删除配置、强行打标或提升 Agent 运行权限。恢复到已验证的官方启动方式后服务正常，但备份警告仍存在。

环境仍有审阅过的待提交恢复补丁 2428e1d8-53e0-446d-b8b6-decff346a9c1：源回到 4784957、启动命令回到官方 entrypoint-dispatch.sh + bootstrap.py；它未被失效表单提交。当前实际进程来自成功版本的重新部署。不要盲目部署分支最新提交或默认自定义 entrypoint。

后续最小修复：在容器 root 初始化阶段，仅修正这一新 Profile 的备份目录属主；保留官方降权与 s6 启动，并对已有 Profile 进行兼容校验。先解决部署提交通道，或使用已有授权的、范围明确的启动维护路径；不得给聊天 Agent root/sudo，也不得修改 /data 的旧资料。随后真实生成备份、下载、完整性校验及隔离恢复；目前这些未通过。

## 统一记忆迁移准备与边界

原始资料已只读定位并校验，未写入 Railway；私密全文未进入公共仓库：
- system_prompt.txt：保存的原始包中 16963 字节，SHA-256 e7c28fd288f0d53270ade2d79c0a1bbf6e996e8c1e536384f94f28c3eda16c9b。
- care_rules.txt：后续独立文件 3542 字节，SHA-256 38034b624d57d266a595efdf6004c8311412ee596642fcdc058de7d6f4165285。
- shared_history.txt：后续独立文件实际下载 11754 字节，SHA-256 e7ae13ae84ea57b72936ab0aec2b087456c21b9915712dbee8f797dd25c1575d。
原始包里的 shared_history.txt 是较早的 9461 字节版本；保留它，不能拿它覆盖较新独立文件。此前记录 11753 字节与本次文件相差一字节，迁移前需以确认的来源与校验值为准。

拟迁移：原件逐字复制到新 Profile 的版本化只读归档，建立来源/校验清单；原生 SOUL 与记忆使用经审阅的运行资料及指向完整原件的引用。禁止仅留下摘要；旧档案、数据库和预算审计保留。目标已有文件先备份、发生冲突停止，不自动覆盖。原始资料正式迁移仍须用户确认。

阶段一尚未完成：程序级记忆写权限（原生 write_approval 不能隔离通用 terminal 对同目录的写入）、跨会话/前端统一长期记忆、完整备份恢复、身份历史接入及最终一次 Kelivo 实际验收。每天六次 Cron 和主动联系在第二阶段，本次未启动周期付费任务。

## Kelivo 连接参数

OpenAI 兼容供应商：
- Base URL：https://ziwei-hermes-test-ziwei-hermes-test.up.railway.app/v1
- 模型：hermes-agent
- API Key：目标服务 Railway Variables 中的 API_SERVER_KEY。不是 DeepSeek 密钥；密钥不放入仓库。
- 开启流式输出。旧 Kelivo 生产配置保留，新增独立连接。

接口已可用；人格与统一长期记忆未迁入，当前不具备正式迁移验收条件。
