import Foundation

/// App 写给小组件的数据，对应 src/mobile/widgetData.ts 的 WidgetSnapshot。
///
/// 小组件不读同步文档：App 每次数据变化后把各空间 FOCUS 列表的前几条写成一份 JSON 放进 App Group，
/// 小组件只读这份文件（写入方是 ios/App/App/FocusWidgetPlugin.swift）。字段缺了就用默认值，
/// 两边版本对不上时也不至于整个读不出来。
struct FocusSnapshot: Decodable {
    static let appGroup = "group.app.focus.todo"
    static let fileName = "widget-snapshot.json"
    static let widgetKind = "FocusList"

    struct Item: Decodable, Hashable, Identifiable {
        var id: String
        var title: String
        /// 直接子任务的完成数 / 总数，没有子任务时都是 0
        var subDone: Int
        var subTotal: Int

        init(id: String, title: String, subDone: Int = 0, subTotal: Int = 0) {
            self.id = id
            self.title = title
            self.subDone = subDone
            self.subTotal = subTotal
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            subDone = try c.decodeIfPresent(Int.self, forKey: .subDone) ?? 0
            subTotal = try c.decodeIfPresent(Int.self, forKey: .subTotal) ?? 0
        }

        private enum CodingKeys: String, CodingKey { case id, title, subDone, subTotal }
    }

    struct Profile: Decodable, Identifiable {
        var id: String
        var name: String
        /// 头像颜色，"#f2622e"
        var color: String
        /// FOCUS 里未完成的条数（含子任务），和 App 里 FOCUS 的页头、页签角标一致
        var open: Int
        /// 未完成的顶层项总数（items 只带前几个）
        var roots: Int
        var items: [Item]
        var doneToday: Int

        init(id: String, name: String, color: String, open: Int, roots: Int, items: [Item], doneToday: Int) {
            self.id = id
            self.name = name
            self.color = color
            self.open = open
            self.roots = roots
            self.items = items
            self.doneToday = doneToday
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#f2622e"
            items = try c.decodeIfPresent([Item].self, forKey: .items) ?? []
            roots = try c.decodeIfPresent(Int.self, forKey: .roots) ?? items.count
            open = try c.decodeIfPresent(Int.self, forKey: .open) ?? roots
            doneToday = try c.decodeIfPresent(Int.self, forKey: .doneToday) ?? 0
        }

        private enum CodingKeys: String, CodingKey { case id, name, color, open, roots, items, doneToday }
    }

    var activeId: String
    /// 写入那天 0 点的毫秒时间戳（App 所在时区）
    var day: Double
    var profiles: [Profile]

    init(activeId: String, day: Double, profiles: [Profile]) {
        self.activeId = activeId
        self.day = day
        self.profiles = profiles
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activeId = try c.decodeIfPresent(String.self, forKey: .activeId) ?? ""
        day = try c.decodeIfPresent(Double.self, forKey: .day) ?? 0
        profiles = try c.decodeIfPresent([Profile].self, forKey: .profiles) ?? []
    }

    private enum CodingKeys: String, CodingKey { case activeId, day, profiles }

    // MARK: 读取

    static var sharedURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    /// App 还没写过（装好后没打开过）时为 nil
    static func load() -> FocusSnapshot? {
        guard let url = sharedURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(FocusSnapshot.self, from: data)
    }

    /// 选定的空间；没选、选了「跟随 App」或那个空间已经删了，都用 App 当前的空间
    func profile(id: String?) -> Profile? {
        if let id, let p = profiles.first(where: { $0.id == id }) { return p }
        return profiles.first(where: { $0.id == activeId }) ?? profiles.first
    }

    /// 写入的那天过去了还没有新数据：今天还没完成任何事
    func doneToday(of profile: Profile, on date: Date) -> Int {
        let written = Date(timeIntervalSince1970: day / 1000)
        return Calendar.current.isDate(written, inSameDayAs: date) ? profile.doneToday : 0
    }
}
