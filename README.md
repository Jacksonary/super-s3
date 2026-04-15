# Super S3

轻量级多云对象存储管理工具，支持 AWS S3、华为云 OBS、阿里云 OSS、火山云 TOS、百度云 BOS 等所有 S3 兼容协议的对象存储服务。

## 功能特性

- **多账号管理**：支持同时配置任意数量的云账号，侧栏树形展示
- **虚拟文件夹导航**：按层级浏览，面包屑路径跳转，不全量拉取
- **分页加载**：每次加载 200 条，超出点击 Load more，避免大桶卡死
- **上传**：点击上传或拖拽文件，带实时进度条，支持多文件同时上传
- **下载**：流式传输，不在内存中积压大文件
- **删除**：单个删除 / 勾选批量删除，文件夹自动递归删除内部对象
- **新建文件夹**：创建虚拟目录
- **搜索**：按 key 前缀搜索，不触发全量扫描
- **一键复制**：复制对象 key 或生成预签名下载链接（默认有效期 1 小时）

## 快速开始

### 1. 准备配置文件

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，填入真实的 ak/sk（格式见下方）。

### 2. 构建并启动

```bash
docker compose up -d --build
```

### 3. 访问

浏览器打开 [http://localhost:8080](http://localhost:8080)

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

**字段说明：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `ak` | 是 | Access Key ID |
| `sk` | 是 | Secret Access Key |
| `endpoint` | 是 | 云厂商的 S3 兼容 endpoint，AWS S3 可留空 |
| `region` | 是 | 区域标识，各云厂商格式不同 |
| `name` | 否 | 侧栏显示名称，不填自动根据 endpoint 识别 |
| `buckets` | 否 | 指定展示的桶列表；留空或 `[]` 则列出账号下所有桶 |

---

## 启动方式

### 方式一：docker compose（推荐）

配置文件放在项目根目录命名为 `config.yaml`：

```bash
docker compose up -d --build
```

重新加载配置（修改 config.yaml 后重启即可）：

```bash
docker compose restart
```

停止服务：

```bash
docker compose down
```

### 方式二：指定任意配置文件路径

修改 `docker-compose.yml` 中的 volumes 和 environment：

```yaml
volumes:
  - /your/custom/path/my-config.yaml:/config/config.yaml:ro
environment:
  - CONFIG_PATH=/config/config.yaml
```

### 方式三：docker run

```bash
docker build -t super-s3 .

docker run -d \
  --name super-s3 \
  -p 7998:8080 \
  -v /usr/local/docker-data/super-s3/config.yaml:/config/config.yaml:ro \
  --restart unless-stopped \
  registry.cn-shanghai.aliyuncs.com/hhu/super-s3:v1.0.1
```

### 修改端口

默认端口 `8080`，如需修改，编辑 `docker-compose.yml`：

```yaml
ports:
  - "9000:8080"   # 宿主机 9000 → 容器 8080
```

---

## 本地开发

如需在本地开发调试，不依赖 Docker：

**启动后端**

```bash
cd backend
pip install -r requirements.txt
CONFIG_PATH=../config.yaml uvicorn main:app --reload --port 8080
```

**启动前端**

```bash
cd frontend
npm install
npm run dev        # 访问 http://localhost:5173，自动代理 /api 到 :8080
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
