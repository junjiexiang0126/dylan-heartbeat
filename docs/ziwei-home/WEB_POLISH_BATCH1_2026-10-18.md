# 页面恢复第一批：1 / 3 / 4 / 5 / 6

## 基线与范围

用户要求：按《给Work-第一批-13456-20261018.md》恢复既有设计；修改代码并提交，发布由用户操作，实体手机验收由用户完成。本批不改项2（两个小按钮），不改闲聊/工作额度及白鸦委派规则。

从当前整合线4a6fd95a2a9f06fe8868eb4c13e805eb0dee4ff5创建feat/web-polish-batch1-20261018；它包含已验收Work和安全修复。原清单的6d9b4a7是旧基线，本批不回到旧版本、不整体合并fix/work-chat-limit-text。

改动前实际线上：Web source612126d4492bc16e5c8f997d75d88a67b6f0ac16，部署7fa359f3-0315-4b95-a0d3-c8cdf6f461e6 SUCCESS。Native01e35a1b84ecb11f6a907eb02932b001542f7c5c不变。没有操作线上数据、密钥、记忆或Railway源配置。

## 已恢复的五项

| 项 | 代码位置 | 做法与边界 |
| --- | --- | --- |
| 1 渡鸦说明 | raven/raven-controller.mjs、public/raven.js | 隐藏本地配文免责声明、重复的过期/更新时间说明，清除闲置状态占位句；保留页面原有唯一更新时间、真实状态与来源元数据、互动和真实载入错误。已运行npm run build:raven重建浏览器实际加载的bundle；模型和渲染bundle未产生无关差异。 |
| 3 英文纪念语与EB Garamond | home_store.js、public/index.html、server.js | 恢复来源提交的英文文案；增加现有home.css的link；只给静态类型表增加.woff2→font/woff2。home.css和93660字节EBGaramond.woff2原已存在，不重复替换。不引入志莽行书。 |
| 4 动作日志位置 | public/chat.js | 保持折叠和更新行为，将tool-action-log放到message-bubble前面；不触及模型内部推理或后端路由。 |
| 5 消息间距 | public/chat.css | 仅把共享chat-messages的gap18px改成6px。现有margin、气泡内边距、宽度和行高均保留；Work复用该类，因此也变紧。 |
| 6 连发按钮方案B | public/chat.js、chat.css | 私聊相邻同发送者、同来源的已完成消息：只保留首条发送者标签、末条操作行；中间操作行从DOM移除，后续筛选/追加/前插时可恢复。独立类控制标签与操作，避免一类同时控制首尾造成漏显示。来源说明保留；拍一拍、执行摘要、失败重发和已删除记录打断分组。媒体节点不重建。Work按钮分组本批未改。 |

来源对应：1e411475、03ecfcf、3d7db5a（渡鸦）；311eb799、898d24b、801654b（纪念语/字体）；bf136c3（动作日志）。只移植这些范围的改动，没有合入其分支的Cron、认证限流、autonomy_gate、preflight或Docker差异。Hermes原生路由表未修改，今日印记脚本、六张表情贴纸、Work代码保留。

## 自动化检查

- npm run build:raven：已完成；public/raven.js确实改变。
- npm run check：通过。
- npm test：102/102通过。
- 新增web-polish-batch1.spec.js验证字体实际加载、静态MIME和贴纸/印记引用、6px间距、分组首尾/追加/筛选/前插、失败重发边界、动作日志位置及媒体节点保留。
- 新增Web polish regression checks工作流，用Chromium与模拟iPhone WebKit执行恢复项和私聊/Work回归，保留截图供复查。最终结果在提交/整合前补记。
- 对应渡鸦测试按本次已确认文案更新；无WebGL降级测试滚动外层ravenStage，避免向降级时已隐藏的canvas滚动造成60秒超时。没有削弱静态图、重试入口或错误提示断言。

## 发布与验收交接（当前未发布）

用户部署前请使用最终交接的整合提交SHA，保留rootDirectory=/ziwei_web和现有变量/卷/域名；不要部署旧的6d9b4a7或fix/work-chat-limit-text。

部署后可用只读脚本核对清单8项以及两个实际JS文件哈希；脚本不登录、不调用模型、不写数据：

```bash
python3 ziwei_web/scripts/verify_web_polish.py
```

**当前线上八项核对：待用户部署，不标为通过。部署ID：待用户部署。**

真机待用户逐项验收：主页渡鸦不显示三句冗余说明；纪念语英文EB Garamond；连发三条只留一排末条按钮且间距6px；动作日志在气泡上方；今日印记时间轴和六张贴纸仍在。先刷新Safari/PWA，只有确认为缓存旧资源时再处理缓存，不要求默认删除主屏图标。发现不符记录具体项，避免连续叠加未验收改动。

上一部署回退参考SHA612126d4492bc16e5c8f997d75d88a67b6f0ac16；本批不执行回滚。不删除或重建记忆、数据库、卷或旧生产服务。
