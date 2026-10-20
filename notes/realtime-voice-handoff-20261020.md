# 知微之家 · 实时语音通话交接记录（2026-10-20）

## 分支与回滚
- 原 Work 集成：PR #91，`feat/realtime-voice-integration-20261020`；整合前 HEAD `9fcaed8abc61248cf86999f498f377c9c973564b`。
- **永久保留的 Work 回滚分支**：`backup/realtime-voice-work-pr91-20261020`，固定起点 `9fcaed8abc61248cf86999f498f377c9c973564b`。不强推、不删除；如需回滚，应另开分支 cherry-pick/revert，不覆盖已部署环境。
- ChatGPT 后续修复：PR #92，`fix/realtime-voice-followup-20261020`，相对 Work 集成基线增加 11 个提交、修改 8 个文件；整合到 PR #91 后，PR #92 仅保留为历史记录。
- 本次仅合并开发分支；**不合并 PR #91 到其目标分支，不部署，不触碰 VPS/生产服务**。

## 已完成的修复（不是重新开发）
1. `bridge.js`：打断后丢弃过期 LLM delta；空 ASR 文本与取消恢复会话状态。
2. `room_worker.js`：修复排队话语在上一轮收尾时可能滞留的问题。
3. `service.js`：加入 join 超时与超时后清理尝试，并允许注入超时用于测试。
4. `providers.js`：TTS SSE 结束后尝试排空音频帧队列。
5. `pcm_framer.js`：60ms 连续语音确认，减少单帧噪音误触发打断。
6. 三组语音测试文件：增加以上情形的回归测试。

## 已验证
- GitHub Actions `Realtime voice isolated verification`，run 39435251109，结论 success（对应 `65a08b580853c730fc5e4e9773e9a8704a598230`）。
- 包括 npm ci、test:voice、SDK 构建一致性、本地 LiveKit WebRTC 回环、Chromium Playwright 语音及通话界面测试。
- **未验证**：真实 iPhone PWA、真实智谱/ MiniMax API 账单、VPS 自建 LiveKit 部署与网络连通、长时间通话。

## 用户已确认且必须遵守的需求
- **只使用开源自建 LiveKit Server，部署目标为现有新加坡 VPS；禁止默认改用 LiveKit Cloud 付费/免费托管服务。**
- 现有 Hermes 保持唯一 Agent 核心及记忆来源；智谱 GLM-ASR-2512、MiniMax Speech 2.8 Turbo 使用用户自己的 API Key。
- 保留现有闭麦/静音过滤：静音时不提交 ASR 音频，不因为电话连接而持续调用 ASR/TTS；实际账单需后续验证。
- 用户希望无限时长通话、双方沉默时仍保持通话；不能无故强制挂断。合理认证/安全/费用保护需要和用户明确区分。
- 其他开发工作暂停；只推进实时语音。保持已有前端和生产服务不变，部署前先核对 VPS 资源、端口、TLS、TURN、回滚方案。

## 待办与已知风险（不能宣称完成）
- `service.js` 仍有 `touched>35000` 和 `started>15*60000` 自动结束逻辑；核查心跳后去掉人为 15 分钟上限，不因纯静音挂断。
- `providers.js` 的 VoiceQuota 默认每通话 300 秒 ASR、4000 TTS 字符、20 轮；`room_worker.js` 默认 20 轮，`bridge.js` 默认 60 轮；需设计长通话费用保护，不直接放开无界 API 消耗。
- `livekit_participant.js` 中迟到的 join 可能与 `leave()` 的幂等缓存竞态；现有 timeout 测试使用 stub worker，不等于已覆盖真实 RTC 行为。
- `AccessToken` TTL 300 秒是入房 token 有效期，不应混同通话最长时长；核查断线重连时的续签策略。
- 自建 LiveKit 需要配置 WebRTC UDP/TCP、可能的 TURN、WSS/TLS 与证书，及 VPS 容量评估；不要未经授权修改线上环境。
- 新工作从整合后的 PR #91 开发分支继续；先小步修复和增量 CI，保留备份分支不动。

## 相关链接
- PR #91: https://github.com/junjiexiang0126/dylan-heartbeat/pull/91
- PR #92: https://github.com/junjiexiang0126/dylan-heartbeat/pull/92
- CI: https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39435251109
