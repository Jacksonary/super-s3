import { useEffect, useRef, useState } from "react";
import {
  Drawer,
  Descriptions,
  Spin,
  Button,
  Tag,
  Space,
  Typography,
  Collapse,
  theme,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { api } from "../api";
import type { SelectedBucket } from "../types";

const { Text } = Typography;

interface Props {
  open: boolean;
  target: SelectedBucket;
  onClose: () => void;
}

// ─── Per-section async state ─────────────────────────────────────────────────

interface SectionState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function initSection<T>(): SectionState<T> {
  return { loading: false, error: null, data: null };
}

// ─── ACL helpers ─────────────────────────────────────────────────────────────

const ALL_USERS_URI = "http://acs.amazonaws.com/groups/global/AllUsers";
const AUTH_USERS_URI = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";

function summariseAcl(grants: { grantee: string; permission: string }[]): string {
  const hasPublicRead = grants.some(
    (g) => g.grantee === ALL_USERS_URI && (g.permission === "READ" || g.permission === "FULL_CONTROL"),
  );
  const hasPublicWrite = grants.some(
    (g) => g.grantee === ALL_USERS_URI && (g.permission === "WRITE" || g.permission === "FULL_CONTROL"),
  );
  const hasAuthRead = grants.some(
    (g) => g.grantee === AUTH_USERS_URI && (g.permission === "READ" || g.permission === "FULL_CONTROL"),
  );
  if (hasPublicRead && hasPublicWrite) return "Public Read/Write";
  if (hasPublicRead) return "Public Read";
  if (hasAuthRead) return "Authenticated Read";
  return "Private";
}

// ─── Component ───────────────────────────────────────────────────────────────

type LocationData = { location: string };
type AclData = { owner: string; grants: { grantee: string; permission: string }[] };
type VersioningData = { status: string | null; mfa_delete: string | null };
type EncryptionData = { rules: { algorithm: string; kms_key_id: string | null }[] };
type LifecycleData = {
  rules: {
    id: string | null;
    status: string;
    prefix: string | null;
    transitions: { days: number | null; storage_class: string | null }[];
    expiration: { days: number | null; expired_object_delete_marker: boolean } | null;
    noncurrent_transitions: { days: number | null; storage_class: string | null }[];
    noncurrent_expiration_days: number | null;
  }[];
};
type CorsData = {
  rules: {
    allowed_origins: string[];
    allowed_methods: string[];
    allowed_headers: string[];
    expose_headers: string[];
    max_age_seconds: number | null;
  }[];
};
type TagsData = { tags: { key: string; value: string }[] };
type LoggingData = { target_bucket: string | null; target_prefix: string | null };

export function BucketDrawer({ open, target, onClose }: Props) {
  const { token } = theme.useToken();
  const { accountId, bucket } = target;

  const [location, setLocation] = useState<SectionState<LocationData>>(initSection);
  const [acl, setAcl] = useState<SectionState<AclData>>(initSection);
  const [versioning, setVersioning] = useState<SectionState<VersioningData>>(initSection);
  const [encryption, setEncryption] = useState<SectionState<EncryptionData>>(initSection);
  const [lifecycle, setLifecycle] = useState<SectionState<LifecycleData>>(initSection);
  const [cors, setCors] = useState<SectionState<CorsData>>(initSection);
  const [tags, setTags] = useState<SectionState<TagsData>>(initSection);
  const [logging, setLogging] = useState<SectionState<LoggingData>>(initSection);

  const generationRef = useRef(0);

  const fetchAll = () => {
    const gen = ++generationRef.current;

    const load = <T,>(
      apiFn: () => Promise<T>,
      setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
    ) => {
      setter({ loading: true, error: null, data: null });
      apiFn()
        .then((data) => {
          if (generationRef.current !== gen) return;
          const softErr = (data as Record<string, unknown>)?._error as string | undefined;
          setter({ loading: false, error: softErr ?? null, data });
        })
        .catch((err) => { if (generationRef.current === gen) setter({ loading: false, error: String(err), data: null }); });
    };

    load(() => api.getBucketLocation(accountId, bucket), setLocation);
    load(() => api.getBucketAcl(accountId, bucket), setAcl);
    load(() => api.getBucketVersioning(accountId, bucket), setVersioning);
    load(() => api.getBucketEncryption(accountId, bucket), setEncryption);
    load(() => api.getBucketLifecycle(accountId, bucket), setLifecycle);
    load(() => api.getBucketCors(accountId, bucket), setCors);
    load(() => api.getBucketTags(accountId, bucket), setTags);
    load(() => api.getBucketLogging(accountId, bucket), setLogging);
  };

  useEffect(() => {
    if (open) fetchAll();
    return () => { generationRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId, bucket]);

  // ─── Section renderers ───────────────────────────────────────────────────

  const sectionLabel = (label: string) => (
    <Text strong style={{ fontSize: 13 }}>{label}</Text>
  );

  const renderLoading = () => (
    <div style={{ padding: "12px 0", textAlign: "center" }}><Spin size="small" /></div>
  );

  const renderError = (err: string) => (
    <Text type="secondary" style={{ fontSize: 12 }}>{err}</Text>
  );

  const renderBasicInfo = () => {
    if (location.loading && acl.loading) return renderLoading();

    return (
      <Descriptions
        column={1}
        size="small"
        bordered
        labelStyle={{ width: 100, color: token.colorTextSecondary, fontSize: 12 }}
        contentStyle={{ fontSize: 12 }}
      >
        <Descriptions.Item label="Region">
          {location.loading ? <Spin size="small" /> : location.error
            ? renderError(location.error)
            : <Tag>{location.data?.location ?? "—"}</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="ACL">
          {acl.loading ? <Spin size="small" /> : acl.error
            ? renderError(acl.error)
            : <Tag color={acl.data ? (summariseAcl(acl.data.grants) === "Private" ? "green" : "orange") : undefined}>
                {acl.data ? summariseAcl(acl.data.grants) : "—"}
              </Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Owner">
          {acl.loading ? <Spin size="small" /> : acl.error
            ? "—"
            : <Text style={{ fontSize: 12, wordBreak: "break-all" }}>{acl.data?.owner || "—"}</Text>}
        </Descriptions.Item>
      </Descriptions>
    );
  };

  const renderSecurity = () => {
    if (versioning.loading && encryption.loading && logging.loading) return renderLoading();

    const versionStatus = versioning.data?.status ?? null;
    const encAlgo = encryption.data?.rules?.[0]?.algorithm;
    const logData = logging.data;

    return (
      <Descriptions
        column={1}
        size="small"
        bordered
        labelStyle={{ width: 100, color: token.colorTextSecondary, fontSize: 12 }}
        contentStyle={{ fontSize: 12 }}
      >
        <Descriptions.Item label="Versioning">
          {versioning.loading ? <Spin size="small" /> : versioning.error
            ? renderError(versioning.error)
            : versionStatus === "Enabled" ? <Tag color="green">Enabled</Tag>
            : versionStatus === "Suspended" ? <Tag color="orange">Suspended</Tag>
            : <Text type="secondary">Not enabled</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Encryption">
          {encryption.loading ? <Spin size="small" /> : encryption.error
            ? renderError(encryption.error)
            : encAlgo ? <Tag>{encAlgo}</Tag>
            : <Text type="secondary">Not configured</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Logging">
          {logging.loading ? <Spin size="small" /> : logging.error
            ? renderError(logging.error)
            : logData?.target_bucket ? (
              <Text style={{ fontSize: 12, wordBreak: "break-all" }}>
                {logData.target_bucket}{logData.target_prefix ? `/${logData.target_prefix}` : ""}
              </Text>
            ) : <Text type="secondary">Not enabled</Text>}
        </Descriptions.Item>
      </Descriptions>
    );
  };

  const renderTags = () => {
    if (tags.loading) return renderLoading();
    if (tags.error) return renderError(tags.error);
    const list = tags.data?.tags ?? [];
    if (list.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>No tags</Text>;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {list.map((t) => (
          <Tag key={t.key}>
            <Text strong style={{ fontSize: 11 }}>{t.key}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>={t.value}</Text>
          </Tag>
        ))}
      </div>
    );
  };

  const renderLifecycle = () => {
    if (lifecycle.loading) return renderLoading();
    if (lifecycle.error) return renderError(lifecycle.error);
    const rules = lifecycle.data?.rules ?? [];
    if (rules.length === 0)
      return <Text type="secondary" style={{ fontSize: 12 }}>No lifecycle rules</Text>;

    return (
      <Collapse
        size="small"
        items={rules.map((r, i) => ({
          key: String(i),
          label: (
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>{r.id || `Rule ${i + 1}`}</Text>
              <Tag color={r.status === "Enabled" ? "green" : "default"} style={{ fontSize: 11 }}>
                {r.status}
              </Tag>
              {r.prefix && (
                <Text type="secondary" style={{ fontSize: 11 }}>prefix: {r.prefix}</Text>
              )}
            </Space>
          ),
          children: (
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {r.transitions.map((t, ti) => (
                <div key={ti}>
                  <Text type="secondary">Transition: </Text>
                  {t.days != null && <Text>{t.days} days</Text>}
                  {t.storage_class && <Text> → {t.storage_class}</Text>}
                </div>
              ))}
              {r.expiration && (
                <div>
                  <Text type="secondary">Expiration: </Text>
                  {r.expiration.days != null && <Text>{r.expiration.days} days</Text>}
                </div>
              )}
              {r.noncurrent_transitions.map((t, ti) => (
                <div key={`nc-${ti}`}>
                  <Text type="secondary">Noncurrent transition: </Text>
                  {t.days != null && <Text>{t.days} days</Text>}
                  {t.storage_class && <Text> → {t.storage_class}</Text>}
                </div>
              ))}
              {r.noncurrent_expiration_days != null && (
                <div>
                  <Text type="secondary">Noncurrent expiration: </Text>
                  <Text>{r.noncurrent_expiration_days} days</Text>
                </div>
              )}
            </div>
          ),
        }))}
      />
    );
  };

  const renderCors = () => {
    if (cors.loading) return renderLoading();
    if (cors.error) return renderError(cors.error);
    const rules = cors.data?.rules ?? [];
    if (rules.length === 0)
      return <Text type="secondary" style={{ fontSize: 12 }}>No CORS rules</Text>;

    return (
      <Collapse
        size="small"
        items={rules.map((r, i) => ({
          key: String(i),
          label: <Text style={{ fontSize: 12 }}>Rule {i + 1}</Text>,
          children: (
            <Descriptions
              column={1}
              size="small"
              bordered
              labelStyle={{ width: 110, color: token.colorTextSecondary, fontSize: 11 }}
              contentStyle={{ fontSize: 11 }}
            >
              <Descriptions.Item label="Origins">
                {r.allowed_origins.join(", ") || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Methods">
                <Space size={4} wrap>
                  {r.allowed_methods.map((m) => <Tag key={m} style={{ fontSize: 11 }}>{m}</Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Headers">
                {r.allowed_headers.join(", ") || "—"}
              </Descriptions.Item>
              {r.expose_headers.length > 0 && (
                <Descriptions.Item label="Expose">
                  {r.expose_headers.join(", ")}
                </Descriptions.Item>
              )}
              {r.max_age_seconds != null && (
                <Descriptions.Item label="Max Age">
                  {r.max_age_seconds}s
                </Descriptions.Item>
              )}
            </Descriptions>
          ),
        }))}
      />
    );
  };

  // ─── Drawer ──────────────────────────────────────────────────────────────

  const anyLoading =
    location.loading || acl.loading || versioning.loading || encryption.loading ||
    lifecycle.loading || cors.loading || tags.loading || logging.loading;

  return (
    <Drawer
      title={<Text strong style={{ fontSize: 14 }}>{bucket}</Text>}
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={fetchAll}
          loading={anyLoading}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Basic info */}
          <section>
            {sectionLabel("Basic Info")}
            <div style={{ marginTop: 8 }}>{renderBasicInfo()}</div>
          </section>

          {/* Security & versioning */}
          <section>
            {sectionLabel("Security & Versioning")}
            <div style={{ marginTop: 8 }}>{renderSecurity()}</div>
          </section>

          {/* Tags */}
          <section>
            {sectionLabel("Tags")}
            <div style={{ marginTop: 8 }}>{renderTags()}</div>
          </section>

          {/* Lifecycle */}
          <section>
            <Space>
              {sectionLabel("Lifecycle Rules")}
              {lifecycle.data && lifecycle.data.rules.length > 0 && (
                <Tag style={{ fontSize: 11 }}>{lifecycle.data.rules.length}</Tag>
              )}
            </Space>
            <div style={{ marginTop: 8 }}>{renderLifecycle()}</div>
          </section>

          {/* CORS */}
          <section>
            <Space>
              {sectionLabel("CORS Rules")}
              {cors.data && cors.data.rules.length > 0 && (
                <Tag style={{ fontSize: 11 }}>{cors.data.rules.length}</Tag>
              )}
            </Space>
            <div style={{ marginTop: 8 }}>{renderCors()}</div>
          </section>
        </div>
    </Drawer>
  );
}
