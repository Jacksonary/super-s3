import { useEffect, useRef, useState } from "react";
import {
  Tree,
  Typography,
  Spin,
  message,
  Tooltip,
  theme,
  Space,
  Progress,
  Menu,
  Modal,
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  DatabaseOutlined,
  InboxOutlined,
  LoadingOutlined,
  SettingOutlined,
  CloudServerOutlined,
  GithubOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../api";
import type { Account, SelectedBucket, TransferConfig } from "../types";
import { useUpdateCheck, type UpdateState } from "../useUpdateCheck";
import { SettingsModal, type SettingsAction } from "./SettingsModal";

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
  const [accounts, setAccounts] = useState<{ account: Account; status: "ok" | "error" }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAction, setSettingsAction] = useState<SettingsAction>(null);
  const [acctMenu, setAcctMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const { state: updateState, setState: setUpdateState, fallback } = useUpdateCheck(__APP_VERSION__);

  const updatingRef = useRef(false);
  const updateRef = useRef(updateState.status === "available" ? updateState.update : null);
  if (updateState.status === "available") updateRef.current = updateState.update;

  const handleUpdate = async () => {
    if (updateState.status !== "available" || updatingRef.current) return;
    updatingRef.current = true;
    const update = updateRef.current!;
    let total = 0;
    let downloaded = 0;
    try {
      setUpdateState({ status: "downloading", progress: 0 });
      await update.downloadAndInstall((e) => {
        if (e.event === "Started" && e.data.contentLength) {
          total = e.data.contentLength;
        } else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          if (total > 0) setUpdateState({ status: "downloading", progress: Math.round((downloaded / total) * 100) });
        }
      });
      setUpdateState({ status: "ready" });
    } catch (err) {
      updatingRef.current = false;
      setUpdateState({ status: "error", message: String(err) });
    }
  };

  const retryCheck = () => {
    updatingRef.current = false;
    sessionStorage.removeItem("super-s3-update-check");
    setUpdateState({ status: "idle" });
  };

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.accounts();
      const resolved = await Promise.all(
        data.map(async (acct): Promise<{ account: Account; status: "ok" | "error" }> => {
          if (acct.buckets.length > 0) return { account: acct, status: "ok" };
          try {
            const { buckets } = await api.buckets(acct.id);
            return { account: { ...acct, buckets }, status: "ok" };
          } catch {
            return { account: acct, status: "error" };
          }
        })
      );
      setAccounts(resolved);
      if (resolved.length > 0) {
        setExpandedKeys([`account::${resolved[0].account.id}`]);
      }
    } catch {
      message.error("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = (id: string, name: string) => {
    Modal.confirm({
      title: `Delete "${name}"?`,
      content: "This account and its stored credentials will be removed.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const configs = await api.getConfig();
          await api.putConfig(configs.filter((a) => a.id !== id));
          loadAccounts();
        } catch {
          message.error("Failed to delete account");
        }
      },
    });
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const treeData: DataNode[] = accounts.map(({ account: acct, status }) => ({
    key: `account::${acct.id}`,
    selectable: false,
    title: (
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 5,
          paddingTop: 2,
          opacity: 0.65,
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAcctMenu({ id: String(acct.id), name: acct.name, x: e.clientX, y: e.clientY });
        }}
      >
        <DatabaseOutlined />
        {acct.name}
        {status === "error" && (
          <Tooltip title="Connection failed">
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: token.colorError, display: "inline-block", marginLeft: 2,
            }} />
          </Tooltip>
        )}
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

  treeData.push({
    key: "add-account",
    selectable: true,
    isLeaf: true,
    title: (
      <span style={{
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 5,
        paddingTop: 2,
        opacity: 0.45,
        cursor: "pointer",
      }}>
        <PlusOutlined />
        Add account
      </span>
    ),
  });

  const handleSelect = (keys: React.Key[]) => {
    const key = keys[0] as string;
    if (key === "add-account") {
      setSettingsAction({ type: "add" });
      setSettingsOpen(true);
      return;
    }
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
        {updateState.status === "available" ? (
          <Tooltip title={`v${updateState.version} available — click to update`}>
            <a
              onClick={handleUpdate}
              onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
              className="update-badge"
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              <span className="update-dot" />
              <Text style={{ fontSize: 11, color: token.colorWarningText }}>
                v{__APP_VERSION__} → v{updateState.version}
              </Text>
            </a>
          </Tooltip>
        ) : updateState.status === "downloading" ? (
          <div style={{ width: "100%" }}>
            <Text style={{ fontSize: 11, color: token.colorWarningText }}>
              Downloading... {updateState.progress}%
            </Text>
            <Progress percent={updateState.progress} size="small" showInfo={false} strokeColor={token.colorWarning} />
          </div>
        ) : updateState.status === "ready" ? (
          <a
            onClick={() => relaunch()}
            onKeyDown={(e) => e.key === "Enter" && relaunch()}
            className="update-badge"
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer", textDecoration: "none" }}
          >
            <span className="update-dot" />
            <Text style={{ fontSize: 11, color: token.colorSuccessText }}>
              Update ready — restart now
            </Text>
          </a>
        ) : updateState.status === "error" ? (
          <Tooltip title={updateState.message}>
            <a
              onClick={retryCheck}
              onKeyDown={(e) => e.key === "Enter" && retryCheck()}
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              <Text style={{ fontSize: 11, color: token.colorErrorText }}>
                Update failed — retry
              </Text>
            </a>
          </Tooltip>
        ) : fallback ? (
          <Tooltip title={`v${fallback.latestVersion} available — click to open release`}>
            <a
              onClick={() => openUrl(fallback.releaseUrl)}
              onKeyDown={(e) => e.key === "Enter" && openUrl(fallback.releaseUrl)}
              className="update-badge"
              role="link"
              tabIndex={0}
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              <span className="update-dot" />
              <Text style={{ fontSize: 11, color: token.colorWarningText }}>
                v{__APP_VERSION__} → v{fallback.latestVersion}
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
        onClose={() => { setSettingsOpen(false); setSettingsAction(null); }}
        onAccountsChange={loadAccounts}
        onTransferConfigChange={onTransferConfigChange}
        isDark={isDark}
        onThemeToggle={onThemeToggle}
        initialAction={settingsAction}
      />

      {/* Account right-click context menu */}
      {acctMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1050 }}
          onClick={() => setAcctMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setAcctMenu(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") setAcctMenu(null); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <Menu
            style={{
              position: "fixed",
              left: acctMenu.x,
              top: acctMenu.y,
              zIndex: 1051,
              borderRadius: 8,
              boxShadow: token.boxShadowSecondary,
              minWidth: 140,
            }}
            items={[
              { key: "edit", label: "Edit", icon: <EditOutlined /> },
              { type: "divider" },
              { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true },
            ]}
            onClick={({ key }) => {
              const { id, name } = acctMenu;
              setAcctMenu(null);
              if (key === "edit") {
                setSettingsAction({ type: "edit", accountId: id });
                setSettingsOpen(true);
              } else if (key === "delete") {
                deleteAccount(id, name);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
