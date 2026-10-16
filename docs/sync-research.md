# FOCUS 多端实时同步调研（Windows / Mac / iOS）

> 调研日期：2026-10-16。价格、免费额度、版本号均为当日公开资料，落地前请再到官网核对；出处见文末「参考链接」。
> 本文只做调研与方案设计，没有改动任何应用代码。

## 0. 结论

**能做到。** Windows、Mac、iOS 之间可以做到：在线时秒级同步，离线时照常使用，联网后自动合并。FOCUS 只有几百条数据，单用户、2～4 台设备，性能不是问题。真正的难点是冲突合并规则，第 3 节已逐项理清。

**推荐路线（个人自用）**

1. **同步：自建一个很小的同步服务。**
   - 合并规则：每条 TODO 拆成几个"寄存器"（标题 / 状态 / 位置 / 排序 / 删除），各带一个混合逻辑时钟（HLC）时间戳；合并时逐个寄存器取较新的一份（后写者胜）。
   - 传输：在线时用 WebSocket 实时推送，断线重连后按服务器序号补拉增量。
   - 部署：Cloudflare Workers + Durable Objects（免费档够用），或香港 / 海外的小 VPS。
   - 代码：合并逻辑只写一份 TypeScript，三端和服务器共用。
2. **Mac 版：不需要单独开发。** 现有 Electron 工程在 Mac 上执行 `npm run dist:mac` 就能出包。构建必须在 Mac 上进行；只有想让别的 Mac 直接打开下载来的包时，才需要 $99/年的签名和公证。
3. **iOS：先用 Capacitor 把现有 React 界面包成 App。** 也可以先做零成本的 PWA 验证。两种方式都能直接复用 `model.ts` 和同步代码；以后确实需要桌面小组件、Siri 之类原生能力，再考虑 SwiftUI。

**不想维护服务器时的备选：三端都走坚果云**（详见第 5 节）

- 桌面端把数据文件放在坚果云同步盘里；iPhone 用 WebDAV 直接读写同一个目录。
- 每台设备只写自己的文件，读取时把所有设备的文件按第 3 节的规则合并。
- 优点：国内网络很稳，免费版应该够用，不用维护服务器。
- 代价：不是即时推送，桌面之间秒级到几十秒；iPhone 只在前台时轮询；iOS 必须做成 Capacitor App，PWA 不行。
- 数据层改造（P0）和自建路线完全一样，可以先做 P0，再决定走哪条。

**为什么不选其它路线**

- **坚果云同步 Win ↔ Mac、iCloud 同步 Mac ↔ iOS**：Mac 必须一直开着、开着 FOCUS 当中转；两套同步引擎不能叠在同一个目录；iOS 读 iCloud 文件夹也麻烦。复杂度不低于自建服务器，实时性更差（见 5.1）。
- **Firebase**：技术上最省事，但在中国大陆网络下基本连不上，在 Electron 里登录也有已知问题。
- **CloudKit**：iOS / Mac 上体验最好，但 Windows 只能走 CloudKit JS。它的 Web Services 文档最后修订于 2016 年；Apple ID 网页登录在 Electron 里能否正常工作没有把握；登录状态最长 2 周就要重新登录。
- **iCloud Drive 同步 JSON 文件**：整份文件互相覆盖，冲突时生成副本，不实时，Windows 端尤其不稳。
- **Supabase / PocketBase**：只有在线实时推送，不带离线合并，这套合并逻辑还是得自己写。Supabase 的免费项目闲置 7 天会被暂停。
- **PowerSync（配 Supabase / Postgres）**：唯一在 Electron（JS）、React Native、Swift 三端都有成熟 SDK 的方案，适合将来做原生 SwiftUI 或多人使用。但对一个人的几百条 TODO 来说组件太多（Postgres + PowerSync + 上传接口），免费档闲置一周也会停用。
- **CRDT 库（Automerge / Yjs / Loro）**：能用，但中继服务器、排序和删除规则仍要自己做。Swift 绑定要么停滞（YSwift），要么标注为实验性（loro-swift）。将来如果要支持"任意拖动改父子关系"，Loro 的可移动树是首选备选。
- **其它**：Zero 不支持离线写入；Triplit 已停止开发；Jazz 2 仍是 alpha 且没有 Swift 版；InstantDB 云服务将于 2027 年关闭。

**费用**

- 最低 ¥0：iOS 走 PWA、服务器用 Cloudflare 免费档，只需一个每年几十元的域名。
- 若 iOS 要装成正式 App，再加 Apple 开发者计划 $99/年。

**工作量**：一个人借助 AI 编码，约 3～4 周。

| 阶段 | 内容 | 时间 |
| --- | --- | --- |
| 1 | 数据层改造 | 2～3 天 |
| 2 | 同步服务与桌面端接入 | 4～6 天 |
| 3 | Mac 打包 | 半天～1 天 |
| 4 | iOS（Capacitor） | 5～8 天 |
| 5 | 测试与打磨 | 2～3 天 |

如果 iOS 改走 SwiftUI 原生，总工作量约 5～7 周。

## 1. 现状：现在的数据层离"能同步"还差什么

### 1.1 现有数据层

| 位置 | 作用 |
| --- | --- |
| `src/types.ts` | `Todo`（id / title / done / list / parentId / createdAt / completedAt / order / collapsed / testing）、`TrashEntry`（删除时整棵子树的快照）、`Prefs`、`AppData { version: 1, todos, prefs, trash }` |
| `src/model.ts` | 纯函数：创建、完成（级联子孙，FOCUS / VERIFY 顶层项整棵移到 INBOX）、待测、移动（子孙跟随）、排序、删除、`sanitize` 清洗 |
| `src/trash.ts` | 删除 = 从 `todos` 里拿掉整棵子树并存进 `TrashEntry`；恢复时原父项还在就挂回去，否则回到原列表顶层；30 天过期 |
| `src/store.ts` | zustand；任何改动后防抖 250 ms 把整份 `AppData` 交给主进程 |
| `electron/main.cjs` | 把整份 JSON 原子写入 `userData/focus-data.json`，启动时留 `.bak` 备份 |

数据量很小：几百条 TODO，整份 JSON 通常几十 KB。只有一个用户，设备 2～4 台。这决定了后面的选型：**不需要分片、分页、权限模型，也不需要服务端查询能力**，难点只在"多台设备各自离线改过之后怎么合并"。

### 1.2 对同步不友好的地方

1. **只有整份快照，没有任何"什么时候、在哪台设备改的"信息**。两台设备的 JSON 摆在一起，无法判断谁新。
2. **`reorderTodo` 一次拖拽会改写整组兄弟的 `order`**（在组内重新分配原有的 order 值）。两台设备各拖一次，按行合并的结果会是两边交错，顺序看起来"乱跳"。
3. **`moveTodo` 会同时改根项的 `list / parentId` 和所有子孙的 `list`**，`completeTodo` 会级联改整棵子树的 `done / completedAt / testing`，还可能把根项的 `list` 改成 `inbox`。一个用户动作 = 多行多字段变化。
4. **删除是"物理移除 + 回收站快照"**：条目从 `todos` 消失。别的设备看到"少了一条"时分不清是被删了还是自己还没收到，必须改成带墓碑的软删除。
5. **`sanitize` 的断环结果依赖数组顺序**：同样的数据，数组顺序不同，断开的边可能不同。多设备合并后各自清洗，必须保证结果一致。
6. **`prefs`（当前页签、提示音、已完成分组折叠）和数据混在一个文件里**——这些属于"本机界面状态"，不应同步。

好消息是：`model.ts` 已经是纯函数、有单元测试，`id` 已经是 UUID，`sanitize` 已经有"子项跟随根的列表""孤儿提升为顶层"的自愈逻辑——这些都能直接复用到同步合并里。

## 2. 方案对比

### 2.1 对比表

图例：✅ 好 / 有；⚠️ 有条件或有坑；❌ 不行 / 没有。"国内"指在中国大陆网络下不开代理的可用性（见 6.1）。

| 路线 | Windows（Electron） | iOS | 实时推送 | 离线后合并 | 国内 | 个人使用费用 | 维护状态（2026-10） | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **CloudKit**（Apple 原生 + CloudKit JS） | ⚠️ 只能用 CloudKit JS 2.6.4；Apple ID 网页登录要在 Electron 里实测；令牌 30 分钟 / 最长 2 周 | ✅ 原生最佳 | ⚠️ JS 端只有未文档化的长轮询，可靠做法是轮询变更令牌 | ⚠️ 记录级，需自己写合并 | ⚠️ 大陆账号由云上贵州运营，有开发者报告私有库异常 | 免费（占用户 iCloud 空间），但必须 $99/年开发者账号 | JS 端多年少有更新 | 不推荐：Windows 端是短板 |
| **iCloud Drive 同步 JSON 文件** | ⚠️ iCloud for Windows 仍在更新，但有重复文件、延迟 10 分钟以上的报告 | ⚠️ 需用户选文件夹或 iCloud 容器 | ❌ | ❌ 整文件覆盖 + 冲突副本 | ✅ | 免费 | — | 不推荐 |
| **坚果云 + Mac 中转 + iCloud**（Win —坚果云— Mac —iCloud— iOS） | ✅ 坚果云同步盘 | ⚠️ 只能经 Mac 转写到 iCloud；要原生 / Capacitor 插件读 iCloud 文件夹，PWA 不行 | ❌ Mac 合盖、关机或 FOCUS 没开时，Windows 和 iPhone 互相看不到 | ⚠️ 要先做 P0 改造并改成每设备一个文件 | ✅ | 免费 | — | 不推荐，见 5.1 |
| **全走坚果云**（桌面同步盘 + iOS WebDAV） | ✅ 同步盘 + 监听文件变化 | ⚠️ Capacitor 用原生 HTTP 走 WebDAV；PWA 会被跨域挡住 | ⚠️ 桌面之间秒级到几十秒（待实测）；iPhone 前台轮询 | ✅ 每台设备只写自己的文件，按本文规则合并，不产生冲突副本 | ✅ 国内服务 | 免费版应该够：WebDAV 每 30 分钟 600 次请求；每月上传 1 GB、下载 3 GB（第三方资料） | 坚果云持续运营；合并代码自己维护 | **可行的备选**：不想维护服务器时用，见 5.3 |
| **Firebase Firestore** | ⚠️ JS SDK 能用，但 Electron 非官方支持，弹窗登录有坑 | ✅ Swift SDK，默认离线缓存 | ✅ `onSnapshot` | ⚠️ 离线写入排队，恢复联网后按到达服务器的先后覆盖（不是按编辑时间） | ❌ 基本不可用 | 免费档：每天 5 万读、2 万写，个人绰绰有余 | 活跃 | 若不在大陆、又想最省事，可作为备选 |
| **Supabase**（Postgres + Realtime） | ✅ JS SDK | ✅ 官方 supabase-swift | ✅ Broadcast / Postgres Changes | ❌ 无内置离线，需另配 PowerSync 等 | ⚠️ 未查到可靠资料，需实测 | 免费档够用；闲置 7 天暂停；Pro $25/月 | 活跃 | 不推荐单独使用 |
| **PocketBase**（单文件后端） | ✅ 官方 JS SDK | ⚠️ 只有极小的社区 Swift 包 | ✅ SSE | ❌ 无离线；断线期间的事件不补发 | 取决于部署位置 | 自托管：小 VPS / Fly.io 每月几美元 | 活跃，仍是 0.x | 不如直接自建 |
| **PowerSync**（+ Supabase / Postgres / MongoDB） | ✅ Web / Node SDK | ✅ 纯 Swift SDK 1.16、RN SDK、Capacitor SDK | ✅ | ✅ 本地 SQLite + 上传队列，默认按字段 LWW、删除优先 | ⚠️ 取决于云服务 / 自托管位置 | 免费档闲置一周停用；Pro $49/月起；可自托管 Open Edition | 活跃 | 想要原生 SwiftUI 或多人使用时的首选托管方案 |
| **Automerge 3** | ✅ | ⚠️ automerge-swift 0.7 可用，配套 repo-swift 自 2024-11 未更新 | ✅ 需自建 sync server | ✅ CRDT | 取决于中继位置 | 自托管 | 活跃 | 可行但偏重；列表、树没有 move 操作 |
| **Yjs** | ✅ | ❌ YSwift 自 2024-07 停滞；RN 可用 JS 版 | ✅ Hocuspocus 自托管 | ✅ CRDT | 取决于中继位置 | 自托管；Liveblocks 有免费档 | 活跃 | 偏向协同文本编辑，对 TODO 是大材小用 |
| **Loro** | ✅ | ⚠️ loro-swift 标注实验性 | ✅ Loro Protocol，需自建服务器 | ✅ CRDT，自带**可移动树 + 分数索引排序** | 取决于中继位置 | 自托管 | 很活跃 | 数据模型最贴合；需要"任意改父子"时的首选备选 |
| **TinyBase MergeableStore** | ✅ IndexedDB / 文件持久化 | ⚠️ 无 Swift；Capacitor 有 SQLite 持久化，RN 可用 | ✅ 自带 WebSocket 同步，含 Durable Object 版服务器 | ✅ HLC + 后写者胜，与本文推荐的合并语义几乎相同 | 取决于部署位置 | 自托管 | 活跃（v10） | 推荐方案的"现成实现"候选，见 4.6 |
| **Replicache / Zero** | ✅ | ⚠️ 只有 TS 客户端，RN 可用 | ✅ | ❌ Zero 明确不支持离线写入；Replicache 已进入维护模式 | — | 需 Postgres + zero-cache | Zero 2026-03 正式发布 | 不合适 |
| **ElectricSQL** | ✅ | ❌ 无 Swift | ✅ | ⚠️ 只同步读取，写入走自建 API | — | 云服务 <$5/月免费 | 活跃 | 不合适 |
| **Triplit** | — | — | — | — | — | — | 2025-07 后无发版，创始人已加入 Supabase | 排除 |
| **Jazz** | ✅ | ⚠️ 只有 RN，无 Swift | ✅ | ✅ | — | 有免费额度 | v2 仍是 alpha | 暂不考虑 |
| **InstantDB / Convex** | ✅ | ✅ / ⚠️ | ✅ | ❌ / ⚠️ | — | — | InstantDB 云服务 2027-08 关闭；Convex 离线只缓存在内存 | 排除 |
| **其它**：Evolu / Ditto / RxDB / Couchbase Lite / PouchDB | 均有 JS | 只有 Ditto、Couchbase Lite 有 Swift | — | ✅ | — | Ditto 闭源；RxDB 的 SQLite 存储需付费版（$99/月起） | — | 都不如上面几个合适 |
| ⭐ **自建：WebSocket + 分寄存器 LWW** | ✅ 与现有代码同语言 | ✅ Capacitor / PWA 直接复用；SwiftUI 需移植约几百行 | ✅ | ✅ 规则完全按 FOCUS 的语义定制 | ✅ 部署位置自己选 | ¥0～几十元/月 | 自己维护 | **推荐** |

### 2.2 几个关键判断

- **Windows 端决定了 Apple 系方案不划算。** CloudKit 在苹果设备上是最自然的选择，但 Windows 只能走 CloudKit JS + Apple ID 网页登录：令牌最长 2 周，在 Electron 里能否登录要先做原型验证，推送也只有未文档化的长轮询。而且合并逻辑仍要自己写——CloudKit 只提供记录存储，不负责"字段级合并"。
- **托管后端（Firebase / Supabase / PocketBase）解决的是"存哪儿、怎么推"，不解决"离线后怎么合并"。** 只有 Firestore 自带离线队列，但它按"写到服务器的先后"决定胜负：离线一天的手机一联网，会用旧编辑盖掉桌面上更新的修改。另外它在大陆网络下基本不可用。
- **通用 CRDT 库能解决合并，但 FOCUS 真正需要的规则（排序、软删除、级联完成、子项跟随根）仍然要自己设计。** Swift 端的绑定也普遍不成熟。对几百条 TODO 来说，自己实现"分寄存器 LWW"大约只有几百行代码，还更透明、更好调试。
- **网盘 / 同步盘也能当传输通道，但前提是"每台设备只写自己的文件"。** 同一个文件被多台设备写，网盘只能整份覆盖或者生成冲突副本。每台设备只写自己的文件、读取时由 FOCUS 合并，网盘就只是个搬运工，冲突规则仍按第 3 节。坚果云在国内稳定、有 WebDAV，是这类方案里最合适的（第 5 节）。
- **PowerSync 是唯一"三端成熟 + 托管"的选择。** 如果将来改主意要做原生 SwiftUI、或者给多人用，它是首选托管方案；个人自用阶段不值得引入。

## 3. 冲突分析：按 FOCUS 的数据特点逐项看

先给一个总原则，后面每一项都套用它：

> **把每条 TODO 拆成几个"寄存器"（一组必须一起变的字段），每个寄存器带一个混合逻辑时钟（HLC）时间戳；合并时每个寄存器各自取时间戳大的那份（Last-Writer-Wins）。** 这是一种状态型 CRDT（LWW-Map），合并满足交换律、结合律、幂等，所以不管消息以什么顺序、重复几次到达，所有设备最终一致。

| 寄存器 | 包含字段 | 为什么这样分组 |
| --- | --- | --- |
| `title` | `title` | 独立编辑 |
| `status` | `done`、`completedAt`、`testing` | 这三个必须一起变，分开合并会出现"已完成又待测"的非法组合 |
| `pos` | `parentId`、`list` | 位置；子项的 `list` 视为派生值（见 3.2） |
| `order` | `order` | 手动排序单独一个，拖拽不影响位置寄存器 |
| `del` | `deletedAt`、`purged` | 删除 / 恢复 / 彻底删除 |

`collapsed` 和 `prefs` 默认**只留在本机、不同步**（手机和电脑的展开习惯不同；是否同步 `collapsed` 列为待定问题）。

### 3.1 手动排序 `order`

- **问题**：现在拖一次会给整组兄弟重新分配 order。设备 A 把 X 拖到第 1，设备 B 同时把 Y 拖到第 3，按行 LWW 后组里每一行可能来自不同设备，结果既不是 A 的意图也不是 B 的。
- **做法**：改成**分数索引（fractional indexing）**——每次拖拽**只改被拖那一项**的 `order`，取值为"新位置上下两个邻居之间"的一个字符串 key（例如 Rocicorp 的 `fractional-indexing` 库 `generateKeyBetween(a, b)`）。字符串 key 可以无限细分，不会像浮点数那样对半切几十次后精度耗尽。
- **并发结果**：A、B 拖的是不同项 → 两个改动都生效；拖的是同一项 → 后拖的赢。两台设备恰好算出同一个 key（同时插到同一个空位）→ 用 `id` 打破平局，顺序稳定（`compareTodos` 已经有 `id` 兜底）。
- **注意**：排序方向从现在的"order 越大越靠前"改为"key 字典序越小越靠前"（库的惯例）；"未完成在前"的规则不变，仍然先比完成状态再比 order。

### 3.2 父子树移动（`parentId` / `list` 一起变）

- **子项的 `list` 是派生值**：`sanitize` 已经保证"子项跟随根的列表"。同步时只认**根项**的 `pos` 寄存器，子项的 `list` 一律在合并后重新推导。这样"移动一棵树"在同步层面只写根项一行，避免"A 把父项移到 VERIFY、B 同时给它加子项，子项留在旧列表"这类不一致。
- **环**：现在的操作里 `parentId` 只会在三处变化——创建时设为父项、移到别的列表时置空、从回收站恢复时设回原父项——**不存在"把 X 拖进 Y 当子项"的操作，所以当前不会产生环**。以后如果加"拖进另一项成为子项"（改父），两台设备并发做"X 进 Y""Y 进 X"就会成环；现有 `sanitize` 会断环，但断哪条边取决于数组顺序。**合并后必须先按 `id` 排序再跑清洗**，所有设备才会得到同一结果。如果将来改父操作很多，可以参考 Kleppmann 的树移动 CRDT 或直接用 Loro 的 Movable Tree。
- **孤儿**：A 删除父项 P，B 同时在 P 下加了子项 C。合并后 C 的祖先已删除——按 3.4 的"可见性派生"规则，C 跟着 P 一起出现在回收站里，恢复 P 时 C 一起回来，不丢数据。

### 3.3 完成 / 待测状态

- 完成父项会级联把子孙标为完成：同步层面就是给子孙各写一次 `status` 寄存器（同一个 HLC）。
- **A 完成父项、B 同时在它下面加新子项**：新子项保持未完成——合理，它本来就是在"完成"之后/同时冒出来的新事。
- **A 勾完成、B 同时标待测**：两个动作都写整个 `status` 寄存器，后发生的那个整体获胜，不会出现 `done && testing`。
- **FOCUS / VERIFY 顶层项完成后进 INBOX**：这是同一个动作里同时写 `status` 和 `pos` 两个寄存器（同一个 HLC）。若 B 同时把它拖去了 GOAL，`pos` 按时间先后决定最终在哪个列表，`status` 独立合并——最坏结果是"已完成的项在 GOAL 里"，界面上照样能显示和处理，不是坏数据。

### 3.4 删除、回收站与墓碑

- **软删除**：删除时只在**被删的根项**上写 `del` 寄存器（`deletedAt = now`），子孙不写。条目是否可见由派生规则决定：**自己和所有祖先都没被删，才显示在列表里**。
  - 好处 1：A 删父项、B 同时改子项标题——两个寄存器互不干扰，子项随父项进回收站，标题保留 B 的改动。
  - 好处 2：恢复只需清掉根项的 `deletedAt`，整棵树自然回来；若原父项已不可见（也被删了或已彻底删除），按现在 `restoreEntry` 的规则顺手把根项 `pos` 改成原列表顶层。
- **回收站视图**由数据派生：所有 `deletedAt != null && !purged` 的行就是回收站条目（相当于现在的 `TrashEntry`），各自带上未被单独删除的子孙作为预览。
- **彻底删除 / 30 天过期**：把整棵子树写成墓碑（`purged = true`，同时清空标题等内容只留 `id` 和时间戳）。墓碑必须保留一段时间，否则一台离线很久的设备回来会把它"复活"。墓碑写下之后才同步到的新子项（别的设备离线时加的），因为祖先已是墓碑，按同一条派生规则也视为已彻底删除。
- **墓碑回收**：服务器上墓碑保留例如 180 天后物理删除；若某设备上次同步早于这个期限，服务器要求它**整份重拉**而不是增量合并。
- **"删除 vs 编辑"谁赢**：因为删除在独立寄存器里，任何编辑都不会把条目"复活"；只有显式的"恢复"才会清掉 `deletedAt`。这正好符合直觉。

### 3.5 离线编辑后合并

- 每台设备本地维护一个 HLC：`(墙钟毫秒, 计数器, deviceId)`，编码成可直接按字符串比较的形式。每次本地写入时，墙钟部分取 `max(本机墙钟, 见过的最大 HLC 的墙钟)`，与上一个值相同就把计数器加 1；收到远端数据时把自己的 HLC 推进到不小于对方。这样**即使某台设备时钟慢了几分钟，它离线后做的修改也不会因为"墙钟旧"被无理由覆盖；时钟快的设备也不会永远赢**（服务器可以拒收比服务器时间超前太多的时间戳）。
- 本地改动先落盘并记入"待推送"集合（outbox），联网后批量推送；推送的是**整行当前状态 + 各寄存器时间戳**，重复推送无害（幂等）。
- 因为合并是逐寄存器取大，离线一周的手机回来，不会把桌面上这周的改动整体盖掉，只有"同一条的同一组字段两边都改了"时才有一方被覆盖。

### 3.6 多设备同时改同一条

- 标题：后写的赢，先写的那份丢失。对 TODO 标题这种短文本可以接受；如果介意，可以把被覆盖的旧值留在本地"冲突记录"里一段时间以便找回（可选）。不建议为了标题引入文本 CRDT（Yjs / Automerge 的 Text）——成本远大于收益。
- 其它寄存器同理。因为分了寄存器，"A 改标题、B 勾完成"会同时生效，不算冲突。

### 3.7 小结：FOCUS 的冲突几乎都能用"分寄存器 LWW + 派生规则"解决

真正需要专门处理的只有三件事：**排序改分数索引、删除改软删除 + 墓碑、合并后确定性清洗**。这也是后面推荐"自建轻量同步"而不是引入一整套 CRDT 框架的主要理由——通用框架同样要你自己设计这三件事，只是换了一种写法。

## 4. 推荐方案详解：自建轻量同步（分寄存器 LWW + HLC + WebSocket）

### 4.1 架构示意

```
  Windows / Mac（Electron）                      iPhone（Capacitor 壳，或先用 PWA）
  ┌──────────────────────────────┐              ┌──────────────────────────────┐
  │ React 界面 + zustand          │              │ 同一套 React 界面（移动端布局） │
  │ model.ts（纯函数，已有）       │              │ model.ts（同一份）             │
  │ sync/（HLC·合并·清洗·待推送） │              │ sync/（同一份）                │
  │ focus-data.json（v2）         │              │ 本地存储（文件 / SQLite）       │
  └──────────────┬───────────────┘              └──────────────┬───────────────┘
                 │      wss://sync.你的域名（HTTPS + WebSocket）   │
                 └──────────────────┬─────────────────────────────┘
                                    ▼
                  ┌────────────────────────────────────┐
                  │ 同步服务（几百行 TS，单用户）        │
                  │ Cloudflare Worker + Durable Object │
                  │ 或 香港 / 海外 VPS：Node + SQLite   │
                  │ 表 rows(id, data, stamps, seq)     │
                  │ 逐寄存器取大合并；按 seq 下发增量     │
                  │ WebSocket 把变更广播给其它在线设备   │
                  └────────────────────────────────────┘
```

要点：

- **合并逻辑只有一份 TS 代码**（`src/sync/`），Electron 渲染进程、iOS 端（Capacitor / PWA 跑的是同一份网页）和服务器都 import 它，三端行为天然一致，也能直接写单元测试。
- **服务器不懂业务**，只按寄存器时间戳取大、记序号、转发。所以将来想换部署平台（Cloudflare ↔ VPS）只换外壳。
- **本地仍是第一数据源**：断网照常用，联网后补推补拉。现在的"防抖 250 ms 原子写 JSON"保留。
- **同步是可选的**：不配对就和现在一模一样，纯本地。

### 4.2 数据模型要加 / 要改的字段

```ts
/** HLC 编码成可直接按字符串比较的形式，例如 "0019a3f2c1d40-0003-d7f3a" = 墙钟毫秒(36 进制定长)-计数器-设备 id */
type Hlc = string;

interface Todo {
  id: string;                 // 已是 UUID，不变
  createdAt: number;          // 不变，只读
  // —— 寄存器 title ——
  title: string;
  // —— 寄存器 status（三个字段一起变）——
  done: boolean;
  completedAt: number | null;
  testing?: boolean;
  // —— 寄存器 pos ——
  parentId: string | null;
  list: ListId;               // 子项的 list 为派生值，合并时不参与比较
  // —— 寄存器 order ——
  order: string;              // 由 number 改为分数索引字符串，字典序小的靠前
  // —— 寄存器 del（新增）——
  deletedAt: number | null;   // 软删除时间 = 进回收站；取代 TrashEntry
  purged?: boolean;           // 彻底删除 / 过期后的墓碑，内容清空只留 id
  // —— 同步元数据（新增）——
  stamps: { title: Hlc; status: Hlc; pos: Hlc; order: Hlc; del: Hlc };
  updatedAt: number;          // 最近一次变化的墙钟时间，只用于显示和排查
}

interface AppDataV2 {
  version: 2;
  todos: Todo[];              // 含软删除条目与墓碑；TrashEntry 不再单独存
  prefs: Prefs;               // 只属于本机，不同步（collapsed 是否移入这里见待定问题）
  sync: {
    deviceId: string;         // 首次启动生成，永不改变
    serverUrl: string | null; // null = 未配对，纯本地
    lastSeq: number;          // 已拉取到的服务器序号（增量游标）
    clock: Hlc;               // 本机 HLC 当前值
    dirty: string[];          // 有本地改动、尚未被服务器确认的 todo id
  };
}
```

说明：

- **为什么不用"整行一个 `updatedAt` / 版本号"**：整行 LWW 会让"A 改标题、B 勾完成"互相覆盖。分寄存器后只有真正改了同一组字段才算冲突。`updatedAt` 仍然保留，但只用于显示和排查，不参与合并。
- **为什么不用递增版本号 `rev`**：版本号适合"服务器说了算、客户端提交前先比对"的乐观锁模式，离线编辑后必须处理"提交被拒→重放"。HLC + LWW 不需要服务器裁决，离线更简单。
- **配对密钥不放进 JSON**：Electron 用 `safeStorage`（Windows 走 DPAPI、macOS 走钥匙串）加密保存，iOS 存钥匙串。
- `model.ts` 的纯函数基本不用改签名，只需在"写某个字段"的地方顺手更新对应寄存器的时间戳。建议在 store 层统一做：比较操作前后的每一行，哪组字段变了就给哪个寄存器盖新的 HLC，并把 id 记进 `dirty`。这样 `model.ts` 几乎不碰。
- **`reorderTodo` 必须改**：只给被拖那一项算一个新的分数索引 key（见 3.1）。
- **`trash.ts` 要改写**：删除 = 根项写 `deletedAt`；回收站列表 = 派生视图；恢复 = 清 `deletedAt`（必要时改 `pos`）；彻底删除 / 过期 = 子树写墓碑。

### 4.3 同步协议（草案）

传输用 `wss://`（WebSocket over TLS），所有消息都是 JSON：

| 方向 | 消息 | 内容 / 服务器动作 |
| --- | --- | --- |
| 客户端 → 服务器 | `hello` | `{ deviceId, lastSeq, schema: 2 }`；服务器回 `changes`（所有 `seq > lastSeq` 的行）和服务器时间 |
| 客户端 → 服务器 | `push` | `{ rows: [...] }` 本地 `dirty` 的整行 + 时间戳。服务器对每个寄存器取 HLC 大的那份；真正有变化的行分配新 `seq` |
| 服务器 → 客户端 | `ack` | `{ ids, seq }`；客户端把这些 id 从 `dirty` 移除——只移除推送之后没有再改过的（比对时间戳），否则推送途中的新改动会漏推 |
| 服务器 → 其它在线客户端 | `changes` | `{ rows, seq }` 有变化的行；收到后同样逐寄存器合并 → 确定性清洗 → 刷新界面 → 写盘 |
| 服务器 → 客户端 | `reset` | 客户端的 `lastSeq` 早于墓碑回收期限时，要求整份重拉 |

细节：

- 合并后跑一次**确定性清洗**：按 `id` 排序后执行"孤儿提升 / 断环 / 子项 list 跟随根"（复用 `sanitize` 的逻辑）。清洗只改派生结果、不盖新时间戳，所以各设备各自清洗也不会互相"打架"。
- **时钟保护**：服务器在 `hello` 里回自己的时间；客户端时钟偏差超过 1 分钟时提示用户；服务器拒收比服务器时间超前 5 分钟以上的 HLC。
- **断线重连**：指数退避重连；App 回到前台、网络恢复时立即 `hello`。iOS 进后台后连接会断，回前台再同步即可，TODO 不需要后台实时。
- **服务端存储**：一张表 `rows(id PRIMARY KEY, data TEXT, stamps TEXT, seq INTEGER)` 加 `seq` 索引，几百行数据，SQLite 绰绰有余。
- **可选端到端加密**：因为服务器只需要比较 `id` 和时间戳，各寄存器的值可以在客户端用 AES-GCM 加密后再上传，服务器只看到密文。代价是服务器端没法帮你查数据、排错更难，个人自用可以第二阶段再加。

### 4.4 账号 / 登录

个人自用、只有一个用户，**不建议做账号系统**，用"同步空间 + 设备配对"：

1. 第一台设备在 `⋯` 菜单里「开启同步」，填入服务器地址；服务器创建一个同步空间，返回一个 256 位随机密钥（服务器只存它的哈希）。
2. 其它设备「加入同步」：桌面端显示二维码 / 一串配对码（服务器地址 + 一次性邀请码），手机扫码。服务器为每台设备签发独立的设备令牌，可以在任何一台设备上看到设备列表并吊销丢失的设备。
3. 令牌存 `safeStorage` / 钥匙串。所有请求走 HTTPS / WSS。

以后若要给家人朋友用，再加邮箱验证码或 Sign in with Apple 登录。这一层与同步协议无关，可以后补。

### 4.5 从当前本地 JSON 迁移

1. 读到 `version: 1` 时，先把原文件另存为 `focus-data.v1-backup.json`（现有的 `.bak` 每次启动会被覆盖，不能当迁移备份）。
2. 生成 `deviceId`，把所有寄存器的时间戳初始化为"迁移时刻"的 HLC。
3. `order` 数字 → 分数索引字符串：按现有 `compareTodos` 把每组兄弟（同父、同列表）排好序，用 `generateNKeysBetween(null, null, n)` 一次生成 n 个均匀的 key，保证迁移后顺序不变。
4. `trash` 里的每个 `TrashEntry` → 把 `items` 放回 `todos`（id 已存在的跳过，以在用的为准），根项写 `deletedAt = entry.deletedAt`，`parentId / list` 取条目里记录的删除时位置。
5. `prefs` 原样留在本机；`version` 改为 2，写盘。迁移函数是纯函数，配一组单元测试（拿现在的真实数据文件做样本）。
6. **第一次配对时的合并**：第一台设备把全部行推上去。之后加入的设备如果本地已有数据（例如 Mac 上单独用过一阵），提供两个选项：「合并」（id 都是 UUID，直接取并集）或「以云端为准」（丢弃本机数据，先自动备份）。
7. **上手提示条目会重复**：`seedTodos` 每台设备各生成一份、id 不同，合并后会出现两份。改成固定 id（例如 `seed-1`…`seed-7`），合并时自然去重。

### 4.6 可选的现成实现：TinyBase MergeableStore

TinyBase 的 `MergeableStore` 给每个单元格打 HLC 时间戳、按"后写者胜"合并，本质上就是一个 CRDT。它和 4.2、4.3 的设计几乎同构，而且自带：

- WebSocket 同步器，含一个跑在 Cloudflare Durable Object 上的服务端（`WsServerDurableObject`）；
- IndexedDB、文件、Capacitor SQLite 等持久化适配器。

**代价**：

- 数据层要从"zustand 里的 `Todo[]`"改成 TinyBase 的表结构，或者在两者之间加一层桥接。
- 它按单元格合并，所以"必须一起变"的字段（`status` 那三个）要编码进同一个单元格。
- 删除和墓碑的具体语义需要实测确认。

**建议**：P1 开始时花 1 天做原型。合适就用它代替自写的 HLC、合并和传输层，大约能省 2～3 天；不合适就按 4.3 自写，反正核心只有几百行。

### 4.7 服务器部署

服务端核心是一份与平台无关的 TS 模块，包括合并、序号和墓碑回收；外面套哪种壳都行。

| 选项 | 做法 | 费用 | 优点 | 注意 |
| --- | --- | --- | --- | --- |
| **A. Cloudflare Workers + Durable Objects** | 每个同步空间一个 Durable Object，内置 SQLite；用 WebSocket Hibernation，空闲时不计时长 | 免费档：每天 10 万次请求；收到的 WebSocket 消息按 20 条算 1 次请求，发出的消息免费；5 GB 存储。个人使用 ¥0。付费档 $5/月起 | 零运维；PWA 网页也能放在同一处 | 要绑**自己的域名**。官方不建议生产环境用 `workers.dev` 子域，这类平台子域在大陆的可达性也没有保证 |
| **B. 香港 / 海外小 VPS** | Node + `ws` + SQLite，Caddy 自动签 HTTPS 证书 | 每月几美元；Fly.io 最小规格约 $2.19/月，另加存储卷 | 网络线路可以自己挑，可控 | 要自己维护系统更新和备份。大陆机房的服务器用域名对外提供服务需要 ICP 备案，香港 / 海外机房不需要 |

#### 选项 B 的具体例子：搬瓦工（BandwagonHost）

搬瓦工是常见的海外 KVM VPS，可以直接当 B 用：装 Node 22+，跑同步服务（`ws` + SQLite），前面放 Caddy 自动签 HTTPS 证书。服务进程几十 MB 内存就够，最便宜的套餐也绰绰有余。

**适合的理由**

- 有到大陆的优化线路：洛杉矶 DC6 / DC9 等机房提供 CN2 GIA、CMIN2 等，晚高峰比普通海外 VPS 稳，WebSocket 不容易断线。
- 机房在海外，不需要 ICP 备案，只要一个自己的域名。
- 同步每次只传几 KB，洛杉矶到大陆约 150 ms 的延迟完全够用。没必要为此买贵很多的香港 / 日本 CN2 GIA 套餐。
- 如果手上已经有一台搬瓦工，加一个站点就行，额外成本几乎为零。

**价格（第三方资料，下单前以官网为准）**：没有查到官方的 2026 年完整价目表。

- 电商套餐（CN2 GIA-E）：早先测评为 $49.99/季或 $169.99/年。
- DC9 普通套餐：有网友整理约 $37/年，但联通方向没有优化。

折合人民币：便宜的套餐每年两三百元，带全程优化线路的 CN2 GIA-E 每年一千多元，都比 Cloudflare 免费档贵。

**风险与对策**

1. **IP 被墙**：搬瓦工的 IP 段常被用来翻墙。如果同一台机器上跑着代理，一旦 IP 被墙，同步服务会一起断。被封期间可能不能迁移机房；换 IP 只能暂时缓解，过一阵可能再被封。
   - 同步流量本身是普通的 HTTPS / WSS，不容易触发封锁。
   - 稳妥做法：同步服务不要和代理放在同一个 IP 上。
   - 或者接受偶尔断线：客户端离线照常用，恢复后自动补同步。
2. **运维自理**：系统更新、用 systemd 开机自启、每天导出 `rows` 备份都要自己做；搬瓦工面板的快照可以作为额外一层保险。即使服务器数据丢失，任意一台设备都有完整副本，重新推上去即可。
3. **上线前实测**：在家里宽带、公司网络、手机流量下分别测连接的稳定性和晚高峰延迟。买之前先用 traceroute 确认确实走的是 CN2 GIA（看到 AS4809 / 59.43.x.x 的跳点）。

**建议**：

- 已经有搬瓦工、又主要在大陆网络下使用：直接用它（B），比 Cloudflare 更可控。
- 还没有：先用 A。在常用的网络环境（家里宽带、公司网络、手机流量）各测一下 WebSocket 连接的稳定性和延迟；如果不稳，再换成 B（例如买一台带优化线路的搬瓦工），同一份核心代码只换外壳。

**备份**：每台设备本身都是完整副本，天然多份备份。服务器每天再把 `rows` 导出一份；客户端把现有的 `.bak` 扩展成保留最近 N 天的快照。

### 4.8 iOS 端选型

| 方案 | 复用现有代码 | 和同步方案怎么配合 | 原生能力 | 门槛 / 成本 | 定位 |
| --- | --- | --- | --- | --- | --- |
| **PWA**（Safari「添加到主屏幕」） | 界面和逻辑几乎全部复用 | 同一份 TS 同步代码，走 WebSocket | iOS 16.4 起支持推送；没有小组件和快捷指令；存储空间紧张时可能被系统清理 | 免费；网页需要 HTTPS 托管（可和同步服务放一起） | 零成本验证 |
| ⭐ **Capacitor 8** | 约九成：同一份 Vite 构建产物；在 `platform.ts` 加一个 Capacitor 分支，用 Filesystem 或 `@capacitor-community/sqlite` 存储 | 同上。跑在 WKWebView 里，浏览器 JS 库都能用；PowerSync 和 TinyBase 也有 Capacitor 适配 | 插件提供本地通知、分享等；桌面小组件要另写 Swift 扩展，通过 App Group 共享数据 | 需要 Mac + Xcode；长期安装需要 $99/年 | **推荐** |
| **React Native 0.88 / Expo SDK 58** | 逻辑层（types / model / sync / zustand）可复用；界面要用 RN 组件全部重写 | TS 同步代码可复用；Hermes 没有 IndexedDB，持久化改用 MMKV 或 SQLite | 较好；Expo 的 EAS 云构建可以不用自己的 Mac | 界面重写 2～4 周 | 想要更原生的手感，又不想写 Swift |
| **SwiftUI 原生** | 只能复用设计；`model.ts` 和同步逻辑要移植成 Swift（几百行），或用 JavaScriptCore 直接运行同一份 TS | 自建协议很简单，移植可控；也可以改配 PowerSync Swift SDK | 最好：小组件、Siri / 快捷指令、实时活动 | 3～5 周 | 将来追求极致原生体验时再做 |
| **Tauri 2（iOS）** | 要先把 Electron 主进程换成 Rust | — | 一般 | 桌面端要一起迁移 | 不推荐 |

**移动端界面要改的地方**（Capacitor 和 PWA 都一样）：

- 悬停才出现的按钮（烧瓶、◎、`+`）在触屏上没法悬停，改成常显或左滑操作。
- 右键菜单（`onContextMenu`）改成长按。
- `dnd.ts` 的指针拖拽会和列表滚动抢手势，改成"长按后开始拖"，并配合 `touch-action`。
- 自绘标题栏（最小化、关闭、置顶）在手机上隐藏，改为适配刘海和底部安全区。
- 快捷键不再适用；处理软键盘弹出时的布局。

### 4.9 Mac 版：不需要单独开发

- 现有代码已经照顾到 macOS：保留红绿灯按钮（`hiddenInset`），有让 ⌘C / ⌘V 生效的 Edit 菜单，`build/icon.icns` 已经准备好，`npm run dist:mac` 会生成 dmg 和 zip。
- **构建必须在 macOS 上做**：自己的 Mac，或 GitHub Actions 的 macOS runner。Mac 端的界面和同步代码与 Windows 完全相同，不需要单独开发。
- **只出 arm64 版即可**：macOS 27（2026 年 9 月发布）只支持 Apple 芯片。还要照顾老的 Intel Mac 才需要 universal 包。
- **签名要求（2026 年的现状）**：
  - macOS 15 起取消了"右键 → 打开"这条绕过路径。
  - Apple 芯片上完全不签名的代码根本不能运行。
  - 本机构建的临时签名（ad-hoc）应用可以正常打开。
  - 从网上下载的临时签名应用会被拦截。

  所以个人使用有两个选择：在自己的 Mac 上构建自己用，免费；或者付 $99/年，用 Developer ID 签名并公证。另外，electron-builder 26.15.3 取消了自动回退到临时签名，需要在配置里显式写 `mac.identity: "-"`。
- 可选的 Mac 小增强：菜单栏图标、全局快捷键呼出小窗。

### 4.10 费用估计

| 项目 | 最省 | 常规 |
| --- | --- | --- |
| 同步服务器 | Cloudflare Workers 免费档：¥0 | Workers 付费 $5/月；或香港 / 海外 VPS 每月几美元，带大陆优化线路的（如搬瓦工 CN2 GIA-E）约 $170/年 |
| 域名 | 每年几十元（视后缀而定） | 同左 |
| iOS | PWA：¥0。免费 Apple 账号也能装 Capacitor 版，但每 7 天要重新签名 | Apple 开发者计划 $99/年（含 TestFlight；TestFlight 每个构建可用 90 天） |
| Mac | 在自己的 Mac 上构建：¥0 | Developer ID 签名公证：包含在同一个 $99/年里 |
| **合计** | **每年几十元** | **约 $99/年 + 域名**；如果用 VPS，每年再加几百到一千多元（取决于线路） |

相比之下，托管方案的付费档要贵得多：PowerSync Pro $49/月起，Supabase Pro $25/月起。个人自用阶段用不上。

### 4.11 分阶段工作量

以下按一个人借助 AI 编码估算：

| 阶段 | 内容 | 预估 | 完成标志 |
| --- | --- | --- | --- |
| **P0 数据层改造**（纯本地，可单独发布） | 寄存器时间戳与 HLC；软删除回收站（改写 `trash.ts`）；分数索引排序（改 `reorderTodo`）；v1→v2 迁移；上手提示改用固定 id；单元测试 | 2～3 天 | 用户无感知；旧数据迁移后顺序和回收站内容不变 |
| **P1 同步内核 + 服务器 + 桌面接入** | `src/sync/`（合并、确定性清洗、待推送队列）；服务器（Durable Object 或 Node）；WebSocket 客户端与断线重连；配对和设备管理界面；同步状态指示 | 4～6 天（用 TinyBase 可少 2～3 天） | 两台设备各自离线修改，联网后结果一致 |
| **P2 Mac 版** | 在 Mac 上 `dist:mac`；临时签名或 Developer ID 签名；验证钥匙串存储 | 0.5～1 天 | Mac 与 Windows 实时同步 |
| **P3 iOS（Capacitor）** | 移动端布局与触屏交互；Capacitor 存储分支；钥匙串；真机调试；TestFlight | 5～8 天（先做 PWA：3～5 天；改走 SwiftUI：15～25 天） | iPhone 与桌面双向实时同步，离线可用 |
| **P4 测试与打磨** | 随机化收敛测试：在 vitest 里模拟 3 台设备随机操作、随机断网和乱序投递后比对结果；墓碑回收；导出 / 备份；错误提示 | 2～3 天 | 随机化测试稳定通过 |
| **合计** | | **约 15～20 个工作日（3～4 周）**；SwiftUI 路线 5～7 周 | |

P0 不依赖任何网络功能，可以先做、先发布，也能让现有本地数据结构更健壮。

## 5. 备选路线：全走坚果云（不自建服务器）

已经在用坚果云、又不想维护服务器时，可以用坚果云代替第 4 节的同步服务。冲突规则（第 3 节）、数据模型（4.2）和迁移步骤（4.5）完全不变，变的只是"怎么把数据送到别的设备"。

### 5.1 先排除：Win —坚果云— Mac —iCloud— iOS

设想是 Windows 和 Mac 之间用坚果云同步盘，Mac 和 iPhone 之间用 iCloud。问题有四个：

1. **Mac 要充当中转站。** Windows 和 iPhone 之间的改动必须经过 Mac 上的 FOCUS 在两个目录之间转写。Mac 合盖、关机或 FOCUS 没开时，Windows 和 iPhone 互相看不到对方的改动。
2. **两套同步引擎不能叠在同一个目录上。** 如果把坚果云目录放进 iCloud Drive（或者反过来），两个同步引擎会同时改写同一批文件，容易出现重复、冲突甚至丢失。已有其它同步工具踩过这个坑（见参考链接）。iCloud 的"优化 Mac 存储"还会把文件换成未下载的占位文件。所以只能两边各用一个目录，由 FOCUS 来回复制，又多了一层逻辑。
3. **iOS 读 iCloud 文件夹麻烦。** 需要原生代码或 Capacitor 插件，具体要处理三件事：
   - 让用户在系统文件选择器里选中 iCloud Drive 的文件夹；
   - 保存访问授权（安全作用域书签）；
   - 处理文件还没下载到本机的情况。

   PWA 完全做不到。
4. **不实时。** iOS 只在 App 打开时读一次，后台不会同步。

结论：复杂度不低于自建服务器，实时性还更差，不推荐。

### 5.2 任何"同步盘"方案都要先改的地方

1. **现在的存盘方式会互相覆盖。** FOCUS 只在启动时读一次数据文件，之后每次改动都把内存里的整份数据覆盖写回去。它是常驻小窗，两台桌面通常同时开着，于是：
   - Windows 上改了一条，坚果云把新文件同步到 Mac；
   - Mac 上的 FOCUS 不会重新读文件，内存里还是旧数据；
   - Mac 上一勾完成，旧数据加这一个改动就写回去，Windows 刚才的修改没了。

   **所以当前版本不能直接把数据文件放进同步盘。**
2. **不能用 `FOCUS_USER_DATA` 指向同步盘。** `electron/main.cjs` 用它改的是整个 `userData` 目录，后果有两个：
   - Chromium 的本地存储、缓存、LevelDB 和锁文件默认都在这里，会全部进入同步盘；
   - 窗口位置文件 `window-state.json`、写盘时的 `.tmp` 临时文件、`.bak` 备份也会被同步。
3. **必须做的改动**：
   - P0 数据层改造（4.2）：寄存器时间戳、软删除墓碑。
   - 单独的「同步文件夹」设置：只把同步用的文件放进去，其余文件仍留在本机 `userData`。
   - **每台设备只写自己的文件**，例如 `focus-<deviceId>.json`。同一个文件永远只有一个写入方，网盘就不会产生冲突副本。
   - 监听同步文件夹：要监听整个目录，因为网盘客户端更新文件常常是"删除后新建"或"改名替换"。有外部改动时，读进来按第 3 节的规则合并，而不是直接覆盖。

### 5.3 推荐做法：三端都走坚果云

```
  Windows（Electron）          Mac（Electron）            iPhone（Capacitor）
  只写 focus-<win>.json        只写 focus-<mac>.json      只写 focus-<ios>.json
  读全部 focus-*.json 合并      读全部 focus-*.json 合并    读全部 focus-*.json 合并
          │                          │                          │
     坚果云客户端（同步盘）       坚果云客户端（同步盘）         WebDAV（HTTPS）
          └──────────────┬───────────┴──────────────┬───────────┘
                         ▼                          ▼
              坚果云：FOCUS-sync/ 目录（每台设备一个文件）
```

**文件约定**

- 每个文件都是该设备合并后的完整状态，含时间戳和墓碑。因为合并是幂等的，任何一份文件都是完整副本。
- 退役设备的文件在被其它设备合并过之后可以直接删除。
- `deviceId` 按"安装"生成：不要把整个数据目录拷到另一台机器上用，否则两台设备会写同一个文件。
- 文件名不符合 `focus-*.json` 的一律忽略，例如网盘偶尔生成的冲突副本。

**桌面端（Windows / Mac）**

- 在设置里选一个坚果云同步盘里的文件夹。
- 本地的 `focus-data.json` 照旧按 250 ms 防抖写盘。同步盘里自己那份另外防抖，例如 5～10 秒，而且内容没变就不写，以节省坚果云流量。
- 写同步盘那份时，临时文件不要放在同步盘里：先写到本机 `userData` 再替换过去，避免把 `.tmp` 也同步出去。
- 监听同步文件夹，发现别的设备的文件变了，就读进来合并、刷新界面。

**iPhone（Capacitor）**

- 用 Capacitor 自带的原生 HTTP（`CapacitorHttp`）访问坚果云 WebDAV。原生请求不受浏览器跨域限制。
  - 官方文档没有明确说支持 `PROPFIND` 这类 WebDAV 方法，需要实测。
  - 不支持的话，写一个几十行的 Swift 小插件，用 `URLSession` 发请求即可。
- PWA 走浏览器 `fetch` 会被跨域挡住，所以这条路线下 iOS 必须做成 App。
- 同步流程：
  1. 用 `PROPFIND`（Depth 1）列出目录，比较每个文件的 ETag 或修改时间；
  2. 只 `GET` 变了的文件，合并；
  3. 本机有改动时 `PUT` 自己的文件。
- 只在前台、以及从后台回到前台时轮询，间隔 15～30 秒。
- 账号用坚果云的"应用密码"，不用主密码，存在钥匙串里。也可以在桌面端生成一个二维码让手机扫码填入。

**配额估算**

- **请求次数**：坚果云 WebDAV 免费版每 30 分钟最多 600 次请求，付费版 1500 次。按 20 秒轮询一次算，30 分钟约 90 次 `PROPFIND`，加上少量 `GET` / `PUT`，远低于上限。桌面端走同步客户端，按理不占 WebDAV 次数（推断，需实测）。
- **流量**：第三方资料称免费版每月上传 1 GB、下载 3 GB。每个文件只有几十 KB。按"每次写入的大小 × 写入次数 × 设备数"估算，把同步盘那份的写入间隔拉到 5～10 秒并合并连续改动后，日常使用远低于上限；不够再升级付费版。

**其它**

- **实时性**：桌面之间取决于坚果云客户端的同步速度，估计秒级到几十秒（没找到官方数据，需要实测）。iPhone 在前台时按轮询间隔更新，后台不同步。
- **墓碑回收**：规则同 3.4。如果某台设备长期离线、超过了墓碑保留期，回来时要以其它设备的文件为准、丢弃自己的旧文件，否则已彻底删除的条目会"复活"。
- **账号**：不需要自建账号系统。桌面端选文件夹，iPhone 填坚果云账号和应用密码。
- **隐私（可选）**：数据以 JSON 明文存在坚果云。介意的话可以在客户端用 AES-GCM 加密每个文件，密钥由口令派生。合并全在客户端完成，所以加密不影响同步。

**工作量**（对照 4.11）

| 阶段 | 内容 | 时间 |
| --- | --- | --- |
| P0 | 数据层改造，与自建路线相同 | 2～3 天 |
| P1 | 同步文件夹设置、每设备文件读写、目录监听与合并 | 3～4 天（省掉服务器，比自建的 4～6 天少） |
| P3 | iOS：Capacitor + WebDAV 客户端与轮询 | 5～8 天（PWA 不可行，没有更省的做法） |
| 合计 | | 与自建路线相近，约 3 周 |

### 5.4 与自建服务器对比

| | 全走坚果云 | 自建服务器（第 4 节） |
| --- | --- | --- |
| 运维 | 不用维护服务器 | 要部署和维护 |
| 国内网络 | 很稳，国内服务 | 取决于服务器放在哪里 |
| 实时性 | 秒级到几十秒；iPhone 靠轮询 | 秒级推送 |
| 费用 | 免费版应该够；已有付费版则为零 | 免费（Cloudflare）到每年一千多元（带优化线路的 VPS） |
| iOS | 必须 Capacitor 或原生；PWA 不行 | Capacitor 或 PWA 都行 |
| 依赖 | 受坚果云的请求次数、流量配额和接口变化约束 | 自己完全可控 |
| 以后扩展 | 多人共享、即时推送都难 | 可以逐步加账号、推送 |

**怎么选**

- 已经在用坚果云、不想维护服务器、能接受十几秒的延迟：选坚果云。
- 想要即时推送、想用 PWA 版 iOS、以后可能给别人用：选自建服务器。

两条路线的数据层和合并逻辑是同一份代码，传输层可以后换，甚至可以两种同时开着。

## 6. 风险与待定问题

### 6.1 风险

1. **国内网络可达性**：这是选型里影响最大的外部因素。
   - Firebase（Google）在大陆基本连不上。
   - Supabase 在大陆是否可达没有找到可靠资料。
   - Cloudflare 自定义域名一般能访问，但延迟和稳定性没有保证。
   - 香港 / 海外 VPS 的线路可以自己挑。
   - 大陆机房的服务器用域名提供服务需要 ICP 备案。
   - CloudKit：大陆 Apple ID 的 iCloud 由云上贵州运营，有开发者报告私有库操作失败。

   **落地前务必在实际网络环境里实测。**
2. **自写同步代码的正确性**：合并逻辑出错可能导致数据丢失或"复活"。对策有三：P4 的随机化收敛测试；每台设备保留本地多日快照；在 `⋯` 菜单提供"导出 JSON"。
3. **时钟偏差**：HLC 能避免"时钟快的设备永远赢"。服务器再拒收超前太多的时间戳，客户端在偏差过大时提示。
4. **长期离线的设备与墓碑回收**：设备离线超过墓碑保留期（例如 180 天）后，必须整份重拉，不能增量合并，否则已彻底删除的条目会"复活"。协议里的 `reset` 消息就是为此设计的。
5. **iOS 存储与后台**：PWA 的本地存储在空间紧张时可能被系统清理，尚未推送的离线改动会随之丢失，Capacitor 版更稳。iOS 进入后台后 WebSocket 会断开，回到前台再同步即可。
6. **Apple 相关的持续成本**：$99/年；TestFlight 每个构建 90 天后过期，需要定期重新上传。免费账号每 7 天要重新签名。
7. **安全**：同步密钥泄露就等于数据泄露。全程走 TLS；设备令牌可以吊销；如有需要，再加端到端加密（4.3）。
8. **将来的功能可能改变选型**：
   - "拖进另一项成为子项"（任意改父）：要认真处理环，可考虑 Loro 的可移动树。
   - 多人共享列表：需要正式的账号和权限体系，考虑 PowerSync + Supabase。
   - 桌面小组件 / Siri：需要 SwiftUI 或 Capacitor 加 Swift 扩展。
9. **坚果云路线的外部依赖**（只影响第 5 节）：请求次数、流量配额、WebDAV 接口和应用密码规则都可能调整；流量配额、"桌面客户端不占 WebDAV 次数"、`CapacitorHttp` 能否发 `PROPFIND` 目前来自第三方资料或推断，落地前要实测。

### 6.2 待定问题（需要旅行者决定）

1. **走自建服务器还是全走坚果云？**（第 4 节 / 第 5 节。P0 做完前不必决定。）
2. **设备主要在中国大陆网络下使用吗？** 这决定服务器放 Cloudflare 还是香港 VPS，以及 Firebase 是否彻底排除。
3. **iOS 先做 PWA 还是直接做 Capacitor？** 是否愿意付 $99/年？
4. **子任务的折叠状态（`collapsed`）要不要跨设备同步？** 本文默认不同步，各设备各自记。
5. **需要端到端加密吗？**（自用、服务器自己掌控时可以先不做。）
6. **将来会加"拖进另一项变成子项"吗？**
7. **将来会给别人用或共享列表吗？**
8. **Mac 包在哪里构建？** 自己的 Mac，还是 GitHub Actions？

## 7. 参考链接

**本项目代码**：`src/types.ts`、`src/model.ts`、`src/trash.ts`、`src/store.ts`、`src/platform.ts`、`src/dnd.ts`、`electron/main.cjs`

**Apple / CloudKit / iCloud**

- CloudKit JS 文档：https://developer.apple.com/documentation/cloudkitjs
- CloudKit JS 脚本（2.6.4）：https://cdn.apple-cloudkit.com/ck/2/cloudkit.js
- CloudKit Web Services 修订历史（最后一次 2016-06-13）：https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/RevisionHistory.html
- Web Services 鉴权与令牌有效期：https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html
- API token 与 Allowed Origins：https://developer.apple.com/documentation/cloudkit/obtaining-an-api-token-for-an-icloud-container.md
- `CloudKit.Container`（私有库、通知）：https://developer.apple.com/documentation/cloudkitjs/cloudkit.container.md
- Electron 中 CloudKit 登录失败的报告：https://forum.ionicframework.com/t/cloudkit-capacitor-for-cloud-sync/221243
- 原生 Sign in with Apple 令牌不能代替 ckWebAuthToken：https://developer.apple.com/forums/thread/119159
- 私有库计入用户 iCloud 空间：https://developer.apple.com/tutorials/data/documentation/cloudkit/ckdatabase/scope/private.md
- CloudKit JS 读不到 encryptedValues：https://developer.apple.com/forums/thread/839408
- 中国大陆的 iCloud（云上贵州）：https://support.apple.com/HT208352
- 大陆账号私有库报错（论坛）：https://developer.apple.com/forums/thread/843819
- iCloud for Windows 版本：https://www.macotakara.jp/tag/iCloud/Windows/
- iCloud Drive 在 Windows 上产生重复文件：https://forum.obsidian.md/t/icloud-on-windows-creates-duplicate-files/48358
- iCloud 文档开发指南：https://fatbobman.com/en/posts/in-depth-guide-to-icloud-documents/ 、https://fatbobman.com/en/posts/advanced-icloud-documents/
- Apple 开发者计划：https://developer.apple.com/programs/whats-included/ 、https://developer.apple.com/support/compare-memberships/
- TestFlight：https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview

**Mac 打包与签名**

- electron-builder macOS：https://www.electron.build/docs/mac
- 公证：https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution.md
- macOS Sequoia 收紧 Gatekeeper：https://9to5mac.com/2024/08/06/macos-sequoia-makes-it-harder-to-run-apps-that-dont-follow-apples-security-rules/
- 未公证代码在 macOS 26 上的运行实测（2026-08）：https://eclecticlight.co/2026/08/11/how-can-you-run-code-that-hasnt-been-notarised/
- macOS 27 不再支持 Intel：https://macrumors.com/2026/06/10/macos-golden-gate-last-to-support-intel-apps/
- electron-builder 26.15.3 取消自动临时签名回退：https://github.com/getopenscreen/openscreen/pull/257
- Electron safeStorage：https://www.electronjs.org/docs/latest/api/safe-storage

**托管后端**

- Firestore 配额：https://firebase.google.com/docs/firestore/quotas
- Firestore 价格：https://firebase.google.com/docs/firestore/pricing
- Firestore 离线：https://firebase.google.com/docs/firestore/manage-data/enable-offline
- Firestore 事务离线失败：https://firebase.google.com/docs/firestore/manage-data/transactions
- Firebase 不官方支持 Electron：https://github.com/firebase/firebase-js-sdk/issues/1334 、https://github.com/firebase/firebase-js-sdk/issues/6444
- Firebase 在中国：https://appinchina.co/does-firestore-work-in-china 、https://appinchina.co/does-firebase-work-in-china
- Supabase 价格：https://supabase.com/pricing
- Supabase 免费项目暂停：https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase Realtime：https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- supabase-swift：https://github.com/supabase/supabase-swift/releases
- Supabase 在其他国家被封锁的报道：https://techcrunch.com/2026/02/27/india-disrupts-access-to-popular-developer-platform-supabase-with-blocking-order/
- PocketBase：https://github.com/pocketbase/pocketbase 、https://pocketbase.io/docs/api-realtime/
- Fly.io 价格：https://docs.fly.io/about/pricing
- 搬瓦工电商套餐（CN2 GIA-E）多机房测评：https://blog.wpjam.com/article/bwh-cn2gia-e/
- 搬瓦工机房与线路列表（NodeSeek）：https://www.nodeseek.com/post-571619-1
- 搬瓦工套餐价格讨论（NodeSeek，2026-10）：https://www.nodeseek.com/post-964865-1
- 搬瓦工多机房测评：https://meowvps.com/blog/bwh/
- 海外 VPS 的 IP 被墙与换 IP 讨论：https://www.v2ex.com/t/516025 、https://www.iozoom.com/client/knowledgebase/127/China-Great-Firewall-GFW-block.html
- InstantDB 团队加入 OpenAI：https://www.instantdb.com/essays/instant_team_joins_openai
- Convex 价格：https://www.convex.dev/pricing ；Swift 客户端：https://docs.convex.dev/client/swift

**坚果云 / 同步盘**

- 坚果云 WebDAV 第三方应用说明（含请求频率限制）：https://help.jianguoyun.com/?p=2064
- 坚果云免费版流量（第三方整理，2026-03）：https://www.bilibili.com/read/cv44140398
- 坚果云免费版限制（少数派）：https://sspai.com/post/61072
- 同步工具的数据放进 iCloud Drive 后无法正常同步（DEVONthink 论坛）：https://discourse.devontechnologies.com/t/icloud-drive-shared-folders-and-the-syncstore/54628
- Cryptomator 保险库放在 iCloud Drive 的问题：https://community.cryptomator.org/t/problem-with-icloud-drive/300
- iOS 访问用户选择的目录（安全作用域书签）：https://developer.apple.com/documentation/uikit/providing-access-to-directories.md
- Capacitor 原生 HTTP：https://capacitorjs.com/docs/apis/http
- Electron 的 `userData` / `sessionData` 路径：https://www.electronjs.org/docs/latest/api/app#appgetpathname

**自建相关**

- Durable Objects 价格：https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 价格：https://developers.cloudflare.com/d1/platform/pricing/
- workers.dev 子域说明：https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- Cloudflare 中国网络：https://developers.cloudflare.com/china-network/reference/available-products/
- TinyBase MergeableStore：https://tinybase.org/guides/synchronization/using-a-mergeablestore/
- TinyBase Durable Object 同步服务器：https://tinybase.org/api/synchronizer-ws-server-durable-object/
- HLC 论文（Kulkarni 等）：https://www.cse.buffalo.edu//~demirbas/publications/hlc.pdf
- fractional-indexing：https://github.com/rocicorp/fractional-indexing
- Figma 分数索引：https://www.figma.com/blog/realtime-editing-of-ordered-sequences/
- Kleppmann《A highly-available move operation for replicated trees》：https://martin.kleppmann.com/papers/move-op.pdf
- Kleppmann《Moving elements in list CRDTs》：https://martin.kleppmann.com/papers/list-move-papoc20.pdf

**本地优先 / CRDT**

- Automerge 3：https://automerge.org/blog/automerge-3/ ；冲突语义：https://automerge.org/docs/reference/documents/conflicts/ ；sync server：https://github.com/automerge/automerge-repo-sync-server ；Swift：https://github.com/automerge/automerge-swift
- Yjs Swift 绑定（停滞）：https://github.com/y-crdt/yswift ；Hocuspocus：https://tiptap.dev/docs/hocuspocus/getting-started/overview ；Liveblocks 免费档：https://liveblocks.io/docs/pricing/plans/free ；Jamsocket（Y-Sweet）加入 Modal：https://modal.com/blog/jamsocket-is-joining-modal
- Loro 可移动树：https://loro.dev/docs/tutorial/tree 、https://loro.dev/blog/movable-tree ；loro-swift：https://github.com/loro-dev/loro-swift ；Loro Protocol：https://loro.dev/blog/loro-protocol
- Replicache（维护模式）：https://replicache.dev/ ；Zero 适用场景（不支持离线写）：https://zero.rocicorp.dev/docs/when-to-use ；状态：https://zero.rocicorp.dev/docs/status
- ElectricSQL 写入模式：https://electric.ax/docs/guides/writes ；价格：https://electric.ax/pricing
- PowerSync 价格：https://powersync.com/pricing ；冲突处理：https://docs.powersync.com/handling-writes/handling-update-conflicts ；Swift SDK：https://docs.powersync.com/client-sdks/reference/swift ；Open Edition：https://powersync.com/blog/powersync-open-edition-release
- Triplit 创始人加入 Supabase：https://supabase.com/blog/triplit-joins-supabase
- Jazz：https://jazz.tools/ 、https://jazz.tools/blog/what-we-learned-from-classic-jazz
- Evolu：https://www.evolu.dev/ ；Ditto 价格：https://www.ditto.com/pricing ；RxDB Premium：https://rxdb.info/premium/

**iOS 客户端**

- React Native 版本：https://github.com/facebook/react-native/releases ；0.82 起只有新架构：https://reactnative.dev/blog/2025/10/08/react-native-0.82
- Expo SDK 58：https://expo.dev/changelog/sdk-58 ；EAS Build：https://docs.expo.dev/build/introduction/
- Capacitor 环境要求：https://capacitorjs.com/docs/getting-started/environment-setup ；SQLite 插件：https://github.com/capacitor-community/sqlite
- Tauri 2.12：https://v2.tauri.app/blog/tauri-2.12/
- iOS PWA 限制：https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide 、https://developer.apple.com/forums/thread/710157
