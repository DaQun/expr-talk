pub mod wav;
pub mod writer;

use std::collections::HashMap;
use std::sync::Mutex;
use writer::ActiveRecording;

/// 进程内录音状态：session_id → 正在写入的 WAV
pub struct AudioState {
    pub recordings: Mutex<HashMap<String, ActiveRecording>>,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            recordings: Mutex::new(HashMap::new()),
        }
    }
}
