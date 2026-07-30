use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig};
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../models/streaming-zipformer-zh-en");
    println!("model dir: {} exists={}", dir.display(), dir.is_dir());
    let encoder = dir.join("encoder-epoch-99-avg-1.int8.onnx");
    let decoder = dir.join("decoder-epoch-99-avg-1.onnx");
    let joiner = dir.join("joiner-epoch-99-avg-1.int8.onnx");
    let tokens = dir.join("tokens.txt");
    for p in [&encoder, &decoder, &joiner, &tokens] {
        println!("  {} ok={}", p.file_name().unwrap().to_string_lossy(), p.is_file());
    }

    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(encoder.to_string_lossy().into());
    config.model_config.transducer.decoder = Some(decoder.to_string_lossy().into());
    config.model_config.transducer.joiner = Some(joiner.to_string_lossy().into());
    config.model_config.tokens = Some(tokens.to_string_lossy().into());
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 2;
    config.enable_endpoint = true;
    config.decoding_method = Some("greedy_search".into());

    let t0 = Instant::now();
    println!("creating OnlineRecognizer...");
    let recognizer = match OnlineRecognizer::create(&config) {
        Some(r) => {
            println!("OK in {:?}", t0.elapsed());
            r
        }
        None => {
            eprintln!("FAILED: OnlineRecognizer::create returned None");
            std::process::exit(1);
        }
    };

    // feed test wav if present
    let wav = dir.join("test_wavs/0.wav");
    if wav.is_file() {
        if let Some(wave) = sherpa_onnx::Wave::read(wav.to_str().unwrap()) {
            println!("wave sr={} samples={}", wave.sample_rate(), wave.samples().len());
            let stream = recognizer.create_stream();
            stream.accept_waveform(wave.sample_rate(), wave.samples());
            stream.input_finished();
            while recognizer.is_ready(&stream) {
                recognizer.decode(&stream);
            }
            if let Some(result) = recognizer.get_result(&stream) {
                println!("RESULT: {:?}", result.text);
            } else {
                println!("RESULT: <none>");
            }
        } else {
            println!("Wave::read failed for {}", wav.display());
        }
    } else {
        println!("no test wav at {}", wav.display());
    }
}
