use crate::s3client;
use crate::task_registry;
use crate::types::{DownloadProgress, ExpandedEntry, TaskProgress, TransferStateEvent};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

fn emit_progress(app: &tauri::AppHandle, event: &str, task_id: &Option<String>, progress: u8) {
    if let Some(tid) = task_id {
        let _ = app.emit(event, TaskProgress { task_id: tid.clone(), progress });
    }
}

/// Returns a temp path alongside `dest` that won't clobber the original extension.
/// e.g. `photo.jpg` → `photo.jpg.a3f1b2c0.part`
fn tmp_path_for(dest: &std::path::Path) -> std::path::PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let fname = dest
        .file_name()
        .map(|n| format!("{}.{nanos:016x}.part", n.to_string_lossy()))
        .unwrap_or_else(|| format!("download.{nanos:016x}.part"));
    dest.parent().unwrap_or(dest).join(fname)
}

/// Returns a deterministic partial file path for resumable downloads.
/// e.g. `photo.jpg` → `photo.jpg.part`
fn resumable_part_path(dest: &std::path::Path) -> std::path::PathBuf {
    let fname = dest
        .file_name()
        .map(|n| format!("{}.part", n.to_string_lossy()))
        .unwrap_or_else(|| "download.part".to_string());
    dest.parent().unwrap_or(dest).join(fname)
}

/// Validate that `relative` (an S3 key suffix) does not escape `base` via `..` or absolute paths.
fn safe_dest(base: &std::path::Path, relative: &str) -> Option<std::path::PathBuf> {
    if relative.starts_with('/') || relative.starts_with('\\') {
        return None;
    }
    let dest = base.join(relative);
    // Lexically normalise both paths and confirm dest is a child of base.
    let norm_dest = normalise_path(&dest);
    let norm_base = normalise_path(base);
    if norm_dest.starts_with(&norm_base) { Some(dest) } else { None }
}

fn normalise_path(path: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for c in path.components() {
        match c {
            std::path::Component::ParentDir => { out.pop(); }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

#[tauri::command]
pub async fn download_object(
    app: tauri::AppHandle,
    account_idx: usize,
    bucket: String,
    key: String,
    save_path: String,
    task_id: Option<String>,
    connections: Option<usize>,
    part_size_mb: Option<u64>,
    multipart_threshold_mb: Option<u64>,
) -> Result<serde_json::Value, String> {
    // TaskGuard registers in the registry (only when task_id is Some) and
    // deregisters on drop — guaranteed on any exit path (Ok, Err, panic).
    let guard = task_registry::register_task(task_id.clone());

    let save = std::path::Path::new(&save_path);
    // Use deterministic .part path so resume can find it on retry.
    let tmp_path = resumable_part_path(save);

    let result = download_inner(
        &app, account_idx, &bucket, &key, &tmp_path, &task_id,
        connections, part_size_mb, multipart_threshold_mb,
        &guard.cancel_token, &guard.pause_rx,
    )
    .await;

    let is_cancelled = result.as_ref().err().map_or(false, |e| e.contains("Transfer cancelled"));

    match result {
        Ok(()) => {
            tokio::fs::rename(&tmp_path, save)
                .await
                .map_err(|e| format!("Failed to finalise download: {e}"))?;
            Ok(serde_json::json!({ "success": true }))
        }
        Err(e) => {
            // Keep .part file on error so retry can resume from where it left off.
            // Only delete on cancellation (user explicitly gave up).
            if is_cancelled {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                let _ = app.emit("transfer-state", TransferStateEvent {
                    task_id: task_id.clone().unwrap_or_default(),
                    state: "cancelled".to_string(),
                });
            }
            Err(e)
        }
    }
    // `guard` is dropped here → deregisters automatically.
}

async fn download_inner(
    app: &tauri::AppHandle,
    account_idx: usize,
    bucket: &str,
    key: &str,
    tmp_path: &std::path::Path,
    task_id: &Option<String>,
    connections: Option<usize>,
    part_size_mb: Option<u64>,
    multipart_threshold_mb: Option<u64>,
    cancel_token: &tokio_util::sync::CancellationToken,
    pause_rx: &tokio::sync::watch::Receiver<bool>,
) -> Result<(), String> {
    let client = s3client::get_client(account_idx)?;

    const DEFAULT_PART_SIZE_MB: u64 = 8;
    const MAX_CONCURRENT_RANGES: usize = 12;
    const DEFAULT_MULTIPART_THRESHOLD: u64 = 16;

    let range_part_size = part_size_mb
        .map(|s| s.clamp(4, 64) * 1024 * 1024)
        .unwrap_or(DEFAULT_PART_SIZE_MB * 1024 * 1024);
    let max_concurrent = connections
        .map(|c| c.clamp(1, 20))
        .unwrap_or(MAX_CONCURRENT_RANGES);
    let threshold = multipart_threshold_mb
        .map(|t| t.clamp(8, 32) * 1024 * 1024)
        .unwrap_or(DEFAULT_MULTIPART_THRESHOLD * 1024 * 1024);

    // Probe the object size with a lightweight HEAD request so that for large
    // files we never have to open a full GET connection only to discard the body.
    let head = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| format!("Failed to stat object: {e}"))?;
    let total = head.content_length().unwrap_or(0) as u64;

    if total >= threshold {

        // Pre-allocate the file to avoid fragmentation and allow offset writes.
        let file = tokio::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(tmp_path)
            .await
            .map_err(|e| format!("Failed to create file: {e}"))?;
        file.set_len(total)
            .await
            .map_err(|e| format!("Failed to pre-allocate file: {e}"))?;
        let file = Arc::new(tokio::sync::Mutex::new(file));

        let num_parts = total.div_ceil(range_part_size);
        let mut join_set: JoinSet<Result<(), String>> = JoinSet::new();
        let mut completed_ranges: u64 = 0;

        emit_progress(app, "download-single-progress", task_id, 0);

        for part_idx in 0..num_parts {
            // Backpressure: drain one completed range before spawning more.
            // Use select! so cancel/pause is detected immediately even while
            // waiting for in-flight parts to complete.
            while join_set.len() >= max_concurrent {
                tokio::select! {
                    _ = cancel_token.cancelled() => {
                        join_set.abort_all();
                        return Err("Transfer cancelled".to_string());
                    }
                    _ = task_registry::wait_if_paused(pause_rx) => {}
                    result = join_set.join_next() => {
                        match result {
                            Some(Ok(Ok(()))) => {
                                completed_ranges += 1;
                                let pct = ((completed_ranges * 100) / num_parts).min(99) as u8;
                                emit_progress(app, "download-single-progress", task_id, pct);
                            }
                            Some(Ok(Err(e))) => {
                                join_set.abort_all();
                                return Err(e);
                            }
                            Some(Err(e)) => {
                                join_set.abort_all();
                                return Err(format!("Download task panicked: {e}"));
                            }
                            None => break,
                        }
                    }
                }
            }

            let start = part_idx * range_part_size;
            let end = (start + range_part_size - 1).min(total - 1);

            // Check for cancellation or pause before spawning the next range.
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    join_set.abort_all();
                    return Err("Transfer cancelled".to_string());
                }
                _ = task_registry::wait_if_paused(pause_rx) => {}
            }

            let range_str = format!("bytes={start}-{end}");

            let cl = client.clone();
            let bkt = bucket.to_owned();
            let ky = key.to_owned();
            let file = Arc::clone(&file);

            join_set.spawn(async move {
                let r = cl
                    .get_object()
                    .bucket(&bkt)
                    .key(&ky)
                    .range(range_str)
                    .send()
                    .await
                    .map_err(|e| format!("Range {start}: {e}"))?;
                let bytes = r
                    .body
                    .collect()
                    .await
                    .map_err(|e| format!("Range {start} read: {e}"))?
                    .into_bytes();

                let mut f = file.lock().await;
                f.seek(std::io::SeekFrom::Start(start))
                    .await
                    .map_err(|e| format!("Seek {start}: {e}"))?;
                f.write_all(&bytes)
                    .await
                    .map_err(|e| format!("Write {start}: {e}"))?;
                Ok(())
            });
        }

        // Drain remaining.
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(())) => {
                    completed_ranges += 1;
                    let pct = ((completed_ranges * 100) / num_parts).min(99) as u8;
                    emit_progress(app, "download-single-progress", task_id, pct);
                }
                Ok(Err(e)) => {
                    join_set.abort_all();
                    return Err(e);
                }
                Err(e) => {
                    join_set.abort_all();
                    return Err(format!("Download task panicked: {e}"));
                }
            }
        }

        let mut f = Arc::try_unwrap(file)
            .map_err(|_| "File Arc still has multiple owners".to_string())?
            .into_inner();
        f.flush()
            .await
            .map_err(|e| format!("Failed to flush file: {e}"))?;
    } else {
        // Small/medium file: single streaming GET.
        let resp = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| format!("Failed to download object: {e}"))?;
        let mut body = resp.body;
        let mut file = tokio::fs::File::create(tmp_path)
            .await
            .map_err(|e| format!("Failed to create file: {e}"))?;

        emit_progress(app, "download-single-progress", task_id, 0);
        let mut received: u64 = 0;
        let mut last_pct: u8 = 0;

        loop {
            // Check for cancellation or pause before processing next chunk.
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    return Err("Transfer cancelled".to_string());
                }
                _ = task_registry::wait_if_paused(pause_rx) => {}
            }
            let Some(chunk) = body.next().await else { break; };
            let bytes = chunk.map_err(|e| format!("Failed to read body: {e}"))?;
            file.write_all(&bytes)
                .await
                .map_err(|e| format!("Failed to write file: {e}"))?;
            received += bytes.len() as u64;
            if total > 0 {
                let pct = (((received as u128 * 100) / total as u128).min(99)) as u8;
                if pct > last_pct {
                    last_pct = pct;
                    emit_progress(app, "download-single-progress", task_id, pct);
                }
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Failed to flush file: {e}"))?;
    }

    emit_progress(app, "download-single-progress", task_id, 100);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn upload_object(
    app: tauri::AppHandle,
    account_idx: usize,
    bucket: String,
    key: String,
    file_path: String,
    content_type: Option<String>,
    task_id: Option<String>,
    part_concurrency: Option<usize>,
    part_size_mb: Option<u64>,
    multipart_threshold_mb: Option<u64>,
) -> Result<serde_json::Value, String> {
    // TaskGuard registers in the registry (only when task_id is Some) and
    // deregisters on drop — guaranteed on any exit path (Ok, Err, panic).
    let guard = task_registry::register_task(task_id.clone());

    let client = s3client::get_client(account_idx)?;
    let ct = content_type.unwrap_or_else(|| "application/octet-stream".to_string());

    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| format!("Failed to stat file: {e}"))?;
    let size = metadata.len();
    let content_len = i64::try_from(size).map_err(|_| "File too large (>9.2 EB)".to_string())?;

    emit_progress(&app, "upload-progress", &task_id, 0);

    const DEFAULT_PART_SIZE_MB: u64 = 16;
    const MAX_CONCURRENT_PARTS: usize = 4;
    const DEFAULT_MULTIPART_THRESHOLD: u64 = 16;

    let threshold = multipart_threshold_mb
        .map(|t| t.clamp(8, 32) * 1024 * 1024)
        .unwrap_or(DEFAULT_MULTIPART_THRESHOLD * 1024 * 1024) as usize;
    let part_size = part_size_mb
        .map(|s| s.clamp(8, 64) * 1024 * 1024)
        .unwrap_or(DEFAULT_PART_SIZE_MB * 1024 * 1024) as usize;
    let max_parts = part_concurrency
        .map(|c| c.clamp(1, 16))
        .unwrap_or(MAX_CONCURRENT_PARTS);

    if (size as usize) < threshold {
        // Small/medium file: single PUT, no multipart overhead.
        let data = tokio::fs::read(&file_path)
            .await
            .map_err(|e| format!("Failed to read file: {e}"))?;
        tokio::select! {
            result = client
                .put_object()
                .bucket(&bucket)
                .key(&key)
                .body(ByteStream::from(data))
                .content_length(content_len)
                .content_type(&ct)
                .send() => {
                result.map_err(|e| format!("Failed to upload: {e}"))?;
            }
            _ = guard.cancel_token.cancelled() => {
                return Err("Transfer cancelled".to_string());
            }
        }
    } else {
        // Large file: multipart upload with concurrent part uploads.
        let upload_id = client
            .create_multipart_upload()
            .bucket(&bucket)
            .key(&key)
            .content_type(&ct)
            .send()
            .await
            .map_err(|e| format!("Failed to create multipart upload: {e}"))?
            .upload_id
            .ok_or_else(|| "Missing upload_id".to_string())?;

        // Helper to abort on any error path.
        let abort = |client: aws_sdk_s3::Client, bucket: String, key: String, uid: String| {
            tokio::spawn(async move {
                let _ = client
                    .abort_multipart_upload()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(uid)
                    .send()
                    .await;
            });
        };

        let total_parts = (size as usize).div_ceil(part_size) as u32;
        debug_assert!(total_parts > 0);

        // completed_parts will be populated out-of-order as parts finish concurrently.
        let mut completed_parts: Vec<(i32, String)> = Vec::with_capacity(total_parts as usize);
        let mut file = tokio::fs::File::open(&file_path)
            .await
            .map_err(|e| format!("Failed to open file: {e}"))?;
        let mut part_number = 1i32;
        let mut join_set: JoinSet<Result<(i32, String), String>> = JoinSet::new();
        let mut buf = vec![0u8; part_size];

        loop {
            // Drain one completed part before reading the next chunk when at capacity,
            // so we never hold more than max_parts chunks in memory at once.
            // Use select! so cancel/pause is detected immediately even while
            // waiting for in-flight parts to complete.
            while join_set.len() >= max_parts {
                tokio::select! {
                    _ = guard.cancel_token.cancelled() => {
                        join_set.abort_all();
                        abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                        return Err("Transfer cancelled".to_string());
                    }
                    _ = task_registry::wait_if_paused(&guard.pause_rx) => {}
                    result = join_set.join_next() => {
                        match result {
                            Some(Ok(Ok((pnum, etag)))) => completed_parts.push((pnum, etag)),
                            Some(Ok(Err(e))) => {
                                join_set.abort_all();
                                abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                                return Err(e);
                            }
                            Some(Err(e)) => {
                                join_set.abort_all();
                                abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                                return Err(format!("Part task panicked: {e}"));
                            }
                            None => break,
                        }
                        let done = completed_parts.len() as u32;
                        let pct = ((done * 100) / total_parts).min(99) as u8;
                        emit_progress(&app, "upload-progress", &task_id, pct);
                    }
                }
            }

            // Check for cancellation or pause before reading the next chunk.
            tokio::select! {
                _ = guard.cancel_token.cancelled() => {
                    join_set.abort_all();
                    abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                    return Err("Transfer cancelled".to_string());
                }
                _ = task_registry::wait_if_paused(&guard.pause_rx) => {}
            }

            // Read the next chunk.
            let mut bytes_read = 0usize;
            loop {
                let n = file
                    .read(&mut buf[bytes_read..])
                    .await
                    .map_err(|e| format!("Failed to read file: {e}"))?;
                if n == 0 { break; }
                bytes_read += n;
                if bytes_read == part_size { break; }
            }
            if bytes_read == 0 { break; }

            // Spawn this part upload concurrently.
            let chunk = buf[..bytes_read].to_vec();
            let (cl, bkt, ky, uid) = (
                client.clone(), bucket.clone(), key.clone(), upload_id.clone(),
            );
            let pnum = part_number;
            join_set.spawn(async move {
                let out = cl
                    .upload_part()
                    .bucket(&bkt)
                    .key(&ky)
                    .upload_id(&uid)
                    .part_number(pnum)
                    .body(ByteStream::from(chunk))
                    .send()
                    .await
                    .map_err(|e| format!("Part {pnum} upload failed: {e}"))?;
                let etag = out
                    .e_tag()
                    .ok_or_else(|| {
                        format!("Part {pnum}: S3 returned no ETag — cannot complete multipart upload")
                    })?
                    .to_owned();
                Ok((pnum, etag))
            });
            part_number += 1;
        }

        // Drain remaining in-flight parts.
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok((pnum, etag))) => completed_parts.push((pnum, etag)),
                Ok(Err(e)) => {
                    join_set.abort_all();
                    abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                    return Err(e);
                }
                Err(e) => {
                    join_set.abort_all();
                    abort(client.clone(), bucket.clone(), key.clone(), upload_id.clone());
                    return Err(format!("Part task panicked: {e}"));
                }
            }
            let done = completed_parts.len() as u32;
            let pct = ((done * 100) / total_parts).min(99) as u8;
            emit_progress(&app, "upload-progress", &task_id, pct);
        }

        // Parts may have completed out of order; S3 requires ascending order.
        completed_parts.sort_unstable_by_key(|(pnum, _)| *pnum);

        let s3_parts: Vec<CompletedPart> = completed_parts
            .into_iter()
            .map(|(pnum, etag)| {
                CompletedPart::builder()
                    .e_tag(etag)
                    .part_number(pnum)
                    .build()
            })
            .collect();

        let completed = CompletedMultipartUpload::builder()
            .set_parts(Some(s3_parts))
            .build();

        let complete_result = client
            .complete_multipart_upload()
            .bucket(&bucket)
            .key(&key)
            .upload_id(&upload_id)
            .multipart_upload(completed)
            .send()
            .await;

        if let Err(e) = complete_result {
            abort(client, bucket, key, upload_id);
            return Err(format!("Failed to complete multipart upload: {e}"));
        }
    }

    emit_progress(&app, "upload-progress", &task_id, 100);
    Ok(serde_json::json!({ "success": true, "key": key, "size": size }))
    // `guard` is dropped here → deregisters automatically.
}

/// Cancel a running transfer. The transfer coroutine will detect the signal and abort.
#[tauri::command]
pub fn cancel_transfer(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    task_registry::cancel_task(&task_id)?;
    let _ = app.emit("transfer-state", TransferStateEvent {
        task_id: task_id.clone(),
        state: "cancelled".to_string(),
    });
    Ok(())
}

/// Pause a running transfer. The transfer coroutine will block until resumed.
#[tauri::command]
pub fn pause_transfer(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    task_registry::pause_task(&task_id)?;
    let _ = app.emit("transfer-state", TransferStateEvent {
        task_id: task_id.clone(),
        state: "paused".to_string(),
    });
    Ok(())
}

/// Resume a paused transfer. The transfer coroutine will continue from where it left off.
#[tauri::command]
pub fn resume_transfer(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    task_registry::resume_task(&task_id)?;
    let _ = app.emit("transfer-state", TransferStateEvent {
        task_id: task_id.clone(),
        state: "running".to_string(),
    });
    Ok(())
}

/// Resume a failed download by checking the existing .part file and
/// downloading only the remaining bytes via a single Range GET.
/// This avoids re-downloading data that was already received.
#[tauri::command]
pub async fn resume_download(
    app: tauri::AppHandle,
    account_idx: usize,
    bucket: String,
    key: String,
    save_path: String,
    task_id: Option<String>,
    connections: Option<usize>,
    part_size_mb: Option<u64>,
    multipart_threshold_mb: Option<u64>,
) -> Result<serde_json::Value, String> {
    let guard = task_registry::register_task(task_id.clone());
    let save = std::path::Path::new(&save_path);
    let part_path = resumable_part_path(save);

    // Probe the object size.
    let client = s3client::get_client(account_idx)?;
    let head = client
        .head_object()
        .bucket(&bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| format!("Failed to stat object: {e}"))?;
    let total = head.content_length().unwrap_or(0) as u64;

    // Check how much we already have.
    let existing = tokio::fs::metadata(&part_path).await;
    let offset = match existing {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };

    if offset >= total && total > 0 {
        // Already fully downloaded, just rename.
        tokio::fs::rename(&part_path, save)
            .await
            .map_err(|e| format!("Failed to finalise download: {e}"))?;
        emit_progress(&app, "download-single-progress", &task_id, 100);
        return Ok(serde_json::json!({ "success": true, "resumed_from": offset }));
    }

    if offset > total {
        // S3 object was replaced with a smaller one. Remove stale .part and re-download.
        let _ = tokio::fs::remove_file(&part_path).await;
        let result = download_inner(
            &app, account_idx, &bucket, &key, &part_path, &task_id,
            connections, part_size_mb, multipart_threshold_mb, &guard.cancel_token, &guard.pause_rx,
        )
        .await;
        if result.is_ok() {
            tokio::fs::rename(&part_path, save)
                .await
                .map_err(|e| format!("Failed to finalise download: {e}"))?;
        }
        return result.map(|()| serde_json::json!({ "success": true, "resumed_from": 0 }));
    }

    if offset == 0 {
        // No partial data, fall through to fresh download.
        let result = download_inner(
            &app, account_idx, &bucket, &key, &part_path, &task_id,
            connections, part_size_mb, multipart_threshold_mb, &guard.cancel_token, &guard.pause_rx,
        )
        .await;
        if result.is_ok() {
            tokio::fs::rename(&part_path, save)
                .await
                .map_err(|e| format!("Failed to finalise download: {e}"))?;
        } else {
            // Keep .part on error for future resume.
        }
        return result.map(|()| serde_json::json!({ "success": true, "resumed_from": 0 }));
    }

    // Partial data exists — resume with a Range GET for the remaining bytes.
    emit_progress(&app, "download-single-progress", &task_id, 0);
    let end = total.saturating_sub(1);
    let range_str = format!("bytes={offset}-{end}");

    let result: Result<(), String> = async {
        // Cancel-aware streaming of remaining bytes, appended to existing .part.
        let resp = client
            .get_object()
            .bucket(&bucket)
            .key(&key)
            .range(&range_str)
            .send()
            .await
            .map_err(|e| format!("Failed to resume download: {e}"))?;

        let mut body = resp.body;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to open partial file: {e}"))?;

        let mut received: u64 = offset;
        let mut last_pct: u8 = 0;

        loop {
            tokio::select! {
                _ = guard.cancel_token.cancelled() => {
                    return Err("Transfer cancelled".to_string());
                }
                chunk = body.next() => {
                    let Some(chunk) = chunk else { break; };
                    let bytes = chunk.map_err(|e| format!("Failed to read body: {e}"))?;
                    file.write_all(&bytes)
                        .await
                        .map_err(|e| format!("Failed to write file: {e}"))?;
                    received += bytes.len() as u64;
                    if total > 0 {
                        let pct = (((received as u128 * 100) / total as u128).min(99)) as u8;
                        if pct > last_pct {
                            last_pct = pct;
                            emit_progress(&app, "download-single-progress", &task_id, pct);
                        }
                    }
                }
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            tokio::fs::rename(&part_path, save)
                .await
                .map_err(|e| format!("Failed to finalise download: {e}"))?;
            emit_progress(&app, "download-single-progress", &task_id, 100);
            Ok(serde_json::json!({ "success": true, "resumed_from": offset }))
        }
        Err(e) => {
            // Keep .part on error for future resume.
            if e.contains("Transfer cancelled") {
                let _ = tokio::fs::remove_file(&part_path).await;
                let _ = app.emit("transfer-state", TransferStateEvent {
                    task_id: task_id.clone().unwrap_or_default(),
                    state: "cancelled".to_string(),
                });
            }
            Err(e)
        }
    }
    // `guard` is dropped here → deregisters automatically.
}

#[tauri::command]
pub async fn presign_object(
    account_idx: usize,
    bucket: String,
    key: String,
    expires: Option<u64>,
) -> Result<serde_json::Value, String> {
    let client = s3client::get_client(account_idx)?;
    let expires_in = Duration::from_secs(expires.unwrap_or(3600));

    let presigning_config = aws_sdk_s3::presigning::PresigningConfig::expires_in(expires_in)
        .map_err(|e| format!("Invalid expiration: {e}"))?;

    let presigned = client
        .get_object()
        .bucket(&bucket)
        .key(&key)
        .presigned(presigning_config)
        .await
        .map_err(|e| format!("Failed to generate presigned URL: {e}"))?;

    Ok(serde_json::json!({ "url": presigned.uri().to_string() }))
}

/// Batch download files to a local folder, preserving relative paths.
/// Uses up to 5 concurrent downloads for performance.
#[tauri::command]
pub async fn batch_download(
    app: tauri::AppHandle,
    account_idx: usize,
    bucket: String,
    keys: Vec<String>,
    save_dir: String,
    strip_prefix: Option<String>,
) -> Result<serde_json::Value, String> {
    if keys.is_empty() {
        return Ok(serde_json::json!({ "success": true, "downloaded": 0 }));
    }

    let client = s3client::get_client(account_idx)?;
    let strip = strip_prefix.unwrap_or_default();
    let base = PathBuf::from(&save_dir);
    let file_keys: Vec<&String> = keys.iter().filter(|k| !k.ends_with('/')).collect();
    let total = file_keys.len() as u32;

    let completed = Arc::new(AtomicU32::new(0));
    let failed = Arc::new(AtomicU32::new(0));
    let errors = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let semaphore = Arc::new(Semaphore::new(5));

    let mut handles = Vec::new();
    for key in file_keys {
        let client = client.clone();
        let bucket = bucket.clone();
        let key = key.clone();
        let strip = strip.clone();
        let base = base.clone();
        let app = app.clone();
        let completed = Arc::clone(&completed);
        let failed = Arc::clone(&failed);
        let errors = Arc::clone(&errors);
        let semaphore = Arc::clone(&semaphore);

        handles.push(tokio::spawn(async move {
            let _permit = semaphore.acquire().await.unwrap();

            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    total,
                    completed: completed.load(Ordering::Relaxed),
                    failed: failed.load(Ordering::Relaxed),
                    current_key: key.clone(),
                },
            );

            let relative = if !strip.is_empty() && key.starts_with(&strip) {
                &key[strip.len()..]
            } else {
                key.as_str()
            };

            let dest = match safe_dest(&base, relative) {
                Some(d) => d,
                None => {
                    errors.lock().await.push(format!("{key}: unsafe path rejected"));
                    failed.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };

            if let Some(parent) = dest.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent).await {
                    errors.lock().await.push(format!("{key}: failed to create dir: {e}"));
                    failed.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            }

            match client.get_object().bucket(&bucket).key(&key).send().await {
                Ok(resp) => {
                    let mut body = resp.body;
                    let tmp = tmp_path_for(&dest);
                    let write_result: Result<(), String> = async {
                        let mut file = tokio::fs::File::create(&tmp)
                            .await
                            .map_err(|e| format!("create failed: {e}"))?;
                        while let Some(chunk) = body.next().await {
                            let bytes = chunk.map_err(|e| format!("read failed: {e}"))?;
                            file.write_all(&bytes).await.map_err(|e| format!("write failed: {e}"))?;
                        }
                        file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
                        Ok(())
                    }.await;
                    match write_result {
                        Ok(()) => match tokio::fs::rename(&tmp, &dest).await {
                            Ok(()) => { completed.fetch_add(1, Ordering::Relaxed); }
                            Err(e) => {
                                let _ = tokio::fs::remove_file(&tmp).await;
                                errors.lock().await.push(format!("{key}: rename failed: {e}"));
                                failed.fetch_add(1, Ordering::Relaxed);
                            }
                        },
                        Err(e) => {
                            let _ = tokio::fs::remove_file(&tmp).await;
                            errors.lock().await.push(format!("{key}: {e}"));
                            failed.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                Err(e) => {
                    errors.lock().await.push(format!("{key}: download failed: {e}"));
                    failed.fetch_add(1, Ordering::Relaxed);
                }
            }

            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    total,
                    completed: completed.load(Ordering::Relaxed),
                    failed: failed.load(Ordering::Relaxed),
                    current_key: String::new(),
                },
            );
        }));
    }

    for h in handles {
        if let Err(e) = h.await {
            errors.lock().await.push(format!("Task panicked: {e}"));
            failed.fetch_add(1, Ordering::Relaxed);
        }
    }

    let final_completed = completed.load(Ordering::Relaxed);
    let final_errors = errors.lock().await.clone();

    Ok(serde_json::json!({
        "success": final_errors.is_empty(),
        "downloaded": final_completed,
        "errors": final_errors,
    }))
}

/// Expand a list of local paths (files or directories) into a flat list of
/// ExpandedEntry for upload. Directories are walked recursively; files produce
/// a single entry whose relative_path is the filename.
#[tauri::command]
pub async fn expand_paths(paths: Vec<String>) -> Result<Vec<ExpandedEntry>, String> {
    let mut result = Vec::new();

    for path_str in &paths {
        let path = std::path::Path::new(path_str);
        let meta = tokio::fs::metadata(path)
            .await
            .map_err(|e| format!("Cannot stat {path_str}: {e}"))?;

        if meta.is_file() {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            result.push(ExpandedEntry { local_path: path_str.clone(), relative_path: filename });
        } else if meta.is_dir() {
            let parent = path.parent().unwrap_or(path);
            walk_dir(path, parent, &mut result).await?;
        }
    }

    Ok(result)
}

async fn walk_dir(
    dir: &std::path::Path,
    base: &std::path::Path,
    out: &mut Vec<ExpandedEntry>,
) -> Result<(), String> {
    let mut read_dir = tokio::fs::read_dir(dir)
        .await
        .map_err(|e| format!("Cannot read dir {}: {e}", dir.display()))?;

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        let ft = entry.file_type().await.map_err(|e| e.to_string())?;
        if ft.is_file() {
            let local = path.to_string_lossy().to_string();
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(ExpandedEntry { local_path: local, relative_path: rel });
        } else if ft.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.starts_with('.') {
                Box::pin(walk_dir(&path, base, out)).await?;
            }
        }
        // symlinks and other special files are silently skipped
    }
    Ok(())
}

/// Return the size of a local file in bytes.
#[tauri::command]
pub async fn stat_file(path: String) -> Result<u64, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Cannot stat {path}: {e}"))?;
    Ok(meta.len())
}
