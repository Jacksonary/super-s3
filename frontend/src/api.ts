import axios from "axios";
import type {
  Account,
  ListResult,
  SearchResult,
  DeleteResult,
} from "./types";

const BASE = "/api";

export const api = {
  accounts(): Promise<Account[]> {
    return axios.get(`${BASE}/accounts`).then((r) => r.data);
  },

  buckets(accountId: number): Promise<{ buckets: string[] }> {
    return axios.get(`${BASE}/buckets/${accountId}`).then((r) => r.data);
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
    return axios
      .get(`${BASE}/objects/${accountId}/${encodeURIComponent(bucket)}`, {
        params: {
          prefix: opts.prefix ?? "",
          delimiter: opts.delimiter ?? "/",
          continuation_token: opts.continuation_token,
          limit: opts.limit ?? 200,
        },
      })
      .then((r) => r.data);
  },

  search(
    accountId: number,
    bucket: string,
    q: string,
    prefix = "",
    limit = 200
  ): Promise<SearchResult> {
    return axios
      .get(`${BASE}/search/${accountId}/${encodeURIComponent(bucket)}`, {
        params: { q, prefix, limit },
      })
      .then((r) => r.data);
  },

  deleteObjects(
    accountId: number,
    bucket: string,
    keys: string[]
  ): Promise<DeleteResult> {
    return axios
      .delete(`${BASE}/objects/${accountId}/${encodeURIComponent(bucket)}`, {
        data: { keys },
      })
      .then((r) => r.data);
  },

  downloadUrl(accountId: number, bucket: string, key: string): string {
    return `${BASE}/download/${accountId}/${encodeURIComponent(bucket)}?key=${encodeURIComponent(key)}`;
  },

  presign(
    accountId: number,
    bucket: string,
    key: string,
    expires = 3600
  ): Promise<{ url: string }> {
    return axios
      .get(`${BASE}/presign/${accountId}/${encodeURIComponent(bucket)}`, {
        params: { key, expires },
      })
      .then((r) => r.data);
  },

  uploadObject(
    accountId: number,
    bucket: string,
    key: string,
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<{ success: boolean; key: string; size: number }> {
    const form = new FormData();
    form.append("file", file);
    return axios
      .post(
        `${BASE}/upload/${accountId}/${encodeURIComponent(bucket)}?key=${encodeURIComponent(key)}`,
        form,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e) => {
            if (onProgress && e.total) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        }
      )
      .then((r) => r.data);
  },

  createFolder(
    accountId: number,
    bucket: string,
    prefix: string
  ): Promise<{ success: boolean; key: string }> {
    return axios
      .post(`${BASE}/folder/${accountId}/${encodeURIComponent(bucket)}`, {
        prefix,
      })
      .then((r) => r.data);
  },
};
