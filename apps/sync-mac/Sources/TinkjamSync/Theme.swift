import AppKit
import CoreText

/// Tinkjam's colours, each with its light and dark value. They resolve when drawn, so windows
/// follow the system appearance as it changes.
enum Palette {
    static func rgb(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    private static func pair(_ name: String, light: UInt32, dark: UInt32) -> NSColor {
        let lightColor = rgb(light)
        let darkColor = rgb(dark)
        return NSColor(name: NSColor.Name(name)) { (appearance: NSAppearance) -> NSColor in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? darkColor : lightColor
        }
    }

    static let surface = pair("tinkjam.surface", light: 0xFFFFFF, dark: 0x1B1820)
    static let text = pair("tinkjam.text", light: 0x17141C, dark: 0xF6F3EE)
    static let body = pair("tinkjam.body", light: 0x4A4652, dark: 0xC9C4D1)
    /// A shade darker than the brand's #7C7785 in light mode, which is under 4.5:1 on white.
    static let quiet = pair("tinkjam.quiet", light: 0x6F6A78, dark: 0x928C9C)
    static let rule = pair("tinkjam.rule", light: 0xE7E4DE, dark: 0x34303C)
    static let tint = pair("tinkjam.tint", light: 0xE9EEFE, dark: 0x1C2550)
    static let accentText = pair("tinkjam.accentText", light: 0x2F5BEA, dark: 0x5B7DFF)
    static let success = pair("tinkjam.success", light: 0x14634A, dark: 0x3FBF8F)
    static let error = NSColor.systemRed
    /// Buttons keep white on cobalt in both modes.
    static let accent = rgb(0x2F5BEA)
    static let accentDeep = rgb(0x1C3FBF)
    static let white = rgb(0xFFFFFF)
}

/// Outfit SemiBold (OFL, `Resources/Fonts`) for headings; everything else keeps the system font.
enum Fonts {
    static let headingName = "Outfit-SemiBold"

    /// Registers the bundled font for this process. Without it, headings use the system font.
    static func register() {
        guard let url = Bundle.main.url(forResource: headingName, withExtension: "ttf", subdirectory: "Fonts") else { return }
        var error: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
            error?.release()
        }
    }

    static func heading(_ size: CGFloat) -> NSFont {
        NSFont(name: headingName, size: size) ?? NSFont.systemFont(ofSize: size, weight: .semibold)
    }

    /// A heading with Outfit's tight tracking (`tracking` is in ems, negative to tighten).
    static func headingString(_ text: String, size: CGFloat, tracking: CGFloat, color: NSColor,
                              lineHeight: CGFloat? = nil) -> NSAttributedString {
        var attributes: [NSAttributedString.Key: Any] = [
            .font: heading(size),
            .kern: size * tracking,
            .foregroundColor: color,
        ]
        if let lineHeight {
            let style = NSMutableParagraphStyle()
            style.minimumLineHeight = lineHeight
            style.maximumLineHeight = lineHeight
            attributes[.paragraphStyle] = style
        }
        return NSAttributedString(string: text, attributes: attributes)
    }
}

/// Pictures shipped in the bundle's Resources (with their @2x files).
enum Art {
    static func image(_ name: String) -> NSImage? {
        Bundle.main.image(forResource: NSImage.Name(name))
    }
}

/// The agents Sync starts on this Mac, found the way Sync finds them: by name on the login PATH.
/// Claude and Codex are the agents Tinkjam turns on by default.
struct AgentKind: Equatable {
    let name: String
    let command: String
    /// Resource name of its icon; `template` icons are tinted to the text colour.
    let icon: String
    let template: Bool

    static let all: [AgentKind] = [
        AgentKind(name: "Claude", command: "claude", icon: "agent-claude", template: false),
        AgentKind(name: "Codex", command: "codex", icon: "agent-codex", template: true),
    ]

    static func installed(path: String) -> [AgentKind] {
        let folders = path.split(separator: ":").map(String.init).filter { !$0.isEmpty }
        return all.filter { kind in
            folders.contains { FileManager.default.isExecutableFile(atPath: $0 + "/" + kind.command) }
        }
    }

    /// Whether one of the programs running under Sync is this agent. A native `claude` lives in
    /// `…/claude/versions/<n>` and `codex` is its own binary; one run by Node shows only as `node`.
    func matches(executable: String) -> Bool {
        executable.lowercased().split(separator: "/").contains { part in
            part == Substring(command) || part.hasPrefix(command + "-")
        }
    }

    func iconImage() -> NSImage? {
        guard let image = Art.image(icon) else { return nil }
        image.isTemplate = template
        return image
    }
}

/// A button drawn in Tinkjam's style that is always reachable with Tab, shows the focus ring and
/// presses with Space or Return, whatever the system's keyboard navigation setting.
final class TinkjamButton: NSButton {
    enum Style { case primary, pill, secondary, link }

    private let style: Style

    init(_ title: String, style: Style, alignment: NSTextAlignment = .center) {
        self.style = style
        super.init(frame: .zero)
        isBordered = false
        setButtonType(.momentaryPushIn)
        focusRingType = .exterior
        translatesAutoresizingMaskIntoConstraints = false
        setTitle(title, alignment: alignment)
        switch style {
        case .primary: heightAnchor.constraint(equalToConstant: 36).isActive = true
        case .pill: heightAnchor.constraint(equalToConstant: 36).isActive = true
        case .secondary: heightAnchor.constraint(equalToConstant: 32).isActive = true
        case .link: break
        }
        setAccessibilityLabel(title)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    func setTitle(_ text: String, alignment: NSTextAlignment = .center) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        let color: NSColor
        let font: NSFont
        switch style {
        case .primary, .pill:
            color = Palette.white
            font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        case .secondary:
            color = Palette.accentText
            font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        case .link:
            color = Palette.body
            font = NSFont.systemFont(ofSize: 13, weight: .medium)
        }
        title = text
        attributedTitle = NSAttributedString(string: text, attributes: [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
        ])
        setAccessibilityLabel(text)
        invalidateIntrinsicContentSize()
    }

    private var radius: CGFloat {
        switch style {
        case .pill: return bounds.height / 2
        case .link: return 4
        default: return 8
        }
    }

    override var intrinsicContentSize: NSSize {
        let size = super.intrinsicContentSize
        switch style {
        case .pill: return NSSize(width: size.width + 44, height: 36)
        case .link: return NSSize(width: size.width + 4, height: max(size.height, 20))
        default: return size
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
        switch style {
        case .primary, .pill:
            (isHighlighted ? Palette.accentDeep : Palette.accent).setFill()
            shape.fill()
        case .secondary:
            Palette.tint.setFill()
            shape.fill()
            if isHighlighted {
                Palette.accent.withAlphaComponent(0.12).setFill()
                shape.fill()
            }
        case .link:
            if isHighlighted {
                Palette.rule.setFill()
                shape.fill()
            }
        }
        super.draw(dirtyRect)
    }

    override var acceptsFirstResponder: Bool { true }
    override var canBecomeKeyView: Bool { true }

    override func drawFocusRingMask() {
        NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }

    override var focusRingMaskBounds: NSRect { bounds }

    override func keyDown(with event: NSEvent) {
        // Space, Return and keypad Enter.
        if event.keyCode == 49 || event.keyCode == 36 || event.keyCode == 76 {
            performClick(nil)
        } else {
            super.keyDown(with: event)
        }
    }
}

/// A filled circle in a colour that follows the appearance.
final class DotView: NSView {
    var color: NSColor { didSet { needsDisplay = true } }

    init(color: NSColor, size: CGFloat = 8) {
        self.color = color
        super.init(frame: NSRect(x: 0, y: 0, width: size, height: size))
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: size).isActive = true
        heightAnchor.constraint(equalToConstant: size).isActive = true
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(ovalIn: bounds).fill()
    }
}

/// A one-point line in the rule colour.
final class RuleView: NSView {
    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 1).isActive = true
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    override func draw(_ dirtyRect: NSRect) {
        Palette.rule.setFill()
        NSBezierPath(rect: bounds).fill()
    }
}

func plainLabel(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular,
                color: NSColor = Palette.text, wraps: Bool = false, width: CGFloat? = nil) -> NSTextField {
    let label = wraps ? NSTextField(wrappingLabelWithString: text) : NSTextField(labelWithString: text)
    label.font = NSFont.systemFont(ofSize: size, weight: weight)
    label.textColor = color
    label.translatesAutoresizingMaskIntoConstraints = false
    if let width {
        label.preferredMaxLayoutWidth = width
        label.widthAnchor.constraint(equalToConstant: width).isActive = true
    }
    return label
}

func fixedImageView(_ image: NSImage?, size: CGFloat) -> NSImageView {
    let view = NSImageView()
    view.image = image
    view.imageScaling = .scaleProportionallyUpOrDown
    view.translatesAutoresizingMaskIntoConstraints = false
    view.widthAnchor.constraint(equalToConstant: size).isActive = true
    view.heightAnchor.constraint(equalToConstant: size).isActive = true
    view.setAccessibilityElement(false)
    return view
}
