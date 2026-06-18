# Sidebar MiMo-Code 发布阻断问题与修复方案 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Draft / 待评审 |
| 目标版本 | 首个可发布的 `1.0.x` 修复版本 |
| 编写日期 | 2026-06-18 |
| 兼容基线 | MiMo-Code CLI `0.1.1`、Obsidian Desktop `1.7.2+` |
| 发布结论 | 当前版本不满足发布条件；P0、P1 必须全部关闭后才能进入发布候选阶段 |

## 2. 背景与问题陈述

项目已从 SidebarMimocode 多 Provider 架构改造为仅使用 MiMo-Code 的 Obsidian 插件，但当前实现仍存在 MiMo-Code 运行时契约不匹配、历史数据读取错误、测试缺失和重命名残留。

其中，环境变量前缀错误会使插件生成的临时配置无法被 MiMo-Code CLI 加载，直接影响主聊天、内联编辑和标题生成；数据库路径和历史 SQL 错误会造成会话不可恢复或混入子代理消息。因此，当前版本不应发布。

本 PRD 将已发现的问题、修复要求、测试要求和发布门禁合并为一个可执行的整改范围。

## 3. 目标与非目标

### 3.1 目标

1. 使插件与 MiMo-Code CLI `0.1.1` 的环境变量、数据目录、数据库结构和 Agent 目录约定一致。
2. 保证主聊天、内联编辑、标题生成、会话恢复和自定义 Agent 的核心链路可用。
3. 建立 MiMo Provider 的最低必要自动化测试，恢复 CI 可信度。
4. 使默认设置、功能声明、产品命名和发布元数据与实际实现一致。
5. 建立明确的发布门禁，防止未验证的 Provider 改造再次进入发布分支。

### 3.2 非目标

1. 本轮不新增 MiMo-Code 当前未接通的 fork 或 MCP 功能。
2. 本轮不重构整个 Provider 抽象或删除所有历史 SidebarMimocode 内部命名。
3. 本轮不保证兼容 MiMo-Code `0.1.1` 之前的未验证数据库结构。
4. 本轮不修改与 MiMo 集成修复无关的 UI 或交互设计。

## 4. 优先级定义

| 级别 | 定义 | 发布要求 |
| --- | --- | --- |
| P0 | 核心功能不可用或默认路径必然失败 | 必须修复并通过专项测试 |
| P1 | 核心功能在常见场景下错误、数据污染或测试门禁失效 | 必须修复并通过专项测试 |
| P2 | 首次体验、文档、功能声明或发布工程不一致 | 原则上本版本修复；未完成项需显式降级或从发布内容移除 |

## 5. 问题总览

| ID | 优先级 | 问题 | 主要影响 | 发布阻断 |
| --- | --- | --- | --- | --- |
| MIMO-001 | P0 | MiMo-Code 环境变量使用错误前缀 | 临时配置、托管 Agent、系统提示词和 DB 覆盖不生效 | 是 |
| MIMO-002 | P1 | 会话历史查找错误的数据目录和数据库名 | 历史会话无法发现或恢复 | 是 |
| MIMO-003 | P1 | 历史 SQL 未隔离主代理与子代理消息 | 恢复后的消息顺序、角色和内容被污染 | 是 |
| MIMO-004 | P1 | 自定义 Agent 保存和扫描目录错误 | 插件创建的 Agent 无法被 CLI 发现 | 是 |
| MIMO-005 | P1 | 现有测试失效且 MiMo 测试为零 | 改造回归无法被 CI 发现 | 是 |
| MIMO-006 | P2 | 新安装默认模型仍为 Claude `haiku` | 首次启动状态与 MiMo 模型选择不一致 | 否，但需在 RC 前关闭 |
| MIMO-007 | P2 | README 功能声明超过实际能力 | 用户预期与产品行为不一致 | 否，但需修正文档或实现 |
| MIMO-008 | P2 | 产品重命名和发布元数据清理不完整 | UI、开发构建、安装文档和兼容声明不一致 | 否，但需在 RC 前关闭 |

## 6. 详细需求与修复方案

### MIMO-001：统一使用 MiMo-Code 官方环境变量

#### 现状

代码使用 `MIMO_*` 前缀，而 MiMo-Code CLI `0.1.1` 使用 `MIMOCODE_*` 前缀。受影响位置包括：

- `src/providers/mimo/runtime/MimoChatRuntime.ts`：`MIMO_CONFIG`
- `src/providers/mimo/runtime/MimoAuxQueryRunner.ts`：`MIMO_CONFIG`、`MIMO_CONFIG_CONTENT`
- `src/providers/mimo/runtime/MimoRuntimeEnvironment.ts`：`MIMO_DISABLE_CLAUDE_CODE_PROMPT`、`MIMO_DB`
- `src/providers/mimo/runtime/MimoLaunchArtifacts.ts`：读取 `MIMO_CONFIG`
- `src/providers/mimo/runtime/MimoPaths.ts`：读取 `MIMO_DB`
- `src/providers/mimo/settings.ts`：默认 `MIMO_ENABLE_EXA=1`
- `src/providers/mimo/env/MimoSettingsReconciler.ts`：旧变量哈希键
- `src/providers/mimo/ui/MimoSettingsTab.ts`：旧变量说明和示例

关键代码证据：[MimoChatRuntime.ts](../src/providers/mimo/runtime/MimoChatRuntime.ts#L590)、[MimoAuxQueryRunner.ts](../src/providers/mimo/runtime/MimoAuxQueryRunner.ts#L248)、[MimoRuntimeEnvironment.ts](../src/providers/mimo/runtime/MimoRuntimeEnvironment.ts#L4)、[MimoSettingsReconciler.ts](../src/providers/mimo/env/MimoSettingsReconciler.ts#L30)。

#### 影响

插件生成的系统提示词和 `sidebar-mimocode-yolo`、`sidebar-mimocode-safe` 等托管 Agent 配置不会被 CLI 加载。插件随后可能向 ACP 会话选择并不存在的 Agent 模式，导致默认聊天、内联编辑、标题生成或元数据预热失败。数据库覆盖、Exa 开关和禁用 Claude Code 提示词的设置同样不生效。

#### 修复要求

1. 建立集中常量或映射，统一使用以下官方变量：

   | 错误变量 | 正确变量 |
   | --- | --- |
   | `MIMO_CONFIG` | `MIMOCODE_CONFIG` |
   | `MIMO_CONFIG_CONTENT` | `MIMOCODE_CONFIG_CONTENT` |
   | `MIMO_DB` | `MIMOCODE_DB` |
   | `MIMO_ENABLE_EXA` | `MIMOCODE_ENABLE_EXA` |
   | `MIMO_DISABLE_CLAUDE_CODE_PROMPT` | `MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT` |
   | `MIMO_DISABLE_PROJECT_CONFIG` | `MIMOCODE_DISABLE_PROJECT_CONFIG` |

2. 主聊天和辅助查询必须复用同一套环境变量构造逻辑，避免再次出现两套命名。
3. 更新设置默认值、设置说明、placeholder、环境哈希和启动 key。
4. 对已有设置仅迁移上述已知键，不得全局替换所有 `MIMO_*`，以免破坏 `MIMO_API_KEY` 等有效业务变量。
5. 如果新旧键同时存在，以 `MIMOCODE_*` 为准，并在迁移后移除对应旧键。

#### 验收标准

1. 启动主聊天进程时包含 `MIMOCODE_CONFIG`，且不再注入 `MIMO_CONFIG`。
2. 内联编辑和标题生成进程包含 `MIMOCODE_CONFIG` 与 `MIMOCODE_CONFIG_CONTENT`。
3. `sidebar-mimocode-yolo`、`sidebar-mimocode-safe`、`plan` 以及内部辅助 Agent 能被 ACP 会话发现和选择。
4. `MIMOCODE_DB=:memory:` 可用于模型元数据预热；绝不创建磁盘 DB。
5. 设置页默认显示 `MIMOCODE_ENABLE_EXA=1`，示例使用 `MIMOCODE_DB`。
6. 单元测试覆盖环境变量构造、旧设置迁移、键优先级和主/辅助进程一致性。

### MIMO-002：修正 MiMo-Code 数据目录与数据库名

#### 现状

`MimoPaths.ts` 使用应用目录 `mimo`、数据库 `mimo.db` 和 `MIMO_DB` 覆盖变量。MiMo-Code `0.1.1` 的默认数据目录为 `mimocode`，数据库名为 `mimocode.db`，覆盖变量为 `MIMOCODE_DB`。

关键代码证据：[MimoPaths.ts](../src/providers/mimo/runtime/MimoPaths.ts#L5)。

#### 修复要求

1. 将默认应用数据目录改为 `mimocode`。
2. 将默认数据库名改为 `mimocode.db`，候选文件规则同步改为 `mimocode*.db`。
3. 在 Linux 和本机默认路径下解析 `~/.local/share/mimocode/mimocode.db`。
4. 保留 XDG、macOS 和 Windows 的平台目录解析，但所有平台均使用 `mimocode` 作为应用子目录。
5. 优先处理 `MIMOCODE_DB`：支持 `:memory:`、绝对路径和相对数据库文件名。
6. 不应自动创建或优先选择旧的 `mimo/mimo.db`；如需兼容旧插件数据，只能作为显式迁移逻辑并记录日志。

#### 验收标准

1. 无覆盖变量时，Linux 路径解析结果为 `~/.local/share/mimocode/mimocode.db`。
2. XDG、macOS、Windows 和 `:memory:` 场景均有单元测试。
3. 会话列表和恢复流程读取 MiMo-Code 实际数据库，而非新建空数据库。
4. 自定义 `MIMOCODE_DB` 能同时被历史读取器和 ACP 运行时使用。

### MIMO-003：历史读取仅保留主代理消息

#### 现状

`MimoSqliteReader.ts` 的消息 SQL 仅按 `session_id` 查询。MiMo-Code `0.1.1` 的 `message` 表包含 `agent_id`，默认主代理值为 `main`。使用子代理后，同一 session 下会存在非主代理消息。

关键代码证据：[MimoSqliteReader.ts](../src/providers/mimo/history/MimoSqliteReader.ts#L256)。

#### 修复要求

1. 主消息查询必须增加 `agent_id = 'main'` 条件。
2. part 查询必须 join `message` 表并使用同一 `agent_id = 'main'` 条件，避免返回孤立的子代理 part。
3. 保持主代理消息按 `time_created, id` 稳定排序。
4. 明确以 MiMo-Code `0.1.1` 数据库结构为兼容基线；若未来需要兼容无 `agent_id` 的旧结构，应通过 schema 探测实现，不得通过捕获所有 SQL 错误静默降级。

#### 验收标准

1. 混合 `main` 和子代理消息的 fixture 只恢复 `main` 消息及其 parts。
2. 多个子代理并行产生消息时，主会话角色和顺序保持正确。
3. 不存在子代理时，恢复结果与修复前一致。
4. node:sqlite 主路径与 CLI fallback 路径执行相同的过滤逻辑。

### MIMO-004：修正自定义 Agent 存储路径

#### 现状

`MimoAgentStorage.ts` 保存和扫描 `.mimo/agent`、`.mimo/agents`，而 MiMo-Code 扫描 `.mimocode/agent` 和 `.mimocode/agents`。

关键代码证据：[MimoAgentStorage.ts](../src/providers/mimo/storage/MimoAgentStorage.ts#L11)。

#### 修复要求

1. 默认保存目录改为 `.mimocode/agent`。
2. 扫描目录改为 `.mimocode/agent` 和 `.mimocode/agents`。
3. 读取时可临时兼容旧 `.mimo/*` 目录，但新建和编辑后的文件必须写入 `.mimocode/*`。
4. 为旧 persistence key 提供一次性兼容解析；不得因路径迁移导致已保存 Agent 无法编辑或删除。
5. 同名 Agent 的覆盖优先级必须确定且有测试，建议 `.mimocode/agent` 优先于兼容旧目录。

#### 验收标准

1. 插件创建 Agent 后，MiMo-Code CLI 能在同一 Vault 中发现该 Agent。
2. `.mimocode/agent` 与 `.mimocode/agents` 中的合法 Markdown Agent 均可加载。
3. 旧 `.mimo/*` Agent 可读取并迁移，且不会产生重复项或误删源文件。
4. 保存、重命名、删除、同名去重和 persistence key 均有单元测试。

### MIMO-005：恢复测试套件并建立 MiMo 覆盖

#### 现状

仓库当前共有 103 个 `*.test.ts` 文件，但没有文件路径或测试内容包含 MiMo。`defaultProviderConfigs.test.ts` 仍断言 `claude`、`codex`、`opencode`、`pi` 存在，而生产代码只返回 `mimo`，该测试必然失败。

关键代码证据：[defaultProviderConfigs.test.ts](../tests/unit/providers/defaultProviderConfigs.test.ts#L8)、[defaultProviderConfigs.ts](../src/providers/defaultProviderConfigs.ts#L4)。

#### 修复要求

1. 更新 `defaultProviderConfigs.test.ts`：只断言内建 `mimo` 配置存在、每次返回新对象且嵌套可变字段不会共享引用。
2. 为以下模块新增专项测试：
   - `MimoRuntimeEnvironment`
   - `MimoLaunchArtifacts`
   - `MimoPaths`
   - `MimoSqliteReader`
   - `MimoHistoryStore`
   - `MimoAgentStorage`
   - `MimoChatRuntime` 启动环境与模式选择
   - `MimoAuxQueryRunner` 启动环境与辅助 Agent
   - MiMo 默认设置和 capabilities
3. 增加一条可重复的 ACP 集成烟测：使用可控 fake process 或 fixture 验证 initialize、session/new、mode、prompt、cancel 和 resume 的最小链路。
4. 不以删除旧测试来换取通过率。仍适用于共享层的测试应保留；只移除无法再触达且明确属于已删除 Provider 的测试。

#### 验收标准

1. `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 全部通过。
2. MiMo P0/P1 每个问题至少有一个修复前失败、修复后通过的回归测试。
3. CI 在干净环境中安装依赖并运行上述四项命令。
4. 测试失败不得通过 `--passWithNoTests`、skip 或降低断言规避。

### MIMO-006：修正首次启动默认模型

#### 现状

`defaultSettings.ts` 仍将全局默认模型设置为 `haiku`，而唯一 Provider 为 MiMo。

关键代码证据：[defaultSettings.ts](../src/app/settings/defaultSettings.ts#L5)。

#### 修复要求

1. 新安装默认模型使用 MiMo 合成模型 ID `mimo`，或从 MiMo Provider 的单一默认常量派生。
2. 默认值不得在 app 层硬编码另一个 Provider 的模型名。
3. 迁移已有设置时：保留合法 MiMo 选择；仅将未配置或确认属于遗留 Claude 默认值的 `haiku` 转为 `mimo`。

#### 验收标准

1. 全新配置首次打开时，模型下拉框、保存设置和实际 ACP 模型状态一致。
2. 不再向 MiMo runtime 传递 `haiku`。
3. 已有用户的有效 MiMo 模型选择不被覆盖。

### MIMO-007：使功能声明与 capabilities 一致

#### 现状

`capabilities.ts` 明确设置 `supportsFork: false`、`supportsMcpTools: false`，对应 runtime 方法也未实现；README 却宣称支持 fork、MCP Servers 和 MCP `@mention`。

关键代码证据：[capabilities.ts](../src/providers/mimo/capabilities.ts#L3)、[README.md](../README.md#L13)。

#### 修复要求

1. 本轮采用“按实际能力修正文档”的方案：从 README 的当前功能列表中移除 fork、MCP Servers 和 MCP `@mention` 声明，或明确标记为暂不支持。
2. UI 必须遵循 capability gating，不展示无法执行的 fork/MCP 入口。
3. 后续如需启用能力，必须先实现 runtime、存储/配置、错误处理和自动化测试，再修改 capabilities 与文档。

#### 验收标准

1. README、设置页、命令菜单和实际功能无冲突。
2. MiMo 会话中不显示 fork 或 MCP 管理入口。
3. 自动化测试验证 capability 为 false 时相关入口不可见或不可调用。

### MIMO-008：完成产品重命名与发布元数据清理

#### 现状

当前存在以下不一致：

- Ribbon 文案仍为 `Open SidebarMimocode`。
- 开发构建仍复制到 `.obsidian/plugins/sidebar-mimocode`。
- README 使用 `obsidian-mimo` 仓库名、目录名和 clone 地址。
- `AGENTS.md` 仍描述 Claude/Codex 多 Provider 架构。
- i18n 多语言文案仍大量面向 SidebarMimocode、Claude 和 Codex。
- `versions.json` 中 `1.0.0` 的最低 Obsidian 版本为 `1.0.0`，与 `manifest.json` 的 `1.7.2` 不一致。
- `package.json`、`manifest.json`、README 和仓库名未采用同一命名规范。

关键代码证据：[main.ts](../src/main.ts#L65)、[esbuild.config.mjs](../esbuild.config.mjs#L127)、[README.md](../README.md#L34)、[versions.json](../versions.json#L1)、[manifest.json](../manifest.json#L1)。

#### 修复要求

1. 采用统一命名：
   - 产品显示名：`Sidebar MiMo-Code`
   - Obsidian 插件 ID：`sidebar-mimocode`
   - 仓库和安装目录：`sidebar-mimocode`
2. Ribbon、命令、设置页、README、manifest 和构建复制目录使用统一名称。
3. 重写根 `AGENTS.md`，以当前 `src/providers/mimo` + ACP 架构为准。
4. 清理所有用户可见 i18n 文案；短期无法提供完整翻译时，至少保证英文和简体中文正确，其他语言不得继续展示错误的 Provider 名称。
5. 将 `versions.json` 中当前发布版本的最低 Obsidian 版本改为 `1.7.2`，并确保后续由同步脚本校验。
6. 审核 `.github/workflows/claude*.yml`：如果 Claude Code 仍作为仓库开发自动化工具使用，可保留但应明确它不代表运行时 Provider；如果未使用，则删除。不得仅因文件名包含 Claude 就盲目删除有效 CI。
7. 内部类名、CSS 前缀等非用户可见 `SidebarMimocode` 遗留可登记为后续技术债，但不得继续出现在用户界面、发布文件路径或架构说明中。

#### 验收标准

1. `rg -n "Open SidebarMimocode|plugins[/\\]sidebar-mimocode|obsidian-mimo"` 在发布相关文件中无命中。
2. README 的 clone 地址、目录名和插件安装目录均指向 `sidebar-mimocode`。
3. 开发构建复制到 `.obsidian/plugins/sidebar-mimocode`。
4. `versions.json[manifest.version] === manifest.minAppVersion`。
5. 用户可见英文、简体中文界面不再出现 Claude、Codex 或 SidebarMimocode 的错误描述。

## 7. 实施顺序

### 阶段 A：运行时阻断修复

1. 完成 MIMO-001 环境变量统一与设置迁移。
2. 完成 MIMO-002 数据库路径修复。
3. 为以上修复先补失败测试，再修改实现。
4. 运行主聊天、内联编辑和标题生成烟测。

### 阶段 B：历史与 Agent 正确性

1. 完成 MIMO-003 主代理消息过滤。
2. 完成 MIMO-004 Agent 路径与迁移。
3. 使用含主代理和子代理消息的真实结构 fixture 验证恢复。

### 阶段 C：测试与首次体验

1. 完成 MIMO-005 测试套件修复和 MiMo 覆盖。
2. 完成 MIMO-006 默认模型修复。
3. 全量运行 typecheck、lint、test、build。

### 阶段 D：发布一致性

1. 完成 MIMO-007 文档与 capabilities 对齐。
2. 完成 MIMO-008 重命名和版本元数据清理。
3. 在干净 Vault 中执行发布候选版本验收。

## 8. 验证矩阵

| 场景 | 预期结果 | 自动化要求 |
| --- | --- | --- |
| 全新安装并首次打开 | Provider、模型、模式均为有效 MiMo 值 | 单元测试 + 手工烟测 |
| 默认聊天 | 可创建 ACP session、发送并流式返回 | ACP 集成烟测 |
| Safe / YOLO / Plan 模式 | 对应托管 Agent 可发现、可切换 | 单元测试 + 集成烟测 |
| 内联编辑 | 辅助配置与 Agent 被加载，返回可应用结果 | 集成烟测 |
| 自动标题 | 无工具辅助 Agent 可加载并返回标题 | 集成烟测 |
| 会话恢复 | 从 `mimocode.db` 恢复主代理消息 | SQLite fixture 测试 |
| 含子代理的会话恢复 | 不混入非 `main` 消息和 part | SQLite fixture 测试 |
| 自定义 Agent | CLI 可发现插件创建的 Agent | 存储单测 + 手工烟测 |
| 自定义 DB | `MIMOCODE_DB` 同时影响 runtime 与 history | 单元测试 |
| 开发构建复制 | 输出到 `plugins/sidebar-mimocode` | 构建脚本测试或 CI 断言 |
| 发布包安装 | `main.js`、`manifest.json`、`styles.css` 可直接启用 | 手工 RC 验收 |

建议至少在 Windows、macOS、Linux 各完成一次启动和会话恢复烟测；如果发布前无法覆盖全部平台，应将未验证平台明确标注为风险，而不是默认视为通过。

## 9. 发布门禁

满足以下全部条件后，版本才可进入 Release Candidate：

1. MIMO-001 至 MIMO-005 全部关闭，且对应回归测试已合入。
2. MIMO-006 至 MIMO-008 已关闭，或相关功能/声明已从发布范围移除。
3. `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 在干净环境和 CI 中全部通过。
4. 使用 MiMo-Code CLI `0.1.1` 完成默认聊天、Safe/YOLO/Plan、内联编辑、标题生成和历史恢复烟测。
5. 使用包含子代理消息的数据库验证恢复结果无污染。
6. 使用 `.mimocode/agent` 创建 Agent，并确认 CLI 可发现。
7. Git 工作区只包含计划内修改，发布产物与 `manifest.json` 版本一致。
8. README 功能列表与 `MIMO_PROVIDER_CAPABILITIES` 一致。

## 10. 风险与回滚

| 风险 | 缓解措施 | 回滚方式 |
| --- | --- | --- |
| 用户设置中同时存在新旧环境变量 | 白名单迁移，官方键优先，保留迁移前备份 | 恢复原设置并移除迁移标记 |
| Agent 目录迁移造成重复或丢失 | 先读后写、同名去重、迁移测试，不自动删除旧文件 | 恢复扫描旧目录，保留新目录文件 |
| 数据库 schema 随 CLI 升级变化 | 将 `0.1.1` 设为已验证基线，并增加 schema 错误诊断 | 限制支持版本并提示用户降级 CLI |
| 修复默认模型覆盖用户选择 | 只迁移空值或明确的遗留 `haiku` | 恢复用户原始 `savedProviderModel` |
| 文档降级后功能吸引力下降 | 明确列为后续路线图，不提前宣称未实现能力 | 无代码回滚；仅在功能完成后恢复声明 |

## 11. 后续技术债

以下事项不阻断本轮修复，但应建立独立任务：

1. 将 `SidebarMimocodePlugin`、`DEFAULT_SIDEBAR_MIMOCODE_SETTINGS`、`.sidebar-mimocode` 存储名和 CSS 前缀逐步迁移为中性或 MiMo 命名。
2. 评估 fork 的 ACP 支持方式并补齐 conversation/session 语义。
3. 评估 MiMo-Code 原生 MCP 配置与插件内 MCP 管理的边界，避免重复配置源。
4. 建立 MiMo-Code CLI 版本兼容矩阵和自动化契约测试。
5. 为数据库 schema、ACP capabilities 和 Agent 加载路径增加启动时诊断信息。

## 12. 核对依据

本 PRD 基于以下证据形成：

1. 当前仓库 `main` 分支源码与测试（HEAD `7f323c6`）。
2. 本机安装的官方 npm 包 `@mimo-ai/cli@0.1.1`，其 package metadata 指向 [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code)。
3. 本机 CLI `mimo --version` 返回 `0.1.1`。
4. CLI 二进制包含 `MIMOCODE_CONFIG`、`MIMOCODE_CONFIG_CONTENT`、`MIMOCODE_DB`、`MIMOCODE_ENABLE_EXA`、`MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT`、`MIMOCODE_DISABLE_PROJECT_CONFIG`、`mimocode.db`、`.mimocode/agent` 和 `.mimocode/agents` 定义。
5. 本机数据库位于 `~/.local/share/mimocode/mimocode.db`；`message` 表包含 `agent_id text not null default 'main'`。
6. 当前测试目录包含 103 个测试文件，MiMo 专项测试为 0。

> 注意：MiMo-Code 后续版本可能改变上述契约。升级 CLI 支持范围时，必须重新执行契约核对和回归测试，不能仅依据 `0.1.1` 的结论外推。
