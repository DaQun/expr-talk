//! 阿里云百炼 DashScope 实时 ASR（paraformer-realtime-v2）
use super::{cfg_str, pcm_to_le_bytes, OnlineEvent, OnlineSession};
use serde_json::{json, Value};
use std::net::TcpStream;
use std::time::{SystemTime, UNIX_EPOCH};
use tungstenite::{client::IntoClientRequest, stream::MaybeTlsStream, Message, WebSocket};

type Ws = WebSocket<MaybeTlsStream<TcpStream>>;

pub struct AliyunSession {
    ws: Ws,
    task_id: String,
    seg: u32,
    started: bool,
}

impl AliyunSession {
    pub fn connect(config: &Value, sample_rate: u32) -> Result<Self, String> {
        let api_key = cfg_str(config, &["apiKey"]);
        if api_key.is_empty() {
            return Err("百炼 API Key 为空".into());
        }
        let model = {
            let m = cfg_str(config, &["model"]);
            if m.is_empty() {
                "paraformer-realtime-v2".into()
            } else {
                m
            }
        };
        let url = {
            let u = cfg_str(config, &["baseUrl"]);
            if u.is_empty() {
                "wss://dashscope.aliyuncs.com/api-ws/v1/inference".into()
            } else {
                u
            }
        };

        let mut req = url
            .as_str()
            .into_client_request()
            .map_err(|e| format!("百炼 WS URL: {e}"))?;
        req.headers_mut().insert(
            "Authorization",
            format!("bearer {api_key}")
                .parse()
                .map_err(|e| format!("Authorization header: {e}"))?,
        );

        let (mut ws, _) = tungstenite::connect(req).map_err(|e| format!("连接百炼失败: {e}"))?;

        let task_id = format!(
            "t{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );

        let run = json!({
            "header": {
                "action": "run-task",
                "task_id": task_id,
                "streaming": "duplex"
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": model,
                "parameters": {
                    "format": "pcm",
                    "sample_rate": sample_rate,
                    "language_hints": ["zh", "en"]
                },
                "input": {}
            }
        });
        ws.send(Message::Text(run.to_string()))
            .map_err(|e| format!("发送 run-task 失败: {e}"))?;

        // 等待 task-started
        let mut started = false;
        for _ in 0..30 {
            let msg = ws.read().map_err(|e| format!("读百炼响应失败: {e}"))?;
            if let Message::Text(t) = msg {
                if t.contains("task-started") || t.contains("task_started") {
                    started = true;
                    break;
                }
                if t.contains("\"error\"") || t.contains("failed") {
                    return Err(format!("百炼启动失败: {t}"));
                }
            }
        }
        if !started {
            return Err("百炼未返回 task-started，请检查 API Key / 模型权限".into());
        }

        Ok(Self {
            ws,
            task_id,
            seg: 0,
            started: true,
        })
    }

    fn drain_events(&mut self) -> Result<Vec<OnlineEvent>, String> {
        use super::set_ws_read_timeout;
        let mut out = Vec::new();
        set_ws_read_timeout(self.ws.get_ref(), 15);
        loop {
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    if let Some(ev) = parse_dashscope_event(&t, &mut self.seg) {
                        out.push(ev);
                    }
                }
                Ok(Message::Ping(p)) => {
                    let _ = self.ws.send(Message::Pong(p));
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(tungstenite::Error::Io(ref e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    break;
                }
                Err(e) => {
                    set_ws_read_timeout(self.ws.get_ref(), 0);
                    return Err(format!("百炼读事件: {e}"));
                }
            }
        }
        set_ws_read_timeout(self.ws.get_ref(), 0);
        Ok(out)
    }
}

impl OnlineSession for AliyunSession {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<OnlineEvent>, String> {
        if !self.started || pcm.is_empty() {
            return Ok(vec![]);
        }
        let bytes = pcm_to_le_bytes(pcm);
        self.ws
            .send(Message::Binary(bytes))
            .map_err(|e| format!("百炼发送音频失败: {e}"))?;
        self.drain_events()
    }

    fn finish(&mut self) -> Result<Vec<OnlineEvent>, String> {
        let fin = json!({
            "header": {
                "action": "finish-task",
                "task_id": self.task_id,
                "streaming": "duplex"
            },
            "payload": { "input": {} }
        });
        let _ = self.ws.send(Message::Text(fin.to_string()));
        use super::set_ws_read_timeout;
        set_ws_read_timeout(self.ws.get_ref(), 300);
        let mut out = Vec::new();
        for _ in 0..20 {
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    if let Some(ev) = parse_dashscope_event(&t, &mut self.seg) {
                        out.push(ev);
                    }
                    if t.contains("task-finished") || t.contains("task_finished") {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        let _ = self.ws.close(None);
        Ok(out)
    }
}

fn parse_dashscope_event(t: &str, seg: &mut u32) -> Option<OnlineEvent> {
    let v: Value = serde_json::from_str(t).ok()?;
    let event = v
        .pointer("/header/event")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let text = v
        .pointer("/payload/output/sentence/text")
        .or_else(|| v.pointer("/payload/output/text"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let end = v.pointer("/payload/output/sentence/end_time").is_some()
        || event == "result-generated" && v.pointer("/payload/output/sentence/end_time").is_some();

    // end_time 存在通常表示一句结束
    let is_sentence_end = v
        .pointer("/payload/output/sentence/end_time")
        .and_then(|x| x.as_i64())
        .is_some();

    if event == "error" || event == "task-failed" {
        let msg = v
            .pointer("/header/error_message")
            .or_else(|| v.pointer("/message"))
            .and_then(|x| x.as_str())
            .unwrap_or(t)
            .to_string();
        return Some(OnlineEvent {
            kind: "error".into(),
            text: String::new(),
            segment_id: String::new(),
            is_final: false,
            message: Some(msg),
        });
    }

    if text.is_empty() {
        return None;
    }
    *seg += 1;
    let is_final = is_sentence_end || end;
    Some(OnlineEvent {
        kind: if is_final { "final" } else { "partial" }.into(),
        text,
        segment_id: format!("aliyun-{seg}"),
        is_final,
        message: None,
    })
}
