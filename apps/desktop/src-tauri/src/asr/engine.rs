use super::paths::{model_paths_from_dir, validate_model, ModelPaths};
use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};
use std::path::Path;

pub struct AsrEngine {
    recognizer: OnlineRecognizer,
    paths: ModelPaths,
}

pub struct SessionStream {
    stream: OnlineStream,
    sample_rate: u32,
    segment_index: u32,
    last_emitted: String,
}

#[derive(Debug, Clone)]
pub enum DecodeTick {
    Partial { segment_id: String, text: String },
    Final { segment_id: String, text: String },
}

impl AsrEngine {
    pub fn load(model_dir: &Path) -> Result<Self, String> {
        let paths = model_paths_from_dir(model_dir);
        validate_model(&paths).map_err(|m| format!("模型文件缺失: {}", m.join(", ")))?;

        let mut config = OnlineRecognizerConfig::default();
        config.model_config.transducer.encoder = Some(paths.encoder.to_string_lossy().into_owned());
        config.model_config.transducer.decoder = Some(paths.decoder.to_string_lossy().into_owned());
        config.model_config.transducer.joiner = Some(paths.joiner.to_string_lossy().into_owned());
        config.model_config.tokens = Some(paths.tokens.to_string_lossy().into_owned());
        config.model_config.provider = Some("cpu".into());
        config.model_config.num_threads = 2;
        config.enable_endpoint = true;
        // 与架构文档端点参数对齐（字段若存在则设置；默认也可用）
        config.rule1_min_trailing_silence = 0.8;
        config.rule2_min_trailing_silence = 0.8;
        config.rule3_min_utterance_length = 20.0;
        config.decoding_method = Some("greedy_search".into());

        let recognizer = OnlineRecognizer::create(&config).ok_or_else(|| {
            "创建 OnlineRecognizer 失败，请检查模型与 sherpa-onnx 运行时".to_string()
        })?;

        Ok(Self { recognizer, paths })
    }

    pub fn model_dir(&self) -> &Path {
        &self.paths.dir
    }

    pub fn open_session(&self, sample_rate: u32) -> SessionStream {
        SessionStream {
            stream: self.recognizer.create_stream(),
            sample_rate,
            segment_index: 0,
            last_emitted: String::new(),
        }
    }

    pub fn feed_i16(&self, session: &mut SessionStream, pcm: &[i16]) -> Vec<DecodeTick> {
        if pcm.is_empty() {
            return vec![];
        }
        let samples: Vec<f32> = pcm
            .iter()
            .map(|&s| s as f32 / if s < 0 { 32768.0 } else { 32767.0 })
            .collect();
        session
            .stream
            .accept_waveform(session.sample_rate as i32, &samples);
        self.decode_loop(session)
    }

    pub fn finish(&self, session: &mut SessionStream) -> Vec<DecodeTick> {
        // 尾部静音帮助端点触发
        let pad_len = (session.sample_rate as f32 * 0.4).round() as usize;
        let pad = vec![0.0f32; pad_len];
        session
            .stream
            .accept_waveform(session.sample_rate as i32, &pad);
        session.stream.input_finished();

        let mut ticks = self.decode_loop(session);
        // 强制收尾：若还有未 final 文本，作为 final 发出
        if let Some(result) = self.recognizer.get_result(&session.stream) {
            let text = result.text.trim().to_string();
            if !text.is_empty() {
                let segment_id = format!("seg_{}", session.segment_index);
                ticks.push(DecodeTick::Final { segment_id, text });
                self.recognizer.reset(&session.stream);
                session.segment_index += 1;
                session.last_emitted.clear();
            }
        }
        ticks
    }

    fn decode_loop(&self, session: &mut SessionStream) -> Vec<DecodeTick> {
        let mut ticks = Vec::new();
        while self.recognizer.is_ready(&session.stream) {
            self.recognizer.decode(&session.stream);

            if let Some(result) = self.recognizer.get_result(&session.stream) {
                let text = result.text.trim().to_string();
                if !text.is_empty() && text != session.last_emitted {
                    session.last_emitted = text.clone();
                    ticks.push(DecodeTick::Partial {
                        segment_id: format!("seg_{}", session.segment_index),
                        text,
                    });
                }
            }

            if self.recognizer.is_endpoint(&session.stream) {
                if let Some(result) = self.recognizer.get_result(&session.stream) {
                    let text = result.text.trim().to_string();
                    if !text.is_empty() {
                        ticks.push(DecodeTick::Final {
                            segment_id: format!("seg_{}", session.segment_index),
                            text,
                        });
                    }
                }
                self.recognizer.reset(&session.stream);
                session.segment_index += 1;
                session.last_emitted.clear();
            }
        }
        ticks
    }
}
