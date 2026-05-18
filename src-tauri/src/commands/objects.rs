use crate::s3client;
use crate::types::{DeleteError, DeleteResult, ListResult, ObjectItem, SearchResult};

/// Helper: list objects using V2 API for all providers.
async fn list_objects_compat(
    client: &aws_sdk_s3::Client,
    _endpoint: &str,
    bucket: &str,
    prefix: &str,
    delimiter: &str,
    max_keys: i32,
    continuation_token: Option<&str>,
) -> Result<ListCompatResult, String> {
    let mut req = client.list_objects_v2().bucket(bucket).prefix(prefix).max_keys(max_keys);
    if !delimiter.is_empty() {
        req = req.delimiter(delimiter);
    }
    if let Some(ct) = continuation_token {
        if !ct.is_empty() {
            req = req.continuation_token(ct);
        }
    }
    let resp = req.send().await.map_err(|e| format!("Failed to list objects: {e:?}"))?;

    Ok(ListCompatResult {
        contents: resp.contents().to_vec(),
        common_prefixes: resp.common_prefixes().to_vec(),
        next_continuation_token: resp.next_continuation_token().map(|s| s.to_string()),
        is_truncated: resp.is_truncated().unwrap_or(false),
        key_count: resp.key_count().unwrap_or(0),
    })
}

struct ListCompatResult {
    contents: Vec<aws_sdk_s3::types::Object>,
    common_prefixes: Vec<aws_sdk_s3::types::CommonPrefix>,
    next_continuation_token: Option<String>,
    is_truncated: bool,
    key_count: i32,
}

#[tauri::command]
pub async fn list_objects(
    account_idx: usize,
    bucket: String,
    prefix: Option<String>,
    delimiter: Option<String>,
    continuation_token: Option<String>,
    limit: Option<i32>,
) -> Result<ListResult, String> {
    let (client, endpoint) = s3client::get_client_with_endpoint(account_idx)?;
    let prefix = prefix.unwrap_or_default();
    let delimiter = delimiter.unwrap_or_else(|| "/".to_string());
    let limit = limit.unwrap_or(200);

    let resp = list_objects_compat(
        &client,
        &endpoint,
        &bucket,
        &prefix,
        &delimiter,
        limit,
        continuation_token.as_deref(),
    )
    .await?;

    let mut items: Vec<ObjectItem> = resp
        .common_prefixes
        .iter()
        .filter_map(|cp| {
            let key = cp.prefix()?.to_string();
            let name = key.strip_prefix(&prefix).unwrap_or(&key).to_string();
            Some(ObjectItem {
                key,
                name,
                item_type: "folder".to_string(),
                size: None,
                last_modified: None,
                etag: None,
                storage_class: None,
            })
        })
        .collect();

    for obj in &resp.contents {
        let key = obj.key().unwrap_or_default().to_string();
        if key == prefix {
            continue;
        }
        let name = key.strip_prefix(&prefix).unwrap_or(&key).to_string();
        items.push(ObjectItem {
            key,
            name,
            item_type: "file".to_string(),
            size: obj.size(),
            last_modified: obj.last_modified().map(|dt| {
                dt.fmt(aws_smithy_types::date_time::Format::DateTime)
                    .unwrap_or_default()
            }),
            etag: obj.e_tag().map(|s| s.trim_matches('"').to_string()),
            storage_class: obj.storage_class().map(|sc| sc.as_str().to_string()),
        });
    }

    Ok(ListResult {
        prefix,
        delimiter,
        items,
        next_continuation_token: resp.next_continuation_token,
        is_truncated: resp.is_truncated,
        key_count: resp.key_count,
    })
}

#[tauri::command]
pub async fn search_objects(
    account_idx: usize,
    bucket: String,
    q: String,
    prefix: Option<String>,
    limit: Option<i32>,
    continuation_token: Option<String>,
) -> Result<SearchResult, String> {
    let (client, endpoint) = s3client::get_client_with_endpoint(account_idx)?;
    let prefix = prefix.unwrap_or_default();
    let search_prefix = format!("{}{}", prefix, q);
    let limit = limit.unwrap_or(200);

    let resp = list_objects_compat(
        &client,
        &endpoint,
        &bucket,
        &search_prefix,
        "/",
        limit,
        continuation_token.as_deref(),
    )
    .await?;

    let mut items: Vec<ObjectItem> = resp
        .common_prefixes
        .iter()
        .filter_map(|cp| {
            let key = cp.prefix()?.to_string();
            let name = key.strip_prefix(&prefix).unwrap_or(&key).to_string();
            Some(ObjectItem {
                key,
                name,
                item_type: "folder".to_string(),
                size: None,
                last_modified: None,
                etag: None,
                storage_class: None,
            })
        })
        .collect();

    for obj in &resp.contents {
        let key = obj.key().unwrap_or_default().to_string();
        if key == search_prefix && key.ends_with('/') {
            continue;
        }
        let name = key.strip_prefix(&prefix).unwrap_or(&key).to_string();
        items.push(ObjectItem {
            key,
            name,
            item_type: "file".to_string(),
            size: obj.size(),
            last_modified: obj.last_modified().map(|dt| {
                dt.fmt(aws_smithy_types::date_time::Format::DateTime)
                    .unwrap_or_default()
            }),
            etag: obj.e_tag().map(|s| s.trim_matches('"').to_string()),
            storage_class: obj.storage_class().map(|sc| sc.as_str().to_string()),
        });
    }

    Ok(SearchResult {
        items,
        is_truncated: resp.is_truncated,
        next_continuation_token: resp.next_continuation_token,
    })
}

#[tauri::command]
pub async fn delete_objects(
    account_idx: usize,
    bucket: String,
    keys: Vec<String>,
) -> Result<DeleteResult, String> {
    if keys.is_empty() {
        return Ok(DeleteResult {
            deleted: 0,
            errors: vec![],
        });
    }

    let client = s3client::get_client(account_idx)?;

    let mut total_deleted = 0i32;
    let mut all_errors = vec![];

    for batch in keys.chunks(1000) {
        let objects: Vec<aws_sdk_s3::types::ObjectIdentifier> = batch
            .iter()
            .filter_map(|k| {
                aws_sdk_s3::types::ObjectIdentifier::builder()
                    .key(k)
                    .build()
                    .ok()
            })
            .collect();

        let delete = aws_sdk_s3::types::Delete::builder()
            .set_objects(Some(objects))
            .quiet(false)
            .build()
            .map_err(|e| format!("Failed to build delete request: {e}"))?;

        let resp = client
            .delete_objects()
            .bucket(&bucket)
            .delete(delete)
            .send()
            .await
            .map_err(|e| format!("Failed to delete objects: {e}"))?;

        let errs = resp.errors();
        total_deleted += (batch.len() - errs.len()) as i32;
        for err in errs {
            all_errors.push(DeleteError {
                key: err.key().unwrap_or_default().to_string(),
                message: err.message().unwrap_or_default().to_string(),
            });
        }
    }

    Ok(DeleteResult {
        deleted: total_deleted,
        errors: all_errors,
    })
}


#[tauri::command]
pub async fn create_folder(
    account_idx: usize,
    bucket: String,
    prefix: String,
) -> Result<serde_json::Value, String> {
    let folder_key = format!("{}/", prefix.trim_end_matches('/'));
    let client = s3client::get_client(account_idx)?;

    client
        .put_object()
        .bucket(&bucket)
        .key(&folder_key)
        .body(aws_sdk_s3::primitives::ByteStream::from_static(b""))
        .send()
        .await
        .map_err(|e| format!("Failed to create folder: {e}"))?;

    Ok(serde_json::json!({ "success": true, "key": folder_key }))
}

#[tauri::command]
pub async fn rename_object(
    account_idx: usize,
    bucket: String,
    src_key: String,
    dst_key: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;

    client
        .copy_object()
        .bucket(&bucket)
        .key(&dst_key)
        .copy_source(format!(
            "{}/{}",
            bucket,
            urlencoding::encode(&src_key)
        ))
        .send()
        .await
        .map_err(|e| format!("Failed to copy object: {e}"))?;

    client
        .delete_object()
        .bucket(&bucket)
        .key(&src_key)
        .send()
        .await
        .map_err(|e| format!("Failed to delete old object: {e}"))?;

    Ok(serde_json::json!({ "success": true, "src": src_key, "dst": dst_key }))
}
