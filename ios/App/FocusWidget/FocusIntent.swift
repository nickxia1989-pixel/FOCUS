import AppIntents
import WidgetKit

/// 小组件里可以选的空间。除了 App 里的各个空间，还有一项「跟随 App」（默认）：
/// App 切到哪个空间，小组件就显示哪个。
struct ProfileEntity: AppEntity {
    static let followID = "@follow"
    static let follow = ProfileEntity(id: followID, name: "跟随 App")

    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "空间"
    static var defaultQuery = ProfileQuery()

    var displayRepresentation: DisplayRepresentation {
        id == Self.followID
            ? DisplayRepresentation(title: "跟随 App", subtitle: "显示 App 里当前的空间")
            : DisplayRepresentation(title: "\(name)")
    }
}

/// 候选项从 App 写的快照里来，所以 App 至少要打开过一次才列得出各个空间
struct ProfileQuery: EntityQuery {
    func entities(for identifiers: [ProfileEntity.ID]) async throws -> [ProfileEntity] {
        all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [ProfileEntity] {
        all()
    }

    func defaultResult() async -> ProfileEntity? {
        .follow
    }

    private func all() -> [ProfileEntity] {
        let profiles = FocusSnapshot.load()?.profiles ?? []
        return [.follow] + profiles.map { ProfileEntity(id: $0.id, name: $0.name) }
    }
}

struct SelectProfileIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "选择空间"
    static var description = IntentDescription("小组件显示哪个空间的 FOCUS 列表。")

    @Parameter(title: "空间")
    var profile: ProfileEntity?

    /// nil 表示跟随 App
    var pinnedProfileID: String? {
        guard let id = profile?.id, id != ProfileEntity.followID else { return nil }
        return id
    }
}
