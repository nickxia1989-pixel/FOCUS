# FOCUS

一个窄而高的桌面 TODO 小窗，Windows / macOS 通用。

三个页签：

| 页签 | 用途 |
| --- | --- |
| **FOCUS** | 当下要完成的具体事情 |
| **INBOX** | 想到什么先丢进来 |
| **GOAL** | 长期大目标 |

## 功能

- 页签上显示该列表**未完成**的数量（含子项）
- 每个页签顶部输入框直接新建，回车后保持焦点可连续输入
- 勾选完成 / 再点一次取消完成
- 排序：未完成在前；同状态下新建的在前；同层、同状态内可**拖拽**调整顺序
- 列表间移动：
  - INBOX 顶层未完成项右侧常驻 **◎ 按钮**，一键送进 FOCUS
  - 把条目**拖到顶部页签**上即可移到那个列表
  - 右键 / `⋯` 菜单里的「移到 …」
- FOCUS 的顶层项完成后自动移到 INBOX（子项完成则留在父项下）
- 子 TODO：悬停点 `+` 或右键「添加子任务」，可无限嵌套，用缩进 + 连线显示层级；父项右侧胶囊显示进度并可折叠
  - 移动父项时子孙一起移动；单独移动子项会让它脱离原父项，成为目标列表的顶层项
  - 完成父项时子孙一并完成
- 完成动画：勾选弹跳、粒子与光环、整行扫光、删除线划过、提示音（可在 `⋯` 菜单关闭），FOCUS 完成项会飞向 INBOX 页签
- 双击文字编辑；删除后 5 秒内可撤销
- 窗口可置顶（标题栏图钉），位置、大小、置顶状态自动记住
- 跟随系统浅色 / 深色模式

### 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl/⌘ + 1 / 2 / 3` | 切换 FOCUS / INBOX / GOAL |
| `Ctrl/⌘ + N` | 聚焦新建输入框 |
| `Enter` / `Esc` | 确认 / 取消（新建、编辑、子任务输入） |
| `Ctrl/⌘ + Z` | 撤销刚才的删除 |
| `Esc`（拖拽中） | 取消拖拽 |

## 数据存放

数据是本地 JSON 文件（每次改动约 0.25 秒后原子写入，关窗前同步落盘）：

- Windows：`%APPDATA%\FOCUS\focus-data.json`
- macOS：`~/Library/Application Support/FOCUS/focus-data.json`

每次启动会把上一次可正常读取的数据备份为同目录下的 `focus-data.bak.json`；主文件损坏时自动用备份恢复。
`⋯` 菜单里的「打开数据文件夹」可直接打开该目录。设置环境变量 `FOCUS_USER_DATA` 可改用其它目录。

## 开发

需要 Node.js 22.12+。

```bash
npm install
npm run dev        # Vite 开发服务器 + Electron 窗口，改代码热更新
npm run dev:web    # 只在浏览器里跑界面（数据存 localStorage），方便调样式
npm test           # 数据逻辑单元测试
npm run build      # 类型检查 + 打包前端
npm start          # 构建后用 Electron 运行
```

## 打包

```bash
npm run dist:win   # 在 Windows 上：生成安装包和免安装版 exe
npm run dist:mac   # 在 macOS 上：生成 dmg 和 zip
```

产物在 `release/` 目录。macOS 包需要在 Mac 上构建；未签名的 Mac 应用首次打开需要右键「打开」。
应用图标由 `npm run icon` 从 `scripts/make-icon.cjs` 里的 SVG 生成到 `build/icon.png`。

## 结构

```
electron/main.cjs      主进程：窗口、文件读写、IPC
electron/preload.cjs   向页面暴露 window.focusApi
src/model.ts           纯数据操作（排序、移动、完成、子树…），有单元测试
src/store.ts           zustand 状态与持久化
src/actions.ts         带动画反馈的高层操作
src/dnd.ts             拖拽排序 / 拖到页签
src/effects.ts         粒子、飞行小球、提示音
src/components/        界面组件
```
