mod asr;
mod audio;
mod commands;
mod db;

use asr::AsrHandle;
use audio::AudioState;
use commands::{
    asr::{
        asr_download_model, asr_list_providers, asr_model_status, asr_test_provider,
        asr_transcribe_file,
    },
    audio::{
        audio_append_pcm, audio_append_pcm_bytes, audio_discard, audio_recording_path, audio_start,
        audio_stop,
    },
    history::{
        app_health, history_export, history_get, history_list, history_storage_stats,
        profile_sessions, session_delete_complete, session_upsert,
    },
    llm::{llm_chat_completion, llm_list_models, llm_list_providers, llm_test_provider},
    session::{session_analyze, session_create, session_start_recording, session_stop_recording},
    settings_cmd::{settings_get, settings_save},
};
use db::{open_db, reconcile_interrupted_sessions};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = AsrHandle::spawn(app.handle().clone());
            // 启动时预加载本地模型（若已就绪），避免首句录音时才冷启动
            handle.preload_local();
            app.manage(handle);
            app.manage(AudioState::default());
            let db = open_db(app.handle())?;
            reconcile_interrupted_sessions(&db)?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_health,
            session_create,
            session_start_recording,
            session_stop_recording,
            session_analyze,
            session_upsert,
            session_delete_complete,
            audio_start,
            audio_append_pcm,
            audio_append_pcm_bytes,
            audio_recording_path,
            audio_stop,
            audio_discard,
            asr_list_providers,
            asr_test_provider,
            asr_model_status,
            asr_download_model,
            asr_transcribe_file,
            llm_list_providers,
            llm_list_models,
            llm_test_provider,
            llm_chat_completion,
            history_list,
            history_get,
            history_export,
            history_storage_stats,
            profile_sessions,
            settings_get,
            settings_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
