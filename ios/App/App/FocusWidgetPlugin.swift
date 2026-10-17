import Capacitor
import WidgetKit

/// 主屏小组件的数据出口：网页把精简快照（src/mobile/widgetData.ts）交过来，
/// 这里写进 App Group 容器，再让系统重新取小组件的时间线。
/// 小组件按同一个 App Group 和文件名去读（ios/App/FocusWidget/FocusSnapshot.swift）。
@objc(FocusWidgetPlugin)
public class FocusWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusWidgetPlugin"
    public let jsName = "FocusWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.com.nickxia.focus.todo"
    static let fileName = "widget-snapshot.json"
    static let widgetKind = "FocusList"

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { return call.reject("missing json") }
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else {
            return call.reject("App Group unavailable")
        }
        let url = dir.appendingPathComponent(Self.fileName)
        let data = Data(json.utf8)
        // 网页那边已经去重、节流过；这里再挡一次，内容没变就不惊动小组件
        if (try? Data(contentsOf: url)) == data { return call.resolve() }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return call.reject("write failed: \(error.localizedDescription)")
        }
        WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        call.resolve()
    }
}
