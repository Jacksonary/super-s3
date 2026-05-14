export interface Account {
  id: number;
  name: string;
  endpoint: string;
  region: string;
  buckets: string[];
}

export interface AccountConfig {
  id?: string;
  name?: string;
  ak: string;
  sk: string;
  endpoint: string;
  region: string;
  buckets: string[];
}

export interface ObjectMeta {
  content_type: string | null;
  content_length: number | null;
  last_modified: string | null;
  etag: string | null;
  expires: string | null;
  metadata: Record<string, string>;
}

export interface ObjectItem {
  key: string;
  name: string;
  type: "file" | "folder";
  size: number | null;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}

export interface ListResult {
  prefix: string;
  delimiter: string;
  items: ObjectItem[];
  next_continuation_token: string | null;
  is_truncated: boolean;
  key_count: number;
}

export interface SearchResult {
  items: ObjectItem[];
  is_truncated: boolean;
  next_continuation_token: string | null;
}

export interface DeleteResult {
  deleted: number;
  errors: { Key: string; Message: string }[];
}

export interface SelectedBucket {
  accountId: number;
  bucket: string;
}

export interface TransferConfig {
  concurrent_files: number;
  download_connections: number;
  upload_part_concurrency: number;
}

export interface UploadTask {
  id: string;
  filename: string;
  progress: number;
  done: boolean;
  error?: string;
  filePath?: string;
  relPath?: string;
  key?: string;
  /** Pre-bound retry callback stored at task creation time. */
  retry?: () => void;
}

export interface DownloadTask {
  id: string;
  filename: string;
  progress: number;
  done: boolean;
  error?: string;
}

export interface UploadEntry {
  local_path: string;
  relative_path: string;
}
