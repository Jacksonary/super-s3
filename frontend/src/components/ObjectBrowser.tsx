import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table,
  Button,
  Space,
  Breadcrumb,
  Input,
  Tooltip,
  Popconfirm,
  message,
  Progress,
  Tag,
  Typography,
  Empty,
  Spin,
  Modal,
  Form,
  theme,
  Badge,
  Segmented,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  FolderOutlined,
  FileOutlined,
  UploadOutlined,
  FolderAddOutlined,
  DeleteOutlined,
  DownloadOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
  LoadingOutlined,
  CopyOutlined,
  HomeOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { api } from "../api";
import type { ObjectItem, SelectedBucket } from "../types";
import { DetailDrawer } from "./DetailDrawer";

const { Text } = Typography;

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return dayjs(iso).format("YYYY-MM-DD HH:mm");
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // fallback for HTTP (non-localhost) contexts
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ─── UploadQueue ────────────────────────────────────────────────────────────

interface UploadTask {
  id: string;
  filename: string;
  progress: number;
  done: boolean;
  error?: string;
}

// ─── Main component ─────────────────────────────────────────────────────────

interface Props {
  target: SelectedBucket;
}

export function ObjectBrowser({ target }: Props) {
  const { token } = theme.useToken();
  const { accountId, bucket } = target;

  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  // pagination
  const MAX_TOTAL = 2000;
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const pageSizeRef = useRef(20);
  // pageTokensRef[i] = continuation_token to fetch page i (undefined = first page)
  const pageTokensRef = useRef<(string | undefined)[]>([undefined]);

  // upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);

  // folder modal
  const [folderModal, setFolderModal] = useState(false);
  const [folderForm] = Form.useForm();

  // drag-over state
  const [dragOver, setDragOver] = useState(false);

  // detail drawer
  const [drawerItem, setDrawerItem] = useState<ObjectItem | null>(null);

  // ─── Load objects ──────────────────────────────────────────────────────

  const load = useCallback(
    async (p: string, page = 0, pSize?: number) => {
      const size = pSize ?? pageSizeRef.current;
      setLoading(true);
      setItems([]);
      setSelectedRowKeys([]);
      try {
        const res = await api.listObjects(accountId, bucket, {
          prefix: p,
          continuation_token: pageTokensRef.current[page],
          limit: size,
        });
        setItems(res.items);
        const hasNext =
          !!res.next_continuation_token && (page + 1) * size < MAX_TOTAL;
        setHasNextPage(hasNext);
        if (res.next_continuation_token) {
          pageTokensRef.current[page + 1] = res.next_continuation_token;
        }
      } catch (e: unknown) {
        message.error(`Load failed: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [accountId, bucket]
  );

  useEffect(() => {
    setPrefix("");
    setIsSearchMode(false);
    setSearchText("");
    setCurrentPage(0);
    pageTokensRef.current = [undefined];
    load("");
  }, [accountId, bucket, load]);

  // ─── Breadcrumb navigation ─────────────────────────────────────────────

  // reset pagination and reload current prefix (used after mutations)
  const reload = () => {
    setCurrentPage(0);
    pageTokensRef.current = [undefined];
    load(prefix, 0);
  };

  const segments = prefix
    ? prefix
        .split("/")
        .filter(Boolean)
        .map((seg, i, arr) => ({
          label: seg,
          prefix: arr.slice(0, i + 1).join("/") + "/",
        }))
    : [];

  const navigate = (p: string) => {
    setIsSearchMode(false);
    setSearchText("");
    setPrefix(p);
    setCurrentPage(0);
    pageTokensRef.current = [undefined];
    load(p, 0);
  };

  // ─── Search ────────────────────────────────────────────────────────────

  const handleSearch = async (val: string) => {
    if (!val.trim()) {
      setIsSearchMode(false);
      reload();
      return;
    }
    setSearching(true);
    setIsSearchMode(true);
    setItems([]);
    setHasNextPage(false);
    try {
      const res = await api.search(accountId, bucket, val, prefix);
      setItems(res.items);
      if (res.is_truncated) {
        message.info("Results truncated — refine your query for more precision");
      }
    } catch (e: unknown) {
      message.error(`Search failed: ${(e as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  // ─── Delete ────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    const keys = selectedRowKeys as string[];
    if (!keys.length) return;
    try {
      // Folders: also recursively collect keys
      const toDelete: string[] = [];
      for (const k of keys) {
        if (k.endsWith("/")) {
          // collect all objects under this folder prefix
          let ct: string | null | undefined;
          do {
            const res = await api.listObjects(accountId, bucket, {
              prefix: k,
              delimiter: "",
              continuation_token: ct ?? undefined,
              limit: 1000,
            });
            res.items.forEach((i) => toDelete.push(i.key));
            ct = res.next_continuation_token;
          } while (ct);
        } else {
          toDelete.push(k);
        }
      }
      if (!toDelete.length) {
        message.warning("Nothing to delete");
        return;
      }
      const result = await api.deleteObjects(accountId, bucket, toDelete);
      message.success(`Deleted ${result.deleted} object(s)`);
      setSelectedRowKeys([]);
      reload();
    } catch (e: unknown) {
      message.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  const handleDeleteRow = async (item: ObjectItem) => {
    const keysToDelete = item.type === "folder" ? [] : [item.key];
    if (item.type === "folder") {
      // recursive collect
      let ct: string | null | undefined;
      do {
        const res = await api.listObjects(accountId, bucket, {
          prefix: item.key,
          delimiter: "",
          continuation_token: ct ?? undefined,
          limit: 1000,
        });
        res.items.forEach((i) => keysToDelete.push(i.key));
        ct = res.next_continuation_token;
      } while (ct);
    }
    if (!keysToDelete.length) {
      keysToDelete.push(item.key);
    }
    try {
      const result = await api.deleteObjects(accountId, bucket, keysToDelete);
      message.success(`Deleted ${result.deleted} object(s)`);
      reload();
    } catch (e: unknown) {
      message.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  // ─── Upload ────────────────────────────────────────────────────────────

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    for (const file of arr) {
      const taskId = `${Date.now()}-${file.name}`;
      const key = prefix + file.name;
      setUploads((prev) => [
        ...prev,
        { id: taskId, filename: file.name, progress: 0, done: false },
      ]);
      try {
        await api.uploadObject(accountId, bucket, key, file, (pct) => {
          setUploads((prev) =>
            prev.map((u) => (u.id === taskId ? { ...u, progress: pct } : u))
          );
        });
        setUploads((prev) =>
          prev.map((u) =>
            u.id === taskId ? { ...u, progress: 100, done: true } : u
          )
        );
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.id !== taskId));
        }, 2500);
      } catch (e: unknown) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === taskId
              ? { ...u, error: (e as Error).message, done: true }
              : u
          )
        );
      }
    }
    reload();
  };

  // ─── Drag & drop ───────────────────────────────────────────────────────

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  // ─── Copy link ─────────────────────────────────────────────────────────

  const copyPresignedLink = async (item: ObjectItem) => {
    try {
      const { url } = await api.presign(accountId, bucket, item.key);
      await copyText(url);
      message.success("Presigned URL copied to clipboard");
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? (e as Error)?.message ?? "Unknown error";
      message.error(`Failed to generate presigned URL: ${detail}`);
    }
  };

  // ─── Create folder ─────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    const values = await folderForm.validateFields();
    const folderName = (values.name as string).trim().replace(/\/$/, "");
    if (!folderName) return;
    try {
      await api.createFolder(accountId, bucket, prefix + folderName);
      message.success(`Folder "${folderName}" created`);
      setFolderModal(false);
      folderForm.resetFields();
      reload();
    } catch (e: unknown) {
      message.error(`Failed: ${(e as Error).message}`);
    }
  };

  // ─── Table columns ─────────────────────────────────────────────────────

  const columns: ColumnsType<ObjectItem> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, row) => (
        <Space size={6}>
          {row.type === "folder" ? (
            <FolderOutlined style={{ color: "#faad14", fontSize: 16 }} />
          ) : (
            <FileOutlined style={{ color: token.colorTextSecondary, fontSize: 14 }} />
          )}
          {row.type === "folder" ? (
            <a
              onClick={() => navigate(row.key)}
              style={{ fontWeight: 500, color: token.colorText }}
            >
              {name}
            </a>
          ) : (
            <a
              onClick={() => setDrawerItem(row)}
              style={{ color: token.colorText }}
            >
              {isSearchMode ? row.key : name}
            </a>
          )}
        </Space>
      ),
    },
    {
      title: "Size",
      dataIndex: "size",
      key: "size",
      width: 100,
      align: "right",
      render: fmtSize,
    },
    {
      title: "Modified",
      dataIndex: "last_modified",
      key: "last_modified",
      width: 160,
      render: fmtDate,
    },
    {
      title: "Storage",
      dataIndex: "storage_class",
      key: "storage_class",
      width: 110,
      render: (cls: string | null) =>
        cls && cls !== "STANDARD" ? (
          <Tag color="blue" style={{ fontSize: 11 }}>
            {cls}
          </Tag>
        ) : null,
    },
    {
      title: "",
      key: "actions",
      width: 120,
      render: (_, row) => (
        <Space size={4} className="row-actions">
          {row.type === "file" && (
            <>
              <Tooltip title="Download">
                <Button
                  size="small"
                  type="text"
                  icon={<DownloadOutlined />}
                  href={api.downloadUrl(accountId, bucket, row.key)}
                />
              </Tooltip>
              <Tooltip title="Copy presigned URL">
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  onClick={() => copyPresignedLink(row)}
                />
              </Tooltip>
            </>
          )}
          <Tooltip title="Copy key">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => {
                copyText(row.key);
                message.success("Key copied");
              }}
            />
          </Tooltip>
          <Popconfirm
            title={`Delete "${row.name}"?`}
            description={
              row.type === "folder"
                ? "All objects inside will be deleted."
                : undefined
            }
            onConfirm={() => handleDeleteRow(row)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100vh", position: "relative" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="drop-overlay">Drop files to upload</div>
      )}

      {/* Toolbar */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          flexShrink: 0,
          background: token.colorBgContainer,
        }}
      >
        <Breadcrumb
          style={{ flex: 1, minWidth: 160 }}
          items={[
            {
              title: (
                <a onClick={() => navigate("")}>
                  <HomeOutlined /> {bucket}
                </a>
              ),
            },
            ...segments.map((seg) => ({
              title: <a onClick={() => navigate(seg.prefix)}>{seg.label}</a>,
            })),
          ]}
        />

        <Input.Search
          placeholder="Search by prefix…"
          allowClear
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            if (!e.target.value) {
              setIsSearchMode(false);
              setCurrentPage(0);
              pageTokensRef.current = [undefined];
              load(prefix, 0);
            }
          }}
          onSearch={handleSearch}
          loading={searching}
          style={{ width: 220 }}
          prefix={<SearchOutlined />}
          enterButton
        />

        <Segmented
          options={[
            { label: "20", value: 20 },
            { label: "50", value: 50 },
            { label: "100", value: 100 },
          ]}
          value={pageSize}
          onChange={(val) => {
            const size = val as number;
            pageSizeRef.current = size;
            setPageSize(size);
            setCurrentPage(0);
            pageTokensRef.current = [undefined];
            load(prefix, 0, size);
          }}
        />

        <Space>
          <Tooltip title="Upload files (or drag & drop)">
            <Button
              icon={<UploadOutlined />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </Button>
          </Tooltip>
          <Tooltip title="New folder">
            <Button
              icon={<FolderAddOutlined />}
              onClick={() => setFolderModal(true)}
            />
          </Tooltip>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`Delete ${selectedRowKeys.length} item(s)?`}
              onConfirm={deleteSelected}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Badge count={selectedRowKeys.length}>
                <Button danger icon={<DeleteOutlined />}>
                  Delete
                </Button>
              </Badge>
            </Popconfirm>
          )}
          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => {
                setCurrentPage(0);
                pageTokensRef.current = [undefined];
                load(prefix, 0);
              }}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div
          style={{
            padding: "6px 16px",
            background: token.colorFillAlter,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {uploads.map((u) => (
            <div key={u.id} style={{ marginBottom: 4 }}>
              <Text style={{ fontSize: 12 }}>{u.filename}</Text>
              <Progress
                percent={u.progress}
                size="small"
                status={u.error ? "exception" : u.done ? "success" : "active"}
              />
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 0 0 0" }}>
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
          </div>
        ) : (
          <>
            <Table
              className="obj-table"
              rowKey="key"
              dataSource={items}
              columns={columns}
              pagination={false}
              size="small"
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No objects"
                  />
                ),
              }}
              scroll={{ x: "max-content" }}
            />
            {!isSearchMode && (currentPage > 0 || hasNextPage) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Button
                  icon={<LeftOutlined />}
                  size="small"
                  disabled={currentPage === 0}
                  onClick={() => {
                    const p = currentPage - 1;
                    setCurrentPage(p);
                    load(prefix, p);
                  }}
                >
                  上一页
                </Button>
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
                  第 {currentPage + 1} 页
                </span>
                <Button
                  size="small"
                  disabled={!hasNextPage}
                  onClick={() => {
                    const p = currentPage + 1;
                    setCurrentPage(p);
                    load(prefix, p);
                  }}
                >
                  下一页 <RightOutlined />
                </Button>
                {!hasNextPage && currentPage * pageSize + items.length >= MAX_TOTAL && (
                  <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                    已达 {MAX_TOTAL} 条上限，请使用前缀检索
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) {
            uploadFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Create folder modal */}
      <Modal
        title="New Folder"
        open={folderModal}
        onOk={handleCreateFolder}
        onCancel={() => {
          setFolderModal(false);
          folderForm.resetFields();
        }}
        okText="Create"
      >
        <Form form={folderForm} layout="vertical">
          <Form.Item
            name="name"
            label="Folder name"
            rules={[{ required: true, message: "Enter a folder name" }]}
          >
            <Input placeholder="my-folder" autoFocus />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Will be created as: {prefix}{"<name>"}/
          </Text>
        </Form>
      </Modal>

      {/* Detail drawer */}
      <DetailDrawer
        open={drawerItem !== null}
        target={target}
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
      />
    </div>
  );
}
