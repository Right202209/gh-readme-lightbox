# GitHub README 图片弹层预览（Chrome / Edge 插件版）


<p align="center">
  <img src=".\icon.svg" width="120" />
</p>

<p align="center">
  <img src="./prtSc.png" width="700"/>
</p>
### 安装
1. 打开浏览器扩展管理页：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择当前文件夹 `github-readme`

### 功能
- 点击 GitHub README 中的图片，直接弹层预览
- 支持滚轮缩放
- 支持拖拽平移
- 支持双击切换适配/原始比例
- 支持打开原图或原链接
- 支持复制图片（按钮或 `C`）
- 支持浅色/深色背景切换（按钮或 `B`）
- 支持左右键切换同一 README 的多张图片（不循环）
- 未放大时可左右滑动切换图片
- `Esc` 关闭，`0` 重置，`+/-` 缩放

### 文件说明
- `manifest.json`：扩展配置
- `content.js`：主逻辑，注入到 GitHub 页面运行


