import Foundation

/// What the person reads when something is not working: one plain sentence and one thing to do.
/// The technical cause goes to the log.
enum Plain {
    static let noInternet = "No internet connection."
    static let offline = "No internet connection. Tinkjam Sync tries again when you're back online."
    static let networkSignIn = "This network is not letting Tinkjam through. If it is hotel or café Wi-Fi, sign in to it first. Tinkjam Sync tries again by itself."
    static let unreachable = "Could not reach Tinkjam. Check your internet connection. Tinkjam Sync tries again by itself."
    static let serverTrouble = "The download is not available right now. Tinkjam Sync tries again by itself."
    static let damaged = "The download arrived damaged, so it was not used. Tinkjam Sync tries again by itself."
    static let diskFull = "This Mac is out of disk space. Free up some space, then choose Retry."
    static let setupFailed = "Setup could not finish. Tinkjam Sync tries again by itself; choose Retry to try now."
    static let keepsStopping = "Tinkjam Sync keeps stopping on this Mac. It tries again by itself; if this lasts, restart your Mac."
    static let couldNotStart = "Tinkjam Sync could not start. It tries again by itself; if this lasts, restart your Mac."
    static let portBusy = "Another app on this Mac is in the way of connecting. Restart your Mac, then open Tinkjam Sync again."
    static let olderCopy = "Could not replace the older Tinkjam Sync on this Mac. Restart your Mac, then open Tinkjam Sync again."
    static let updateCheckFailed = "Could not check for updates. Try again later."
    static let startingAgain = "Starting again…"
    static let stillTrying = "Tinkjam Sync keeps trying by itself."
    static let stillListed = "This Mac is off, but your account may still list it. Open Tinkjam, go to Settings and press Remove next to it."

    /// Sync's reachability causes (`cause` in sync-status.json), in the person's words.
    static func connecting(cause: String?) -> String? {
        switch cause {
        case nil:
            return nil
        case "edge_unreachable":
            return "Your network is blocking Tinkjam. Try another Wi-Fi network, or turn off your VPN."
        case "dns_failed", "timeout":
            return "Tinkjam can't be reached from this network yet. If this lasts, try another Wi-Fi network or turn off your VPN."
        default:
            return "Still connecting. Tinkjam Sync keeps trying by itself."
        }
    }
}
