import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  List,
  Popconfirm,
  Space,
  Tag,
  Slider,
  Switch,
  Spin,
  Radio,
  Typography,
  Divider,
  message,
  theme,
} from "antd";
import {
  UserOutlined,
  ControlOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { AccountConfig, TransferConfig } from "../types";

const { Text } = Typography;

type Section = "accounts" | "general";

export type SettingsAction =
  | { type: "add" }
  | { type: "edit"; accountIndex: number }
  | null;

interface Props {
  open: boolean;
  onClose: () => void;
  onAccountsChange: () => void;
  onTransferConfigChange: (cfg: TransferConfig) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  initialAction?: SettingsAction;
}

// ─── Account section ──────────────────────────────────────────────────────────

const EMPTY_ACCOUNT: AccountConfig = {
  name: "",
  ak: "",
  sk: "",
  endpoint: "",
  region: "",
  buckets: [],
};

function AccountSection({ onAccountsChange, onClose, initialAction }: { onAccountsChange: () => void; onClose: () => void; initialAction?: SettingsAction }) {
  const { token } = theme.useToken();
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form] = Form.useForm<AccountConfig & { bucketsRaw: string }>();

  const load = async () => {
    setLoading(true);
    try {
      setAccounts(await api.getConfig());
    } catch {
      message.error("Failed to load config");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const actionHandled = useRef(false);
  useEffect(() => { actionHandled.current = false; }, [initialAction]);
  useEffect(() => {
    if (!initialAction || accounts.length === 0 || actionHandled.current) return;
    actionHandled.current = true;
    if (initialAction.type === "add") {
      openAdd();
    } else if (initialAction.type === "edit") {
      if (initialAction.accountIndex < accounts.length) openEdit(initialAction.accountIndex);
    }
  }, [initialAction, accounts.length]);

  const save = async (list: AccountConfig[]) => {
    setSaving(true);
    try {
      await api.putConfig(list);
      setAccounts(list);
      onAccountsChange();
      message.success("Saved");
      return true;
    } catch {
      message.error("Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setEditing(-1);
    form.setFieldsValue({ ...EMPTY_ACCOUNT, bucketsRaw: "" });
  };

  const openEdit = (idx: number) => {
    setEditing(idx);
    const a = accounts[idx];
    form.setFieldsValue({ ...a, bucketsRaw: a.buckets.join("\n") });
  };

  const cancel = () => { setEditing(null); form.resetFields(); };

  const submit = async () => {
    const v = await form.validateFields();
    const acct: AccountConfig = {
      id: editing !== -1 ? accounts[editing!].id : undefined,
      name: v.name || undefined,
      ak: v.ak,
      sk: v.sk,
      endpoint: v.endpoint,
      region: v.region,
      buckets: v.bucketsRaw
        ? v.bucketsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
        : [],
    };
    const next = [...accounts];
    if (editing === -1) next.push(acct); else next[editing!] = acct;
    if (await save(next)) {
      cancel();
      if (initialAction) onClose();
    }
  };

  if (editing !== null) {
    return (
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item label="Display Name" name="name">
          <Input placeholder="Auto-detect if left empty" />
        </Form.Item>
        <Form.Item label="Access Key" name="ak" rules={[{ required: true, message: "Required" }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Secret Key" name="sk" rules={[{ required: true, message: "Required" }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item label="Endpoint" name="endpoint" rules={[{ required: true, message: "Required" }]}>
          <Input placeholder="https://obs.cn-east-3.myhuaweicloud.com" />
        </Form.Item>
        <Form.Item label="Region" name="region" rules={[{ required: true, message: "Required" }]}>
          <Input placeholder="cn-east-3" />
        </Form.Item>
        <Form.Item label="Buckets" name="bucketsRaw" extra="One per line. Leave empty to list all.">
          <Input.TextArea rows={3} placeholder={"my-bucket-1\nmy-bucket-2"} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>Save</Button>
            <Button onClick={cancel}>Cancel</Button>
          </Space>
        </Form.Item>
      </Form>
    );
  }

  return (
    <Spin spinning={loading}>
      <List
        dataSource={accounts}
        locale={{ emptyText: "No accounts. Click below to add one." }}
        renderItem={(acct, idx) => (
          <List.Item
            style={{ padding: "10px 4px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}
            actions={[
              <Button key="edit" type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(idx)} />,
              <Popconfirm
                key="del"
                title="Delete this account?"
                onConfirm={() => save(accounts.filter((_, i) => i !== idx))}
                okText="Delete"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" icon={<DeleteOutlined />} size="small" danger />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={<DatabaseOutlined style={{ fontSize: 18, color: token.colorPrimary, marginTop: 2 }} />}
              title={<Text strong>{acct.name || acct.endpoint || "Unnamed Account"}</Text>}
              description={
                <Space size={4} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>{acct.endpoint}</Text>
                  {acct.buckets.slice(0, 3).map((b) => (
                    <Tag key={b} style={{ fontSize: 11 }}>{b}</Tag>
                  ))}
                  {acct.buckets.length > 3 && (
                    <Tag style={{ fontSize: 11 }}>+{acct.buckets.length - 3}</Tag>
                  )}
                </Space>
              }
            />
          </List.Item>
        )}
      />
      <Button type="dashed" icon={<PlusOutlined />} block style={{ marginTop: 12 }} onClick={openAdd}>
        Add Account
      </Button>
    </Spin>
  );
}

// ─── General section ──────────────────────────────────────────────────────────

const TRANSFER_DEFAULTS: TransferConfig = {
  concurrent_files: 5,
  multipart_threshold: 16,
  upload_part_concurrency: 4,
  upload_part_size: 16,
};

function GeneralSection({
  isDark,
  onThemeToggle,
  onTransferConfigChange,
}: {
  isDark: boolean;
  onThemeToggle: () => void;
  onTransferConfigChange: (cfg: TransferConfig) => void;
}) {
  const [cfg, setCfg] = useState<TransferConfig>(TRANSFER_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTransferConfig().then(setCfg).catch(() => setCfg(TRANSFER_DEFAULTS));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.putTransferConfig(cfg);
      onTransferConfigChange(cfg);
      message.success("Settings saved");
    } catch (e) {
      message.error(`Failed to save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Text strong style={{ fontSize: 13 }}>Appearance</Text>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 20px" }}>
        <div>
          <Text>Dark mode</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>Switch between light and dark interface</Text>
        </div>
        <Switch checked={isDark} onChange={onThemeToggle} />
      </div>

      <Divider style={{ margin: "0 0 16px" }} />

      <Text strong style={{ fontSize: 13 }}>Transfer Performance</Text>
      <Form layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Concurrent files</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>How many files upload or download simultaneously</Text>
            </Space>
          }
        >
          <Slider min={1} max={10} marks={{ 1: "1", 5: "5", 10: "10" }}
            value={cfg.concurrent_files}
            onChange={(v) => setCfg((p) => ({ ...p, concurrent_files: v }))} />
        </Form.Item>
        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Multipart threshold (MB)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>Files larger than this use concurrent parts. Smaller files use single transfer (no pause).</Text>
            </Space>
          }
        >
          <Radio.Group
            value={cfg.multipart_threshold}
            onChange={(e) => setCfg((p) => ({ ...p, multipart_threshold: e.target.value }))}
          >
            <Radio.Button value={8}>8</Radio.Button>
            <Radio.Button value={16}>16</Radio.Button>
            <Radio.Button value={32}>32</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Upload part concurrency</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>Simultaneous multipart chunks for large uploads.</Text>
            </Space>
          }
        >
          <Slider min={1} max={16} marks={{ 1: "1", 4: "4", 8: "8", 16: "16" }}
            value={cfg.upload_part_concurrency}
            onChange={(v) => setCfg((p) => ({ ...p, upload_part_concurrency: v }))} />
        </Form.Item>
        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Upload part size (MB)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>Size of each multipart upload chunk. Larger parts reduce HTTP overhead but use more memory.</Text>
            </Space>
          }
        >
          <Slider min={8} max={64} step={8} marks={{ 8: "8", 16: "16", 32: "32", 64: "64" }}
            value={cfg.upload_part_size}
            onChange={(v) => setCfg((p) => ({ ...p, upload_part_size: v }))} />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 11 }}>
          Memory: up to {cfg.upload_part_concurrency * cfg.upload_part_size} MB (upload)
        </Text>
      </Form>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="primary" loading={saving} onClick={handleSave}>Save</Button>
        <Button onClick={() => setCfg(TRANSFER_DEFAULTS)}>Reset defaults</Button>
      </div>
    </div>
  );
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const { token } = theme.useToken();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="settings-nav-item"
      data-active={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        margin: "1px 6px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? token.colorPrimary : token.colorText,
        background: active ? token.colorPrimaryBg : "transparent",
        transition: "background 0.15s, color 0.15s",
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: 14, opacity: active ? 1 : 0.6 }}>{icon}</span>
      {label}
    </div>
  );
}

// ─── Unified modal ────────────────────────────────────────────────────────────

export function SettingsModal({
  open,
  onClose,
  onAccountsChange,
  onTransferConfigChange,
  isDark,
  onThemeToggle,
  initialAction,
}: Props) {
  const { token } = theme.useToken();
  const [section, setSection] = useState<Section>("accounts");

  useEffect(() => {
    if (open) setSection("accounts");
  }, [open]);

  return (
    <Modal
      title="Settings"
      open={open}
      onCancel={onClose}
      footer={null}
      width={660}
      destroyOnClose
      styles={{ body: { padding: 0, overflow: "hidden", borderRadius: `0 0 ${token.borderRadiusLG}px ${token.borderRadiusLG}px` } }}
    >
      <div style={{ display: "flex", height: 500 }}>
        {/* Left nav */}
        <div
          style={{
            width: 128,
            flexShrink: 0,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            padding: "10px 0",
          }}
        >
          <NavItem
            active={section === "accounts"}
            icon={<UserOutlined />}
            label="Accounts"
            onClick={() => setSection("accounts")}
          />
          <NavItem
            active={section === "general"}
            icon={<ControlOutlined />}
            label="General"
            onClick={() => setSection("general")}
          />
        </div>

        {/* Right content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {section === "accounts" ? (
            <AccountSection onAccountsChange={onAccountsChange} onClose={onClose} initialAction={initialAction} />
          ) : (
            <GeneralSection
              isDark={isDark}
              onThemeToggle={onThemeToggle}
              onTransferConfigChange={onTransferConfigChange}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
