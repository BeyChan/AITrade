# AITrade 亚马逊竞品一键采集 Chrome 扩展

在亚马逊前台（US、AU、UK、DE、JP 等）商品详情页，一键提取真实商品数据（真实面包屑类目、售价、五点描述和买家差评），直接送入 AITrade 竞品对比工作台。

## 安装方式

1. 打开 Chrome 浏览器，进入扩展管理页：`chrome://extensions/`
2. 开启右上角的 **“开发者模式” (Developer mode)**。
3. 点击左上角 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选择当前项目的扩展目录：`extensions/aitrade-competitor-capture/`。
5. 完成安装！

## 使用流程

1. 确保本地 AITrade 服务已运行在 `http://localhost:3000`。
2. 在浏览器中打开任意亚马逊商品详情页（如 `https://www.amazon.com.au/dp/B0H4QFZRNH`）。
3. 点击浏览器右上角扩展栏的 **AITrade 竞品采集** 图标。
4. 插件自动预览提取到的**真实面包屑类目、标题、售价与评分**。
5. 点击 **【🚀 送入 AITrade 竞品对比】**，系统自动完成智能对标并在新标签页呈现对比研报！
