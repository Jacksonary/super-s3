import { useEffect, useState } from "react";
import {
  Drawer,
  Descriptions,
  Spin,
  Button,
  Alert,
  Tag,
  Space,
  Typography,
  theme,
  message,
} from "antd";
import { DownloadOutlined, LinkOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api } from "../api";
import type { ObjectItem, ObjectMeta, SelectedBucket } from "../types";

const { Text } = Typography;

interface Props {
  open: boolean;
  target: SelectedBucket;
  item: ObjectItem | null;
  onClose: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ─── file type detection ──────────────────────────────────────────────────────

type PreviewType = "image" | "audio" | "video" | "text" | "none";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const AUDIO_EXT = new Set(["mp3", "aac", "ogg", "wav", "flac", "m4a", "opus"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const TEXT_EXT  = new Set([
  "txt", "md", "log", "json", "yaml", "yml", "xml", "csv", "toml", "ini",
  "js", "ts", "jsx", "tsx", "py", "go", "rs", "sh", "bash", "zsh",
  "html", "css", "scss", "sql", "conf", "env",
]);

function detectPreviewType(item: ObjectItem, contentType?: string | null): PreviewType {
  const ext = item.key.split(".").pop()?.toLowerCase() ?? "";
  const ct  = (contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")  || IMAGE_EXT.has(ext)) return "image";
  if (ct.startsWith("audio/")  || AUDIO_EXT.has(ext)) return "audio";
  if (ct.startsWith("video/")  || VIDEO_EXT.has(ext)) return "video";
  if (ct.startsWith("text/")   || ct.includes("json") || ct.includes("xml") || TEXT_EXT.has(ext)) return "text";
  return "none";
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return dayjs(iso).format("YYYY-MM-DD HH:mm:ss");
}

// ─── component ────────────────────────────────────────────────────────────────

export function DetailDrawer({ open, target, item, onClose }: Props) {
  const { token } = theme.useToken();
  const { accountId, bucket } = target;

  const [meta, setMeta]               = useState<ObjectMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading]     = useState(false);
  const [previewReady, setPreviewReady]         = useState(false);

  // reset every time a new item opens
  useEffect(() => {
    if (!open || !item) return;
    setMeta(null);
    setPreviewUrl(null);
    setPreviewText(null);
    setPreviewTruncated(false);
    setPreviewReady(false);

    setMetaLoading(true);
    api.meta(accountId, bucket, item.key)
      .then((m) => {
        setMeta(m);
        const pt = detectPreviewType(item, m.content_type);
        if (pt === "image" || pt === "audio" || pt === "video") {
          return api.presign(accountId, bucket, item.key).then(({ url }) => {
            setPreviewUrl(url);
            setPreviewReady(true);
          });
        }
      })
      .catch((e: unknown) => {
        const detail =
          (e as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ?? (e as Error)?.message ?? "Unknown error";
        message.error(`加载元数据失败: ${detail}`);
      })
      .finally(() => setMetaLoading(false));
  }, [open, item, accountId, bucket]);

  const loadTextPreview = async () => {
    if (!item) return;
    setPreviewLoading(true);
    try {
      const { text, truncated } = await api.preview(accountId, bucket, item.key);
      setPreviewText(text);
      setPreviewTruncated(truncated);
      setPreviewReady(true);
    } catch {
      setPreviewText("Failed to load preview.");
      setPreviewReady(true);
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!item) return null;

  const previewType = detectPreviewType(item, meta?.content_type);
  const filename    = item.key.split("/").pop() || item.key;

  // ─── preview region ────────────────────────────────────────────────────────

  const renderPreview = () => {
    if (previewType === "none") return null;

    if (!previewReady) {
      if (previewType === "text") {
        return (
          <Button
            icon={<EyeOutlined />}
            loading={previewLoading}
            onClick={loadTextPreview}
            style={{ marginBottom: 16 }}
          >
            加载文本预览（前 50 KB）
          </Button>
        );
      }
      if (metaLoading) {
        return <Spin size="small" />;
      }
      return null;
    }

    if (previewType === "image" && previewUrl) {
      return (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <img
            src={previewUrl}
            alt={filename}
            style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 4 }}
          />
        </div>
      );
    }

    if (previewType === "audio" && previewUrl) {
      return (
        <audio
          controls
          src={previewUrl}
          style={{ width: "100%", marginBottom: 16 }}
        />
      );
    }

    if (previewType === "video" && previewUrl) {
      return (
        <video
          controls
          src={previewUrl}
          style={{ width: "100%", maxHeight: 400, borderRadius: 4, marginBottom: 16 }}
        />
      );
    }

    if (previewType === "text" && previewText !== null) {
      return (
        <div style={{ marginBottom: 16 }}>
          {previewTruncated && (
            <Alert
              type="info"
              message="仅展示前 50 KB，完整内容请下载"
              style={{ marginBottom: 8 }}
              banner
            />
          )}
          <pre
            style={{
              background: token.colorFillAlter,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 4,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 440,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {previewText}
          </pre>
        </div>
      );
    }

    return null;
  };

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <Drawer
      title={
        <Text ellipsis style={{ maxWidth: 300, fontSize: 14 }} title={filename}>
          {filename}
        </Text>
      }
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Space>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={api.downloadUrl(accountId, bucket, item.key)}
          >
            下载
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={async () => {
              try {
                const { url } = await api.presign(accountId, bucket, item.key);
                await copyText(url);
                message.success("预签名链接已复制");
              } catch {
                message.error("生成预签名链接失败");
              }
            }}
          >
            复制预签名链接
          </Button>
        </Space>
      }
    >
      {metaLoading ? (
        <div style={{ textAlign: "center", paddingTop: 40 }}>
          <Spin />
        </div>
      ) : (
        <>
          {renderPreview()}

          <Descriptions
            column={1}
            size="small"
            bordered
            labelStyle={{ width: 110, color: token.colorTextSecondary }}
          >
            <Descriptions.Item label="文件名">{filename}</Descriptions.Item>
            <Descriptions.Item label="完整 Key">
              <Text
                copyable
                style={{ fontSize: 12, wordBreak: "break-all" }}
              >
                {item.key}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="大小">
              {fmtSize(meta?.content_length ?? item.size)}
              {meta?.content_length != null && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  ({meta.content_length.toLocaleString()} bytes)
                </Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Content-Type">
              {meta?.content_type ? (
                <Tag>{meta.content_type}</Tag>
              ) : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="最后修改">
              {fmtDate(meta?.last_modified ?? item.last_modified)}
            </Descriptions.Item>
            {meta?.expires && (
              <Descriptions.Item label="过期时间">
                <Text type="warning">{fmtDate(meta.expires)}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="ETag">
              <Text style={{ fontSize: 11, wordBreak: "break-all" }}>
                {meta?.etag || "—"}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="存储类型">
              {item.storage_class && item.storage_class !== "STANDARD" ? (
                <Tag color="blue">{item.storage_class}</Tag>
              ) : (
                item.storage_class || "—"
              )}
            </Descriptions.Item>
            {meta?.metadata && Object.keys(meta.metadata).length > 0 && (
              <Descriptions.Item label="自定义元数据">
                {Object.entries(meta.metadata).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 12 }}>
                    <Text type="secondary">{k}:</Text> {v}
                  </div>
                ))}
              </Descriptions.Item>
            )}
          </Descriptions>
        </>
      )}
    </Drawer>
  );
}
