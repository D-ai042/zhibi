use crate::models::{AiRequest, AiResponse};
use serde_json::json;
use std::path::PathBuf;

fn config_path() -> PathBuf {
    crate::db::data_dir().join("config.json")
}

fn load_ai_config() -> (String, String, String) {
    // Returns (base_url, model, api_key)
    let path = config_path();
    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&raw) {
                let base = cfg["api_base_url"].as_str().unwrap_or("https://api.deepseek.com").to_string();
                let model = cfg["api_model"].as_str().unwrap_or("deepseek-chat").to_string();
                let mut key = String::new();
                // Try snake_case first
                if let Some(pks) = cfg["provider_keys"].as_object() {
                    for (_provider, v) in pks {
                        if let Some(k) = v.as_str() {
                            if !k.is_empty() { key = k.to_string(); break; }
                        }
                    }
                }
                return (base, model, key);
            }
        }
    }
    ("https://api.deepseek.com".into(), "deepseek-chat".into(), String::new())
}

#[tauri::command]
pub async fn ai_complete(request: AiRequest) -> Result<AiResponse, String> {
    let (base, model, key) = load_ai_config();
    if key.is_empty() {
        return Ok(AiResponse {
            content: String::new(),
            citations: vec![],
            error: Some("请先在设置中配置 API Key".into()),
        });
    }

    let extra = request.extra.clone().unwrap_or(serde_json::json!({}));

    // 匹配浏览器 mock-backend 的上下文拼接方式
    let system_hint = extra
        .get("system_hint")
        .and_then(|v| v.as_str())
        .unwrap_or("你是小说创作助手。");

    let context = extra
        .get("context")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let full_system_hint = if context.is_empty() {
        system_hint.to_string()
    } else {
        format!("{}\n\n===== 项目数据参考 =====\n{}", system_hint, context)
    };

    // 构建 messages 数组，匹配浏览器：system + history + user_message
    let mut messages: Vec<serde_json::Value> = vec![
        json!({"role": "system", "content": full_system_hint}),
    ];

    if let Some(history) = extra.get("history").and_then(|v| v.as_array()) {
        // 历史除最后一条用户消息
        if history.len() > 1 {
            for msg in &history[..history.len() - 1] {
                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user");
                let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
                if !content.is_empty() {
                    messages.push(json!({"role": role, "content": content}));
                }
            }
        }
    }

    let user_message = extra
        .get("user_message")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if user_message.is_empty() {
        // 非 chat 动作：匹配浏览器行为
        let default_msg = match request.action.as_str() {
            "suggest_turn" => "输出 3 个转折节点草案（JSON 数组）",
            "generate_beats" => "输出 5 列节拍卡片 JSON",
            "continue_writing" => "续写约 500 字",
            _ => &format!("执行动作：{}", request.action),
        };
        messages.push(json!({"role": "user", "content": default_msg}));
    } else {
        messages.push(json!({"role": "user", "content": user_message}));
    }

    let body = json!({
        "model": model,
        "messages": messages,
        "stream": false
    });

    let client = reqwest::Client::new();
    let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("网络错误: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(AiResponse { content: String::new(), citations: vec![], error: Some("API Key 无效 (401)".into()) });
    }
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Ok(AiResponse { content: String::new(), citations: vec![], error: Some("请求过于频繁 (429)".into()) });
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(AiResponse { content, citations: vec![format!("{}#{}", request.entity_type, request.entity_id)], error: None })
}

#[tauri::command]
pub async fn stt_transcribe(audio_base64: String) -> Result<serde_json::Value, String> {
    if audio_base64.is_empty() {
        return Ok(json!({"text": ""}));
    }

    let (_, _, _) = load_ai_config();
    let path = config_path();
    let stt_cfg = if path.exists() {
        std::fs::read_to_string(&path).ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|cfg| cfg.get("stt").cloned())
    } else {
        None
    };

    let stt = stt_cfg.unwrap_or(json!({}));
    let enabled = stt["enabled"].as_bool().unwrap_or(false);
    let active_provider = stt["activeProvider"].as_str().or_else(|| stt["provider"].as_str()).unwrap_or("openai");
    let providers = stt["providers"].as_object().cloned().unwrap_or_default();
    let provider_cfg = providers.get(active_provider).cloned().unwrap_or(json!({}));

    if !enabled {
        return Ok(json!({"text": "（语音识别：请在设置-语音配置中开启）"}));
    }

    if active_provider == "baidu" {
        let api_key = provider_cfg["api_key"].as_str().or_else(|| stt["api_key"].as_str()).unwrap_or("");
        let secret_key = provider_cfg["secret_key"].as_str().or_else(|| stt["secret_key"].as_str()).unwrap_or("");
        if api_key.is_empty() || secret_key.is_empty() {
            return Ok(json!({"text": "（百度语音：请填写 API Key 和 Secret Key）"}));
        }
        // Get access token
        let client = reqwest::Client::new();
        let token_resp = client
            .post(&format!("https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={}&client_secret={}", api_key, secret_key))
            .send().await.map_err(|e| format!("百度 token 请求失败: {}", e))?;
        let token_data: serde_json::Value = token_resp.json().await.map_err(|e| e.to_string())?;
        let token = token_data["access_token"].as_str().ok_or("百度 token 获取失败")?;

        // Calculate binary length
        use base64::Engine;
        let binary_len = base64::engine::general_purpose::STANDARD.decode(&audio_base64).map_err(|e| e.to_string())?.len();

        let resp = client
            .post("https://vop.baidu.com/server_api")
            .json(&json!({
                "format": "wav",
                "rate": 16000,
                "channel": 1,
                "cuid": "novel-workbench",
                "token": token,
                "speech": audio_base64,
                "len": binary_len,
                "dev_pid": 1537,
            }))
            .send().await.map_err(|e| format!("百度识别请求失败: {}", e))?;
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if data["err_no"].as_i64().unwrap_or(-1) == 0 {
            if let Some(result) = data["result"].as_array().and_then(|r| r.first()).and_then(|v| v.as_str()) {
                return Ok(json!({"text": result}));
            }
        }
        let err_msg = data["err_msg"].as_str().unwrap_or("未知错误");
        return Ok(json!({"text": format!("（百度识别失败: {}）", err_msg)}));
    }

    // OpenAI compatible
    let api_key = provider_cfg["api_key"].as_str().or_else(|| stt["api_key"].as_str()).unwrap_or("");
    if api_key.is_empty() {
        return Ok(json!({"text": "（语音识别：请填写 API Key）"}));
    }
    let base_url = provider_cfg["base_url"].as_str().or_else(|| stt["base_url"].as_str()).unwrap_or("https://api.openai.com/v1");
    let model = provider_cfg["model"].as_str().or_else(|| stt["model"].as_str()).unwrap_or("whisper-1");

    use base64::Engine;
    let binary = base64::engine::general_purpose::STANDARD.decode(&audio_base64).map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(binary).file_name("audio.wav").mime_str("audio/wav").map_err(|e| e.to_string())?)
        .text("model", model.to_string());

    let client = reqwest::Client::new();
    let resp = client
        .post(&format!("{}/audio/transcriptions", base_url.trim_end_matches('/')))
        .bearer_auth(api_key)
        .multipart(form)
        .send().await.map_err(|e| format!("STT 请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Ok(json!({"text": format!("（语音识别失败: HTTP {}）", resp.status())}));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = data["text"].as_str().unwrap_or("").to_string();
    Ok(json!({"text": text}))
}
