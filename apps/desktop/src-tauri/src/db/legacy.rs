use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub const LEGACY_BUNDLE_ID: &str = "com.exprtalk.app";
pub const BUNDLE_ID: &str = "com.showtalk.app";
pub const LEGACY_DB_NAME: &str = "expr-talk.sqlite";
pub const DB_NAME: &str = "showtalk.sqlite";

/// Copy leftover ExprTalk app data into the ShowTalk directory and rewrite stored paths.
pub fn migrate_legacy_app_data(new_base: &Path) -> Result<(), String> {
    let Some(parent) = new_base.parent() else {
        return Ok(());
    };
    let old_base = parent.join(LEGACY_BUNDLE_ID);
    fs::create_dir_all(new_base).map_err(|e| format!("创建数据目录失败: {e}"))?;

    if old_base.exists() && old_base != new_base {
        copy_missing(&old_base, new_base)?;
    }
    promote_db_filename(new_base)?;
    Ok(())
}

pub fn rewrite_legacy_paths(conn: &Connection) -> Result<u64, String> {
    let mut changed = 0u64;
    for (table, column) in [
        ("sessions", "audio_path"),
        ("sessions", "debate_json"),
        ("sessions", "live_transcript"),
        ("sessions", "final_transcript"),
        ("sessions", "metrics_json"),
        ("sessions", "report_json"),
        ("sessions", "comparison_json"),
        ("settings", "value_json"),
    ] {
        let sql = format!(
            "UPDATE {table} SET {column} = replace({column}, ?1, ?2) WHERE {column} LIKE '%' || ?1 || '%'"
        );
        changed += conn
            .execute(&sql, [LEGACY_BUNDLE_ID, BUNDLE_ID])
            .map_err(|e| format!("rewrite {table}.{column}: {e}"))? as u64;
    }
    Ok(changed)
}

fn promote_db_filename(base: &Path) -> Result<(), String> {
    let new_db = base.join(DB_NAME);
    if new_db.exists() {
        return Ok(());
    }
    let old_db = base.join(LEGACY_DB_NAME);
    if !old_db.exists() {
        return Ok(());
    }
    rename_if_exists(&old_db, &new_db)?;
    rename_if_exists(
        &base.join(format!("{LEGACY_DB_NAME}-wal")),
        &base.join(format!("{DB_NAME}-wal")),
    )?;
    rename_if_exists(
        &base.join(format!("{LEGACY_DB_NAME}-shm")),
        &base.join(format!("{DB_NAME}-shm")),
    )?;
    Ok(())
}

fn rename_if_exists(from: &Path, to: &Path) -> Result<(), String> {
    if from.exists() && !to.exists() {
        fs::rename(from, to).map_err(|e| format!("重命名 {} 失败: {e}", from.display()))?;
    }
    Ok(())
}

fn dest_name(name: &str) -> String {
    if let Some(rest) = name.strip_prefix(LEGACY_DB_NAME) {
        format!("{DB_NAME}{rest}")
    } else {
        name.to_string()
    }
}

fn copy_missing(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("创建 {} 失败: {e}", dest.display()))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取 {} 失败: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".DS_Store" {
            continue;
        }
        copy_entry(&entry.path(), &dest.join(dest_name(&name)))?;
    }
    Ok(())
}

fn copy_entry(src: &Path, dest: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(src).map_err(|e| format!("读取 {} 失败: {e}", src.display()))?;
    if meta.file_type().is_symlink() {
        if dest.exists() || dest.symlink_metadata().is_ok() {
            return Ok(());
        }
        let target =
            fs::read_link(src).map_err(|e| format!("读取符号链接 {} 失败: {e}", src.display()))?;
        symlink_to(&target, dest)?;
        return Ok(());
    }
    if meta.is_dir() {
        copy_missing(src, dest)?;
        return Ok(());
    }
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 {} 失败: {e}", parent.display()))?;
    }
    fs::copy(src, dest).map_err(|e| format!("复制 {} 失败: {e}", src.display()))?;
    Ok(())
}

fn symlink_to(target: &Path, dest: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, dest)
            .map_err(|e| format!("创建符号链接 {} 失败: {e}", dest.display()))
    }
    #[cfg(not(unix))]
    {
        if target.is_dir() {
            copy_missing(target, dest)
        } else {
            fs::copy(target, dest)
                .map(|_| ())
                .map_err(|e| format!("复制 {} 失败: {e}", target.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "showtalk-legacy-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_recordings_promotes_db_and_rewrites_paths() {
        let parent = temp_dir("parent");
        let old = parent.join(LEGACY_BUNDLE_ID);
        let new = parent.join(BUNDLE_ID);
        fs::create_dir_all(old.join("recordings")).unwrap();
        fs::write(old.join("recordings/ses_a.wav"), b"wav").unwrap();
        let conn = Connection::open(old.join(LEGACY_DB_NAME)).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT, audio_path TEXT, debate_json TEXT, live_transcript TEXT, final_transcript TEXT, metrics_json TEXT, report_json TEXT, comparison_json TEXT);
             CREATE TABLE settings (key TEXT, value_json TEXT);",
        )
        .unwrap();
        let old_path = format!(
            "/Users/cq/Library/Application Support/{LEGACY_BUNDLE_ID}/recordings/ses_a.wav"
        );
        conn.execute(
            "INSERT INTO sessions (id, audio_path, debate_json) VALUES (?1, ?2, ?3)",
            params![
                "ses_a",
                old_path,
                format!(r#"{{"turns":[{{"audioFile":"{old_path}"}}]}}"#)
            ],
        )
        .unwrap();
        drop(conn);

        migrate_legacy_app_data(&new).unwrap();
        assert!(new.join("recordings/ses_a.wav").is_file());
        assert!(new.join(DB_NAME).is_file());
        assert!(!new.join(LEGACY_DB_NAME).exists());

        let conn = Connection::open(new.join(DB_NAME)).unwrap();
        let rewritten = rewrite_legacy_paths(&conn).unwrap();
        assert!(rewritten >= 1);
        let audio: String = conn
            .query_row("SELECT audio_path FROM sessions WHERE id = 'ses_a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(audio.contains(BUNDLE_ID));
        assert!(!audio.contains(LEGACY_BUNDLE_ID));
        let debate: String = conn
            .query_row("SELECT debate_json FROM sessions WHERE id = 'ses_a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(debate.contains(BUNDLE_ID));

        fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn skips_existing_destination_files() {
        let parent = temp_dir("skip");
        let old = parent.join(LEGACY_BUNDLE_ID);
        let new = parent.join(BUNDLE_ID);
        fs::create_dir_all(old.join("recordings")).unwrap();
        fs::create_dir_all(new.join("recordings")).unwrap();
        fs::write(old.join("recordings/a.wav"), b"old").unwrap();
        fs::write(new.join("recordings/a.wav"), b"new").unwrap();
        fs::write(new.join(DB_NAME), b"").unwrap();

        migrate_legacy_app_data(&new).unwrap();
        assert_eq!(fs::read(new.join("recordings/a.wav")).unwrap(), b"new");

        fs::remove_dir_all(parent).ok();
    }
}
