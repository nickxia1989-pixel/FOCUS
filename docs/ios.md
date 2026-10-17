# FOCUS iOS 版（界面原型）

用 Capacitor 8 把一套专为手机重写的 React 界面包成 iOS App。数据逻辑直接复用桌面端的 `src/model.ts` 和 `src/trash.ts`，通过坚果云和桌面端同步（见 [sync.md](sync.md)）。iOS 26 起页签栏、「+」和导航栏按钮是系统原生的 Liquid Glass，iPhone Duo 上由系统竖排到侧边（见下文「原生外壳」「iPhone Duo」两节）。

视觉按全平台重设计 F「一件事」（交接包 `design_handoff_focus/`：`screens/iPhone.jpg` P1–P17、`Duo.jpg` U1–U10、`Motion.jpg`、`tokens.css`）：一次只做一件，FOCUS 最上面那件放大成荧光绿的 NOW 卡。

![iPhone 17 Pro：FOCUS、长按菜单、新建](ios/redesign-iphone.jpg)

![VERIFY、INBOX、GOAL、HISTORY](ios/redesign-lists.jpg)

## 技术路线

- **Capacitor 8 + React 19 + zustand + motion**，和桌面端同一套技术栈。iOS 工程走 Swift Package Manager，不需要 CocoaPods。
- **复用而不改动**：列表的新建、完成（FOCUS / VERIFY 顶层项完成后进 INBOX）、待测、移动、删除进回收站、恢复、清洗全部调用 `src/model.ts` / `src/trash.ts`；类型来自 `src/types.ts`。移动端只新增文件，不改桌面端代码。
- **栏用原生，内容用网页**：iOS 26 起页签栏、「+」、导航栏按钮由原生外壳（`ios/App/App/FocusChrome.swift`）画，叠在铺满全屏的网页上面，拿到真正的 Liquid Glass；iPhone Duo 上系统自动把它们和状态栏竖排到侧边。网页只画内容，两边通过一个 Capacitor 插件互通。iOS 26 之前没有 Liquid Glass，退回网页自己画的页签（CSS 毛玻璃）。
- **为什么不选 SwiftUI**：SwiftUI 要把 `model.ts`（以及将来的同步合并逻辑）移植成 Swift，两套代码长期保持行为一致的成本高；原型阶段 Capacitor 能复用约九成逻辑。将来需要小组件、Siri / 快捷指令时，可以在 Capacitor 工程里加原生扩展，或再评估 SwiftUI。

## 目录

```
src/mobile/                 移动端界面（独立入口，不影响桌面构建）
  index.html / main.tsx     入口
  MobileApp.tsx             布局：原生外壳在时导航全交给原生；没有外壳时窄屏用页签、iPad 用侧栏；够宽时分成两页
  chrome.ts                 和原生外壳互通：推状态、接点按事件、把栏占掉的边距 / 折痕写进 CSS 变量
  layout.ts                 双页布局：内容区 ≥ 700pt 时以折痕（没有折痕时以中线）为界分左右两页
  data.ts                   profile、HISTORY 按天分组、示例数据等纯函数（data.test.ts 有单元测试）
  store.ts                  zustand 状态：多个 profile，各自一份 todos + 回收站
  storage.ts                存储适配层（现在用 Capacitor Preferences）
  native.ts                 触感反馈、键盘高度
  actions.ts                带动画 / 触感的高层操作（完成、换 NOW、送去验证、删除可撤销…）
  fx.ts                     完成时的火花、光圈、飞向页签的星星 / 幽灵卡（减弱动态效果时不放）
  icons.tsx                 设计交接包里的图标（描边 2px，24 网格）
  ui.ts                     仅界面用的临时状态
  transient.ts              编辑草稿、新建卡片里的字、阅读位置的短时备份（页面万一重载时恢复）
  widgetData.ts             主屏小组件的快照（从各空间的 todos 派生，widgetData.test.ts 有单元测试）
  widget.ts                 把快照交给原生插件写进 App Group；处理点小组件打开的 focustodo:// 链接
  components/               导航栏、页签栏、侧栏、FOCUS（NOW 卡 + 接下来）、列表行、滑动行、HISTORY、空状态、新建卡片、菜单、面板
  mobile.css                样式（设计 token、浅色 / 深色、提高对比度、降低透明度、减弱动态效果、安全区、动态字体）
ios/                        Capacitor 生成的 Xcode 工程（App 图标、启动屏已改成 FOCUS 的）
  App/App/FocusChrome.swift 原生外壳：Liquid Glass 页签栏 / 导航栏按钮、Duo 的竖排栏和铰链、和网页互通的插件
  App/App/SceneDelegate.swift  根视图（iOS 26 起是原生外壳）、钥匙串和后台时间插件
  App/App/FocusWidgetPlugin.swift   写小组件快照、刷新时间线的原生插件
  App/FocusWidget/                  主屏 / 锁屏小组件（WidgetKit 扩展，SwiftUI）
capacitor.config.json       Capacitor 配置（webDir = dist-ios）
vite.ios.config.mts         移动端的 Vite 配置（端口 5299）
scripts/make-ios-icon.cjs   生成 iOS 图标：默认 / 深色 / 着色三种外观（取 design_handoff_focus/icons，满版、无 alpha）
```

## 界面设计

**五个分区**：FOCUS、VERIFY、INBOX、GOAL 四个列表加 HISTORY。页头是日期一行加「列表名 · 数字」（Bricolage Grotesque 粗体，随应用打包，来自 `@fontsource/bricolage-grotesque`）。数字、页签角标都只数**未完成的顶层项**，不含子任务；GOAL、HISTORY 不挂角标。

**FOCUS：一次只做一件**

- 最上面那件是荧光绿的 **NOW 卡**：`NOW · 01 / 05`、大标题（点按原地编辑）、子任务分段进度条、最多列 3 条子任务（多的折成「还有 N 条」，子任务能直接勾）、黑色「完成」圆钮和「送去验证」。
- 其余排在「**接下来**」：序号 02、03…，越往后越淡；有子任务的带 `0/2` 胶囊，点开就地展开。
- 点「完成」：NOW 卡划线、滑出，火花加光圈，「接下来」的第一条变形升成新的 NOW（同一个元素，`layoutId` 动画），星星飞向 HISTORY 页签。
- 新建的、从 INBOX 送进来的事默认排在 NOW 之后（新建卡片里「排在现在之后」可以关掉，关掉就直接成为 NOW；这个开关记在本机）。

**其它分区**

- **VERIFY**：做完但还要测的。列表行右边的荧光绿星芒钮把它退回 FOCUS（排在 NOW 之后）；勾掉后回到 INBOX 的「已完成」。
- **INBOX**：随手记。星芒钮一键送进 FOCUS（排在 NOW 之后）。底下是可折叠的「已完成 · N」。
- **GOAL**：每个目标一张卡，下面一行「写下于 M 月 D 日」，**不显示进度**；子任务用右边的折叠钮收起 / 展开。
- **HISTORY**：今天 / 近 7 天 / 连续天数（今天那格荧光绿）、近 7 天柱状图（点柱子跳到那天），下面按天分组：时间、来源列表的小圆点、标题，小字写「父项 › 子项」「在 VERIFY 完成」「含 N 个子项」。点一条可以恢复为未完成、在原列表中查看、删除。
- **空状态**：叠放的空卡片插画、一句大字（Nothing now. / All checked. / Inbox zero. / No goals yet. / Nothing yet.）、一行说明和按钮（FOCUS 空了是「去 INBOX 挑一件」）。

**条目上的操作**：

| 手势 / 控件 | 作用 |
| --- | --- |
| 点圆圈 | 完成（火花 + 划线 + 触感 + 提示音）；星星飞向 HISTORY 页签 |
| 点文字 | 原地编辑，回车 / 失焦保存 |
| 右滑 | 完成 / 取消完成，滑过一大半直接执行 |
| 左滑 | 设为现在 · 送去验证（或取消待验证）· 移动 · 删除；拉过按钮全露出的位置再往里一截才算「滑到底」，直接删除 |
| 长按 | 行抬起、背景模糊，弹出玻璃上下文菜单：完成、编辑、添加子任务 / 设为现在、送去验证（VERIFY 里是退回 FOCUS）、移到…（二级）/ 删除 |
| 星芒钮 | INBOX、VERIFY 的顶层项：送进 FOCUS，排在 NOW 之后 |
| `0/2` 胶囊 | 子任务进度，点按展开 / 收起 |

子任务无限嵌套；子项标为待验证时留在父项下，圆圈变成紫色虚线并挂「待验证」标签（NOW 卡上同样）。删除后底部玻璃提示条 5 秒内可撤销；回收站在 `⋯` 菜单里（恢复 / 彻底删除要再点一次确认 / 清空）。

**新建**：点页签栏旁边的荧光绿 `+`（Duo 竖排栏里是侧边那一列的 `+`；双页时 FOCUS 右页顶上还有「接下来要做…」）。底部弹出贴着键盘的玻璃输入卡片：一排列表芯片（选中的是黑底荧光绿星芒加列表名），FOCUS 时右边是「排在现在之后」开关；回车添加后保持打开，可以连续输入，新的一行撑开并闪一下荧光绿。拼音等输入法组字时的回车只上屏，不会误提交。

**面板**：空间（左滑改名 / 删除）、回收站、同步（状态卡、坚果云设置、设备列表）、冲突（标题二选一、删除与修改、空间被删）、第一次加入云端的提示（合并本机数据 / 以云端为准）。手机上是从底部拉出的面板，顶上露出导航栏和 NOW 卡的一截；宽屏居中成卡片，双页时只居中在右页。

![空间、同步、撤销提示条、回收站](ios/redesign-sheets.jpg)

**系统适配**：安全区（含 iPhone Duo 的侧边竖排栏）、浅色 / 深色实时跟随、提高对比度（分隔线、玻璃描边和次要文字加深，深色下相应调亮）、降低透明度（网页画的玻璃改成实色）、减弱动态效果（不放火花和飞行动画，换场直接切）、动态字体（正文用 `-apple-system-body`）、原生 Liquid Glass 栏（iOS 26 之前网页自己画）、触感反馈（Capacitor Haptics）、关闭双击缩放延迟和长按选字。

**App 图标**：近黑底上一张荧光绿 NOW 卡、黑色星芒，下面压着两张灰卡；默认、深色、着色三种外观（`npm run icon:ios` 从交接包的 SVG 生成）。启动背景是 `#F6F6F2` / `#0B0B0C`。

![App 图标：默认、深色、着色](ios/app-icons.jpg)

## 原生外壳：Liquid Glass 页签栏（iOS 26 起）

底部那排页签、旁边的 `+`、导航栏上的头像 / 云朵 / `⋯` 都是系统控件，网页在它们底下铺满全屏：

```
窗口
└─ ChromeShellController（FocusChrome.swift）
   ├─ MainViewController：Capacitor 的 WKWebView，铺满全屏，只画内容
   └─ 叠在上面的一层（只有栏本身接触摸，空处的点按交给网页）
      └─ UITabBarController（五个分区）+ UINavigationController（头像、同步、⋯）+ 「+」
```

- **为什么不用 CSS 仿**：WKWebView 里 `backdrop-filter` 只能仿出毛玻璃的样子，没有 Liquid Glass 的折射、高光和随内容变色；而且 Duo 上只有系统的栏才会被系统竖排到侧边。
- **页签图标**用交接包的描边图标（`Assets.xcassets` 里的 `TabFocus` / `TabVerify` / `TabInbox` / `TabGoal` / `TabHistory`，SVG 保留矢量、按模板图上色）。不用 SF Symbols 的 `tray`、`mountain.2` 等：系统页签栏会自动换成它们的实心款，和设计的线性风格不符。
- **选中态**：设计是浅色「荧光绿底 + 近黑」、深色「17% 荧光绿底 + 荧光绿」。但 iOS 26 起玻璃页签栏的选中胶囊是系统玻璃，`UITabBarAppearance.selectionIndicatorTintColor` 和 `selectionIndicatorImage` 都不生效（27.1 实测），所以只给选中项的图标和文字上色：浅色近黑，深色荧光绿；胶囊本身是系统的浅灰 / 深灰玻璃。
- **角标**只给 FOCUS / VERIFY / INBOX，是未完成的顶层项数：不用系统的红底，灰色小字贴在图标右上（`badgeBackgroundColor = .clear`）。
- **「+」**：系统页签栏在手机上最多放 5 个页签，第 6 个会被折进「更多」（iOS 27 的 prominent 页签、pinned 页签都试过，同样会折），所以「+」不做成页签：栏横排时是页签栏右边一颗独立的玻璃圆钮（`UIButton.Configuration.prominentGlass()`，荧光绿 `#D6FF3D`，近黑的加号按原色画——深色下玻璃按钮会把前景改成白色），页签栏收窄让位；栏竖排时是侧边那一列里的 prominent 按钮。
- **`⋯`** 用系统的溢出菜单（`UINavigationItem.additionalOverflowItems`）：回收站（小字是条数）、同步（小字是状态）、空间（小字是当前空间）｜完成提示音、触感反馈（开关带勾）。HIG 要求自己的溢出菜单并进系统的，Duo 上放不下的按钮也会自动收进这里。
- **云朵**按同步状态换 SF Symbol 和颜色：已同步 `checkmark.icloud`（绿）、同步中 `arrow.triangle.2.circlepath`（转动）、离线 `icloud.slash`、出错 `exclamationmark.icloud`（红）、未开启 `icloud.dashed`（浅灰）；有冲突时带红色角标，点开冲突面板。
- **头像**是按空间颜色和首字画的图片（八种空间色；黑色那种在深色下反成浅底黑字），点开空间面板。
- **标题**：栏横排时导航栏那一行只有原生的头像和右边的胶囊，「日期 / 列表名 · 数字」由网页画在两者之间——原生报来那一行的位置（`nav`：顶、高、头像右边界、胶囊左边界），网页写进 `--nav-top/h/left/right`。

**和网页互通**（插件 `FocusChrome`，网页侧在 `src/mobile/chrome.ts`）：

| 方向 | 内容 |
| --- | --- |
| 网页 → 原生 | 当前分区、FOCUS / VERIFY / INBOX 的未完成顶层项数（角标）、设计 token 里原生要用的颜色（跟浅色 / 深色）、空间名和头像颜色、同步状态（图标、冲突数、菜单里的小字）、`⋯` 里的回收站条数 / 空间名 / 开关状态、有没有网页弹层、「分区收到东西」的脉冲（页签弹一下） |
| 原生 → 网页 | 点了页签、点了 `+` / 头像 / 云朵 / 菜单项；几何信息：栏在系统安全区之外又占掉的边距（写进 `--chrome-top/right/bottom/left`）、导航栏那一行的位置（`--nav-*`）、折痕、铰链（`data-hinge`）、栏竖排在哪侧（`data-bar`）、各页签图标的位置（完成 / 送去验证时「飞向某个分区」的终点） |

- 页面开始加载前原生注入 `data-chrome="native"`，网页第一次渲染就不画自己的页签和导航栏按钮，不会闪。网页的第一份状态到之前原生栏先不露出（不知道该选中哪个页签）。
- **浅色 / 深色**：两边各自跟系统走；颜色由网页的 CSS 变量推给原生，换外观时重推一次。
- **键盘**：软键盘真的盖住底部时页签栏和 `+` 收起（外接键盘时的小工具条不算），收起期间网页的底边距冻结，内容不跳。
- **网页弹层的层级**：长按菜单、新建卡片、空间 / 回收站 / 同步 / 冲突面板打开时，原生栏整个淡出、不接触摸——它们本该在面板底下，而原生视图永远盖在网页上面。
- **降级**：iOS 26 之前、在浏览器里、或者带启动参数 `-cssChrome` 时没有原生外壳，网页照旧自己画：窄屏是 CSS 毛玻璃页签栏（选中项荧光绿胶囊）加荧光绿 `+`，导航栏是头像、标题和云朵 / `⋯` 胶囊；宽屏（iPad）是侧栏，新建在右上胶囊里的 `+`。

## iPhone Duo

按苹果「Designing for iPhone Duo」做：只看可用空间，不认机型；栏的位置交给系统；内屏用"双页"多显示一层信息，开合时状态连续。

| 姿态 | 窗口 | 栏 | 内容 |
| --- | --- | --- | --- |
| 合上，竖握（外屏） | 466×678，D 形：左边铰链侧近直角，右边大圆角，前摄在右上 | 系统竖排在右侧那一列（84pt）：时间、信号、头像、云朵、`+`、`⋯`，下面是竖着的页签胶囊 | 单页 |
| 合上，横握 | 678×466 | 竖排在摄像头那一侧；放不下时头像、云朵、`+` 收进 `⋯`，页签全留着 | 单页 |
| 展开，横握（内屏） | 951×669 | 竖排在右侧，和外屏同一个位置 | 两页，以折痕为界（中间留 40pt） |
| 半折（书本） | 同上 | 同上 | 和展开一样，不重排 |
| 展开，竖握 | 669×951 | 横排：导航栏在顶上（和状态栏同一行），页签栏 + `+` 在底部 | 单页（折痕是横的，列表滚过它没关系） |

![iPhone Duo 各姿态（旧视觉；栏的排法和分页不变）](ios/duo-postures.jpg)

- **栏横排 / 竖排要两种层级**：竖排时用系统标准的"页签控制器里每个页签一个导航控制器"，系统才会把导航按钮和页签排进同一列、放不下时自动收进 `⋯`（外屏横握就放不下）；横排时导航栏在外层、页签控制器在里面，才能只收窄页签栏给 `+` 让位。开合、旋转时栏的排法一变，外壳把原生栏整套重搭（网页不动）；布局稳定后还会再核对一次，转的过程中短暂地"没有竖排栏"不会让它搭错。
- **双页**（`layout.ts`、`Chrome.tsx` 的 `Panes`）：内容区宽度 ≥ 700pt 就分两页，Duo 内屏横握和手机横屏都是。每个分区的内容分成左右两块（`.pane-l` / `.pane-r`），单页时上下接着排在同一个滚动页里，双页时各自成一个滚动页、以折痕为界——同一份 DOM，开合时不重建。按设计 U4–U6：
  - **FOCUS**：左页 NOW 卡（标题放大到 32pt，顶上写「NOW · 现在就做这件」）+ 今天完成 / 近 7 天 / 连续天数；右页「接下来要做…」新建框 + 接下来 + 可展开的「今天已完成」。
  - **VERIFY / INBOX / GOAL**：左页是列表，右页是这个列表的完成记录（按天；FOCUS / VERIFY 完成后挪进 INBOX 的仍记在原列表名下，所以 INBOX 左页的「已完成」可能比右页多）。
  - **HISTORY**：左页统计 + 最近 16 周热力图（点一天，右页跳到那天），右页按天的记录。
  - NOW 卡在单页和双页里是同一个元素：合上时它在外屏单列的顶上，展开后平移放大到左页同一位置，「接下来」从下面挪到右页。

  ![双页：951×669、手机横屏](ios/redesign-spread.jpg)

  上图是 iPhone 17 Pro 上用 `appResize` 开到 Duo 内屏尺寸（栏横排）和手机横屏截的，数据是测试数据；Duo 模拟器上装着真实数据，只核对了布局，没有存截图。
- **不压折痕**：新建卡片放在左页（要加进的列表在那儿），提示条放在右页底下，空间 / 回收站 / 同步 / 冲突面板居中在右页，长按菜单限制在长按的那一页里。
- **折痕的位置**：按 HIG 应该问系统要（`UIView.reservedRegions(kind: .division, options: .includeInactive)`），代码里也问了；但实测在模拟器里这个 App 不论用 UIKit 还是挂一个 SwiftUI `GeometryReader` 都问不到任何保留区域（Capy Pay 用 SwiftUI 的根视图能问到 456–496 的折痕，原因没查明）。所以网页以窗口中线为界兜底——Duo 内屏的折痕正好在中线上，分出来的空档和系统报告的一致。铰链状态（合上 / 半折 / 展平）用 `UIHingeInteraction` 能拿到，写在根节点的 `data-hinge` 上，目前排版不区分。
- **开合时状态连续**：分区、空间在全局状态里；滚动页不卸载，宽度一变就把导航栏下方第一行放回原位（`useScrollAnchor`）；编辑框不卸载，光标还在。重搭原生栏时系统会报一次"选中页签"，网页对同一分区不响应，否则会顺手结束编辑。万一页面被重载，`transient.ts` 兜底恢复草稿和阅读位置。

![开合时编辑不中断（旧视觉）](ios/duo-continuity.jpg)

- **要用 Xcode 27.1 编**：竖排栏、铰链、折痕是 iOS 27.1 SDK 的接口，代码用 `#if canImport(UIKit, _version: 9127.0.85)` 包着，所以 Xcode 27.0 也编得过，但那样编出来的包在 Duo 上跑兼容模式（栏不竖排，App 只占竖排栏以外的区域——此前「看起来没适配」就是这个原因）。这台 Mac 上 27.1 在 `/Applications/Xcode-27.1-RC.app`，系统默认选中的还是 27.0，命令行编译前设 `DEVELOPER_DIR`（见下文「运行」）。
- **模拟器实测方法**：姿态只能在 Xcode 的 Device Hub 窗口底部手动切（合上 / 半折 / 展开 / 旋转），自动化点不了；Duo 合上时模拟器的自动点击也不生效。所以联调时用 `VITE_FOCUS_E2E=1` 的测试包，靠命令队列（见 [sync.md](sync.md)）里只动界面的命令切分区、开面板、读布局（`section`、`ui`、`chrome`、`eval`；`seed` 新建一个演示空间并填上条目，文档截图用，只在测试包里），后台每秒查一次 `xcrun devicectl device info displays` 和 `chrome`，姿态一变就截当前那块屏（`xcrun simctl io <UDID> screenshot --display=<1 外屏 | 3 内屏>`）。启动参数 `-chromeDebug` 会在几何信息里带上键盘 / 页签栏 / 层级状态，并把视图树写到 App 的临时目录。

## 运行

需要 Node.js 22.12+、Xcode 27（含 iOS 27 模拟器运行时）。iPhone Duo 适配要用 **Xcode 27.1** 编（iOS 27.1 SDK 和运行时）。

```bash
npm install
npm run ios:dev      # 浏览器里调界面：http://localhost:5299（数据存 localStorage）
npm run ios:build    # 类型检查 + 构建 dist-ios + 同步到 ios/ 工程
npm run ios:open     # 用 Xcode 打开工程
npm run ios:run      # 构建并装到选择的模拟器 / 真机上运行
npm run icon:ios     # 重新生成 iOS 图标
```

### 模拟器

1. `npm run ios:build`，然后 `npm run ios:open`，在 Xcode 顶部选模拟器（例如 iPhone Duo、iPhone 17 Pro），点运行。给 Duo 用的包要用 Xcode 27.1 打开工程编译，或者在命令行编：

   ```bash
   DEVELOPER_DIR=/Applications/Xcode-27.1-RC.app/Contents/Developer xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=iPhone Duo' -derivedDataPath build/ios-dd build
   ```

   再用 `xcrun simctl install <UDID> build/ios-dd/Build/Products/Debug-iphonesimulator/App.app` 覆盖安装（同一个 bundle id，数据保留）。
2. 或者不开 Xcode：`npx cap run ios --list` 看可用设备，`npx cap run ios --no-sync --target <UDID>`。
3. iPhone Duo 的姿态在 Xcode 27 的 **Device Hub** 窗口底部工具栏切换（合上 / 半开 / 全开、旋转）。命令行能做的：`xcrun devicectl device info displays --device <UDID>` 看当前是哪块屏；常规 iPhone 可以用 `xcrun devicectl device orientation set --device <UDID> landscapeLeft` 旋转。
4. 看网页版导航（iOS 26 之前的样子）：启动时加参数 `-cssChrome`，例如 `xcrun simctl launch <UDID> app.focus.todo -cssChrome`。
5. 改了网页代码后热更新：先 `npm run ios:dev`，再 `npx cap run ios --live-reload --host <本机局域网 IP> --port 5299`。

### 真机（需要旅行者在 Xcode 里操作）

1. iPhone 用数据线连 Mac，在 iPhone 上「设置 › 隐私与安全性 › 开发者模式」打开开发者模式（会重启）。
2. `npm run ios:build && npm run ios:open`。
3. Xcode 左侧选 **App** 工程 › **TARGETS: App** › **Signing & Capabilities**：勾选 *Automatically manage signing*，**Team** 选自己的 Apple 开发者账号；**Bundle Identifier** 默认是 `app.focus.todo`，如果提示已被占用就改成自己的，例如 `com.<你的名字>.focus`（建议同时改 `capacitor.config.json` 的 `appId`）。
4. 顶部设备选自己的 iPhone，点运行。第一次装好后如果提示「不受信任的开发者」，到 iPhone「设置 › 通用 › VPN 与设备管理」里信任。

## 数据与同步

- 数据和桌面端是同一套可同步文档（`src/sync/`）：列表操作全部走 `src/sync/ops.ts`，与桌面端同一条代码路径。
- 本机存储：文档存在 App 私有目录的 `focus-doc.json`（`@capacitor/filesystem`，先写临时文件再改名）；只属于本机的状态（当前空间、分区、提示音、触感、折叠、同步进度）存 Capacitor Preferences。改动后 0.3 秒合并写入，切到后台时立即落盘。
- 从旧版原型升级时，原来 Preferences 里的整份快照会自动迁移。
- 同步：`⋯` 菜单 →「同步」填坚果云账号和应用密码（存钥匙串），或点导航栏的云朵图标。WebDAV 请求走 `CapacitorHttp`（原生 URLSession）。打开 / 回到前台立即同步，前台每 15 秒轮询，切到后台时申请后台时间把改动传完。冲突发现时自动弹出底部面板。详见 [sync.md](sync.md)。
- 原生插件（钥匙串、后台时间）写在 `ios/App/App/SceneDelegate.swift` 里的 `FocusNativePlugin`；原生外壳的插件 `FocusChromePlugin` 在 `FocusChrome.swift`，小组件用的 `FocusWidgetPlugin` 在 `FocusWidgetPlugin.swift`。三个都由 `MainViewController` 注册。
- `Info.plist` 只对本机地址放开了明文 HTTP（`NSAllowsLocalNetworking`），给联调用的本机 WebDAV 测试服务器；坚果云走 https。

## 主屏小组件

把「现在这一件」放到主屏上：只展示，不能在小组件里勾选。视觉按定稿设计（`design_handoff_focus/`：README「小组件（WidgetKit）」、`screens/Widgets.jpg`、`design/FWidget.dc.html`）。荧光绿 `#D6FF3D` 只给 NOW；下面的 NEXT 是序号列表，没有勾选圈，免得看起来能点。

| 浅色：大号、中号 / 小号（右边那个固定显示「读书」，FOCUS 空了） | 深色 |
| --- | --- |
| ![](ios/widget-home-light.jpg) | ![](ios/widget-home-dark.jpg) |

| iOS 26 着色 | 锁屏（一行、矩形、圆形）/ FOCUS 空时中、大号列 INBOX（着色模式） |
| --- | --- |
| ![](ios/widget-tinted.jpg) | ![](ios/widget-lock-empty.jpg) |

### 显示什么

- **NOW** = 当前空间 FOCUS 里手动顺序排第一的未完成顶层项（和 App 的 `nowOf` 一样），子任务进度 = 已完成子项 / 子项数。**NEXT** = 其后的顶层项，按顺序编号 02、03…。
- **件数**：`1/5`、「还有 4 件」、锁屏圆形的数字都是 FOCUS 未完成的**顶层项**数（含 NOW）。
- **今天 / 连续**：「今天 ✓4」「今天 4 件 · 连续 6 天」和 HISTORY 同一套算法（`src/history.ts` 的 `countsByDay` / `streak`，今天还没完成时从昨天往回数）。过了零点小组件自己清零、推算连续天数，不等 App 打开。
- **空状态**：FOCUS 空了显示「Nothing now.」和「INBOX 里有 N 件可以挑」；中号右边、大号下面列 INBOX 最上面三件，点进落在 INBOX。装好后还没打开过 App 时显示「打开 FOCUS 开始」。
- **字体**：`NOW`、`NEXT`、数字、「Nothing now.」用 Bricolage Grotesque 700 / 800（`@fontsource` 里的 latin woff2，iOS 的 CoreText 能直接注册 woff2，扩展的 `Info.plist` 用 `UIAppFonts` 声明，许可证 `Fonts/OFL.txt`）；中文和标题用系统字。字体没注册上时退回 SF Pro Rounded 粗体。

| 尺寸 | 内容 |
| --- | --- |
| 小号 | 浅色整块荧光绿 / 深色底 `#141416`：`✦ NOW · 1/5`，标题贴底，子任务进度条，「还有 4 件 · 今天 ✓4」 |
| 中号 | 左边内缩 8 的荧光绿 NOW 卡（164 宽，圆角 22），右边 NEXT 三件 +「+1 · 今天 ✓4」 |
| 大号 | 上面 NOW 卡（184 高，标题 20，最多两条子任务），下面 NEXT 四件，底部「今天 N 件 · 连续 N 天」+ 空间头像 |
| 锁屏圆形 | ✦ + 剩余件数，外圈 = 今天完成 /（今天完成 + 剩余） |
| 锁屏矩形 | `✦ NOW · 1/5` + NOW 标题两行 |
| 锁屏一行 | ✦ + NOW 标题 |

### 选空间

长按小组件 →「编辑小组件」→「空间」：默认是「跟随 App」，App 切到哪个空间就显示哪个；也可以固定成某个空间。固定了空间的小组件，点开时 App 也会切到那个空间。候选列表来自 App 写的快照，所以 App 至少要打开过一次；固定的空间被删掉后，小组件退回跟随 App。

### 怎么刷新

- 小组件不读同步文档。App 每次数据变化后（本地增删改、同步合并进来的改动、切换空间），`widgetData.ts` 从 store 派生一份精简快照（version 2：各空间的 NOW 及前三条子任务、NEXT 前 8 件、FOCUS 顶层未完成数、INBOX 前三件和总数、今天完成数、连续天数、头像序号），由 `widget.ts` 交给原生插件 `FocusWidget.update`。
- 插件把 JSON 写进 App Group `group.com.nickxia.focus.todo` 的 `widget-snapshot.json`，然后调用 `WidgetCenter.reloadTimelines(ofKind: "FocusList")`。
- 节流：连续改动时最多 0.8 秒写一次；内容和上次一样就不写、不刷新（插件里再比一次文件）。切到后台时还没写的那一下立即写掉。
- 小组件的时间线在明天、后天 0 点各排一条：今天完成清零，连续天数按天推算（第二天还算上写入那天，再往后就断了）。
- App 不在前台时不会同步，所以别的设备上的改动要等这台 iPhone 打开 FOCUS、同步合并之后才会出现在小组件上。

### 点开

`widgetURL` 是 `focustodo://focus`；FOCUS 空了时中、大号列的是 INBOX，链接是 `focustodo://inbox`。固定了空间的带 `?profile=<id>`。`Info.plist` 注册了 `focustodo` 这个 URL scheme，`widget.ts` 监听 `appUrlOpen`（冷启动时读 `App.getLaunchUrl()`），等数据载入后切空间、切到对应分区、收起面板和菜单。

### 着色、透明、深色

颜色取自 `design_handoff_focus/tokens.json`：浅色白底 / 深色 `#141416`，正文、muted、分隔线各一套；空间头像按定稿的五种配色顺序取（近黑底荧光绿字在深色里反过来）。着色和透明模式下系统去掉底色：NOW 卡变成一层随系统着色的半透明（`widgetAccentable`），`✦ NOW`、序号、进度和锁屏圆形也跟着着色，其余文字白色 55%–95% 分层，头像改成半透明圆。

### 工程

- WidgetKit 扩展 target `FocusWidgetExtension`（bundle id `app.focus.todo.FocusWidget`，iOS 17+，Swift 5），嵌进 App。文件在 `ios/App/FocusWidget/`：
  - `FocusWidget.swift`：时间线、`@main` 入口、支持的尺寸
  - `FocusIntent.swift`：选空间的 AppIntent（`ProfileEntity`、「跟随 App」）
  - `FocusSnapshot.swift`：快照的读取（字段缺了用默认值）
  - `FocusWidgetViews.swift`：各尺寸的界面、配色、Display 字、星芒；改视觉主要改这个文件
  - `Fonts/`：Bricolage Grotesque 700 / 800 的 woff2 和 OFL 许可证（从 `node_modules/@fontsource/bricolage-grotesque` 复制）
- App 和扩展都有 App Group 权限（`App/App.entitlements`、`FocusWidget/FocusWidget.entitlements`）。`project.pbxproj` 只加了扩展 target、这几个文件和 App 的 `CODE_SIGN_ENTITLEMENTS`，没有写死开发团队。
- 签名用自动签名，团队在命令行传入。模拟器构建不需要描述文件；真机构建见「已知问题」里的 App Group 一条：

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 18 Pro' DEVELOPMENT_TEAM=49G26925BS -allowProvisioningUpdates build
```

### 联调方法

- 看 App 写的快照：

```bash
cat "$(xcrun simctl get_app_container <UDID> app.focus.todo group.com.nickxia.focus.todo)/widget-snapshot.json"
```

- 模拟器的输入法是拼音，`simctl io` 和 MCP 的 `text` 输不了中文。要准备带中文的测试数据，可以用 `src/sync/migrate.ts` 的 `migrateLegacy` 生成一份同步文档，App 退出后放进 `$(xcrun simctl get_app_container <UDID> app.focus.todo data)/Library/focus-doc.json` 再打开。
- 添加小组件：主屏长按空白处 → 左上角按钮 →「添加小组件」→ 找到 FOCUS；锁屏长按 →「自定义」→ 锁定屏幕。着色 / 透明在主屏长按 → 左上角按钮 →「自定义」里切换。
- 不点小组件也能试链接：`xcrun simctl openurl <UDID> "focustodo://inbox?profile=<空间 id>"`（系统会先问一次「在 FOCUS 中打开？」）。

## 已知问题

- **真机签名还差一步（App Group 没进描述文件）**：App Group 已换成带个人标识的 `group.com.nickxia.focus.todo`（`App.entitlements`、`FocusWidget.entitlements`、`FocusWidgetPlugin.swift`、`FocusSnapshot.swift` 四处）。`xcodebuild -destination 'generic/platform=iOS' DEVELOPMENT_TEAM=49G26925BS -allowProvisioningUpdates` 能在开发者账号里登记 `app.focus.todo` 和 `app.focus.todo.FocusWidget`、打开 App Groups 能力并取回一年期描述文件，但两个描述文件里的 App Group 列表都是空的，构建报 “doesn't match the entitlements file's value for the com.apple.security.application-groups entitlement”。旧 id 和新 id 结果一样，加 `REGISTER_APP_GROUPS=YES`、删掉描述文件重取也一样，看起来不是 id 被别人占用，而是命令行的自动签名没有把新的 App Group 登记、分配给 App ID（Capy Pay 的 `group.com.nickxia.capypay` 是在描述文件里的，同一个团队）。另外 Mac 锁屏时 Xcode 读不到账号，命令行会报 “No Accounts”。解决：解锁 Mac，用 Xcode 打开 `ios/App/App.xcodeproj`，App 和 FocusWidgetExtension 两个 target 的 Signing & Capabilities 里 Team 选 Ning Xia，App Groups 里勾上（没有就点 + 新建）`group.com.nickxia.focus.todo`；之后命令行构建就能签名。模拟器不受影响。
- **拖拽排序没做**：长按已用于上下文菜单；换 NOW 用左滑或菜单里的「设为现在」。设计 U4 里「拖到左页 = 换成现在」也没做。可考虑在长按菜单里加「排序」模式，或长按后拖动（类似「提醒事项」）。
- **页签选中态不是荧光绿底**：系统玻璃页签栏的选中胶囊不能着色（见「原生外壳」），只有图标和文字上色。要完全照设计，只能自己画页签栏，就丢了系统的 Liquid Glass 和 Duo 竖排。
- **Duo 竖排栏里「+」的位置**：设计 U1 / U4 把 `+` 放在页签胶囊下面单独一颗；现在是系统竖排栏里头像、云朵下面的 prominent 按钮（竖排时页签控制器由系统摆，没法在它下面再挂一颗）。
- **只在模拟器上验证过**：没有真机；模拟器用的是硬件键盘，软键盘弹出时新建卡片贴键盘、页签栏收起的效果还需要真机确认。
- **新视觉在 Duo 上只看了内屏展开横握**：外屏、半折、旋转要在 Device Hub 里手动切姿态，留给旅行者核对（上面「各姿态」「开合时编辑不中断」两张图还是旧视觉）。
- **折痕问不到**：见「iPhone Duo」一节，以窗口中线兜底；真机上要再确认一次 `reservedRegions` 能不能问到。
- **未在 iOS 26 上实测**：原生外壳从 iOS 26 起启用，但这次只用 iOS 27 / 27.1 模拟器验过；iOS 26 上 `+` 圆钮、溢出菜单用的都是 26 就有的接口。
- **「半折」立着当小笔记本（内屏竖握半折）**没有专门做上下分屏，照单页排；折痕横穿列表时只是列表滚过它。
- **Duo 外屏横握**空间太小，系统把头像、云朵、`+` 收进了 `⋯`（页签优先）；要新建得点 `⋯` → 新建，或者转回竖握。

## 与桌面端的衔接

- 两端共用 `src/model.ts`、`src/types.ts` 和整个 `src/sync/`；profile 和数据结构已经统一，桌面和手机的数据通过坚果云互通。
- `tsconfig.json` 包含 `src/`，桌面端类型检查也会检查 `src/mobile/`。
- 移动端的 HISTORY 按天分组仍在 `src/mobile/data.ts`，和桌面端的 `src/history.ts` 各有一份，以后可以合并。
