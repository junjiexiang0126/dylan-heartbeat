# 宿主快照工具

这些工具仅在指定宿主路径读数据并写备份；不会安装 cron、停止服务或修改原数据卷。
原始交接来源与修复说明见 `docs/handoff/migration-closeout-review-20261019.md`。

```bash
bash deploy/tools/backup.sh
bash deploy/tools/prechange.sh before-change
python3 deploy/tools/snapshot.py verify /opt/backups/daily-...
python3 deploy/tools/snapshot.py restore /opt/backups/daily-... /opt/restore-staging-new
```

`restore` 只接受新的或空的暂存目录。不要把原数据目录或其父/子目录传进去。
还原不会切换挂载；实际回滚前必须停止 Web/Hermes 等全部写入者并保留现场，再核对备份内 ROLLBACK.md。
如果需要恢复源 UID/GID，使用有相应权限的管理员进程在暂存目录执行；不能通过放开原数据权限解决。

配置环境变量：

| 变量 | 默认 |
|---|---|
| BACKUP_ROOT | /opt/backups |
| HERMES_DATA | /opt/hermes-data |
| ZIWEI_WEB_DATA_DIR | /opt/ziwei-web-data |
| ZIWEI_RUNTIME_DIR | /opt/ziwei-runtime |
| ZIWEI_HERMES_ENV_FILE | /opt/ziwei-hermes.env |
| ZIWEI_WEB_ENV_FILE | /opt/ziwei-web.env |

四个库（state.db、chat.sqlite、moments.sqlite、work.sqlite）、必要身份/配置/脚本及两个环境文件均需存在；缺失或损坏会返回非零。
工具把凭证、容器 inspect 与数据一起放进私有快照，不输出其内容；不要把实际快照提交 Git、贴进聊天或上传公开位置。
数据库结构不假定有 messages/posts 表。SQLite WAL 已合入快照；不会恢复旧 WAL/SHM。

在线状态仅保证逐库一致，不保证四库与普通文件位于同一个业务时刻。
每日 04:00 的计划由宿主调度另行设置；代码里没有安装或修改任何计划任务。
只有成功完成并校验的新 daily 快照才会触发七天保留策略；prechange、未知旧备份及失败快照保留。
镜像不是数据快照的一部分，跨主机恢复前需核对相应镜像可获取。
