import SwiftUI
import WidgetKit

// 小组件的界面。颜色取自 App 的 src/mobile/mobile.css（--c-focus、--bg、--surface、--label…），
// 浅色 / 深色各一套；着色、透明（iOS 26）和锁屏模式下系统会去掉底色并统一上色，
// 这时只保留层次（透明度），标题和圆圈归到强调色那一组。

// MARK: - 颜色

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }

    /// 随浅色 / 深色模式切换的颜色
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }

    init(light: UInt32, dark: UInt32) {
        self.init(light: Color(hex: light), dark: Color(hex: dark))
    }

    /// "#f2622e"
    init?(css: String) {
        let hex = css.hasPrefix("#") ? String(css.dropFirst()) : css
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        self.init(hex: value)
    }
}

enum Palette {
    static let accent = Color(light: 0xF2622E, dark: 0xFF7A4A)
    static let background = Color(light: 0xF4F3EF, dark: 0x141416)
    static let surface = Color(light: 0xFFFFFF, dark: 0x252528)
    static let label = Color(light: 0x1C1C1E, dark: 0xF2F2F7)
    static let label2 = Color(light: Color(hex: 0x3C3C43, alpha: 0.64), dark: Color(hex: 0xEBEBF5, alpha: 0.62))
    static let label3 = Color(light: Color(hex: 0x3C3C43, alpha: 0.4), dark: Color(hex: 0xEBEBF5, alpha: 0.36))
    static let check = Color(light: Color(hex: 0x3C3C43, alpha: 0.3), dark: Color(hex: 0xEBEBF5, alpha: 0.32))
    static let separator = Color(light: Color(hex: 0x3C3C43, alpha: 0.12), dark: Color(hex: 0xFFFFFF, alpha: 0.09))
    static let fill = Color(light: Color(hex: 0x787880, alpha: 0.12), dark: Color(hex: 0x787880, alpha: 0.26))
}

// MARK: - 入口：按尺寸分派

struct FocusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FocusEntry

    var body: some View {
        content
            .widgetURL(entry.content.url)
            .containerBackground(for: .widget) {
                switch family {
                case .systemSmall: Palette.surface
                case .systemMedium, .systemLarge, .systemExtraLarge: Palette.background
                default: Color.clear
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryInline: InlineView(content: entry.content)
        case .accessoryCircular: CircularView(content: entry.content)
        case .accessoryRectangular: RectangularView(content: entry.content)
        case .systemMedium: MediumView(content: entry.content)
        case .systemLarge, .systemExtraLarge: LargeView(content: entry.content)
        default: SmallView(content: entry.content)
        }
    }
}

// MARK: - 零件

/// 「FOCUS」字样，和 App 的大标题一样用粗体橙色
private struct FocusTitle: View {
    var size: CGFloat = 17

    var body: some View {
        Text("FOCUS")
            .font(.system(size: size, weight: .heavy))
            .tracking(-0.2)
            .foregroundStyle(Palette.accent)
            .widgetAccentable()
    }
}

/// 未完成的勾选圈，和 App 列表里的一样
private struct CheckCircle: View {
    var size: CGFloat = 15

    var body: some View {
        Circle()
            .strokeBorder(Palette.check, lineWidth: 1.5)
            .frame(width: size, height: size)
            .widgetAccentable()
    }
}

/// 空间头像：彩色圆底白字。非全彩模式下底色会被统一上色，改成描边
private struct ProfileAvatar: View {
    let content: FocusContent
    var size: CGFloat = 18

    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let initial = Text(String(content.profileName.prefix(1)))
            .font(.system(size: size * 0.52, weight: .bold))
            .frame(width: size, height: size)
        if mode == .fullColor {
            initial
                .foregroundStyle(.white)
                .background(content.profileColor, in: Circle())
        } else {
            initial
                .foregroundStyle(Palette.label)
                .overlay(Circle().strokeBorder(Palette.label2, lineWidth: 1))
        }
    }
}

private struct ItemRow: View {
    let item: FocusSnapshot.Item
    var fontSize: CGFloat = 13.5
    var showsProgress = true

    var body: some View {
        HStack(spacing: 9) {
            CheckCircle(size: fontSize + 1.5)
            Text(item.title)
                .font(.system(size: fontSize, weight: .medium))
                .foregroundStyle(Palette.label)
                .lineLimit(1)
            Spacer(minLength: 0)
            if showsProgress && item.subTotal > 0 {
                Text("\(item.subDone)/\(item.subTotal)")
                    .font(.system(size: fontSize - 2.5, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Palette.label2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Palette.fill, in: Capsule())
                    .fixedSize()
            }
        }
    }
}

/// 「今天完成 3」，前面一个实心勾
private struct DoneToday: View {
    let count: Int
    var fontSize: CGFloat = 11

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Palette.accent)
                .widgetAccentable()
            Text("今天完成 \(count)")
                .foregroundStyle(Palette.label2)
        }
        .font(.system(size: fontSize, weight: .semibold))
        .lineLimit(1)
    }
}

/// FOCUS 的图标 ◉，和 App 里 FOCUS 页签、空状态用的一样
private let focusSymbol = "smallcircle.filled.circle"

/// 列表为空、或 App 还没打开过。图标和文案都和 App 里 FOCUS 的空状态一致
private struct EmptyMessage: View {
    let content: FocusContent
    var alignment: HorizontalAlignment = .center

    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        VStack(alignment: alignment, spacing: 3) {
            Image(systemName: focusSymbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 30, height: 30)
                .background(Palette.accent.opacity(mode == .fullColor ? 0.14 : 0.2),
                            in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .widgetAccentable()
                .padding(.bottom, 5)
            Text(content.hasData ? "专注当下。" : "打开 FOCUS")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Palette.label)
            Text(content.hasData ? "从 INBOX 挑一件事放进来吧" : "这里会显示 FOCUS 列表")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(Palette.label2)
                .multilineTextAlignment(alignment == .center ? .center : .leading)
        }
    }
}

/// 中号、大号右侧 / 下方的白色列表卡片
private struct ListCard: View {
    let content: FocusContent
    let capacity: Int
    let rowHeight: CGFloat
    var fontSize: CGFloat = 13.5

    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let rows = content.rows(capacity: capacity)
        VStack(alignment: .leading, spacing: 0) {
            if content.roots == 0 {
                EmptyMessage(content: content)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ForEach(Array(rows.items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { separator }
                    ItemRow(item: item, fontSize: fontSize)
                        .frame(height: rowHeight)
                }
                if rows.more > 0 {
                    separator
                    Text("还有 \(rows.more) 条")
                        .font(.system(size: fontSize - 1.5, weight: .semibold))
                        .foregroundStyle(Palette.label2)
                        .padding(.leading, fontSize + 10.5)
                        .frame(height: rowHeight)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(mode == .fullColor ? Palette.surface : Palette.fill,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var separator: some View {
        Rectangle()
            .fill(Palette.separator)
            .frame(height: 0.5)
            .padding(.leading, fontSize + 10.5)
    }
}

// MARK: - 小号：前三条

private struct SmallView: View {
    let content: FocusContent

    var body: some View {
        let rows = content.rows(capacity: 4)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                FocusTitle(size: 17)
                Spacer(minLength: 4)
                if content.hasData { ProfileAvatar(content: content, size: 20) }
            }
            if content.roots == 0 {
                Spacer(minLength: 0)
                EmptyMessage(content: content, alignment: .leading)
                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows.items) { ItemRow(item: $0, fontSize: 13, showsProgress: false) }
                }
                .padding(.top, 11)
                Spacer(minLength: 0)
            }
            HStack(spacing: 4) {
                if rows.more > 0 {
                    Text("还有 \(rows.more) 条")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.label2)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if content.doneToday > 0 { DoneToday(count: content.doneToday) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - 中号：左边概要，右边列表

private struct MediumView: View {
    let content: FocusContent

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                FocusTitle(size: 17)
                if content.hasData {
                    Text("\(content.open)")
                        .font(.system(size: 40, weight: .heavy, design: .rounded))
                        .foregroundStyle(Palette.label)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .padding(.top, 2)
                    Text("项未完成")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.label2)
                    Spacer(minLength: 0)
                    HStack(spacing: 5) {
                        ProfileAvatar(content: content, size: 16)
                        Text(content.profileName)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Palette.label)
                            .lineLimit(1)
                    }
                    if content.doneToday > 0 {
                        DoneToday(count: content.doneToday, fontSize: 10.5)
                            .padding(.top, 4)
                    }
                } else {
                    Spacer(minLength: 0)
                }
            }
            .frame(width: 84, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            ListCard(content: content, capacity: 4, rowHeight: 32.5)
        }
    }
}

// MARK: - 大号：标题 + 列表

private struct LargeView: View {
    let content: FocusContent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 6) {
                VStack(alignment: .leading, spacing: 1) {
                    FocusTitle(size: 22)
                    if content.hasData {
                        HStack(spacing: 8) {
                            Text("\(content.open) 项未完成")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Palette.label2)
                            if content.doneToday > 0 { DoneToday(count: content.doneToday, fontSize: 12) }
                        }
                    }
                }
                Spacer(minLength: 4)
                if content.hasData {
                    ProfileAvatar(content: content, size: 18)
                    Text(content.profileName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.label)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 2)
            ListCard(content: content, capacity: 8, rowHeight: 34, fontSize: 14)
        }
    }
}

// MARK: - 锁屏

/// 锁屏矩形：标题行 + 前两条
private struct RectangularView: View {
    let content: FocusContent

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: focusSymbol)
                Text(content.hasData ? "FOCUS · \(content.open)" : "FOCUS")
            }
            .font(.system(size: 14, weight: .bold))
            .widgetAccentable()
            if content.roots == 0 {
                Text(content.hasData ? "专注当下。" : "打开 FOCUS 看看")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(content.items.prefix(2)) { item in
                    Text(item.title)
                        .font(.system(size: 14))
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 锁屏时间上方的一行
private struct InlineView: View {
    let content: FocusContent

    var body: some View {
        if let first = content.items.first {
            Label("\(content.open) · \(first.title)", systemImage: focusSymbol)
        } else {
            Label(content.hasData ? "FOCUS 已清空" : "FOCUS", systemImage: focusSymbol)
        }
    }
}

/// 锁屏圆形：还有几条
private struct CircularView: View {
    let content: FocusContent

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: -1) {
                Image(systemName: focusSymbol)
                    .font(.system(size: 12, weight: .semibold))
                Text(content.hasData ? "\(content.open)" : "–")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
            .padding(.horizontal, 6)
        }
        .widgetAccentable()
    }
}

// MARK: - 预览

#Preview("小号", as: .systemSmall) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
    FocusEntry(date: .now, content: FocusContent(profileName: "读书", doneToday: 2))
}

#Preview("中号", as: .systemMedium) {
    FocusListWidget()
} timeline: {
    FocusEntry(date: .now, content: .sample)
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
