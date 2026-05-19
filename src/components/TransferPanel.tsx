import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Progress,
  Tooltip,
  Typography,
  Space,
  theme,
  Modal,
  message,
} from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  SwapOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import type { UploadTask, DownloadTask, HistoryEntry, TransferStatus } from "../types";

dayjs.extend(relativeTime);

const { Text } = Typography;

const isFinished = (s: TransferStatus) => s === "done";
const isActive = (s: TransferStatus) =>
  s === "running" || s === "paused" || s === "pending" || s === "error" || s === "cancelled";
const isInactive = (s: TransferStatus) => s === "paused" || s === "pending";

interface Props {
  uploads: UploadTask[];
  downloads: DownloadTask[];
  onDismissUpload: (id: string) => void;
  onDismissDownload: (id: string) => void;
  onClearAll: () => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  multipartThresholdMb?: number;
}

type Tab = "active" | "uploads" | "downloads";

export function TransferPanel({
  uploads,
  downloads,
  onDismissUpload,
  onDismissDownload,
  onClearAll,
  onPause,
  onResume,
  onCancel,
  multipartThresholdMb = 16,
}: Props) {
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const activeCount = uploads.filter((u) => isActive(u.status)).length
    + downloads.filter((d) => isActive(d.status)).length;
  useEffect(() => {
    if (activeCount > 0) {
      setExpanded(true);
      setTab("active");
    }
  }, [activeCount]);

  useEffect(() => {
    if ((tab === "uploads" || tab === "downloads") && !historyLoaded) {
      api.getHistory()
        .then((data) => { setHistory(data); setHistoryLoaded(true); })
        .catch(() => { setHistoryLoaded(true); });
    }
  }, [tab, historyLoaded]);

  const totalCount = uploads.length + downloads.length;
  const uploadHistory = history.filter((h) => h.type === "upload").reverse();
  const downloadHistory = history.filter((h) => h.type === "download").reverse();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {expanded && (
        <div
          className="transfer-panel-card"
          style={{
            width: 360,
            maxHeight: 480,
            borderRadius: token.borderRadiusLG,
            boxShadow: token.boxShadowSecondary,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header with tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 14px",
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillAlter,
              flexShrink: 0,
              gap: 2,
            }}
          >
            <div style={{ flex: 1, display: "flex", gap: 2 }}>
              <Button
                size="small"
                type={tab === "active" ? "primary" : "text"}
                icon={<ThunderboltOutlined />}
                onClick={() => setTab("active")}
                style={{ fontSize: 12 }}
              >
                Active{activeCount > 0 ? ` (${activeCount})` : ""}
              </Button>
              <Button
                size="small"
                type={tab === "uploads" ? "primary" : "text"}
                icon={<UploadOutlined />}
                onClick={() => { if (tab !== "uploads") { setTab("uploads"); setHistoryLoaded(false); } }}
                style={{ fontSize: 12 }}
              >
                Uploads
              </Button>
              <Button
                size="small"
                type={tab === "downloads" ? "primary" : "text"}
                icon={<DownloadOutlined />}
                onClick={() => { if (tab !== "downloads") { setTab("downloads"); setHistoryLoaded(false); } }}
                style={{ fontSize: 12 }}
              >
                Downloads
              </Button>
            </div>
            <Space size={4}>
              {tab === "active" && totalCount > 0 && (
                <Button size="small" type="text" onClick={onClearAll}
                  style={{ fontSize: 12, color: token.colorTextSecondary }}>Clear</Button>
              )}
              {(tab === "uploads" || tab === "downloads") && history.length > 0 && (
                <Button size="small" type="text"
                  onClick={() => {
                    Modal.confirm({
                      title: "Clear all transfer history?",
                      content: "This will clear both upload and download records.",
                      okText: "Clear",
                      okButtonProps: { danger: true },
                      onOk: () => api.clearHistory().then(() => setHistory([])).catch(() => {}),
                    });
                  }}
                  style={{ fontSize: 12, color: token.colorTextSecondary }}>Clear</Button>
              )}
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setExpanded(false)} />
            </Space>
          </div>

          {/* Content */}
          <div style={{ overflowY: "auto", padding: "8px 14px", flex: 1 }}>
            {tab === "active" ? (
              <>
                {uploads.map((u) => (
                  <UploadTaskRow
                    key={u.id}
                    task={u}
                    onDismiss={() => onDismissUpload(u.id)}
                    onPause={() => onPause(u.id)}
                    onResume={() => onResume(u.id)}
                    onCancel={() => onCancel(u.id)}
                    multipartThresholdMb={multipartThresholdMb}
                  />
                ))}
                {downloads.map((d) => (
                  <DownloadTaskRow
                    key={d.id}
                    task={d}
                    onDismiss={() => onDismissDownload(d.id)}
                    onPause={() => onPause(d.id)}
                    onResume={() => onResume(d.id)}
                    onCancel={() => onCancel(d.id)}
                    multipartThresholdMb={multipartThresholdMb}
                  />
                ))}
                {totalCount === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>No active transfers</Text>
                )}
              </>
            ) : tab === "uploads" ? (
              uploadHistory.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>No upload history</Text>
              ) : (
                uploadHistory.map((h, i) => <HistoryRow key={i} entry={h} />)
              )
            ) : (
              downloadHistory.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>No download history</Text>
              ) : (
                downloadHistory.map((h, i) => <HistoryRow key={i} entry={h} showOpen />)
              )
            )}
          </div>
        </div>
      )}

      {/* FAB trigger */}
      <Tooltip title={expanded ? "Hide transfers" : "Show transfers"} placement="left">
        <Badge count={activeCount} size="small" offset={[-4, 4]}>
          <Button
            type="primary"
            shape="circle"
            size="large"
            className="transfer-fab-btn"
            icon={<SwapOutlined rotate={90} />}
            onClick={() => setExpanded((v) => !v)}
            style={{
              width: 44,
              height: 44,
              boxShadow: token.boxShadow,
              opacity: activeCount > 0 ? 1 : 0.72,
            }}
          />
        </Badge>
      </Tooltip>
    </div>
  );
}

// ─── UploadTaskRow ──────────────────────────────────────────────────────────

function UploadTaskRow({
  task,
  onDismiss,
  onPause,
  onResume,
  onCancel,
  multipartThresholdMb,
}: {
  task: UploadTask;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  multipartThresholdMb: number;
}) {
  const { token } = theme.useToken();
  const thresholdBytes = multipartThresholdMb * 1024 * 1024;
  const isSmall = task.size != null && task.size < thresholdBytes;

  const progressStatus = task.status === "error" || task.status === "cancelled"
    ? "exception"
    : task.status === "done"
    ? "success"
    : task.status === "paused"
    ? "normal"
    : "active";

  const errorMsg = task.error ?? (task.status === "cancelled" ? "Cancelled" : undefined);

  const actions = task.status === "running" ? (
    isSmall ? (
      <Tooltip title="Cancel">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
      </Tooltip>
    ) : (
      <Space size={2}>
        <Tooltip title="Pause">
          <Button size="small" type="text" icon={<PauseCircleOutlined />} onClick={onPause} />
        </Tooltip>
        <Tooltip title="Cancel">
          <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
        </Tooltip>
      </Space>
    )
  ) : task.status === "paused" ? (
    <Space size={2}>
      <Tooltip title="Resume">
        <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={onResume} />
      </Tooltip>
      <Tooltip title="Cancel">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
      </Tooltip>
    </Space>
  ) : (task.status === "error" || task.status === "cancelled") ? (
    <Space size={2}>
      {task.retry && (
        <Tooltip title="Retry">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={task.retry} />
        </Tooltip>
      )}
      <Tooltip title="Dismiss">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onDismiss} />
      </Tooltip>
    </Space>
  ) : task.status === "done" ? null : null;

  return (
    <div className="transfer-task-row">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <UploadOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />
        <Text
          style={{
            fontSize: 12, flex: 1, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", color: token.colorText,
          }}
          title={task.filename}
        >
          {task.filename}
        </Text>
        {actions}
      </div>
      <Progress
        percent={task.progress}
        size="small"
        status={progressStatus}
        format={() =>
          errorMsg ? (
            <Text type="danger" style={{ fontSize: 10 }}>
              {errorMsg.length > 30 ? errorMsg.slice(0, 30) + "…" : errorMsg}
            </Text>
          ) : task.status === "paused" ? (
            <Text type="secondary" style={{ fontSize: 10 }}>Paused</Text>
          ) : (
            `${task.progress}%`
          )
        }
      />
    </div>
  );
}

// ─── DownloadTaskRow ────────────────────────────────────────────────────────

function DownloadTaskRow({
  task,
  onDismiss,
  onPause,
  onResume,
  onCancel,
  multipartThresholdMb,
}: {
  task: DownloadTask;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  multipartThresholdMb: number;
}) {
  const { token } = theme.useToken();
  const thresholdBytes = multipartThresholdMb * 1024 * 1024;
  const isSmall = task.size != null && task.size < thresholdBytes;

  const progressStatus = task.status === "error" || task.status === "cancelled"
    ? "exception"
    : task.status === "done"
    ? "success"
    : task.status === "paused"
    ? "normal"
    : "active";

  const errorMsg = task.error ?? (task.status === "cancelled" ? "Cancelled" : undefined);

  const actions = task.status === "running" ? (
    isSmall ? (
      <Tooltip title="Cancel">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
      </Tooltip>
    ) : (
      <Space size={2}>
        <Tooltip title="Pause">
          <Button size="small" type="text" icon={<PauseCircleOutlined />} onClick={onPause} />
        </Tooltip>
        <Tooltip title="Cancel">
          <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
        </Tooltip>
      </Space>
    )
  ) : task.status === "paused" ? (
    <Space size={2}>
      <Tooltip title="Resume">
        <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={onResume} />
      </Tooltip>
      <Tooltip title="Cancel">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onCancel} />
      </Tooltip>
    </Space>
  ) : (task.status === "error" || task.status === "cancelled") ? (
    <Space size={2}>
      {task.retry && (
        <Tooltip title="Retry">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={task.retry} />
        </Tooltip>
      )}
      <Tooltip title="Dismiss">
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onDismiss} />
      </Tooltip>
    </Space>
  ) : task.status === "done" ? (
    <Tooltip title="Dismiss">
      <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onDismiss} />
    </Tooltip>
  ) : null;

  return (
    <div className="transfer-task-row">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <DownloadOutlined style={{ color: token.colorSuccess, fontSize: 12 }} />
        <Text
          style={{
            fontSize: 12, flex: 1, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", color: token.colorText,
          }}
          title={task.filename}
        >
          {task.filename}
        </Text>
        {actions}
      </div>
      <Progress
        percent={task.progress}
        size="small"
        status={progressStatus}
        format={() =>
          errorMsg ? (
            <Text type="danger" style={{ fontSize: 10 }}>
              {errorMsg.length > 30 ? errorMsg.slice(0, 30) + "…" : errorMsg}
            </Text>
          ) : task.status === "paused" ? (
            <Text type="secondary" style={{ fontSize: 10 }}>Paused</Text>
          ) : (
            `${task.progress}%`
          )
        }
      />
    </div>
  );
}

// ─── HistoryRow ─────────────────────────────────────────────────────────────

function HistoryRow({ entry, showOpen }: { entry: HistoryEntry; showOpen?: boolean }) {
  const { token } = theme.useToken();
  const isError = entry.status === "error";
  const isUpload = entry.type === "upload";

  const handleOpenDir = () => {
    if (entry.extra) {
      revealItemInDir(entry.extra).catch(() => message.warning("File no longer exists at this location"));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <span style={{
        fontSize: 12, flexShrink: 0,
        color: isError ? token.colorError : isUpload ? token.colorPrimary : token.colorSuccess,
      }}>
        {isUpload ? <UploadOutlined /> : <DownloadOutlined />}
      </span>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Text
          style={{
            fontSize: 12, display: "block", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: isError ? token.colorError : token.colorText,
          }}
          title={entry.key}
        >
          {entry.filename}
        </Text>
        <Text type="secondary" style={{ fontSize: 10 }}>
          {entry.bucket} · {dayjs(entry.timestamp).fromNow()}
        </Text>
      </div>
      {isError && entry.error && (
        <Tooltip title={entry.error}>
          <CloseCircleOutlined style={{ fontSize: 12, color: token.colorError, flexShrink: 0 }} />
        </Tooltip>
      )}
      {showOpen && !isError && entry.extra && (
        <Tooltip title="Open in folder">
          <Button
            size="small"
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={handleOpenDir}
            style={{ fontSize: 12, color: token.colorTextSecondary }}
          />
        </Tooltip>
      )}
    </div>
  );
}
