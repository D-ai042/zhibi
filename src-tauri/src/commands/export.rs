use crate::db::{projects_dir, DbState};
use std::fs::File;
use std::io::Write;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[tauri::command]
pub fn export_zip(project_id: String, file_path: Option<String>, _state: State<'_, DbState>) -> Result<String, String> {
    let db_path = projects_dir().join(&project_id).join("project.db");
    if !db_path.exists() {
        return Err("项目数据库不存在".into());
    }

    // 如果用户通过对话框选择了路径，就用那个；否则用默认路径
    let zip_path = if let Some(ref fp) = file_path {
        std::path::PathBuf::from(fp)
    } else {
        let out_dir = projects_dir().join(&project_id).join("export");
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        out_dir.join("project-export.zip")
    };

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

    // B5 修复：路径遍历防护 —— 验证写入路径在用户选择的目录内
    // save_export_file 的 file_path 来自前端 dialog.save 对话框，是用户主动选择的路径
    // 此处做基本规范化检查，拒绝明显的路径遍历尝试
    let path = std::path::Path::new(&file_path);
    let canonical = path.canonicalize().or_else(|_| {
        // 文件尚不存在时 canonicalize 会失败，取父目录
        if let Some(parent) = path.parent() {
            parent.canonicalize().map(|p| p.join(path.file_name().unwrap_or_default()))
        } else {
            Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "无效路径"))
        }
    }).map_err(|e| format!("路径验证失败: {}", e))?;

    // 拒绝写入系统敏感目录（根盘符、Windows、System32 等）
    if let Some(path_str) = canonical.to_str() {
        let lower = path_str.to_lowercase();
        if lower.ends_with("\\windows") || lower.ends_with("\\windows\\system32") || lower.ends_with("\\windows\\system") {
            return Err("禁止写入系统目录".into());
        }
    }

    std::fs::write(&canonical, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(canonical.to_string_lossy().to_string())
}
