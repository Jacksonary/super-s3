use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// User-configurable transfer performance settings.
/// Stored in `~/.config/super-s3/transfer.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferConfig {
    /// How many files upload/download simultaneously. Range 1–10.
    #[serde(default = "default_concurrent_files")]
    pub concurrent_files: usize,
    /// Parallel Range GET connections for a single large file download. Range 1–20.
    #[serde(default = "default_download_connections")]
    pub download_connections: usize,
    /// Size (MB) of each Range GET chunk for large file downloads. Range 4–64.
    #[serde(default = "default_download_part_size")]
    pub download_part_size: u64,
    /// Concurrent multipart parts for a single large file upload. Range 1–16.
    #[serde(default = "default_upload_part_concurrency")]
    pub upload_part_concurrency: usize,
    /// Size (MB) of each multipart upload chunk. Range 8–64.
    #[serde(default = "default_upload_part_size")]
    pub upload_part_size: u64,
}

fn default_concurrent_files() -> usize { 5 }
fn default_download_connections() -> usize { 12 }
fn default_download_part_size() -> u64 { 8 }
fn default_upload_part_concurrency() -> usize { 4 }
fn default_upload_part_size() -> u64 { 16 }

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            concurrent_files: default_concurrent_files(),
            download_connections: default_download_connections(),
            download_part_size: default_download_part_size(),
            upload_part_concurrency: default_upload_part_concurrency(),
            upload_part_size: default_upload_part_size(),
        }
    }
}

/// YAML config entry — one S3-compatible account.
/// After migration, ak/sk are stored in OS keyring (keyed by id);
/// the YAML only holds the id and non-sensitive fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ak: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sk: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub buckets: Vec<String>,
}

fn default_region() -> String {
    "us-east-1".to_string()
}

/// Frontend-facing account summary (no credentials).
#[derive(Debug, Serialize)]
pub struct Account {
    pub id: usize,
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub buckets: Vec<String>,
}

/// A single object or folder entry in a listing.
#[derive(Debug, Serialize)]
pub struct ObjectItem {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub size: Option<i64>,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

/// Response for list_objects.
#[derive(Debug, Serialize)]
pub struct ListResult {
    pub prefix: String,
    pub delimiter: String,
    pub items: Vec<ObjectItem>,
    pub next_continuation_token: Option<String>,
    pub is_truncated: bool,
    pub key_count: i32,
}

/// Response for search_objects.
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub items: Vec<ObjectItem>,
    pub is_truncated: bool,
    pub next_continuation_token: Option<String>,
}

/// Response for delete_objects.
#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub deleted: i32,
    pub errors: Vec<DeleteError>,
}

#[derive(Debug, Serialize)]
pub struct DeleteError {
    #[serde(rename = "Key")]
    pub key: String,
    #[serde(rename = "Message")]
    pub message: String,
}

/// HEAD object metadata.
#[derive(Debug, Serialize)]
pub struct ObjectMeta {
    pub content_type: Option<String>,
    pub content_length: Option<i64>,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub expires: Option<String>,
    pub metadata: HashMap<String, String>,
}

/// Generic single-task transfer progress event payload (upload & download).
#[derive(Debug, Clone, Serialize)]
pub struct TaskProgress {
    pub task_id: String,
    pub progress: u8,
}

/// Expanded local path entry returned by expand_paths.
#[derive(Debug, Serialize)]
pub struct ExpandedEntry {
    pub local_path: String,
    pub relative_path: String,
}

/// Transfer history entry, persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "type")]
    pub entry_type: String,
    pub filename: String,
    pub key: String,
    pub bucket: String,
    pub account_name: String,
    pub size: Option<i64>,
    pub status: String,
    pub error: Option<String>,
    pub extra: Option<String>,
    pub timestamp: u64,
}

/// Batch download progress event payload.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub total: u32,
    pub completed: u32,
    pub failed: u32,
    pub current_key: String,
}

/// Event emitted when a transfer changes state (pause / resume / cancel / error).
#[derive(Debug, Clone, Serialize)]
pub struct TransferStateEvent {
    pub task_id: String,
    pub state: String,
}
