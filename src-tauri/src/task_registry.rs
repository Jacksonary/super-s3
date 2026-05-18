use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// A handle stored per active transfer that allows external control.
pub struct TaskHandle {
    pub cancel_token: CancellationToken,
    pub pause_tx: watch::Sender<bool>,
}

static REGISTRY: OnceLock<Mutex<HashMap<String, TaskHandle>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, TaskHandle>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// RAII guard that deregisters the task on drop.
/// Use this to guarantee cleanup on any exit path (Ok, Err, panic).
pub struct TaskGuard {
    task_id: Option<String>,
    pub cancel_token: CancellationToken,
    pub pause_rx: watch::Receiver<bool>,
}

impl Drop for TaskGuard {
    fn drop(&mut self) {
        if let Some(tid) = &self.task_id {
            deregister_task(tid);
        }
    }
}

/// Register a new transfer task with automatic cleanup via `TaskGuard`.
///
/// - `Some(task_id)`: the task is registered in the global registry and can be
///   cancelled / paused / resumed by the frontend. The guard deregisters on drop.
/// - `None`: no registration occurs; the returned guard holds local-only tokens
///   that are never signalled. Useful for transfers that don't need UI control.
pub fn register_task(task_id: Option<String>) -> TaskGuard {
    let cancel_token = CancellationToken::new();
    let (pause_tx, pause_rx) = watch::channel(false);

    if let Some(tid) = &task_id {
        let handle = TaskHandle {
            cancel_token: cancel_token.clone(),
            pause_tx,
        };
        registry().lock().unwrap().insert(tid.clone(), handle);
    }

    TaskGuard {
        task_id,
        cancel_token,
        pause_rx,
    }
}

/// Remove a completed / cancelled / errored task from the registry.
pub fn deregister_task(task_id: &str) {
    registry().lock().unwrap().remove(task_id);
}

/// Cancel a running task by its task_id.
pub fn cancel_task(task_id: &str) -> Result<(), String> {
    let map = registry().lock().unwrap();
    let handle = map.get(task_id).ok_or_else(|| "Task not found".to_string())?;
    handle.cancel_token.cancel();
    Ok(())
}

/// Pause a running task by its task_id.
pub fn pause_task(task_id: &str) -> Result<(), String> {
    let map = registry().lock().unwrap();
    let handle = map.get(task_id).ok_or_else(|| "Task not found".to_string())?;
    handle
        .pause_tx
        .send(true)
        .map_err(|_| "Receiver dropped".to_string())
}

/// Resume a paused task by its task_id.
pub fn resume_task(task_id: &str) -> Result<(), String> {
    let map = registry().lock().unwrap();
    let handle = map.get(task_id).ok_or_else(|| "Task not found".to_string())?;
    handle
        .pause_tx
        .send(false)
        .map_err(|_| "Receiver dropped".to_string())
}

/// Block until the pause signal is cleared. Returns immediately if not paused.
pub async fn wait_if_paused(pause_rx: &watch::Receiver<bool>) {
    let mut rx = pause_rx.clone();
    while *rx.borrow() {
        if rx.changed().await.is_err() {
            break;
        }
    }
}
