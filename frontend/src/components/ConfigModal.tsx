import { useEffect, useState } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  List,
  Popconfirm,
  Space,
  Tag,
  message,
  Spin,
  Typography,
  theme,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { AccountConfig } from "../types";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: (reloaded: boolean) => void;
}

const EMPTY: AccountConfig = {
  name: "",
  ak: "",
  sk: "",
  endpoint: "",
  region: "",
  buckets: [],
};

export function ConfigModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); // index, -1 = new
  const [form] = Form.useForm<AccountConfig & { bucketsRaw: string }>();

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      setAccounts(data);
    } catch {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const save = async (list: AccountConfig[]) => {
    setSaving(true);
    try {
      await api.putConfig(list);
      setAccounts(list);
      message.success("保存成功");
      return true;
    } catch {
      message.error("保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setEditing(-1);
    form.setFieldsValue({ ...EMPTY, bucketsRaw: "" });
  };

  const openEdit = (idx: number) => {
    setEditing(idx);
    const acct = accounts[idx];
    form.setFieldsValue({
      ...acct,
      bucketsRaw: acct.buckets.join("\n"),
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    form.resetFields();
  };

  const submitEdit = async () => {
    const values = await form.validateFields();
    const acct: AccountConfig = {
      name: values.name || undefined,
      ak: values.ak,
      sk: values.sk,
      endpoint: values.endpoint,
      region: values.region,
      buckets: values.bucketsRaw
        ? values.bucketsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
        : [],
    };
    const next = [...accounts];
    if (editing === -1) {
      next.push(acct);
    } else {
      next[editing!] = acct;
    }
    const ok = await save(next);
    if (ok) cancelEdit();
  };

  const remove = async (idx: number) => {
    const next = accounts.filter((_, i) => i !== idx);
    await save(next);
  };

  const handleClose = () => {
    cancelEdit();
    onClose(true);
  };

  return (
    <Modal
      title="账号管理"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      {editing !== null ? (
        // ── Edit / Add form ──────────────────────────────────────────────
        <Form form={form} layout="vertical" onFinish={submitEdit}>
          <Form.Item label="显示名称" name="name">
            <Input placeholder="留空则自动识别云厂商" />
          </Form.Item>
          <Form.Item
            label="Access Key"
            name="ak"
            rules={[{ required: true, message: "请输入 AK" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Secret Key"
            name="sk"
            rules={[{ required: true, message: "请输入 SK" }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="Endpoint"
            name="endpoint"
            rules={[{ required: true, message: "请输入 Endpoint" }]}
          >
            <Input placeholder="https://obs.cn-east-3.myhuaweicloud.com" />
          </Form.Item>
          <Form.Item
            label="Region"
            name="region"
            rules={[{ required: true, message: "请输入 Region" }]}
          >
            <Input placeholder="cn-east-3" />
          </Form.Item>
          <Form.Item
            label="Buckets"
            name="bucketsRaw"
            extra="每行一个，留空则列出账号下所有桶"
          >
            <Input.TextArea rows={3} placeholder={"my-bucket-1\nmy-bucket-2"} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存
              </Button>
              <Button onClick={cancelEdit}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      ) : (
        // ── Account list ─────────────────────────────────────────────────
        <Spin spinning={loading}>
          <List
            dataSource={accounts}
            locale={{ emptyText: "暂无账号，点击下方添加" }}
            renderItem={(acct, idx) => (
              <List.Item
                style={{
                  padding: "10px 4px",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                }}
                actions={[
                  <Button
                    key="edit"
                    type="text"
                    icon={<EditOutlined />}
                    size="small"
                    onClick={() => openEdit(idx)}
                  />,
                  <Popconfirm
                    key="del"
                    title="确认删除该账号？"
                    onConfirm={() => remove(idx)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      size="small"
                      danger
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <DatabaseOutlined
                      style={{ fontSize: 18, color: token.colorPrimary, marginTop: 2 }}
                    />
                  }
                  title={
                    <Text strong>
                      {acct.name || acct.endpoint || "未命名账号"}
                    </Text>
                  }
                  description={
                    <Space size={4} wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {acct.endpoint}
                      </Text>
                      {acct.buckets.length > 0 && (
                        <>
                          {acct.buckets.slice(0, 3).map((b) => (
                            <Tag key={b} style={{ fontSize: 11 }}>
                              {b}
                            </Tag>
                          ))}
                          {acct.buckets.length > 3 && (
                            <Tag style={{ fontSize: 11 }}>
                              +{acct.buckets.length - 3}
                            </Tag>
                          )}
                        </>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            block
            style={{ marginTop: 12 }}
            onClick={openAdd}
          >
            添加账号
          </Button>
        </Spin>
      )}
    </Modal>
  );
}
