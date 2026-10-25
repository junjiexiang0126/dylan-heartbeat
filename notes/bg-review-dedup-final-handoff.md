# 后台审查去重 V1 · 最终开发交付

2026-10-25 更新（Asia/Bangkok）。原分支 feature/bg-review-dedup-v1；PR #96 保持草稿，未合并 main。

## 结论

开发、自动化及独立镜像验收完成，本轮三个远程 CI 全部通过。已测试代码/工作流提交 fbaa280592639a92e4b4b56a2aac124535750504；核心实现为其父提交 3795d94ead01d310f4c679abf260096b25eaf43c。后续交付提交仅补报告。

用户另行批准后，VPS 助手已把最小候选部署到原有正式 ziwei-hermes 容器并开启两个去重配置键，继续挂载原生产数据；不是另开的隔离服务。当前镜像 sha256:863179914770d2c6da8b9610c75cd25ece25d98ca909578c3b60c654292a231e，容器 830077e7cdf0。Work 未直连生产，本节部署依据为用户转交的实际终端输出及收尾报告。代码默认 dedup_enabled=false 不变，正式磁盘配置明确设为 true。

/health 200，无认证 /v1/models 401、有认证 200（1 项），新备份校验及权限收紧已报告完成。完整自然聊天回合、生产审查接线与去重命中尚无正面运行样本；不能由接线文件、无警告、进程外模块标记或关键词计数代替。审计未创建，数量和收益记为未知，不记零。开发/部署完成不等于已实测省费。

## 本轮修复

- worker/native run 的任务所有权、队列派发、显式 FIFO 和异常只执行一次的既有修复保留。
- 指纹继续覆盖完整对话与工具使用、审查范围/配置、缓存提示、运行态/记忆和技能全部文件内容。不略过 node_modules，也不只哈希 SKILL.md。
- 确定不存在的链接目标编码为明确状态，重定向/恢复/文件变化会重新审查。权限错误、循环、越界有效目标或无法证明状态仍正常运行。
- 技能内容改为 64 KiB 流式 HMAC；默认扫描预算仍 32 MiB，可明确配置 dedup_skill_scan_max_bytes，硬上限 128 MiB。10000 项和 snapshot/config/memory 的原边界保留；超限正常运行。
- 正常聊天、显式审查、真实记忆和技能写入均有原生 HTTP/文件/线程测试，未为了少调用而关闭必要审查。

## 实际测试

| 验证 | 结果 |
|---|---|
| 两套固定 Hermes，含 VPS 三核心哈希匹配版本 | 各 87/87（65 单元 + 22 原生 HTTP 集成） |
| 固定官方镜像内的独立、无外网/无生产挂载容器 | 87/87 |
| 安装补丁后的上游相关回归 | 87/87 |
| 本仓库完整 Python | 311 run，283 pass，28 skip，0 fail |
| Node retained components | 33/33 |
| 保留的 prototype 合约 | 52/52 |
| 官方镜像构建、Gateway 认证/健康/重启、卷标记保留、Guardian s6 监督、浏览器数据重启读回 | 全通过 |

28 skip 是 22 项已单独执行并通过的 opt-in 原生集成与 6 项既有条件跳过，不计作通过。

远程依据：
- [双版本专项](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40102613528)
- [统一回归](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40102613667)
- [实际镜像专项及生命周期](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/40102613511)

日志、代码 SHA256、隔离扫描测量及远程摘要在 bg-review-dedup-evidence/；完整历史与复跑方式见 bg-review-dedup-v1-acceptance.md 第 13 节。

## CI 阻塞如何解决

- autonomy_gate.py 只同步 main 已有属主处理行，整文件与 main 相同。单测隔离 chown，并测试权限失败仍拒绝唤醒；没有放宽自主策略。
- preflight_upgrade.py 的已审核镜像 gate 哈希与实际 main 文件一致，保留旧版本来源、显式授权/root/备份/摘要校验。未关闭安全门。
- test/autonomous_integration.test.js 在测试中显式启动一次保留 cycle 的子进程，替代等待已被删除的旧 worker；保留 HTTP、持久化、回读及认证断言，未恢复生产调度器。
- github_app.py 按 UTC 解析安装令牌到期时间，修复本地夏令时的一小时偏差；补三个时区、冬夏日期回归，全部使用假凭证。

本轮涉及上述 4 个 Python 模块、对应单测、去重原生集成、Node 集成测试、hermes-native.yml 镜像专项及交付证据；web_bridge 本轮未改，前端未改。

## 去重收益与成本

原生夹具实际创建 2524 个文件、10 个目标缺失链接、71320717 内容字节；明确选择 96 MiB 扫描预算。前两次相同输入只产生 1 HTTP；等长改字节并恢复 mtime、恢复链接目标、新对话分别新增一次，最终 4 请求。证明减少重复调用且保留必要审查，未修改或删除生产链接。

隔离单次扫描为 1.83 秒、Python traced peak 1610284 字节；不是 VPS 性能/进程 RSS。每次校验需要读取内容，存在 I/O/CPU 成本。没有付费模型、生产账单、真实命中率或月费数据，不推算人民币节省。

## 正式部署、恢复证据与剩余观察

截至本次用户转交报告，正式 ziwei-hermes 已从 14bafd8f… 镜像切至 86317991…，切换退出码 0，继续使用 /opt/hermes-data:/opt/data 与 /opt/ziwei-runtime:/opt/ziwei-runtime；端口仍 127.0.0.1:8642、重启策略 unless-stopped。生产候选仅模块及原 web_bridge 的四行安装调用；未按同名分支整套覆盖 b28ca45 工作树，CI 修复与前端未随包部署。镜像 revision 标签为空，候选源码 SHA 不是整个运行源码 SHA。

生产仅合并 auxiliary.background_review.dedup_enabled=true 和 dedup_skill_scan_max_bytes=100663296，YAML 验证通过。已有 provider/model/enabled 等报告保持；不通过修改记忆或技能链接配合缓存。RetainDB、凭证池等未知状态仍由运行时 guard 保守处理。

既有 /opt/backups/20261024-0400 已在私有隔离副本验证：四库可读、integrity_check 均 ok（表数 25/9/10/6），源/副本普通文件 SHA256 一致，指定 SOUL/MEMORY/USER/配置/env 文件非空。它没有原始 checksum manifest，不是整站启动恢复或跨库原子一致性证明；meta/memories/state.db 为源端既有空文件，不计作数据库恢复通过。备份时点之后数据不在该证明范围。

部署前另新增 /opt/backups/pre-dedup-v1-20261025-0101：四库通过 SQLite backup API 分别形成一致快照并校验 ok，关键配置/记忆副本摘要一致，脚本退出 0；备份根及 meta、meta/memories 已收紧至 root:root 0700，env 为 0600。没有清理历史备份、运行 COS 恢复或补做 v13 上传。逐库快照不能声称跨库同一时刻。

健康/认证检查已通过；完整自然聊天及首次后台审查的生产证据待后续正常使用获取。审计路径报告为 /opt/data/bg_review_dedup_log.jsonl，目前尚未创建，实际 trigger/decision/reason/complete/API 数均未知。自然 cron 完成的 24 API 调用不是后台审查去重测量，V1 不限制普通自主任务调用。无真实账单或节费数据。

当前不需要重新部署或重复 87 项验收，不以人工付费循环制造命中；观察自然审查的枚举/数值统计即可。新旧镜像保留，已批准的故障回滚只恢复镜像和两个键，继续使用当前数据，禁止回滚整个数据卷覆盖新增聊天/记忆。缓存与 FIFO 仍仅进程内 best effort。

本次 GitHub 同步仅更新文档及脱敏证据，未操作 VPS、合并 main、修改前端、原始备份或凭证。原始配置/env/inspect/聊天不入仓。完整部署摘要见 [生产试运行证据](bg-review-dedup-evidence/vps-production-trial-20261025.json)，范围及回滚见 [发布方案](bg-review-dedup-rollout-plan.md)。PR #96 仍开放待最终代码审核。
