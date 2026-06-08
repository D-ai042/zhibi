use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Option<Connection>>);

pub fn projects_dir() -> PathBuf {
    // 存到 exe 同级目录下的 data/projects
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("data").join("projects")
}

pub fn init_app_db(app: &AppHandle) -> std::io::Result<()> {
    std::fs::create_dir_all(projects_dir())?;
    app.manage(DbState(Mutex::new(None)));
    Ok(())
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    // 角色卡扩展字段（v0.2）：逐列添加，忽略已存在错误
    let migration_cols = [
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
        conn.execute(stmt, []).ok();
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
    let mut guard = state.0.lock().unwrap();
    *guard = Some(conn);
    Ok(())
}

pub fn with_conn<F, T>(state: &DbState, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().expect("no project db open");
    f(conn)
}
