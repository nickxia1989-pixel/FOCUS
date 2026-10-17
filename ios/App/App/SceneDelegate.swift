import UIKit
import Capacitor
import Security

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = FocusRoot.make()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// 注册 App 自带的原生插件
class MainViewController: CAPBridgeViewController {
    /// 外面套着原生外壳（FocusChrome.swift）：页签栏和导航栏按钮由原生画
    var usesNativeChrome = false
    let chrome = FocusChromePlugin()

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FocusNativePlugin())
        bridge?.registerPluginInstance(chrome)
        if usesNativeChrome { FocusChromePlugin.markNative(webView) }
    }
}

private final class TaskBox: @unchecked Sendable {
    var id: UIBackgroundTaskIdentifier = .invalid
}

/// 同步用的原生能力：
/// - 钥匙串：坚果云应用密码、设备身份。只存在本机（ThisDeviceOnly），不随备份迁移到别的手机，
///   这样从备份恢复到新手机时会生成新的设备 id，不会和旧手机共用。
/// - 后台时间：切到后台时申请一小段时间，把还没上传的改动传完。
@objc(FocusNativePlugin)
public class FocusNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusNativePlugin"
    public let jsName = "FocusNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "keychainGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainDelete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginBackgroundTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endBackgroundTask", returnType: CAPPluginReturnPromise),
    ]

    private let service = "app.focus.todo.sync"
    private var tasks: [Int: UIBackgroundTaskIdentifier] = [:]

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    @objc func keychainGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("missing key") }
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let data = out as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func keychainSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else { return call.reject("missing key/value") }
        SecItemDelete(query(key) as CFDictionary)
        var q = query(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        status == errSecSuccess ? call.resolve() : call.reject("keychain error \(status)")
    }

    @objc func keychainDelete(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("missing key") }
        SecItemDelete(query(key) as CFDictionary)
        call.resolve()
    }

    @objc func beginBackgroundTask(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let box = TaskBox()
            box.id = UIApplication.shared.beginBackgroundTask(withName: "focus-sync") {
                // 系统收回时间时必须结束
                UIApplication.shared.endBackgroundTask(box.id)
                self.tasks.removeValue(forKey: box.id.rawValue)
            }
            self.tasks[box.id.rawValue] = box.id
            call.resolve(["id": box.id.rawValue])
        }
    }

    @objc func endBackgroundTask(_ call: CAPPluginCall) {
        let key = call.getInt("id") ?? -1
        DispatchQueue.main.async {
            if let id = self.tasks.removeValue(forKey: key) {
                UIApplication.shared.endBackgroundTask(id)
            }
            call.resolve()
        }
    }
}
