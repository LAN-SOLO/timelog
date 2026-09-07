// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod settings;
mod state;
mod store;

use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = settings::data_dir(&handle);
            let s = settings::load(&handle);
            let data = store::load(&data_dir, &s.language);
            app.manage(Arc::new(AppState {
                settings: Mutex::new(s),
                data: Mutex::new(data),
                data_dir,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::get_data,
            commands::save_person,
            commands::delete_person,
            commands::save_client,
            commands::delete_client,
            commands::save_project,
            commands::delete_project,
            commands::save_task,
            commands::delete_task,
            commands::save_entry,
            commands::delete_entry,
            commands::start_timer,
            commands::stop_timer,
            commands::running,
            commands::summary,
            commands::weekly_totals,
            commands::budget_usages,
            commands::export_csv,
            commands::export_package,
            commands::import_package,
            commands::lock_week,
            commands::unlock_week,
            commands::read_text_file,
            commands::write_text_file,
            commands::write_file,
            commands::data_path,
            commands::check_update,
            commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while building timelog");
}
