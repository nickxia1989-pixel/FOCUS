import UIKit
import WebKit
import Capacitor

// 原生外壳：iOS 26 起，页签栏、「+」、导航栏上的空间 / 同步 / ⋯ 都用系统控件，拿到真正的 Liquid Glass；
// 在 iPhone Duo 上，系统会把它们和状态栏一起竖排到侧边那一列（合上的外屏、横着的内屏）。
// 网页（MainViewController）垫在最底下铺满全屏，外壳的页签控制器叠在上面，只有栏本身接触摸。
//
// 和网页的约定（src/mobile/chrome.ts）：
// - 网页 → 原生：FocusChrome.setState({ json }) 推当前分区、角标、空间、同步状态、有没有弹层等；
// - 原生 → 网页：事件 tab（点了页签）、action（点了 + / 空间 / 同步 / 菜单项）、
//   geometry（栏占掉的边距、折痕、铰链、栏竖排在哪侧、页签图标的位置）。
// 页面开始加载前注入 data-chrome="native"，网页据此不画自己的页签和导航栏按钮。
//
// iPhone Duo 的接口（竖排栏、铰链、折痕）是 iOS 27.1 SDK 才有的，用 `#if canImport(UIKit, _version:)` 包起来：
// 用 Xcode 27.0 也能编过，只是没有 Duo 适配；要用 Xcode 27.1 编（用旧 SDK 编出来的包在 Duo 上跑兼容模式，栏不会竖排）。

enum FocusRoot {
    /// 选根视图控制器。iOS 26 之前没有 Liquid Glass，直接用网页（页签由网页自己画）；
    /// 调试时加启动参数 -cssChrome 也走网页版。
    static func make() -> UIViewController {
        let web = MainViewController()
        if #available(iOS 26.0, *), !ProcessInfo.processInfo.arguments.contains("-cssChrome") {
            web.usesNativeChrome = true
            return ChromeShellController(web: web)
        }
        return web
    }
}

// MARK: - 插件

@objc(FocusChromePlugin)
public class FocusChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusChromePlugin"
    public let jsName = "FocusChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getGeometry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "debugRebuild", returnType: CAPPluginReturnPromise),
    ]

    /// 外壳收网页状态的入口；没有外壳（iOS 26 之前）时为空
    var onState: ((ChromeState) -> Void)?
    /// 最近一次的几何信息，网页启动时来取
    var geometry: [String: Any] = [:]
    /// 调试：把栏整套重搭一次（只在带 -chromeDebug 启动时有效），验证重搭时正在编辑的内容不丢
    var onDebugRebuild: (() -> Void)?

    /// 在页面脚本运行前标记"原生外壳"，网页第一次渲染就不画自己的页签，不会闪一下
    static func markNative(_ webView: WKWebView?) {
        let js = "document.documentElement.dataset.chrome = 'native';"
        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
    }

    @objc func setState(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8),
              let state = try? JSONDecoder().decode(ChromeState.self, from: data) else {
            return call.reject("bad state")
        }
        DispatchQueue.main.async {
            self.onState?(state)
            call.resolve()
        }
    }

    @objc func debugRebuild(_ call: CAPPluginCall) {
        guard ProcessInfo.processInfo.arguments.contains("-chromeDebug") else { return call.reject("debug only") }
        DispatchQueue.main.async {
            self.onDebugRebuild?()
            call.resolve()
        }
    }

    @objc func getGeometry(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.geometry) }
    }

    func send(_ event: String, _ data: [String: Any]) {
        notifyListeners(event, data: data)
    }
}

/// 网页推过来的状态（字段见 src/mobile/chrome.ts 的 snapshot）
struct ChromeState: Decodable, Equatable {
    struct Profile: Decodable, Equatable {
        var name: String
        /// 头像底色和字色（设计：第一个空间是近黑底荧光绿字，深色下反过来）
        var bg: String
        var fg: String
    }
    struct Sync: Decodable, Equatable {
        /// ok / syncing / offline / error / off
        var icon: String
        var conflicts: Int
        /// 无障碍说明，例如「离线：改动已保存在本机……」
        var label: String
        /// ⋯ 菜单里「同步」右边的短状态，例如「已同步」
        var status: String
    }
    struct Menu: Decodable, Equatable {
        var trash: Int
        var sound: Bool
        var haptics: Bool
        /// 当前空间名（⋯ 菜单里「空间」右边）
        var space: String
        /// 外观：system / light / dark
        var appearance: String
    }
    /// 设计 token 里原生栏要用的几种颜色（跟着网页当前的浅色 / 深色）
    struct Palette: Decodable, Equatable {
        var lime: String
        var limeInk: String
        var text: String
        var muted: String
        var faint: String
        var ok: String
        var bad: String
        /// 选中页签的图标和字色：浅色近黑，深色荧光绿
        var tabOnFg: String
        var dark: Bool
    }
    var section: String
    /// 角标：只给 FOCUS / VERIFY / INBOX
    var counts: [String: Int]
    var palette: Palette
    var profile: Profile
    var sync: Sync
    var menu: Menu
    /// 网页上开着面板、菜单或新建卡片：原生栏让开
    var modal: Bool
    /// 分区"收到东西"的计数，变了就让那个页签弹一下
    var pulse: [String: Int]
}

// MARK: - 外壳

@available(iOS 26.0, *)
final class ChromeShellController: UIViewController, UITabBarControllerDelegate {
    /// 图标：星芒、眼睛里一个勾（SF Symbols 里没有，用 Assets 里的 TabVerify 模板图）、托盘、山、日历勾
    static let sections: [(id: String, title: String, symbol: String)] = [
        ("focus", "FOCUS", "TabFocus"),
        ("verify", "VERIFY", "TabVerify"),
        ("inbox", "INBOX", "TabInbox"),
        ("goal", "GOAL", "TabGoal"),
        ("history", "HISTORY", "TabHistory"),
    ]
    /// 角标只给这几个列表（GOAL、HISTORY 不显示数字）
    static let badged: Set<String> = ["focus", "verify", "inbox"]

    static func icon(_ name: String) -> UIImage? {
        UIImage(systemName: name) ?? UIImage(named: name)?.withRenderingMode(.alwaysTemplate)
    }
    /// 「+」圆钮的直径和它与页签栏之间的空隙（设计：64 / 12；系统页签栏高 62，跟它齐）
    private static let plusSize: CGFloat = 62
    private static let plusGap: CGFloat = 12

    private let web: MainViewController
    private let overlay = PassthroughView()
    /// 当前这套栏：页签控制器，以及它外面那层（横排时）或它本身（竖排时）
    private var tabs = UITabBarController()
    private var root: UIViewController?
    /// 栏横排时导航栏在外层，页签控制器装在它的根页面里（见 build）
    private var holder: ChromeHolderController?
    /// 当前这套栏是按竖排搭的
    private var builtVertical: Bool?
    /// 栏横排时页签栏右边的「+」：荧光绿的玻璃圆钮、近黑的 +。
    /// 设计里它是第 6 个 search 角色的页签，但系统页签栏在手机上超过 5 个就折出「更多」（iOS 27 实测，search / prominent 都一样），
    /// 所以不做成页签，自己放一颗玻璃圆钮
    private let plusButton = UIButton(configuration: .prominentGlass())
    private var hosts: [WeakHost] = []
    private var state: ChromeState?
    private var keyboardShown = false
    /// 页签栏被我们藏起来时（键盘、网页弹层）冻结底边距，免得网页内容跟着跳
    private var frozenBottom: CGFloat?
    private var hinge: String?
    private var lastGeometry: NSDictionary?
    private var geometryQueued = false
    /// 给「+」腾出来的右侧宽度：页签控制器的右边界往里收这么多
    private var plusSlot: CGFloat = 0

    init(web: MainViewController) {
        self.web = web
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var childForStatusBarStyle: UIViewController? { web }
    override var childForStatusBarHidden: UIViewController? { web }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { web.supportedInterfaceOrientations }

    /// 系统把栏竖排到侧边（iPhone Duo 合上的外屏、横着的内屏）
    private var barsVertical: Bool {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) { return traitCollection.verticalBarEdge != .unspecified }
        #endif
        return false
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        addChild(web)
        web.view.frame = view.bounds
        web.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(web.view)
        web.didMove(toParent: self)

        overlay.frame = view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // 网页的第一份状态到之前不露出栏：选中哪个页签、角标都还不知道
        overlay.alpha = 0
        overlay.passes = { [weak self] hit in
            // 导航控制器、页签控制器自己的底板、各页签里透明的占位页和它们的外层容器：触摸交给下面的网页
            guard let self else { return false }
            return hit === self.holder?.view || self.hosts.contains { $0.host?.viewIfLoaded?.isDescendant(of: hit) ?? false }
        }
        view.addSubview(overlay)

        // 深色下玻璃按钮会把前景色改成白色：图标用原色渲染，浅色深色都是近黑
        let ink = UIColor(red: 0x0B / 255, green: 0x0B / 255, blue: 0x0C / 255, alpha: 1)
        plusButton.configuration?.image = UIImage(
            systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 25, weight: .semibold))?
            .withTintColor(ink, renderingMode: .alwaysOriginal)
        plusButton.tintColor = UIColor(red: 0xD6 / 255, green: 1, blue: 0x3D / 255, alpha: 1)
        plusButton.configuration?.baseForegroundColor = ink
        plusButton.configuration?.cornerStyle = .capsule
        plusButton.accessibilityLabel = "新建"
        plusButton.addAction(UIAction { [weak self] _ in self?.compose() }, for: .primaryActionTriggered)
        overlay.addSubview(plusButton)

        web.chrome.onState = { [weak self] s in self?.apply(s) }
        web.chrome.onDebugRebuild = { [weak self] in
            guard let self, let vertical = self.builtVertical else { return }
            self.build(vertical: vertical)
            self.layoutTabs()
        }

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)

        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            let interaction = UIHingeInteraction { [weak self] _, update in
                guard let self else { return }
                switch update.hinge?.status {
                case .closed: self.hinge = "closed"
                case .partiallyOpen: self.hinge = "partial"
                case .fullyOpen: self.hinge = "open"
                default: self.hinge = nil
                }
                // 半折 / 展平时折痕的"活跃"状态会变，重新取一次
                self.queueGeometry()
            }
            view.addInteraction(interaction)
            registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) { (self: Self, _: UITraitCollection) in
                self.updatePlacement()
            }
        }
        #endif
        updatePlacement()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // 旋转、开合时竖排栏在哪一侧不一定都伴随一次特征变化通知（转的过程中还可能短暂地"没有竖排栏"），
        // 布局稳定后再对一次，搭错了就重搭
        if let built = builtVertical, built != barsVertical {
            DispatchQueue.main.async { [weak self] in self?.updatePlacement() }
        }
        layoutPlus()
        queueGeometry()
    }

    // MARK: 搭栏

    /// 按栏横排 / 竖排搭一套页签栏和导航栏。两种排法要的层级不一样：
    /// - 竖排（Duo 外屏、横着的内屏）：系统标准的"页签控制器里每个页签一个导航控制器"，
    ///   系统才会把导航栏按钮和页签栏排进同一列、空间不够时自动收进 ⋯（外屏横握时就不够）。「+」是导航栏上的 prominent 按钮。
    /// - 横排（iPhone、Duo 内屏竖握）：导航栏在外层、页签控制器装在里面，这样能只把页签栏收窄，给旁边的「+」圆钮让位。
    /// Duo 开合、旋转时栏的排法会变，整套重搭；网页不动，选中的页签、角标从最近一份网页状态重新填。
    private func build(vertical: Bool) {
        // 重搭前记住网页里谁在接键盘（正在编辑的条目）：新搭的栏不能把它抢走
        let responder = UIResponder.current
        defer {
            if let r = responder as? UIView, r.isDescendant(of: web.view), !r.isFirstResponder { r.becomeFirstResponder() }
        }
        if let root {
            root.willMove(toParent: nil)
            root.view.removeFromSuperview()
            root.removeFromParent()
        }
        hosts = []
        holder = nil
        builtVertical = vertical

        let tabs = UITabBarController()
        tabs.delegate = self
        tabs.mode = .tabBar
        tabs.tabBarMinimizeBehavior = .never
        tabs.view.backgroundColor = .clear
        tabs.tabs = Self.sections.map { s in
            UITab(title: s.title, image: Self.icon(s.symbol), identifier: s.id) { [weak self] _ in
                guard let self else { return UIViewController() }
                let host = self.makeHost()
                return vertical ? self.wrapInNav(host) : host
            }
        }
        if let s = state, let tab = tabs.tabs.first(where: { $0.identifier == s.section }) { tabs.selectedTab = tab }
        self.tabs = tabs

        let top: UIViewController
        if vertical {
            top = tabs
        } else {
            let holder = ChromeHolderController()
            holder.loadViewIfNeeded()
            holder.addChild(tabs)
            holder.view.addSubview(tabs.view)
            tabs.didMove(toParent: holder)
            holder.onLayout = { [weak self] in self?.layoutTabs() }
            self.holder = holder
            top = wrapInNav(holder)
        }
        addChild(top)
        top.view.frame = overlay.bounds
        top.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.insertSubview(top.view, belowSubview: plusButton)
        top.didMove(toParent: self)
        root = top
        configureItems()
        if let state { applyTabs(state, tint: true) }
        if tabs.isTabBarHidden != (keyboardShown || state?.modal == true) {
            tabs.setTabBarHidden(keyboardShown || state?.modal == true, animated: false)
        }
    }

    private func wrapInNav(_ vc: UIViewController) -> UINavigationController {
        let nav = UINavigationController(rootViewController: vc)
        nav.view.backgroundColor = .clear
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.compactAppearance = appearance
        nav.navigationBar.tintColor = .label
        return nav
    }

    private func makeHost() -> ChromeHostController {
        let host = ChromeHostController()
        host.onLayout = { [weak self] in
            self?.layoutPlus()
            self?.queueGeometry()
        }
        hosts.removeAll { $0.host == nil }
        hosts.append(WeakHost(host: host))
        configureItems(host.navigationItem)
        return host
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelectTab selectedTab: UITab, previousTab: UITab?) {
        // 重搭栏时系统也会报一次"选中"：和网页当前分区一样就不发，免得打断正在编辑的条目
        if tabBarController === tabs, selectedTab.identifier != state?.section {
            web.chrome.send("tab", ["section": selectedTab.identifier])
        }
        queueGeometry()
    }

    private func compose() {
        web.chrome.send("action", ["name": "compose"])
    }

    /// 栏横排 / 竖排切换（Duo 开合、旋转）：「+」在横排时是页签栏旁的圆钮，竖排时是侧边栏里的按钮（系统摆放）
    private func updatePlacement() {
        let vertical = barsVertical
        plusSlot = vertical ? 0 : Self.plusSize + Self.plusGap
        if builtVertical != vertical { build(vertical: vertical) }
        plusButton.isHidden = vertical
        layoutTabs()
        queueGeometry()
    }

    /// 横排时页签控制器铺满导航栏下面的根页面，右边收进 plusSlot
    private func layoutTabs() {
        if let holder {
            let b = holder.view.bounds
            let leading = view.effectiveUserInterfaceLayoutDirection == .rightToLeft
            let frame = CGRect(x: leading ? plusSlot : 0, y: 0, width: b.width - plusSlot, height: b.height)
            if tabs.view.frame != frame { tabs.view.frame = frame }
        }
        layoutPlus()
    }

    /// 「+」和页签栏的胶囊对齐：同高、垂直居中，离页签栏的空隙和胶囊离屏幕边的一样
    private func layoutPlus() {
        guard builtVertical == false else { return }
        let size = Self.plusSize
        let platter = tabPlatter().map { $0.convert($0.bounds, to: overlay) }
        let midY = platter?.midY ?? (view.bounds.maxY - view.safeAreaInsets.bottom - 8 - size / 2)
        let margin = platter.map { max(8, $0.minX - view.safeAreaInsets.left) } ?? 16
        let right = view.bounds.maxX - view.safeAreaInsets.right - margin
        plusButton.bounds = CGRect(x: 0, y: 0, width: size, height: size)
        plusButton.center = CGPoint(x: right - size / 2, y: midY)
    }

    // MARK: 网页状态

    private func apply(_ s: ChromeState) {
        let old = state
        state = s
        applyTabs(s, tint: old?.palette != s.palette)
        if old?.profile != s.profile || old?.sync != s.sync || old?.menu != s.menu || old?.palette != s.palette {
            configureItems()
        }
        if let old {
            for (id, n) in s.pulse where (old.pulse[id] ?? 0) != n { bounceTab(id) }
        }
        updateVisibility(animated: old != nil)
        if old == nil {
            UIView.animate(withDuration: 0.2) { self.overlay.alpha = s.modal ? 0 : 1 }
        }
    }

    /// 选中的页签、角标、配色
    private func applyTabs(_ s: ChromeState, tint: Bool) {
        if let tab = tabs.tabs.first(where: { $0.identifier == s.section }), tabs.selectedTab !== tab {
            tabs.selectedTab = tab
        }
        for tab in tabs.tabs {
            let n = Self.badged.contains(tab.identifier) ? (s.counts[tab.identifier] ?? 0) : 0
            let value = n > 0 ? (n > 99 ? "99+" : String(n)) : nil
            if tab.badgeValue != value { tab.badgeValue = value }
        }
        guard tint else { return }
        let p = s.palette
        let onFg = color(p.tabOnFg) ?? .label
        let text = color(p.text) ?? .label
        let muted = color(p.muted) ?? .secondaryLabel
        // 选中态：设计是浅色荧光绿底 + 近黑、深色 17% 荧光绿底 + 荧光绿。
        // 但 iOS 26 起玻璃页签栏的选中胶囊是系统玻璃，selectionIndicatorTintColor / selectionIndicatorImage 都不生效（27.1 实测），
        // 所以只给图标和文字上色：浅色近黑，深色荧光绿；未选中是正文色。
        // 角标是列表的未完成数，不是"未读提醒"：不用红底，用灰色小字贴在图标右上
        let appearance = UITabBarAppearance()
        for layout in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
            layout.normal.iconColor = text
            layout.normal.titleTextAttributes = [.foregroundColor: text]
            layout.selected.iconColor = onFg
            layout.selected.titleTextAttributes = [.foregroundColor: onFg]
            for state in [layout.normal, layout.selected] {
                state.badgeBackgroundColor = .clear
                state.badgeTextAttributes = [.foregroundColor: state === layout.selected ? onFg : muted,
                                             .font: UIFont.systemFont(ofSize: 10, weight: .heavy)]
                state.badgePositionAdjustment = UIOffset(horizontal: -2, vertical: 2)
            }
        }
        tabs.tabBar.standardAppearance = appearance
        tabs.tabBar.scrollEdgeAppearance = appearance
        tabs.view.tintColor = onFg
    }

    private func updateVisibility(animated: Bool) {
        let modal = state?.modal ?? false
        let hideBar = modal || keyboardShown
        if tabs.isTabBarHidden != hideBar {
            if hideBar { frozenBottom = (lastGeometry?["insets"] as? [String: Any])?["bottom"] as? CGFloat }
            tabs.setTabBarHidden(hideBar, animated: animated)
            let move = { self.plusButton.transform = hideBar ? CGAffineTransform(translationX: 0, y: 140) : .identity }
            if animated { UIView.animate(withDuration: 0.3, delay: 0, options: .curveEaseInOut, animations: move) } else { move() }
            if !hideBar {
                frozenBottom = nil
                queueGeometry()
            }
        }
        // 网页的面板、菜单盖在最上面时，原生栏整个淡出：它们本该在面板底下
        overlay.isUserInteractionEnabled = !modal
        let alpha: CGFloat = modal ? 0 : 1
        guard state != nil, overlay.alpha != alpha else { return }
        if animated {
            UIView.animate(withDuration: 0.22) { self.overlay.alpha = alpha }
        } else {
            overlay.alpha = alpha
        }
    }

    /// 软键盘真的盖住了屏幕底部才算弹出：外接键盘时的小工具条、旋转时零高度的通知都不算
    @objc private func keyboardWillChange(_ note: Notification) {
        guard let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let kb = view.convert(end, from: nil)
        let shown = view.bounds.intersection(kb).height > 120
        guard shown != keyboardShown else { return }
        keyboardShown = shown
        updateVisibility(animated: true)
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        guard keyboardShown else { return }
        keyboardShown = false
        updateVisibility(animated: true)
    }

    // MARK: 导航栏按钮

    /// 导航栏按钮挂在哪：横排时是外层导航栏的根页面，竖排时是每个页签里的占位页
    private func configureItems() {
        if let holder { configureItems(holder.navigationItem) }
        for h in hosts { if let host = h.host { configureItems(host.navigationItem) } }
    }

    private func configureItems(_ item: UINavigationItem) {
        item.largeTitleDisplayMode = .never
        // 标题（日期 + 列表名 · 数字）由网页画在导航栏这一行里，原生只放按钮
        item.title = nil
        guard let s = state else { return }
        let p = s.palette

        let avatar = UIBarButtonItem(
            image: avatarImage(name: s.profile.name, bg: color(s.profile.bg) ?? .black, fg: color(s.profile.fg) ?? .white),
            primaryAction: UIAction(title: "空间", image: UIImage(systemName: "person.2")) { [weak self] _ in
                self?.web.chrome.send("action", ["name": "profiles"])
            }
        )
        avatar.accessibilityLabel = "当前空间：\(s.profile.name)，点按切换"

        let sync = UIBarButtonItem(
            image: syncImage(s.sync.icon),
            primaryAction: UIAction(title: "同步", image: UIImage(systemName: "icloud")) { [weak self] _ in
                self?.web.chrome.send("action", ["name": "sync"])
            }
        )
        sync.accessibilityLabel = s.sync.label
        sync.tintColor = syncTint(s.sync, p)
        sync.badge = s.sync.conflicts > 0 ? .count(s.sync.conflicts) : nil
        if s.sync.icon == "syncing" {
            // 同步中：双箭头 1.1s 匀速转
            sync.addSymbolEffect(.rotate.byLayer, options: .repeat(.continuous))
        }

        item.leftBarButtonItem = avatar
        if builtVertical == true {
            // 栏竖排时「+」跟导航按钮一起由系统排进侧边那一列（HIG：常用的新建保持可见）
            let lime = color(p.lime) ?? .systemYellow
            let ink = color(p.limeInk) ?? .black
            let glyph = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(weight: .semibold))?
                .withTintColor(ink, renderingMode: .alwaysOriginal)
            let plus = UIBarButtonItem(image: glyph, primaryAction: UIAction(title: "新建", image: UIImage(systemName: "plus")) { [weak self] _ in
                self?.compose()
            })
            plus.style = .prominent
            plus.tintColor = lime
            if #available(iOS 27.0, *) {
                // 竖排栏放不下时（外屏横握）按钮会收进 ⋯：新建最常用，留得最久；同步按钮带冲突角标，其次
                plus.visibilityPriority = UIBarButtonItemVisibilityPriority(higherThan: .high)
                sync.visibilityPriority = .high
            }
            item.rightBarButtonItems = [plus, sync]
        } else {
            item.rightBarButtonItems = [sync]
        }
        // ⋯ 用系统的溢出菜单（HIG：自己的 ⋯ 菜单并进系统的），在 Duo 的竖排栏里也由系统摆放
        item.additionalOverflowItems = UIDeferredMenuElement.uncached { [weak self] completion in
            completion(self?.overflowItems() ?? [])
        }
    }

    /// ⋯ 菜单（设计 P11）：回收站、同步、空间 | 外观、完成提示音、触感反馈
    private func overflowItems() -> [UIMenuElement] {
        guard let s = state else { return [] }
        let m = s.menu
        let send: (String) -> UIActionHandler = { name in { [weak self] _ in self?.web.chrome.send("action", ["name": name]) } }
        let trash = UIAction(title: "回收站", subtitle: m.trash > 0 ? "\(m.trash) 项" : nil, image: UIImage(systemName: "trash"), handler: send("trash"))
        let sync = UIAction(title: "同步", subtitle: s.sync.status, image: UIImage(systemName: "icloud"), handler: send("sync"))
        let profiles = UIAction(title: "空间", subtitle: m.space, image: UIImage(systemName: "person.2"), handler: send("profiles"))
        let sound = UIAction(title: "完成提示音", image: UIImage(systemName: "speaker.wave.2"), state: m.sound ? .on : .off, handler: send("sound"))
        let haptics = UIAction(title: "触感反馈", image: UIImage(systemName: "iphone.radiowaves.left.and.right"), state: m.haptics ? .on : .off, handler: send("haptics"))
        let looks: [(String, String)] = [("system", "跟随系统"), ("light", "浅色"), ("dark", "深色")]
        let appearance = UIMenu(
            title: "外观",
            subtitle: looks.first { $0.0 == m.appearance }?.1,
            image: UIImage(systemName: "circle.lefthalf.filled"),
            children: looks.map { key, title in
                UIAction(title: title, state: m.appearance == key ? .on : .off, handler: send("appearance:\(key)"))
            })
        return [
            UIMenu(options: .displayInline, children: [trash, sync, profiles]),
            UIMenu(options: .displayInline, children: [appearance, sound, haptics]),
        ]
    }

    /// 云朵的几种状态（设计：已同步带勾、同步中双箭头、离线斜线、出错感叹号、未开启虚线）
    private func syncImage(_ icon: String) -> UIImage? {
        let name: String
        switch icon {
        case "syncing": name = "arrow.triangle.2.circlepath"
        case "offline": name = "icloud.slash"
        case "error": name = "exclamationmark.icloud"
        case "off": name = "icloud.dashed"
        default: name = "checkmark.icloud"
        }
        return UIImage(systemName: name) ?? UIImage(systemName: "icloud")
    }

    private func syncTint(_ s: ChromeState.Sync, _ p: ChromeState.Palette) -> UIColor {
        if s.conflicts > 0 { return color(p.bad) ?? .systemRed }
        switch s.icon {
        case "ok": return color(p.ok) ?? .systemGreen
        case "error": return color(p.bad) ?? .systemRed
        case "offline", "off": return color(p.faint) ?? .tertiaryLabel
        default: return color(p.text) ?? .label
        }
    }

    private func avatarImage(name: String, bg: UIColor, fg: UIColor) -> UIImage {
        let size = CGSize(width: 30, height: 30)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            bg.setFill()
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
            let text = String(name.first ?? "?") as NSString
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 14, weight: .bold),
                .foregroundColor: fg,
            ]
            let t = text.size(withAttributes: attrs)
            text.draw(at: CGPoint(x: (size.width - t.width) / 2, y: (size.height - t.height) / 2), withAttributes: attrs)
        }
        return image.withRenderingMode(.alwaysOriginal)
    }

    // MARK: 几何信息

    private func queueGeometry() {
        guard !geometryQueued else { return }
        geometryQueued = true
        DispatchQueue.main.async { [weak self] in
            self?.geometryQueued = false
            self?.pushGeometry()
        }
    }

    private func pushGeometry() {
        guard isViewLoaded, view.window != nil else { return }
        if ProcessInfo.processInfo.arguments.contains("-chromeDebug") { dumpViews() }
        let g = geometry()
        let dict = g as NSDictionary
        if let lastGeometry, lastGeometry.isEqual(to: g) { return }
        lastGeometry = dict
        web.chrome.geometry = g
        web.chrome.send("geometry", g)
    }

    private func geometry() -> [String: Any] {
        // 栏占掉的边距：选中页签里的占位页的安全区，减去网页本身的（系统的）安全区
        let sys = web.view.safeAreaInsets
        var extra = UIEdgeInsets.zero
        if let host = hosts.compactMap({ $0.host }).first(where: { $0.viewIfLoaded?.window != nil }) {
            let safe = host.view.convert(host.view.bounds.inset(by: host.view.safeAreaInsets), to: view)
            let b = view.bounds
            extra = UIEdgeInsets(
                top: max(0, safe.minY - b.minY - sys.top),
                left: max(0, safe.minX - b.minX - sys.left),
                bottom: max(0, b.maxY - safe.maxY - sys.bottom),
                right: max(0, b.maxX - safe.maxX - sys.right)
            )
        }
        // 「+」那一格只在底栏那一行，内容不用让
        extra.right = max(0, extra.right - plusSlot)
        if let frozenBottom { extra.bottom = frozenBottom }

        var g: [String: Any] = [
            "insets": ["top": extra.top, "left": extra.left, "bottom": extra.bottom, "right": extra.right],
            "safe": ["top": sys.top, "left": sys.left, "bottom": sys.bottom, "right": sys.right],
            "size": ["width": view.bounds.width, "height": view.bounds.height],
            "targets": tabTargets(),
        ]
        g["hinge"] = hinge ?? NSNull()
        g["fold"] = NSNull()
        g["bar"] = NSNull()
        if let nav = navMetrics() { g["nav"] = nav }
        if ProcessInfo.processInfo.arguments.contains("-chromeDebug") {
            g["debug"] = "kb=\(keyboardShown) hidden=\(tabs.isTabBarHidden) vertical=\(String(describing: builtVertical))"
        }
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            // 折痕的位置问系统要（展平时也问得到，只是不活跃）。实测在模拟器里这个 App 问不到（Capy Pay 的 SwiftUI 根视图问得到，
            // 原因没查明），网页那边以窗口中线为界兜底——Duo 内屏的折痕正好在中线上
            if let r = view.reservedRegions(kind: .division, options: .includeInactive).first {
                g["fold"] = [
                    "x": r.frame.minX, "y": r.frame.minY, "width": r.frame.width, "height": r.frame.height,
                    "active": r.isActive,
                ]
            }
            switch traitCollection.verticalBarEdge {
            case .leading: g["bar"] = view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? "right" : "left"
            case .trailing: g["bar"] = view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? "left" : "right"
            default: break
            }
        }
        #endif
        return g
    }

    /// 栏横排时导航栏那一行的位置和左右按钮占到哪：网页把标题（日期 + 列表名 · 数字）画在头像右边
    private func navMetrics() -> [String: Any]? {
        guard builtVertical == false, let bar = holder?.navigationController?.navigationBar, bar.window != nil, !bar.isHidden else { return nil }
        let f = bar.convert(bar.bounds, to: view)
        guard f.height > 0 else { return nil }
        var leading = f.minX + view.safeAreaInsets.left + 16 + 44
        var trailing = f.maxX - view.safeAreaInsets.right - 16 - 88
        // 系统没有公开按钮的视图，按类名找玻璃底（找不到就用上面的估计值）
        var glass: [CGRect] = []
        func walk(_ v: UIView) {
            if v.isHidden || v.alpha < 0.01 { return }
            if String(describing: type(of: v)).contains("GlassInteraction") {
                glass.append(v.convert(v.bounds, to: view))
                return
            }
            for sub in v.subviews { walk(sub) }
        }
        walk(bar)
        let lead = glass.filter { $0.midX < f.midX }
        let trail = glass.filter { $0.midX >= f.midX }
        if let m = lead.map(\.maxX).max() { leading = m }
        if let m = trail.map(\.minX).min() { trailing = m }
        return ["top": f.minY, "height": f.height, "leadingEnd": leading, "trailingStart": trailing]
    }

    /// 页签图标在屏幕上的位置：网页里"飞向某个分区"的动画以它为终点
    private func tabTargets() -> [String: Any] {
        var out: [String: Any] = [:]
        for (id, v) in tabViews() {
            let c = v.convert(CGPoint(x: v.bounds.midX, y: v.bounds.midY), to: view)
            out[id] = ["x": c.x, "y": c.y]
        }
        return out
    }

    /// 页签栏的胶囊（系统没有公开，按类名找）
    private func tabPlatter() -> UIView? {
        var found: UIView?
        func walk(_ v: UIView) {
            if found != nil || v.isHidden { return }
            if String(describing: type(of: v)).contains("TabBarItemPlatter") { found = v; return }
            for sub in v.subviews { walk(sub) }
        }
        walk(tabs.view)
        return found
    }

    /// 各页签的按钮，按页签顺序对应到分区（系统没有公开页签的视图，按类名找、按位置排）
    private func tabViews() -> [String: UIView] {
        guard let platter = tabPlatter() else { return [:] }
        var buttons: [UIView] = []
        func walk(_ v: UIView) {
            if v.isHidden || v.alpha < 0.01 { return }
            if String(describing: type(of: v)).contains("TabButton") {
                let f = v.convert(v.bounds, to: platter)
                if !buttons.contains(where: { $0.convert($0.bounds, to: platter) == f }) { buttons.append(v) }
                return
            }
            for sub in v.subviews { walk(sub) }
        }
        walk(platter)
        let vertical = platter.bounds.height > platter.bounds.width
        buttons.sort {
            let a = $0.convert($0.bounds, to: platter), b = $1.convert($1.bounds, to: platter)
            return vertical ? a.minY < b.minY : a.minX < b.minX
        }
        guard buttons.count == Self.sections.count else { return [:] }
        var out: [String: UIView] = [:]
        for (s, b) in zip(Self.sections, buttons) { out[s.id] = b }
        return out
    }

    /// 调试：把整个窗口的视图树写到临时目录（-chromeDebug）
    private func dumpViews() {
        var lines: [String] = ["safe=\(view.safeAreaInsets) tabBar=\(tabs.tabBar.frame) hidden=\(tabs.isTabBarHidden) vertical=\(barsVertical)"]
        func walk(_ v: UIView, _ depth: Int) {
            let f = v.convert(v.bounds, to: view)
            lines.append(String(repeating: "  ", count: depth) + "\(type(of: v)) \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height)) a=\(v.alpha) h=\(v.isHidden) ax=\(v.accessibilityLabel ?? "-")")
            for sub in v.subviews { walk(sub, depth + 1) }
        }
        walk(view.window ?? view, 0)
        try? lines.joined(separator: "\n").write(toFile: NSTemporaryDirectory() + "chrome-dump.txt", atomically: true, encoding: .utf8)
    }

    private func bounceTab(_ id: String) {
        guard let v = tabViews()[id] else { return }
        let anim = CAKeyframeAnimation(keyPath: "transform.scale")
        anim.values = [1, 1.18, 0.96, 1]
        anim.keyTimes = [0, 0.35, 0.7, 1]
        anim.duration = 0.42
        v.layer.add(anim, forKey: "focus-pulse")
    }

    private func color(_ hex: String?) -> UIColor? {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

/// 导航控制器的根页面：透明，导航栏按钮挂在它上面，页签控制器装在它里面
private final class ChromeHolderController: UIViewController {
    var onLayout: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        onLayout?()
    }
}

/// 每个页签里的占位页：透明、不接触摸，只用来提供"栏占掉多少"的安全区
private final class ChromeHostController: UIViewController {
    var onLayout: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        onLayout?()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        onLayout?()
    }
}

private struct WeakHost {
    weak var host: ChromeHostController?
}

/// 叠在网页上面的一层：点到栏本身才接，点到空处交给下面的网页
private final class PassthroughView: UIView {
    var passes: (UIView) -> Bool = { _ in false }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event) else { return nil }
        return hit === self || passes(hit) ? nil : hit
    }
}


private extension UIResponder {
    private static weak var found: UIResponder?

    /// 当前的第一响应者（系统没有直接给，借一次沿响应链发送的动作找到它）
    static var current: UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(captureCurrentResponder), to: nil, from: nil, for: nil)
        return found
    }

    @objc private func captureCurrentResponder() {
        UIResponder.found = self
    }
}
