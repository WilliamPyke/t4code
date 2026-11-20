//! The agents Tinkjam can run that are installed here, and which of them Sync is running now.
//! Only what can be seen: a command on the PATH Sync gets, and a process under Sync.

use serde::{Deserialize, Serialize};

pub struct Known {
    pub id: &'static str,
    pub name: &'static str,
    /// Commands Tinkjam's providers start, first the usual one.
    pub commands: &'static [&'static str],
}

pub const KNOWN: &[Known] = &[
    Known { id: "claude", name: "Claude", commands: &["claude"] },
    Known { id: "codex", name: "Codex", commands: &["codex"] },
    Known { id: "cursor", name: "Cursor", commands: &["cursor-agent"] },
    Known { id: "grok", name: "Grok", commands: &["grok"] },
    Known { id: "opencode", name: "OpenCode", commands: &["opencode"] },
];

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub working: bool,
}

pub fn installed(path: &str) -> Vec<Agent> {
    KNOWN
        .iter()
        .filter(|k| k.commands.iter().any(|c| crate::procs::which(c, path).is_some()))
        .map(|k| Agent { id: k.id.into(), name: k.name.into(), working: false })
        .collect()
}

/// Marks the agents with a process under Sync (`root`).
pub fn mark_working(agents: &mut [Agent], root: Option<i32>) {
    let running: Vec<String> = root.map(|r| crate::procs::descendants(r).into_iter().flat_map(crate::procs::names).collect()).unwrap_or_default();
    for agent in agents.iter_mut() {
        let commands = KNOWN.iter().find(|k| k.id == agent.id).map(|k| k.commands).unwrap_or(&[]);
        agent.working = running.iter().any(|name| commands.contains(&name.as_str()));
    }
}

/// "Claude and Codex", "Claude, Codex and Cursor".
pub fn list_names(agents: &[Agent]) -> String {
    let names: Vec<&str> = agents.iter().map(|a| a.name.as_str()).collect();
    match names.len() {
        0 => String::new(),
        1 => names[0].to_string(),
        n => format!("{} and {}", names[..n - 1].join(", "), names[n - 1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_read_naturally() {
        let a = |n: &str| Agent { id: n.to_lowercase(), name: n.into(), working: false };
        assert_eq!(list_names(&[a("Claude")]), "Claude");
        assert_eq!(list_names(&[a("Claude"), a("Codex")]), "Claude and Codex");
        assert_eq!(list_names(&[a("Claude"), a("Codex"), a("Cursor")]), "Claude, Codex and Cursor");
    }
}
