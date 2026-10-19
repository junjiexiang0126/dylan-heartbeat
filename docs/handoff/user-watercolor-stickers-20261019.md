# 用户四张水彩贴纸接入（2026-10-19）

## 范围

按用户提供的四张素材处理透明底，并替换日志/记忆页既有右上角贴纸。没有修改背景、毛玻璃参数、今日印记表情、数据或入口；不合并、不部署。

## 资产

`ziwei_web/public/stickers/` 下：

- `watercolor-heart-v1.png`：双层爱心，移除外围奶白贴纸底板。
- `watercolor-ribbon-v1.png`：蝴蝶结与卷带。
- `watercolor-blossoms-v1.png`：双朵樱花、枝叶和花苞。
- `watercolor-leaves-v1.png`：绿色叶枝。

使用内置图像编辑工具（background-extraction），提示要求保留原图水彩形状与纹理，去掉白底/棋盘格和外围底板；输出真正 RGBA 透明 PNG，不添加外框、描边、光晕或投影。保留图案内部的绘画线条。源图未覆盖；生成的 PNG 直接复制进仓库，没有再经代码重绘。

透明通道检查：四张 PNG 均有透明与非透明像素，四角 Alpha=0。图像工具预览中某些外围 RGB 颜色实际 Alpha=0，网页不会显示；以浏览器合成效果为准。

## 映射与换图

`records.js` 底部 `STICKERS` 定义四张图路径，`LOG_STICKERS` / `MEMORY_STICKERS` 按入口语义固定映射，不依赖全局遍历顺序：

| 页面/入口 | 图案 |
| --- | --- |
| 日志：工作日志 | 绿叶 |
| 日志：个人日志 | 蝴蝶结 |
| 日志：私人日志 | 爱心 |
| 日志：照片墙 | 樱花 |
| 记忆：全部记忆主卡 | 爱心 |
| 记忆：关于你 | 樱花 |
| 记忆：工作记忆 | 绿叶 |

每张卡片仍可通过 `data-sticker-src` 单独覆盖；没有新增前端换图设置页。贴纸大小、偏移和旋转继续复用既有共享变量。

`server.js` 增加四条精确 PNG 静态白名单，继续使用 image/png。没有开放任意目录。

## 验证

沿用完整真实页面的隔离 HTTP 应用 + 本地 HTTPS 代理，API 为合成测试数据。专项检查四个 PNG HTTP 200/MIME、图片解码、四档宽度定位、日夜主题、刷新/返回，以及贴纸 computed border=0、box-shadow=none、filter=none。

最终浏览器结果和截图见本 PR 对应的 Glass sticker HTTP preview 运行。自动化不等于物理 iPhone Safari/PWA 真机验收。
