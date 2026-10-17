import SwiftUI
import UIKit
import WidgetKit

// 小组件的界面，按定稿设计（design_handoff_focus：README「小组件（WidgetKit）」、screens/Widgets.jpg、
// design/FWidget.dc.html）。荧光绿只给「现在这一件」：小号浅色整块荧光绿，中、大号是白底 / 深底上一张荧光绿 NOW 卡；
// 下面是 NEXT 序号列表，没有勾选圈，免得看起来能点。着色、透明模式下整体单色，NOW 卡和数字跟随系统着色。

// MARK: - 颜色与字体

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }

    /// 荧光绿，只给 NOW
    static let lime = Color(hex: 0xD6FF3D)
    /// 荧光绿上的字
    static let ink = Color(hex: 0x0B0B0C)
}

/// 一个小组件在当前外观下的配色（tokens.json：浅色 / 深色；着色和透明模式下白色分层）
struct WidgetTheme {
    let dark: Bool
    /// 着色、透明（iOS 26）和锁屏：系统去掉底色、统一上色
    let accented: Bool

    init(_ scheme: ColorScheme, _ mode: WidgetRenderingMode) {
        dark = scheme == .dark
        accented = mode != .fullColor
    }

    var background: Color { dark ? Color(hex: 0x141416) : .white }
    var text: Color { accented ? .white.opacity(0.95) : dark ? Color(hex: 0xF4F4EF) : .ink }
    var muted: Color { accented ? .white.opacity(0.55) : dark ? Color(hex: 0x8E8E88) : Color(hex: 0x66665F) }
    var line: Color { accented ? .white.opacity(0.14) : dark ? .white.opacity(0.08) : Color(hex: 0x0B0B0C, alpha: 0.08) }
    /// 空状态卡片的底（大号）
    var surface: Color { accented ? .white.opacity(0.08) : dark ? Color(hex: 0x222225) : Color(hex: 0xEEEEE9) }
    /// NOW 卡的底；着色模式下是一层随系统着色的半透明
    var nowFill: Color { accented ? .white.opacity(0.18) : .lime }
    var nowText: Color { accented ? .white.opacity(0.95) : .ink }
}

/// Display 字：Bricolage Grotesque 700 / 800（OFL，随扩展打包，见 Info.plist 的 UIAppFonts），
/// 只用于英文标签和数字。字体没注册上时退回系统的圆体粗体。
enum Display {
    private static let names = (bold: "BricolageGrotesque96ptExtraBold-Bold", heavy: "BricolageGrotesque96ptExtraBold-ExtraBold")
    private static let available = UIFont(name: names.heavy, size: 12) != nil

    static func font(_ size: CGFloat, bold: Bool = false) -> Font {
        available
            ? .custom(bold ? names.bold : names.heavy, fixedSize: size)
            : .system(size: size, weight: bold ? .bold : .heavy, design: .rounded)
    }
}

/// 星芒：FOCUS 的图标（design 里 `w-i-spark` 那条路径，24 网格）
struct Spark: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let o = CGPoint(x: rect.midX - 12 * s, y: rect.midY - 11.2 * s)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * s, y: o.y + y * s) }
        var path = Path()
        path.move(to: p(12, 2.8))
        path.addCurve(to: p(20.4, 11.2), control1: p(12.8, 7.8), control2: p(15.4, 10.4))
        path.addCurve(to: p(12, 19.6), control1: p(15.4, 12), control2: p(12.8, 14.6))
        path.addCurve(to: p(3.6, 11.2), control1: p(11.2, 14.6), control2: p(8.6, 12))
        path.addCurve(to: p(12, 2.8), control1: p(8.6, 10.4), control2: p(11.2, 7.8))
        path.closeSubpath()
        return path
    }
}

// MARK: - 入口：按尺寸分派

struct FocusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: FocusEntry

    private var content: FocusContent { entry.content }

    /// FOCUS 空了时中、大号列的是 INBOX，点进落在 INBOX
    private var url: URL {
        let listsInbox = content.now == nil && content.hasData && content.inboxOpen > 0
        return listsInbox && (family == .systemMedium || family == .systemLarge) ? content.inboxURL : content.focusURL
    }

    var body: some View {
        view
            .widgetURL(url)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder
    private var view: some View {
        switch family {
        case .accessoryInline: InlineView(content: content)
        case .accessoryCircular: CircularView(content: content)
        case .accessoryRectangular: RectangularView(content: content)
        case .systemMedium: MediumView(content: content)
        case .systemLarge, .systemExtraLarge: LargeView(content: content)
        default: SmallView(content: content)
        }
    }

    @ViewBuilder
    private var background: some View {
        switch family {
        case .accessoryInline, .accessoryCircular, .accessoryRectangular: Color.clear
        // 小号浅色是整块荧光绿
        case .systemSmall where scheme == .light: Color.lime
        default: WidgetTheme(scheme, .fullColor).background
        }
    }
}

// MARK: - 零件

/// 读当前外观的配色
private struct Themed<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode
    @ViewBuilder let content: (WidgetTheme) -> Content

    var body: some View { content(WidgetTheme(scheme, mode)) }
}

/// 「✦ NOW ……… 1/5」
private struct NowHeader: View {
    let position: String
    var size: CGFloat = 12

    var body: some View {
        HStack(spacing: 4) {
            Spark().frame(width: size + 2, height: size + 2)
            Text("NOW")
            Spacer(minLength: 4)
            Text(position)
        }
        .font(Display.font(size))
        .tracking(size * 0.08)
        .lineLimit(1)
    }
}

/// NOW 标题：系统字 600，字距 -.01em
private struct NowTitle: View {
    let text: String
    let size: CGFloat
    var lines = 3

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .semibold))
            .tracking(-size * 0.01)
            .lineSpacing(size * 0.28 - 2)
            .lineLimit(lines)
            .minimumScaleFactor(0.85)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// 荧光绿 NOW 卡（中、大号）
private struct NowCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        Themed { theme in
            content()
                .foregroundStyle(theme.nowText)
                .padding(.horizontal, 15)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(theme.nowFill)
                        .widgetAccentable()
                }
        }
    }
}

/// 子任务进度条：每个子项一段，已完成的实心
private struct SubBar: View {
    let done: Int
    let total: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<min(total, 12), id: \.self) { i in
                Capsule()
                    .frame(height: 3)
                    .opacity(i < done ? 1 : 0.2)
            }
        }
    }
}

/// NOW 卡上的一条子任务（大号）
private struct SubRow: View {
    let sub: FocusSnapshot.Sub

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if sub.done {
                    Circle()
                } else {
                    Circle().strokeBorder(lineWidth: 1.5)
                }
            }
            .frame(width: 12, height: 12)
            .opacity(0.8)
            Text(sub.title)
                .font(.system(size: 12.5))
                .strikethrough(sub.done)
                .opacity(sub.done ? 0.5 : 1)
                .lineLimit(1)
        }
    }
}

/// 「NEXT」「从 INBOX 挑一件」这类小标题：Display 800 11，字距 .08em
private struct CapsLabel: View {
    let text: String

    var body: some View {
        Themed { theme in
            Text(text)
                .font(Display.font(11))
                .tracking(0.88)
                .foregroundStyle(theme.muted)
                .lineLimit(1)
        }
    }
}

/// NEXT 列表：序号 + 单行标题，行间细线
private struct ItemList: View {
    let items: [FocusSnapshot.Item]
    /// 第一行的序号；nil 时用「·」（INBOX 列表）
    var firstNumber: Int? = 2
    var fontSize: CGFloat = 13.5
    var showsProgress = false

    var body: some View {
        Themed { theme in
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(firstNumber.map { String(format: "%02d", $0 + index) } ?? "·")
                            .font(Display.font(11, bold: true))
                            .foregroundStyle(theme.muted)
                            .frame(width: 16, alignment: .leading)
                            .widgetAccentable()
                        Text(item.title)
                            .font(.system(size: fontSize, weight: .medium))
                            .foregroundStyle(theme.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if showsProgress && item.subTotal > 0 {
                            Text("\(item.subDone)/\(item.subTotal)")
                                .font(Display.font(10.5, bold: true))
                                .foregroundStyle(theme.muted)
                                .fixedSize()
                        }
                    }
                    .padding(.vertical, 6)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(theme.line).frame(height: 1) }
                    }
                }
            }
        }
    }
}

/// 一行灰色小字（Display 700 11，字距 .04em）
private struct Caption: View {
    let text: String

    var body: some View {
        Themed { theme in
            Text(text)
                .font(Display.font(11, bold: true))
                .tracking(0.44)
                .foregroundStyle(theme.muted)
                .lineLimit(1)
        }
    }
}

/// 空间头像：按定稿的空间头像配色顺序取色，首字作头像。着色模式下改成描边
private struct ProfileAvatar: View {
    let content: FocusContent
    var size: CGFloat = 16

    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode

    private static let palette: [(bg: UInt32, fg: UInt32)] = [
        (0x0B0B0C, 0xD6FF3D), (0xFF8A65, 0x0B0B0C), (0xB8A6FF, 0x0B0B0C), (0x8FD3FF, 0x0B0B0C), (0xF2E2B8, 0x0B0B0C),
    ]

    var body: some View {
        let index = ((content.tint % Self.palette.count) + Self.palette.count) % Self.palette.count
        // 第一种（近黑底荧光绿字）在深色里反过来
        let (bg, fg) = index == 0 && scheme == .dark ? (UInt32(0xF4F4EF), UInt32(0x0B0B0C)) : Self.palette[index]
        let initial = Text(String(content.profileName.prefix(1)))
            .font(.system(size: size * 0.56, weight: .bold))
            .frame(width: size, height: size)
        if mode == .fullColor {
            initial
                .foregroundStyle(Color(hex: fg))
                .background(Color(hex: bg), in: Circle())
        } else {
            initial
                .foregroundStyle(.white)
                .background(Color.white.opacity(0.3), in: Circle())
        }
    }
}

/// 空状态插画：一张描边斜线卡
private struct EmptyArt: View {
    var body: some View {
        Themed { theme in
            let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
            Hatch()
                .stroke(theme.line, lineWidth: 1)
                .clipShape(shape)
                .overlay(shape.strokeBorder(lineWidth: 2))
                .frame(width: 56, height: 34)
                .opacity(0.5)
        }
    }

    private struct Hatch: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            var x = -rect.height
            while x < rect.width {
                path.move(to: CGPoint(x: x, y: rect.height))
                path.addLine(to: CGPoint(x: x + rect.height, y: 0))
                x += 6
            }
            return path
        }
    }
}

/// 「Nothing now.」：Display 800，字距 -.03em
private struct NothingNow: View {
    var size: CGFloat = 24

    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        Text("Nothing now.")
            .font(Display.font(size))
            .tracking(-size * 0.03)
            .foregroundStyle(mode != .fullColor ? .white : scheme == .dark ? .lime : .ink)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
            .widgetAccentable()
    }
}

// MARK: - 文案

private extension FocusContent {
    /// 「1/5」
    var position: String { "1/\(max(open, 1))" }
    /// 「01 / 05」
    var paddedPosition: String { String(format: "01 / %02d", max(open, 1)) }

    /// 「今天 ✓4」；今天还没完成时不写
    var todayMark: String? { doneToday > 0 ? "今天 ✓\(doneToday)" : nil }

    /// 小号底部：「还有 4 件 · 今天 ✓4」
    var smallCaption: String {
        let rest = open - 1
        return ([rest > 0 ? "还有 \(rest) 件" : "就这一件"] + [todayMark].compactMap { $0 }).joined(separator: " · ")
    }

    /// FOCUS 空时的一句话
    var emptyHint: String {
        guard hasData else { return "打开 FOCUS 开始" }
        return inboxOpen > 0 ? "INBOX 里有 \(inboxOpen) 件可以挑" : "INBOX 也空了"
    }
}

// MARK: - 小号：NOW

private struct SmallView: View {
    let content: FocusContent

    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        Themed { theme in
            // 浅色是整块荧光绿，字一律近黑；深色底上 NOW 标签和进度用荧光绿
            let lightLime = scheme == .light && !theme.accented
            let accent: Color = theme.accented ? .white : lightLime ? .ink : .lime
            let title: Color = lightLime ? .ink : theme.text
            let muted: Color = lightLime ? Color.ink.opacity(0.55) : theme.muted

            Group {
                if let now = content.now {
                    VStack(alignment: .leading, spacing: 0) {
                        NowHeader(position: content.position)
                            .foregroundStyle(accent)
                            .widgetAccentable()
                        Spacer(minLength: 6)
                        NowTitle(text: now.item.title, size: 17)
                            .foregroundStyle(title)
                        if now.item.subTotal > 0 {
                            SubBar(done: now.item.subDone, total: now.item.subTotal)
                                .foregroundStyle(accent)
                                .widgetAccentable()
                                .padding(.top, 9)
                        }
                        Text(content.smallCaption)
                            .font(Display.font(11, bold: true))
                            .tracking(0.44)
                            .foregroundStyle(muted)
                            .lineLimit(1)
                            .padding(.top, 9)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        EmptyArt().foregroundStyle(lightLime ? Color.ink : theme.text)
                        Spacer(minLength: 6)
                        NothingNow()
                        Text(content.emptyHint)
                            .font(.system(size: 12))
                            .foregroundStyle(muted)
                            .lineLimit(2)
                            .padding(.top, 6)
                    }
                }
            }
            .padding(15)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - 中号：NOW 卡 + 接下来三件

private struct MediumView: View {
    let content: FocusContent

    var body: some View {
        Themed { theme in
            HStack(spacing: 10) {
                if let now = content.now {
                    NowCard {
                        VStack(alignment: .leading, spacing: 0) {
                            NowHeader(position: content.position).widgetAccentable()
                            Spacer(minLength: 6)
                            NowTitle(text: now.item.title, size: 17)
                        }
                    }
                    .frame(width: 164)
                    VStack(alignment: .leading, spacing: 0) {
                        CapsLabel(text: "NEXT").padding(.bottom, 6)
                        if content.next.isEmpty {
                            Text("没有了，专心这一件")
                                .font(.system(size: 13))
                                .foregroundStyle(theme.muted)
                        } else {
                            ItemList(items: Array(content.next.prefix(3)))
                        }
                        let more = content.more(shown: 3)
                        let foot = ([more > 0 ? "+\(more)" : nil, content.todayMark]).compactMap { $0 }
                        if !foot.isEmpty {
                            Caption(text: foot.joined(separator: " · ")).padding(.top, 6)
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.trailing, 6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                } else {
                    // FOCUS 空了：左边「Nothing now.」，右边列 INBOX 最上面三件
                    VStack(alignment: .leading, spacing: 0) {
                        EmptyArt().foregroundStyle(theme.text)
                        Spacer(minLength: 6)
                        NothingNow()
                        Text(content.hasData ? "FOCUS 空了" : "打开 FOCUS 开始")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.muted)
                            .padding(.top, 6)
                    }
                    .padding(7)
                    .frame(width: 164, alignment: .leading)
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                    VStack(alignment: .leading, spacing: 0) {
                        if content.inbox.isEmpty {
                            CapsLabel(text: "INBOX").padding(.bottom, 6)
                            Text(content.hasData ? "INBOX 也空了，想到什么随手记下来" : "")
                                .font(.system(size: 13))
                                .foregroundStyle(theme.muted)
                        } else {
                            CapsLabel(text: "从 INBOX 挑一件").padding(.bottom, 6)
                            ItemList(items: content.inbox, firstNumber: nil)
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.trailing, 6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                }
            }
            .padding(8)
        }
    }
}

// MARK: - 大号：NOW 卡带子任务 + 接下来四件 + 今天 / 连续 + 空间

private struct LargeView: View {
    let content: FocusContent

    var body: some View {
        Themed { theme in
            VStack(alignment: .leading, spacing: 6) {
                if let now = content.now {
                    NowCard {
                        VStack(alignment: .leading, spacing: 0) {
                            NowHeader(position: content.paddedPosition).widgetAccentable()
                            NowTitle(text: now.item.title, size: 20)
                                .padding(.top, 14)
                            Spacer(minLength: 8)
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(now.subs.prefix(2).enumerated()), id: \.offset) { _, sub in
                                    SubRow(sub: sub)
                                }
                            }
                        }
                    }
                    .frame(height: 184)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            CapsLabel(text: "NEXT")
                            Spacer()
                            let more = content.more(shown: 4)
                            if more > 0 { Caption(text: "+\(more)") }
                        }
                        .padding(.bottom, 4)
                        if content.next.isEmpty {
                            Text("没有了，专心这一件")
                                .font(.system(size: 13.5))
                                .foregroundStyle(theme.muted)
                                .padding(.vertical, 6)
                        } else {
                            ItemList(items: Array(content.next.prefix(4)), showsProgress: true)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.top, 4)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        EmptyArt().foregroundStyle(theme.text)
                        Spacer(minLength: 8)
                        NothingNow(size: 32)
                        Text(content.hasData ? "FOCUS 空了。从 INBOX 挑一件当「现在」" : "打开 FOCUS 开始")
                            .font(.system(size: 13))
                            .foregroundStyle(theme.muted)
                            .padding(.top, 6)
                    }
                    .padding(15)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .frame(height: 184)
                    if !content.inbox.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack {
                                CapsLabel(text: "从 INBOX 挑一件")
                                Spacer()
                                let more = content.inboxOpen - content.inbox.count
                                if more > 0 { Caption(text: "+\(more)") }
                            }
                            .padding(.bottom, 4)
                            ItemList(items: content.inbox, firstNumber: nil)
                        }
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                    }
                }
                Spacer(minLength: 0)
                if content.hasData { footer(theme) }
            }
            .padding(8)
        }
    }

    /// 「今天 4 件 · 连续 6 天」+ 空间头像和名字
    private func footer(_ theme: WidgetTheme) -> some View {
        let number = { (n: Int) in Text("\(n)").font(Display.font(12)).foregroundStyle(theme.text) }
        let line = Text("今天 ") + number(content.doneToday) + Text(" 件 · 连续 ") + number(content.streak) + Text(" 天")
        return HStack(spacing: 8) {
            line
                .font(.system(size: 11.5))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                ProfileAvatar(content: content)
                Text(content.profileName)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }
}

// MARK: - 锁屏（永远单色）

/// 圆形：✦ + FOCUS 剩余件数，外圈 = 今天完成占比
private struct CircularView: View {
    let content: FocusContent

    private var ratio: Double {
        let total = content.doneToday + content.open
        return total > 0 ? Double(content.doneToday) / Double(total) : 0
    }

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Circle()
                .stroke(lineWidth: 4.5)
                .opacity(0.28)
                .padding(4)
            Circle()
                .trim(from: 0, to: ratio)
                .stroke(style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(4)
            VStack(spacing: 1) {
                Spark().frame(width: 11, height: 11)
                Text(content.hasData ? "\(content.open)" : "–")
                    .font(Display.font(20))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
        }
        .widgetAccentable()
    }
}

/// 矩形：NOW 这一件（两行截断）
private struct RectangularView: View {
    let content: FocusContent

    var body: some View {
        // 锁屏矩形只有约 57pt 高：标签行收小，留出两行标题
        VStack(alignment: .leading, spacing: 2) {
            NowHeader(position: content.now == nil ? "" : content.position, size: 10)
                .opacity(0.85)
                .widgetAccentable()
            if let now = content.now {
                Text(now.item.title)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            } else {
                Text("Nothing now.")
                    .font(Display.font(15))
                    .lineLimit(1)
                Text(content.emptyHint)
                    .font(.system(size: 12))
                    .opacity(0.7)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(AccessoryWidgetBackground().clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous)))
    }
}

/// 时间上方的一行：✦ + NOW 标题
private struct InlineView: View {
    let content: FocusContent

    var body: some View {
        Label {
            Text(content.now?.item.title ?? (content.hasData ? "Nothing now." : "FOCUS"))
        } icon: {
            Image(systemName: "sparkle")
        }
    }
}

// MARK: - 预览

#Preview("小号", as: .systemSmall) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
    FocusEntry(date: .now, content: FocusContent(profileName: "读书", inboxOpen: 3, doneToday: 2))
}

#Preview("中号", as: .systemMedium) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
    FocusEntry(date: .now, content: FocusContent(profileName: "读书", inbox: FocusContent.sample.inbox, inboxOpen: 3))
}

#Preview("大号", as: .systemLarge) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
}

#Preview("锁屏", as: .accessoryRectangular) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
}
