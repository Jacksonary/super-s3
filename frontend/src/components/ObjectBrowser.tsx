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
  Select,
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
  CloseCircleOutlined,
  EditOutlined,
  SearchOutlined,
  LoadingOutlined,
  CopyOutlined,
  HomeOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { ObjectItem, SelectedBucket } from "../types";
import { fmtSize, fmtDate, copyText } from "../utils";
import { DetailDrawer } from "./DetailDrawer";

const { Text } = Typography;

// ─── UploadQueue ────────────────────────────────────────────────────────────

interface UploadTask {
  id: string;
  filename: string;
  progress: number;
  done: boolean;
  error?: string;
  file?: File;
  key?: string;
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
  const [deleting, setDeleting] = useState(false);

  // pagination
  const MAX_TOTAL = 2000;
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const pageSizeRef = useRef(10);
  // pageTokensRef[i] = continuation_token to fetch page i (undefined = first page)
  const pageTokensRef = useRef<(string | undefined)[]>([undefined]);

  // upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);

  // folder modal
  const [folderModal, setFolderModal] = useState(false);
  const [folderForm] = Form.useForm();

  // drag-over state (counter avoids flicker from child dragLeave events)
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // detail drawer
  const [drawerItem, setDrawerItem] = useState<ObjectItem | null>(null);

  // rename modal
  const [renameItem, setRenameItem] = useState<ObjectItem | null>(null);
  const [renameForm] = Form.useForm();

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

  const loadSearch = useCallback(
    async (q: string, page = 0) => {
      const size = pageSizeRef.current;
      setLoading(true);
      setItems([]);
      setSelectedRowKeys([]);
      try {
        const res = await api.search(
          accountId, bucket, q, prefix, size,
          pageTokensRef.current[page]
        );
        setItems(res.items);
        const hasNext =
          !!res.next_continuation_token && (page + 1) * size < MAX_TOTAL;
        setHasNextPage(hasNext);
        if (res.next_continuation_token) {
          pageTokensRef.current[page + 1] = res.next_continuation_token;
        }
      } catch (e: unknown) {
        message.error(`Search failed: ${(e as Error).message}`);
      } finally {
        setLoading(false);
        setSearching(false);
      }
    },
    [accountId, bucket, prefix]
  );

  const handleSearch = (val: string) => {
    if (!val.trim()) {
      setIsSearchMode(false);
      reload();
      return;
    }
    setSearching(true);
    setIsSearchMode(true);
    setCurrentPage(0);
    pageTokensRef.current = [undefined];
    loadSearch(val, 0);
  };

  // ─── Delete ────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    const keys = selectedRowKeys as string[];
    if (!keys.length) return;
    setDeleting(true);
    try {
      const toDelete: string[] = [];
      for (const k of keys) {
        if (k.endsWith("/")) {
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
          if (!toDelete.includes(k)) {
            toDelete.push(k);
          }
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
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteRow = async (item: ObjectItem) => {
    const keysToDelete = item.type === "folder" ? [] : [item.key];
    if (item.type === "folder") {
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
    setDeleting(true);
    try {
      const result = await api.deleteObjects(accountId, bucket, keysToDelete);
      message.success(`Deleted ${result.deleted} object(s)`);
      reload();
    } catch (e: unknown) {
      message.error(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Upload ────────────────────────────────────────────────────────────

  const doUpload = async (filesToUpload: File[]) => {
    const CONCURRENCY = 5;
    let idx = 0;

    const worker = async () => {
      while (idx < filesToUpload.length) {
        const i = idx++;
        const file = filesToUpload[i];
        const taskId = `${Date.now()}-${i}-${file.name}`;
        const key = prefix + file.name;
        setUploads((prev) => [
          ...prev,
          { id: taskId, filename: file.name, progress: 0, done: false, file, key },
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
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, filesToUpload.length) },
      () => worker()
    );
    await Promise.all(workers);
    reload();
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const existingKeys = new Set(items.map((i) => i.key));
    const duplicates = arr.filter((f) => existingKeys.has(prefix + f.name));

    if (duplicates.length > 0) {
      const names = duplicates.map((f) => f.name);
      const label =
        names.length <= 3
          ? names.join(", ")
          : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
      Modal.confirm({
        title: "File already exists",
        content: `${label} already exist in this directory. Overwrite?`,
        okText: "Overwrite",
        okButtonProps: { danger: true },
        cancelText: "Cancel",
        onOk: () => doUpload(arr),
      });
    } else {
      doUpload(arr);
    }
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

  // ─── Batch download ─────────────────────────────────────────────────────

  const [downloading, setDownloading] = useState(false);

  const downloadSelected = async () => {
    const keys = selectedRowKeys as string[];
    if (!keys.length) return;

    setDownloading(true);
    const hide = message.loading("Preparing download...", 0);
    try {
      const fileKeys: string[] = [];
      for (const k of keys) {
        if (k.endsWith("/")) {
          let ct: string | null | undefined;
          do {
            const res = await api.listObjects(accountId, bucket, {
              prefix: k,
              delimiter: "",
              continuation_token: ct ?? undefined,
              limit: 1000,
            });
            res.items.forEach((i) => fileKeys.push(i.key));
            ct = res.next_continuation_token;
          } while (ct);
        } else {
          fileKeys.push(k);
        }
      }
      if (!fileKeys.length) {
        message.warning("No files to download");
        return;
      }

      if (fileKeys.length === 1) {
        const a = document.createElement("a");
        a.href = api.downloadUrl(accountId, bucket, fileKeys[0]);
        a.click();
      } else {
        const folders = keys.filter((k) => k.endsWith("/"));
        const isSingleFolder = keys.length === 1 && folders.length === 1;
        const zipName = isSingleFolder
          ? folders[0].replace(/\/$/, "").split("/").pop() || bucket
          : bucket;
        const stripPrefix = isSingleFolder ? folders[0] : prefix;
        const blob = await api.downloadZip(accountId, bucket, fileKeys, {
          filename: zipName,
          stripPrefix,
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${zipName}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      message.success(`Downloaded ${fileKeys.length} file(s)`);
    } catch (e: unknown) {
      message.error(`Download failed: ${(e as Error).message}`);
    } finally {
      hide();
      setDownloading(false);
    }
  };

  // ─── Rename ────────────────────────────────────────────────────────────

  const openRename = (item: ObjectItem) => {
    setRenameItem(item);
    const name = item.key.split("/").pop() || item.key;
    renameForm.setFieldsValue({ name });
  };

  const handleRename = async () => {
    if (!renameItem) return;
    const values = await renameForm.validateFields();
    const newName = (values.name as string).trim();
    if (!newName) return;
    const parts = renameItem.key.split("/");
    parts[parts.length - 1] = newName;
    const dstKey = parts.join("/");
    if (dstKey === renameItem.key) {
      setRenameItem(null);
      return;
    }
    try {
      await api.rename(accountId, bucket, renameItem.key, dstKey);
      message.success("Renamed successfully");
      setRenameItem(null);
      renameForm.resetFields();
      reload();
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? (e as Error)?.message ?? "Unknown error";
      message.error(`Rename failed: ${detail}`);
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
      render: (name: string, row) => {
        if (row.type === "folder") {
          return (
            <Space size={6}>
              <FolderOutlined style={{ color: "#faad14", fontSize: 16 }} />
              <a
                onClick={() => navigate(row.key)}
                style={{ fontWeight: 500, color: token.colorText }}
              >
                {name}
              </a>
            </Space>
          );
        }

        if (isSearchMode) {
          const lastSlash = row.key.lastIndexOf("/");
          const file = lastSlash >= 0 ? row.key.slice(lastSlash + 1) : row.key;
          const dirSegments = lastSlash >= 0
            ? row.key.slice(0, lastSlash).split("/").filter(Boolean)
            : [];
          return (
            <Space size={4}>
              <FileOutlined style={{ color: token.colorTextSecondary, fontSize: 14 }} />
              <span>
                {dirSegments.map((seg, i) => (
                  <span
                    key={i}
                    className="search-dir"
                    onClick={() => navigate(dirSegments.slice(0, i + 1).join("/") + "/")}
                  >
                    {seg}/
                  </span>
                ))}
                <a
                  className="search-file"
                  onClick={() => setDrawerItem(row)}
                  style={{ color: token.colorText }}
                >
                  {file}
                </a>
              </span>
            </Space>
          );
        }

        return (
          <Space size={6}>
            <FileOutlined style={{ color: token.colorTextSecondary, fontSize: 14 }} />
            <a
              onClick={() => setDrawerItem(row)}
              style={{ color: token.colorText }}
            >
              {name}
            </a>
          </Space>
        );
      },
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
      render: (v: string | null) => fmtDate(v),
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
      width: 150,
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
          {row.type === "file" && (
            <Tooltip title="Rename">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => openRename(row)}
              />
            </Tooltip>
          )}
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
      className="browser-root"
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        dragCounterRef.current = 0;
        onDrop(e);
      }}
    >
      {dragOver && (
        <div className="drop-overlay">Drop files to upload</div>
      )}

      {/* Toolbar */}
      <div
        className="toolbar"
        style={{
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
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
            <>
              <Button
                icon={<DownloadOutlined />}
                loading={downloading}
                onClick={downloadSelected}
              >
                Download
              </Button>
              <Popconfirm
                title={`Delete ${selectedRowKeys.length} item(s)?`}
                onConfirm={deleteSelected}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Badge count={selectedRowKeys.length}>
                  <Button danger icon={<DeleteOutlined />} loading={deleting}>
                    Delete
                  </Button>
                </Badge>
              </Popconfirm>
            </>
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
          className="upload-progress-bar"
          style={{
            background: token.colorFillAlter,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {uploads.map((u) => (
            <div key={u.id} style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 12, flex: 1 }}>{u.filename}</Text>
                {u.error && (
                  <Space size={4}>
                    {u.file && u.key && (
                      <Tooltip title="Retry">
                        <Button
                          size="small"
                          type="text"
                          icon={<ReloadOutlined />}
                          onClick={() => {
                            setUploads((prev) => prev.filter((t) => t.id !== u.id));
                            doUpload([u.file!]);
                          }}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="Dismiss">
                      <Button
                        size="small"
                        type="text"
                        icon={<CloseCircleOutlined />}
                        onClick={() =>
                          setUploads((prev) => prev.filter((t) => t.id !== u.id))
                        }
                      />
                    </Tooltip>
                  </Space>
                )}
              </div>
              <Progress
                percent={u.progress}
                size="small"
                status={u.error ? "exception" : u.done ? "success" : "active"}
                format={() => u.error ? <Text type="danger" style={{ fontSize: 11 }}>{u.error}</Text> : `${u.progress}%`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="table-container" style={{ background: token.colorBgContainer }}>
        {loading ? (
          <div className="content-center">
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
          </div>
        ) : (
          <Table
            className="obj-table"
            rowKey="key"
            dataSource={items}
            columns={columns}
            pagination={false}
            size="small"
            loading={deleting}
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
        )}
      </div>

      {/* Pagination — fixed at bottom, always visible */}
      {(currentPage > 0 || hasNextPage) && (
        <div
          className="pagination-bar"
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          <Button
            icon={<LeftOutlined />}
            size="small"
            disabled={currentPage === 0}
            onClick={() => {
              const p = currentPage - 1;
              setCurrentPage(p);
              if (isSearchMode) loadSearch(searchText, p);
              else load(prefix, p);
            }}
          />
          <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {currentPage + 1}
          </span>
          <Button
            icon={<RightOutlined />}
            size="small"
            disabled={!hasNextPage}
            onClick={() => {
              const p = currentPage + 1;
              setCurrentPage(p);
              if (isSearchMode) loadSearch(searchText, p);
              else load(prefix, p);
            }}
          />
          {!hasNextPage && currentPage * pageSize + items.length >= MAX_TOTAL && (
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
              Limit of {MAX_TOTAL} reached — use prefix search to narrow down
            </span>
          )}
          <Select
            size="small"
            value={pageSize}
            onChange={(size) => {
              pageSizeRef.current = size;
              setPageSize(size);
              setCurrentPage(0);
              pageTokensRef.current = [undefined];
              if (isSearchMode) loadSearch(searchText, 0);
              else load(prefix, 0, size);
            }}
            options={[
              { label: "10", value: 10 },
              { label: "20", value: 20 },
              { label: "50", value: 50 },
            ]}
            style={{ width: 66 }}
          />
        </div>
      )}

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

      {/* Rename modal */}
      <Modal
        title="Rename"
        open={renameItem !== null}
        onOk={handleRename}
        onCancel={() => {
          setRenameItem(null);
          renameForm.resetFields();
        }}
        okText="Rename"
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item
            name="name"
            label="New name"
            rules={[{ required: true, message: "Enter a file name" }]}
          >
            <Input autoFocus />
          </Form.Item>
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
