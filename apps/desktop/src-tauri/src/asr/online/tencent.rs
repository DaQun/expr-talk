//! 腾讯云实时语音识别（WebSocket + 签名 URL）
use super::{cfg_str, pcm_to_le_bytes, OnlineEvent, OnlineSession};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha1::Sha1;
use std::net::TcpStream;
use std::time::{SystemTime, UNIX_EPOCH};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};
use url::form_urlencoded;

type Ws = WebSocket<MaybeTlsStream<TcpStream>>;
type HmacSha1 = Hmac<Sha1>;

pub struct TencentSession {
    ws: Ws,
    seg: u32,
    voice_id: String,
}

impl TencentSession {
    pub fn connect(config: &Value, sample_rate: u32) -> Result<Self, String> {
        let secret_id = cfg_str(config, &["secretId", "apiKey"]);
        let secret_key = cfg_str(config, &["secretKey"]);
        let app_id = cfg_str(config, &["appId"]);
        let engine = {
            let e = cfg_str(config, &["engineModelType"]);
            if e.is_empty() {
                "16k_zh".into()
            } else {
                e
            }
        };
        if secret_id.is_empty() || secret_key.is_empty() || app_id.is_empty() {
            return Err("腾讯云需要 secretId / secretKey / appId".into());
        }

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let expired = ts + 24 * 3600;
        let nonce: u64 = (ts % 1_000_000) + 42;
        let voice_id = format!("v{ts}");

        // 按腾讯云实时 ASR 签名约定组装
        let mut params: Vec<(String, String)> = vec![
            ("engine_model_type".into(), engine),
            ("expired".into(), expired.to_string()),
            ("needvad".into(), "1".into()),
            ("nonce".into(), nonce.to_string()),
            ("secretid".into(), secret_id.clone()),
            ("timestamp".into(), ts.to_string()),
            ("voice_format".into(), "1".into()), // pcm
            ("voice_id".into(), voice_id.clone()),
        ];
        // sample_rate 由引擎类型隐含 16k
        let _ = sample_rate;

        params.sort_by(|a, b| a.0.cmp(&b.0));
        let query: String = form_urlencoded::Serializer::new(String::new())
            .extend_pairs(params.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .finish();

        let sign_str = format!("asr.cloud.tencent.com/asr/v2/{app_id}?{query}");
        let mut mac =
            HmacSha1::new_from_slice(secret_key.as_bytes()).map_err(|e| format!("hmac: {e}"))?;
        mac.update(sign_str.as_bytes());
        let signature = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            mac.finalize().into_bytes(),
        );

        let url = format!(
            "wss://asr.cloud.tencent.com/asr/v2/{app_id}?{query}&signature={}",
            form_urlencoded::byte_serialize(signature.as_bytes()).collect::<String>()
        );

        let (ws, _) =
            tungstenite::connect(&url).map_err(|e| format!("连接腾讯云 ASR 失败: {e}"))?;

        Ok(Self {
            ws,
            seg: 0,
            voice_id,
        })
    }

    fn drain(&mut self) -> Result<Vec<OnlineEvent>, String> {
        use super::set_ws_read_timeout;
        let mut out = Vec::new();
        set_ws_read_timeout(self.ws.get_ref(), 15);
        loop {
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    if let Some(ev) = parse_tencent(&t, &mut self.seg) {
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
                    return Err(format!("腾讯云读事件: {e}"));
                }
            }
        }
        set_ws_read_timeout(self.ws.get_ref(), 0);
        Ok(out)
    }
}

impl OnlineSession for TencentSession {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<OnlineEvent>, String> {
        if pcm.is_empty() {
            return Ok(vec![]);
        }
        let bytes = pcm_to_le_bytes(pcm);
        self.ws
            .send(Message::Binary(bytes))
            .map_err(|e| format!("腾讯云发送音频失败: {e}"))?;
        self.drain()
    }

    fn finish(&mut self) -> Result<Vec<OnlineEvent>, String> {
        // 发送结束标记：空包或 JSON end
        let end = serde_json::json!({ "type": "end" }).to_string();
        let _ = self.ws.send(Message::Text(end));
        use super::set_ws_read_timeout;
        set_ws_read_timeout(self.ws.get_ref(), 300);
        let mut out = Vec::new();
        for _ in 0..15 {
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    if let Some(ev) = parse_tencent(&t, &mut self.seg) {
                        out.push(ev);
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        let _ = self.ws.close(None);
        let _ = &self.voice_id;
        Ok(out)
    }
}

fn parse_tencent(t: &str, seg: &mut u32) -> Option<OnlineEvent> {
    let v: Value = serde_json::from_str(t).ok()?;
    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 {
        let msg = v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or(t)
            .to_string();
        if msg.is_empty() {
            return None;
        }
        return Some(OnlineEvent {
            kind: "error".into(),
            text: String::new(),
            segment_id: String::new(),
            is_final: false,
            message: Some(msg),
        });
    }
    let result = v.get("result")?;
    let text = result
        .get("voice_text_str")
        .or_else(|| result.get("text"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return None;
    }
    // slice_type: 0 start, 1 speaing, 2 end
    let slice = result
        .get("slice_type")
        .and_then(|x| x.as_i64())
        .unwrap_or(1);
    let is_final = slice == 2;
    *seg += 1;
    Some(OnlineEvent {
        kind: if is_final { "final" } else { "partial" }.into(),
        text,
        segment_id: format!("tencent-{seg}"),
        is_final,
        message: None,
    })
}
