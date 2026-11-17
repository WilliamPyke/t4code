import AppKit

/// The small window a person sees on first launch and while approving, so something visibly
/// happens before the menu bar icon is all there is.
final class SetupWindow: NSWindowController {
    private let titleLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")
    private let progress = NSProgressIndicator()
    private let button = NSButton(title: "", target: nil, action: nil)
    private var buttonAction: (() -> Void)?

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 190),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Tinkjam Sync"
        window.isReleasedWhenClosed = false
        super.init(window: window)

        let icon = NSImageView(image: Mark.colourImage(size: 64))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 64).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 64).isActive = true

        titleLabel.font = .boldSystemFont(ofSize: 15)
        detailLabel.font = .systemFont(ofSize: 12)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.preferredMaxLayoutWidth = 300
        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.widthAnchor.constraint(equalToConstant: 300).isActive = true
        progress.style = .bar
        progress.minValue = 0
        progress.maxValue = 1
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.widthAnchor.constraint(equalToConstant: 300).isActive = true
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        button.target = self
        button.action = #selector(pressed)

        let text = NSStackView(views: [titleLabel, detailLabel, progress, button])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 10
        let row = NSStackView(views: [icon, text])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 18
        row.edgeInsets = NSEdgeInsets(top: 22, left: 22, bottom: 22, right: 22)
        row.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            row.topAnchor.constraint(equalTo: content.topAnchor),
            row.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        window.contentView = content
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    func present() {
        guard let window else { return }
        if !window.isVisible { window.center() }
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func show(title: String, detail: String, progress value: Double?? = .none,
              button label: String? = nil, action: (() -> Void)? = nil) {
        titleLabel.stringValue = title
        detailLabel.stringValue = detail
        switch value {
        case .none:
            progress.isHidden = true
            progress.stopAnimation(nil)
        case .some(.none):
            progress.isHidden = false
            progress.isIndeterminate = true
            progress.startAnimation(nil)
        case .some(.some(let fraction)):
            progress.isHidden = false
            progress.isIndeterminate = false
            progress.doubleValue = fraction
        }
        button.isHidden = label == nil
        button.title = label ?? ""
        buttonAction = action
        if let window, let content = window.contentView {
            content.layoutSubtreeIfNeeded()
            window.setContentSize(content.fittingSize)
        }
    }

    @objc private func pressed() { buttonAction?() }
}
