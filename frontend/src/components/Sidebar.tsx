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
  ArrowRightOutlined,
  DatabaseOutlined,
  InboxOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
  CloudServerOutlined,
  GithubOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { Account, SelectedBucket } from "../types";
import { useUpdateCheck } from "../useUpdateCheck";
import { ConfigModal } from "./ConfigModal";

const { Text } = Typography;

interface Props {
  selected: SelectedBucket | null;
  onSelect: (sel: SelectedBucket) => void;
  isDark: boolean;
  onThemeToggle: () => void;
}

export function Sidebar({ selected, onSelect, isDark, onThemeToggle }: Props) {
  const { token } = theme.useToken();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
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
    title: (
      <span style={{ fontWeight: 600, fontSize: 13 }}>
        <DatabaseOutlined style={{ marginRight: 6, color: token.colorPrimary }} />
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
                color: isSelected ? token.colorPrimary : undefined,
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              <InboxOutlined style={{ marginRight: 6 }} />
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
    <div
      className="sidebar-container"
      style={{ background: token.colorBgContainer }}
    >
      {/* Header */}
      <div
        className="sidebar-header"
        style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Space size={6} align="center">
          <CloudServerOutlined style={{ fontSize: 18, color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 15 }}>Super S3</Text>
        </Space>
        <Tooltip title={isDark ? "Light mode" : "Dark mode"}>
          {isDark
            ? <SunOutlined onClick={onThemeToggle} style={{ cursor: "pointer", color: token.colorTextSecondary }} />
            : <MoonOutlined onClick={onThemeToggle} style={{ cursor: "pointer", color: token.colorTextSecondary }} />
          }
        </Tooltip>
        <Tooltip title="Reload accounts">
          <ReloadOutlined
            spin={loading}
            onClick={loadAccounts}
            style={{ cursor: "pointer", color: token.colorTextSecondary }}
          />
        </Tooltip>
        <Tooltip title="Account management">
          <SettingOutlined
            onClick={() => setConfigOpen(true)}
            style={{ cursor: "pointer", color: token.colorTextSecondary }}
          />
        </Tooltip>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 32 }}>
            <Spin indicator={<LoadingOutlined spin />} />
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
            style={{ fontSize: 13 }}
          />
        )}
      </div>

      {/* Footer */}
      <div
        className="sidebar-footer"
        style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}
      >
        {updateInfo ? (
          <Tooltip title={`New version available: v${updateInfo.latestVersion}`}>
            <a
              href={updateInfo.releaseUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: token.colorWarningText }}
            >
              v{__APP_VERSION__} <ArrowRightOutlined style={{ fontSize: 9 }} /> v{updateInfo.latestVersion}
            </a>
          </Tooltip>
        ) : (
          <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
            v{__APP_VERSION__} · jacksonary
          </Text>
        )}
        <Space size={8} align="center">
          <Tooltip title="GitHub">
            <a
              href="https://github.com/Jacksonary/super-s3"
              target="_blank"
              rel="noreferrer"
              className="sidebar-icon-link"
              style={{ color: token.colorTextQuaternary }}
            >
              <GithubOutlined />
            </a>
          </Tooltip>
          <Tooltip title="Gitee">
            <a
              href="https://gitee.com/weiguoliu/super-s3"
              target="_blank"
              rel="noreferrer"
              className="sidebar-icon-link"
              style={{ color: token.colorTextQuaternary }}
            >
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
                <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.26.593.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.26.593.593.593h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z"/>
              </svg>
            </a>
          </Tooltip>
        </Space>
      </div>

      <ConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onChange={loadAccounts}
      />
    </div>
  );
}
