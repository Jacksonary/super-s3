import { useCallback, useEffect, useRef, useState } from "react";
import { Layout, theme, Typography, ConfigProvider } from "antd";
import { CloudServerOutlined } from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { ObjectBrowser } from "./components/ObjectBrowser";
import { TransferPanel } from "./components/TransferPanel";
import type { SelectedBucket, TransferConfig, UploadTask, DownloadTask } from "./types";
import { api } from "./api";

const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
  concurrent_files: 5,
  download_connections: 12,
  upload_part_concurrency: 4,
};

const { Sider, Content } = Layout;
const { Text } = Typography;

interface AppContentProps {
  isDark: boolean;
  onThemeToggle: () => void;
}

function AppContent({ isDark, onThemeToggle }: AppContentProps) {
  const { token } = theme.useToken();
  const [selected, setSelected] = useState<SelectedBucket | null>(null);
  const [transferConfig, setTransferConfig] = useState<TransferConfig>(DEFAULT_TRANSFER_CONFIG);

  // ─── Global transfer state ──────────────────────────────────────────────
  // Lifted above ObjectBrowser so tasks survive bucket switches.
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);

  // Monotonic counter for unique task IDs — shared across bucket switches.
  const uploadTaskCounter = useRef(0);

  // ─── Resizable sidebar ─────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(180, Math.min(400, e.clientX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    api.getTransferConfig().then(setTransferConfig).catch(() => {});
  }, []);

  // Global event listeners for transfer progress.
  useEffect(() => {
    const unlistenUpload = listen<{ task_id: string; progress: number }>(
      "upload-progress",
      (event) => {
        const { task_id, progress } = event.payload;
        setUploads((prev) =>
          prev.map((u) => (u.id === task_id ? { ...u, progress } : u))
        );
      }
    );
    const unlistenDownload = listen<{ task_id: string; progress: number }>(
      "download-single-progress",
      (event) => {
        const { task_id, progress } = event.payload;
        setDownloads((prev) =>
          prev.map((d) => (d.id === task_id ? { ...d, progress } : d))
        );
      }
    );
    return () => {
      unlistenUpload.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, []);

  const handleDismissUpload = (id: string) =>
    setUploads((prev) => prev.filter((u) => u.id !== id));

  const handleDismissDownload = (id: string) =>
    setDownloads((prev) => prev.filter((d) => d.id !== id));

  const handleClearAll = () => {
    setUploads((prev) => prev.filter((u) => !u.done));
    setDownloads((prev) => prev.filter((d) => !d.done));
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={sidebarWidth}
        style={{
          background: "transparent",
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: "hidden",
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
        }}
      >
        <Sidebar
          selected={selected}
          onSelect={setSelected}
          isDark={isDark}
          onThemeToggle={onThemeToggle}
          onTransferConfigChange={setTransferConfig}
        />
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 4,
            height: "100%",
            cursor: "col-resize",
            zIndex: 10,
          }}
        />
      </Sider>

      <Layout style={{ marginLeft: sidebarWidth }}>
        <Content style={{ background: token.colorBgLayout, minHeight: "100vh" }}>
          {selected ? (
            <ObjectBrowser
              key={`${selected.accountId}-${selected.bucket}`}
              target={selected}
              transferConfig={transferConfig}
              uploads={uploads}
              downloads={downloads}
              setUploads={setUploads}
              setDownloads={setDownloads}
              uploadTaskCounter={uploadTaskCounter}
            />
          ) : (
            <div className="empty-state-wrap" style={{ height: "100vh", justifyContent: "center" }}>
              <CloudServerOutlined className="empty-state-icon" />
              <Text style={{ fontSize: 15, fontWeight: 600 }}>
                No bucket selected
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Choose a bucket from the sidebar to start browsing
              </Text>
            </div>
          )}
        </Content>
      </Layout>

      <TransferPanel
        uploads={uploads}
        downloads={downloads}
        onDismissUpload={handleDismissUpload}
        onDismissDownload={handleDismissDownload}
        onClearAll={handleClearAll}
      />
    </Layout>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem("theme") === "dark"
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    document.documentElement.style.background = isDark ? "#111213" : "#f0f2f5";
    document.body.style.background = isDark ? "#111213" : "#f0f2f5";
  }, [isDark]);

  return (
    <div data-theme={isDark ? "dark" : "light"}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: isDark ? { colorBgLayout: "#111213" } : { colorBgLayout: "#f0f2f5" },
        }}
      >
        <AppContent isDark={isDark} onThemeToggle={toggleTheme} />
      </ConfigProvider>
    </div>
  );
}
