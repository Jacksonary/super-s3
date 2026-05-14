use crate::s3client;

/// Check if an S3 API error indicates the feature is simply not configured
/// (as opposed to the API being unsupported or a real error).
fn is_not_configured(err: &str) -> bool {
    err.contains("NoSuch")
        || err.contains("NotImplemented")
        || err.contains("MethodNotAllowed")
        || err.contains("ServerSideEncryptionConfigurationNotFound")
}

/// Wrap an S3 API error into a successful JSON response with an `_error` field.
/// - "Not configured" errors → return default data, no _error
/// - Other errors → return default data + `_error` with the actual message for debugging
fn soft_err(e: impl std::fmt::Display, default: serde_json::Value) -> Result<serde_json::Value, String> {
    let err_str = format!("{e}");
    if is_not_configured(&err_str) {
        return Ok(default);
    }
    let mut val = default;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("_error".to_string(), serde_json::json!(err_str));
    }
    Ok(val)
}

#[tauri::command]
pub async fn get_bucket_location(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_location()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let location = output
                .location_constraint()
                .map(|l| l.as_str().to_string())
                .unwrap_or_default();
            let location = if location.is_empty() { "us-east-1".to_string() } else { location };
            Ok(serde_json::json!({ "location": location }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "location": null }))
    }
}

#[tauri::command]
pub async fn get_bucket_acl(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_acl()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let owner = output
                .owner()
                .and_then(|o| o.display_name())
                .unwrap_or_default()
                .to_string();

            let grants: Vec<serde_json::Value> = output
                .grants()
                .iter()
                .map(|g| {
                    let grantee = g
                        .grantee()
                        .map(|gt| {
                            if let Some(uri) = gt.uri() {
                                uri.to_string()
                            } else if let Some(id) = gt.id() {
                                id.to_string()
                            } else {
                                gt.display_name().unwrap_or_default().to_string()
                            }
                        })
                        .unwrap_or_default();
                    let permission = g
                        .permission()
                        .map(|p| p.as_str().to_string())
                        .unwrap_or_default();
                    serde_json::json!({ "grantee": grantee, "permission": permission })
                })
                .collect();

            Ok(serde_json::json!({ "owner": owner, "grants": grants }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "owner": null, "grants": [] }))
    }
}

#[tauri::command]
pub async fn get_bucket_versioning(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_versioning()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let status = output.status().map(|s| s.as_str().to_string());
            let mfa_delete = output.mfa_delete().map(|m| m.as_str().to_string());
            Ok(serde_json::json!({ "status": status, "mfa_delete": mfa_delete }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "status": null, "mfa_delete": null }))
    }
}

#[tauri::command]
pub async fn get_bucket_encryption(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_encryption()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let rules: Vec<serde_json::Value> = output
                .server_side_encryption_configuration()
                .map(|cfg| {
                    cfg.rules()
                        .iter()
                        .map(|r| {
                            let default = r.apply_server_side_encryption_by_default();
                            let algorithm = default
                                .map(|d| d.sse_algorithm().as_str().to_string())
                                .unwrap_or_default();
                            let kms_key_id = default
                                .and_then(|d| d.kms_master_key_id())
                                .map(|s| s.to_string());
                            serde_json::json!({
                                "algorithm": algorithm,
                                "kms_key_id": kms_key_id,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(serde_json::json!({ "rules": rules }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "rules": [] }))
    }
}

#[tauri::command]
pub async fn get_bucket_lifecycle(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_lifecycle_configuration()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let rules: Vec<serde_json::Value> = output
                .rules()
                .iter()
                .map(|r| {
                    let id = r.id().map(|s| s.to_string());
                    let status = r.status().as_str().to_string();
                    let prefix = r
                        .filter()
                        .and_then(|f| f.prefix().map(|s| s.to_string()))
                        .or_else(|| {
                            #[allow(deprecated)]
                            r.prefix().map(|s| s.to_string())
                        });

                    let transitions: Vec<serde_json::Value> = r
                        .transitions()
                        .iter()
                        .map(|t| {
                            serde_json::json!({
                                "days": t.days(),
                                "storage_class": t.storage_class().map(|s| s.as_str()),
                            })
                        })
                        .collect();

                    let expiration = r.expiration().map(|exp| {
                        serde_json::json!({
                            "days": exp.days(),
                            "expired_object_delete_marker": exp.expired_object_delete_marker(),
                        })
                    });

                    let noncurrent_transitions: Vec<serde_json::Value> = r
                        .noncurrent_version_transitions()
                        .iter()
                        .map(|t| {
                            serde_json::json!({
                                "days": t.noncurrent_days(),
                                "storage_class": t.storage_class().map(|s| s.as_str()),
                            })
                        })
                        .collect();

                    let noncurrent_expiration_days = r
                        .noncurrent_version_expiration()
                        .map(|e| e.noncurrent_days());

                    serde_json::json!({
                        "id": id,
                        "status": status,
                        "prefix": prefix,
                        "transitions": transitions,
                        "expiration": expiration,
                        "noncurrent_transitions": noncurrent_transitions,
                        "noncurrent_expiration_days": noncurrent_expiration_days,
                    })
                })
                .collect();
            Ok(serde_json::json!({ "rules": rules }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "rules": [] }))
    }
}

#[tauri::command]
pub async fn get_bucket_cors(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_cors()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let rules: Vec<serde_json::Value> = output
                .cors_rules()
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "allowed_origins": r.allowed_origins(),
                        "allowed_methods": r.allowed_methods(),
                        "allowed_headers": r.allowed_headers(),
                        "expose_headers": r.expose_headers(),
                        "max_age_seconds": r.max_age_seconds(),
                    })
                })
                .collect();
            Ok(serde_json::json!({ "rules": rules }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "rules": [] }))
    }
}

#[tauri::command]
pub async fn get_bucket_tags(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_tagging()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let tags: Vec<serde_json::Value> = output
                .tag_set()
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "key": t.key(),
                        "value": t.value(),
                    })
                })
                .collect();
            Ok(serde_json::json!({ "tags": tags }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "tags": [] }))
    }
}

#[tauri::command]
pub async fn get_bucket_logging(
    account_idx: usize,
    bucket: String,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let resp = client
        .get_bucket_logging()
        .bucket(&bucket)
        .send()
        .await;

    match resp {
        Ok(output) => {
            let (target_bucket, target_prefix) = output
                .logging_enabled()
                .map(|le| {
                    (
                        Some(le.target_bucket().to_string()),
                        Some(le.target_prefix().to_string()),
                    )
                })
                .unwrap_or((None, None));

            Ok(serde_json::json!({
                "target_bucket": target_bucket,
                "target_prefix": target_prefix,
            }))
        }
        Err(e) => soft_err(e, serde_json::json!({ "target_bucket": null, "target_prefix": null }))
    }
}
