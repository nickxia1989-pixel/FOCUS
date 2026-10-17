import Capacitor
import Security
import WidgetKit

/// 主屏小组件的数据出口：网页把精简快照（src/mobile/widgetData.ts）交过来，
/// 这里写进 App 和小组件共享的钥匙串组，再让系统重新取小组件的时间线。
/// 小组件按同一个钥匙串组和条目去读（ios/App/FocusWidget/FocusSnapshot.swift）。
///
/// 为什么不用 App Group：命令行的自动签名不会把新的 App Group 分配给 App ID，描述文件里的
/// App Group 列表是空的，真机构建签不上名；而团队的描述文件本来就允许 `<团队前缀>.*` 的钥匙串组，
/// 不用去开发者网站或 Xcode 里另外登记。
@objc(FocusWidgetPlugin)
public class FocusWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusWidgetPlugin"
    public let jsName = "FocusWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
    ]

    static let widgetKind = "FocusList"

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { return call.reject("missing json") }
        let data = Data(json.utf8)
        // 网页那边已经去重、节流过；这里再挡一次，内容没变就不惊动小组件
        if WidgetSnapshotStore.read() == data { return call.resolve() }
        let status = WidgetSnapshotStore.write(data)
        guard status == errSecSuccess else { return call.reject("keychain write failed: \(status)") }
        WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        call.resolve()
    }
}

/// 快照在钥匙串里的位置。和 FocusSnapshot.swift 里的 `FocusSnapshot.keychainQuery` 必须一致。
enum WidgetSnapshotStore {
    /// Info.plist 的 FocusSharedKeychainGroup = $(AppIdentifierPrefix)app.focus.todo.shared，
    /// 和 App.entitlements / FocusWidget.entitlements 里的钥匙串组是同一个
    static var group: String? { Bundle.main.object(forInfoDictionaryKey: "FocusSharedKeychainGroup") as? String }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.focus.todo.widget",
            kSecAttrAccount as String: "snapshot",
        ]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    static func read() -> Data? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func write(_ data: Data) -> OSStatus {
        // 小组件可能在锁屏时刷新：首次解锁之后就能读
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query() as CFDictionary, attrs as CFDictionary)
        if status != errSecItemNotFound { return status }
        return SecItemAdd(query().merging(attrs) { $1 } as CFDictionary, nil)
    }
}
