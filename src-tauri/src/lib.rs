use tauri::Manager;

mod commands;
mod s3client;
mod task_registry;
pub mod types;

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _argv, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            },
        ));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Config
            commands::config::get_config,
            commands::config::put_config,
            // Accounts
            commands::accounts::list_accounts,
            // Buckets
            commands::buckets::list_buckets,
            // Bucket info
            commands::bucket_info::get_bucket_location,
            commands::bucket_info::get_bucket_acl,
            commands::bucket_info::get_bucket_versioning,
            commands::bucket_info::get_bucket_encryption,
            commands::bucket_info::get_bucket_lifecycle,
            commands::bucket_info::get_bucket_cors,
            commands::bucket_info::get_bucket_tags,
            commands::bucket_info::get_bucket_logging,
            // Objects
            commands::objects::list_objects,
            commands::objects::search_objects,
            commands::objects::delete_objects,
            commands::objects::create_folder,
            commands::objects::rename_object,
            // Transfer settings
            commands::settings::get_transfer_config,
            commands::settings::put_transfer_config,
            // Transfer
            commands::transfer::download_object,
            commands::transfer::batch_download,
            commands::transfer::upload_object,
            commands::transfer::presign_object,
            commands::transfer::expand_paths,
            commands::transfer::stat_file,
            commands::transfer::cancel_transfer,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::resume_download,
            // Metadata
            commands::metadata::object_meta,
            commands::metadata::preview_object,
            commands::metadata::update_text,
            // History
            commands::history::get_history,
            commands::history::append_history_entry,
            commands::history::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
