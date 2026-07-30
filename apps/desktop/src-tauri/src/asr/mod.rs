mod engine;
mod online;
mod paths;
mod worker;

pub use paths::{download_model_to_app_data, model_status};
pub use worker::AsrHandle;

pub fn test_online_provider(provider: &str, config: &serde_json::Value) -> Result<(), String> {
    online::open_online_session(provider, config, 16_000).map(|_| ())
}
