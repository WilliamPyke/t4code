import AppKit

/// Everything the panel can ask the app to do. Each existing menu action has one.
enum PanelCommand: Int {
    case openTinkjam, openApproval, connect, retry, disconnect, toggleLogin, showLog, checkForUpdates,
         restartToUpdate, downloadUpdate, quit

    /// The panel stays open for these, so the person sees what changed.
    var keepsPanelOpen: Bool { self == .toggleLogin || self == .checkForUpdates }
}

enum PanelTone: Equatable {
    case good, busy, idle, bad

    var color: NSColor {
        switch self {
        case .good: return Palette.success
        case .busy: return Palette.accentText
        case .idle: return Palette.quiet
        case .bad: return Palette.error
        }
    }
}

struct PanelAgent: Equatable {
    let kind: AgentKind
    let state: String
    let tone: PanelTone
}

/// What the panel shows, built by the app from its real state.
struct PanelModel: Equatable {
    var computer = ""
    var status = ""
    var tone = PanelTone.idle
    var detail: String?
    var actionTitle: String?
    var actionCommand: PanelCommand?
    var agents: [PanelAgent] = []
    var agentNote: String?
    var loginTitle = "Start at Login"
    var loginState = NSControl.StateValue.off
    var canDisconnect = false
    var version = ""
    var updateStatus: String?
    var updateTitle: String?
    var updateCommand: PanelCommand?
    var updateNote: String?
}

protocol MenuPanelDelegate: AnyObject {
    func panelModel() -> PanelModel
    func panelPerform(_ command: PanelCommand)
    func panelDidClose()
}

/// A borderless panel that can take keyboard focus while it is open.
final class PanelWindow: NSPanel {
    var onCancel: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) { onCancel?() }
}

/// The panel under the menu bar icon: status, this Mac's agents, Open Tinkjam, settings, version.
/// It replaces the old menu and keeps every one of its actions.
final class MenuPanel: NSObject {
    private let window: PanelWindow
    private let surface = PanelSurface()
    private let stack = NSStackView()
    private weak var delegate: MenuPanelDelegate?
    private weak var anchor: NSStatusBarButton?
    private var shown: PanelModel?
    private var monitors: [Any] = []
    private var refreshTimer: Timer?
    private var settingsOpen = false
    private var focusableButtons: [TinkjamButton] = []
    private var closedAt = Date.distantPast

    init(delegate: MenuPanelDelegate) {
        self.delegate = delegate
        window = PanelWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 200),
                             styleMask: [.borderless], backing: .buffered, defer: true)
        super.init()
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .popUpMenu
        window.hidesOnDeactivate = false
        window.isMovable = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        window.autorecalculatesKeyViewLoop = true
        window.onCancel = { [weak self] in self?.close() }
        window.setAccessibilityTitle("Tinkjam Sync")

        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 14, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false
        surface.addSubview(stack)
        surface.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            surface.widthAnchor.constraint(equalToConstant: 340),
            stack.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
            stack.topAnchor.constraint(equalTo: surface.topAnchor),
            stack.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
        ])
        surface.setAccessibilityElement(true)
        surface.setAccessibilityRole(.group)
        surface.setAccessibilityLabel("Tinkjam Sync")
        window.contentView = surface

        NotificationCenter.default.addObserver(self, selector: #selector(lostFocus), name: NSWindow.didResignKeyNotification,
                                               object: window)
    }

    var isVisible: Bool { window.isVisible }

    /// A click on the icon that itself ended the panel (by taking its focus) must not reopen it.
    func toggle(from button: NSStatusBarButton?) {
        if isVisible {
            close()
        } else if Date().timeIntervalSince(closedAt) > 0.3 {
            open(from: button)
        }
    }

    func open(from button: NSStatusBarButton?) {
        anchor = button
        shown = nil
        refresh()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        // Nothing is focused until Tab is pressed, as in a menu.
        window.makeFirstResponder(nil)
        button?.highlight(true)
        watch()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func close() {
        guard isVisible else { return }
        refreshTimer?.invalidate()
        refreshTimer = nil
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        window.orderOut(nil)
        closedAt = Date()
        anchor?.highlight(false)
        delegate?.panelDidClose()
    }

    /// Re-reads the model; the views are rebuilt only when it changed, so focus stays put.
    func refresh() {
        guard let delegate else { return }
        let model = delegate.panelModel()
        if model != shown {
            shown = model
            build(model)
        }
        place()
    }

    // MARK: Closing on click-away and Esc

    private func watch() {
        if let clicks = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown],
                                                          handler: { [weak self] _ in self?.close() }) {
            monitors.append(clicks)
        }
        if let clicks = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown],
                                                         handler: { [weak self] event in
            if let self, !self.settingsOpen, event.window !== self.window { self.close() }
            return event
        }) {
            monitors.append(clicks)
        }
        if let keys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown], handler: { [weak self] (event: NSEvent) -> NSEvent? in
            guard let self, self.isVisible, self.window.isKeyWindow else { return event }
            if event.keyCode == 53 {
                self.close()
                return nil
            }
            if event.keyCode == 48, !self.focusableButtons.isEmpty {
                let buttons = self.focusableButtons
                let backwards = event.modifierFlags.contains(.shift)
                let current = buttons.firstIndex { $0 === self.window.firstResponder }
                let next = current.map { ($0 + (backwards ? -1 : 1) + buttons.count) % buttons.count }
                    ?? (backwards ? buttons.count - 1 : 0)
                self.window.makeFirstResponder(buttons[next])
                return nil
            }
            // ⌘Q, as the old menu's Quit had.
            if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers == "q" {
                self.run(.quit)
                return nil
            }
            return event
        }) {
            monitors.append(keys)
        }
    }

    @objc private func lostFocus() {
        if !settingsOpen { close() }
    }

    // MARK: Layout

    /// Below the icon, centred on it and kept inside the visible part of the icon's own screen.
    private func place() {
        surface.layoutSubtreeIfNeeded()
        let size = surface.fittingSize
        window.setContentSize(size)
        guard let button = anchor, let buttonWindow = button.window else { return }
        let onScreen = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        let visible = (buttonWindow.screen ?? NSScreen.main)?.visibleFrame ?? onScreen
        var x = onScreen.midX - size.width / 2
        x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
        var y = onScreen.minY - 6 - size.height
        y = max(y, visible.minY + 8)
        window.setFrameOrigin(NSPoint(x: x.rounded(), y: y.rounded()))
        window.invalidateShadow()
    }

    private func build(_ model: PanelModel) {
        focusableButtons.removeAll()
        for view in stack.arrangedSubviews {
            stack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        let width: CGFloat = 308

        add(header(model), after: 0)
        if let detail = model.detail, !detail.isEmpty {
            add(plainLabel(detail, size: 12, color: Palette.body, wraps: true, width: width), after: 12)
        }
        if let title = model.actionTitle, let command = model.actionCommand {
            add(fullWidth(button(title, .secondary, command)), after: 14)
        }

        let section = plainLabel("", size: 11, weight: .semibold, color: Palette.quiet)
        section.attributedStringValue = NSAttributedString(string: "AGENTS ON THIS MAC", attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .semibold), .kern: 0.88, .foregroundColor: Palette.quiet,
        ])
        section.setAccessibilityLabel("Agents on this Mac")
        add(section, after: 16)
        if model.agents.isEmpty {
            add(plainLabel("Install Claude Code or Codex on this Mac to use it from your boards.", size: 12,
                           color: Palette.body, wraps: true, width: width), after: 9)
        }
        for (index, agent) in model.agents.enumerated() {
            if index > 0 { add(fullWidth(RuleView()), after: 0) }
            add(fullWidth(agentRow(agent)), after: 0)
        }
        if let note = model.agentNote {
            add(plainLabel(note, size: 12, color: Palette.body, wraps: true, width: width), after: 6)
        }

        add(fullWidth(button("Open Tinkjam", .primary, .openTinkjam)), after: 12)
        add(fullWidth(linksRow()), after: 10)

        add(fullWidth(RuleView()), after: 10)
        add(fullWidth(footer(model)), after: 10)
        if let title = model.updateTitle, let command = model.updateCommand {
            add(fullWidth(button(title, .secondary, command)), after: 10)
        }
        if let note = model.updateNote {
            add(plainLabel(note, size: 12, color: Palette.body, wraps: true, width: width), after: 8)
        }
        settingsModel = model
    }

    private var settingsModel = PanelModel()

    private func add(_ view: NSView, after spacing: CGFloat) {
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(spacing, after: last) }
        stack.addArrangedSubview(view)
    }

    private func fullWidth(_ view: NSView) -> NSView {
        view.translatesAutoresizingMaskIntoConstraints = false
        view.widthAnchor.constraint(equalToConstant: 308).isActive = true
        return view
    }

    private func header(_ model: PanelModel) -> NSView {
        let mark = fixedImageView(Mark.colourImage(size: 32), size: 32)
        let name = NSTextField(labelWithAttributedString:
            Fonts.headingString("Tinkjam Sync", size: 17, tracking: -0.02, color: Palette.text))
        name.setAccessibilityLabel("Tinkjam Sync")
        let computer = plainLabel(model.computer, size: 12, color: Palette.quiet)
        computer.lineBreakMode = .byTruncatingTail
        computer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let titles = NSStackView(views: [name, computer])
        titles.orientation = .vertical
        titles.alignment = .leading
        titles.spacing = 1
        titles.setHuggingPriority(.defaultLow, for: .horizontal)
        titles.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let dot = DotView(color: model.tone.color)
        let status = plainLabel(model.status, size: 12, weight: .semibold, color: model.tone == .idle ? Palette.body : model.tone.color)
        status.setContentCompressionResistancePriority(.required, for: .horizontal)
        let badge = NSStackView(views: [dot, status])
        badge.orientation = .horizontal
        badge.alignment = .centerY
        badge.spacing = 6
        badge.setHuggingPriority(.required, for: .horizontal)

        let row = NSStackView(views: [mark, titles, badge])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        row.distribution = .fill
        return fullWidth(row)
    }

    private func agentRow(_ agent: PanelAgent) -> NSView {
        let icon = fixedImageView(agent.kind.iconImage(), size: 20)
        if agent.kind.template { icon.contentTintColor = Palette.text }
        let name = plainLabel(agent.kind.name, weight: .semibold)
        name.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let state = plainLabel(agent.state, size: 12, color: agent.tone == .busy ? Palette.accentText : Palette.quiet)
        state.setContentCompressionResistancePriority(.required, for: .horizontal)
        let dot = DotView(color: agent.tone.color)
        let row = NSStackView(views: [icon, name, state, dot])
        row.distribution = .fill
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        row.setCustomSpacing(8, after: state)
        row.edgeInsets = NSEdgeInsets(top: 9, left: 0, bottom: 9, right: 0)
        row.setAccessibilityElement(true)
        row.setAccessibilityRole(.staticText)
        row.setAccessibilityLabel("\(agent.kind.name): \(agent.state)")
        return row
    }

    private func linksRow() -> NSView {
        let settings = TinkjamButton("Settings", style: .link, alignment: .left)
        settings.target = self
        settings.action = #selector(openSettings(_:))
        settings.setAccessibilityHelp("Start at login, the log, updates and disconnecting")
        focusableButtons.append(settings)
        let quit = button("Quit", .link, .quit)
        let spacer = NSView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        let row = NSStackView(views: [settings, spacer, quit])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.distribution = .fill
        return row
    }

    private func footer(_ model: PanelModel) -> NSView {
        let version = plainLabel(model.version, size: 12, color: Palette.quiet)
        let spacer = NSView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        var views: [NSView] = [version, spacer]
        if let status = model.updateStatus { views.append(plainLabel(status, size: 12, color: Palette.quiet)) }
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.distribution = .fill
        return row
    }

    private func button(_ title: String, _ style: TinkjamButton.Style, _ command: PanelCommand) -> TinkjamButton {
        let button = TinkjamButton(title, style: style)
        button.tag = command.rawValue
        button.target = self
        button.action = #selector(pressed(_:))
        focusableButtons.append(button)
        return button
    }

    // MARK: Actions

    @objc private func pressed(_ sender: NSButton) {
        guard let command = PanelCommand(rawValue: sender.tag) else { return }
        run(command)
    }

    @objc private func picked(_ sender: NSMenuItem) {
        guard let command = PanelCommand(rawValue: sender.tag) else { return }
        run(command)
    }

    private func run(_ command: PanelCommand) {
        if !command.keepsPanelOpen { close() }
        delegate?.panelPerform(command)
        if command.keepsPanelOpen, isVisible { refresh() }
    }

    /// Start at Login, Show Log, Check for Updates and Disconnect, as a menu under "Settings".
    @objc private func openSettings(_ sender: NSButton) {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let login = item(settingsModel.loginTitle, .toggleLogin)
        login.state = settingsModel.loginState
        menu.addItem(login)
        menu.addItem(item("Show Log", .showLog))
        menu.addItem(item("Check for Updates", .checkForUpdates))
        if settingsModel.canDisconnect {
            menu.addItem(.separator())
            menu.addItem(item("Disconnect this Mac…", .disconnect))
        }
        settingsOpen = true
        // The point is the menu's top-left corner: just under the button.
        let below = sender.isFlipped ? sender.bounds.height + 4 : -4
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: below), in: sender)
        settingsOpen = false
        // The menu took the keyboard; give it back so Tab and Esc keep working.
        if isVisible { window.makeKey() }
    }

    private func item(_ title: String, _ command: PanelCommand) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(picked(_:)), keyEquivalent: "")
        item.target = self
        item.tag = command.rawValue
        return item
    }
}

/// The panel's rounded background, drawn so its colours follow the appearance.
final class PanelSurface: NSView {
    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 14, yRadius: 14)
        Palette.surface.setFill()
        shape.fill()
        Palette.rule.setStroke()
        shape.lineWidth = 1
        shape.stroke()
    }
}
