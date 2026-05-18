use crate::s3client;
use crate::types::ObjectMeta;
use regex::Regex;
use std::collections::HashMap;

#[tauri::command]
pub async fn object_meta(
    account_idx: usize,
    bucket: String,
    key: String,
) -> Result<ObjectMeta, String> {
    let client = s3client::get_client(account_idx)?;

    let resp = client
        .head_object()
        .bucket(&bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| format!("Failed to get metadata: {e}"))?;

    // Parse lifecycle expiration (AWS S3 x-amz-expiration header)
    let expiration_str = resp.expiration().unwrap_or_default();
    let expire_iso = parse_expiration(expiration_str);

    let metadata = resp
        .metadata()
        .cloned()
        .unwrap_or_else(HashMap::new);

    Ok(ObjectMeta {
        content_type: resp.content_type().map(|s| s.to_string()),
        content_length: resp.content_length(),
        last_modified: resp.last_modified().map(|dt| {
            dt.fmt(aws_smithy_types::date_time::Format::DateTime)
                .unwrap_or_default()
        }),
        etag: resp.e_tag().map(|s| s.trim_matches('"').to_string()),
        expires: expire_iso,
        metadata,
    })
}

/// Parse expiration string from x-amz-expiration header.
/// Format: `expiry-date="Fri, 25 Apr 2025 00:00:00 GMT", rule-id="..."`
fn parse_expiration(s: &str) -> Option<String> {
    if s.is_empty() {
        return None;
    }
    let re = Regex::new(r#"expiry-date="([^"]+)""#).ok()?;
    let caps = re.captures(s)?;
    let date_str = caps.get(1)?.as_str();
    // Try to parse as RFC 2822
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(date_str) {
        Some(dt.to_rfc3339())
    } else {
        // Return as-is if parsing fails
        Some(date_str.to_string())
    }
}

#[tauri::command]
pub async fn preview_object(
    account_idx: usize,
    bucket: String,
    key: String,
    max_bytes: Option<i64>,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let max_bytes = max_bytes.unwrap_or(5 * 1024 * 1024);

    let resp = client
        .get_object()
        .bucket(&bucket)
        .key(&key)
        .range(format!("bytes=0-{}", max_bytes - 1))
        .send()
        .await
        .map_err(|e| format!("Failed to get object: {e}"))?;

    let body = resp
        .body
        .collect()
        .await
        .map_err(|e| format!("Failed to read body: {e}"))?;

    let bytes = body.into_bytes();

    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(serde_json::json!({ "text": s, "binary": false })),
        Err(_) => Ok(serde_json::json!({ "text": null, "binary": true })),
    }
}

#[tauri::command]
pub async fn update_text(
    account_idx: usize,
    bucket: String,
    key: String,
    text: String,
    content_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let ct = content_type.unwrap_or_else(|| "text/plain; charset=utf-8".to_string());
    let data = text.into_bytes();

    client
        .put_object()
        .bucket(&bucket)
        .key(&key)
        .body(aws_sdk_s3::primitives::ByteStream::from(data))
        .content_type(&ct)
        .send()
        .await
        .map_err(|e| format!("Failed to update text: {e}"))?;

    Ok(serde_json::json!({ "ok": true }))
}
