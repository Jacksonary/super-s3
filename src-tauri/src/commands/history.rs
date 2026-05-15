use crate::s3client;
use crate::types::HistoryEntry;

#[tauri::command]
pub fn get_history() -> Vec<HistoryEntry> {
    s3client::load_history()
}

#[tauri::command]
pub fn append_history_entry(entries: Vec<HistoryEntry>) -> Result<serde_json::Value, String> {
    s3client::append_history(entries)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn clear_history() -> Result<serde_json::Value, String> {
    s3client::clear_history()?;
    Ok(serde_json::json!({ "ok": true }))
}
