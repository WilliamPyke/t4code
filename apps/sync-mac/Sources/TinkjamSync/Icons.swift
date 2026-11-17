import AppKit

/// The Tinkjam mark (apps/web/public/tinkjam-mark.svg) drawn in code: the hooked t/j stroke, the
/// note bar across it and the dot, in the SVG's 64-unit space with y pointing down.
enum Mark {
    /// The stroke `M37 12 v27 a10 10 0 0 1 -10 10 h-5`.
    static func hook() -> NSBezierPath {
        let path = NSBezierPath()
        path.move(to: NSPoint(x: 37, y: 12))
        path.line(to: NSPoint(x: 37, y: 39))
        // In y-down space the arc from (37,39) round (27,39) to (27,49) turns clockwise on screen.
        path.appendArc(withCenter: NSPoint(x: 27, y: 39), radius: 10, startAngle: 0, endAngle: 90, clockwise: false)
        path.line(to: NSPoint(x: 22, y: 49))
        path.lineWidth = 9
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        return path
    }

    static func bar() -> NSBezierPath {
        NSBezierPath(roundedRect: NSRect(x: 20, y: 20, width: 32, height: 10), xRadius: 5, yRadius: 5)
    }

    static func dot() -> NSBezierPath {
        NSBezierPath(ovalIn: NSRect(x: 16 - 5.2, y: 49 - 5.2, width: 10.4, height: 10.4))
    }

    /// The menu bar icon: a template image, so macOS tints it for light and dark menu bars. The
    /// bar and the dot are cut out of the stroke with a thin gap, so they read as separate shapes.
    static func menuBarImage() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            // The marks span x 10.8…52 and y 7.5…54.5 of the 64-unit box.
            let scale: CGFloat = 17 / 47
            context.translateBy(x: (18 - 41.2 * scale) / 2 - 10.8 * scale, y: (18 - 47 * scale) / 2 - 7.5 * scale)
            context.scaleBy(x: scale, y: scale)
            NSColor.black.set()
            hook().stroke()
            context.setBlendMode(.clear)
            NSBezierPath(roundedRect: NSRect(x: 17.5, y: 17.5, width: 37, height: 15), xRadius: 7.5, yRadius: 7.5).fill()
            NSBezierPath(ovalIn: NSRect(x: 16 - 7.7, y: 49 - 7.7, width: 15.4, height: 15.4)).fill()
            context.setBlendMode(.normal)
            NSColor.black.set()
            bar().fill()
            dot().fill()
            return true
        }
        image.isTemplate = true
        return image
    }

    /// The full-colour mark on its jam-red rounded square, for windows and the app icon.
    static func colourImage(size: CGFloat, inset: CGFloat = 0) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let body = size - inset * 2
            context.translateBy(x: inset, y: inset)
            context.scaleBy(x: body / 64, y: body / 64)
            NSColor(srgbRed: 0xDB / 255, green: 0x2D / 255, blue: 0x55 / 255, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 64, height: 64), xRadius: 15, yRadius: 15).fill()
            NSColor(srgbRed: 0xFF / 255, green: 0xF7 / 255, blue: 0xEC / 255, alpha: 1).setStroke()
            hook().stroke()
            NSColor(srgbRed: 0xFF / 255, green: 0xC8 / 255, blue: 0x3D / 255, alpha: 1).setFill()
            bar().fill()
            dot().fill()
            return true
        }
    }

    /// A coloured status dot for the menu.
    static func statusDot(_ color: NSColor) -> NSImage {
        let image = NSImage(size: NSSize(width: 10, height: 10), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
            return true
        }
        return image
    }
}
