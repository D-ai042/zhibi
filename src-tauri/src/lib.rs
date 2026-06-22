mod commands;
mod db;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            db::init_app_db(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::create_project,
            commands::open_project,
            commands::delete_project,
            commands::rename_project,
            commands::get_api_config,
            commands::set_api_config,
            commands::set_provider_models,
            commands::test_api_connection,
            commands::get_framework_progress,
            commands::list_volumes,
            commands::list_chapters,
            commands::list_timeline_nodes,
            commands::save_timeline_node,
            commands::delete_timeline_node,
            commands::list_plot_events,
            commands::save_plot_event,
            commands::delete_plot_event,
            commands::list_characters,
            commands::save_character,
            commands::delete_character,
            commands::list_world_terms,
            commands::save_world_term,
            commands::delete_world_term,
            commands::get_setting,
            commands::set_setting,
            commands::get_style_guide,
            commands::save_style_guide,
            commands::get_story_bible,
            commands::save_story_bible,
            commands::get_chapter_summaries,
            commands::list_relationship_edges,
            commands::save_relationship_edge,
            commands::delete_relationship_edge,
            commands::save_node_layout,
            commands::list_beat_cards,
            commands::save_beat_card,
            commands::delete_beat_card,
            commands::get_chapter_content,
            commands::save_chapter_content,
            commands::list_locked_fields,
            commands::ai_complete,
            commands::stt_transcribe,
            commands::export_zip,
            commands::export_project,
            commands::import_project,
            commands::save_export_file,
            commands::list_app_settings,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("执笔启动失败: {}", e);
            std::process::exit(1);
        });
}
