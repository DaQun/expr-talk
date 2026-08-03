use crate::audio::AudioState;
use crate::commands::audio::recordings_dir;
use crate::db::{
    count_sessions, delete_all_sessions, delete_session, list_export_sessions,
    list_profile_sessions, list_sessions, load_session, upsert_session, DbState, HistoryQuery,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use zip::write::SimpleFileOptions;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStorageStats {
    session_count: u64,
    audio_count: u64,
    audio_bytes: u64,
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, DbState>,
    query: Option<HistoryQuery>,
) -> Result<Vec<Value>, String> {
    list_sessions(&state, query)
}

#[tauri::command]
pub async fn history_get(state: State<'_, DbState>, id: String) -> Result<Option<Value>, String> {
    load_session(&state, &id)
}

#[tauri::command]
pub async fn profile_sessions(state: State<'_, DbState>) -> Result<Vec<Value>, String> {
    list_profile_sessions(&state)
}

#[tauri::command]
pub async fn session_upsert(state: State<'_, DbState>, session: Value) -> Result<Value, String> {
    upsert_session(&state, session)
}

fn wav_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| format!("读取录音目录失败: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("wav") {
            files.push(path);
        }
    }
    Ok(files)
}

fn safe_recording_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

fn add_recording_path(paths: &mut HashSet<PathBuf>, recordings: &Path, raw: &str) {
    let path = PathBuf::from(raw);
    if path.parent() == Some(recordings)
        && path.extension().and_then(|ext| ext.to_str()) == Some("wav")
    {
        paths.insert(path);
    }
}

fn add_session_named_recordings(
    paths: &mut HashSet<PathBuf>,
    recordings: &Path,
    session_id: &str,
) -> Result<(), String> {
    if !safe_recording_id(session_id) {
        return Ok(());
    }
    let direct_name = format!("{session_id}.wav");
    let turn_prefix = format!("{session_id}_turn_");
    for path in wav_files(recordings)? {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name == direct_name || name.starts_with(&turn_prefix) {
            paths.insert(path);
        }
    }
    Ok(())
}

fn session_audio_paths(session: &Value, recordings: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = HashSet::new();
    if let Some(path) = session.get("audioFile").and_then(Value::as_str) {
        add_recording_path(&mut paths, recordings, path);
    }
    if let Some(turns) = session.pointer("/debate/turns").and_then(Value::as_array) {
        for turn in turns {
            if let Some(path) = turn.get("audioFile").and_then(Value::as_str) {
                add_recording_path(&mut paths, recordings, path);
            }
            if let Some(id) = turn.get("audioRecordingId").and_then(Value::as_str) {
                if safe_recording_id(id) {
                    paths.insert(recordings.join(format!("{id}.wav")));
                }
            }
        }
    }
    if let Some(id) = session.get("id").and_then(Value::as_str) {
        add_session_named_recordings(&mut paths, recordings, id)?;
    }
    Ok(paths.into_iter().filter(|path| path.is_file()).collect())
}

fn stage_files(
    app: &AppHandle,
    files: Vec<PathBuf>,
) -> Result<(PathBuf, Vec<(PathBuf, PathBuf)>), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let trash = base
        .join("delete-staging")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&trash).map_err(|e| format!("创建删除暂存目录失败: {e}"))?;
    let mut moved = Vec::new();
    for (index, source) in files.into_iter().enumerate() {
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("recording.wav");
        let target = trash.join(format!("{index}-{name}"));
        if let Err(error) = std::fs::rename(&source, &target) {
            restore_files(&trash, &moved);
            return Err(format!("暂存录音失败: {error}"));
        }
        moved.push((source, target));
    }
    Ok((trash, moved))
}

fn restore_files(trash: &Path, moved: &[(PathBuf, PathBuf)]) {
    for (original, staged) in moved.iter().rev() {
        let _ = std::fs::rename(staged, original);
    }
    let _ = std::fs::remove_dir_all(trash);
}

#[tauri::command]
pub async fn session_delete_complete(
    app: AppHandle,
    db: State<'_, DbState>,
    audio: State<'_, AudioState>,
    id: Option<String>,
) -> Result<(), String> {
    if !audio
        .recordings
        .lock()
        .map_err(|_| "audio state lock poisoned".to_string())?
        .is_empty()
    {
        return Err("仍有录音正在进行，请先停止或放弃录音后再删除记录。".into());
    }
    let recordings = recordings_dir(&app)?;
    let files = if let Some(session_id) = id.as_deref() {
        let session = load_session(&db, session_id)?.ok_or_else(|| "练习记录不存在".to_string())?;
        session_audio_paths(&session, &recordings)?
    } else {
        wav_files(&recordings)?
    };
    let (trash, moved) = stage_files(&app, files)?;
    let result = match id.as_deref() {
        Some(session_id) => delete_session(&db, session_id),
        None => delete_all_sessions(&db),
    };
    if let Err(error) = result {
        restore_files(&trash, &moved);
        return Err(error);
    }
    let _ = std::fs::remove_dir_all(trash);
    Ok(())
}

#[tauri::command]
pub async fn history_storage_stats(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryStorageStats, String> {
    let files = wav_files(&recordings_dir(&app)?)?;
    let audio_bytes = files
        .iter()
        .filter_map(|path| path.metadata().ok())
        .map(|metadata| metadata.len())
        .sum();
    Ok(HistoryStorageStats {
        session_count: count_sessions(&db)?,
        audio_count: files.len() as u64,
        audio_bytes,
    })
}

#[tauri::command]
pub async fn history_export(app: AppHandle, db: State<'_, DbState>) -> Result<String, String> {
    let sessions = list_export_sessions(&db)?;
    let recordings = recordings_dir(&app)?;
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let output = base.join(format!(
        "ExprTalk-backup-{}.zip",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    let file = File::create(&output).map_err(|e| format!("创建备份失败: {e}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive
        .start_file("sessions.json", options)
        .map_err(|e| e.to_string())?;
    archive
        .write_all(
            serde_json::to_string_pretty(&sessions)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
    for path in wav_files(&recordings)? {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        archive
            .start_file(format!("recordings/{name}"), options)
            .map_err(|e| e.to_string())?;
        let mut audio = File::open(&path).map_err(|e| e.to_string())?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = audio.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            archive
                .write_all(&buffer[..read])
                .map_err(|e| e.to_string())?;
        }
    }
    archive.finish().map_err(|e| e.to_string())?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn app_health() -> Value {
    json!({ "ok": true, "name": "ExprTalk", "version": "0.1.0" })
}

#[cfg(test)]
mod tests {
    use super::session_audio_paths;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn includes_orphaned_turn_recordings_for_a_session_only() {
        let recordings =
            std::env::temp_dir().join(format!("expr-talk-history-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&recordings).unwrap();
        for name in [
            "session-a.wav",
            "session-a_turn_2_orphan.wav",
            "session-a-other.wav",
            "session-a2_turn_1_other.wav",
        ] {
            std::fs::write(recordings.join(name), b"wav").unwrap();
        }

        let paths = session_audio_paths(&json!({ "id": "session-a" }), &recordings)
            .unwrap()
            .into_iter()
            .filter_map(|path| path.file_name()?.to_str().map(str::to_owned))
            .collect::<HashSet<_>>();

        assert_eq!(
            paths,
            HashSet::from([
                "session-a.wav".to_string(),
                "session-a_turn_2_orphan.wav".to_string(),
            ])
        );
        std::fs::remove_dir_all(recordings).unwrap();
    }
}
