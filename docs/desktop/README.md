# 桌面版截图（设计 F「一件事」）

实现对照的是设计交接包 [design_handoff_focus/](../../design_handoff_focus/README.md) 的 `screens/Mac.jpg`（1–19 号画面 + 同步状态）和 `screens/Win.jpg`（W1–W7）。文件名里的编号对应设计稿的画面编号。

## 怎么拍的

- 2026-10-18 在 Mac 上用开发版（`VITE_DEV_SERVER_URL` + Electron 44）拍的，每个实例用单独的临时数据目录（`FOCUS_USER_DATA`），没有碰真实数据。
- 页面截图是 Electron 页面本身（CDP `Page.captureScreenshot`，2 倍），**不含系统画的窗口外框**：Mac 截图左上角的红绿灯是按 `trafficLightPosition (12, 14)` 补画的示意，窗口圆角、描边和阴影也是后期加的。实际运行时红绿灯、圆角由 macOS 画。
- Windows 截图是在 Mac 上用 `FOCUS_FORCE_PLATFORM=win` 画的 Windows 标题栏（无边框窗口），字体回落到苹方；真实 Windows 上是 Segoe UI Variable + 微软雅黑 UI，窗口圆角 8 和阴影由 Win11 画。
- 同步是真的：本机 `npm run dev:webdav` 测试服务器 + 4 个实例（「MacBook Pro」「iPhone 17 Pro」「DESKTOP-WIN11」「Surface Laptop」）。冲突面板里的三个冲突是两个实例离线时各改各的造出来的。
- 示例数据是演示用的，和设计稿一致。
- 2026-10-18 第二轮（大纲式编辑、NOW 卡子任务、外观）后重拍了全部画面；`mac-14`、`mac-sync-states`、`win-W6` 只有面板和标题栏、没有变化，沿用第一轮的截图。

## Mac

| 文件 | 画面 |
| --- | --- |
| `mac-01-focus-light.jpg` | 1 · FOCUS 浅色：NOW 卡 + 接下来 |
| `mac-02-focus-dark.jpg` | 2 · FOCUS 深色，NOW 卡保持荧光绿 |
| `mac-03-hover-context-menu.jpg` | 3 · 悬停（拖拽点、勾选圈、设为现在 / 送去验证 / ⋯）+ 右键菜单 |
| `mac-04-drag-to-now.jpg` | 4 · 把 05 拖到 NOW 卡上（松手 = 设为现在） |
| `mac-05-add.jpg` | 5 · 新建框输入中，右侧提示 `⌘↵ 设为现在` |
| `mac-06-verify.jpg` | 6 · VERIFY：星芒钮退回 FOCUS，子项缩进 |
| `mac-07-inbox.jpg` / `mac-20-inbox-dark.jpg` | 7 · INBOX：星芒钮送进 FOCUS，已完成折叠 |
| `mac-08-goal.jpg` | 8 · GOAL：不显示任何进度，只有「写下于 …」 |
| `mac-09-history.jpg` / `mac-21-history-dark.jpg` | 9 · HISTORY：三格统计、16 周热力图、按天分组 |
| `mac-10-trash.jpg` | 10 · 回收站 |
| `mac-11-more-menu.jpg` | 11 · `⋯` 菜单 |
| `mac-12-profile-menu.jpg` | 12 · Profile 菜单（悬停一项出现改名 / 删除） |
| `mac-13-sync-settings.jpg` | 13 · 同步设置（已同步，4 台设备） |
| `mac-14-conflicts.jpg` | 14 · 冲突决定面板：删空间 vs 改内容 / 删除 vs 修改 / 标题二选一 |
| `mac-15-join-cloud.jpg` | 15 · 第一次加入云端：合并本机数据（推荐）/ 以云端为准 |
| `mac-16-empty.jpg` | 16 · FOCUS 空了：Nothing now. |
| `mac-17-undo-toast-dark.jpg` | 17 · 删除后 5 秒可撤销，圆环倒计时 |
| `mac-18-regular-light.jpg` / `mac-18b-regular-inbox-light.jpg` | 18 · 宽窗口（≥ 520）：左侧栏 + 更大的 NOW 卡 |
| `mac-19-regular-history-dark.jpg` / `mac-19b-regular-focus-dark.jpg` | 19 · 宽窗口深色 |
| `mac-22-edit-enter-new-line.jpg` | 编辑子任务时回车：保存，并在后面开一个同层级的空行接着写 |
| `mac-23-edit-tab-indent.jpg` | 编辑「接下来」第 03 行时按 Tab：挂到上一条下面，编辑框不关 |
| `mac-24-now-subtask-hover.jpg` | NOW 卡子任务悬停：「待验证」开关和删除；底部常驻「+ 添加子任务」 |
| `mac-25-now-subtask-menu.jpg` | NOW 卡子任务的右键菜单：完成、编辑、待验证、升一级、删除 |
| `mac-26-appearance-menu.jpg` | `⋯` 菜单「外观」：跟随系统 / 浅色 / 深色 |
| `mac-27-keys.jpg` | `⋯` 菜单「快捷键与编辑…」 |
| `mac-28-drag-reorder.jpg` | 自由拖拽：同级排序，插入线在深度 0 |
| `mac-29-drag-depth1-parent.jpg` | 往右拖一级：插入线缩进到深度 1，新父项（03）高亮，竖线连到插入线；折叠的 03 悬停 600ms 自动展开了 |
| `mac-30-drag-depth2.jpg` | 再往右一级：深度 2，挂到「在 completedFrom…」下面 |
| `mac-31-drag-undo.jpg` | 换了父项：「已移到「…」下 · 撤销」，5 秒内可撤销 |
| `mac-32-drag-into-now.jpg` | 队列里的项拖进 NOW 卡的子任务：NOW 卡作为新父项描边 |
| `mac-33-drag-subtask-out.jpg` | NOW 卡上的子任务拖出来，成队列里的一项（深度 0） |
| `mac-34-drag-set-now.jpg` | 拖到 NOW 卡标题区 = 设为现在（卡片描边，不画插入线） |
| `mac-35-drag-to-tab.jpg` | 拖到 INBOX 页签上换列表（停 800ms 会切过去继续拖） |
| `mac-sync-states.jpg` | 标题栏云朵的六种状态 |

## Windows

| 文件 | 画面 |
| --- | --- |
| `win-W1-focus-light.jpg` | W1 · FOCUS 浅色：左边应用图标 + FOCUS，右边云朵、图钉、⋯、最小化、关闭 |
| `win-W2-focus-dark.jpg` | W2 · FOCUS 深色 |
| `win-W3-more-menu.jpg` | W3 · `⋯` 菜单（圆角 8） |
| `win-W4-context-menu-dark.jpg` | W4 · 右键菜单（深色） |
| `win-W5-inbox-offline-dark.jpg` | W5 · INBOX 深色，离线（斜线云朵） |
| `win-W6-conflicts.jpg` | W6 · 冲突面板 |
| `win-W7-regular-light.jpg` | W7 · 宽窗口 |

`overview.jpg` 是 README 顶部的拼图（浅色、深色、Windows、宽窗口）。
