//! `<home>/logs/sync.log`: everything the app and Sync say, with the time. Sync's own lines are
//! marked `sync:`, the app's `app:`.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static FILE: Mutex<Option<PathBuf>> = Mutex::new(None);
const LIMIT: u64 = 5 * 1024 * 1024;

pub fn init(path: PathBuf) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    *FILE.lock().unwrap() = Some(path);
}

pub fn app(message: impl AsRef<str>) {
    write("app", message.as_ref());
}

pub fn sync(line: &str) {
    write("sync", line);
}

fn write(source: &str, message: &str) {
    let guard = FILE.lock().unwrap();
    let line = format!("[{}] {source}: {message}\n", now_utc());
    match guard.as_ref() {
        Some(path) => {
            if std::fs::metadata(path).map(|m| m.len() > LIMIT).unwrap_or(false) {
                let _ = std::fs::rename(path, path.with_extension("log.1"));
            }
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = file.write_all(line.as_bytes());
            }
        }
        None => eprint!("{line}"),
    }
    if std::env::var_os("TINKJAM_SYNC_LOG_STDERR").is_some() {
        eprint!("{line}");
    }
}

/// ISO 8601 in UTC, without a date library.
pub fn now_utc() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format_utc(secs)
}

pub fn format_utc(secs: u64) -> String {
    let (days, rem) = (secs / 86400, secs % 86400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// An ISO 8601 UTC time (as Sync writes `checkedAt`) to seconds since 1970.
pub fn parse_utc(text: &str) -> Option<u64> {
    let t = text.trim();
    let num = |a: usize, b: usize| t.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, s) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let (yy, mm) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    u64::try_from(days * 86400 + h * 3600 + mi * 60 + s).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn utc_round_trip() {
        assert_eq!(super::format_utc(0), "1970-01-01T00:00:00Z");
        let t = super::parse_utc("2026-11-20T00:33:12.345Z").unwrap();
        assert_eq!(super::format_utc(t), "2026-11-20T00:33:12Z");
    }
}
