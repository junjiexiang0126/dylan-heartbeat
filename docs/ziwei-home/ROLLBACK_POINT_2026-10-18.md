# 回滚点：release-20261018-2244

**语 2026-10-18 22:44 提出：“把现在所有做的都完整保存下来，以后做错了能直接回滚到这版。”**

## 位置

```
/data/hermes_native/backups/release-20261018-2244/
├── data.tgz        745 MB / 20,731 个文件
└── MANIFEST.md     里面写清了线上版本、状态快照、回滚步骤、sha256
```

## 这一版是什么状态（务必记住）

- Web 前端：commit `920a674`，部署 `920a67400a`，分支 `integration/ziwei-20261016`
- 今日印记：入口 + 按日期范围 + 详情抽屉，**手机已验收**
- 聊天：气泡间距 6px、思考链在气泡上方、连发分组
- 首页：EB Garamond 纪念语、渡鸦只留时间
- 定时任务：只剩 `ziwei-daily-ten-opportunities`（0/2/4/7/9/12/15/18/20/22 点）
- 记忆：MEMORY 10,861 字节 / USER 4,775 字节

## 回滚怎么做

```bash
cd /data/hermes_native
mv memories memories.before-rollback-$(date +%H%M)   # 先保住坏的现场
tar -xzf backups/release-20261018-2244/data.tgz -C /data
# 重启网关生效（会断线几十秒，重启前先记任务）
```

## 注意

- **不含 `.env`（密钥）**，回滚不恢复密钥，密钥一直在 Railway 环境变量里
- 不含 cache/tmp/dev/logs，这些是临时的，不用回滚
- 旧的 `ziwei-full-20261018-2048.tgz`（588 M）已被这一份覆盖，可以删
