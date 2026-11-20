//! What linux.json and sync.json name is installed only when Tinkjam's release key signed it, not
//! because a server served it. Same rule and keys as scripts/sync-package/updateCheck.ts,
//! apps/sync-windows/src/ReleaseSignature.cs and apps/sync-mac/.../ReleaseSignature.swift;
//! `node scripts/sign-release.ts public` prints them.

use base64::{engine::general_purpose::STANDARD, Engine};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde_json::{Map, Value};

/// keyId to the P-256 key's raw x||y (base64), as CryptoKit takes it. The second is held back
/// for rotation.
pub const PUBLIC_KEYS: &[(&str, &str)] = &[
    ("ef314cdf2274b761", "OWhWhpaREXvpaUlBj0bCM9JZ0wmuarNs1D1LCKJXKb+yrCM9kSXnUGHkEzKVj5uSerr38r8Si488l03ltzl7wg=="),
    ("abba1fb4c21713ca", "UgGkI4A4huZQzmxgXfcRXLA3KsIB8/5kojMQOJRjVwVA4RQjHk8lQD7KvVZclEoPdjM1oUD2fTy7cwW+1zmh3w=="),
];

const SIGNED_FIELDS: [&str; 5] = ["version", "build", "url", "sha256", "minimumSystemVersion"];

/// The exact text the signature covers. A missing or null field is empty; anything else that is
/// not a string, or holds a line break, has no canonical form and so can never verify.
pub fn canonical(kind: &str, manifest: &Map<String, Value>) -> Option<String> {
    let mut lines = vec!["tinkjam-release-v1".to_string(), format!("kind={kind}")];
    for field in SIGNED_FIELDS {
        let text = match manifest.get(field) {
            None | Some(Value::Null) => "",
            Some(Value::String(text)) => text.as_str(),
            Some(_) => return None,
        };
        if text.contains('\n') || text.contains('\r') {
            return None;
        }
        lines.push(format!("{field}={text}"));
    }
    Some(lines.join("\n"))
}

pub fn verify(kind: &str, manifest: &Map<String, Value>) -> bool {
    verify_with(kind, manifest, PUBLIC_KEYS)
}

pub fn verify_with(kind: &str, manifest: &Map<String, Value>, keys: &[(&str, &str)]) -> bool {
    let (Some(Value::String(key_id)), Some(Value::String(signature))) = (manifest.get("keyId"), manifest.get("signature")) else {
        return false;
    };
    let Some(text) = canonical(kind, manifest) else { return false };
    let Some((_, encoded)) = keys.iter().find(|(id, _)| id == key_id) else { return false };
    let (Ok(raw), Ok(signed)) = (STANDARD.decode(encoded), STANDARD.decode(signature)) else { return false };
    if raw.len() != 64 || signed.len() != 64 {
        return false;
    }
    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(&raw);
    let (Ok(key), Ok(signature)) = (VerifyingKey::from_sec1_bytes(&sec1), Signature::from_slice(&signed)) else {
        return false;
    };
    key.verify(text.as_bytes(), &signature).is_ok()
}

/// sync.tgz unpacked as the package itself: only npm's `package/` folder, plain files and folders.
pub mod package_archive {
    pub fn safe_name(name: &str) -> bool {
        name.starts_with("package/") && !name.contains('\\') && !name.contains(':') && !name.split('/').any(|part| part == "..")
    }
}

/// npm installs exactly the package's npm-shrinkwrap.json, with no install scripts but the two
/// native ones.
pub mod npm_commands {
    pub fn ci(npm_cli: &str, cache: &str) -> Vec<String> {
        [npm_cli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--cache", cache]
            .map(String::from)
            .to_vec()
    }

    pub fn rebuild(npm_cli: &str, cache: &str) -> Vec<String> {
        [npm_cli, "rebuild", "koffi", "node-pty", "--loglevel=error", "--cache", cache].map(String::from).to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::elliptic_curve::{bigint::Encoding, Curve};

    // Published on 20 Nov 2026 at https://tinkjam.com/sync.json and /downloads/mac.json.
    const SYNC_JSON: &str = r#"{"kind":"sync","version":"0.1.7+202611200033","url":"https://trellium.org/sync.tgz","sha256":"45546853d830e27f61a77fe4b9d0b1161769c0dfef5dd371896823b8dd37d896","keyId":"ef314cdf2274b761","signature":"mpIRhSuEA4oWQ+I9Z/V+CiQzMvFPPBcr69zrGD8MjT6ty4KdGEPw6DoVz8Ph9Gdj0XXFo39m1SDgLUbOPoNoOQ=="}"#;
    const MAC_JSON: &str = r#"{"kind":"mac","version":"1.0.5","build":"202611200012","url":"https://trellium.org/downloads/Tinkjam-Sync-mac.zip","sha256":"c2946a6c6503988dc3357422667258c05b8366995cc35e83ba01ec91f36f3dfc","minimumSystemVersion":"13.0","keyId":"ef314cdf2274b761","signature":"Wwqc8BXQqversgbQp7LzM0FTCLWAc6kxHyQn42rAl0owRRihZ69y34yFwRjLD4C/8iXe+67+jMi3tXwQ9GZw5w=="}"#;

    fn parse(text: &str) -> Map<String, Value> {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn accepts_published_manifests() {
        assert!(verify("sync", &parse(SYNC_JSON)));
        assert!(verify("mac", &parse(MAC_JSON)));
    }

    #[test]
    fn refuses_tampering_and_the_wrong_kind() {
        let mut changed = parse(SYNC_JSON);
        changed.insert("sha256".into(), Value::String("0".repeat(64)));
        assert!(!verify("sync", &changed));
        let mut url = parse(SYNC_JSON);
        url.insert("url".into(), Value::String("https://example.com/sync.tgz".into()));
        assert!(!verify("sync", &url));
        // A field the signature does not cover may be added, as on the other platforms.
        let mut extra = parse(SYNC_JSON);
        extra.insert("note".into(), Value::String("hello".into()));
        assert!(verify("sync", &extra));
        // A signed field that was empty may not be filled in.
        let mut build = parse(SYNC_JSON);
        build.insert("build".into(), Value::String("1".into()));
        assert!(!verify("sync", &build));
        assert!(!verify("linux", &parse(SYNC_JSON)));
        assert!(!verify("sync", &parse(MAC_JSON)));
    }

    #[test]
    fn refuses_unknown_keys_bad_encodings_and_non_strings() {
        let mut key = parse(SYNC_JSON);
        key.insert("keyId".into(), Value::String("0000000000000000".into()));
        assert!(!verify("sync", &key));
        let mut other_trusted = parse(SYNC_JSON);
        other_trusted.insert("keyId".into(), Value::String("abba1fb4c21713ca".into()));
        assert!(!verify("sync", &other_trusted));
        let mut short = parse(SYNC_JSON);
        short.insert("signature".into(), Value::String("AAAA".into()));
        assert!(!verify("sync", &short));
        let mut unsigned = parse(SYNC_JSON);
        unsigned.remove("signature");
        assert!(!verify("sync", &unsigned));
        let mut number = parse(SYNC_JSON);
        number.insert("build".into(), Value::from(5));
        assert!(!verify("sync", &number));
        let mut newline = parse(SYNC_JSON);
        newline.insert("version".into(), Value::String("0.1.7\n".into()));
        assert!(canonical("sync", &newline).is_none());
        assert!(!verify("sync", &newline));
    }

    /// Node signs without normalizing s, so a high-s signature must verify just as Node, CNG and
    /// CryptoKit accept it.
    #[test]
    fn accepts_the_high_s_form_of_a_valid_signature() {
        let manifest = parse(SYNC_JSON);
        let raw = STANDARD.decode(manifest["signature"].as_str().unwrap()).unwrap();
        let n = p256::NistP256::ORDER;
        let s = p256::elliptic_curve::bigint::U256::from_be_slice(&raw[32..]);
        let flipped = n.wrapping_sub(&s);
        let mut other = raw[..32].to_vec();
        other.extend_from_slice(&flipped.to_be_bytes());
        let mut high = manifest.clone();
        high.insert("signature".into(), Value::String(STANDARD.encode(&other)));
        assert!(verify("sync", &high), "the other s for the same r must verify");
    }

    #[test]
    fn canonical_text_matches_the_signer() {
        let text = canonical("sync", &parse(SYNC_JSON)).unwrap();
        assert_eq!(
            text,
            "tinkjam-release-v1\nkind=sync\nversion=0.1.7+202611200033\nbuild=\nurl=https://trellium.org/sync.tgz\nsha256=45546853d830e27f61a77fe4b9d0b1161769c0dfef5dd371896823b8dd37d896\nminimumSystemVersion="
        );
    }

    #[test]
    fn archive_names() {
        assert!(package_archive::safe_name("package/dist/bin.mjs"));
        assert!(!package_archive::safe_name("dist/bin.mjs"));
        assert!(!package_archive::safe_name("package/../etc/passwd"));
        assert!(!package_archive::safe_name("package/a\\b"));
        assert!(!package_archive::safe_name("package/C:x"));
    }
}
