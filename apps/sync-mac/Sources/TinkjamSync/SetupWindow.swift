import AppKit

/// What the first-run window shows, built by the app from its real setup state.
struct SetupModel: Equatable {
    enum StepState: Equatable { case waiting, active, done, failed }

    struct Step: Equatable {
        var title: String
        var state: StepState
        var detail: String?
    }

    var title = "Getting this Mac ready"
    var steps: [Step] = []
    /// Shown under the active install step; nil means it moves without a known end.
    var showsProgress = false
    var progress: Double?
    var error: String?
    var buttonTitle: String?
    /// The agents found on this Mac, shown on the art.
    var agents: [AgentKind] = []
}

/// The window a person sees on first launch and while approving: the three real setup steps on
/// the left, the cobalt art on the right.
final class SetupWindow: NSWindowController {
    private let column = NSStackView()
    private let progressBar = NSProgressIndicator()
    private let art = SetupArt()
    private var buttonAction: (() -> Void)?
    private var shown: SetupModel?

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 316),
                              styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Tinkjam Sync"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = Palette.surface
        window.autorecalculatesKeyViewLoop = true
        super.init(window: window)

        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 0
        column.translatesAutoresizingMaskIntoConstraints = false
        art.translatesAutoresizingMaskIntoConstraints = false

        progressBar.style = .bar
        progressBar.minValue = 0
        progressBar.maxValue = 1
        progressBar.controlSize = .small
        progressBar.translatesAutoresizingMaskIntoConstraints = false
        progressBar.widthAnchor.constraint(equalToConstant: 260).isActive = true
        progressBar.setAccessibilityLabel("Setup progress")

        let content = NSView()
        content.addSubview(column)
        content.addSubview(art)
        NSLayoutConstraint.activate([
            content.widthAnchor.constraint(equalToConstant: 640),
            content.heightAnchor.constraint(greaterThanOrEqualToConstant: 316),
            column.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 30),
            column.topAnchor.constraint(equalTo: content.topAnchor, constant: 38),
            column.trailingAnchor.constraint(lessThanOrEqualTo: art.leadingAnchor, constant: -24),
            column.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -28),
            art.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            art.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -10),
            art.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            art.widthAnchor.constraint(equalToConstant: 230),
        ])
        window.contentView = content
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    /// `activate: false` puts the window on screen without taking the keyboard from another app.
    func present(activate: Bool) {
        guard let window else { return }
        if !window.isVisible { window.center() }
        guard activate else {
            window.orderFrontRegardless()
            return
        }
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func show(_ model: SetupModel, action: (() -> Void)? = nil) {
        buttonAction = action
        var withoutProgress = model
        withoutProgress.progress = shown?.progress
        if let shown, shown == withoutProgress {
            // Only the progress moved.
            self.shown = model
            setProgress(model)
            return
        }
        shown = model
        rebuild(model)
    }

    private func setProgress(_ model: SetupModel) {
        if let fraction = model.progress {
            progressBar.isIndeterminate = false
            progressBar.doubleValue = fraction
            progressBar.stopAnimation(nil)
        } else {
            progressBar.isIndeterminate = true
            progressBar.startAnimation(nil)
        }
    }

    private func rebuild(_ model: SetupModel) {
        for view in column.arrangedSubviews {
            column.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        progressBar.stopAnimation(nil)
        let width: CGFloat = 330

        let title = NSTextField(wrappingLabelWithString: "")
        title.attributedStringValue = Fonts.headingString(model.title, size: 26, tracking: -0.03, color: Palette.text,
                                                          lineHeight: 29)
        title.preferredMaxLayoutWidth = width
        title.setAccessibilityRole(.staticText)
        column.addArrangedSubview(title)
        column.setCustomSpacing(14, after: title)

        for step in model.steps {
            let row = stepRow(step, width: width)
            column.addArrangedSubview(row)
            column.setCustomSpacing(10, after: row)
            if step.state == .active, model.showsProgress {
                setProgress(model)
                column.addArrangedSubview(progressBar)
                column.setCustomSpacing(12, after: progressBar)
            }
        }

        if let error = model.error {
            let line = plainLabel(error, size: 13, color: Palette.body, wraps: true, width: width)
            column.setCustomSpacing(12, after: column.arrangedSubviews.last ?? title)
            column.addArrangedSubview(line)
            column.setCustomSpacing(4, after: line)
        }

        if let label = model.buttonTitle {
            let button = TinkjamButton(label, style: .pill)
            button.target = self
            button.action = #selector(pressed)
            button.keyEquivalent = "\r"
            if let last = column.arrangedSubviews.last { column.setCustomSpacing(16, after: last) }
            column.addArrangedSubview(button)
        }

        art.agents = model.agents

        guard let window, let content = window.contentView else { return }
        content.layoutSubtreeIfNeeded()
        let size = content.fittingSize
        if content.frame.size != size {
            // Keep the top edge where it is while the height changes.
            let top = window.frame.maxY
            window.setContentSize(size)
            if window.isVisible { window.setFrameTopLeftPoint(NSPoint(x: window.frame.minX, y: top)) }
        }
    }

    private func stepRow(_ step: SetupModel.Step, width: CGFloat) -> NSView {
        let mark = StepMark(state: step.state)
        let title = plainLabel(step.title, weight: .semibold)
        var texts: [NSView] = [title]
        if let detail = step.detail, !detail.isEmpty {
            texts.append(plainLabel(detail, size: 12, color: Palette.body, wraps: true, width: width - 30))
        }
        let text = NSStackView(views: texts)
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        // Centres the first line on the 20-point mark.
        text.edgeInsets = NSEdgeInsets(top: 2, left: 0, bottom: 0, right: 0)
        let row = NSStackView(views: [mark, text])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        row.setAccessibilityElement(true)
        row.setAccessibilityRole(.staticText)
        let state: String
        switch step.state {
        case .done: state = "done"
        case .active: state = "in progress"
        case .waiting: state = "not started"
        case .failed: state = "stopped"
        }
        row.setAccessibilityLabel("\(step.title), \(state)\(step.detail.map { ". \($0)" } ?? "")")
        return row
    }

    @objc private func pressed() { buttonAction?() }
}

/// The 20-point circle before each step: a check when done, a dot while active, a ring before.
final class StepMark: NSView {
    private let state: SetupModel.StepState

    init(state: SetupModel.StepState) {
        self.state = state
        super.init(frame: NSRect(x: 0, y: 0, width: 20, height: 20))
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 20).isActive = true
        heightAnchor.constraint(equalToConstant: 20).isActive = true
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let circle = NSBezierPath(ovalIn: bounds)
        switch state {
        case .done:
            Palette.success.setFill()
            circle.fill()
            let check = NSBezierPath()
            check.move(to: NSPoint(x: 6.1, y: 10.4))
            check.line(to: NSPoint(x: 8.6, y: 12.9))
            check.line(to: NSPoint(x: 13.9, y: 7.4))
            check.lineWidth = 2.2
            check.lineCapStyle = .round
            check.lineJoinStyle = .round
            Palette.white.setStroke()
            check.stroke()
        case .active:
            Palette.tint.setFill()
            circle.fill()
            Palette.accentText.setFill()
            NSBezierPath(ovalIn: NSRect(x: 6, y: 6, width: 8, height: 8)).fill()
        case .waiting:
            let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 0.75, dy: 0.75))
            ring.lineWidth = 1.5
            Palette.rule.setStroke()
            ring.stroke()
        case .failed:
            Palette.error.setFill()
            circle.fill()
            Palette.white.setFill()
            NSBezierPath(roundedRect: NSRect(x: 9, y: 5, width: 2, height: 6.5), xRadius: 1, yRadius: 1).fill()
            NSBezierPath(ovalIn: NSRect(x: 8.9, y: 13, width: 2.2, height: 2.2)).fill()
        }
    }
}

/// The cobalt half: the paint photo under a cobalt tint, the line, and the agents found here.
/// Decorative, except the agents, which VoiceOver reads as one line.
final class SetupArt: NSView {
    private let photo = Art.image("art")
    private let headline = NSTextField(wrappingLabelWithString: "")
    private let tiles = NSStackView()

    var agents: [AgentKind] = [] {
        didSet {
            guard agents != oldValue else { return }
            for view in tiles.arrangedSubviews {
                tiles.removeArrangedSubview(view)
                view.removeFromSuperview()
            }
            for agent in agents { tiles.addArrangedSubview(AgentTile(agent)) }
            tiles.setAccessibilityLabel(agents.isEmpty ? nil : "Found " + agents.map(\.name).joined(separator: " and "))
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        headline.attributedStringValue = Fonts.headingString("bring your agent to your team's board", size: 27,
                                                             tracking: -0.035, color: Palette.white, lineHeight: 30)
        headline.preferredMaxLayoutWidth = 198
        headline.translatesAutoresizingMaskIntoConstraints = false
        headline.setAccessibilityElement(false)
        tiles.orientation = .horizontal
        tiles.spacing = 8
        tiles.translatesAutoresizingMaskIntoConstraints = false
        tiles.setAccessibilityElement(true)
        tiles.setAccessibilityRole(.staticText)
        addSubview(headline)
        addSubview(tiles)
        NSLayoutConstraint.activate([
            headline.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            headline.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14),
            headline.topAnchor.constraint(equalTo: topAnchor, constant: 20),
            tiles.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            tiles.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -18),
        ])
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    override func draw(_ dirtyRect: NSRect) {
        let clip = NSBezierPath(roundedRect: bounds, xRadius: 10, yRadius: 10)
        NSGraphicsContext.saveGraphicsState()
        clip.addClip()
        Palette.accent.setFill()
        clip.fill()
        if let photo, photo.size.width > 0, photo.size.height > 0 {
            // Fill the panel, cropping the photo's overflow, as CSS `object-fit: cover` does.
            let scale = max(bounds.width / photo.size.width, bounds.height / photo.size.height)
            let drawn = NSSize(width: photo.size.width * scale, height: photo.size.height * scale)
            let rect = NSRect(x: bounds.midX - drawn.width / 2, y: bounds.midY - drawn.height / 2,
                              width: drawn.width, height: drawn.height)
            photo.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        }
        Palette.accentDeep.withAlphaComponent(0.4).setFill()
        clip.fill()
        NSGraphicsContext.restoreGraphicsState()
    }
}

/// A white 38-point tile with an agent's icon.
final class AgentTile: NSView {
    init(_ agent: AgentKind) {
        super.init(frame: NSRect(x: 0, y: 0, width: 38, height: 38))
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 38).isActive = true
        heightAnchor.constraint(equalToConstant: 38).isActive = true
        let icon = fixedImageView(agent.iconImage(), size: 20)
        // The tile is white in both modes, so a template icon is drawn in ink.
        if agent.template { icon.contentTintColor = Palette.rgb(0x17141C) }
        addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    override func draw(_ dirtyRect: NSRect) {
        Palette.white.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 10, yRadius: 10).fill()
    }
}
