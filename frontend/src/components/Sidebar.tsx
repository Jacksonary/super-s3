import { useEffect, useState } from "react";
import {
  Tree,
  Typography,
  Spin,
  message,
  Tooltip,
  theme,
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  DatabaseOutlined,
  InboxOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { Account, SelectedBucket } from "../types";
import { ConfigModal } from "./ConfigModal";

const { Text } = Typography;

interface Props {
  selected: SelectedBucket | null;
  onSelect: (sel: SelectedBucket) => void;
}

export function Sidebar({ selected, onSelect }: Props) {
  const { token } = theme.useToken();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [configOpen, setConfigOpen] = useState(false);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.accounts();
      setAccounts(data);
      // auto-expand first account
      if (data.length > 0) {
        setExpandedKeys([`account-${data[0].id}`]);
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
    key: `account-${acct.id}`,
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
        key: `bucket-${acct.id}-${b}`,
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
    if (!key?.startsWith("bucket-")) return;
    const parts = key.slice("bucket-".length).split("-");
    const accountId = parseInt(parts[0], 10);
    const bucket = parts.slice(1).join("-");
    onSelect({ accountId, bucket });
  };

  const selectedKeys = selected
    ? [`bucket-${selected.accountId}-${selected.bucket}`]
    : [];

  return (
    <div
      style={{
        width: 240,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 15 }}>
          🗄️ Super S3
        </Text>
        <Tooltip title="Reload accounts">
          <ReloadOutlined
            spin={loading}
            onClick={loadAccounts}
            style={{ cursor: "pointer", color: token.colorTextSecondary }}
          />
        </Tooltip>
        <Tooltip title="账号管理">
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

      <ConfigModal
        open={configOpen}
        onClose={(reloaded) => {
          setConfigOpen(false);
          if (reloaded) loadAccounts();
        }}
      />
    </div>
  );
}
