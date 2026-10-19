# Personal Memory logo

采用 S2：白色负空间人物撑起右上方的大形体，黑白平面图形。

`logo-master.png` 为从 S2 方案单独导出的定稿；`mark.svg` 是对应的透明单色菜单栏轮廓。

`logo-master.png` 是生成并整理后的原始设计；PNG 与 ICNS 为尺寸/格式导出。`mark.svg` 是菜单栏使用的单色图形，透明 PNG 支持 macOS Template 与 Retina。

在仓库运行 `npm run build:brand` 可重新导出所有尺寸。Linux 无显示环境使用 `XDG_CACHE_HOME=/workspace/.cache npm run build:brand -- --no-sandbox --ozone-platform=headless --disable-gpu`。图标资源保存在仓库，普通构建不需要重新生成；Mac 发布通过 `iconutil` 验证 ICNS 可解码。
