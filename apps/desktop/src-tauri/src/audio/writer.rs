use super::wav::{create_wav_file, patch_wav_sizes};
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

pub struct ActiveRecording {
    pub path: PathBuf,
    pub file: File,
    pub sample_rate: u32,
    pub sample_count: u64,
}

impl ActiveRecording {
    pub fn open(path: PathBuf, sample_rate: u32) -> Result<Self, String> {
        let file = create_wav_file(&path, sample_rate).map_err(|e| e.to_string())?;
        Ok(Self {
            path,
            file,
            sample_rate,
            sample_count: 0,
        })
    }

    pub fn append_i16(&mut self, pcm: &[i16]) -> Result<(), String> {
        let mut bytes = Vec::with_capacity(pcm.len() * 2);
        for &s in pcm {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        self.file.write_all(&bytes).map_err(|e| e.to_string())?;
        self.sample_count += pcm.len() as u64;
        Ok(())
    }

    pub fn finish(mut self) -> Result<(PathBuf, u64, u32), String> {
        let data_size = (self.sample_count * 2) as u32;
        patch_wav_sizes(&mut self.file, data_size).map_err(|e| e.to_string())?;
        self.file.flush().map_err(|e| e.to_string())?;
        Ok((self.path, self.sample_count, self.sample_rate))
    }
}
