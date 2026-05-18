[English](README.md) | [简体中文](README.zh-CN.md)

# Super S3 Desktop

多云对象存储管理桌面客户端，支持 AWS S3、华为云 OBS、阿里云 OSS、火山云 TOS、百度云 BOS、腾讯云 COS、七牛云 Kodo、MinIO 等所有 S3 兼容协议的对象存储服务。

基于 [Tauri 2](https://v2.tauri.app/) + Rust + React 构建，无需 Docker、无需部署服务器，双击即用。

**仓库地址**：[GitHub](https://github.com/Jacksonary/super-s3-app) | [Gitee](https://gitee.com/weiguoliu/super-s3-app)

## 界面预览

| 主界面 | 账户管理 | 对象详情 |
|--------|----------|----------|
| ![主界面](docs/images/main.png) | ![账户管理](docs/images/account.png) | ![对象详情](docs/images/detail.png) |

## 功能特性

### 多账号管理
- 支持同时配置任意数量的云账号，侧栏树形展示
- 应用内直接新增、编辑、删除账号，无需手动编辑配置文件
- 自动识别云厂商名称（华为云 OBS、阿里云 OSS、火山云 TOS 等）

### 文件浏览
- 虚拟文件夹层级导航，面包屑路径跳转
- 分页浏览（10 / 20 / 50 条可选），游标式翻页，任意深度无性能衰减
- 前缀检索，不触发全量扫描，搜索结果支持翻页

### 文件操作
- **上传**：系统文件对话框选择 或 拖拽文件上传，支持多文件
- **下载**：系统保存对话框选择路径，从 S3 直接流式写入本地文件
- **删除**：单个 / 勾选批量删除，文件夹自动递归删除
- **新建文件夹**：创建虚拟目录
- **预签名链接**：生成带时效的下载链接（默认 1 小时），一键复制到剪贴板

### 文件预览
- 图片：内联展示 + 全屏放大
- 音频 / 视频：原生播放器
- 文本 / 代码：全量加载，支持一键复制和在线编辑后覆盖更新
- 完整元数据查看（大小、Content-Type、修改时间、过期时间、ETag、自定义元数据）

### 主题
- 亮色 / 暗色主题一键切换，偏好自动持久化

## 下载安装

前往 [GitHub Releases](https://github.com/Jacksonary/super-s3-app/releases) 或 [Gitee Releases](https://gitee.com/weiguoliu/super-s3-app/releases) 页面下载对应平台的安装包：

| 平台 | 格式 |
|------|------|
| Windows 64-bit | `.exe` (NSIS) / `.msi` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

> Linux AppImage 无需安装，赋予执行权限后直接运行：`chmod +x Super\ S3_*.AppImage && ./Super\ S3_*.AppImage`

## 配置说明

首次启动时账号列表为空，点击侧栏齿轮图标添加账号即可。配置自动保存在系统应用数据目录：

| 系统 | 路径 |
|------|------|
| Linux | `~/.config/super-s3/config.yaml` |
| macOS | `~/Library/Application Support/super-s3/config.yaml` |
| Windows | `%APPDATA%\super-s3\config.yaml` |

配置格式（YAML 列表，每项一个云账号）：

```yaml
- name: "华为云 OBS"           # 可选，不填自动识别
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://obs.cn-east-3.myhuaweicloud.com"
  region: cn-east-3
  buckets:                     # 留空则列出全部桶
    - my-bucket-1

- name: "阿里云 OSS"
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://oss-cn-beijing.aliyuncs.com"
  region: oss-cn-beijing
  buckets: []
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ak` | 是 | Access Key ID |
| `sk` | 是 | Secret Access Key |
| `endpoint` | 是 | S3 兼容 endpoint，AWS S3 可留空 |
| `region` | 是 | 区域标识 |
| `name` | 否 | 显示名称，不填自动根据 endpoint 识别 |
| `buckets` | 否 | 指定展示的桶列表，留空列出全部 |

## 常见 Endpoint

| 云厂商 | Endpoint 格式 |
|--------|---------------|
| AWS S3 | 留空 或 `https://s3.amazonaws.com` |
| 华为云 OBS | `https://obs.{region}.myhuaweicloud.com` |
| 阿里云 OSS | `https://oss-{region}.aliyuncs.com` |
| 火山云 TOS | `https://tos-s3-{region}.volces.com` |
| 百度云 BOS | `https://s3.{region}.bcebos.com` |
| 腾讯云 COS | `https://cos.{region}.myqcloud.com` |
| 七牛云 Kodo | `https://s3-{region}.qiniucs.com` |
| MinIO | `http://your-host:9000` |

## 从源码构建

```bash
# 前提：安装 Rust、Node.js、Tauri 系统依赖
# Linux: sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev
# Tauri CLI: cargo install tauri-cli@^2

git clone https://github.com/Jacksonary/super-s3-app.git
cd super-s3-app
npm install
cargo tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Tauri 2 |
| 后端 | Rust + aws-sdk-s3 |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 构建 | Vite 5 + Cargo |

---

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。

## 打赏支持

如果这个项目对你有帮助，欢迎请作者喝瓶啤酒 🍺

<p align="center">
  <table align="center"><tr>
    <td align="center">
      <img src="docs/images/weixinpay.png" width="240" alt="微信打赏"><br>微信
    </td>
    <td width="60"></td>
    <td align="center">
      <img src="docs/images/alipay.png" width="240" alt="支付宝打赏"><br>支付宝
    </td>
  </tr></table>
</p>
