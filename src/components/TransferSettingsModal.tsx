import { useEffect, useState } from "react";
import { Modal, Slider, Form, Button, Space, Typography, Divider, message } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../api";
import type { TransferConfig } from "../types";

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (cfg: TransferConfig) => void;
}

const DEFAULTS: TransferConfig = {
  concurrent_files: 5,
  download_connections: 12,
  download_part_size: 8,
  upload_part_concurrency: 4,
  upload_part_size: 16,
};

export function TransferSettingsModal({ open, onClose, onSave }: Props) {
  const [cfg, setCfg] = useState<TransferConfig>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getTransferConfig().then(setCfg).catch(() => setCfg(DEFAULTS));
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.putTransferConfig(cfg);
      onSave(cfg);
      message.success("Transfer settings saved");
      onClose();
    } catch (e) {
      message.error(`Failed to save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setCfg(DEFAULTS);

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined />
          Transfer Settings
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={handleReset}>Reset defaults</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            Save
          </Button>
        </Space>
      }
      width={480}
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Concurrent files</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                How many files upload or download simultaneously
              </Text>
            </Space>
          }
        >
          <Slider
            min={1}
            max={10}
            marks={{ 1: "1", 5: "5", 10: "10" }}
            value={cfg.concurrent_files}
            onChange={(v) => setCfg((p) => ({ ...p, concurrent_files: v }))}
          />
        </Form.Item>

        <Divider style={{ margin: "8px 0" }} />

        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Download connections per file</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Parallel Range GET connections for large files (≥100 MB).
                Increase for high-latency or overseas connections.
              </Text>
            </Space>
          }
        >
          <Slider
            min={1}
            max={20}
            marks={{ 1: "1", 4: "4", 12: "12", 20: "20" }}
            value={cfg.download_connections}
            onChange={(v) => setCfg((p) => ({ ...p, download_connections: v }))}
          />
        </Form.Item>

        <Divider style={{ margin: "8px 0" }} />

        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Download part size (MB)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Size of each Range GET chunk. Larger parts reduce HTTP overhead
                but use more memory per connection.
              </Text>
            </Space>
          }
        >
          <Slider
            min={4}
            max={64}
            step={4}
            marks={{ 4: "4", 8: "8", 16: "16", 32: "32", 64: "64" }}
            value={cfg.download_part_size}
            onChange={(v) => setCfg((p) => ({ ...p, download_part_size: v }))}
          />
        </Form.Item>

        <Divider style={{ margin: "8px 0" }} />

        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Upload part concurrency</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Simultaneous multipart chunks for large file uploads (≥100 MB).
              </Text>
            </Space>
          }
        >
          <Slider
            min={1}
            max={16}
            marks={{ 1: "1", 4: "4", 8: "8", 16: "16" }}
            value={cfg.upload_part_concurrency}
            onChange={(v) => setCfg((p) => ({ ...p, upload_part_concurrency: v }))}
          />
        </Form.Item>

        <Divider style={{ margin: "8px 0" }} />

        <Form.Item
          label={
            <Space direction="vertical" size={0}>
              <Text strong>Upload part size (MB)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Size of each multipart upload chunk. Larger parts reduce HTTP
                overhead but use more memory per concurrent upload.
              </Text>
            </Space>
          }
        >
          <Slider
            min={8}
            max={64}
            step={8}
            marks={{ 8: "8", 16: "16", 32: "32", 64: "64" }}
            value={cfg.upload_part_size}
            onChange={(v) => setCfg((p) => ({ ...p, upload_part_size: v }))}
          />
        </Form.Item>

        <Text type="secondary" style={{ fontSize: 11 }}>
          Memory used for large transfers: up to{" "}
          {cfg.download_connections * cfg.download_part_size} MB (download) /{" "}
          {cfg.upload_part_concurrency * cfg.upload_part_size} MB (upload)
        </Text>
      </Form>
    </Modal>
  );
}
