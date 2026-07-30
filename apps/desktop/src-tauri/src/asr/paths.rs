use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 默认 streaming zipformer 中英双语模型目录名
pub const DEFAULT_MODEL_DIR_NAME: &str = "streaming-zipformer-zh-en";

const ENCODER: &str = "encoder-epoch-99-avg-1.int8.onnx";
const DECODER: &str = "decoder-epoch-99-avg-1.onnx";
const JOINER: &str = "joiner-epoch-99-avg-1.int8.onnx";
const TOKENS: &str = "tokens.txt";

#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub dir: PathBuf,
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
}

/// 压缩包约 190–220 MB；解压后核心文件约 250–320 MB（随版本略有差异）
pub const EXPECTED_ARCHIVE_BYTES: u64 = 210 * 1024 * 1024;
pub const EXPECTED_UNPACKED_BYTES: u64 = 280 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub ready: bool,
    pub model_dir: Option<String>,
    pub missing: Vec<String>,
    pub hint: String,
    /// 已下载核心文件实际字节数（encoder/decoder/joiner/tokens）
    pub size_bytes: Option<u64>,
    /// 可读大小，如 "268 MB"
    pub size_label: Option<String>,
    /// 下载前预估解压后体积
    pub expected_size_bytes: u64,
    pub expected_size_label: String,
    /// 压缩包预估（下载流量）
    pub expected_archive_bytes: u64,
    pub expected_archive_label: String,
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{bytes} B")
    }
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// 统计模型核心文件体积；目录存在时也可扫整个目录作参考
fn measure_model_size(paths: &ModelPaths) -> (u64, Option<String>) {
    let core = file_size(&paths.encoder)
        + file_size(&paths.decoder)
        + file_size(&paths.joiner)
        + file_size(&paths.tokens);
    if core == 0 {
        return (0, None);
    }
    (core, Some(format_bytes(core)))
}

fn status_base() -> (u64, String, u64, String) {
    (
        EXPECTED_UNPACKED_BYTES,
        format_bytes(EXPECTED_UNPACKED_BYTES),
        EXPECTED_ARCHIVE_BYTES,
        format_bytes(EXPECTED_ARCHIVE_BYTES),
    )
}

fn dir_if_valid(p: PathBuf) -> Option<PathBuf> {
    if !p.is_dir() {
        return None;
    }
    let paths = model_paths_from_dir(&p);
    if validate_model(&paths).is_ok() {
        Some(p.canonicalize().unwrap_or(p))
    } else {
        // 目录在但文件不全：仍返回，让 model_status 报告 missing
        Some(p.canonicalize().unwrap_or(p))
    }
}

pub fn resolve_model_dir(app: &AppHandle) -> Option<PathBuf> {
    // 1) 环境变量优先
    if let Ok(dir) = std::env::var("EXPR_TALK_ASR_MODEL_DIR") {
        if let Some(p) = dir_if_valid(PathBuf::from(dir)) {
            return Some(p);
        }
    }

    // 2) App data（设置页下载 / 开发时软链都落这里，不依赖 cwd）
    if let Ok(base) = app.path().app_data_dir() {
        if let Some(p) = dir_if_valid(base.join("models").join(DEFAULT_MODEL_DIR_NAME)) {
            return Some(p);
        }
    }

    // 3) 相对 cwd（tauri dev 常见 cwd = src-tauri）
    let cwd_candidates = [
        PathBuf::from("models").join(DEFAULT_MODEL_DIR_NAME),
        PathBuf::from("../models").join(DEFAULT_MODEL_DIR_NAME),
        PathBuf::from("../../models").join(DEFAULT_MODEL_DIR_NAME),
        PathBuf::from("../../../models").join(DEFAULT_MODEL_DIR_NAME),
        PathBuf::from("../../../../models").join(DEFAULT_MODEL_DIR_NAME),
    ];
    for p in cwd_candidates {
        if let Some(found) = dir_if_valid(p) {
            return Some(found);
        }
    }

    // 4) 相对可执行文件（target/debug/desktop → 仓库 models/）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let exe_candidates = [
                exe_dir.join("../../../models").join(DEFAULT_MODEL_DIR_NAME),
                exe_dir
                    .join("../../../../models")
                    .join(DEFAULT_MODEL_DIR_NAME),
                exe_dir.join("models").join(DEFAULT_MODEL_DIR_NAME),
            ];
            for p in exe_candidates {
                if let Some(found) = dir_if_valid(p) {
                    return Some(found);
                }
            }
        }
    }

    None
}

pub fn model_paths_from_dir(dir: &Path) -> ModelPaths {
    ModelPaths {
        dir: dir.to_path_buf(),
        encoder: dir.join(ENCODER),
        decoder: dir.join(DECODER),
        joiner: dir.join(JOINER),
        tokens: dir.join(TOKENS),
    }
}

pub fn validate_model(paths: &ModelPaths) -> Result<(), Vec<String>> {
    let mut missing = Vec::new();
    for (label, path) in [
        (ENCODER, &paths.encoder),
        (DECODER, &paths.decoder),
        (JOINER, &paths.joiner),
        (TOKENS, &paths.tokens),
    ] {
        if !path.is_file() {
            missing.push(label.to_string());
        }
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(missing)
    }
}

pub fn model_status(app: &AppHandle) -> ModelStatus {
    let (expected_size_bytes, expected_size_label, expected_archive_bytes, expected_archive_label) =
        status_base();

    match resolve_model_dir(app) {
        None => ModelStatus {
            ready: false,
            model_dir: None,
            missing: vec![
                ENCODER.into(),
                DECODER.into(),
                JOINER.into(),
                TOKENS.into(),
            ],
            hint: format!(
                "本地模型未下载（压缩包约 {expected_archive_label}，解压后约 {expected_size_label}）。请点击「下载本地模型」，或改用在线 ASR。"
            ),
            size_bytes: None,
            size_label: None,
            expected_size_bytes,
            expected_size_label,
            expected_archive_bytes,
            expected_archive_label,
        },
        Some(dir) => {
            let paths = model_paths_from_dir(&dir);
            let (size_bytes, size_label) = measure_model_size(&paths);
            match validate_model(&paths) {
                Ok(()) => ModelStatus {
                    ready: true,
                    model_dir: Some(dir.to_string_lossy().into_owned()),
                    missing: vec![],
                    hint: format!(
                        "本地 streaming zipformer 就绪（核心文件 {}）",
                        size_label.clone().unwrap_or_else(|| expected_size_label.clone())
                    ),
                    size_bytes: if size_bytes > 0 { Some(size_bytes) } else { None },
                    size_label,
                    expected_size_bytes,
                    expected_size_label,
                    expected_archive_bytes,
                    expected_archive_label,
                },
                Err(missing) => ModelStatus {
                    ready: false,
                    model_dir: Some(dir.to_string_lossy().into_owned()),
                    missing,
                    hint: format!(
                        "模型目录不完整（已有 {} / 预计 {}）。请重新下载。",
                        size_label.clone().unwrap_or_else(|| "0 B".into()),
                        expected_size_label
                    ),
                    size_bytes: if size_bytes > 0 { Some(size_bytes) } else { None },
                    size_label,
                    expected_size_bytes,
                    expected_size_label: expected_size_label.clone(),
                    expected_archive_bytes,
                    expected_archive_label,
                },
            }
        }
    }
}

/// 下载默认 streaming zipformer 到 app_data/models/（用户手动触发，不随安装附带）
pub fn download_model_to_app_data(app: &AppHandle) -> Result<ModelStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let models_root = base.join("models");
    let target = models_root.join(DEFAULT_MODEL_DIR_NAME);
    std::fs::create_dir_all(&models_root).map_err(|e| e.to_string())?;

    // 已完整则跳过
    let paths = model_paths_from_dir(&target);
    if validate_model(&paths).is_ok() {
        return Ok(model_status(app));
    }

    let url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2";
    let tar_path = models_root.join("streaming-zipformer-zh-en.tar.bz2");
    let extract_name = "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20";

    // 用系统 curl（macOS 自带），支持大文件与断点
    let status = std::process::Command::new("curl")
        .args([
            "-L",
            "--fail",
            "--retry",
            "5",
            "--retry-delay",
            "2",
            "-C",
            "-",
            "-o",
        ])
        .arg(&tar_path)
        .arg(url)
        .status()
        .map_err(|e| format!("启动 curl 失败: {e}"))?;
    if !status.success() {
        return Err(
            "下载模型失败（curl 非 0）。请检查网络或手动运行 scripts/download-asr-model.sh".into(),
        );
    }

    let _ = std::fs::remove_dir_all(models_root.join(extract_name));
    let _ = std::fs::remove_dir_all(&target);

    let untar = std::process::Command::new("tar")
        .args(["-xjf"])
        .arg(&tar_path)
        .current_dir(&models_root)
        .status()
        .map_err(|e| format!("解压失败: {e}"))?;
    if !untar.success() {
        return Err("解压模型失败".into());
    }

    let extracted = models_root.join(extract_name);
    if extracted.is_dir() {
        std::fs::rename(&extracted, &target).map_err(|e| format!("移动模型目录失败: {e}"))?;
    }
    let _ = std::fs::remove_file(&tar_path);

    let paths = model_paths_from_dir(&target);
    validate_model(&paths).map_err(|m| format!("下载后仍缺文件: {}", m.join(", ")))?;
    Ok(model_status(app))
}
