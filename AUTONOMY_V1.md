# 知微后台自主活动 v1

基于开发分支 `feature/ziwei-autonomous-wake-v1`，上游基准提交 `830c4a51c5cb3e408c868d2a0637e1ebd72502da`。
本包没有修改 Railway、生产变量或 main，默认关闭新功能。

## 行为

`railway_start.js` 继续同时启动 Gateway 和 wake worker。开启自主模式后，worker 每分钟检查持久化的到期时间，默认每 60 分钟进行一次模型决策，不依赖用户消息、Kelivo 或最后用户时间。关闭自主模式继续原有唤醒逻辑。

活动限于反思、日记、制定计划、延续文本任务、休息。模型 JSON 必须通过校验，实际文本成果保存在 output；没有成果不能把任务标为完成。没有浏览器、Shell 或小红书工具，不能执行外部任务。

每轮加载 DATA_DIR 下的 `autonomy.txt`、`memory.md`、`long_term_goals.md`、最近聊天、最近活动、任务状态。每份记忆最多读取 10000 字符；需将已有记忆实际放到同一个持久化目录，Kelivo 本地记忆不会自动同步成这些文件。

## 数据与可查看结果

- `autonomous_state.json`：原子写入，保存当前任务、最近 200 条活动、下一次运行时间、推送状态、错误标记；前一版有 .bak。
- `autonomous_activities/<活动ID>.json`：各轮活动长期存档。
- `autonomous_journal.md`：最近 200 条活动的日记和文本成果，作为可重建的阅读视图；JSON 是权威记录。
- `GET /admin/autonomy`：沿用管理员 Basic Auth，返回任务和活动状态。
- Gateway 在后续聊天中注入最近 5 条后台活动和任务状态，知微可以据此回答自己做过什么。

任务上限 100 项。未提及的任务保留，完成任务不能自动重开。单 worker 文件锁避免并行重复执行，重启保留下一次运行时间；已死亡的本机 PID 锁可恢复。该锁适用于单容器，不支持跨主机或多副本共享写入。

## 仅在隔离测试环境启用

```
AUTONOMOUS_ENABLED=true
AUTONOMOUS_INTERVAL_MINUTES=60
AUTONOMOUS_PUSH_ENABLED=false
AUTONOMOUS_PUSH_COOLDOWN_MINUTES=180
DATA_DIR=/挂载的持久化目录
TIME_ZONE=Asia/Bangkok
```

模型仍使用 TARGET_API_URL、TARGET_API_KEY、MODEL_NAME；Gateway 和 worker 必须使用相同 DATA_DIR，并在同一容器启动。Railway 需持续运行、挂载 Volume，平台休眠时不能保证周期执行。

自主活动不受旧 DAY/NIGHT_WAKE_AFTER 或 CHECK_INTERVAL 配置控制。模型请求有超时；失败后最长 15 分钟退避。Gateway 心跳和事件请求有 5 秒超时，Gateway 故障不清除已保存的成果。状态文件损坏时停止该轮并保留文件，不静默覆盖。

主动联系仍使用 Bark/ntfy，须单独设置 `AUTONOMOUS_PUSH_ENABLED=true` 和有效渠道。默认关闭。推送冷却与活动频率分开计算，推送失败保留成果；发送前落盘，崩溃留下 sending 时不自动重发，可能丢失一次通知。没有验证 Kelivo 关闭时其自身接收消息，手机通知通过配置的独立推送渠道完成。

## 验证和应用

运行 `npm ci --ignore-scripts`、`npm test`。单元测试使用临时目录；集成测试启动真实 Gateway 和 worker，连接本地模拟模型，验证无聊天时运行、管理员鉴权、后台成果回到聊天上下文。测试不使用真实 DeepSeek、Bark、ntfy、Railway。

随包补丁仅应用到该开发分支。先确认 Railway 生产服务未监听此分支，再提交；不要将本地 snapshot commit 强推到远程。示例：

```
git switch feature/ziwei-autonomous-wake-v1
git apply --check ziwei-phase1.patch
git apply ziwei-phase1.patch
npm ci --ignore-scripts
npm test
git add .
git commit -m "Add Ziwei background autonomous activities"
git push origin feature/ziwei-autonomous-wake-v1
```

真实 DeepSeek 输出兼容性、Railway 定时连续运行、Volume 重部署恢复和手机推送须在隔离环境另做验收。此版本没有生产部署或线上验收结论。
