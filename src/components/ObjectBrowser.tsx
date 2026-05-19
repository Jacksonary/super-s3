import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";import {
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
  Spin,
  Modal,
  Form,
  theme,
  Badge,
  Select,
  Dropdown,
  Menu,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownOutlined,
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
  InboxOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { save, open, ask } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { api } from "../api";
import type { ObjectItem, SelectedBucket, UploadEntry, TransferConfig, UploadTask, DownloadTask, HistoryEntry } from "../types";
import { fmtSize, fmtDate } from "../utils";
import { DetailDrawer } from "./DetailDrawer";
import { BucketDrawer } from "./BucketDrawer";

const { Text } = Typography;

// ─── Main component ─────────────────────────────────────────────────────────

interface Props {
  target: SelectedBucket;
  transferConfig: TransferConfig;
  uploads: UploadTask[];
  downloads: DownloadTask[];
  setUploads: React.Dispatch<React.SetStateAction<UploadTask[]>>;
  setDownloads: React.Dispatch<React.SetStateAction<DownloadTask[]>>;
  uploadTaskCounter: React.MutableRefObject<number>;
}

export function ObjectBrowser({ target, transferConfig, uploads, downloads, setUploads, setDownloads, uploadTaskCounter }: Props) {
  const { token } = theme.useToken();
  const { accountId, bucket } = target;

  const recordHistory = (
    type: string, filename: string, key: string,
    status: "done" | "error", opts?: { size?: number | null; error?: string; extra?: string },
  ) => {
    api.appendHistory([{
      type, filename, key, bucket,
      account_name: String(accountId),
      size: opts?.size ?? null,
      status,
      error: opts?.error ?? null,
      extra: opts?.extra ?? null,
      timestamp: Date.now(),
    }]).catch(() => {});
  };


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
  const pageTokensRef = useRef<(string | undefined)[]>([undefined]);

  // upload dropdown
  const [uploadDropdownOpen, setUploadDropdownOpen] = useState(false);

  // upload/download state is managed by App.tsx and passed via props

  // folder modal
  const [folderModal, setFolderModal] = useState(false);
  const [folderForm] = Form.useForm();

  // drag-over state (counter avoids flicker from child dragLeave events)
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // detail drawer
  const [drawerItem, setDrawerItem] = useState<ObjectItem | null>(null);
  // bucket info drawer (mutually exclusive with detail drawer)
  const [bucketDrawerOpen, setBucketDrawerOpen] = useState(false);

  // context menu
  const [ctxMenu, setCtxMenu] = useState<{ item: ObjectItem; x: number; y: number } | null>(null);

  // shortcuts help modal
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<{ focus: () => void }>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [ctxMenu]);

  // rename modal
  const [renameItem, setRenameItem] = useState<ObjectItem | null>(null);
  const [renameForm] = Form.useForm();

  // download progress
  const [downloadProgress, setDownloadProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    currentKey: string;
  } | null>(null);

  // Listen for batch download progress events from Rust.
  // upload-progress and download-single-progress are handled in App.tsx.
  useEffect(() => {
    const unlistenDownload = listen<{
      total: number;
      completed: number;
      failed: number;
      current_key: string;
    }>("download-progress", (event) => {
      const { total, completed, failed, current_key } = event.payload;
      setDownloadProgress({ total, completed, failed, currentKey: current_key });
    });
    return () => {
      unlistenDownload.then((fn) => fn());
    };
  }, []);

  // Holds the latest doUploadPaths; updated each render via useLayoutEffect below.
  // The noop default is intentional: drops arriving before first commit are silently
  // ignored, which is the correct behaviour (bucket not yet loaded).
  const doUploadPathsRef = useRef<(paths: string[]) => void>(() => {});

  // Listen for Tauri window drag-drop events — registered once, uses ref for latest handler
  useEffect(() => {
    const unlistenDrop = getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload as DragDropEvent;
      if (payload.type !== "drop") return;
      const { paths } = payload;
      if (paths.length === 0) return;
      doUploadPathsRef.current(paths);
    });

    return () => {
      unlistenDrop.then((fn) => fn());
    };
  }, []); // registered once; handler updates via ref below

  // ─── Load objects ──────────────────────────────────────────────────────

  const load = useCallback(
    async (p: string, page = 0, pSize?: number, clearItems = false) => {
      const size = pSize ?? pageSizeRef.current;
      setLoading(true);
      if (clearItems) setItems([]);
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
        message.error(`Load failed: ${e}`);
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
    load("", 0, undefined, true);
  }, [accountId, bucket, load]);

  // ─── Breadcrumb navigation ─────────────────────────────────────────────

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
    load(p, 0, undefined, true);
  };

  // ─── Search ────────────────────────────────────────────────────────────

  const loadSearch = useCallback(
    async (q: string, page = 0, clearItems = false) => {
      const size = pageSizeRef.current;
      setLoading(true);
      if (clearItems) setItems([]);
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
        message.error(`Search failed: ${e}`);
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
    loadSearch(val, 0, true);
  };

  // ─── Collect keys (parallel per folder) ─────────────────────────────────

  const collectKeysUnderPrefix = async (pfx: string): Promise<string[]> => {
    const result: string[] = [];
    let ct: string | null | undefined;
    do {
      const res = await api.listObjects(accountId, bucket, {
        prefix: pfx,
        delimiter: "",
        continuation_token: ct ?? undefined,
        limit: 1000,
      });
      res.items.forEach((i) => result.push(i.key));
      ct = res.next_continuation_token;
    } while (ct);
    return result;
  };

  const expandKeys = async (
    keys: string[],
    opts: { filesOnly?: boolean; includeFolderMarker?: boolean } = {}
  ): Promise<string[]> => {
    const { filesOnly = false, includeFolderMarker = false } = opts;
    const tasks = keys.map(async (k) => {
      if (!k.endsWith("/")) return [k];
      const children = await collectKeysUnderPrefix(k);
      if (includeFolderMarker && !children.includes(k)) children.push(k);
      return filesOnly ? children.filter((c) => !c.endsWith("/")) : children;
    });
    const nested = await Promise.all(tasks);
    return nested.flat();
  };

  // ─── Delete ────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    const keys = selectedRowKeys.filter((k): k is string => typeof k === "string");
    if (!keys.length) return;
    setDeleting(true);
    try {
      const toDelete = await expandKeys(keys, { includeFolderMarker: true });
      if (!toDelete.length) {
        message.warning("Nothing to delete");
        return;
      }
      const result = await api.deleteObjects(accountId, bucket, toDelete);
      message.success(`Deleted ${result.deleted} object(s)`);
      setSelectedRowKeys([]);
      reload();
    } catch (e: unknown) {
      message.error(`Delete failed: ${String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteRow = async (item: ObjectItem) => {
    setDeleting(true);
    try {
      const toDelete = await expandKeys([item.key], { includeFolderMarker: true });
      const result = await api.deleteObjects(accountId, bucket, toDelete);
      message.success(`Deleted ${result.deleted} object(s)`);
      reload();
    } catch (e: unknown) {
      message.error(`Delete failed: ${String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Download (native file dialog) ────────────────────────────────────

  const handleDownload = async (key: string, fileSize?: number) => {
    const filename = key.split("/").pop() || "file";
    const size = fileSize ?? items.find((i) => i.key === key)?.size ?? undefined;
    const savePath = await save({ defaultPath: filename, title: "Save file" });
    if (!savePath) return;
    const taskId = `dl-${Date.now()}-${filename}`;
    const retry = () => {
      setDownloads((prev) => prev.filter((d) => d.id !== taskId));
      handleDownload(key, size);
    };
    setDownloads((prev) => [...prev, { id: taskId, filename, progress: 0, status: "running", size, savePath, key, retry }]);
    try {
      await api.download(accountId, bucket, key, savePath, taskId, transferConfig.download_connections, transferConfig.download_part_size, transferConfig.multipart_threshold);
      setDownloads((prev) =>
        prev.map((d) => d.id === taskId ? { ...d, progress: 100, status: "done" as const } : d)
      );
      recordHistory("download", filename, key, "done", { extra: savePath });
      setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== taskId)), 2500);
    } catch (e: unknown) {
      const isCancelled = String(e).includes("Transfer cancelled");
      setDownloads((prev) =>
        prev.map((d) => d.id === taskId
          ? { ...d, error: isCancelled ? undefined : String(e), status: isCancelled ? "cancelled" as const : "error" as const }
          : d)
      );
      if (isCancelled) {
        // Auto-dismiss cancelled after a short delay so user sees feedback.
        setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== taskId)), 2500);
      }
      // Error tasks stay in Active for retry, no auto-dismiss.
    }
  };

  // ─── Upload ────────────────────────────────────────────────────────────

  const doUploadEntries = useCallback(async (entries: UploadEntry[]) => {
    // Capture concurrency at call time so config changes during an upload
    // don't affect the already-running worker pool.
    const concurrency = transferConfig.concurrent_files;
    let idx = 0;

    const worker = async () => {
      while (idx < entries.length) {
        const i = idx++;
        const { local_path: filePath, relative_path: relPath } = entries[i];
        const filename = relPath;
        const taskId = `upload-${++uploadTaskCounter.current}-${relPath.replace(/\//g, "-")}`;
        const key = prefix + relPath;
        // Get file size to determine whether to show pause button.
        const size = await api.statFile(filePath).catch(() => undefined);
        // Store retry callback in the task so TransferPanel can trigger it.
        const retry = () => {
          setUploads((prev) => prev.filter((u) => u.id !== taskId));
          doUploadEntries([{ local_path: filePath, relative_path: relPath }]);
        };
        setUploads((prev) => [
          ...prev,
          { id: taskId, filename, progress: 0, status: "running", size, filePath, relPath, key, retry },
        ]);
        try {
          await api.uploadObject(accountId, bucket, key, filePath, undefined, taskId, transferConfig.upload_part_concurrency, transferConfig.upload_part_size, transferConfig.multipart_threshold);
          setUploads((prev) =>
            prev.map((u) =>
              u.id === taskId ? { ...u, progress: 100, status: "done" as const } : u
            )
          );
          recordHistory("upload", filename, key, "done");
          setTimeout(() => {
            setUploads((prev) => prev.filter((u) => u.id !== taskId));
          }, 2500);
        } catch (e: unknown) {
          const isCancelled = String(e).includes("Transfer cancelled");
          setUploads((prev) =>
            prev.map((u) =>
              u.id === taskId
                ? { ...u, error: isCancelled ? undefined : String(e), status: isCancelled ? "cancelled" as const : "error" as const }
                : u
            )
          );
          if (isCancelled) {
            setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== taskId)), 2500);
          }
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, entries.length) },
      () => worker()
    );
    await Promise.allSettled(workers);
    reload();
  }, [transferConfig, setUploads, uploadTaskCounter, prefix, accountId, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Expand paths, check duplicates, then upload. */
  const doUploadPaths = async (paths: string[]) => {
    let entries: UploadEntry[];
    try {
      entries = await api.expandPaths(paths);
    } catch (e: unknown) {
      message.error(`Failed to expand paths: ${e}`);
      return;
    }
    if (entries.length === 0) return;

    const existingKeys = new Set(items.map((i) => i.key));
    const duplicates = entries.filter((e) => existingKeys.has(prefix + e.relative_path));

    if (duplicates.length > 0) {
      const names = duplicates.map((e) => e.relative_path);
      const label =
        names.length <= 3
          ? names.join(", ")
          : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
      const overwrite = await ask(
        `${label} already exist in this directory. Overwrite?`,
        { title: "File already exists", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" }
      );
      if (!overwrite) return;
    }
    doUploadEntries(entries);
  };

  // Keep ref in sync with the latest doUploadPaths (called by drag-drop listener)
  useLayoutEffect(() => {
    doUploadPathsRef.current = doUploadPaths;
  });

  const handleUploadButton = async () => {
    const selected = await open({ multiple: true, directory: false, title: "Select files to upload" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    doUploadPaths(paths);
  };

  const handleUploadFolderButton = async () => {
    const selected = await open({ multiple: false, directory: true, title: "Select folder to upload" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    doUploadPaths(paths);
  };

  // ─── Drag & drop ───────────────────────────────────────────────────────

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
  };

  // ─── Copy link ─────────────────────────────────────────────────────────

  const copyPresignedLink = async (item: ObjectItem) => {
    try {
      const { url } = await api.presign(accountId, bucket, item.key);
      await writeText(url);
      message.success("Presigned URL copied to clipboard");
    } catch (e: unknown) {
      message.error(`Failed to generate presigned URL: ${e}`);
    }
  };

  // ─── Batch download (app mode: select folder, download files directly) ──

  const [downloading, setDownloading] = useState(false);

  const downloadSelected = async () => {
    const keys = selectedRowKeys.filter((k): k is string => typeof k === "string");
    if (!keys.length) return;

    // Single file: use save dialog
    if (keys.length === 1 && !keys[0].endsWith("/")) {
      await handleDownload(keys[0]);
      return;
    }

    // Ask user to pick a folder
    const saveDir = await open({ directory: true, title: "Select folder to save files" });
    if (!saveDir) return;

    setDownloading(true);
    setDownloadProgress(null);
    const hidePrep = message.loading("Preparing download...", 0);
    try {
      const fileKeys = await expandKeys(keys, { filesOnly: true });
      if (!fileKeys.length) {
        message.warning("No files to download");
        return;
      }

      const folders = keys.filter((k) => k.endsWith("/"));
      const isSingleFolder = keys.length === 1 && folders.length === 1;
      const stripPrefix = isSingleFolder
        ? folders[0].slice(0, folders[0].slice(0, -1).lastIndexOf("/") + 1)
        : prefix;

      const result = await api.batchDownload(accountId, bucket, fileKeys, saveDir, stripPrefix);
      if (result.errors.length > 0) {
        message.warning(`Downloaded ${result.downloaded} file(s), ${result.errors.length} failed`);
      } else {
        message.success(`Downloaded ${result.downloaded} file(s)`);
      }
      const errorMap = new Map<string, string>();
      for (const err of result.errors) {
        const idx = err.indexOf(": ");
        if (idx >= 0) errorMap.set(err.slice(0, idx), err.slice(idx + 2));
      }
      const sizeMap = new Map(items.map((o) => [o.key, o.size]));
      const entries: HistoryEntry[] = fileKeys.map((k) => {
        const filename = k.split("/").pop() || k;
        const errMsg = errorMap.get(k);
        return {
          type: "download",
          filename,
          key: k,
          bucket,
          account_name: String(accountId),
          size: sizeMap.get(k) ?? null,
          status: errMsg ? "error" : "done",
          error: errMsg ?? null,
          extra: saveDir,
          timestamp: Date.now(),
        };
      });
      api.appendHistory(entries).catch(() => {});
    } catch (e: unknown) {
      message.error(`Download failed: ${String(e)}`);
    } finally {
      hidePrep();
      setDownloading(false);
      setDownloadProgress(null);
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
    const newName = String(values.name ?? "").trim();
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
      const detail = String(e);
      message.error(`Rename failed: ${detail}`);
    }
  };

  // ─── Create folder ─────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    const values = await folderForm.validateFields();
    const folderName = String(values.name ?? "").trim().replace(/\/$/, "");
    if (!folderName) return;
    try {
      await api.createFolder(accountId, bucket, prefix + folderName);
      message.success(`Folder "${folderName}" created`);
      setFolderModal(false);
      folderForm.resetFields();
      reload();
    } catch (e: unknown) {
      message.error(`Failed: ${e}`);
    }
  };

  // ─── Table columns ─────────────────────────────────────────────────────

  const navigateRef = useRef(navigate);
  const openDetailDrawer = useCallback((item: ObjectItem) => {
    setBucketDrawerOpen(false);
    setDrawerItem(item);
  }, []);
  const setDrawerItemRef = useRef(openDetailDrawer);
  const handleDownloadRef = useRef(handleDownload);
  const copyPresignedLinkRef = useRef(copyPresignedLink);
  const openRenameRef = useRef(openRename);
  const handleDeleteRowRef = useRef(handleDeleteRow);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
    setDrawerItemRef.current = openDetailDrawer;
    handleDownloadRef.current = handleDownload;
    copyPresignedLinkRef.current = copyPresignedLink;
    openRenameRef.current = openRename;
    handleDeleteRowRef.current = handleDeleteRow;
  });

  // ─── Global keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;

      // ? — open shortcuts reference (only when not in input)
      if (e.key === "?" && !inInput) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (e.key === "Escape") {
        if (ctxMenu) setCtxMenu(null);
        return;
      }

      // Ctrl-based shortcuts — skip if in input (except Ctrl+F)
      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case "f":
            e.preventDefault();
            searchInputRef.current?.focus();
            return;
          case "u":
            if (inInput) return;
            e.preventDefault();
            handleUploadButton();
            return;
          case "n":
            if (inInput) return;
            e.preventDefault();
            setFolderModal(true);
            return;
          case "r":
            if (inInput) return;
            e.preventDefault();
            setCurrentPage(0);
            pageTokensRef.current = [undefined];
            load(prefix, 0);
            return;
        }
        return;
      }

      // Delete — works even when checkbox is focused (not a text input)
      if (e.key === "Delete" && selectedRowKeys.length > 0) {
        const isTextInput = tag === "TEXTAREA" || (tag === "INPUT" && (e.target as HTMLInputElement).type === "text");
        if (!isTextInput) {
          e.preventDefault();
          Modal.confirm({
            title: `Delete ${selectedRowKeys.length} item(s)?`,
            okText: "Delete",
            okButtonProps: { danger: true },
            onOk: () => deleteSelected(),
          });
        }
        return;
      }

      // Non-ctrl shortcuts — skip if in input
      if (inInput) return;
      switch (e.key) {
        case "Backspace":
          if (prefix) {
            const parent = prefix.replace(/[^/]+\/$/, "");
            navigate(parent);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const columns: ColumnsType<ObjectItem> = useMemo(() => [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, row) => {
        if (row.type === "folder") {
          return (
            <Space size={6}>
              <FolderOutlined style={{ color: token.colorWarning, fontSize: 16 }} />
              <a
                onClick={() => navigateRef.current(row.key)}
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
                    onClick={() => navigateRef.current(dirSegments.slice(0, i + 1).join("/") + "/")}
                  >
                    {seg}/
                  </span>
                ))}
                <a
                  className="search-file"
                  onClick={() => setDrawerItemRef.current(row)}
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
              onClick={() => setDrawerItemRef.current(row)}
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
        ) : (
          <span style={{ color: token.colorTextQuaternary, fontSize: 12 }}>—</span>
        ),
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
                  onClick={() => handleDownloadRef.current(row.key)}
                />
              </Tooltip>
              <Tooltip title="Copy presigned URL">
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  onClick={() => copyPresignedLinkRef.current(row)}
                />
              </Tooltip>
            </>
          )}
          <Tooltip title="Copy key">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={async () => {
                await writeText(row.key);
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
                onClick={() => openRenameRef.current(row)}
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
            onConfirm={() => handleDeleteRowRef.current(row)}
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
  ], [token.colorWarning, token.colorText, token.colorTextSecondary, token.colorTextQuaternary, isSearchMode]);

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
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <div className="drop-overlay-icon">
              <UploadOutlined />
            </div>
            <div className="drop-overlay-text">Drop to upload</div>
            <div className="drop-overlay-hint">Files and folders are supported</div>
          </div>
        </div>
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
                <a
                  onClick={() => navigate("")}
                  onKeyDown={(e) => e.key === "Enter" && navigate("")}
                >
                  <HomeOutlined /> {bucket}
                </a>
              ),
            },
            ...segments.map((seg) => ({
              title: (
                <a
                  onClick={() => navigate(seg.prefix)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(seg.prefix)}
                >
                  {seg.label}
                </a>
              ),
            })),
          ]}
        />

        <Input.Search
          ref={searchInputRef as any}
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

        <div className="toolbar-sep" />

        <Space>
          <Dropdown
            menu={{
              items: [
                { key: "files", label: "Upload files", icon: <UploadOutlined />, onClick: handleUploadButton },
                { key: "folder", label: "Upload folder", icon: <FolderOutlined />, onClick: handleUploadFolderButton },
              ],
            }}
            trigger={["click"]}
            onOpenChange={setUploadDropdownOpen}
          >
            <Tooltip title="Ctrl+U" open={uploadDropdownOpen ? false : undefined}>
              <Button icon={<UploadOutlined />}>
                Upload <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Tooltip>
          </Dropdown>
          <Tooltip title="New folder (Ctrl+N)">
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
                {downloadProgress
                  ? `${downloadProgress.completed}/${downloadProgress.total}`
                  : "Download"}
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
          <Tooltip title="Refresh (Ctrl+R)">
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => {
                setCurrentPage(0);
                pageTokensRef.current = [undefined];
                load(prefix, 0);
              }}
            />
          </Tooltip>
          <Tooltip title="Bucket info">
            <Button
              icon={<InfoCircleOutlined />}
              onClick={() => {
                setDrawerItem(null);
                setBucketDrawerOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip title="Keyboard shortcuts (?)">
            <Button
              icon={<span style={{ fontSize: 14, fontWeight: 600 }}>?</span>}
              onClick={() => setShortcutsOpen(true)}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Table */}
      <div className="table-container" style={{ background: token.colorBgContainer }} onContextMenu={() => setCtxMenu(null)}>
          <Table
            className="obj-table"
            rowKey="key"
            dataSource={items}
            columns={columns}
            pagination={false}
            size="small"
            loading={{
              spinning: loading || deleting,
              indicator: <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />,
            }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
            }}
            locale={{
              emptyText: (
                <div className="empty-state-wrap" style={{ padding: "40px 0" }}>
                  <InboxOutlined className="empty-state-icon" />
                  <Text style={{ fontSize: 14, fontWeight: 600 }}>This folder is empty</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Upload files or drop them anywhere in this area
                  </Text>
                </div>
              ),
            }}
            scroll={{ x: "max-content" }}
            onRow={(record) => ({
              onContextMenu: (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!deleting) setCtxMenu({ item: record, x: e.clientX, y: e.clientY });
              },
            })}
          />
      </div>

      {/* Pagination — fixed at bottom, always visible */}
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

      {/* Create folder modal */}
      <Modal
        title="New Folder"
        open={folderModal}
        onOk={() => folderForm.submit()}
        onCancel={() => {
          setFolderModal(false);
          folderForm.resetFields();
        }}
        okText="Create"
        afterOpenChange={(open) => {
          if (open) folderForm.focusField("name");
        }}
      >
        <Form form={folderForm} layout="vertical" onFinish={handleCreateFolder}>
          <Form.Item
            name="name"
            label="Folder name"
            rules={[{ required: true, message: "Enter a folder name" }]}
          >
            <Input placeholder="my-folder" />
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
        setDownloads={setDownloads}
        transferConfig={transferConfig}
      />

      {/* Bucket info drawer */}
      <BucketDrawer
        open={bucketDrawerOpen}
        target={target}
        onClose={() => setBucketDrawerOpen(false)}
      />

      {/* Keyboard shortcuts reference */}
      <Modal
        title="Keyboard Shortcuts"
        open={shortcutsOpen}
        onCancel={() => setShortcutsOpen(false)}
        footer={null}
        width={420}
      >
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 13 }}>
          <Tag>Ctrl+F</Tag><span>Focus search</span>
          <Tag>Ctrl+U</Tag><span>Upload files</span>
          <Tag>Ctrl+N</Tag><span>New folder</span>
          <Tag>Ctrl+R</Tag><span>Refresh</span>
          <Tag>Delete</Tag><span>Delete selected</span>
          <Tag>Backspace</Tag><span>Go to parent folder</span>
          <Tag>?</Tag><span>Show this reference</span>
          <Tag>Esc</Tag><span>Close dialog / menu</span>
        </div>
      </Modal>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1050 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
        >
          <Menu
            style={{
              position: "fixed",
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1051,
              borderRadius: 8,
              boxShadow: token.boxShadowSecondary,
              minWidth: 180,
            }}
            items={[
              ...(ctxMenu.item.type === "file"
                ? [
                    { key: "open", label: "Open", icon: <FileOutlined /> },
                    { type: "divider" as const },
                    { key: "download", label: "Download", icon: <DownloadOutlined /> },
                    { key: "presign", label: "Copy presigned URL", icon: <LinkOutlined /> },
                  ]
                : [
                    { key: "open-folder", label: "Open", icon: <FolderOutlined /> },
                    { type: "divider" as const },
                  ]),
              { key: "copy-key", label: "Copy key", icon: <CopyOutlined /> },
              ...(ctxMenu.item.type === "file"
                ? [{ key: "rename", label: "Rename", icon: <EditOutlined /> }]
                : []),
              { type: "divider" as const },
              { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true },
            ]}
            onClick={async ({ key }) => {
              const row = ctxMenu.item;
              setCtxMenu(null);
              switch (key) {
                case "open":
                  openDetailDrawer(row);
                  break;
                case "open-folder":
                  navigate(row.key);
                  break;
                case "download":
                  handleDownloadRef.current(row.key);
                  break;
                case "presign":
                  copyPresignedLinkRef.current(row);
                  break;
                case "copy-key":
                  await writeText(row.key);
                  message.success("Key copied");
                  break;
                case "rename":
                  openRenameRef.current(row);
                  break;
                case "delete":
                  Modal.confirm({
                    title: `Delete "${row.name}"?`,
                    content: row.type === "folder" ? "All objects inside will be deleted." : undefined,
                    okText: "Delete",
                    okButtonProps: { danger: true },
                    onOk: () => handleDeleteRowRef.current(row),
                  });
                  break;
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
