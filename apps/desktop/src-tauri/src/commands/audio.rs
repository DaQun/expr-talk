use crate::asr::AsrHandle;
use crate::audio::writer::ActiveRecording;
use crate::audio::AudioState;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStartResult {
    pub session_id: String,
    pub audio_path: String,
    pub sample_rate: u32,
    pub asr_enabled: bool,
    pub asr_message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStopResult {
    pub session_id: String,
    pub audio_path: String,
    pub sample_count: u64,
    pub duration_sec: f64,
    pub sample_rate: u32,
    /// 字幕由前端 live segments 汇总；此处不再同步等 ASR，避免死锁卡死
    pub transcript: String,
}

pub(crate) fn recordings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取 app data 目录: {e}"))?;
    let dir = base.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 recordings 目录失败: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub async fn audio_start(
    app: AppHandle,
    state: State<'_, AudioState>,
    asr: State<'_, AsrHandle>,
    session_id: String,
    sample_rate: Option<u32>,
    enable_asr: Option<bool>,
    asr_provider: Option<String>,
    asr_config: Option<serde_json::Value>,
) -> Result<AudioStartResult, String> {
    if session_id.trim().is_empty() {
        return Err("session_id 不能为空".into());
    }
    let sample_rate = sample_rate.unwrap_or(16_000);
    let enable = enable_asr.unwrap_or(true);
    let provider = asr_provider
        .unwrap_or_else(|| "local-sherpa".into())
        .trim()
        .to_string();
    let config = asr_config.unwrap_or_else(|| serde_json::json!({}));

    let app2 = app.clone();
    let sid = session_id.clone();
    let (path, recording) = tauri::async_runtime::spawn_blocking(move || {
        let dir = recordings_dir(&app2)?;
        let path = dir.join(format!("{sid}.wav"));
        let recording = ActiveRecording::open(path.clone(), sample_rate)?;
        Ok::<_, String>((path, recording))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))??;

    {
        let mut map = state
            .recordings
            .lock()
            .map_err(|_| "audio state lock poisoned".to_string())?;
        if map.contains_key(&session_id) {
            return Err(format!("session {session_id} 已在录音中"));
        }
        map.insert(session_id.clone(), recording);
    }

    let (asr_enabled, asr_message) = if enable {
        asr.start_async(session_id.clone(), sample_rate, provider.clone(), config)?;
        (true, format!("录音已开始；ASR（{provider}）后台启动"))
    } else {
        (false, "ASR 已禁用".into())
    };

    Ok(AudioStartResult {
        session_id,
        audio_path: path.to_string_lossy().into_owned(),
        sample_rate,
        asr_enabled,
        asr_message,
    })
}

#[tauri::command]
pub async fn audio_append_pcm(
    state: State<'_, AudioState>,
    asr: State<'_, AsrHandle>,
    session_id: String,
    pcm: Vec<i16>,
) -> Result<(), String> {
    if pcm.is_empty() {
        return Ok(());
    }
    {
        let mut map = state
            .recordings
            .lock()
            .map_err(|_| "audio state lock poisoned".to_string())?;
        let rec = map
            .get_mut(&session_id)
            .ok_or_else(|| format!("未找到录音 session: {session_id}"))?;
        rec.append_i16(&pcm)?;
    }
    asr.feed(session_id, pcm);
    Ok(())
}

#[tauri::command]
pub async fn audio_append_pcm_bytes(
    state: State<'_, AudioState>,
    asr: State<'_, AsrHandle>,
    session_id: String,
    pcm: Vec<u8>,
) -> Result<(), String> {
    if pcm.is_empty() {
        return Ok(());
    }
    if pcm.len() % 2 != 0 {
        return Err("pcm bytes length must be even".into());
    }
    let mut samples = Vec::with_capacity(pcm.len() / 2);
    for chunk in pcm.chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }
    {
        let mut map = state
            .recordings
            .lock()
            .map_err(|_| "audio state lock poisoned".to_string())?;
        let rec = map
            .get_mut(&session_id)
            .ok_or_else(|| format!("未找到录音 session: {session_id}"))?;
        rec.append_i16(&samples)?;
    }
    asr.feed(session_id, samples);
    Ok(())
}

/// 解析某 session 的录音文件路径（文件可不存在，仅拼路径）
#[tauri::command]
pub async fn audio_recording_path(
    app: AppHandle,
    session_id: String,
) -> Result<Option<String>, String> {
    if session_id.trim().is_empty() {
        return Ok(None);
    }
    let dir = recordings_dir(&app)?;
    let session_id = session_id.trim();
    let direct = dir.join(format!("{session_id}.wav"));
    let mut candidates = if direct.is_file() { vec![direct] } else { Vec::new() };
    if candidates.is_empty() {
        let prefix = format!("{session_id}_turn_");
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let matches = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".wav"));
            if matches {
                candidates.push(path);
            }
        }
    }
    candidates.sort_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok());
    let Some(path) = candidates.pop() else { return Ok(None); };
    super::super::audio::wav::repair_wav_file(&path)
        .map_err(|e| format!("修复中断录音失败: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// 结束 WAV 并等待 ASR flush；耗时工作均在 blocking 池中执行。
#[tauri::command]
pub async fn audio_stop(
    state: State<'_, AudioState>,
    asr: State<'_, AsrHandle>,
    session_id: String,
) -> Result<AudioStopResult, String> {
    let rec = {
        let mut map = state
            .recordings
            .lock()
            .map_err(|_| "audio state lock poisoned".to_string())?;
        map.remove(&session_id)
            .ok_or_else(|| format!("未找到录音 session: {session_id}"))?
    };

    // 等待 ASR flush，确保最后一个句段在前端注销监听前发出。
    let asr_session_id = session_id.clone();
    let asr2 = asr.inner().clone();
    let transcript = tauri::async_runtime::spawn_blocking(move || asr2.stop(asr_session_id))
        .await
        .map_err(|e| format!("ASR stop task: {e}"))?
        .unwrap_or_default();

    let (path, sample_count, sample_rate) =
        tauri::async_runtime::spawn_blocking(move || rec.finish())
            .await
            .map_err(|e| format!("spawn_blocking: {e}"))??;

    let duration_sec = if sample_rate == 0 {
        0.0
    } else {
        sample_count as f64 / f64::from(sample_rate)
    };

    Ok(AudioStopResult {
        session_id,
        audio_path: path.to_string_lossy().into_owned(),
        sample_count,
        duration_sec,
        sample_rate,
        transcript,
    })
}

/// 删除一轮录音。若仍在录音，先正常收尾，避免留下损坏的 WAV。
#[tauri::command]
pub async fn audio_discard(
    app: AppHandle,
    state: State<'_, AudioState>,
    asr: State<'_, AsrHandle>,
    session_id: String,
) -> Result<(), String> {
    let rec = {
        let mut map = state
            .recordings
            .lock()
            .map_err(|_| "audio state lock poisoned".to_string())?;
        map.remove(&session_id)
    };

    asr.stop_async(session_id.clone());

    let path = if let Some(rec) = rec {
        let (path, _, _) = tauri::async_runtime::spawn_blocking(move || rec.finish())
            .await
            .map_err(|e| format!("finish discarded recording: {e}"))??;
        path
    } else {
        recordings_dir(&app)?.join(format!("{}.wav", session_id.trim()))
    };

    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("删除录音失败: {e}"))?;
    }
    Ok(())
}
