# COS 自动备份系统 V1.3

基于腾讯云 COS 的知微数据自动备份系统，支持增量备份、自动发现、恢复验证和云端一致性校验。

## 架构概览

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  cron/daily  │────▶│  V1.3 Backup │────▶│  COS Bucket  │
│  trigger     │     │  Program     │     │  (immutable) │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐     ┌──────────────┐
                    │  Local State │     │  cos-verify  │
                    │  commit.json │     │  -cation.json│
                    └──────────────┘     └──────────────┘
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `ziwei_cos_backup_v13.py` | 主备份程序，支持 weekly/daily/core 三种模式 |
| `ziwei_cos_restore.py` | 恢复程序，从 COS 归档恢复数据 |
| `v13-config.example.json` | 配置模板，复制后填入实际值 |

## 部署步骤

### 1. 前置条件

- Python 3.8+
- 腾讯云 COS CLI（`coscli`）已安装并配置
- COS 存储桶已创建，子账号具备 PutObject 权限
- GPG 加密密钥已生成（64 位 hex）

### 2. 配置文件

```bash
cp v13-config.example.json v13-config.json
# 编辑 v13-config.json，填入实际值：
# - bucket: COS 存储桶路径
# - key: GPG 加密密钥文件路径
# - managed_roots: 需要备份的数据目录
# - exclude_patterns: 排除的目录和文件
```

### 3. 生成加密密钥

```bash
openssl rand -hex 32 > /root/.ziwei-backup-key
chmod 600 /root/.ziwei-backup-key
```

**⚠️ 密钥必须独立保管，丢失后无法恢复归档数据。**

### 4. 首次运行（dry-run）

```bash
python3 ziwei_cos_backup_v13.py weekly --dry-run
```

检查输出确认：
- preflight 检查通过
- 文件清单正确
- 排除规则生效
- 空间估算合理

### 5. 首次备份（no-upload 验证）

```bash
python3 ziwei_cos_backup_v13.py weekly --no-upload
```

确认本地归档和恢复验证通过后，再执行真实上传。

### 6. 真实备份

```bash
python3 ziwei_cos_backup_v13.py weekly
```

### 7. 添加定时任务（验证通过后）

```bash
# 每周日凌晨 4 点执行 weekly 备份
0 4 * * 0 /usr/bin/python3 /opt/ziwei-tools/ziwei_cos_backup_v13.py weekly >> /var/log/ziwei-backup.log 2>&1
```

## 备份模式

| 模式 | 说明 | 频率建议 |
|------|------|----------|
| `weekly` | 完整增量备份，作为周基线 | 每周一次 |
| `daily` | 基于最新 weekly 的增量备份 | 每日一次 |
| `core` | 仅备份核心配置（独立 state/stage） | 按需 |

## 恢复流程

### 前提

- 恢复程序 `ziwei_cos_restore.py`
- 加密密钥文件（与备份时相同）
- COS 归档文件（需主账号下载，子账号无读取权限）

### 步骤

1. 从 COS 下载归档文件（使用主账号或 COS 控制台）
2. 将归档文件和密钥放到恢复服务器
3. 执行恢复：

```bash
python3 ziwei_cos_restore.py \
  --archive /path/to/archive.tar.zst.gpg \
  --key /path/to/backup-key \
  --output /path/to/restore-target
```

### 验证

恢复后检查：
- 文件数量与 manifest 一致
- SQLite 数据库 integrity_check 通过
- 关键文件（SOUL.md、config.yaml）完整

## 安全注意事项

1. **密钥管理**：加密密钥必须独立于备份存储，建议打印纸质备份
2. **COS 权限**：子账号仅需 PutObject，遵循最小权限原则
3. **恢复依赖**：恢复需要主账号下载归档 + 独立保管的密钥，缺一不可
4. **commit.json**：本地状态文件是增量链的权威来源，需与备份一同保护
5. **禁止操作**：不要手动修改 state 目录下的任何文件

## 状态文件说明

| 文件 | 位置 | 说明 |
|------|------|------|
| `commit.json` | `{state}/` | 当前增量链状态（inventory + latest） |
| `lock` | `{state}/` | 进程锁，防止并发执行 |
| `backup.pid` | `{state}/` | 当前运行进程 PID |
| `{task}.coverage-report.json` | `{stage}/{task}/` | 本次备份详细报告 |
| `{task}.manifest.json` | `{stage}/{task}/` | 文件清单和元数据 |
| `{task}.cos-verification.json` | `{stage}/{task}/` | COS 验证记录 |

## 故障处理

### 备份失败

1. 检查 `{stage}/{task}/coverage-report.json` 中的 alerts
2. 常见原因：磁盘空间不足、COS 网络超时、文件权限问题
3. 失败归档保留在 stage 目录供排查，受 `max_age_days` 清理策略管理

### 恢复失败

1. 确认密钥文件与备份时一致
2. 确认归档文件 SHA256 与 manifest 中记录一致
3. 确认恢复目标路径有足够空间（至少 3x 归档大小）

---

## 开发状态（2026-10-21）

> ⚠️ 本分支 `feat/cos-backup-v13` 为开发分支，**尚未合并 main**。以下状态反映当前实际进度。

### 已完成

| 日期 | 事项 |
|------|------|
| 10-21 | V1.3 备份程序核心功能开发 |
| 10-21 | preflight 空间检查（4x 估算 + /tmp 独立检查） |
| 10-21 | verify_restore 改用 staging 目录（修复 tmpfs 空间不足） |
| 10-21 | --no-upload 模式完全隔离（跳过 COS 上传、不推进 commit） |
| 10-21 | COS 上传异常处理（CalledProcessError 捕获） |
| 10-21 | cos-verification.json committed 字段修复 |
| 10-21 | cos_verified 变量未定义 bug 修复 |
| 10-21 | 有效基线严格过滤（PARTIAL/FAILED/未验证不计入基线） |
| 10-21 | 失败归档清理边界（最多保留 3 个最新失败归档） |
| 10-21 | commit 与 cos-verification 上传顺序调整（先上传验证记录再推进 commit） |
| 10-21 | Mock COS 四种场景测试（正常/上传失败/哈希不匹配/验证记录上传失败，4/4 PASS） |
| 10-21 | V1.2 首次 weekly 备份完成（622 MB，COS 路径 ziwei-backups/weekly/） |

### 未完成

| 事项 | 阻塞原因 | 优先级 |
|------|----------|--------|
| 云端 cos-verification.json committed 字段无法更新 | --forbid-overwrite 限制，上传后 committed 永远为 false，与本地 commit.json 不一致 | 🔴 阻塞 |
| 完整 backup() 流程测试 | 4/4 Mock 测试仅覆盖独立模拟函数，未测试生产代码路径 | 🟡 待办 |
| 真实 COS 上传验收 | 等待 committed 字段问题修复 | 🔴 阻塞 |
| 独立恢复演练 | 需在新服务器上使用主账号下载归档 + 独立密钥执行 | 🟡 待办 |
| cron 定时任务启用 | 等待恢复验收通过 | 🟡 待办 |
| Docker 镜像导出 | 是否纳入备份范围待决定 | 🟢 低优 |
| 云端清理策略 | 暂未启用 | 🟢 低优 |

### 已知问题

1. **cos-verification.json 的 committed 字段**：因 COS 上传使用 `--forbid-overwrite`，先上传 `committed=false` 的记录后无法更新为 `true`。修复方向：从 cos-verification.json 中移除 committed 字段，由本地 commit.json 单独维护增量链权威状态。

2. **Mock 测试未覆盖完整 backup() 流程**：当前测试仅验证了模拟函数的逻辑正确性，未经过归档上传、哈希校验、验证记录上传、commit 写入的实际代码路径。

### 重要注意事项

1. **密钥独立保管**：加密密钥 `/root/.ziwei-backup-key` 必须独立于服务器保存，丢失后无法恢复任何归档数据。
2. **COS 子账号权限**：仅 PutObject，无读取/删除/列举权限，不可扩大。恢复需主账号下载归档。
3. **恢复双因子依赖**：恢复 = 主账号下载的归档 + 独立保管的密钥，缺一不可。
4. **commit.json 是增量链权威来源**：本地状态文件决定哪些任务可作为增量备份父节点，需与备份一同保护。
5. **禁止手动修改 state 目录**：任何手动修改都可能导致增量链断裂。
6. **本分支未合并 main**：代码仍在开发验证阶段，请勿直接用于生产部署。

### 生产环境状态

- 原有凌晨 4 点备份脚本、crontab、生产容器、服务配置均**未改动**
- 未执行真实 COS 上传或删除
- 未修改生产 commit
- 未启用 cron
- 未重启知微服务
