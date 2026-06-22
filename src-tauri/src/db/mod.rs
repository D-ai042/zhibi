use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use log;

pub struct DbState(pub Mutex<Option<Connection>>);

/// 应用数据根目录：%APPDATA%/com.zhibi.writer/（安装版可写）
/// 不再使用 exe 同级目录，避免 Program Files 权限问题
pub fn data_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("com.zhibi.writer")
    } else {
        // fallback：exe 同级目录
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        exe_dir.join("data")
    }
}

pub fn projects_dir() -> PathBuf {
    data_dir().join("projects")
}

pub fn init_app_db(app: &AppHandle) -> std::io::Result<()> {
    std::fs::create_dir_all(projects_dir())?;
    app.manage(DbState(Mutex::new(None)));
    Ok(())
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    // 角色卡扩展字段（v0.2）：逐列添加，忽略已存在错误
    let migration_cols = [
        "ALTER TABLE characters ADD COLUMN snapshots_json TEXT DEFAULT '[]'",
        "ALTER TABLE characters ADD COLUMN gender TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN age TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN race TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN appearance TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN personality TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN background TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN ability TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN style TEXT DEFAULT ''",
        "ALTER TABLE characters ADD COLUMN interests TEXT DEFAULT ''",
    ];
    for stmt in &migration_cols {
        if let Err(e) = conn.execute(stmt, []) {
            log::warn!("[migration] 列迁移失败（正常如列已存在）: {}", e);
        }
    }
    Ok(())
}

pub fn open_project_db(project_id: &str, state: &DbState) -> rusqlite::Result<()> {
    let path = projects_dir().join(project_id).join("project.db");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let schema = include_str!("schema.sql");
    conn.execute_batch(schema)?;
    run_migrations(&conn)?;
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(conn);
    Ok(())
}

pub fn with_conn<F, T>(state: &DbState, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let conn = guard.as_ref().ok_or_else(|| rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(1),
        Some("未打开项目数据库，请先选择一个项目".into()),
    ))?;
    f(conn)
}
