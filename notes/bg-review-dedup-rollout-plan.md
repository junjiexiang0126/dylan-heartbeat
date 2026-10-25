# 后台审查去重 V1 · 正式试运行与回滚记录

2026-10-25 更新（Asia/Bangkok）。**已获用户另行授权并部署到原有正式 ziwei-hermes，去重磁盘配置已开启。** 这不是仍在等待接入的隔离容器。PR #96 保持开放/草稿、未合并 main；生产最小镜像与整个 PR 变更集应区分。

## 已完成的发布范围

证据来源是用户转交的 VPS 助手实际终端输出与收尾报告，Work 未直连或操作 VPS。下述身份/检查按该报告归档，不伪装成 Work 自测或原始日志。

| 身份 | 值 |
|---|---|
| 固定候选源 | 7d2dc458bc8c4ab7e6afb3039b448045127d51c8 |
| 已验证代码/工作流 | fbaa280592639a92e4b4b56a2aac124535750504 |
| 正式镜像 | sha256:863179914770d2c6da8b9610c75cd25ece25d98ca909578c3b60c654292a231e |
| 原镜像/回滚身份 | sha256:14bafd8ffa578c4ccd5a0537305e2fded5d632e89ed8c0566dd7e4bb41023d5b |
| 正式容器 | ziwei-hermes / 830077e7cdf0 |
| 生产数据 | /opt/hermes-data:/opt/data；/opt/ziwei-runtime:/opt/ziwei-runtime |
| 端口与策略 | 127.0.0.1:8642:8642；unless-stopped |

候选只新增 /opt/ziwei-native/bg_review_dedup.py，并向实际基线 web_bridge.install() 加四行注释/import/install；不整文件覆盖，不含 CI 修复、前端、上游升级或自主策略变化。模块 SHA256 为 08661eb89ea386d8350849d833c6e102ce5adb69fda7dce87b2b3810ca574927；候选 web_bridge 为 b420bfead50b969b44aa58cb0cb2a776800f8fcb8d568ca768b5da12c7445a30；已补齐原 web_bridge 全摘要 4001a1a356d3f4d3c105bb9ea376e8ab4d48ecdd786f966973efc4e2f0a5efa9。

镜像与配置在切换前核对通过，已报告切换退出 0。原有 env 文件、挂载、命令、入口和权限沿用；旧新 env 数量相同不能证明每个值相同，原始 env/inspect 只在 VPS 私密位置保管，不入仓。VPS 原工作树 b28ca45 未按整分支替换。候选 revision 标签为空，不以候选源 SHA 充当整个生产源码身份。另一 ziwei-web 容器仍存在，其镜像/挂载清单本身不证明后端实际路由，不能因此宣称已改网页连接。

## 两项实际配置变更

仅在原 auxiliary.background_review 内合并，保持其余配置：

```yaml
auxiliary:
  background_review:
    dedup_enabled: true
    dedup_skill_scan_max_bytes: 100663296
```

YAML 解析及磁盘值验证通过；实际 worker 配置仍待正面运行证据。代码默认 false 保持。96 MiB 是明确选择的扫描预算，不是生产精确内容规模证明，超过预算仍正常审查。不删除失效链接或修改记忆，外部有效目标继续受允许根目录约束。

## 备份与恢复材料（已补齐限定证据）

- 既有 20261024-0400 备份复制到权限 0700 的隔离目录；四库 state.db/chat.sqlite/moments.sqlite/work.sqlite 只读打开、integrity_check 均 ok，实际表数 25/9/10/6，Python 退出 0；普通文件源/副本摘要一致，指定记忆/配置非空。无原始 checksum manifest，备份日志此前有行数摘要，但本次未完成行数对照。不是整站启动、跨库原子一致性或备份之后数据的恢复证明。meta/memories/state.db 既有零字节文件不计作恢复成功库。
- 部署前新增 /opt/backups/pre-dedup-v1-20261025-0101：SQLite backup API 对四库分别快照并验证 integrity=ok；配置/SOUL/jobs/env/MEMORY/USER 源副本摘要均报告一致，脚本退出 0。根及 meta、meta/memories 后续收紧为 root:root 0700，env 0600。未清理任何旧备份、运行 COS 恢复或上传 v13。
- 每库快照各自一致，不承诺四库是同一原子时点；该备份之后的新数据不在本次备份证明范围。原备份脚本不能直接复用为通用验收工具：memories 摘要不一致不会置失败码，固定目录 exist_ok 也不是安全的新建策略；本次真实输出全为匹配，不扩大脚本正确性结论。

## 上线后已验证与待观察

| 检查 | 当前证据 |
|---|---|
| 服务健康 | /health 200 |
| 认证拒绝 | 无认证 /v1/models 401 |
| 认证成功 | 使用本地凭证 /v1/models 200，1 项 hermes-agent；无模型调用 |
| 自然聊天完整往返 | 暂无样本；关键词计数和 websocket ping 不能代替送达证明 |
| 去重实际接线/配置生效 | 待首次正面运行证据；文件/hook、无警告或独立进程标记均不足 |
| 生产审计 | 报告 /opt/data/bg_review_dedup_log.jsonl 未创建；数量、命中率、费用均未知 |
| 自然 cron | 报告一个 24 API 调用回合完成，非去重专项；V1 不设普通自主任务调用上限 |

首次启动曾连接失败并经历 SIGTERM/再次启动，随后健康与认证通过；先前 UNCLEAN 生命周期警告没有被独立诊断，不归结为全部警告已证无害。安装兼容检查也可能静默返回 false，因此没有失败警告不是成功证明。无审计不能推断无触发或用零值替代未知。

下一步仅正常使用和自然审查观察：汇总 trigger 的 decision/reason 及 complete 的结果/API 数，不公开原文、路径、指纹或凭证。不重复部署、完整专项或制造付费循环。没有真实费用数据，不将隔离夹具两次变一次外推为生产 50% 节省。

## 已授权范围内的故障回滚

- 出现确认的服务/聊天/必要审查/显式请求故障时，恢复部署前保存的两个配置键；原先缺失则恢复为缺失。关闭优化时须按原生缓存/配置生效机制验证，不假定磁盘改动立刻热加载。
- 必要时按 VPS 本地原部署描述切回原不可变镜像 ID，沿用当前生产数据、原端口/环境/网络/权限配置；必要的 Hermes 重建/重启属于已批准回滚，不触动其他服务。
- 不恢复整个旧数据卷、不覆盖试运行新增聊天或记忆；不删除新旧镜像、旧分支、技能或历史备份。不因暂无审计样本自动回滚，也不伪造命中证明。

结构化外部证据：[vps-production-trial-20261025.json](bg-review-dedup-evidence/vps-production-trial-20261025.json)。隔离专项、阶段一发布包和历史记录保留，均以其当时阶段解读；本页取代此前“第二阶段尚未授权/未部署”的当前状态。
