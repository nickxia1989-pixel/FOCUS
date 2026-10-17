import SwiftUI
import WidgetKit

/// 小组件某一时刻要显示的内容
struct FocusEntry: TimelineEntry {
    let date: Date
    let content: FocusContent
}

/// 从快照里挑出来、已经按日期算好的一个空间
struct FocusContent {
    /// App 还没写过数据（装好后还没打开过）
    var hasData = true
    var profileName = ""
    var tint = 0
    /// 现在这一件；FOCUS 空了为 nil
    var now: FocusSnapshot.Now?
    var next: [FocusSnapshot.Item] = []
    /// FOCUS 里未完成的顶层项总数（含 NOW）
    var open = 0
    var inbox: [FocusSnapshot.Item] = []
    var inboxOpen = 0
    var doneToday = 0
    var streak = 0
    /// 点小组件：打开 App 停在 FOCUS 页
    var focusURL = FocusContent.url("focus")
    /// FOCUS 空了时列的是 INBOX，点进落在 INBOX 页
    var inboxURL = FocusContent.url("inbox")

    static func url(_ section: String, profile: String? = nil) -> URL {
        var c = URLComponents()
        c.scheme = "focustodo"
        c.host = section
        if let profile { c.queryItems = [URLQueryItem(name: "profile", value: profile)] }
        return c.url ?? URL(string: "focustodo://\(section)")!
    }

    /// NOW 之后还有几件没列出来（列了 shown 件 NEXT 时）
    func more(shown: Int) -> Int {
        max(0, open - 1 - min(shown, next.count))
    }

    static let noData = FocusContent(hasData: false)

    /// 小组件库里的预览，和设计稿的演示数据一样
    static let sample = FocusContent(
        profileName: "工作",
        now: .init(
            item: .init(id: "now", title: "整理多端同步的冲突规则，写成可以直接实现的清单", subDone: 1, subTotal: 2),
            subs: [.init(title: "离线一周后的合并"), .init(title: "排序与父子移动", done: true)]),
        next: [
            .init(id: "2", title: "把 iOS 原型装到真机上，过一遍左滑和长按"),
            .init(id: "3", title: "给 HISTORY 加上「从哪个列表完成」"),
            .init(id: "4", title: "回复设计稿评论：侧栏宽度"),
            .init(id: "5", title: "周报：本周完成的事从 HISTORY 抄"),
        ],
        open: 5,
        inbox: [
            .init(id: "i1", title: "小组件加「今天完成」样式"),
            .init(id: "i2", title: "Windows 标题栏按钮间距"),
            .init(id: "i3", title: "拖拽排序在 iOS 上怎么做"),
        ],
        inboxOpen: 3,
        doneToday: 4,
        streak: 6)
}

extension FocusEntry {
    init(date: Date, snapshot: FocusSnapshot?, pinnedID: String?) {
        guard let snapshot, let profile = snapshot.profile(id: pinnedID) else {
            self.init(date: date, content: .noData)
            return
        }
        // 选了具体空间的小组件：打开时也切到那个空间
        let pin = pinnedID == profile.id ? profile.id : nil
        self.init(date: date, content: FocusContent(
            profileName: profile.name,
            tint: profile.tint,
            now: profile.now,
            next: profile.next,
            open: profile.open,
            inbox: profile.inbox,
            inboxOpen: profile.inboxOpen,
            doneToday: snapshot.doneToday(of: profile, on: date),
            streak: snapshot.streak(of: profile, on: date),
            focusURL: FocusContent.url("focus", profile: pin),
            inboxURL: FocusContent.url("inbox", profile: pin)))
    }
}

/// 时间线：App 每次数据变化都会让系统重新来取；另外在明天、后天 0 点各排一条，
/// 把「今天完成」清零、连续天数按天推算
struct FocusProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FocusEntry {
        FocusEntry(date: Date(), content: .sample)
    }

    func snapshot(for configuration: SelectProfileIntent, in context: Context) async -> FocusEntry {
        let entry = FocusEntry(date: Date(), snapshot: FocusSnapshot.load(), pinnedID: configuration.pinnedProfileID)
        // 小组件库里：还没有数据时用示例撑起样子
        return context.isPreview && !entry.content.hasData ? FocusEntry(date: entry.date, content: .sample) : entry
    }

    func timeline(for configuration: SelectProfileIntent, in context: Context) async -> Timeline<FocusEntry> {
        let snapshot = FocusSnapshot.load()
        let now = Date()
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let days = (1...2).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
        let entries = ([now] + days).map { FocusEntry(date: $0, snapshot: snapshot, pinnedID: configuration.pinnedProfileID) }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

struct FocusListWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: FocusSnapshot.widgetKind, intent: SelectProfileIntent.self, provider: FocusProvider()) { entry in
            FocusWidgetView(entry: entry)
        }
        .configurationDisplayName("FOCUS")
        .description("现在这一件，和接下来要做的事。")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryInline, .accessoryCircular,
        ])
        // 留白自己控制：中、大号里的 NOW 卡只内缩 8
        .contentMarginsDisabled()
    }
}

@main
struct FocusWidgetBundle: WidgetBundle {
    var body: some Widget {
        FocusListWidget()
    }
}
