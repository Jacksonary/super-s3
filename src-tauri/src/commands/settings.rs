use crate::s3client;
use crate::types::TransferConfig;

#[tauri::command]
pub fn get_transfer_config() -> TransferConfig {
    s3client::load_transfer_config()
}

#[tauri::command]
pub fn put_transfer_config(config: TransferConfig) -> Result<serde_json::Value, String> {
    // Clamp values to safe ranges before persisting.
    let safe = TransferConfig {
        concurrent_files: config.concurrent_files.clamp(1, 10),
        download_connections: config.download_connections.clamp(1, 20),
        download_part_size: config.download_part_size.clamp(4, 64),
        upload_part_concurrency: config.upload_part_concurrency.clamp(1, 16),
        upload_part_size: config.upload_part_size.clamp(8, 64),
    };
    s3client::save_transfer_config(&safe)?;
    Ok(serde_json::json!({ "ok": true }))
}
