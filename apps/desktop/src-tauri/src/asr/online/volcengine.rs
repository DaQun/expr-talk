//! 火山引擎流式语音识别（豆包 2.0 v3 / 旧标准版 v2）。
use super::{cfg_str, pcm_to_le_bytes, OnlineEvent, OnlineSession};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use tungstenite::{client::IntoClientRequest, stream::MaybeTlsStream, Message, WebSocket};
use uuid::Uuid;

type Ws = WebSocket<MaybeTlsStream<TcpStream>>;

const FULL_CLIENT_REQUEST: u8 = 0x1;
const AUDIO_ONLY_REQUEST: u8 = 0x2;
const FULL_SERVER_RESPONSE: u8 = 0x9;
const SERVER_ACK: u8 = 0xb;
const SERVER_ERROR: u8 = 0xf;

pub struct VolcSession {
    ws: Ws,
    seg: u32,
}

impl VolcSession {
    pub fn connect(config: &Value, sample_rate: u32) -> Result<Self, String> {
        let app_id = cfg_str(config, &["appId"]);
        let token = cfg_str(config, &["accessToken", "apiKey"]);
        if app_id.is_empty() || token.is_empty() {
            return Err("火山引擎需要 appId 与 accessToken".into());
        }

        let product = cfg_str(config, &["product"]);
        let configured_resource = cfg_str(config, &["resourceId"]);
        // 老版本应用没有 product/resourceId。现在默认迁移到用户实际开通的 2.0 小时版；
        // 只有明确选择 legacy-standard 才继续请求旧 v2 服务。
        let use_v3 = product != "legacy-standard";
        let resource_id = if configured_resource.is_empty() {
            if product == "seed-asr-2-concurrent" {
                "volc.bigasr.sauc.concurrent".to_string()
            } else {
                "volc.bigasr.sauc.duration".to_string()
            }
        } else {
            configured_resource
        };
        let endpoint = if use_v3 {
            "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
        } else {
            "wss://openspeech.bytedance.com/api/v2/asr"
        };
        let mut request = endpoint
            .into_client_request()
            .map_err(|e| format!("构造火山引擎连接失败: {e}"))?;
        let req_id = Uuid::new_v4().to_string();
        if use_v3 {
            for (name, value) in [
                ("X-Api-App-Key", app_id.as_str()),
                ("X-Api-Access-Key", token.as_str()),
                ("X-Api-Resource-Id", resource_id.as_str()),
                ("X-Api-Connect-Id", req_id.as_str()),
            ] {
                request.headers_mut().insert(
                    name,
                    value
                        .parse()
                        .map_err(|e| format!("火山引擎鉴权头无效: {e}"))?,
                );
            }
        } else {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer; {token}")
                    .parse()
                    .map_err(|e| format!("火山引擎鉴权头无效: {e}"))?,
            );
        }
        let (mut ws, _) = tungstenite::connect(request).map_err(format_connect_error)?;
        set_read_timeout(&ws, 5_000);

        let audio = json!({
            "format": if use_v3 { "pcm" } else { "raw" },
            "codec": "raw",
            "rate": sample_rate,
            "bits": 16,
            "channel": 1,
            "language": cfg_str(config, &["language"]).if_empty("zh-CN")
        });
        let full = if use_v3 {
            json!({
                "user": { "uid": "expr-talk" },
                "audio": audio,
                "request": {
                    "model_name": "bigmodel",
                    "enable_itn": true,
                    "enable_punc": true,
                    "show_utterances": true,
                    "result_type": "full"
                }
            })
        } else {
            let cluster = cfg_str(config, &["cluster"]).if_empty("volcengine_streaming_common");
            json!({
                "app": { "appid": app_id, "token": token, "cluster": cluster },
                "user": { "uid": "expr-talk" },
                "audio": audio,
                "request": {
                    "reqid": req_id,
                    "sequence": 1,
                    "nbest": 1,
                    "workflow": "audio_in,resample,partition,vad,fe,decode",
                    "show_utterances": true,
                    "result_type": "full"
                }
            })
        };
        let request = encode_packet(FULL_CLIENT_REQUEST, 0, full.to_string().as_bytes(), true)?;
        ws.send(Message::Binary(request))
            .map_err(|e| format!("火山引擎鉴权首包失败: {e}"))?;

        match ws.read() {
            Ok(Message::Binary(bytes)) => {
                let events = decode_response(&bytes, &mut 0)?;
                if let Some(error) = events.into_iter().find(|event| event.kind == "error") {
                    return Err(format!(
                        "火山引擎握手失败: {}",
                        error.message.unwrap_or_else(|| "服务拒绝请求".into())
                    ));
                }
            }
            Ok(Message::Text(text)) => validate_text_response(&text)?,
            Ok(Message::Close(frame)) => {
                return Err(format!("火山引擎连接被关闭: {frame:?}"));
            }
            Err(e) => return Err(format!("火山引擎握手读失败: {e}")),
            _ => {}
        }
        set_read_timeout(&ws, 0);
        Ok(Self { ws, seg: 0 })
    }

    fn drain(&mut self) -> Result<Vec<OnlineEvent>, String> {
        use super::set_ws_read_timeout;
        let mut out = Vec::new();
        set_ws_read_timeout(self.ws.get_ref(), 15);
        loop {
            match self.ws.read() {
                Ok(Message::Text(text)) => {
                    if let Some(event) = parse_json_event(&text, &mut self.seg) {
                        out.push(event);
                    }
                }
                Ok(Message::Binary(bytes)) => {
                    out.extend(decode_response(&bytes, &mut self.seg)?);
                }
                Ok(Message::Ping(payload)) => {
                    let _ = self.ws.send(Message::Pong(payload));
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
                    return Err(format!("火山引擎读事件: {e}"));
                }
            }
        }
        set_ws_read_timeout(self.ws.get_ref(), 0);
        Ok(out)
    }
}

fn format_connect_error(error: tungstenite::Error) -> String {
    if let tungstenite::Error::Http(response) = &error {
        let detail = response
            .body()
            .as_ref()
            .map(|body| String::from_utf8_lossy(body).trim().to_string())
            .filter(|body| !body.is_empty());
        return match detail {
            Some(detail) => format!("连接火山引擎失败: HTTP {}: {detail}", response.status()),
            None => format!("连接火山引擎失败: HTTP {}", response.status()),
        };
    }
    format!("连接火山引擎失败: {error}")
}

impl OnlineSession for VolcSession {
    fn feed_pcm(&mut self, pcm: &[i16]) -> Result<Vec<OnlineEvent>, String> {
        if pcm.is_empty() {
            return Ok(vec![]);
        }
        let packet = encode_packet(AUDIO_ONLY_REQUEST, 0, &pcm_to_le_bytes(pcm), true)?;
        self.ws
            .send(Message::Binary(packet))
            .map_err(|e| format!("火山引擎发送音频失败: {e}"))?;
        self.drain()
    }

    fn finish(&mut self) -> Result<Vec<OnlineEvent>, String> {
        // flags=2 表示无序列号的最后一个音频包。
        let packet = encode_packet(AUDIO_ONLY_REQUEST, 2, &[], true)?;
        self.ws
            .send(Message::Binary(packet))
            .map_err(|e| format!("火山引擎发送结束帧失败: {e}"))?;
        let out = self.drain()?;
        let _ = self.ws.close(None);
        Ok(out)
    }
}

fn encode_packet(
    message_type: u8,
    flags: u8,
    payload: &[u8],
    gzip: bool,
) -> Result<Vec<u8>, String> {
    let body = if gzip {
        gzip_encode(payload)?
    } else {
        payload.to_vec()
    };
    let mut packet = Vec::with_capacity(8 + body.len());
    packet.extend_from_slice(&[
        0x11, // protocol v1, 4-byte header
        (message_type << 4) | flags,
        if message_type == FULL_CLIENT_REQUEST {
            0x11
        } else if gzip {
            0x01
        } else {
            0x00
        },
        0x00,
    ]);
    packet.extend_from_slice(&(body.len() as u32).to_be_bytes());
    packet.extend_from_slice(&body);
    Ok(packet)
}

fn decode_response(bytes: &[u8], seg: &mut u32) -> Result<Vec<OnlineEvent>, String> {
    if bytes.len() < 4 {
        return Err("火山引擎返回了不完整的数据包".into());
    }
    let header_size = ((bytes[0] & 0x0f) as usize) * 4;
    if header_size < 4 || bytes.len() < header_size {
        return Err("火山引擎返回头格式无效".into());
    }
    let message_type = bytes[1] >> 4;
    let flags = bytes[1] & 0x0f;
    let compression = bytes[2] & 0x0f;
    let (payload_offset, payload_size, error_code) = match message_type {
        FULL_SERVER_RESPONSE => {
            let size_at = if flags == 0 {
                header_size
            } else {
                header_size + 4
            };
            (size_at + 4, read_u32(bytes, size_at)? as usize, None)
        }
        SERVER_ACK => {
            let size_at = header_size + 4; // 跳过 ack sequence
            (size_at + 4, read_u32(bytes, size_at)? as usize, None)
        }
        SERVER_ERROR => {
            let code = read_u32(bytes, header_size)?;
            let size_at = header_size + 4;
            (size_at + 4, read_u32(bytes, size_at)? as usize, Some(code))
        }
        other => return Err(format!("火山引擎返回未知消息类型: {other}")),
    };
    if payload_size == 0 {
        return Ok(vec![]);
    }
    let end = payload_offset.saturating_add(payload_size);
    if end > bytes.len() {
        return Err("火山引擎返回负载长度不匹配".into());
    }
    let payload = if compression == 1 {
        gzip_decode(&bytes[payload_offset..end])?
    } else {
        bytes[payload_offset..end].to_vec()
    };
    let text = String::from_utf8_lossy(&payload).to_string();
    if let Some(code) = error_code {
        let detail = if code == 45_000_030 || text.contains("requested resource not granted") {
            "当前 AppId 未开通流式语音识别标准版资源 volc.streamingasr.common.cn。请在火山语音控制台为该应用开通对应服务；若你开通的是大模型语音识别 2.0，则它使用另一套 Resource ID 和接口。".to_string()
        } else if code == 45_000_010 || text.contains("missing Authorization header") {
            "鉴权头缺失或 Access Token 无效".to_string()
        } else {
            text
        };
        return Ok(vec![OnlineEvent {
            kind: "error".into(),
            text: String::new(),
            segment_id: String::new(),
            is_final: false,
            message: Some(format!("错误码 {code}: {detail}")),
        }]);
    }
    Ok(parse_json_event(&text, seg).into_iter().collect())
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let raw = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "火山引擎返回数据长度不足".to_string())?;
    Ok(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
}

fn gzip_encode(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(payload)
        .map_err(|e| format!("gzip 编码失败: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip 编码失败: {e}"))
}

fn gzip_decode(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(payload);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("gzip 解码失败: {e}"))?;
    Ok(out)
}

fn set_read_timeout(ws: &Ws, ms: u64) {
    super::set_ws_read_timeout(ws.get_ref(), ms);
}

fn validate_text_response(text: &str) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| format!("火山引擎握手返回无法解析: {text}"))?;
    let code = value.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 && code != 1000 {
        return Err(format!("火山引擎握手失败: {text}"));
    }
    Ok(())
}

fn parse_json_event(text: &str, seg: &mut u32) -> Option<OnlineEvent> {
    let value: Value = serde_json::from_str(text).ok()?;
    if let Some(code) = value.get("code").and_then(Value::as_i64) {
        if code != 0 && code != 1000 {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or(text)
                .to_string();
            return Some(OnlineEvent {
                kind: "error".into(),
                text: String::new(),
                segment_id: String::new(),
                is_final: false,
                message: Some(message),
            });
        }
    }
    let legacy_result = value.pointer("/result/0");
    let result = legacy_result.or_else(|| value.get("result"))?;
    let utterance = result
        .get("utterances")
        .and_then(Value::as_array)
        .and_then(|items| items.last());
    // 豆包 ASR 2.0 的 result.text 是截至当前帧的累计全文，utterances.last()
    // 只是最后一句。若优先取最后一句，结束后逐字稿会只剩录音末尾的内容。
    let recognized = result
        .get("text")
        .or_else(|| utterance.and_then(|item| item.get("text")))
        .and_then(Value::as_str)
        .unwrap_or("");
    if recognized.is_empty() {
        return None;
    }
    let is_final = utterance
        .and_then(|item| item.get("definite"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let segment_id = if legacy_result.is_some() {
        *seg += 1;
        format!("volc-{seg}")
    } else {
        // v3 全文是累计更新，保持同一 ID，让前端替换而不是不断追加。
        "volc-v3-full".to_string()
    };
    Some(OnlineEvent {
        kind: if is_final { "final" } else { "partial" }.into(),
        text: recognized.to_string(),
        segment_id,
        is_final,
        message: None,
    })
}

trait IfEmpty {
    fn if_empty(self, default: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, default: &str) -> String {
        if self.is_empty() {
            default.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_response, encode_packet, VolcSession, FULL_CLIENT_REQUEST, FULL_SERVER_RESPONSE,
    };

    #[test]
    fn encodes_v2_gzip_request() {
        let packet = encode_packet(FULL_CLIENT_REQUEST, 0, br#"{"app":{}}"#, true).unwrap();
        assert_eq!(&packet[..4], &[0x11, 0x10, 0x11, 0x00]);
        assert!(packet.len() > 8);
    }

    #[test]
    fn decodes_gzip_server_result() {
        let json = r#"{"result":[{"text":"你好","utterances":[{"text":"你好","definite":true}]}]}"#;
        let mut packet = encode_packet(FULL_CLIENT_REQUEST, 0, json.as_bytes(), true).unwrap();
        packet[1] = FULL_SERVER_RESPONSE << 4;
        let events = decode_response(&packet, &mut 0).unwrap();
        assert_eq!(events[0].text, "你好");
        assert!(events[0].is_final);
    }

    #[test]
    fn decodes_v3_response_with_sequence() {
        let json =
            r#"{"result":{"text":"你好。","utterances":[{"text":"你好。","definite":true}]}}"#;
        let encoded = super::gzip_encode(json.as_bytes()).unwrap();
        let mut packet = vec![0x11, (FULL_SERVER_RESPONSE << 4) | 1, 0x01, 0x00];
        packet.extend_from_slice(&1_i32.to_be_bytes());
        packet.extend_from_slice(&(encoded.len() as u32).to_be_bytes());
        packet.extend_from_slice(&encoded);

        let events = decode_response(&packet, &mut 0).unwrap();
        assert_eq!(events[0].text, "你好。");
        assert!(events[0].is_final);
    }

    #[test]
    fn v3_prefers_cumulative_text_over_last_utterance() {
        let json = r#"{
          "result": {
            "text": "第一句。第二句。最后一句。",
            "utterances": [
              {"text":"第一句。","definite":true},
              {"text":"第二句。","definite":true},
              {"text":"最后一句。","definite":true}
            ]
          }
        }"#;
        let event = super::parse_json_event(json, &mut 0).unwrap();
        assert_eq!(event.text, "第一句。第二句。最后一句。");
        assert_eq!(event.segment_id, "volc-v3-full");
        assert!(event.is_final);
    }

    #[test]
    #[ignore = "requires VOLCENGINE_TEST_CONFIG"]
    fn authenticates_live_credentials() {
        let raw = std::env::var("VOLCENGINE_TEST_CONFIG").expect("missing test config");
        let config = serde_json::from_str(&raw).expect("invalid test config");
        VolcSession::connect(&config, 16_000).expect("live authentication failed");
    }
}
