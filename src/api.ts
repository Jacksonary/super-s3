import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountConfig,
  ObjectMeta,
  ListResult,
  SearchResult,
  DeleteResult,
  UploadEntry,
  TransferConfig,
  HistoryEntry,
} from "./types";

export const api = {
  accounts(): Promise<Account[]> {
    return invoke("list_accounts");
  },

  getConfig(): Promise<AccountConfig[]> {
    return invoke("get_config");
  },

  putConfig(accounts: AccountConfig[]): Promise<{ ok: boolean }> {
    return invoke("put_config", { accounts });
  },

  buckets(accountId: number): Promise<{ buckets: string[] }> {
    return invoke("list_buckets", { accountIdx: accountId });
  },

  listObjects(
    accountId: number,
    bucket: string,
    opts: {
      prefix?: string;
      delimiter?: string;
      continuation_token?: string;
      limit?: number;
    } = {}
  ): Promise<ListResult> {
    return invoke("list_objects", {
      accountIdx: accountId,
      bucket,
      prefix: opts.prefix ?? "",
      delimiter: opts.delimiter ?? "/",
      continuationToken: opts.continuation_token ?? null,
      limit: opts.limit ?? 200,
    });
  },

  search(
    accountId: number,
    bucket: string,
    q: string,
    prefix = "",
    limit = 200,
    continuationToken?: string
  ): Promise<SearchResult> {
    return invoke("search_objects", {
      accountIdx: accountId,
      bucket,
      q,
      prefix,
      limit,
      continuationToken: continuationToken ?? null,
    });
  },

  deleteObjects(
    accountId: number,
    bucket: string,
    keys: string[]
  ): Promise<DeleteResult> {
    return invoke("delete_objects", {
      accountIdx: accountId,
      bucket,
      keys,
    });
  },

  getTransferConfig(): Promise<TransferConfig> {
    return invoke("get_transfer_config");
  },

  putTransferConfig(config: TransferConfig): Promise<{ ok: boolean }> {
    return invoke("put_transfer_config", { config });
  },

  /** Download S3 object directly to a local file path. */
  download(
    accountId: number,
    bucket: string,
    key: string,
    savePath: string,
    taskId?: string,
    connections?: number
  ): Promise<{ success: boolean }> {
    return invoke("download_object", {
      accountIdx: accountId,
      bucket,
      key,
      savePath,
      taskId: taskId ?? null,
      connections: connections ?? null,
    });
  },

  presign(
    accountId: number,
    bucket: string,
    key: string,
    expires = 3600
  ): Promise<{ url: string }> {
    return invoke("presign_object", {
      accountIdx: accountId,
      bucket,
      key,
      expires,
    });
  },

  meta(accountId: number, bucket: string, key: string): Promise<ObjectMeta> {
    return invoke("object_meta", {
      accountIdx: accountId,
      bucket,
      key,
    });
  },

  preview(
    accountId: number,
    bucket: string,
    key: string,
    maxBytes?: number
  ): Promise<{ text: string }> {
    return invoke("preview_object", {
      accountIdx: accountId,
      bucket,
      key,
      maxBytes: maxBytes ?? null,
    });
  },

  updateText(
    accountId: number,
    bucket: string,
    key: string,
    text: string,
    contentType = "text/plain; charset=utf-8"
  ): Promise<{ ok: boolean }> {
    return invoke("update_text", {
      accountIdx: accountId,
      bucket,
      key,
      text,
      contentType,
    });
  },

  /** Expand local paths (files or dirs) into a flat {local_path, relative_path}[] list. */
  expandPaths(paths: string[]): Promise<UploadEntry[]> {
    return invoke("expand_paths", { paths });
  },

  /** Upload from a local file path (for file dialog picks). */
  uploadObject(
    accountId: number,
    bucket: string,
    key: string,
    filePath: string,
    contentType?: string,
    taskId?: string,
    partConcurrency?: number
  ): Promise<{ success: boolean; key: string; size: number }> {
    return invoke("upload_object", {
      accountIdx: accountId,
      bucket,
      key,
      filePath,
      contentType: contentType ?? null,
      taskId: taskId ?? null,
      partConcurrency: partConcurrency ?? null,
    });
  },

  createFolder(
    accountId: number,
    bucket: string,
    prefix: string
  ): Promise<{ success: boolean; key: string }> {
    return invoke("create_folder", {
      accountIdx: accountId,
      bucket,
      prefix,
    });
  },

  rename(
    accountId: number,
    bucket: string,
    srcKey: string,
    dstKey: string
  ): Promise<{ success: boolean; src: string; dst: string }> {
    return invoke("rename_object", {
      accountIdx: accountId,
      bucket,
      srcKey,
      dstKey,
    });
  },

  batchDownload(
    accountId: number,
    bucket: string,
    keys: string[],
    saveDir: string,
    stripPrefix?: string
  ): Promise<{ success: boolean; downloaded: number; errors: string[] }> {
    return invoke("batch_download", {
      accountIdx: accountId,
      bucket,
      keys,
      saveDir,
      stripPrefix: stripPrefix ?? "",
    });
  },

  checkUpdate(): Promise<{ latestVersion: string; releaseUrl: string }> {
    return invoke("check_update");
  },

  // ─── History ────────────────────────────────────────────────────────────

  getHistory(): Promise<HistoryEntry[]> {
    return invoke("get_history");
  },

  appendHistory(entries: HistoryEntry[]): Promise<{ ok: boolean }> {
    return invoke("append_history_entry", { entries });
  },

  clearHistory(): Promise<{ ok: boolean }> {
    return invoke("clear_history");
  },

  // ─── Bucket info ────────────────────────────────────────────────────────────

  getBucketLocation(accountId: number, bucket: string): Promise<{ location: string }> {
    return invoke("get_bucket_location", { accountIdx: accountId, bucket });
  },

  getBucketAcl(
    accountId: number,
    bucket: string
  ): Promise<{ owner: string; grants: { grantee: string; permission: string }[] }> {
    return invoke("get_bucket_acl", { accountIdx: accountId, bucket });
  },

  getBucketVersioning(
    accountId: number,
    bucket: string
  ): Promise<{ status: string | null; mfa_delete: string | null }> {
    return invoke("get_bucket_versioning", { accountIdx: accountId, bucket });
  },

  getBucketEncryption(
    accountId: number,
    bucket: string
  ): Promise<{ rules: { algorithm: string; kms_key_id: string | null }[] }> {
    return invoke("get_bucket_encryption", { accountIdx: accountId, bucket });
  },

  getBucketLifecycle(
    accountId: number,
    bucket: string
  ): Promise<{
    rules: {
      id: string | null;
      status: string;
      prefix: string | null;
      transitions: { days: number | null; storage_class: string | null }[];
      expiration: { days: number | null; expired_object_delete_marker: boolean } | null;
      noncurrent_transitions: { days: number | null; storage_class: string | null }[];
      noncurrent_expiration_days: number | null;
    }[];
  }> {
    return invoke("get_bucket_lifecycle", { accountIdx: accountId, bucket });
  },

  getBucketCors(
    accountId: number,
    bucket: string
  ): Promise<{
    rules: {
      allowed_origins: string[];
      allowed_methods: string[];
      allowed_headers: string[];
      expose_headers: string[];
      max_age_seconds: number | null;
    }[];
  }> {
    return invoke("get_bucket_cors", { accountIdx: accountId, bucket });
  },

  getBucketTags(
    accountId: number,
    bucket: string
  ): Promise<{ tags: { key: string; value: string }[] }> {
    return invoke("get_bucket_tags", { accountIdx: accountId, bucket });
  },

  getBucketLogging(
    accountId: number,
    bucket: string
  ): Promise<{ target_bucket: string | null; target_prefix: string | null }> {
    return invoke("get_bucket_logging", { accountIdx: accountId, bucket });
  },
};
