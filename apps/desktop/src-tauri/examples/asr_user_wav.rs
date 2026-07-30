use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig, Wave};
use std::path::PathBuf;
fn main() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../models/streaming-zipformer-zh-en");
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(dir.join("encoder-epoch-99-avg-1.int8.onnx").to_string_lossy().into());
    config.model_config.transducer.decoder = Some(dir.join("decoder-epoch-99-avg-1.onnx").to_string_lossy().into());
    config.model_config.transducer.joiner = Some(dir.join("joiner-epoch-99-avg-1.int8.onnx").to_string_lossy().into());
    config.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().into());
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 2;
    config.enable_endpoint = true;
    config.decoding_method = Some("greedy_search".into());
    let recognizer = OnlineRecognizer::create(&config).expect("create");
    let wav_path = std::env::args().nth(1).expect("wav path");
    let wave = Wave::read(&wav_path).expect("read wav");
    println!("sr={} n={}", wave.sample_rate(), wave.samples().len());
    let stream = recognizer.create_stream();
    // feed in chunks like realtime
    let samples = wave.samples();
    let chunk = 3200;
    let mut i = 0;
    let mut last = String::new();
    while i < samples.len() {
        let end = (i+chunk).min(samples.len());
        stream.accept_waveform(wave.sample_rate(), &samples[i..end]);
        i = end;
        while recognizer.is_ready(&stream) {
            recognizer.decode(&stream);
        }
        if let Some(r) = recognizer.get_result(&stream) {
            let t = r.text.trim().to_string();
            if !t.is_empty() && t != last {
                println!("partial: {t}");
                last = t;
            }
        }
    }
    stream.input_finished();
    while recognizer.is_ready(&stream) { recognizer.decode(&stream); }
    if let Some(r) = recognizer.get_result(&stream) {
        println!("FINAL: {}", r.text);
    }
}
