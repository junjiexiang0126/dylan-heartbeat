# P1 状态最后更新时间与最终验收

本提交只改状态措辞，并附三项补丁合并后的静态候选指纹。最终完整 SHA 见 PR 头及交接消息。朋友圈和语音各有独立提交与交接文件。

## 行为

知微在 30 分钟内发布且后端未标记 stale 的真实状态仍直接显示。在有效记录超过 30 分钟或后端标记 stale 时，聊天标签显示“最后更新于 HH:mm”，使用实际 updatedAt，固定 Asia/Bangkok；首页保留“最近状态：在工作/在休息/在思考/在想你”与完整真实时间。没有有效记录显示“尚无状态记录”，不伪造一个更新时间。网络连接状态保持独立，不把状态变旧解释为网络失败。

## 文件

- ziwei_web/public/chat-extra.js
- ziwei_web/e2e/chat-completion.spec.js
- ziwei_web/docs/HANDOFF_P1_STATUS_V2_2026-10-16.md
- ziwei_web/docs/V2_STATIC_SHA256_2026-10-16.txt

## 验证命令与实际输出

```sh
npm --prefix ziwei_web run check
npm --prefix ziwei_web test
```

语法检查退出 0；最终单元/集成测试实际输出：

```text
ℹ tests 69
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 23640.990377
```

最终完整浏览器命令：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
ziwei_web/node_modules/.bin/playwright test \
 --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js
```

```text
93 passed (2.9m)
```

93 通过、0 失败，退出码 0。没有最终失败项需要归因到基线。本机使用前次披露的 Chromium 153 与临时验证配置；没有增加产品依赖。状态用例覆盖新鲜/变旧/不存在、曼谷 HH:mm、网络连接与状态独立。语音与朋友圈的专项证据分别见同目录两份 P0 交接文件。

截图来自 390×844 Chromium 视口与隔离 fixture，深浅主题分别检查。录音波形输入为真实 Web Audio 合成测试信号，并验证音量变强/归零对应声波变化。它们是浏览器验收截图，不是真机截图。

## 静态资源

V2_STATIC_SHA256_2026-10-16.txt 包含 26 个白名单响应体候选指纹。新增 voice-ui.js 在 server.js 显式白名单内。部署时必须先整合两侧最新成果、对齐实际跟踪分支，再显式用最终完整 commitSha 部署；下载响应体逐字节与最终提交比较。若合并后静态文件被修改，应重新计算。此清单不代表已经部署。

## 没做 / 做不了 / 未验证

- 未部署这三项补丁，未做新补丁的线上 SHA-256 验收。
- 未连接真机 iPhone/Safari/PWA；未验证真实触摸权限、安全区、系统分享、后台音频与真机录音。没有提供真机截图。
- 线上四个父 ID 是否存在于网页数据库仍未验证。只读诊断脚本已提供，不能拿测试库结论冒充线上结论。
- 未修改 hermes_native、collectMedia、/api/chat/media/sync、原生测试、工作区、记忆、SOUL、Cron、服务器配置、环境变量或卷；没有重复实现原生 f3c62f7 / 3cf1ea2 的修复。
- v2 引用的“给ChatGPT-知微之家前端-整改清单-v1-20261016”和“知微之家-二级页草图-20261016”未找到。P1-2 二级页结构和 P1-3 的字体、完整对比度、刻度收敛、三态、长按、记忆溯源、缓存版本提示、表情面板尚未实施；需补齐原件后继续，避免把概述误当完整验收标准。
- 原生负责人报告附件历史登记已修并线上验证；本轮未独立复验那份历史文件的真实字节，没有将 HTTP 200 当成收到附件的证明。
