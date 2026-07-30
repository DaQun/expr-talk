use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

/// 写 16-bit mono PCM WAV 头（data size 可先写 0，结束时 patch）
pub fn write_wav_header(file: &mut File, sample_rate: u32, data_size: u32) -> std::io::Result<()> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * u32::from(num_channels) * u32::from(bits_per_sample) / 8;
    let block_align = num_channels * bits_per_sample / 8;
    let chunk_size = 36 + data_size;

    file.write_all(b"RIFF")?;
    file.write_all(&chunk_size.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?; // PCM fmt chunk size
    file.write_all(&1u16.to_le_bytes())?; // audio format = PCM
    file.write_all(&num_channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_size.to_le_bytes())?;
    Ok(())
}

pub fn patch_wav_sizes(file: &mut File, data_size: u32) -> std::io::Result<()> {
    let chunk_size = 36 + data_size;
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&chunk_size.to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write_all(&data_size.to_le_bytes())?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

pub fn create_wav_file(path: &Path, sample_rate: u32) -> std::io::Result<File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = File::create(path)?;
    write_wav_header(&mut file, sample_rate, 0)?;
    Ok(file)
}
