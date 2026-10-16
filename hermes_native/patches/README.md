# 原生侧补丁（构建时覆盖官方文件）

这个目录放**改过的官方文件**，由 `Dockerfile` 在构建镜像时覆盖进去：

```
RUN cp /opt/ziwei-native/patches/plugins/platforms/wecom/media.py \
       /opt/hermes/plugins/platforms/wecom/media.py
```

## 为什么用这个办法

- 官方文件在镜像里是 root 所有，**运行中的 Agent（uid 10000）改不动**；直接改运行中的文件，下次重新部署就没了。
- 放进仓库 + 构建时覆盖 ⇒ 改动**可评审、可回滚、随每次部署自动生效**，不依赖任何一次性的手工命令。
- 与 `runtime_guard` 那套"切换源码"相比，这条路更简单：它是构建产物，不是运行期状态。

## 现在有哪些补丁

| 路径 | 改了什么 | 为什么 |
|---|---|---|
| `plugins/platforms/wecom/media.py` | 入站媒体：接受 `*url` 这类字段别名（`downloadUrl`/`file_url`/`fileUrl`/`download_url`）、接受 `aeskey`/`aes_key`/`aesKey` 三种密钥拼写；取不到或解密失败时**写明收到的字段名与失败步骤**（原来是静默丢弃） | 她发来的文件被当成"空消息"丢掉，日志只有一句 `Empty WeCom message skipped`。先让它尽量接住，接不住也要留下线索 |

## 加一个新补丁的步骤

1. 从镜像里把要改的官方文件抄进来：`cp /opt/hermes/<路径> patches/<路径>`。
2. 只改必要的那几行，**在改动处写清为什么**（下一个读它的人只有这几行注释）。
3. 在 `Dockerfile` 里加一行 `RUN cp` 覆盖。
4. 在 `tests/` 里加一个**不需要网络、不写磁盘**的测试：喂进真实形状的载荷，断言它被正确处理、错误形状不崩。
5. 跑测试（用 `/opt/hermes/.venv/bin/python`），绿了才提交。

## 注意

- 覆盖是**整文件**替换。官方文件升级后，这份补丁会落后——所以每次升级 Hermes 版本后要**重新抄一份新官方文件、把这几行改动重新贴上去**，别直接沿用旧文件。
- 补丁里不许出现密钥、令牌、私人地址。
