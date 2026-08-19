use super::engine::{AsrEngine, DecodeTick, SessionStream};
use super::online::{is_online_provider, open_online_session, OnlineEvent, OnlineSession};
use super::paths::{model_status, resolve_model_dir};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrEventPayload {
    pub session_id: String,
    pub r#type: String,
    pub segment_id: String,
    pub text: String,
    pub is_final: bool,
    pub message: Option<String>,
}

enum AsrCmd {
    /// 仅当用户主动下载/启用本地模型后，才预加载
    PreloadLocal,
    Start {
        session_id: String,
        sample_rate: u32,
        /// local-sherpa | aliyun-bailian | tencent-asr | volcengine-asr
        provider: String,
        config: Value,
    },
    Feed {
        session_id: String,
        pcm: Vec<i16>,
    },
    Stop {
        session_id: String,
        reply: Option<Sender<Result<String, String>>>,
    },
    /// 对已落盘 WAV 做一次离线转写（实时字幕失败时的补救）
    TranscribeFile {
        path: String,
        reply: Sender<Result<String, String>>,
    },
}

struct PendingSession {
    sample_rate: u32,
    buffered: Vec<i16>,
}

#[derive(Clone)]
pub struct AsrHandle {
    tx: Sender<AsrCmd>,
}

impl AsrHandle {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<AsrCmd>();
        thread::Builder::new()
            .name("showtalk-asr".into())
            .spawn(move || worker_loop(app, rx))
            .expect("failed to spawn ASR worker");
        // 不自动 Preload：本地模型需用户手动下载后再用
        Self { tx }
    }

    pub fn preload_local(&self) {
        let _ = self.tx.send(AsrCmd::PreloadLocal);
    }

    pub fn start_async(
        &self,
        session_id: String,
        sample_rate: u32,
        provider: String,
        config: Value,
    ) -> Result<(), String> {
        self.tx
            .send(AsrCmd::Start {
                session_id,
                sample_rate,
                provider,
                config,
            })
            .map_err(|_| "ASR 工作线程已退出，请重启应用后再试".into())
    }

    pub fn feed(&self, session_id: String, pcm: Vec<i16>) {
        let _ = self.tx.send(AsrCmd::Feed { session_id, pcm });
    }

    pub fn stop_async(&self, session_id: String) {
        let _ = self.tx.send(AsrCmd::Stop {
            session_id,
            reply: None,
        });
    }

    pub fn stop(&self, session_id: String) -> Result<String, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AsrCmd::Stop {
                session_id,
                reply: Some(reply_tx),
            })
            .map_err(|_| "ASR worker 不可用".to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "ASR stop 超时（8s）".to_string())?
    }

    /// 离线转写 WAV；最长等 120s
    pub fn transcribe_file(&self, path: String) -> Result<String, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AsrCmd::TranscribeFile {
                path,
                reply: reply_tx,
            })
            .map_err(|_| "ASR worker 不可用".to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| "离线转写超时（120s）".to_string())?
    }
}

fn worker_loop(app: AppHandle, rx: mpsc::Receiver<AsrCmd>) {
    let mut engine: Option<AsrEngine> = None;
    let mut sessions: HashMap<String, SessionStream> = HashMap::new();
    let mut online_sessions: HashMap<String, Box<dyn OnlineSession>> = HashMap::new();
    let mut pending: HashMap<String, PendingSession> = HashMap::new();
    let mut load_failed: Option<String> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            AsrCmd::PreloadLocal => {
                if engine.is_some() {
                    continue;
                }
                // 允许在曾失败后重试（例如用户刚下完模型 / 修好路径）
                match try_load_engine(&app) {
                    Ok(e) => {
                        eprintln!("[asr] preload ok: {}", e.model_dir().display());
                        emit_global(
                            &app,
                            "ready",
                            Some(format!("本地 ASR 模型已加载: {}", e.model_dir().display())),
                        );
                        load_failed = None;
                        engine = Some(e);
                    }
                    Err(err) => {
                        eprintln!("[asr] preload failed: {err}");
                        load_failed = Some(err.clone());
                        emit_global(&app, "error", Some(err));
                    }
                }
            }
            AsrCmd::Start {
                session_id,
                sample_rate,
                provider,
                config,
            } => {
                // 在线 provider
                if is_online_provider(&provider) {
                    match open_online_session(&provider, &config, sample_rate) {
                        Ok(sess) => {
                            online_sessions.insert(session_id.clone(), sess);
                            emit(
                                &app,
                                AsrEventPayload {
                                    session_id,
                                    r#type: "ready".into(),
                                    segment_id: String::new(),
                                    text: String::new(),
                                    is_final: false,
                                    message: Some(format!("在线 ASR 已连接（{provider}）")),
                                },
                            );
                        }
                        Err(err) => {
                            emit(
                                &app,
                                AsrEventPayload {
                                    session_id,
                                    r#type: "error".into(),
                                    segment_id: String::new(),
                                    text: String::new(),
                                    is_final: false,
                                    message: Some(err),
                                },
                            );
                        }
                    }
                    continue;
                }

                // 本地 sherpa
                let status = model_status(&app);
                if !status.ready {
                    eprintln!(
                        "[asr] start {}: model not ready: {}",
                        session_id, status.hint
                    );
                    emit(
                        &app,
                        AsrEventPayload {
                            session_id,
                            r#type: "error".into(),
                            segment_id: String::new(),
                            text: String::new(),
                            is_final: false,
                            message: Some(status.hint),
                        },
                    );
                    continue;
                }
                eprintln!(
                    "[asr] start {} provider=local dir={:?}",
                    session_id, status.model_dir
                );
                if let Some(err) = &load_failed {
                    // 允许重试加载（用户刚下完模型）
                    if engine.is_none() {
                        match try_load_engine(&app) {
                            Ok(e) => {
                                load_failed = None;
                                engine = Some(e);
                            }
                            Err(e2) => {
                                emit(
                                    &app,
                                    AsrEventPayload {
                                        session_id,
                                        r#type: "error".into(),
                                        segment_id: String::new(),
                                        text: String::new(),
                                        is_final: false,
                                        message: Some(format!("{err}; 重试: {e2}")),
                                    },
                                );
                                continue;
                            }
                        }
                    }
                }

                if let Some(eng) = engine.as_ref() {
                    sessions.insert(session_id.clone(), eng.open_session(sample_rate));
                    emit(
                        &app,
                        AsrEventPayload {
                            session_id,
                            r#type: "ready".into(),
                            segment_id: String::new(),
                            text: String::new(),
                            is_final: false,
                            message: Some("本地流式 ASR 已启动".into()),
                        },
                    );
                    continue;
                }

                pending.insert(
                    session_id.clone(),
                    PendingSession {
                        sample_rate,
                        buffered: Vec::new(),
                    },
                );
                emit(
                    &app,
                    AsrEventPayload {
                        session_id: session_id.clone(),
                        r#type: "ready".into(),
                        segment_id: String::new(),
                        text: String::new(),
                        is_final: false,
                        message: Some("正在加载本地 ASR 模型…".into()),
                    },
                );

                match try_load_engine(&app) {
                    Ok(e) => {
                        engine = Some(e);
                        activate_pending(&app, &engine, &mut sessions, &mut pending);
                    }
                    Err(err) => {
                        load_failed = Some(err.clone());
                        for (sid, _) in pending.drain() {
                            emit(
                                &app,
                                AsrEventPayload {
                                    session_id: sid,
                                    r#type: "error".into(),
                                    segment_id: String::new(),
                                    text: String::new(),
                                    is_final: false,
                                    message: Some(err.clone()),
                                },
                            );
                        }
                    }
                }
            }
            AsrCmd::Feed { session_id, pcm } => {
                if let Some(online) = online_sessions.get_mut(&session_id) {
                    match online.feed_pcm(&pcm) {
                        Ok(events) => emit_online(&app, &session_id, events),
                        Err(err) => emit(
                            &app,
                            AsrEventPayload {
                                session_id,
                                r#type: "error".into(),
                                segment_id: String::new(),
                                text: String::new(),
                                is_final: false,
                                message: Some(err),
                            },
                        ),
                    }
                    continue;
                }

                if let Some(p) = pending.get_mut(&session_id) {
                    const MAX_SAMPLES: usize = 16_000 * 10;
                    if p.buffered.len() < MAX_SAMPLES {
                        let room = MAX_SAMPLES.saturating_sub(p.buffered.len());
                        p.buffered.extend_from_slice(&pcm[..pcm.len().min(room)]);
                    }
                    continue;
                }
                let Some(eng) = engine.as_ref() else {
                    continue;
                };
                let Some(session) = sessions.get_mut(&session_id) else {
                    continue;
                };
                let ticks = eng.feed_i16(session, &pcm);
                emit_ticks(&app, &session_id, ticks);
            }
            AsrCmd::Stop { session_id, reply } => {
                pending.remove(&session_id);
                let mut final_text = String::new();

                if let Some(mut online) = online_sessions.remove(&session_id) {
                    match online.finish() {
                        Ok(events) => {
                            for ev in &events {
                                if ev.is_final && !ev.text.is_empty() {
                                    if !final_text.is_empty() {
                                        final_text.push(' ');
                                    }
                                    final_text.push_str(&ev.text);
                                }
                            }
                            if final_text.is_empty() {
                                for ev in events.iter().rev() {
                                    if !ev.text.is_empty() {
                                        final_text = ev.text.clone();
                                        break;
                                    }
                                }
                            }
                            if let Some(reply) = reply {
                                let _ = reply.send(Ok(final_text));
                            }
                            emit_online(&app, &session_id, events);
                        }
                        Err(err) => {
                            if let Some(reply) = reply {
                                let _ = reply.send(Err(err.clone()));
                            }
                            emit(
                                &app,
                                AsrEventPayload {
                                    session_id,
                                    r#type: "error".into(),
                                    segment_id: String::new(),
                                    text: String::new(),
                                    is_final: false,
                                    message: Some(err),
                                },
                            );
                        }
                    }
                    continue;
                }

                let mut ticks: Vec<DecodeTick> = Vec::new();
                if let (Some(eng), Some(mut session)) =
                    (engine.as_ref(), sessions.remove(&session_id))
                {
                    ticks = eng.finish(&mut session);
                    for tick in &ticks {
                        if let DecodeTick::Final { text, .. } = tick {
                            if !final_text.is_empty() {
                                final_text.push(' ');
                            }
                            final_text.push_str(text);
                        }
                    }
                    if final_text.is_empty() {
                        for tick in &ticks {
                            if let DecodeTick::Partial { text, .. } = tick {
                                final_text = text.clone();
                            }
                        }
                    }
                }
                if let Some(reply) = reply {
                    let _ = reply.send(Ok(final_text));
                }
                if !ticks.is_empty() {
                    emit_ticks(&app, &session_id, ticks);
                }
            }
            AsrCmd::TranscribeFile { path, reply } => {
                if engine.is_none() {
                    match try_load_engine(&app) {
                        Ok(e) => {
                            load_failed = None;
                            engine = Some(e);
                        }
                        Err(err) => {
                            let _ = reply.send(Err(err));
                            continue;
                        }
                    }
                }
                let result = match engine.as_ref() {
                    Some(eng) => transcribe_wav_with_engine(eng, &path),
                    None => Err("ASR 引擎未就绪".into()),
                };
                match &result {
                    Ok(t) => eprintln!(
                        "[asr] transcribe_file ok path={} chars={}",
                        path,
                        t.chars().count()
                    ),
                    Err(e) => eprintln!("[asr] transcribe_file err path={path}: {e}"),
                }
                let _ = reply.send(result);
            }
        }
    }
}

fn transcribe_wav_with_engine(eng: &AsrEngine, path: &str) -> Result<String, String> {
    let wave = sherpa_onnx::Wave::read(path).ok_or_else(|| format!("无法读取音频: {path}"))?;
    let sample_rate = wave.sample_rate() as u32;
    let samples = wave.samples();
    if samples.is_empty() {
        return Err("音频为空".into());
    }

    let mut session = eng.open_session(sample_rate);
    // 按 ~200ms 块喂入，触发与实时相近的 endpoint
    let chunk = (sample_rate as usize / 5).max(1600);
    let mut texts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < samples.len() {
        let end = (i + chunk).min(samples.len());
        let slice = &samples[i..end];
        // accept_waveform 要 f32；复用 engine 的 i16 路径更稳
        let pcm: Vec<i16> = slice
            .iter()
            .map(|&s| {
                let x = (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
                x
            })
            .collect();
        let ticks = eng.feed_i16(&mut session, &pcm);
        for tick in ticks {
            if let DecodeTick::Final { text, .. } = tick {
                if !text.trim().is_empty() {
                    texts.push(text);
                }
            }
        }
        i = end;
    }
    let ticks = eng.finish(&mut session);
    for tick in ticks {
        match tick {
            DecodeTick::Final { text, .. } | DecodeTick::Partial { text, .. } => {
                if !text.trim().is_empty() {
                    // finish 的 partial/final 可能与最后一段重复，后面去重
                    texts.push(text);
                }
            }
        }
    }

    // 去重相邻重复句，再拼接
    let mut out: Vec<String> = Vec::new();
    for t in texts {
        let t = t.trim().to_string();
        if t.is_empty() {
            continue;
        }
        if out.last().map(|x| x == &t).unwrap_or(false) {
            continue;
        }
        // 若新句是旧句的扩展（流式 partial→final），替换
        if let Some(last) = out.last_mut() {
            if t.starts_with(last.as_str()) || last.starts_with(t.as_str()) {
                *last = if t.len() >= last.len() {
                    t
                } else {
                    last.clone()
                };
                continue;
            }
        }
        out.push(t);
    }
    // 保留 endpoint 句段边界。前端会像实时 final segments 一样逐段补标点。
    let joined = out.join("\n").trim().to_string();
    if joined.is_empty() {
        Err("未能识别出文本（可检查是否在说话、音量是否过低）".into())
    } else {
        Ok(joined)
    }
}

fn try_load_engine(app: &AppHandle) -> Result<AsrEngine, String> {
    let status = model_status(app);
    if !status.ready {
        return Err(status.hint);
    }
    let dir = resolve_model_dir(app).ok_or_else(|| "no model dir".to_string())?;
    AsrEngine::load(&dir)
}

fn activate_pending(
    app: &AppHandle,
    engine: &Option<AsrEngine>,
    sessions: &mut HashMap<String, SessionStream>,
    pending: &mut HashMap<String, PendingSession>,
) {
    let Some(eng) = engine.as_ref() else {
        return;
    };
    let items: Vec<(String, PendingSession)> = pending.drain().collect();
    for (session_id, p) in items {
        let mut stream = eng.open_session(p.sample_rate);
        if !p.buffered.is_empty() {
            let ticks = eng.feed_i16(&mut stream, &p.buffered);
            emit_ticks(app, &session_id, ticks);
        }
        sessions.insert(session_id.clone(), stream);
        emit(
            app,
            AsrEventPayload {
                session_id,
                r#type: "ready".into(),
                segment_id: String::new(),
                text: String::new(),
                is_final: false,
                message: Some("本地 ASR 已就绪，实时字幕开启".into()),
            },
        );
    }
}

fn emit_online(app: &AppHandle, session_id: &str, events: Vec<OnlineEvent>) {
    for ev in events {
        emit(
            app,
            AsrEventPayload {
                session_id: session_id.to_string(),
                r#type: ev.kind,
                segment_id: ev.segment_id,
                text: ev.text,
                is_final: ev.is_final,
                message: ev.message,
            },
        );
    }
}

fn emit_ticks(app: &AppHandle, session_id: &str, ticks: Vec<DecodeTick>) {
    for tick in ticks {
        match tick {
            DecodeTick::Partial { segment_id, text } => emit(
                app,
                AsrEventPayload {
                    session_id: session_id.to_string(),
                    r#type: "partial".into(),
                    segment_id,
                    text,
                    is_final: false,
                    message: None,
                },
            ),
            DecodeTick::Final { segment_id, text } => emit(
                app,
                AsrEventPayload {
                    session_id: session_id.to_string(),
                    r#type: "final".into(),
                    segment_id,
                    text,
                    is_final: true,
                    message: None,
                },
            ),
        }
    }
}

fn emit_global(app: &AppHandle, kind: &str, message: Option<String>) {
    emit(
        app,
        AsrEventPayload {
            session_id: String::new(),
            r#type: kind.into(),
            segment_id: String::new(),
            text: String::new(),
            is_final: false,
            message,
        },
    );
}

fn emit(app: &AppHandle, payload: AsrEventPayload) {
    let _ = app.emit("asr-event", payload);
}
