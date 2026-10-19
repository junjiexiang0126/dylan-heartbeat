# 开发续接工具：整合及部署边界

源码位于 `hermes_native/tools/dev_next.py`。本轮只保存并测试源码；没有启用任何任务。
不要将 `hermes_native/tools` 整目录覆盖到官方 Hermes 的 `tools` 包；这里是独立 CLI 工具。

路径优先级：`ZIWEI_WORKSPACE` > `HERMES_HOME/workspace` > `/data/hermes_native/workspace`。
沿用 tasks.json、dev/checkpoint.json、dev/leases.json；没有迁移或重写正式数据。

## 同一轮的多个 CLI 调用

调用方必须为每轮生成独立的非密钥运行标识，并在该轮全部调用中保持一致，例如：

```bash
export ZIWEI_DEV_OWNER="$(python3 -c 'import uuid; print(uuid.uuid4())')"
python3 /path/to/dev_next.py
python3 /path/to/dev_next.py --progress TASK_ID --note '实际完成的一小步'
python3 /path/to/dev_next.py --heartbeat TASK_ID
```

不要每条命令生成一个标识，也不要让不同任务/轮次共用一个固定值。
环境变量未设置时兼容同进程调用；跨 CLI 调用会拒绝且不写任务，需要由调用方传入本轮标识。
文件锁只协调使用相同锁的调用方；不能防止不使用此协议的模型文件工具、其他主机或原生 kanban 直接改任务表。
在解决多实例协调前，仅在单一权威实例安装使用。

续租 TTL 为 900 秒。中断后旧租约未过期则不抢占；每个小步骤发送 heartbeat。
实际耗时超过该值需要另行设计租约/运行预算，不能据此承诺任意时长工作可靠。

`--step-verify --evidence-file ... --expect-sha256 ...` 会校验 workspace 内非空文件并记录任务级证据。
`--done` 要求任务级证据真实存在且非空，并且所有已登记步骤完成。文本证据描述不等于外部成功证明。

不要自动复制今天服务器上未知版本的脚本，不要自动修改 cron/jobs.json 或提高调用预算。
先审查 profile 中旧脚本、调用提示和路径；安装后用同一 cron 调用方式做隔离验收。
