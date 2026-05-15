use crate::types::{AccountConfig, HistoryEntry, TransferConfig};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region, SharedCredentialsProvider};
use aws_smithy_types::checksum_config::{RequestChecksumCalculation, ResponseChecksumValidation};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// ─── Config file lock (serializes load_config / save_config) ─────────────────

static CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn config_lock() -> &'static Mutex<()> {
    CONFIG_LOCK.get_or_init(|| Mutex::new(()))
}

// ─── Keyring helpers ─────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "super-s3";

fn kr_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring: {e}"))
}

fn keyring_store(uuid: &str, ak: &str, sk: &str) -> Result<(), String> {
    kr_entry(&format!("{uuid}:ak"))?.set_password(ak).map_err(|e| format!("keyring store: {e}"))?;
    kr_entry(&format!("{uuid}:sk"))?.set_password(sk).map_err(|e| format!("keyring store: {e}"))?;
    Ok(())
}

fn keyring_load(uuid: &str) -> Result<(String, String), String> {
    let ak = kr_entry(&format!("{uuid}:ak"))?.get_password().map_err(|e| format!("keyring load: {e}"))?;
    let sk = kr_entry(&format!("{uuid}:sk"))?.get_password().map_err(|e| format!("keyring load: {e}"))?;
    Ok((ak, sk))
}

pub fn keyring_delete(uuid: &str) {
    if let Ok(e) = kr_entry(&format!("{uuid}:ak")) { let _ = e.delete_credential(); }
    if let Ok(e) = kr_entry(&format!("{uuid}:sk")) { let _ = e.delete_credential(); }
}

fn ensure_id(account: &mut AccountConfig) {
    if account.id.is_none() {
        account.id = Some(uuid::Uuid::new_v4().to_string());
    }
}

// ─── Client cache ────────────────────────────────────────────────────────────
//
// Each unique (endpoint, ak, region) combination gets one Client that lives for
// the process lifetime.  Cloning an aws_sdk_s3::Client is cheap (Arc clone) and
// all clones share the same underlying HTTP connection pool, so concurrent
// requests from the same account reuse established TCP connections.
//
// The cache key is account_idx.  If the user edits credentials the app restarts,
// so stale entries are not a concern.

static CLIENT_CACHE: OnceLock<Mutex<HashMap<usize, aws_sdk_s3::Client>>> = OnceLock::new();

fn client_cache() -> &'static Mutex<HashMap<usize, aws_sdk_s3::Client>> {
    CLIENT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Detect cloud provider name from endpoint URL.
pub fn provider_name(endpoint: &str) -> String {
    if endpoint.is_empty() {
        return "AWS S3".to_string();
    }
    let ep = endpoint.to_lowercase();
    if ep.contains("myhuaweicloud") {
        "华为云 OBS".to_string()
    } else if ep.contains("aliyuncs") {
        "阿里云 OSS".to_string()
    } else if ep.contains("volcengineapi") || ep.contains("volces.com") || ep.contains("tos-") {
        "火山云 TOS".to_string()
    } else if ep.contains("bcebos") {
        "百度云 BOS".to_string()
    } else if ep.contains("qiniucs") || ep.contains("qbox") {
        "七牛云 Kodo".to_string()
    } else if ep.contains("amazonaws") {
        "AWS S3".to_string()
    } else if ep.contains("tencentcos") || ep.contains("myqcloud") {
        "腾讯云 COS".to_string()
    } else {
        // Extract hostname
        endpoint
            .split("//")
            .last()
            .unwrap_or(endpoint)
            .split('/')
            .next()
            .unwrap_or(endpoint)
            .to_string()
    }
}

/// Build an S3 client for the given account config.
///
/// Callers should prefer `get_client()` which caches the result so that
/// all requests for the same account share a single HTTP connection pool.
pub fn make_client(account: &AccountConfig) -> aws_sdk_s3::Client {
    let ep = account.endpoint.to_lowercase();
    let is_tos =
        ep.contains("volces.com") || ep.contains("volcengineapi") || ep.contains("tos-s3");
    let force_path_style = !is_tos;

    let creds = Credentials::new(&account.ak, &account.sk, None, None, "super-s3-static");
    let region = Region::new(account.region.clone());

    let mut builder = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .credentials_provider(SharedCredentialsProvider::new(creds))
        .region(region)
        .force_path_style(force_path_style)
        .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
        .response_checksum_validation(ResponseChecksumValidation::WhenRequired);

    if !account.endpoint.is_empty() {
        builder = builder.endpoint_url(&account.endpoint);
    }

    aws_sdk_s3::Client::from_conf(builder.build())
}

/// Platform-specific config directory for Super S3.
pub fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("super-s3").join("config.yaml")
}

/// Read raw YAML into Vec<AccountConfig> without keyring enrichment.
fn read_yaml() -> Result<Vec<AccountConfig>, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    let value: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse config: {e}"))?;
    match value {
        serde_yaml::Value::Sequence(_) => {
            serde_yaml::from_value(value).map_err(|e| format!("Failed to parse config: {e}"))
        }
        serde_yaml::Value::Mapping(_) => {
            let single: AccountConfig = serde_yaml::from_value(value)
                .map_err(|e| format!("Failed to parse config: {e}"))?;
            Ok(vec![single])
        }
        _ => Ok(vec![]),
    }
}

/// Read existing account IDs from YAML without triggering migration.
pub fn read_yaml_ids() -> Vec<String> {
    read_yaml()
        .unwrap_or_default()
        .iter()
        .filter_map(|a| a.id.clone())
        .collect()
}

/// Write Vec<AccountConfig> to YAML.
/// Credentials are stripped only for accounts where `keyring_ok[i]` is true.
fn write_yaml(accounts: &[AccountConfig], keyring_ok: &[bool]) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let safe: Vec<AccountConfig> = accounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            if keyring_ok.get(i).copied().unwrap_or(false) {
                AccountConfig { ak: String::new(), sk: String::new(), ..a.clone() }
            } else {
                a.clone()
            }
        })
        .collect();
    let yaml =
        serde_yaml::to_string(&safe).map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, yaml).map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(())
}

/// Load config from YAML + keyring. Handles migration from plaintext.
pub fn load_config() -> Result<Vec<AccountConfig>, String> {
    let _guard = config_lock().lock().unwrap();
    let mut accounts = read_yaml()?;
    let mut needs_save = false;
    let mut keyring_ok = vec![false; accounts.len()];

    for (i, acct) in accounts.iter_mut().enumerate() {
        if acct.id.is_none() {
            ensure_id(acct);
            needs_save = true;
        }
        let uuid = acct.id.as_ref().unwrap();

        if !acct.ak.is_empty() && !acct.sk.is_empty() {
            // Plaintext credentials in YAML → migrate to keyring
            if keyring_store(uuid, &acct.ak, &acct.sk).is_ok() {
                keyring_ok[i] = true;
                needs_save = true;
            }
            // ak/sk stay in memory regardless for this session
        } else if let Ok((ak, sk)) = keyring_load(uuid) {
            acct.ak = ak;
            acct.sk = sk;
        }
    }

    if needs_save {
        write_yaml(&accounts, &keyring_ok)?;
    }

    Ok(accounts)
}

/// Save config: store credentials in keyring, write YAML without secrets.
/// If keyring is unavailable for an account, its credentials stay in YAML as fallback.
pub fn save_config(accounts: &[AccountConfig]) -> Result<(), String> {
    let _guard = config_lock().lock().unwrap();
    let mut accounts = accounts.to_vec();
    let mut keyring_ok = vec![false; accounts.len()];
    for (i, acct) in accounts.iter_mut().enumerate() {
        ensure_id(acct);
        let uuid = acct.id.as_ref().unwrap();
        if !acct.ak.is_empty() && !acct.sk.is_empty() {
            keyring_ok[i] = keyring_store(uuid, &acct.ak, &acct.sk).is_ok();
        }
    }
    write_yaml(&accounts, &keyring_ok)
}

/// Check if the endpoint is Qiniu Kodo (needs V1 list fallback).
pub fn is_qiniu(endpoint: &str) -> bool {
    let ep = endpoint.to_lowercase();
    ep.contains("qiniucs") || ep.contains("qbox")
}

fn transfer_config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("super-s3").join("transfer.json")
}

/// Load transfer performance settings. Returns defaults if the file doesn't exist.
pub fn load_transfer_config() -> TransferConfig {
    let path = transfer_config_path();
    if !path.exists() {
        return TransferConfig::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persist transfer performance settings.
pub fn save_transfer_config(cfg: &TransferConfig) -> Result<(), String> {
    let path = transfer_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Failed to serialize transfer config: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write transfer config: {e}"))?;
    Ok(())
}

// ─── Transfer history ────────────────────────────────────────────────────────

const HISTORY_MAX: usize = 500;

fn history_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("super-s3").join("history.json")
}

pub fn load_history() -> Vec<HistoryEntry> {
    let path = history_path();
    if !path.exists() {
        return vec![];
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

static HISTORY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn history_lock() -> &'static Mutex<()> {
    HISTORY_LOCK.get_or_init(|| Mutex::new(()))
}

pub fn append_history(new_entries: Vec<HistoryEntry>) -> Result<(), String> {
    if new_entries.is_empty() { return Ok(()); }
    let _guard = history_lock().lock().unwrap();
    let mut entries = load_history();
    entries.extend(new_entries);
    if entries.len() > HISTORY_MAX {
        entries.drain(..entries.len() - HISTORY_MAX);
    }
    let path = history_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create history dir: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string(&entries)
        .map_err(|e| format!("Failed to serialize history: {e}"))?;
    std::fs::write(&tmp, &json)
        .map_err(|e| format!("Failed to write history: {e}"))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to rename history: {e}"))?;
    Ok(())
}

pub fn clear_history() -> Result<(), String> {
    let _guard = history_lock().lock().unwrap();
    let path = history_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to clear history: {e}"))?;
    }
    Ok(())
}

/// Get account config by index.
pub fn get_account(account_idx: usize) -> Result<AccountConfig, String> {
    let accounts = load_config()?;
    accounts
        .into_iter()
        .nth(account_idx)
        .ok_or_else(|| "Account not found".to_string())
}

/// Get client for account by index.
///
/// The client is cached for the process lifetime so that all calls for the
/// same account share one HTTP connection pool — TCP connections are kept alive
/// and reused across requests, which is especially important for concurrent
/// multipart uploads and parallel range downloads.
pub fn get_client(account_idx: usize) -> Result<aws_sdk_s3::Client, String> {
    {
        let cache = client_cache().lock().unwrap();
        if let Some(client) = cache.get(&account_idx) {
            return Ok(client.clone());
        }
    }
    // Not yet cached — build and insert.
    let account = get_account(account_idx)?;
    let client = make_client(&account);
    client_cache()
        .lock()
        .unwrap()
        .insert(account_idx, client.clone());
    Ok(client)
}

/// Evict all cached clients.  Call after the user saves new credentials so
/// the next request picks up fresh keys instead of using stale ones.
pub fn invalidate_client_cache() {
    client_cache().lock().unwrap().clear();
}

/// Get client together with the endpoint string.
pub fn get_client_with_endpoint(account_idx: usize) -> Result<(aws_sdk_s3::Client, String), String> {
    let account = get_account(account_idx)?;
    let endpoint = account.endpoint.clone();
    Ok((get_client(account_idx)?, endpoint))
}
