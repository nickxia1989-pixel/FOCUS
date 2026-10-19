# AI agent 操作接口（MCP）

让 Claude Code、Claude 桌面版和其它 MCP 客户端直接、高效地读写 FOCUS。
范围：**只做桌面端**（2026-10-17 旅行者确认手机端不需要 agent 操作）。方案在同日确认，按确认的方案实现。

- 接入配置见[第 6 节](#6-接入)。
- 工具怎么用见[第 4 节](#4-工具)。

## 1. 约束：为什么不能直接改 JSON 文件

- 桌面版运行时，数据以**渲染进程内存里的文档**为准（`src/store.ts`），每次改动后约 0.25 秒整份写回 `focus-doc.json`。外部进程改了这个文件，下一次保存就会被覆盖掉。
- 每次写入都要经时钟打戳：HLC 加版本向量，见 `src/sync/clock.ts`。时钟（设备 id、写入计数）存在 `focus-local.json` 里。外部进程借用桌面的时钟写入，只要桌面同时也在写，就会出现**同一设备、同一计数、内容不同**的两个戳。版本向量的前提被破坏，其它设备会把其中一次改动误判成"已经看过"，悄悄丢掉。
- 所以 agent 的每一次写入，要么交给正在运行的桌面，由桌面用自己的时钟执行；要么以**另一台设备的身份**、用自己的时钟执行。两种情况都只调 `src/sync/ops.ts` / `doc.ts` 的写入函数。

## 2. 几种做法的对比（选型时的结论）

| | 延迟（一次调用） | 桌面没开 | 界面实时刷新 | 和同步、冲突的关系 | 安全 | 实现量 |
| --- | --- | --- | --- | --- | --- | --- |
| **A. MCP server（stdio）** | 协议本身几毫秒，总延迟看后端 | 看后端 | 看后端 | 看后端 | 不开端口；进程由 agent 客户端拉起 | 中 |
| **B. 桌面内置本地 HTTP / IPC** | 实测 4 ms | ❌ macOS 关了窗口也不行，渲染进程没了 | ✅ 实测约 20 ms | 最好：用桌面自己的时钟执行，和界面操作一样，约 2 秒后上传；agent 和界面的操作在同一个线程里串行 | 要开端口：只绑 127.0.0.1，随机端口加令牌 | 中 |
| **C. CLI** | 100～300 ms（每次起一个 Node 进程） | 看后端 | 看后端 | 看后端 | 同 A | 小 |
| **D. 无界面同步设备（坚果云 WebDAV）** | 一轮 0.3～2 s；其它设备要等各自的下一次轮询，最长约 15 秒 | ✅，换一台电脑也能跑 | ⚠️ 最长约 15 秒 | 完整的一台设备；**和桌面、手机共用坚果云每 30 分钟 1500 次的额度** | ⚠️ 要在 agent 的机器上存坚果云应用密码 | 中 |
| **E. 本地 outbox（agent 当一台本机设备）** | 实测 38 ms | ✅ 改动先存本机，桌面下次启动时并入 | 桌面开着时实测约 0.2 s；关着就等下次启动 | agent 用自己的 deviceId 打戳，写**自己的** outbox，桌面像并入远端设备一样合并后上传 | 不开端口、不需要凭证 | 中 |
| F. iOS App Intents / 快捷指令 | — | — | — | — | — | 不做（手机端不需要） |

结论：**MCP 统一入口 + B（桌面开着时）+ E（桌面没开时）**，C 作为同一个程序的子命令顺带提供，D 以后需要时再加。

## 3. 架构

```
 Claude Code / Claude 桌面版 / 其它 MCP 客户端
          │ stdio（JSON-RPC）
          ▼
 dist-agent/focus-mcp.mjs（Node 单文件，由 src/agent/node/ 打包）
   └─ src/agent/core.ts：解析 id、执行一批操作（只调 ops/doc）、生成紧凑快照、按 cursor 算增量
          │
          ├─ 桌面开着 ─▶ 实时模式：POST http://127.0.0.1:<随机端口>/v1/rpc + 令牌
          │               electron/agent.cjs（主进程）──IPC──▶ src/agent/bridge.ts（渲染进程）
          │               用桌面的 doc/clock 跑 core → store.applyExternal → 界面立刻刷新，约 2 秒后上传
          │
          └─ 桌面没开 ─▶ 离线模式：<数据目录>/agent/outbox.json（agent 自己的设备文件）
                          只读 focus-doc.json，用 agent 自己的时钟跑 core，结果写进 outbox
                          桌面启动时（开着时监听到文件变化）用 store.mergePeer 并入，再 requestUpload 尽快上传
```

### 3.1 每次调用怎么选模式

1. 数据目录：环境变量 `FOCUS_USER_DATA`，没有就用系统默认位置（macOS `~/Library/Application Support/FOCUS`，Windows `%APPDATA%\FOCUS`），和桌面版的规则一致。所以测试实例只要给 MCP 设同一个环境变量就行。
2. 读 `<数据目录>/agent-endpoint.json`（桌面启动时写、退出时删，里面是端口、令牌、pid）。连得上、渲染进程就绪：走实时模式。
3. 文件不存在、pid 已不在、连接被拒、桌面回复"界面还没就绪"（503）：走离线模式。
4. **请求已经发给桌面、但没等到回复**（超时、界面执行出错）：写入不改走离线，直接报"结果未知，先 `focus_read` 确认"，否则可能重复新增。读取没有这个问题，任何失败都改读磁盘。
5. 输出第一行写明当前模式。测试时可以用 `FOCUS_AGENT_MODE=live|offline` 强制指定。

### 3.2 实时模式

- 主进程 `electron/agent.cjs`：
  - `app` 就绪后在 `127.0.0.1:0` 开 HTTP，端口由系统随机分配，令牌是 256 位随机数。端口和令牌写进 `agent-endpoint.json`（权限 0600）。
  - 只有 `POST /v1/rpc {api, method: read|apply, params}` 一个入口，收到后经 IPC 转给渲染进程，最多等 10 秒。
  - 页面开始加载、崩溃或销毁时清掉"就绪"标记，等页面重新报到（`agent:ready`）。期间的请求回 503。
- 渲染进程 `src/agent/bridge.ts`（由 `src/main.tsx` 引入，数据加载完才挂上）：
  - `read`：返回当前文档、当前 profile 和同步状态，快照由 MCP 端生成。
  - `apply`：在 store 的 `{doc, clock, collapsed}` 上跑 `core.applyOps`，通过 `store.applyExternal` 提交。效果和界面操作完全一样：算本机改动，立即刷新，走正常的 2 秒防抖上传。
  - 提交后弹提示条，例如「AI：新增 4 · 标待测 1 · 移动 1 等 8 处」（复用 `showToast`，不改组件）。
  - 界面类操作（`show` / `collapse` / `expand` / `sync_now`）只在这里生效。

### 3.3 离线模式（outbox）

- **身份**：存在 `agent/state.json`，包括设备 id（10 位，和其它设备一样）、时钟、写入序号和绑定的机器。机器指纹是 macOS 的 IOPlatformUUID、Windows 的 MachineGuid 或 Linux 的 machine-id，只存哈希。数据目录被拷到别的电脑时会换一个新 id、保留已知的知识，两边不会用同一个 id 写出不同内容。
- **每次写入**：
  1. 拿 `agent/lock` 独占锁（只在读改写的几毫秒里持有；持有者进程已退出或超过 10 秒就接管）。这样同时开着的几个 MCP 进程共用一个身份，计数不会重号。
  2. 只读 `focus-doc.json`，和 outbox 合并成当前视图；用 `observe` 把视图里的全部知识并入 agent 时钟。
  3. 跑 `core.applyOps`，所有改动都经 `ops.ts` / `doc.ts`，用 agent 的时钟打戳。
  4. outbox 只保留桌面文档里**还没有**的记录。桌面并入、保存以后，这些记录在下一次写入时自动清掉。
  5. 用设备文件格式（`buildDeviceFile`）先写临时文件再改名，最后释放锁。
- **数据不可用时拒绝写入，并说明原因**：这个数据目录还没有数据、数据还是旧版格式没迁移，或 `focus-doc.json` 读不出来（读取时暂时用桌面留的 `.bak.json`）。
- **桌面这边**：
  - 启动时读一次 outbox，用 `store.mergePeer` 并入，和并入远端设备的逻辑相同。新出现的冲突照常自动弹出。
  - 运行时主进程监听 `agent/`（`fs.watch`，另加每 2 秒查一次修改时间兜底），有变化就通知渲染进程并入。
  - 并入后调 `syncDesktop.requestUpload()`，也就是引擎的 `requestUpload()`：强制下一轮上传，不按"只是并入了别人的改动"攒 10 分钟。引擎还没启动时，启动后补上。
  - 选了「以云端为准」、还没读到云端数据时不并入；替换完成后再并入一次。
- agent 的写入和界面上的改动如果真的并发（离线写入依据的是磁盘上最多晚 0.25 秒的文档），按现有规则合并，需要决定时同样弹冲突面板。

## 4. 工具

一共 3 个工具：读、可恢复的写、不可撤销的彻底删除。工具定义每轮都会发给模型，少而精更省 token；分开也方便在客户端里单独设权限。

| 工具 | 作用 | 标记 |
| --- | --- | --- |
| `focus_read` | 一次拿全部 profile、四个列表（含子任务、待测）、HISTORY、回收站、待决冲突；可以只拿某个 profile、某几个分区，或按关键字搜；传 `since` 只拿变化 | `readOnlyHint` |
| `focus_apply` | 一批可恢复的写操作，整批原子执行 | 非破坏性（删除进回收站，30 天内能恢复） |
| `focus_purge` | 彻底删除回收站条目、清空回收站 | `destructiveHint`，不可撤销 |

### 4.1 id

- 输出时只显示**最短唯一前缀，至少 6 位**，例如 `1a2b3c`；本来就不长的 id（例如 `default`）原样显示。
- 输入接受完整 id，也接受任意至少 4 位的唯一前缀，不分大小写。前缀有歧义时报错并列出候选，**绝不猜**。
- profile 可以用名字（忽略大小写）或 id 前缀指定。
- 同一批里新建的条目或 profile，可以先用 `ref` 起个名字，后面的操作写 `"$名字"` 引用。

### 4.2 `focus_read`

默认输出紧凑文本（实测样例）：

```
FOCUS · 实时（桌面开着，改动立刻显示） · 同步 已同步 23:00 · 10-17 23:00 · cursor c1.cld8qeyyld:c,mkcl0ook7b:3
profile：默认 [default]（当前） · 生活 [851a21]
# 默认 [default]（当前）
## FOCUS · 3
- [ ] 754d82 点右边的 ◎ 按钮，把这条一键送进 FOCUS
- [ ] 326277 E2E 写周报
  - [ ] 300830 收集数据
  - [ ] bfc1b1 画图 #待测
- [ ] 94afbc 做完但还要测试？点右边的烧瓶，把它送进 VERIFY 待测
## VERIFY · 空
## INBOX · 2 · 另有 1 条已完成（见 HISTORY）
…
## HISTORY · 近 7 天 1 条 · 共 1 条
10-17 周六（今天）
  23:00 eba135 勾选完成，体验一下完成动画 ✦ ←FOCUS
## 回收站 · 空
# 生活 [851a21]
…
```

- **列表**：只列未完成的顶层项，每项带完整子树。缩进两格是下一级，`[x]` 是已完成，`#待测` 是原地标为待测的子任务。已完成的顶层项放到 HISTORY，除非它下面还有没完成的子项。顺序和界面一致。
- **HISTORY**：按完成日期分组。`←FOCUS` 是完成时所在的列表，`↑<id>「标题」` 是父项（父项当天没完成时才标）。
- **回收站**：每条一行，写明原列表、删除日期、子项数、原父项。
- **冲突**：每条给出可用的处理操作。
- 参数：
  - `profile`：不填就是全部 profile。
  - `sections`：`focus` / `verify` / `inbox` / `goal` / `history` / `trash` 里的几个。
  - `history_days`：默认 7；0 表示不要；`"all"` 表示全部。
  - `trash`：`"full"` 连子项一起列。
  - `query`：标题含关键字，连同父项和子项一起列出。
  - `format`：`"json"` 返回同样内容的紧凑 JSON。
- 每次都返回 `cursor`，也就是文档当时的版本向量，和模式无关。

**增量读取**：传 `since: <cursor>`，只列出之后变化的条目（实测样例）：

```
FOCUS · 实时（桌面开着，改动立刻显示） · … · 自 c1.cld8qeyyld:c,mkcl0ook7b:2 以来 1 处变化 · cursor c1.cld8qeyyld:c,mkcl0ook7b:3
~ 默认/FOCUS [ ] 300830 收集数据（B 改的） ↳326277（标题）
```

- `+` 新增，`~` 修改（括号里是改了什么），`-` 删除、进回收站或彻底删除。
- 判断依据是记录上各寄存器的戳是否已被 cursor 覆盖，所以"时间较早、但刚同步过来"的改动也不会漏。

### 4.3 `focus_apply`

```json
{
  "profile": "工作",
  "if_unchanged_since": "c1.…",
  "ops": [
    { "op": "add", "title": "写周报", "list": "focus", "ref": "w" },
    { "op": "add", "title": "收集数据", "parent": "$w" },
    { "op": "move", "id": "754d82", "list": "focus" },
    { "op": "reorder", "id": "754d82", "to": "top" },
    { "op": "complete", "id": "eba135" }
  ]
}
```

| op | 参数 | 对应的写入函数 |
| --- | --- | --- |
| `add` | `title`，`list`（默认 inbox）或 `parent`，可选 `profile`、`ref` | `ops.addTodo`；同一批加到同一处的多条按给出的顺序排在最前（再用 `ops.reorderTodo` 排） |
| `rename` | `id`, `title` | `ops.renameTodo` |
| `complete` / `uncomplete` | `id` | `ops.completeTodo` / `uncompleteTodo` |
| `move` | `id`，`list` 或 `parent`（二选一） | `ops.moveTodo` / `ops.reparentTodo`（新增：改挂父项，不能成环） |
| `test` / `untest` | `id` | `ops.markForTest` / `unmarkTest`；VERIFY 的顶层项 `untest` 是退回 FOCUS（`ops.moveTodo`） |
| `reorder` | `id`，`before` / `after` 另一条，或 `to: top\|bottom`，或 `index` | `ops.reorderTodo`；FOCUS 顶层只在聚焦区内或「接下来」内排（跨过去的 `before` / `after` 报错） |
| `focus` / `unfocus` | `id`；`focus` 可选 `to: top\|bottom` 或 `index`（聚焦区里从 0 起，默认排最后） | `ops.focusTodo` / `unfocusTodo`：放进 / 移出 FOCUS 的聚焦区；别的列表、子项会先整棵移进 FOCUS，已完成的恢复；移出后排在「接下来」第一位 |
| `delete` / `restore` | `id` | `ops.removeTodo` / `restoreFromTrash` |
| `profile_create` / `profile_rename` | `name`（可选 `ref`）/ `profile`, `name` | `doc.createProfile` / `updateProfile`；重名报错 |
| `profile_delete` / `profile_restore` | `profile` | `doc.setProfileDeleted`；至少保留一个 |
| `resolve_title` / `keep_all_titles` | `id`, `title` / `id` | `doc.resolveTitle` / `keepAllTitles` |
| `resolve_delete` / `resolve_profile` | `id` 或 `profile`，`choice: restore\|delete` | `doc.resolveDelete` / `resolveProfile` |
| `show` | `profile`、`section`（可选） | 只在实时模式：桌面切到那个 profile / 分区 |
| `collapse` / `expand` | `id` | 只在实时模式：`ops.setCollapsed`，只改本机折叠状态 |
| `sync_now` | — | 只在实时模式：立即同步 |

- 没写 `profile` 时，`add` 加到桌面当前的 profile；其它操作按条目所在的 profile 执行。
- **整批原子**：按顺序在内存里执行，任何一条失败整批都不生效，返回失败的序号和原因，例如找不到 id、有歧义、标题为空、跨 profile、会成环。已经是目标状态的操作（比如完成一条已完成的）不算失败，结果里写明"没变"。
- `if_unchanged_since`：这批操作直接涉及的条目或 profile 如果在这个 cursor 之后被改过（包括用户在界面上改的、其它设备同步来的），整批拒绝，并说明哪条改了什么。
- 返回每条操作的结果（含新条目的 id）和新的 cursor（实测样例）：

```
ok · 实时：桌面已刷新，约 2 秒后同步 · 10 项 · cursor c1.cld8qeyyld:c,mkcl0ook7b:2
1 add → 326277「E2E 写周报」FOCUS
2 add → 300830「收集数据」↳326277
…
5 move 754d82「点右边的 ◎ 按钮，把这条一键送进 FOCUS」→ FOCUS
6 reorder 754d82「点右边的 ◎ 按钮，把这条一键送进 FOCUS」→ FOCUS 第 1 位（共 4）
7 complete eba135「勾选完成，体验一下完成动画 ✦」→ 已完成，移到 INBOX 的已完成
8 profile_create → 生活 [851a21]
```

### 4.4 `focus_purge`

参数是 `ids`（回收站条目）和/或 `empty_trash`（profile 名字，`true` 表示当前 profile），对应 `ops.purgeTrashEntry` / `emptyTrash`。只对回收站里的条目有效：要彻底删掉一条正常的条目，先 `delete` 再 purge，确认分两步。`focus_apply` 里写 purge 会被拒绝。

### 4.5 和桌面界面功能的对照

界面上能对数据做的操作，agent 都能做，而且走的是同一组函数：界面调 store，store 调 `ops.ts`，agent 也调 `ops.ts`。所以结果完全一样，比如 FOCUS 的顶层项完成后移到 INBOX，移进 VERIFY 时回到未完成。

| 界面上的操作 | agent 的写法 |
| --- | --- |
| 顶部输入框新建；`+` 加子任务 | `add`（带 `parent` 就是子任务） |
| 双击改标题 | `rename` |
| 勾选完成、再点取消；HISTORY 里「恢复为未完成」 | `complete` / `uncomplete` |
| INBOX 的 ◎ 送进 FOCUS；VERIFY 的 ◎ 退回 FOCUS；拖到侧栏列表图标；菜单「移到 …」 | `move`（list），VERIFY 退回也可以用 `untest` |
| 烧瓶标为待测、取消待测 | `test` / `untest` |
| 拖拽排序 | `reorder` |
| 拖进 / 拖出聚焦区；`↑` 设为现在；右键「移出聚焦区」 | `focus`（`to: "top"` 等于设为现在）/ `unfocus` |
| 删除；提示条上撤销 | `delete` / `restore` |
| 回收站：恢复 / 彻底删除 / 清空 | `restore` / `focus_purge` |
| profile 新建、改名、删除 | `profile_create` / `profile_rename` / `profile_delete` |
| 冲突面板：选标题、都保留、恢复、保持删除 | `resolve_title` / `keep_all_titles` / `resolve_delete` / `resolve_profile` |
| 切换 profile 和分区、折叠或展开子项、立即同步 | `show` / `collapse` / `expand` / `sync_now`（只在实时模式） |
| 界面没有的：改挂到别的父项下、恢复已删除的 profile | `move`（parent）/ `profile_restore` |

不开放的：
- 提示音、窗口置顶、打开数据文件夹；
- 「已完成」分组的折叠；
- 同步设置（账号、密码、开关、模拟离线）：出于安全不开放。

## 5. 安全

- 实时模式：
  - 只绑 `127.0.0.1`；实测用局域网地址连接被拒绝。
  - 端口随机，每次启动换新令牌；`agent-endpoint.json` 权限 0600，退出时删除。
  - 令牌用常量时间比较。
  - `Host` 头只能是 `127.0.0.1:<端口>` / `localhost:<端口>`，防 DNS 重绑定。带 `Origin` 头的请求一律拒绝，不回任何 CORS 头，网页没法跨站调用。
  - 只接受 `application/json`，请求体上限 1 MB；方法只有 `read` / `apply`。不能读写任意文件，也碰不到同步设置。
  - 设置环境变量 `FOCUS_AGENT=off` 启动桌面版就不开这个接口。
- 坚果云凭证：
  - MCP 进程不读同步设置里的密码，也读不了：`sync-secret.bin` 是 Electron `safeStorage` 加密的。
  - 工具输出里只有"同步：开 / 关、状态、上次同步时间"。
  - 离线模式根本不需要凭证。
- 不可撤销的操作单独放在 `focus_purge` 里，客户端可以要求每次确认。冲突处理和彻底删除在工具描述里写明"只在用户明确要求时使用"。

## 6. 接入

先构建：`npm run build:agent`（`npm run build` 也会一起构建），产物是不依赖 `node_modules` 的单文件 `dist-agent/focus-mcp.mjs`。需要 Node.js 22 以上。

**Claude Code**（对所有项目生效）：

```bash
claude mcp add --scope user focus -- node /Users/xianing/AI_WORK/FOCUS/dist-agent/focus-mcp.mjs
```

或在项目的 `.mcp.json` 里：

```json
{
  "mcpServers": {
    "focus": { "command": "node", "args": ["/Users/xianing/AI_WORK/FOCUS/dist-agent/focus-mcp.mjs"] }
  }
}
```

建议在 `~/.claude/settings.json` 里让读取不用每次确认，写入按习惯决定，彻底删除每次确认：

```json
{ "permissions": { "allow": ["mcp__focus__focus_read", "mcp__focus__focus_apply"] } }
```

**Claude 桌面版**：
- 配置文件位置：macOS 是 `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows 是 `%APPDATA%\Claude\claude_desktop_config.json`。
- Claude 桌面版启动 MCP 时的 PATH 很短，`command` 要写 node 的绝对路径（`which node` 的结果）。

```json
{
  "mcpServers": {
    "focus": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/xianing/AI_WORK/FOCUS/dist-agent/focus-mcp.mjs"]
    }
  }
}
```

要指向别的数据目录（例如测试实例）时，加 `"env": { "FOCUS_USER_DATA": "…" }`。

**命令行**：同一个文件带子命令就是命令行工具，方便脚本和调试：

```bash
node dist-agent/focus-mcp.mjs status
```

```bash
node dist-agent/focus-mcp.mjs read '{"sections":["focus","inbox"],"history_days":0}'
```

```bash
node dist-agent/focus-mcp.mjs apply '{"ops":[{"op":"add","title":"买牛奶"}]}'
```

## 7. 文件

`src/components/` 和 `src/styles.css` 没有改动。

| 文件 | 内容 |
| --- | --- |
| `src/agent/core.ts` | 纯 TS 核心：id 解析、`applyOps`（只调 ops/doc）、快照文本 / JSON、cursor 和增量、提示条文字 |
| `src/agent/bridge.ts` | 渲染进程：响应实时模式的请求、并入 outbox |
| `src/agent/node/` | `main.ts` 入口和命令行、`mcp.ts` 协议（手写，不依赖 SDK）、`tools.ts` 三个工具、`live.ts` 实时模式客户端、`offline.ts` outbox / 身份 / 文件锁、`paths.ts` |
| `electron/agent.cjs` | 主进程：本地 HTTP、令牌、endpoint 文件、监听 outbox、IPC 转发 |
| `electron/main.cjs` / `preload.cjs` / `src/platform.ts` / `src/main.tsx` | 接线 |
| `src/store.ts` | `applyExternal`、`mergePeer`；冲突自动弹出抽成 `promptNewConflicts` |
| `src/sync/engine.ts` / `src/syncDesktop.ts` | `requestUpload()` |
| `src/model.ts` / `src/sync/ops.ts` | `reparentTodo` |
| `vite.agent.config.mts` | 打包成 `dist-agent/focus-mcp.mjs` |

## 8. 测试

### 单元测试（`npm test`，全部 111 个通过）

- `src/agent/core.test.ts`：
  - 新增、ref、子任务、同一批的顺序；每个寄存器都经本机时钟打戳，完成父项时子项是连带改动（`d`）；
  - 不修改传入状态、整批原子；移动、改挂父项、不能成环；待测；排序的四种写法；删除、恢复、彻底删除只能走 purge；
  - id 前缀和歧义；profile 的增删改和恢复；`if_unchanged_since`；标题冲突的读取和两种处理；
  - 界面类操作在离线模式被拒、在实时模式只改折叠状态；提示条文字；
  - 快照文本的格式、过滤、JSON；`since` 增量，包括时钟慢一小时的设备刚同步来的改动。
- `src/agent/node/offline.test.ts`：
  - 没有数据或没迁移时拒绝写；只写 outbox、不碰桌面文件、用 agent 自己的 id 打戳；
  - 桌面并入后 outbox 自动清空；12 次并发写入一条不丢、计数不重号；
  - agent 和桌面并发改同一条标题会变成冲突；换机器换 id；锁的持有者已退出时接管。
- `src/agent/node/mcp.test.ts`：协议版本协商、通知、未知方法和工具、工具出错、批量消息、三个工具的标记。
- `src/model.test.ts`：`reparentTodo`。
- `src/sync/engine.test.ts`：并入本机 agent 的改动后 `requestUpload` 下一轮就上传，处理过一次就不再强制。

### 端到端（2026-10-17）

- 环境：
  - 本机测试服务器 `npm run dev:webdav -- --port 8766 --root <临时目录>`，Vite 开在 5194；
  - 两个测试桌面实例 A、B，各用不同的 `FOCUS_USER_DATA`，都连 8766；
  - 用 Chrome 远程调试协议读两边的 store 和界面文字、截图；
  - 用脚本当 MCP 客户端，起 `dist-agent/focus-mcp.mjs`（`FOCUS_USER_DATA` 指向 A），走真实的 stdio 协议。

| 场景 | 结果 |
| --- | --- |
| `initialize` / `tools/list` | 协议 2025-06-18，三个工具 |
| 实时：一批 10 项（新增带子任务、标待测、INBOX 移到 FOCUS 并排到最前、完成、建 profile 并在里面新增、切到 FOCUS） | MCP 往返 4 ms；A 的界面约 20 ms 出现新条目，弹出提示条；B 约 8.6 秒同步到（B 每 15 秒轮询一次） |
| B 改了一条标题，A 同步到后 `focus_read since` | 只列出这一条：`~ 默认/FOCUS … 收集数据（B 改的）（标题）` |
| 用旧 cursor 带 `if_unchanged_since` 改同一条 | 整批拒绝，说明是标题被改过 |
| 实时：折叠、立即同步、删除、`focus_apply` 里写 purge、`focus_purge` | 只改 A 的本机折叠状态；purge 在 apply 里被拒；`focus_purge` 彻底删除含 2 个子项的条目 |
| 关掉 A 的窗口（进程还在）再写入 | 回 503，自动改走离线 outbox（38 ms） |
| 退出 A | `agent-endpoint.json` 被删除 |
| 桌面没开时 5 个命令行进程同时写入 | 172 ms 全部返回，一条不丢，agent 计数 1～6 不重号；`focus_read` 提示 6 条改动等桌面并入；B 还没有 |
| 重新启动 A | 启动后并入 outbox，界面上出现；B 同步到 |
| A 开着、强制离线写入一条 | A 监听到 outbox 变化，约 0.2 秒后显示；outbox 只剩这一条（之前的已自动清掉）；B 15 秒内同步到 |
| 页面重载期间连续调用 | 第一次回 503、改读磁盘（3 ms），之后马上恢复实时；不会卡到 10 秒超时 |
| 安全检查 | 正确请求 200；不带令牌或令牌错 401；带 Origin、Host 不对 403；GET 或别的路径 404；版本不一致 409；不是 JSON 415；超过 1 MB 413；局域网地址连接被拒绝 |

规模（单元测试环境里临时测的）：3000 条，其中 1500 条未完成，文档 1.8 MB。
- 默认快照：约 3.3 万字符、1100 行，读取 12 ms；
- JSON 格式：约 5.4 万字符；
- 一批 20 项写入：约 0.1 秒（每项都经 `ops.ts` 重新派生一次视图，和界面操作一样）。

没测到的：
- 用真实的 Claude Code 挂上这个 MCP：这台机器上的 `claude` 命令行登录已过期，没跑成。协议已由脚本客户端走真实 stdio 验证；接入配置见第 6 节。
- Windows 上没有实测。

## 9. 以后可以加的

- **无界面同步设备（D）**：
  - 离线模式已经是"agent 自己一台设备"，再加一个 Node 版 WebDAV 传输层、复用 `SyncEngine`，就能在没有桌面的机器上跑（例如云端的 Claude Code 会话）。
  - 要做读写节流，避免抢坚果云额度；凭证用单独生成的应用密码，存在系统钥匙串里。
- **用 App 自带的 Electron 当 Node 跑**：`dist-agent/` 已经加进 electron-builder 的 `files`，打包后可以用 `ELECTRON_RUN_AS_NODE=1` 运行，装了 FOCUS 就不用另装 Node（未实测）。
- Claude 桌面版的一键安装包（`.mcpb`）。
- outbox 现在只在 agent 下一次写入时清理已并入的记录；桌面关掉很久、agent 写了大量改动时，可以考虑让桌面并入后主动清理。
