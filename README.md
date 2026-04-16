# Super S3

轻量级多云对象存储管理工具，支持 AWS S3、华为云 OBS、阿里云 OSS、火山云 TOS、百度云 BOS 等所有 S3 兼容协议的对象存储服务。

**仓库地址**：[GitHub](https://github.com/Jacksonary/super-s3) | [Gitee](https://gitee.com/weiguoliu/super-s3)

## 功能特性

- **多账号管理**：支持同时配置任意数量的云账号，侧栏树形展示；支持在页面内直接新增、编辑、删除账号，无需登录宿主机改配置文件
- **亮色 / 暗色主题**：侧边栏顶部一键切换，偏好持久化保存，刷新后自动恢复
- **虚拟文件夹导航**：按层级浏览，面包屑路径跳转，不全量拉取
- **分页浏览**：每页 10 / 20 / 50 条可选（默认 10），游标式翻页，任意深度无性能衰减
- **前缀检索**：按 key 前缀搜索，不触发全量扫描，搜索结果同样支持翻页
- **对象详情**：点击文件名查看完整元数据（大小、Content-Type、修改时间、过期时间、ETag、自定义元数据）
- **预览 / 查看**：
  - 图片：内联展示，右下角支持全屏放大
  - 音频 / 视频：浏览器原生播放器
  - 文本：全量加载，支持一键复制和在线编辑后覆盖更新
- **上传**：点击上传或拖拽文件，带实时进度条，支持多文件同时上传
- **下载**：流式传输，不在内存中积压大文件
- **删除**：单个删除 / 勾选批量删除，文件夹自动递归删除内部对象
- **新建文件夹**：创建虚拟目录
- **预签名链接**：生成带时效的下载链接（默认 1 小时），兼容 HTTP 环境下的剪贴板写入

---

## 快速开始

> 无需克隆代码、无需编译，两步即可运行。

### 1. 准备配置文件

```bash
cp config.example.yaml config.yaml
# 编辑 config.yaml，填入你的 ak / sk
```

格式参考下方"配置文件格式"一节。也可以跳过此步，启动后在页面侧边栏的齿轮图标中直接添加账号。

### 2. 启动服务

```bash
docker run -d \
  --name super-s3 \
  -p 8080:8080 \
  -v $(pwd)/config.yaml:/config/config.yaml \
  -e CONFIG_PATH=/config/config.yaml \
  --restart unless-stopped \
  registry.cn-shanghai.aliyuncs.com/hhu/super-s3:1.0.6
```

访问 <http://localhost:8080> 即可使用。

---

## 配置文件格式

`config.yaml` 是一个 YAML 列表，每个元素代表一个云账号。

```yaml
# 华为云 OBS
- name: "华为云 OBS"         # 可选，不填则自动识别云厂商名称
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://obs.cn-east-3.myhuaweicloud.com"
  region: cn-east-3
  buckets:                   # 只展示列表中的桶
    - my-bucket-1
    - my-bucket-2

# 阿里云 OSS
- name: "阿里云 OSS"
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://oss-cn-beijing.aliyuncs.com"
  region: oss-cn-beijing
  buckets:
    - my-oss-bucket

# 火山云 TOS
- name: "火山云 TOS"
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://tos-s3-cn-beijing.volces.com"
  region: cn-beijing
  buckets: []                # 留空则列出该账号下所有桶

# 百度云 BOS
- name: "百度云 BOS"
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: "https://s3.bj.bcebos.com"
  region: bj
  buckets:
    - my-bos-bucket

# AWS S3（endpoint 留空使用官方地址）
- name: "AWS S3"
  ak: YOUR_ACCESS_KEY
  sk: YOUR_SECRET_KEY
  endpoint: ""
  region: us-east-1
  buckets: []
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ak` | 是 | Access Key ID |
| `sk` | 是 | Secret Access Key |
| `endpoint` | 是 | 云厂商的 S3 兼容 endpoint，AWS S3 可留空 |
| `region` | 是 | 区域标识，各云厂商格式不同 |
| `name` | 否 | 侧栏显示名称，不填自动根据 endpoint 识别 |
| `buckets` | 否 | 指定展示的桶列表；留空或 `[]` 则列出账号下所有桶 |

---

## 其他启动方式

### docker compose

适合长期部署，将配置文件放在项目根目录命名为 `config.yaml`，然后：

```bash
docker compose up -d
```

`docker-compose.yml` 默认使用本地构建镜像。如需直接使用预构建镜像，将文件中的 `build: .` 替换为：

```yaml
image: registry.cn-shanghai.aliyuncs.com/hhu/super-s3:1.0.6
```

重新加载配置（修改 config.yaml 后重启即可）：

```bash
docker compose restart
```

### 修改端口

默认端口 `8080`，如需修改，将 `-p 8080:8080` 改为目标端口即可，例如：

```bash
docker run -d \
  --name super-s3 \
  -p 9000:8080 \
  -v $(pwd)/config.yaml:/config/config.yaml \
  -e CONFIG_PATH=/config/config.yaml \
  --restart unless-stopped \
  registry.cn-shanghai.aliyuncs.com/hhu/super-s3:1.0.6
```

---

## 从源码构建

如需二次开发或自行打包：

```bash
git clone <repo>
cd super-s3
cp config.example.yaml config.yaml
docker compose up -d --build
```

本地开发（不依赖 Docker）：

```bash
# 后端
cd backend
pip install -r requirements.txt
CONFIG_PATH=../config.yaml uvicorn main:app --reload --port 8080

# 前端（另开终端）
cd frontend
npm install
npm run dev   # 访问 http://localhost:5173，自动代理 /api 到 :8080
```

---

## 常见端点参考

| 云厂商 | Endpoint 格式示例 |
|--------|-------------------|
| AWS S3 | 留空或 `https://s3.amazonaws.com` |
| 华为云 OBS | `https://obs.{region}.myhuaweicloud.com` |
| 阿里云 OSS | `https://oss-{region}.aliyuncs.com` |
| 火山云 TOS | `https://tos-s3-{region}.volces.com` |
| 百度云 BOS | `https://s3.{region}.bcebos.com` |
| 腾讯云 COS | `https://cos.{region}.myqcloud.com` |
| MinIO | `http://your-minio-host:9000` |

---

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。
