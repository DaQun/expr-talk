use crate::asr::{download_model_to_app_data, model_status, test_online_provider, AsrHandle};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrProviderInfo {
    pub id: String,
    pub name: String,
    pub local: bool,
    pub capabilities: Value,
}

#[tauri::command]
pub async fn asr_list_providers() -> Result<Vec<AsrProviderInfo>, String> {
    Ok(vec![
        AsrProviderInfo {
            id: "local-sherpa".into(),
            name: "本地 Sherpa-ONNX（需手动下载模型）".into(),
            local: true,
            capabilities: json!({
                "streaming": true,
                "batch": false,
                "wordTimestamps": false,
                "speakerDiarization": false,
                "punctuation": false
            }),
        },
        AsrProviderInfo {
            id: "aliyun-bailian".into(),
            name: "阿里云百炼（DashScope 实时）".into(),
            local: false,
            capabilities: json!({
                "streaming": true,
                "batch": false,
                "wordTimestamps": false,
                "speakerDiarization": false,
                "punctuation": true
            }),
        },
        AsrProviderInfo {
            id: "tencent-asr".into(),
            name: "腾讯云实时语音识别".into(),
            local: false,
            capabilities: json!({
                "streaming": true,
                "batch": false,
                "wordTimestamps": false,
                "speakerDiarization": false,
                "punctuation": true
            }),
        },
        AsrProviderInfo {
            id: "volcengine-asr".into(),
            name: "火山引擎流式语音识别".into(),
            local: false,
            capabilities: json!({
                "streaming": true,
                "batch": false,
                "wordTimestamps": false,
                "speakerDiarization": false,
                "punctuation": true
            }),
        },
    ])
}

#[tauri::command]
pub async fn asr_model_status(app: AppHandle) -> Result<Value, String> {
    let status = model_status(&app);
    Ok(json!(status))
}

/// 用户手动触发：下载本地 streaming zipformer 到 app data
#[tauri::command]
pub async fn asr_download_model(
    app: AppHandle,
    asr: State<'_, AsrHandle>,
) -> Result<Value, String> {
    let app2 = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || download_model_to_app_data(&app2))
        .await
        .map_err(|e| format!("download task: {e}"))??;
    // 下载成功后尝试预加载
    if status.ready {
        asr.preload_local();
    }
    Ok(json!(status))
}

/// 对已保存的 WAV 做离线转写（实时字幕为空时的补救）
#[tauri::command]
pub async fn asr_transcribe_file(
    asr: State<'_, AsrHandle>,
    path: String,
) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("音频路径为空".into());
    }
    let path = path.trim().to_string();
    let handle = asr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || handle.transcribe_file(path))
        .await
        .map_err(|e| format!("transcribe task: {e}"))?
}

#[tauri::command]
pub async fn asr_test_provider(
    app: AppHandle,
    _asr: State<'_, AsrHandle>,
    config: Value,
) -> Result<Value, String> {
    let provider = config
        .get("providerId")
        .or_else(|| config.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("local-sherpa");

    match provider {
        "local-sherpa" => {
            let status = model_status(&app);
            if status.ready {
                Ok(json!({
                    "ok": true,
                    "message": status.hint,
                    "modelDir": status.model_dir
                }))
            } else {
                Ok(json!({
                    "ok": false,
                    "message": status.hint,
                    "missing": status.missing,
                    "modelDir": status.model_dir
                }))
            }
        }
        "aliyun-bailian" => {
            let key = config
                .get("apiKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if key.is_empty() {
                Ok(json!({ "ok": false, "message": "请填写百炼 API Key" }))
            } else {
                Ok(json!({
                    "ok": true,
                    "message": format!(
                        "凭证已填写，将使用 {}",
                        config.get("model").and_then(|m| m.as_str()).unwrap_or("paraformer-realtime-v2")
                    )
                }))
            }
        }
        "tencent-asr" => {
            let sid = config
                .get("secretId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let skey = config
                .get("secretKey")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let app_id = config.get("appId").and_then(|v| v.as_str()).unwrap_or("");
            if sid.is_empty() || skey.is_empty() || app_id.is_empty() {
                Ok(json!({ "ok": false, "message": "需要 SecretId、SecretKey、AppId" }))
            } else {
                Ok(json!({ "ok": true, "message": "腾讯云凭证已填写" }))
            }
        }
        "volcengine-asr" => {
            let app_id = config.get("appId").and_then(|v| v.as_str()).unwrap_or("");
            let token = config
                .get("accessToken")
                .or_else(|| config.get("apiKey"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if app_id.is_empty() || token.is_empty() {
                Ok(json!({ "ok": false, "message": "需要 AppId 与 Access Token" }))
            } else {
                let config_for_test = config.clone();
                match tauri::async_runtime::spawn_blocking(move || {
                    test_online_provider("volcengine-asr", &config_for_test)
                })
                .await
                .map_err(|e| format!("火山引擎检测任务失败: {e}"))?
                {
                    Ok(()) => Ok(json!({
                        "ok": true,
                        "message": "火山引擎连接与鉴权成功"
                    })),
                    Err(error) => Ok(json!({
                        "ok": false,
                        "message": error
                    })),
                }
            }
        }
        other => Ok(json!({ "ok": false, "message": format!("未知 provider: {other}") })),
    }
}
