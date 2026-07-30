//! 在线流式 ASR：阿里百炼 / 腾讯云 / 火山引擎
mod aliyun;
mod tencent;
mod volcengine;

use aliyun::AliyunSession;
use serde_json::Value;
use tencent::TencentSession;
use volcengine::VolcSession;

pub trait OnlineSession: Send {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<OnlineEvent>, String>;
    fn finish(&mut self) -> Result<Vec<OnlineEvent>, String>;
}

#[derive(Debug, Clone)]
pub struct OnlineEvent {
    pub kind: String, // partial | final | error | ready
    pub text: String,
    pub segment_id: String,
    pub is_final: bool,
    pub message: Option<String>,
}

pub fn open_online_session(
    provider: &str,
    config: &Value,
    sample_rate: u32,
) -> Result<Box<dyn OnlineSession>, String> {
    match provider {
        "aliyun-bailian" => Ok(Box::new(AliyunSession::connect(config, sample_rate)?)),
        "tencent-asr" => Ok(Box::new(TencentSession::connect(config, sample_rate)?)),
        "volcengine-asr" => Ok(Box::new(VolcSession::connect(config, sample_rate)?)),
        other => Err(format!("未知在线 ASR provider: {other}")),
    }
}

pub fn is_online_provider(id: &str) -> bool {
    matches!(id, "aliyun-bailian" | "tencent-asr" | "volcengine-asr")
}

fn cfg_str(config: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = config.get(*k).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return s.trim().to_string();
            }
        }
    }
    String::new()
}

fn pcm_to_le_bytes(pcm: &[i16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pcm.len() * 2);
    for &s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

use std::net::TcpStream;
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;

pub fn set_ws_read_timeout(stream: &MaybeTlsStream<TcpStream>, ms: u64) {
    let dur = if ms == 0 {
        None
    } else {
        Some(Duration::from_millis(ms))
    };
    match stream {
        MaybeTlsStream::Plain(t) => {
            let _ = t.set_read_timeout(dur);
        }
        MaybeTlsStream::NativeTls(t) => {
            let _ = t.get_ref().set_read_timeout(dur);
        }
        _ => {}
    }
}
