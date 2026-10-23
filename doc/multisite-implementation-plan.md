# 多站点动态捕获与通用 AI 任务创建实现计划

> 状态：待实施。实施依据：[需求和落地方案](./dynamic-capture-design.md)。本计划按可独立验证的交付拆分；友盟真实接口与 Mac WebView 文件上传能力必须实测，不能用猜测的接口宣称完成。

**目标：** 把现有 BugDone 专用脚本演进为可配置多站点捕获工作台，同时保留通用 Multica 任务创建、查重、附件和处理列表；首批支持 BugDone 与经接口验证的友盟 APM，并提供任意网页的手动可见内容捕获。

**架构：** 站点 profile 只声明页面、响应与提取规则；捕获运行时把命中内容归一为 `CapturedRecord`，再生成可编辑的 `TaskDraft`。任务创建服务只读取最终草稿和稳定 `sourceKey`，不认识 BugDone 或友盟字段。站点写入动作独立，默认关闭。

**技术栈：** 原生 JavaScript 用户脚本、Node.js 内置测试运行器、Tampermonkey、FastlaneTool Mac WebView。发布物仍是单个 `bugdone-multica.user.js`，不引入运行时依赖。

**核心数据契约：** `CapturedRecord` 至少含 `siteId/scopeId/recordId/pageKind/sourceUrl/title/descriptionBlocks/attachments/logs/fieldSources/capturedAt/completeness`；`TaskDraft` 至少含 `sourceKey/title/description/attachments/workspaceId/projectId/agentId/status/priority/labelIds/dates`。`sourceKey` 用站点、范围和记录 ID 的长度前缀编码生成，避免分隔符碰撞；用户可见的搜索标记由该键生成，业务标题和正文在第一栏组装。

## 全局约束

- 保留现有 BugDone 列表/详情捕获、`[BugDone:<BugId>]` 查重、状态同步、100 条处理记录与 WebView 网络桥兼容。
- 未配置站点不监听网络；配置不能包含可执行 JavaScript、Cookie、Token、任意请求头或任意写接口。
- 页面路由与网络接口分别配置；响应必须同时满足当前站点、方法、精确路径、大小及结构条件才可提取。
- 第二栏的标题和描述按用户最终编辑值提交；来源身份另存为只读元数据。Multica 当前搜索会查标题与描述，因此捕获草稿须在用户可见的来源段落中放入稳定标记；若用户把它从标题和描述都删掉，应在提交前提示无法做跨浏览器强查重并阻止自动创建，不能暗中回填正文。
- 附件必须真正上传并以 `attachment_ids` 关联；原始外链只能作来源提示，不能声称智能体可以读取。
- 测试夹具、截图、README 和配置导出只用合成或脱敏数据。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/profiles/schema.js` | 配置校验、版本迁移、权限差异与 URL/路径匹配 DSL |
| `src/profiles/bugdone.js` | 内置 BugDone 配置、响应映射、旧数据/标题兼容 |
| `src/profiles/umeng.js` | 接口验证前禁用的友盟配置；实测后填入具体规则 |
| `src/capture/runtime.js` | XHR/fetch 只读观察、SPA 路由变化、隔离世界消息校验 |
| `src/capture/record.js` | 标准记录、列表与详情归并、来源与完整度 |
| `src/capture/draft.js` | 有限模板、描述段落、来源键、手动可见内容快照 |
| `src/task/submit.js` | 通用查重、待确认恢复、上传后创建、任务状态 |
| `src/task/attachments.js` | 本地与源站附件 item、上传队列、失败处理 |
| `src/ui/` | 信息捕获、任务创建、处理列表、配置编辑和诊断视图 |
| `scripts/build.cjs` | 将源码构建成单个用户脚本并校验元数据 |
| `test/fixtures/` | BugDone 与友盟的合成列表、详情、日志样本 |
| `test/*.test.cjs` | 纯逻辑、构建、提交和 UI 状态回归测试 |
| `bugdone-multica.user.js` | 唯一安装产物；构建生成，不手工维护双份逻辑 |

文件组织可在首个拆分提交中微调，但模块职责与单文件发布物必须保持。FastlaneTool 的原生桥代码属于另一个仓库，应另行提交并与用户脚本做联调。

## 审查重点

1. 两个不同应用或记录 ID 的响应交错到达：不得把日志、附件或详情合到错误任务。
2. 本地关联任务不可访问、搜索失败或创建超时：不得再次盲目 POST。
3. 站点配置导入扩大域名或监听范围：默认禁用，展示差异后才能启用。
4. 长日志、HTML 与重定向附件：不得静默截断、执行脚本或把认证信息导出。
5. Mac WebView 没有 `GM_*`：连接、上传与错误回显仍有明确通道和状态；不允许网页传任意本地绝对路径。

## 阶段 0：固定 BugDone 基线

- [ ] 用合成 BugDone 列表、详情、带图片详情、空描述详情固定当前 `parseResponse`、合并、草稿、查重和状态同步行为；加入 WebView 无 `GM_*` 的通道选择测试。
- [ ] 运行 `npm run check && npm test`，记录通过的测试数；在 Ego Lite 验证 BugDone 列表、详情和现有四栏 UI。
- [ ] 提交基线测试与夹具。此阶段不得改网络接口与任务创建语义。

## 阶段 1：站点配置与标准记录

- [ ] 测试 `validateProfile(profile)`：接受版本化声明式规则；拒绝未知字段、脚本字符串、跨源网络规则、非法 URL、宽泛通配和无稳定 ID 的自动捕获。
- [ ] 实现 `matchPage(profile, url)` 与 `matchCapture(profile, {url, method, contentType, bytes})`；路径 DSL 的 `*`、`:param` 有明确边界和转义，页面路由不作为网络路径。
- [ ] 测试 `normalizeRecord(profile, payload, context)` 与 `mergeRecord(old, next)`：`{siteId, scopeId, recordId}` 是唯一键，详情非空字段优先；乱序列表不能抹掉详情。
- [ ] 将 BugDone 迁为内置 profile，保持旧标题、分享 URL、手动 JSON 导入和已提交本地记录可用；禁用友盟占位 profile 的自动捕获。
- [ ] 通过 `npm test`、BugDone Ego Lite 回归和 Mac WebView 启动回归后提交。验收：BugDone 行为不退化，其他站点无自动监听。

## 阶段 2：通用捕获界面与草稿

- [ ] 测试 `buildDraft(record, profile)`：模板缺字段时报告缺失；来源键不依赖可编辑标题；BugDone 标题保持 `[BugDone] #编号 … [BugDone:<BugId>]`。
- [ ] 第一栏改为“信息捕获”，展示站点、页面类型、捕获方式、时间、字段来源、缺失项和附件/日志状态；“下一步：AI任务创建”传不可变草稿快照。
- [ ] 第二栏仅显示和提交真实标题/描述及选项；来源变更时保留用户编辑并要求明确选择是否替换，不静默覆盖。
- [ ] 处理列表迁为 `siteId + scopeId + recordId + workspace + issueId`，旧 BugDone 记录迁移后仍能查状态；第 101 条淘汰最旧本地记录。
- [ ] 增加站点配置列表、开关、导入前校验、权限差异、导出及脱敏样本试运行。通过单元测试和两种面板模式的 Ego Lite 回归后提交。

## 阶段 3：通用查重与附件

- [ ] 测试 `submitDraft({draft, api, store, upload})`：本地 ID 核验→分页精确搜索→上传→POST；失败或超时保留 `pending`，复用已有任务不上传、不修改任务。
- [ ] 用 `sourceKey = siteId:scopeId:recordId` 建本地键，并在捕获阶段生成用户可见的搜索标记；Multica 搜索标题与描述后还须精确核对标记，同时接受旧 BugDone 标记。若用户从两处都删除标记，阻止可靠查重模式下的自动创建；手动无稳定 ID 的草稿只提示可能重复。
- [ ] 回形针支持本地文件选择；站点附件与本地文件同列显示来源、类型、大小、上传状态和移除按钮。移除只影响草稿。
- [ ] 油猴用 `FormData` 上传；Mac WebView 增加受控 File 数据流/分块传输，不接受任意文件路径。上传成功 ID 放入 `attachment_ids`，上传失败停止创建并显示暂存文件状态。
- [ ] 用图片、文本文件、长日志、部分失败、超时和无 `GM_xmlhttpRequest` 场景测试；在油猴与编译后的 FastlaneTool 中各做一次真实上传和创建联调后提交。

## 阶段 4：友盟接口验证与配置

- [ ] 在用户已登录的 Ego Lite 中分别观察崩溃列表、两条不同 ID 的详情、错误明细、行为日志、分页和下载。只记录请求方法、精确 URL 规则、稳定关联字段、响应结构与大小；真实日志与鉴权信息不入仓库。
- [ ] 对照响应 ID 与页面 `appId/errorId`；不一致时停止归并。确认完整日志能否通过接口、DOM 或下载取得，以及分页/截断标记。
- [ ] 将**实测**规则写入友盟 profile，生成合成夹具并测试跨 ID、筛选参数、迟到响应、日志分页和截断。无法验证的规则保持禁用。
- [ ] 友盟详情第一栏显示日志摘要和完整度；短日志可放描述，长日志作为可编辑/可移除附件。实际 Multica 任务中验证智能体可读取附件，再启用友盟 profile 并提交。

## 阶段 5：任意网页手动模式

- [ ] 发布前明确列出新增 `@match` / Fastlane 匹配权限；默认只装轻量入口，未配置站点不装网络钩子。
- [ ] 用户点击“从当前页面选取”后，只读取其选中的可见文字/DOM 区块和当前 URL；过滤密码输入、隐藏节点、iframe 和脚本数据，提供预览、取消、删减与补充。
- [ ] 没有稳定业务 ID 时显示“可能重复”的 URL/内容指纹提示，不走 BugDone/友盟的强查重路径。
- [ ] 测试未配置站点无自动观察、手动模式隐私边界、SPA 路由与页面选择；在第三个站点试用而不改通用提交服务。通过后提交。

## 阶段 6：发布与验收

- [ ] 更新 README、权限说明、配置 schema、迁移说明和故障排查；版本号与 `@updateURL` 发布物一致。
- [ ] `npm run check && npm test` 全部通过；Ego Lite 分别回归 BugDone、友盟、未配置站点；FastlaneTool 编译后回归无 `GM_*`、网络桥与文件上传。
- [ ] 审查构建产物不含真实 Token、Bug、日志或截图；审查导入 profile 无任意代码执行和新增写源站能力。
- [ ] 分阶段提交、打版本 tag 并推送；若友盟真实接口或原生桥联调未完成，发布状态必须明确标为“部分完成”，不得声称整个远期目标已上线。
