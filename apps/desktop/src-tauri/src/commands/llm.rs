use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderInfo {
    pub id: String,
    pub name: String,
    pub local: bool,
    pub supports_structured_output: bool,
}

#[tauri::command]
pub fn llm_list_providers() -> Vec<LlmProviderInfo> {
    vec![
        LlmProviderInfo {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            local: false,
            supports_structured_output: true,
        },
        LlmProviderInfo {
            id: "openai".into(),
            name: "OpenAI Compatible".into(),
            local: false,
            supports_structured_output: true,
        },
        LlmProviderInfo {
            id: "ollama".into(),
            name: "Ollama (Local)".into(),
            local: true,
            supports_structured_output: true,
        },
    ]
}

#[tauri::command]
pub fn llm_test_provider(config: Value) -> Value {
    let _ = config;
    json!({
        "ok": false,
        "message": "LLM provider 探测尚未实现"
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequest {
    pub url: String,
    pub api_key: Option<String>,
    pub body: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatResponse {
    pub status: u16,
    pub content_type: String,
    pub body: String,
}

fn validate_completion_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|e| format!("LLM URL 无效：{e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("LLM URL 仅支持 http/https".into());
    }
    if url.host_str().is_none() {
        return Err("LLM URL 缺少主机名".into());
    }
    Ok(url)
}

fn build_models_url(base_url: &str) -> Result<url::Url, String> {
    let base_url = base_url.trim();
    if base_url.is_empty() {
        return Err("请先填写 LLM Base URL".into());
    }
    validate_completion_url(&format!("{}/models", base_url.trim_end_matches('/')))
}

fn model_id(value: &Value) -> Option<&str> {
    match value {
        Value::String(id) => Some(id),
        Value::Object(item) => item
            .get("id")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("model"))
            .and_then(Value::as_str),
        _ => None,
    }
}

fn parse_model_list(body: &str) -> Result<Vec<String>, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|e| format!("模型列表不是有效 JSON：{e}"))?;
    let items = match &value {
        Value::Array(items) => Some(items),
        Value::Object(root) => root
            .get("data")
            .or_else(|| root.get("models"))
            .and_then(Value::as_array),
        _ => None,
    }
    .ok_or_else(|| "模型列表响应缺少 data 或 models 数组".to_string())?;

    let mut models: Vec<String> = items
        .iter()
        .filter_map(model_id)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();
    models.sort_unstable();
    models.dedup();

    if models.is_empty() {
        return Err("接口未返回可用模型".into());
    }
    Ok(models)
}

fn response_excerpt(body: &str) -> String {
    let excerpt: String = body.chars().take(300).collect();
    if body.chars().count() > 300 {
        format!("{excerpt}...")
    } else {
        excerpt
    }
}

#[tauri::command]
pub async fn llm_list_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let url = build_models_url(&base_url)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 LLM HTTP 客户端失败：{e}"))?;

    let mut builder = client.get(url);
    if let Some(api_key) = api_key.filter(|key| !key.trim().is_empty()) {
        builder = builder.bearer_auth(api_key);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| format!("获取模型列表失败：{e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取模型列表失败：{e}"))?;

    if !status.is_success() {
        return Err(format!(
            "获取模型列表失败（HTTP {}）：{}",
            status.as_u16(),
            response_excerpt(&body)
        ));
    }
    parse_model_list(&body)
}

#[tauri::command]
pub async fn llm_chat_completion(request: LlmChatRequest) -> Result<LlmChatResponse, String> {
    let url = validate_completion_url(&request.url)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(125))
        .build()
        .map_err(|e| format!("创建 LLM HTTP 客户端失败：{e}"))?;

    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&request.body);
    if let Some(api_key) = request.api_key.filter(|key| !key.trim().is_empty()) {
        builder = builder.bearer_auth(api_key);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("LLM 原生请求失败：{e}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 LLM 响应失败：{e}"))?;

    Ok(LlmChatResponse {
        status,
        content_type,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_models_url, parse_model_list, validate_completion_url};

    #[test]
    fn accepts_http_completion_urls() {
        assert!(validate_completion_url("https://example.test/v1/chat/completions").is_ok());
        assert!(validate_completion_url("http://127.0.0.1:11434/v1/chat/completions").is_ok());
    }

    #[test]
    fn rejects_non_http_urls() {
        assert!(validate_completion_url("file:///tmp/key").is_err());
        assert!(validate_completion_url("not-a-url").is_err());
    }

    #[test]
    fn builds_models_url_from_base_url() {
        let url = build_models_url(" https://example.test/v1/ ").unwrap();
        assert_eq!(url.as_str(), "https://example.test/v1/models");
    }

    #[test]
    fn parses_openai_model_list() {
        let models =
            parse_model_list(r#"{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"}]}"#)
                .unwrap();
        assert_eq!(models, vec!["model-a", "model-b"]);
    }

    #[test]
    fn parses_compatible_model_lists() {
        assert_eq!(
            parse_model_list(r#"{"models":[{"name":"qwen2.5"},{"model":"llama3"}]}"#).unwrap(),
            vec!["llama3", "qwen2.5"]
        );
        assert_eq!(
            parse_model_list(r#"["model-b","model-a"]"#).unwrap(),
            vec!["model-a", "model-b"]
        );
    }
}
