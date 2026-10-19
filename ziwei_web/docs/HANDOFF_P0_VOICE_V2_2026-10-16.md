# P0 按住录音与语音气泡

本提交只处理语音。父提交为朋友圈同步补丁；基线包含原生负责人 3cf1ea2 / f3c62f7。没有修改 collectMedia、取件路由或分段消息协议，原生负责人已经修复的附件登记保留原样。

## 交互与实现

- pointerdown 立即启动权限申请与录音；删除短按切换、250ms 按压模式判定。pointerup 结束录音后自动上传并只发送一次，不需要再点纸飞机。
- 上滑超过 60 CSS 像素、pointercancel、丢失指针捕获、离开聊天、页面隐藏或锁定都会取消。松手时权限尚未就绪则不发送，晚返回的音轨立即释放。上传失败保留本次录音，允许点纸飞机核对重试或取消。
- AnalyserNode 读取真实输入 RMS，25 根短柱每约 70ms 向左滚动，显示计时和上滑取消提示。AudioContext 在按下手势内启动，分析支路不连扬声器。无分析能力时明确提示，不画假声波；录音结束关闭分析上下文和输入音轨。
- 用户和知微的 audio/ 消息用同一个气泡：播放/暂停、N″、三根短波形；播放波形只在实际播放中动。保留浏览器音频解码与播放事件，隐藏原生 controls；取消常驻下载链接。长按 550ms 或键盘菜单键打开保存菜单，继续走 save-file.js 与现有文件面板。
- 录音上传带实际音频 MIME，通话上传同步修正。MP4/WebM 结合 MIME 与容器字节识别，不依赖 .m4a/.weba 后缀；MP4 同时检查轨道 handler，检测到视频轨不会被音频 MIME 冒充。原生取件调用不变，纯音轨 MP4 即使无 MIME 提示也可从字节识别。
- 新 voice-ui.js 已登记静态白名单；声音 UI 尺寸、颜色、间距、圆角使用现有 tokens。

## 文件

- ziwei_web/attachments.js
- ziwei_web/public/voice-ui.js
- ziwei_web/public/chat.js
- ziwei_web/public/chat-call.js
- ziwei_web/public/index.html（本提交仅语音 DOM 与脚本引用）
- ziwei_web/public/refinement.css
- ziwei_web/public/tokens.css
- ziwei_web/server.js
- ziwei_web/package.json
- ziwei_web/e2e/chat-audio.spec.js
- ziwei_web/e2e/chat-compose.spec.js
- ziwei_web/e2e/chat-files.spec.js
- ziwei_web/test/attachment_mime.test.js
- 本交接文件

## 验证命令与实际输出

```sh
node --test ziwei_web/test/attachment_mime.test.js
```

```text
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

另用本机 ffmpeg 生成一份 AAC 纯音轨 MP4 和一份 H.264 视频 MP4，均命名为 .bin，未提供 MIME 提示，调用 identify(bytes, 'unknown.bin')，实际输出：

```text
ffmpeg_available True
{"name":"audio.bin","mime":"audio/mp4"}
{"name":"video.bin","mime":"video/mp4"}
```

定向浏览器命令和实际输出：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
ziwei_web/node_modules/.bin/playwright test \
 --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js \
 moments.spec.js chat-completion.spec.js chat-audio.spec.js chat-compose.spec.js
```

```text
25 passed (44.2s)
```

其中验证按住松手自动发送、取消零上传零发送、晚权限/晚上传隔离、实际 PCM 播放计时推进、状态刷新不重建播放器、双方按 MIME 显示气泡、长按菜单不触发播放、真实 Web Audio 信号与静音的差异、计时与资源释放。截图来自 Chromium 153 的 390×844 视口，使用隔离 fixture 和合成测试音，不是真机截图。

截图关闭主题切换过渡，并使用随时间变化的真实合成输入信号；重跑截图相关两项，实际输出 `2 passed (9.0s)`。

## 没做 / 做不了 / 未验证

没有可控制的真实 iPhone，因此 iOS Safari/PWA 的触摸捕获、系统权限弹窗、后台麦克风、真实扬声器和 safe-area 仍未验证，未提供真机截图。不能拿无头环境的 safe-area=0 当真机通过。只提供明确标注的深浅主题浏览器验收截图。

未发送线上试验语音，未部署本提交或核对本提交线上字节。未调整原生接口、补丁、测试、记忆、SOUL、Cron、配置、环境变量或卷。历史附件的线上取件修复由原生负责人负责，不在本提交中重复实现。
