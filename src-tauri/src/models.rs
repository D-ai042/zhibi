use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub stage: String,
    pub framework_locked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameworkProgress {
    pub worldview: i32,
    pub characters: i32,
    pub plot_direction: i32,
    pub beats: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldTerm {
    pub id: String,
    pub project_id: String,
    pub term_type: String,
    pub title: String,
    pub one_liner: String,
    pub detail: String,
    pub ring_level: i32,
    pub forbidden_json: String,
    pub is_locked: bool,
    pub layout_x: f64,
    pub layout_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub api_base_url: String,
    pub api_model: String,
    pub has_api_key: bool,
    #[serde(default)]
    pub provider_keys: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub provider_base_urls: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub provider_models: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub stt: SttConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderSttConfig {
    #[serde(default, alias = "apiKey")]
    pub api_key: String,
    #[serde(default, alias = "secretKey")]
    pub secret_key: String,
    #[serde(default, alias = "baseUrl")]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SttConfig {
    #[serde(default)]
    pub active_provider: String,
    #[serde(default)]
    pub providers: std::collections::HashMap<String, ProviderSttConfig>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRequest {
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    #[serde(default)]
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResponse {
    pub content: String,
    pub citations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
