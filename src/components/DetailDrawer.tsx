import { useEffect, useState } from "react";
import {
  Drawer,
  Descriptions,
  Spin,
  Button,
  Tag,
  Space,
  Typography,
  theme,
  message,
  Modal,
  Input,
} from "antd";
import {
  DownloadOutlined,
  LinkOutlined,
  EyeOutlined,
  CopyOutlined,
  EditOutlined,
  FullscreenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api } from "../api";
import type { ObjectItem, ObjectMeta, SelectedBucket, DownloadTask, TransferConfig } from "../types";
import { fmtSize, fmtDate } from "../utils";

const { Text } = Typography;

interface Props {
  open: boolean;
  target: SelectedBucket;
  item: ObjectItem | null;
  onClose: () => void;
  setDownloads: React.Dispatch<React.SetStateAction<DownloadTask[]>>;
  transferConfig: TransferConfig;
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

// ─── component ────────────────────────────────────────────────────────────────

export function DetailDrawer({ open, target, item, onClose, setDownloads, transferConfig }: Props) {
  const { token } = theme.useToken();
  const { accountId, bucket } = target;

  const [meta, setMeta]               = useState<ObjectMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentReady, setContentReady]     = useState(false);

  const [editMode, setEditMode]   = useState(false);
  const [editText, setEditText]   = useState("");
  const [updating, setUpdating]   = useState(false);

  const [imgFullscreen, setImgFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open || !item) return;
    let stale = false;

    setMeta(null);
    setPreviewUrl(null);
    setPreviewText(null);
    setContentReady(false);
    setEditMode(false);
    setEditText("");
    setImgFullscreen(false);

    setMetaLoading(true);
    api.meta(accountId, bucket, item.key)
      .then((m) => {
        if (stale) return null;
        setMeta(m);
        return m;
      })
      .catch(() => null)
      .then((m) => {
        if (stale) return;
        const pt = detectPreviewType(item, m?.content_type);
        if (pt === "image" || pt === "audio" || pt === "video") {
          return api.presign(accountId, bucket, item.key).then(({ url }) => {
            if (!stale) {
              setPreviewUrl(url);
              setContentReady(true);
            }
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setMetaLoading(false); });

    return () => { stale = true; };
  }, [open, item, accountId, bucket, refreshKey]);

  const PREVIEW_MAX_BYTES = 512 * 1024;

  const loadTextContent = async () => {
    if (!item) return;
    setContentLoading(true);
    try {
      const { text, binary } = await api.preview(accountId, bucket, item.key, PREVIEW_MAX_BYTES);
      if (binary || text === null) {
        message.warning("Binary file cannot be previewed as text.");
      } else {
        setPreviewText(text);
        setEditText(text);
        setContentReady(true);
      }
    } catch {
      message.error("Failed to load file content.");
    } finally {
      setContentLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!item) return;
    setUpdating(true);
    try {
      await api.updateText(
        accountId,
        bucket,
        item.key,
        editText,
        meta?.content_type ?? "text/plain; charset=utf-8"
      );
      setPreviewText(editText);
      setEditMode(false);
      message.success("File updated");
    } catch (e: unknown) {
      message.error(`Update failed: ${e}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleDownload = async () => {
    if (!item) return;
    const currentKey = item.key;
    const filename = currentKey.split("/").pop() || "file";
    const savePath = await save({ defaultPath: filename, title: "Save file" });
    if (!savePath) return;
    const taskId = `dl-${Date.now()}-${filename}`;
    const retry = () => {
      setDownloads((prev) => prev.filter((d) => d.id !== taskId));
      (async () => {
        const dlTaskId = `dl-${Date.now()}-${filename}`;
        setDownloads((prev) => [...prev, { id: dlTaskId, filename, progress: 0, status: "running" as const, savePath, key: currentKey }]);
        try {
          await api.download(accountId, bucket, currentKey, savePath, dlTaskId, transferConfig.download_connections, transferConfig.download_part_size);
          setDownloads((prev) =>
            prev.map((d) => d.id === dlTaskId ? { ...d, progress: 100, status: "done" as const } : d)
          );
          api.appendHistory([{
            type: "download", filename, key: currentKey, bucket,
            account_name: String(accountId), size: item?.size ?? null,
            status: "done", error: null, extra: savePath, timestamp: Date.now(),
          }]).catch(() => {});
          setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== dlTaskId)), 2500);
        } catch (re: unknown) {
          const isC = String(re).includes("Transfer cancelled");
          setDownloads((prev) =>
            prev.map((d) => d.id === dlTaskId
              ? { ...d, error: isC ? undefined : String(re), status: isC ? "cancelled" as const : "error" as const }
              : d)
          );
          setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== dlTaskId)), 5000);
        }
      })();
    };
    setDownloads((prev) => [...prev, { id: taskId, filename, progress: 0, status: "running", savePath, key: currentKey, retry }]);
    try {
      await api.download(accountId, bucket, item.key, savePath, taskId, transferConfig.download_connections, transferConfig.download_part_size);
      setDownloads((prev) =>
        prev.map((d) => d.id === taskId ? { ...d, progress: 100, status: "done" as const } : d)
      );
      api.appendHistory([{
        type: "download",
        filename,
        key: item.key,
        bucket,
        account_name: String(accountId),
        size: item.size ?? null,
        status: "done",
        error: null,
        extra: savePath,
        timestamp: Date.now(),
      }]).catch(() => {});
      setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== taskId)), 2500);
    } catch (e: unknown) {
      const isCancelled = String(e).includes("Transfer cancelled");
      setDownloads((prev) =>
        prev.map((d) => d.id === taskId
          ? { ...d, error: isCancelled ? undefined : String(e), status: isCancelled ? "cancelled" as const : "error" as const }
          : d)
      );
      // Don't auto-dismiss error/cancelled — user can retry or dismiss in Active tab.
      // Don't record to history either — they belong in Active, not Downloads.
    }
  };

  if (!item) return null;

  const previewType = detectPreviewType(item, meta?.content_type);
  const filename    = item.key.split("/").pop() || item.key;

  const renderContent = () => {
    if (previewType === "none") return null;

    if (!contentReady) {
      if (previewType === "text") {
        return (
          <Button
            icon={<EyeOutlined />}
            loading={contentLoading}
            onClick={loadTextContent}
            style={{ marginBottom: 16 }}
          >
            Load content
          </Button>
        );
      }
      if (metaLoading) return <Spin size="small" style={{ marginBottom: 16 }} />;
      return null;
    }

    if (previewType === "image" && previewUrl) {
      return (
        <div style={{ position: "relative", textAlign: "center", marginBottom: 16 }}>
          <img
            src={previewUrl}
            alt={filename}
            style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 4 }}
          />
          <Button
            icon={<FullscreenOutlined />}
            size="small"
            onClick={() => setImgFullscreen(true)}
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "rgba(0,0,0,0.45)",
              color: "#fff",
              border: "none",
            }}
          />
          <Modal
            open={imgFullscreen}
            onCancel={() => setImgFullscreen(false)}
            footer={null}
            width="80vw"
            centered
            styles={{ body: { padding: 0, textAlign: "center" } }}
          >
            <img
              src={previewUrl}
              alt={filename}
              style={{ maxWidth: "100%", maxHeight: "85vh", objectFit: "contain" }}
            />
          </Modal>
        </div>
      );
    }

    if (previewType === "audio" && previewUrl) {
      return (
        <audio controls src={previewUrl} style={{ width: "100%", marginBottom: 16 }} />
      );
    }

    if (previewType === "video" && previewUrl) {
      return (
        <video
          controls
          src={previewUrl}
          style={{ width: "100%", maxHeight: 360, borderRadius: 4, marginBottom: 16 }}
        />
      );
    }

    if (previewType === "text" && previewText !== null) {
      const fileSize = meta?.content_length ?? item.size ?? 0;
      const isTruncated = fileSize > PREVIEW_MAX_BYTES;

      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 6 }}>
            {!editMode && (
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={async () => {
                  await writeText(previewText);
                  message.success("Copied");
                }}
              >
                Copy
              </Button>
            )}
            {!editMode ? (
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={isTruncated}
                title={isTruncated ? "File too large to edit in preview" : undefined}
                onClick={() => { setEditText(previewText); setEditMode(true); }}
              >
                Edit
              </Button>
            ) : (
              <>
                <Button size="small" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button
                  size="small"
                  type="primary"
                  loading={updating}
                  onClick={handleUpdate}
                >
                  Update
                </Button>
              </>
            )}
          </div>

          {editMode ? (
            <Input.TextArea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoSize={{ minRows: 10, maxRows: 24 }}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          ) : (
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
          )}
          {isTruncated && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: "block" }}>
              Content truncated (showing first 512 KB of {fmtSize(fileSize)})
            </Text>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <Drawer
      title={null}
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => setRefreshKey((k) => k + 1)}
            loading={metaLoading}
          />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
          >
            Download
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={async () => {
              try {
                const { url } = await api.presign(accountId, bucket, item.key);
                await writeText(url);
                message.success("Presigned URL copied");
              } catch {
                message.error("Failed to generate presigned URL");
              }
            }}
          >
            Copy link
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
          {renderContent()}

          <Descriptions
            column={1}
            size="small"
            bordered
            labelStyle={{ width: 120, color: token.colorTextSecondary, fontSize: 12, textTransform: "none" }}
            contentStyle={{ fontSize: 12 }}
          >
            <Descriptions.Item label="Filename">{filename}</Descriptions.Item>
            <Descriptions.Item label="Full Key">
              <Text copyable style={{ fontSize: 12, wordBreak: "break-all" }}>
                {item.key}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Size">
              {fmtSize(meta?.content_length ?? item.size)}
              {meta?.content_length != null && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  ({meta.content_length.toLocaleString()} B)
                </Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Content-Type">
              {meta?.content_type ? <Tag>{meta.content_type}</Tag> : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Last Modified">
              {fmtDate(meta?.last_modified ?? item.last_modified, "YYYY-MM-DD HH:mm:ss")}
            </Descriptions.Item>
            {meta?.expires && (
              <Descriptions.Item label="Expires">
                <Text type="warning">{fmtDate(meta.expires, "YYYY-MM-DD HH:mm:ss")}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="ETag">
              <Text style={{ fontSize: 11, wordBreak: "break-all" }}>
                {meta?.etag || "—"}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Storage">
              {item.storage_class && item.storage_class !== "STANDARD" ? (
                <Tag color="blue">{item.storage_class}</Tag>
              ) : (
                item.storage_class || "—"
              )}
            </Descriptions.Item>
            {meta?.metadata && Object.keys(meta.metadata).length > 0 && (
              <Descriptions.Item label="User Metadata">
                {Object.entries(meta.metadata).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 12, lineHeight: 1.8 }}>
                    <Text type="secondary">{k}: </Text>
                    <Text style={{ wordBreak: "break-all" }}>{v}</Text>
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
