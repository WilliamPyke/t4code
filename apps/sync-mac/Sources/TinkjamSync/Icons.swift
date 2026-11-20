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

    /// The menu bar icon: the single-colour glyph (the stroke and a crossbar line, no tile) as a
    /// template image, so macOS tints it for light and dark menu bars and dims it when disabled.
    static func menuBarImage() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            // With round caps the glyph spans x 17.5…56.5 and y 7.5…53.5 of the 64-unit box.
            let scale: CGFloat = 16 / 46
            context.translateBy(x: (18 - 39 * scale) / 2 - 17.5 * scale, y: (18 - 46 * scale) / 2 - 7.5 * scale)
            context.scaleBy(x: scale, y: scale)
            NSColor.black.setStroke()
            hook().stroke()
            let crossbar = NSBezierPath()
            crossbar.move(to: NSPoint(x: 22, y: 24))
            crossbar.line(to: NSPoint(x: 52, y: 24))
            crossbar.lineWidth = 9
            crossbar.lineCapStyle = .round
            crossbar.stroke()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Tinkjam Sync"
        return image
    }

    /// The full-colour mark on its cobalt rounded square, for windows.
    static func colourImage(size: CGFloat, inset: CGFloat = 0) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let body = size - inset * 2
            context.translateBy(x: inset, y: inset)
            context.scaleBy(x: body / 64, y: body / 64)
            Palette.accent.setFill()
            NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 64, height: 64), xRadius: 15, yRadius: 15).fill()
            Palette.rgb(0xFFF7EC).setStroke()
            hook().stroke()
            Palette.rgb(0xFFC83D).setFill()
            bar().fill()
            dot().fill()
            return true
        }
    }
}
