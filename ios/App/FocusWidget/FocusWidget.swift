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
    var profileColor = Palette.accent
    /// 未完成的条数（含子任务），和 App 里 FOCUS 的页头一致
    var open = 0
    /// 未完成的顶层项总数，列表按行列的是它们
    var roots = 0
    var items: [FocusSnapshot.Item] = []
    var doneToday = 0
    var url = FocusContent.focusURL

    /// 点小组件：打开 App 停在 FOCUS 页
    static let focusURL = URL(string: "focustodo://focus")!

    /// 能放 capacity 行时显示哪几条、「还有 N 条」是多少。放不下时最后一行让给「还有 N 条」
    func rows(capacity: Int) -> (items: ArraySlice<FocusSnapshot.Item>, more: Int) {
        if roots <= capacity { return (items.prefix(capacity), 0) }
        let shown = items.prefix(max(capacity - 1, 0))
        return (shown, roots - shown.count)
    }

    static let noData = FocusContent(hasData: false)

    /// 小组件库里的预览，和 App 第一次打开时的示例数据无关
    static let sample = FocusContent(
        profileName: "工作",
        open: 8,
        roots: 6,
        items: [
            .init(id: "1", title: "整理本周的周报"),
            .init(id: "2", title: "回复设计稿评论", subDone: 1, subTotal: 3),
            .init(id: "3", title: "修复同步冲突的提示文案"),
            .init(id: "4", title: "给 HISTORY 加上按列表筛选"),
            .init(id: "5", title: "预约下周的体检"),
            .init(id: "6", title: "读完《设计心理学》第三章"),
        ],
        doneToday: 3)
}

extension FocusEntry {
    init(date: Date, snapshot: FocusSnapshot?, pinnedID: String?) {
        guard let snapshot, let profile = snapshot.profile(id: pinnedID) else {
            self.init(date: date, content: .noData)
            return
        }
        var url = FocusContent.focusURL
        // 选了具体空间的小组件：打开时也切到那个空间
        if pinnedID == profile.id, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            c.queryItems = [URLQueryItem(name: "profile", value: profile.id)]
            url = c.url ?? url
        }
        self.init(date: date, content: FocusContent(
            profileName: profile.name,
            profileColor: Color(css: profile.color) ?? Palette.accent,
            open: profile.open,
            roots: profile.roots,
            items: profile.items,
            doneToday: snapshot.doneToday(of: profile, on: date),
            url: url))
    }
}

/// 时间线：App 每次数据变化都会让系统重新来取；另外在明天 0 点排一条，把「今天完成」清零
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
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now.addingTimeInterval(86_400)
        let entries = [now, tomorrow].map { FocusEntry(date: $0, snapshot: snapshot, pinnedID: configuration.pinnedProfileID) }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

struct FocusListWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: FocusSnapshot.widgetKind, intent: SelectProfileIntent.self, provider: FocusProvider()) { entry in
            FocusWidgetView(entry: entry)
        }
        .configurationDisplayName("FOCUS")
        .description("FOCUS 列表里接下来要做的事。")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryInline, .accessoryCircular,
        ])
    }
}

@main
struct FocusWidgetBundle: WidgetBundle {
    var body: some Widget {
        FocusListWidget()
    }
}
