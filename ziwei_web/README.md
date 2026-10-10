# 知微 Web 第一阶段（安全骨架）

独立 Node 20+ 服务。包含三页手机 UI、单密码登录、HttpOnly/SameSite Cookie、同源写入检查、基础登录限速和健康检查。

## 运行

`ZIWEI_WEB_PASSWORD='至少16字符的独立强密码' NODE_ENV=production npm start`

Railway 部署应设置 rootDirectory=`/ziwei_web`、startCommand=`npm start`、healthcheckPath=`/health`，单独设置 ZIWEI_WEB_PASSWORD，不要复用 Hermes API_SERVER_KEY。

## 当前刻意禁用

所有 Hermes 桥接 API 返回 503，登录成功后仍不能发真实消息；没有向生产 Hermes 发送请求。记忆和日志页为空状态。会话凭证目前在内存中，实例重启需要重新登录，尚未做持久化会话和 CSRF token。仅供隔离开发，不作为生产安全完成证明。

下一步：隔离环境中的 API contract / SSE 帧实测；再加入最小权限 BFF 白名单、持久化会话与审计，确认外部客户端迁移后才能关闭 Hermes 公网入口。
