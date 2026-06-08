use crate::db::{projects_dir, DbState};
use std::fs::File;
use std::io::Write;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[tauri::command]
pub fn export_zip(project_id: String, _state: State<'_, DbState>) -> Result<String, String> {
    let db_path = projects_dir().join(&project_id).join("project.db");
    if !db_path.exists() {
        return Err("项目数据库不存在".into());
    }
    let out_dir = projects_dir().join(&project_id).join("export");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let zip_path = out_dir.join("project-export.zip");

    let file = File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    zip.start_file("project.db", options)
        .map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&db_path).map_err(|e| e.to_string())?;
    zip.write_all(&bytes).map_err(|e| e.to_string())?;

    zip.start_file("export/settings-snapshot.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(b"{\"note\":\"API Key not included\"}")
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(zip_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_export_file(_project_id: String, _filename: String, data_base64: String, file_path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    std::fs::write(&file_path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(file_path)
}
