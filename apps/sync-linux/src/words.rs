//! What the person reads when something is in the way: one plain sentence and what to do. The
//! technical cause goes to the log.

pub const OFFLINE: &str = "No internet connection. Tinkjam Sync tries again when you're back online.";
pub const RESTRICTED: &str =
    "This network is blocking part of Tinkjam Sync. Try another network, or turn off your VPN.";
pub const UNREACHABLE: &str = "Could not reach Tinkjam. Tinkjam Sync tries again by itself.";
pub const SERVER_TROUBLE: &str = "The download is not available right now. Tinkjam Sync tries again by itself.";
pub const DAMAGED: &str = "The download arrived damaged, so it was not used. Tinkjam Sync tries again by itself.";
pub const DISK_FULL: &str = "This computer is out of disk space. Free up some space, then choose Try again.";
pub const SETUP_FAILED: &str = "Setup could not finish. Tinkjam Sync tries again by itself; choose Try again to try now.";
pub const KEEPS_STOPPING: &str = "Tinkjam Sync keeps stopping. It tries again in 15 minutes; choose Try again to try now.";
pub const COULD_NOT_START: &str = "Tinkjam Sync could not start. It tries again in 15 minutes; choose Try again to try now.";
pub const PORT_BUSY: &str = "Another program on this computer is in the way of connecting. Restart your computer, then try again.";
pub const ANOTHER_COPY: &str = "Another copy of Tinkjam Sync is running on this computer. Quit it, then choose Try again.";
pub const APPROVAL_UNFINISHED: &str = "The approval wasn't finished. Choose Connect to try again.";
pub const COULD_NOT_DISCONNECT: &str = "Could not disconnect. Check your internet connection, then try again.";
pub const STILL_LISTED: &str =
    "This computer is disconnected, but your account may still list it. Open Tinkjam, go to Settings and press Remove next to it.";
pub const NO_GRAPHICS: &str = "Tinkjam Sync could not open its window on this display.";

/// Sync's reachability causes (`cause` in sync-status.json), in the person's words.
pub fn connecting(cause: Option<&str>) -> Option<&'static str> {
    match cause {
        None => None,
        Some("edge_unreachable") => Some("Your network is blocking Tinkjam. Try another network, or turn off your VPN."),
        Some("dns_failed") | Some("timeout") => {
            Some("Tinkjam can't be reached from this network yet. If this lasts, try another network or turn off your VPN.")
        }
        Some(_) => Some("Still connecting. Tinkjam Sync keeps trying by itself."),
    }
}
