# 搬家包（一次性建好，以后搬去哪都照这个来）

目标：**数据全带走 + 房子能重建**。新机器上一条命令恢复，五项验收过了才算住进去。

## 一、房子长什么样（三块，互不混装）

| 块 | 容器 / 服务 | 数据卷（宿主目录） | 作用 |
|---|---|---|---|
| 我（原生） | `ziwei-hermes` | `/opt/hermes-data` → 容器 `/opt/data` | 身份、记忆、聊天库、cron、workspace、skills |
| 网页 | `ziwei-web` | `/opt/ziwei-web-data` → 容器 `/webdata` | 登录态、网页库、附件 |
| 门卫 | `caddy` | `/etc/caddy`、`/var/lib/caddy` | 域名、证书（自动签、自动续）、反代 |

镜像全部从本仓库构建，不在宿主装 Node、不装 Python 依赖，**宿主只提供 Docker**。

## 二、域名与端口

- `zhiweilove.me`、`www.zhiweilove.me` → 网页（Caddy 反代到 `ziwei-web:3000`）
- `hermes.zhiweilove.me` → 原生 API（Caddy 反代到 `ziwei-hermes:8642`），网页靠这个 https 端点连我
- 安全组只需放行 **80**（签证书）和 **443**（访问）。22 供 SSH 运维。

## 三、搬家三步

### 1. 旧机导出（不停服务，用 sqlite 一致性快照）

```bash
bash deploy/backup.sh /path/to/out
# 产出：native.tar.gz、web.tar.gz、secrets.env、MANIFEST.txt（含各库 sha256 与消息条数）
```

导出内容：
- native：`state.db`（sqlite backup API 快照，不是直接 cp 正在写的库）、`memories/`、`SOUL.md`、`config.yaml`、`.env`、`workspace/`、`cron/`、`skills/`
- web：`sessions.json`、`auth.json`、网页库、附件
- secrets 单独一份，绝不进备份压缩包的明文清单

### 2. 新机装房子

```bash
git clone <repo> /opt/ziwei && cd /opt/ziwei
cp deploy/secrets.env.example /opt/ziwei-secrets.env   # 填值，chmod 600
docker compose -f deploy/docker-compose.yml up -d --build
```

### 3. 恢复数据并验收

```bash
bash deploy/restore.sh /path/to/out
bash deploy/verify.sh        # 五项必须全绿
```

## 四、五项验收（缺一项就不算搬完）

1. **身份**：`/opt/hermes-data/SOUL.md` 的 sha256 与旧机一致。
2. **记忆**：`memories/MEMORY.md`、`USER.md` 的 sha256 与旧机一致。
3. **聊天库**：`state.db` 的 `pragma integrity_check` 为 ok，且消息条数不少于旧机。
4. **通道**：微信（企业微信长连接）在新机连上；`https://hermes.zhiweilove.me/health` 返回 200。
5. **网页**：登录页可打开、能登录、能发出一条消息并收到回复。

## 五、纪律（踩过的坑）

- **同时只能有一台在写**。旧机必须停机或断通道，否则记忆分叉，事后难合。
- **备份不要塞回同一块盘**。备份留在旧机当回退点，别搬进新机 backups 混在一起。
- **密钥单独走**，复制后核对哈希（长度 + sha256 前缀），任何报告里都不打印值。
- **数据库不能直接 cp**。必须用 `sqlite3 .backup` / python `sqlite3.backup()` 取快照。
- **域名解析分两条**：`@`/`www` 给网页，`hermes` 给我；证书由 Caddy 自动签，不用手拷。
- **迁移完成后换钥匙**：`.env` 里所有 key 轮换一次。
