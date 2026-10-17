import Foundation
import Security

/// App 写给小组件的数据，对应 src/mobile/widgetData.ts 的 WidgetSnapshot（version 2）。
///
/// 小组件不读同步文档：App 每次数据变化后把各空间的 NOW、NEXT、INBOX 前几件和今天 / 连续天数
/// 写成一份 JSON 放进两边共享的钥匙串组，小组件只读这一条（写入方是 ios/App/App/FocusWidgetPlugin.swift，
/// 那里写了为什么不用 App Group）。
/// 字段缺了就用默认值，两边版本对不上时也不至于整个读不出来。
struct FocusSnapshot: Decodable {
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

    struct Sub: Decodable, Hashable {
        var title: String
        var done: Bool

        init(title: String, done: Bool = false) {
            self.title = title
            self.done = done
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        }

        private enum CodingKeys: String, CodingKey { case title, done }
    }

    /// 现在这一件：FOCUS 里手动顺序排第一的未完成顶层项
    struct Now: Decodable, Hashable {
        var item: Item
        /// 前几条直接子任务，未完成的在前
        var subs: [Sub]

        init(item: Item, subs: [Sub] = []) {
            self.item = item
            self.subs = subs
        }

        init(from decoder: Decoder) throws {
            item = try Item(from: decoder)
            let c = try decoder.container(keyedBy: CodingKeys.self)
            subs = try c.decodeIfPresent([Sub].self, forKey: .subs) ?? []
        }

        private enum CodingKeys: String, CodingKey { case subs }
    }

    struct Profile: Decodable, Identifiable {
        var id: String
        var name: String
        /// 头像颜色的序号
        var tint: Int
        var now: Now?
        /// NOW 之后的前几件
        var next: [Item]
        /// FOCUS 里未完成的顶层项总数（含 NOW）
        var open: Int
        /// INBOX 最上面几件
        var inbox: [Item]
        var inboxOpen: Int
        var doneToday: Int
        var streak: Int

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            tint = try c.decodeIfPresent(Int.self, forKey: .tint) ?? 0
            now = try c.decodeIfPresent(Now.self, forKey: .now)
            next = try c.decodeIfPresent([Item].self, forKey: .next) ?? []
            open = try c.decodeIfPresent(Int.self, forKey: .open) ?? (next.count + (now == nil ? 0 : 1))
            inbox = try c.decodeIfPresent([Item].self, forKey: .inbox) ?? []
            inboxOpen = try c.decodeIfPresent(Int.self, forKey: .inboxOpen) ?? inbox.count
            doneToday = try c.decodeIfPresent(Int.self, forKey: .doneToday) ?? 0
            streak = try c.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case id, name, tint, now, next, open, inbox, inboxOpen, doneToday, streak
        }
    }

    var activeId: String
    /// 写入那天 0 点的毫秒时间戳（App 所在时区）
    var day: Double
    var profiles: [Profile]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activeId = try c.decodeIfPresent(String.self, forKey: .activeId) ?? ""
        day = try c.decodeIfPresent(Double.self, forKey: .day) ?? 0
        profiles = try c.decodeIfPresent([Profile].self, forKey: .profiles) ?? []
    }

    private enum CodingKeys: String, CodingKey { case activeId, day, profiles }

    // MARK: 读取

    /// 和 FocusWidgetPlugin.swift 里的 `WidgetSnapshotStore` 必须一致。
    /// 钥匙串组来自 Info.plist 的 FocusSharedKeychainGroup（= $(AppIdentifierPrefix)app.focus.todo.shared）
    static var keychainQuery: [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.focus.todo.widget",
            kSecAttrAccount as String: "snapshot",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = Bundle.main.object(forInfoDictionaryKey: "FocusSharedKeychainGroup") as? String {
            q[kSecAttrAccessGroup as String] = group
        }
        return q
    }

    /// App 还没写过（装好后没打开过），或设备重启后还没解锁过时为 nil
    static func load() -> FocusSnapshot? {
        var out: CFTypeRef?
        guard SecItemCopyMatching(keychainQuery as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(FocusSnapshot.self, from: data)
    }

    /// 选定的空间；没选、选了「跟随 App」或那个空间已经删了，都用 App 当前的空间
    func profile(id: String?) -> Profile? {
        if let id, let p = profiles.first(where: { $0.id == id }) { return p }
        return profiles.first(where: { $0.id == activeId }) ?? profiles.first
    }

    /// 写入之后过了几天（按日历）。时间线里明天、后天的条目用它推算今天完成数和连续天数
    func daysSinceWritten(_ date: Date) -> Int {
        let calendar = Calendar.current
        let written = calendar.startOfDay(for: Date(timeIntervalSince1970: day / 1000))
        return max(0, calendar.dateComponents([.day], from: written, to: calendar.startOfDay(for: date)).day ?? 0)
    }

    /// 写入的那天过去了还没有新数据：今天还没完成任何事
    func doneToday(of profile: Profile, on date: Date) -> Int {
        daysSinceWritten(date) == 0 ? profile.doneToday : 0
    }

    /// 连续天数和 src/history.ts 的 streak 一样「今天还没完成时从昨天往回数」：
    /// 第二天仍算上写入那天（那天完成过的话），再往后就断了
    func streak(of profile: Profile, on date: Date) -> Int {
        switch daysSinceWritten(date) {
        case 0: profile.streak
        case 1: profile.doneToday > 0 ? profile.streak : 0
        default: 0
        }
    }
}
