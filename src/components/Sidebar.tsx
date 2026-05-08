import { useEffect, useState } from "react";
import {
  Tree,
  Typography,
  Spin,
  message,
  Tooltip,
  theme,
  Space,
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  DatabaseOutlined,
  InboxOutlined,
  LoadingOutlined,
  SettingOutlined,
  CloudServerOutlined,
  GithubOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import type { Account, SelectedBucket, TransferConfig } from "../types";
import { useUpdateCheck } from "../useUpdateCheck";
import { SettingsModal } from "./SettingsModal";

const { Text } = Typography;

interface Props {
  selected: SelectedBucket | null;
  onSelect: (sel: SelectedBucket) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  onTransferConfigChange: (cfg: TransferConfig) => void;
}

export function Sidebar({ selected, onSelect, isDark, onThemeToggle, onTransferConfigChange }: Props) {
  const { token } = theme.useToken();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateInfo = useUpdateCheck(__APP_VERSION__);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.accounts();
      const resolved = await Promise.all(
        data.map(async (acct) => {
          if (acct.buckets.length > 0) return acct;
          try {
            const { buckets } = await api.buckets(acct.id);
            return { ...acct, buckets };
          } catch {
            return acct;
          }
        })
      );
      setAccounts(resolved);
      if (resolved.length > 0) {
        setExpandedKeys([`account::${resolved[0].id}`]);
      }
    } catch {
      message.error("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const treeData: DataNode[] = accounts.map((acct) => ({
    key: `account::${acct.id}`,
    selectable: false,
    title: (
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.07em",
        display: "flex",
        alignItems: "center",
        gap: 5,
        paddingTop: 2,
        opacity: 0.45,
      }}>
        <DatabaseOutlined />
        {acct.name}
      </span>
    ),
    children: acct.buckets.map((b) => {
      const isSelected =
        selected?.accountId === acct.id && selected?.bucket === b;
      return {
        key: `bucket::${acct.id}::${b}`,
        isLeaf: true,
        title: (
          <Tooltip title={b} placement="right" mouseEnterDelay={0.8}>
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
                color: isSelected ? token.colorPrimary : undefined,
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              <InboxOutlined
                style={{
                  marginRight: 6,
                  opacity: isSelected ? 1 : 0.5,
                  color: isSelected ? token.colorPrimary : undefined,
                }}
              />
              {b}
            </span>
          </Tooltip>
        ),
      };
    }),
  }));

  const handleSelect = (keys: React.Key[]) => {
    const key = keys[0] as string;
    if (!key?.startsWith("bucket::")) return;
    const parts = key.split("::");
    const accountId = parseInt(parts[1], 10);
    const bucket = parts.slice(2).join("::");
    onSelect({ accountId, bucket });
  };

  const selectedKeys = selected
    ? [`bucket::${selected.accountId}::${selected.bucket}`]
    : [];

  return (
    <div className="sidebar-container">
      {/* ── Header ── */}
      <div className="sidebar-header">
        <div className="app-logo-wrap">
          <div className="app-logo-icon">
            <CloudServerOutlined />
          </div>
          <Text strong style={{ fontSize: 14, letterSpacing: "-0.01em" }}>
            Super S3
          </Text>
        </div>

        <Tooltip title="Settings">
          <div
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            role="button"
            tabIndex={0}
            aria-label="Settings"
            onKeyDown={(e) => e.key === "Enter" && setSettingsOpen(true)}
          >
            <SettingOutlined />
          </div>
        </Tooltip>
      </div>

      {/* ── Tree ── */}
      <div className="sidebar-tree-wrap">
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 36 }}>
            <Spin indicator={<LoadingOutlined spin style={{ fontSize: 18, opacity: 0.55 }} />} />
          </div>
        ) : (
          <Tree
            className="sidebar-tree"
            treeData={treeData}
            selectedKeys={selectedKeys}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={handleSelect}
            blockNode
            style={{ fontSize: 13, background: "transparent" }}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <div className="sidebar-footer">
        {updateInfo ? (
          <Tooltip title={`v${updateInfo.latestVersion} available — click to open release`}>
            <a
              onClick={() => openUrl(updateInfo.releaseUrl)}
              onKeyDown={(e) => e.key === "Enter" && openUrl(updateInfo.releaseUrl)}
              className="update-badge"
              role="link"
              tabIndex={0}
              aria-label={`Update available: v${__APP_VERSION__} → v${updateInfo.latestVersion}, click to view release`}
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              <span className="update-dot" />
              <Text style={{ fontSize: 11, color: token.colorWarningText }}>
                v{__APP_VERSION__} → v{updateInfo.latestVersion}
              </Text>
            </a>
          </Tooltip>
        ) : (
          <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
            v{__APP_VERSION__}
          </Text>
        )}

        <Space size={4} align="center">
          <Tooltip title="GitHub">
            <a
              onClick={() => openUrl("https://github.com/Jacksonary/super-s3-app")}
              onKeyDown={(e) => e.key === "Enter" && openUrl("https://github.com/Jacksonary/super-s3-app")}
              className="sidebar-icon-link"
              role="link"
              tabIndex={0}
              aria-label="GitHub repository"
              style={{ color: token.colorTextQuaternary, cursor: "pointer" }}
            >
              <GithubOutlined />
            </a>
          </Tooltip>
          <Tooltip title="Gitee">
            <a
              onClick={() => openUrl("https://gitee.com/weiguoliu/super-s3-app")}
              onKeyDown={(e) => e.key === "Enter" && openUrl("https://gitee.com/weiguoliu/super-s3-app")}
              className="sidebar-icon-link"
              role="link"
              tabIndex={0}
              aria-label="Gitee repository"
              style={{ color: token.colorTextQuaternary, cursor: "pointer" }}
            >
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
                <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.26.593.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.26.593.593.593h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
              </svg>
            </a>
          </Tooltip>
        </Space>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAccountsChange={loadAccounts}
        onTransferConfigChange={onTransferConfigChange}
        isDark={isDark}
        onThemeToggle={onThemeToggle}
      />
    </div>
  );
}
