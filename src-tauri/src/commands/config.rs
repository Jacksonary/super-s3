use crate::s3client;
use crate::types::AccountConfig;

#[tauri::command]
pub fn get_config() -> Result<Vec<AccountConfig>, String> {
    s3client::load_config()
}

#[tauri::command]
pub fn put_config(accounts: Vec<AccountConfig>) -> Result<serde_json::Value, String> {
    // Collect old account ids before saving so we can detect deletions.
    // Use read_yaml (not load_config) to avoid triggering migration side effects.
    let old_ids: Vec<String> = s3client::read_yaml_ids();

    s3client::save_config(&accounts)?;

    // Clean up keyring entries for deleted accounts.
    // Re-read saved IDs (which now include newly-assigned UUIDs for added accounts).
    let new_ids: std::collections::HashSet<String> = s3client::read_yaml_ids().into_iter().collect();
    for old_id in &old_ids {
        if !new_ids.contains(old_id) {
            s3client::keyring_delete(old_id);
        }
    }

    s3client::invalidate_client_cache();
    Ok(serde_json::json!({ "ok": true }))
}
