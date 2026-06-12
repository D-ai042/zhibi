use crate::db::{open_project_db, with_conn, DbState};
use crate::models::{ApiConfig, FrameworkProgress, Project, ProviderSttConfig, SttConfig};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn config_path() -> PathBuf {
    crate::db::data_dir().join("config.json")
}

/// 从 JSON value 解析 STT 配置：优先新多 provider 格式，失败则迁移旧扁平格式
fn parse_stt_config(v: &serde_json::Value) -> SttConfig {
    // 尝试新多 provider 格式
    if let Ok(cfg) = serde_json::from_value::<SttConfig>(v.clone()) {
        if !cfg.providers.is_empty() || !cfg.active_provider.is_empty() {
            return cfg;
        }
    }
    // 迁移旧扁平格式
    migrate_old_stt(v)
}

/// 将旧扁平 STT 格式迁移为新多 provider 格式
fn migrate_old_stt(v: &serde_json::Value) -> SttConfig {
    let provider = v["provider"].as_str()
        .or(v["activeProvider"].as_str())
        .unwrap_or("openai");
    let api_key = v["api_key"].as_str().or(v["apiKey"].as_str()).unwrap_or("");
    let secret_key = v["secret_key"].as_str().or(v["secretKey"].as_str()).unwrap_or("");
    let base_url = v["base_url"].as_str().or(v["baseUrl"].as_str()).unwrap_or("");
    let model = v["model"].as_str().unwrap_or("");
    let enabled = v["enabled"].as_bool().unwrap_or(false);

    let mut providers = HashMap::new();
    providers.insert(provider.to_string(), ProviderSttConfig {
        api_key: api_key.to_string(),
        secret_key: secret_key.to_string(),
        base_url: base_url.to_string(),
        model: model.to_string(),
    });

    SttConfig {
        active_provider: provider.to_string(),
        providers,
        enabled,
    }
}

pub(crate) fn load_config() -> ApiConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            // Try snake_case first, then camelCase for backward compat
            if let Ok(mut cfg) = serde_json::from_str::<ApiConfig>(&raw) {
                // STT migration: if providers is empty, try to parse old flat format
                if cfg.stt.providers.is_empty() {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                        if let Some(stt_val) = val.get("stt") {
                            cfg.stt = parse_stt_config(stt_val);
                        }
                    }
                }
                return cfg;
            }
            // Try camelCase format
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                return ApiConfig {
                    api_base_url: val["apiBaseUrl"].as_str().unwrap_or("https://api.deepseek.com").to_string(),
                    api_model: val["apiModel"].as_str().unwrap_or("deepseek-chat").to_string(),
                    has_api_key: val.get("providerKeys").or(val.get("provider_keys")).map(|v| !v.as_object().map(|o| o.is_empty()).unwrap_or(true)).unwrap_or(false),
                    provider_keys: val.get("providerKeys").or(val.get("provider_keys"))
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default(),
                    provider_base_urls: val.get("providerBaseUrls").or(val.get("provider_base_urls"))
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default(),
                    provider_models: val.get("providerModels").or(val.get("provider_models"))
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default(),
                    stt: val.get("stt")
                        .map(|v| parse_stt_config(v))
                        .unwrap_or_default(),
                };
            }
        }
    }
    ApiConfig {
        api_base_url: "https://api.deepseek.com".into(),
        api_model: "deepseek-chat".into(),
        has_api_key: false,
        provider_keys: HashMap::new(),
        provider_base_urls: HashMap::new(),
        provider_models: HashMap::new(),
        stt: SttConfig::default(),
    }
}

fn save_config(cfg: &ApiConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, String> {
    let dir = crate::db::projects_dir();
    let mut out = vec![];
    if !dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let db_path = entry.path().join("project.db");
        if !db_path.exists() {
            continue;
        }
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        let schema = include_str!("../db/schema.sql");
        conn.execute_batch(schema).ok();
        if let Ok(p) = conn.query_row(
            "SELECT id, name, stage, framework_locked_at, created_at, updated_at FROM projects LIMIT 1",
            [],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    stage: row.get(2)?,
                    framework_locked_at: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        ) {
            out.push(p);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn create_project(name: String, state: State<'_, DbState>) -> Result<Project, String> {
    let id = new_id();
    let t = now();
    open_project_db(&id, &state).map_err(|e| e.to_string())?;
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO projects (id, name, stage, created_at, updated_at) VALUES (?1,?2,'ideation',?3,?3)",
            params![id, name, t],
        )?;
        let vol_id = new_id();
        conn.execute(
            "INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?1,?2,'第一卷',0)",
            params![vol_id, id],
        )?;
        for i in 1..=3 {
            conn.execute(
                "INSERT INTO chapters (id, volume_id, number, title, status, word_count) VALUES (?1,?2,?3,?4,'beat_ready',0)",
                params![new_id(), vol_id, i, format!("第{}章", i)],
            )?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(Project {
        id,
        name,
        stage: "ideation".into(),
        framework_locked_at: None,
        created_at: t.clone(),
        updated_at: t,
    })
}

#[tauri::command]
pub fn open_project(project_id: String, state: State<'_, DbState>) -> Result<(), String> {
    open_project_db(&project_id, &state).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(project_id: String, state: State<'_, DbState>) -> Result<(), String> {
    // 关闭当前 DB 连接，释放 Windows 文件锁，否则删除会失败
    {
        let mut guard = state.0.lock().unwrap();
        *guard = None;
    }
    let dir = crate::db::projects_dir().join(&project_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除项目失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_project(project_id: String, name: String, state: State<'_, DbState>) -> Result<Project, String> {
    let t = now();
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE projects SET name=?1, updated_at=?2 WHERE id=?3",
            params![name, t, project_id],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    let proj = with_conn(&state, |conn| {
        conn.query_row(
            "SELECT id, name, stage, framework_locked_at, created_at, updated_at FROM projects WHERE id=?1",
            params![project_id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    stage: row.get(2)?,
                    framework_locked_at: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
    })
    .map_err(|e| e.to_string())?;
    Ok(proj)
}

#[tauri::command]
pub fn get_api_config() -> Result<ApiConfig, String> {
    Ok(load_config())
}

#[tauri::command]
pub fn set_api_config(
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    provider_name: Option<String>,
    stt: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut cfg = load_config();

    if let Some(u) = base_url {
        cfg.api_base_url = u;
    }
    if let Some(m) = model {
        cfg.api_model = m;
    }
    if let Some(k) = api_key.filter(|s| !s.is_empty()) {
        if let Some(provider) = provider_name.filter(|s| !s.is_empty()) {
            cfg.provider_keys.insert(provider.clone(), k.clone());
            cfg.provider_base_urls.insert(provider, cfg.api_base_url.clone());
        }
        cfg.has_api_key = true;
    }
    if let Some(stt_val) = stt {
        if let Ok(s) = serde_json::from_value::<SttConfig>(stt_val) {
            cfg.stt = s;
        }
    }
    cfg.has_api_key = !cfg.provider_keys.is_empty();

    save_config(&cfg)?;
    Ok(())
}

#[tauri::command]pub fn set_provider_models(
    provider: String,
    models: Vec<String>,
) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.provider_models.insert(provider, models);
    cfg.has_api_key = !cfg.provider_keys.is_empty();
    save_config(&cfg)?;
    Ok(())
}

#[tauri::command]pub async fn test_api_connection() -> Result<serde_json::Value, String> {
    let cfg = load_config();
    if cfg.provider_keys.is_empty() {
        return Ok(serde_json::json!({"ok": false, "message": "请先填写 API Key"}));
    }
    Ok(serde_json::json!({"ok": true, "message": "已配置 API Key"}))
}

#[tauri::command]
pub fn get_framework_progress(project_id: String, state: State<'_, DbState>) -> Result<FrameworkProgress, String> {
    let pid = project_id;
    with_conn(&state, |conn| {
        let nodes: i64 = conn.query_row("SELECT COUNT(*) FROM timeline_nodes WHERE project_id=?1", params![pid], |r| r.get(0))?;
        let events: i64 = conn.query_row("SELECT COUNT(*) FROM plot_events WHERE project_id=?1", params![pid], |r| r.get(0))?;
        let chars: i64 = conn.query_row("SELECT COUNT(*) FROM characters WHERE project_id=?1", params![pid], |r| r.get(0))?;
        let terms: i64 = conn.query_row("SELECT COUNT(*) FROM world_terms WHERE project_id=?1", params![pid], |r| r.get(0))?;
        let beats: i64 = conn.query_row(
            "SELECT COUNT(*) FROM beat_cards bc JOIN chapters c ON bc.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id WHERE v.project_id=?1",
            params![pid],
            |r| r.get(0),
        )?;
        let chaps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chapters c JOIN volumes v ON c.volume_id = v.id WHERE v.project_id=?1",
            params![pid],
            |r| r.get(0),
        )?;
        let plot_dir = (nodes + events) * 15;
        Ok(FrameworkProgress {
            worldview: if terms > 0 { (terms * 20).min(100) as i32 } else { 0 },
            characters: (chars * 15).min(100) as i32,
            plot_direction: plot_dir.min(100) as i32,
            beats: if chaps > 0 {
                ((beats * 100) / (chaps * 3)).min(100) as i32
            } else {
                0
            },
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lock_framework(project_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let t = now();
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE projects SET stage='framework_locked', framework_locked_at=?1, updated_at=?1 WHERE id=?2",
            params![t, project_id],
        )?;
        conn.execute("UPDATE timeline_nodes SET is_locked=1 WHERE project_id=?1", params![project_id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_volumes(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare("SELECT id, project_id, title, sort_order FROM volumes WHERE project_id=?1")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "sort_order": row.get::<_, i32>(3)?,
            }))
        })?;
        let mut arr = vec![];
        for r in rows {
            arr.push(r.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?);
        }
        Ok(Value::Array(arr))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_chapters(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.volume_id, c.number, c.title, c.status, c.word_count FROM chapters c
             JOIN volumes v ON c.volume_id = v.id WHERE v.project_id = ?1 ORDER BY c.number",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "volume_id": row.get::<_, String>(1)?,
                "number": row.get::<_, i32>(2)?,
                "title": row.get::<_, String>(3)?,
                "status": row.get::<_, String>(4)?,
                "word_count": row.get::<_, i32>(5)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_timeline_nodes(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, type, title, summary, volume_id, sort_order, is_locked, layout_y,
                    must_achieve_json, character_ids_json, linked_chapter_id
             FROM timeline_nodes WHERE project_id=?1 ORDER BY sort_order",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "summary": row.get::<_, String>(4)?,
                "volume_id": row.get::<_, Option<String>>(5)?,
                "sort_order": row.get::<_, i32>(6)?,
                "is_locked": row.get::<_, i32>(7)? != 0,
                "layout_y": row.get::<_, f64>(8)?,
                "must_achieve": serde_json::from_str::<Value>(&row.get::<_, String>(9)?).unwrap_or(Value::Array(vec![])),
                "character_ids": serde_json::from_str::<Value>(&row.get::<_, String>(10)?).unwrap_or(Value::Array(vec![])),
                "linked_chapter_id": row.get::<_, Option<String>>(11)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize)]
pub struct TimelineNodeIn {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub title: String,
    pub summary: String,
    pub volume_id: Option<String>,
    pub sort_order: i32,
    pub is_locked: bool,
    pub layout_y: f64,
    pub must_achieve: Vec<String>,
    pub character_ids: Vec<String>,
    pub linked_chapter_id: Option<String>,
}

#[tauri::command]
pub fn save_timeline_node(node: TimelineNodeIn, state: State<'_, DbState>) -> Result<Value, String> {
    let ma = serde_json::to_string(&node.must_achieve).unwrap();
    let ch = serde_json::to_string(&node.character_ids).unwrap();
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO timeline_nodes
             (id, project_id, type, title, summary, volume_id, sort_order, is_locked, layout_y,
              must_achieve_json, character_ids_json, linked_chapter_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                node.id,
                node.project_id,
                node.node_type,
                node.title,
                node.summary,
                node.volume_id,
                node.sort_order,
                node.is_locked as i32,
                node.layout_y,
                ma,
                ch,
                node.linked_chapter_id
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&node).unwrap())
}

#[tauri::command]
pub fn delete_timeline_node(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM timeline_nodes WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_plot_events(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, line_type, title, chapter_start, chapter_end, reader_knowledge,
                    truth_content, plant_method, convergence_chapter, is_locked, character_ids_json
             FROM plot_events WHERE project_id=?1",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "line_type": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "chapter_start": row.get::<_, i32>(4)?,
                "chapter_end": row.get::<_, i32>(5)?,
                "reader_knowledge": row.get::<_, String>(6)?,
                "truth_content": row.get::<_, String>(7)?,
                "plant_method": row.get::<_, String>(8)?,
                "convergence_chapter": row.get::<_, Option<i32>>(9)?,
                "is_locked": row.get::<_, i32>(10)? != 0,
                "character_ids": serde_json::from_str::<Value>(&row.get::<_, String>(11)?).unwrap_or(Value::Array(vec![])),
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize)]
pub struct PlotEventIn {
    pub id: String,
    pub project_id: String,
    pub line_type: String,
    pub title: String,
    pub chapter_start: i32,
    pub chapter_end: i32,
    pub reader_knowledge: String,
    pub truth_content: String,
    pub plant_method: String,
    pub convergence_chapter: Option<i32>,
    pub is_locked: bool,
    pub character_ids: Vec<String>,
}

#[tauri::command]
pub fn save_plot_event(event: PlotEventIn, state: State<'_, DbState>) -> Result<Value, String> {
    let ch = serde_json::to_string(&event.character_ids).unwrap();
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO plot_events VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                event.id,
                event.project_id,
                event.line_type,
                event.title,
                event.chapter_start,
                event.chapter_end,
                event.reader_knowledge,
                event.truth_content,
                event.plant_method,
                event.convergence_chapter,
                event.is_locked as i32,
                ch
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(event).unwrap())
}

#[tauri::command]
pub fn delete_plot_event(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM plot_events WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize)]
pub struct CharacterIn {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub gender: String,
    pub age: String,
    pub race: String,
    pub appearance: String,
    pub personality: String,
    pub background: String,
    pub ability: String,
    pub style: String,
    pub interests: String,
    pub faction: String,
    pub weight: i32,
    pub desire: String,
    pub fear: String,
    pub flaw: String,
    pub arc: String,
    pub voice_style: String,
    pub ending_node_id: Option<String>,
    pub avatar_path: Option<String>,
    pub layout_x: f64,
    pub layout_y: f64,
    pub is_locked: bool,
    #[serde(default)]
    pub snapshots_json: String,
}

#[tauri::command]
pub fn list_characters(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, faction, weight, desire, fear, flaw, arc, voice_style, \
                    ending_node_id, avatar_path, layout_x, layout_y, is_locked, snapshots_json, \
                    gender, age, race, appearance, personality, background, ability, style, interests \
             FROM characters WHERE project_id=?1"
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            let snap_raw: Option<String> = row.get(15)?;
            let snapshots_val = match snap_raw {
                Some(s) if !s.is_empty() => serde_json::from_str(&s).unwrap_or(Value::Array(vec![])),
                _ => Value::Array(vec![]),
            };
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "faction": row.get::<_, String>(3)?,
                "weight": row.get::<_, i32>(4)?,
                "desire": row.get::<_, String>(5)?,
                "fear": row.get::<_, String>(6)?,
                "flaw": row.get::<_, String>(7)?,
                "arc": row.get::<_, String>(8)?,
                "voice_style": row.get::<_, String>(9)?,
                "ending_node_id": row.get::<_, Option<String>>(10)?,
                "avatar_path": row.get::<_, Option<String>>(11)?,
                "layout_x": row.get::<_, f64>(12)?,
                "layout_y": row.get::<_, f64>(13)?,
                "is_locked": row.get::<_, i32>(14)? != 0,
                "snapshots": snapshots_val,
                "gender": row.get::<_, String>(16)?,
                "age": row.get::<_, String>(17)?,
                "race": row.get::<_, String>(18)?,
                "appearance": row.get::<_, String>(19)?,
                "personality": row.get::<_, String>(20)?,
                "background": row.get::<_, String>(21)?,
                "ability": row.get::<_, String>(22)?,
                "style": row.get::<_, String>(23)?,
                "interests": row.get::<_, String>(24)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_character(character: CharacterIn, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO characters \
             (id, project_id, name, faction, weight, desire, fear, flaw, arc, voice_style, \
              ending_node_id, avatar_path, layout_x, layout_y, is_locked, snapshots_json, \
              gender, age, race, appearance, personality, background, ability, style, interests) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
            params![
                character.id,
                character.project_id,
                character.name,
                character.faction,
                character.weight,
                character.desire,
                character.fear,
                character.flaw,
                character.arc,
                character.voice_style,
                character.ending_node_id,
                character.avatar_path,
                character.layout_x,
                character.layout_y,
                character.is_locked as i32,
                character.snapshots_json,
                character.gender,
                character.age,
                character.race,
                character.appearance,
                character.personality,
                character.background,
                character.ability,
                character.style,
                character.interests,
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(character).unwrap())
}

#[tauri::command]
pub fn delete_character(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM characters WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

// ==================== World Terms ====================

#[tauri::command]
pub fn list_world_terms(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM world_terms WHERE project_id=?1")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "term_type": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "one_liner": row.get::<_, String>(4)?,
                "detail": row.get::<_, String>(5)?,
                "ring_level": row.get::<_, i32>(6)?,
                "forbidden": serde_json::from_str::<Vec<String>>(&row.get::<_, String>(7)?).unwrap_or_default(),
                "is_locked": row.get::<_, i32>(8)? != 0,
                "layout_x": row.get::<_, f64>(9)?,
                "layout_y": row.get::<_, f64>(10)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize)]
pub struct WorldTermIn {
    pub id: String,
    pub project_id: String,
    pub term_type: String,
    pub title: String,
    pub one_liner: String,
    pub detail: String,
    pub ring_level: i32,
    pub forbidden: Vec<String>,
    pub is_locked: bool,
    pub layout_x: f64,
    pub layout_y: f64,
}

#[tauri::command]
pub fn save_world_term(term: WorldTermIn, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO world_terms VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                term.id,
                term.project_id,
                term.term_type,
                term.title,
                term.one_liner,
                term.detail,
                term.ring_level,
                serde_json::to_string(&term.forbidden).unwrap_or_default(),
                term.is_locked as i32,
                term.layout_x,
                term.layout_y,
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(term).unwrap())
}

#[tauri::command]
pub fn delete_world_term(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM world_terms WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize)]
pub struct EdgeIn {
    pub id: String,
    pub project_id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub strength: i32,
    pub is_secret: bool,
}

#[tauri::command]
pub fn list_relationship_edges(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt =
            conn.prepare("SELECT id, project_id, source_id, target_id, relation_type, strength, is_secret FROM relationship_edges WHERE project_id=?1")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "source_id": row.get::<_, String>(2)?,
                "target_id": row.get::<_, String>(3)?,
                "relation_type": row.get::<_, String>(4)?,
                "strength": row.get::<_, i32>(5)?,
                "is_secret": row.get::<_, i32>(6)? != 0,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_relationship_edge(edge: EdgeIn, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO relationship_edges VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                edge.id,
                edge.project_id,
                edge.source_id,
                edge.target_id,
                edge.relation_type,
                edge.strength,
                edge.is_secret as i32
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(edge).unwrap())
}

#[tauri::command]
pub fn delete_relationship_edge(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM relationship_edges WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_node_layout(
    entity_type: String,
    entity_id: String,
    x: f64,
    y: f64,
    state: State<'_, DbState>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        match entity_type.as_str() {
            "character" => conn.execute(
                "UPDATE characters SET layout_x=?1, layout_y=?2 WHERE id=?3",
                params![x, y, entity_id],
            ),
            "world_term" => conn.execute(
                "UPDATE world_terms SET layout_x=?1, layout_y=?2 WHERE id=?3",
                params![x, y, entity_id],
            ),
            _ => Ok(0),
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize, Serialize)]
pub struct BeatCardIn {
    pub id: String,
    pub chapter_id: String,
    pub column_type: String,
    pub content: String,
    pub sort_order: i32,
}

#[tauri::command]
pub fn list_beat_cards(chapter_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt =
            conn.prepare("SELECT id, chapter_id, column_type, content, sort_order FROM beat_cards WHERE chapter_id=?1")?;
        let rows = stmt.query_map(params![chapter_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "chapter_id": row.get::<_, String>(1)?,
                "column_type": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "sort_order": row.get::<_, i32>(4)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_beat_card(card: BeatCardIn, state: State<'_, DbState>) -> Result<Value, String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO beat_cards VALUES (?1,?2,?3,?4,?5)",
            params![card.id, card.chapter_id, card.column_type, card.content, card.sort_order],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(card).unwrap())
}

#[tauri::command]
pub fn delete_beat_card(id: String, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM beat_cards WHERE id=?1", params![id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct ChapterContentIn {
    pub chapter_id: String,
    pub body_json: String,
    pub body_html: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_chapter_content(chapter_id: String, state: State<'_, DbState>) -> Result<Option<Value>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare("SELECT chapter_id, body_json, body_html, updated_at FROM chapter_contents WHERE chapter_id=?1")?;
        let mut rows = stmt.query(params![chapter_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(serde_json::json!({
                "chapter_id": row.get::<_, String>(0)?,
                "body_json": row.get::<_, String>(1)?,
                "body_html": row.get::<_, String>(2)?,
                "updated_at": row.get::<_, String>(3)?,
            })))
        } else {
            Ok(None)
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_chapter_content(content: ChapterContentIn, state: State<'_, DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO chapter_contents VALUES (?1,?2,?3,?4)",
            params![content.chapter_id, content.body_json, content.body_html, content.updated_at],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_locked_fields(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    let _ = project_id;
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare("SELECT id, entity_type, entity_id, field_name FROM locked_fields")?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "entity_type": row.get::<_, String>(1)?,
                "entity_id": row.get::<_, String>(2)?,
                "field_name": row.get::<_, String>(3)?,
            }))
        })?;
        Ok(Value::Array(rows.filter_map(|r| r.ok()).collect()))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_project(project_id: String, state: State<'_, DbState>) -> Result<Value, String> {
    // 先打开该项目的数据库
    open_project_db(&project_id, &state).map_err(|e| format!("打开项目数据库失败: {}", e))?;

    with_conn(&state, |conn| {
        let proj: Option<Project> = conn.query_row(
            "SELECT id, name, stage, framework_locked_at, created_at, updated_at FROM projects WHERE id=?1",
            params![project_id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    stage: row.get(2)?,
                    framework_locked_at: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        ).ok();

        let world_terms = read_table(conn, "SELECT * FROM world_terms WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let characters = read_table(conn, "SELECT * FROM characters WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let relationships = read_table(conn, "SELECT * FROM relationship_edges WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let plot_events = read_table(conn, "SELECT * FROM plot_events WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let timeline_nodes = read_table(conn, "SELECT * FROM timeline_nodes WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let volumes = read_table(conn, "SELECT id, project_id, title, sort_order FROM volumes WHERE project_id=?1", params![project_id]).unwrap_or_default();
        let chapters = read_table(conn,
            "SELECT c.id, c.volume_id, c.number, c.title, c.status, c.word_count FROM chapters c JOIN volumes v ON c.volume_id = v.id WHERE v.project_id=?1",
            params![project_id]
        ).unwrap_or_default();

        let chapter_ids: Vec<String> = chapters.iter()
            .filter_map(|c| c.get("id").and_then(|v| v.as_str().map(String::from)))
            .collect();

        let all_beat_cards = read_table(conn, "SELECT id, chapter_id, column_type, content, sort_order FROM beat_cards", []).unwrap_or_default();
        let beat_cards: Vec<Value> = all_beat_cards.into_iter()
            .filter(|c| c.get("chapter_id").and_then(|v| v.as_str()).map(|id| chapter_ids.iter().any(|cid| cid == id)).unwrap_or(false))
            .collect();

        let all_contents = read_table(conn, "SELECT chapter_id, body_json, body_html, updated_at FROM chapter_contents", []).unwrap_or_default();
        let chapter_contents: Vec<Value> = all_contents.into_iter()
            .filter(|c| c.get("chapter_id").and_then(|v| v.as_str()).map(|id| chapter_ids.iter().any(|cid| cid == id)).unwrap_or(false))
            .collect();

        Ok(serde_json::json!({
            "project": proj,
            "worldTerms": world_terms,
            "characters": characters,
            "relationships": relationships,
            "plotEvents": plot_events,
            "timelineNodes": timeline_nodes,
            "volumes": volumes,
            "chapters": chapters,
            "beatCards": beat_cards,
            "chapterContents": chapter_contents,
        }))
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(key: String, _state: State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = open_or_create_settings_db();
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key=?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(row.get::<_, String>(0).map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_setting(key: String, value: String, _state: State<'_, DbState>) -> Result<(), String> {
    let conn = open_or_create_settings_db();
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_app_settings(_state: State<'_, DbState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = open_or_create_settings_db();
    let mut stmt = conn.prepare("SELECT key, value FROM app_settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "key": row.get::<_, String>(0)?,
            "value": row.get::<_, String>(1)?,
        }))
    }).map_err(|e| e.to_string())?;
    let result: Vec<serde_json::Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(result)
}

#[tauri::command]
pub fn import_project(project_data: serde_json::Value, state: State<'_, DbState>) -> Result<String, String> {
    let project = project_data.get("project").ok_or("缺少 project 字段")?;
    let project_id = project.get("id").and_then(|v| v.as_str()).ok_or("缺少 project.id")?.to_string();
    let project_name = project.get("name").and_then(|v| v.as_str()).unwrap_or("导入的项目").to_string();

    // 先打开该项目的数据库
    open_project_db(&project_id, &state).map_err(|e| format!("打开项目数据库失败: {}", e))?;

    with_conn(&state, |conn| {
        // 清理旧数据（如果已存在相同 project_id）
        // 注意：部分表没有直接的 project_id 列，需要通过关联删除
        conn.execute("DELETE FROM beat_cards WHERE chapter_id IN (SELECT c.id FROM chapters c JOIN volumes v ON c.volume_id=v.id WHERE v.project_id=?1)", params![project_id]).ok();
        conn.execute("DELETE FROM chapter_contents WHERE chapter_id IN (SELECT c.id FROM chapters c JOIN volumes v ON c.volume_id=v.id WHERE v.project_id=?1)", params![project_id]).ok();
        conn.execute("DELETE FROM chapters WHERE volume_id IN (SELECT id FROM volumes WHERE project_id=?1)", params![project_id]).ok();
        conn.execute("DELETE FROM volumes WHERE project_id=?1", params![project_id]).ok();
        conn.execute("DELETE FROM plot_events WHERE project_id=?1", params![project_id]).ok();
        conn.execute("DELETE FROM timeline_nodes WHERE project_id=?1", params![project_id]).ok();
        conn.execute("DELETE FROM relationship_edges WHERE project_id=?1", params![project_id]).ok();
        conn.execute("DELETE FROM characters WHERE project_id=?1", params![project_id]).ok();
        conn.execute("DELETE FROM world_terms WHERE project_id=?1", params![project_id]).ok();
        // locked_fields 没有 project_id 关联，暂不清理

        // 插入或替换 project
        let locked_at_val: Option<String> = project.get("framework_locked_at").and_then(|v| match v {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) if s.is_empty() => None,
            serde_json::Value::String(s) => Some(s.clone()),
            other => other.as_str().map(String::from),
        });
        conn.execute(
            "INSERT OR REPLACE INTO projects (id, name, stage, framework_locked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                project_id,
                project_name,
                project.get("stage").and_then(|v| v.as_str()).unwrap_or("ideation"),
                locked_at_val,
                project.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
                project.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""),
            ],
        )?;

        // 从 serde_json::Value 中提取字符串值
        fn json_str(val: &serde_json::Value, field: &str) -> String {
            val.get(field).and_then(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                serde_json::Value::Bool(b) => Some(b.to_string()),
                serde_json::Value::Null => Some(String::new()),
                _ => Some(v.to_string()),
            }).unwrap_or_default()
        }

        /// 从 serde_json::Value 中提取 i64 值
        fn json_i64(val: &serde_json::Value, field: &str) -> i64 {
            val.get(field).and_then(|v| match v {
                serde_json::Value::Bool(b) => Some(*b as i64),
                serde_json::Value::String(s) => s.parse().ok(),
                _ => v.as_i64(),
            }).unwrap_or(0)
        }

        /// 从 serde_json::Value 提取 JSON 字符串字段，兼容 _json 后缀（"forbidden_json":"[...]"）
        /// 和纯数组字段（"forbidden":[...]），以便导入浏览器导出的数据
        fn json_str_or_arr(val: &serde_json::Value, json_field: &str) -> String {
            if let Some(v) = val.get(json_field) {
                match v {
                    serde_json::Value::String(s) => return s.clone(),
                    _ => return v.to_string(),
                }
            }
            let arr_field = json_field.strip_suffix("_json").unwrap_or(json_field);
            if let Some(v) = val.get(arr_field) {
                if v.is_array() {
                    return v.to_string();
                }
                if let Some(s) = v.as_str() {
                    return s.to_string();
                }
                return v.to_string();
            }
            String::new()
        }

        // 批量插入各表（列名需与 schema.sql 一致）
        if let Some(items) = project_data.get("worldTerms").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO world_terms (id, project_id, term_type, title, one_liner, detail, ring_level, forbidden_json, is_locked, layout_x, layout_y) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"), json_str(item, "term_type"),
                        json_str(item, "title"), json_str(item, "one_liner"), json_str(item, "detail"),
                        json_i64(item, "ring_level"), json_str_or_arr(item, "forbidden_json"),
                        json_i64(item, "is_locked"), json_str(item, "layout_x"), json_str(item, "layout_y"),
                    ],
                ).ok();
            }
        }

        // characters
        if let Some(items) = project_data.get("characters").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO characters (id, project_id, name, gender, age, race, appearance, personality, background, ability, style, interests, faction, weight, desire, fear, flaw, arc, voice_style, ending_node_id, avatar_path, layout_x, layout_y, is_locked, snapshots_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"), json_str(item, "name"),
                        json_str(item, "gender"), json_str(item, "age"), json_str(item, "race"),
                        json_str(item, "appearance"), json_str(item, "personality"), json_str(item, "background"),
                        json_str(item, "ability"), json_str(item, "style"), json_str(item, "interests"),
                        json_str(item, "faction"), json_i64(item, "weight"),
                        json_str(item, "desire"), json_str(item, "fear"), json_str(item, "flaw"),
                        json_str(item, "arc"), json_str(item, "voice_style"), json_str(item, "ending_node_id"),
                        json_str(item, "avatar_path"), json_str(item, "layout_x"), json_str(item, "layout_y"),
                        json_i64(item, "is_locked"), json_str_or_arr(item, "snapshots_json"),
                    ],
                ).ok();
            }
        }

        // relationship_edges
        if let Some(items) = project_data.get("relationships").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO relationship_edges (id, project_id, source_id, target_id, relation_type, strength, is_secret) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"),
                        json_str(item, "source_id"), json_str(item, "target_id"),
                        json_str(item, "relation_type"), json_i64(item, "strength"),
                        json_i64(item, "is_secret"),
                    ],
                ).ok();
            }
        }

        // plot_events
        if let Some(items) = project_data.get("plotEvents").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO plot_events (id, project_id, line_type, title, chapter_start, chapter_end, reader_knowledge, truth_content, plant_method, convergence_chapter, is_locked, character_ids_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"), json_str(item, "line_type"),
                        json_str(item, "title"), json_i64(item, "chapter_start"), json_i64(item, "chapter_end"),
                        json_str(item, "reader_knowledge"), json_str(item, "truth_content"),
                        json_str(item, "plant_method"), json_i64(item, "convergence_chapter"),
                        json_i64(item, "is_locked"), json_str_or_arr(item, "character_ids_json"),
                    ],
                ).ok();
            }
        }

        // timeline_nodes
        if let Some(items) = project_data.get("timelineNodes").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO timeline_nodes (id, project_id, type, title, summary, volume_id, sort_order, is_locked, layout_y, must_achieve_json, character_ids_json, linked_chapter_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"), json_str(item, "type"),
                        json_str(item, "title"), json_str(item, "summary"), json_str(item, "volume_id"),
                        json_i64(item, "sort_order"), json_i64(item, "is_locked"), json_str(item, "layout_y"),
                        json_str_or_arr(item, "must_achieve_json"), json_str_or_arr(item, "character_ids_json"),
                        json_str(item, "linked_chapter_id"),
                    ],
                ).ok();
            }
        }

        // volumes
        if let Some(items) = project_data.get("volumes").and_then(|v| v.as_array()) {
            for item in items {
                conn.execute(
                    "INSERT OR REPLACE INTO volumes (id, project_id, title, sort_order) VALUES (?1,?2,?3,?4)",
                    params![
                        json_str(item, "id"), json_str(item, "project_id"),
                        json_str(item, "title"), json_i64(item, "sort_order"),
                    ],
                ).ok();
            }
        }

        // chapters
        if let Some(chapters) = project_data.get("chapters").and_then(|v| v.as_array()) {
            for ch in chapters {
                conn.execute(
                    "INSERT OR REPLACE INTO chapters (id, volume_id, number, title, status, word_count) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        json_str(ch, "id"), json_str(ch, "volume_id"), json_i64(ch, "number"),
                        json_str(ch, "title"), json_str(ch, "status"), json_i64(ch, "word_count"),
                    ],
                ).ok();
            }
        }

        // beatCards
        if let Some(cards) = project_data.get("beatCards").and_then(|v| v.as_array()) {
            for card in cards {
                conn.execute(
                    "INSERT OR REPLACE INTO beat_cards (id, chapter_id, column_type, content, sort_order) VALUES (?1,?2,?3,?4,?5)",
                    params![
                        json_str(card, "id"), json_str(card, "chapter_id"),
                        json_str(card, "column_type"), json_str(card, "content"),
                        json_i64(card, "sort_order"),
                    ],
                ).ok();
            }
        }

        // chapterContents
        if let Some(contents) = project_data.get("chapterContents").and_then(|v| v.as_array()) {
            for content in contents {
                conn.execute(
                    "INSERT OR REPLACE INTO chapter_contents (chapter_id, body_json, body_html, updated_at) VALUES (?1,?2,?3,?4)",
                    params![
                        json_str(content, "chapter_id"), json_str(content, "body_json"),
                        json_str(content, "body_html"), json_str(content, "updated_at"),
                    ],
                ).ok();
            }
        }

        Ok(project_id)
    })
    .map(|pid| format!("项目 {} 导入成功", pid))
    .map_err(|e| e.to_string())
}

fn open_or_create_settings_db() -> rusqlite::Connection {
    let dir = crate::db::data_dir();
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("settings.db");
    let conn = rusqlite::Connection::open(&path).unwrap_or_else(|e| {
        // 降级：如果 settings.db 打不开，用内存数据库保证不崩溃
        eprintln!("[WARN] 无法打开 settings.db ({}), 使用内存数据库降级", e);
        rusqlite::Connection::open_in_memory().expect("内存数据库也失败")
    });
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
    ).ok();
    conn
}

// ===== v2.0: 风格指南/故事铁则/章节摘要 =====

fn get_setting_json(key: String, state: State<'_, DbState>) -> Result<Option<serde_json::Value>, String> {
    let raw = get_setting(key, state)?;
    match raw {
        Some(s) if !s.is_empty() => {
            serde_json::from_str(&s)
                .map(Some)
                .map_err(|e| format!("解析 JSON 失败: {}", e))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn get_style_guide(project_id: String, state: State<'_, DbState>) -> Result<Option<serde_json::Value>, String> {
    get_setting_json(format!("novel-workbench-style-{}", project_id), state)
}

#[tauri::command]
pub fn save_style_guide(guide: serde_json::Value, state: State<'_, DbState>) -> Result<(), String> {
    let pid = guide["project_id"].as_str().unwrap_or("");
    set_setting(format!("novel-workbench-style-{}", pid), guide.to_string(), state)
}

#[tauri::command]
pub fn get_story_bible(project_id: String, state: State<'_, DbState>) -> Result<Option<serde_json::Value>, String> {
    get_setting_json(format!("novel-workbench-bible-{}", project_id), state)
}

#[tauri::command]
pub fn save_story_bible(bible: serde_json::Value, state: State<'_, DbState>) -> Result<(), String> {
    let pid = bible["project_id"].as_str().unwrap_or("");
    set_setting(format!("novel-workbench-bible-{}", pid), bible.to_string(), state)
}

#[tauri::command]
pub fn get_chapter_summaries(project_id: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let log_key = format!("novel-workbench-log-{}", project_id);
    let raw = get_setting(log_key, state)?;
    match raw {
        Some(s) if !s.is_empty() => {
            serde_json::from_str(&s).map_err(|e| format!("解析 JSON 失败: {}", e))
        }
        _ => Ok(serde_json::Value::Array(vec![])),
    }
}

fn read_table(conn: &rusqlite::Connection, sql: &str, params: impl rusqlite::Params) -> Result<Vec<Value>, rusqlite::Error> {
    use rusqlite::types::ValueRef;
    let mut stmt = conn.prepare(sql)?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .filter_map(|i| stmt.column_name(i).ok().map(String::from))
        .collect();

    let rows = stmt.query_map(params, |row| {
        let mut map = serde_json::Map::new();
        for i in 0..col_count {
            let name = &col_names[i];
            let val = match row.get_ref(i) {
                Ok(ValueRef::Null) => Value::Null,
                Ok(ValueRef::Integer(n)) => Value::Number(serde_json::Number::from(n)),
                Ok(ValueRef::Real(f)) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
                Ok(ValueRef::Text(s)) => Value::String(String::from_utf8_lossy(s).to_string()),
                Ok(ValueRef::Blob(b)) => Value::String(format!("[blob {} bytes]", b.len())),
                Err(_) => Value::Null,
            };
            map.insert(name.clone(), val);
        }
        Ok(Value::Object(map))
    })?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}
