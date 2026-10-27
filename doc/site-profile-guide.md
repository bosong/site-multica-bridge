# 站点捕获配置

本地开发版的「站点捕获配置」在设置之后，是独立 Tab。支持 BugDone、友盟 APM、GitHub Issues 三份内置配置，以及最多 20 份用户配置。新配置使用 `schemaVersion: 2`，已有 v1 JSON 仍可读取。

内置配置可以直接编辑和导出；保存的是用户覆盖，不修改内置原件。「删除所选配置」对内置配置表示恢复默认，对用户配置表示删除。「回滚上一版」恢复最近一次保存或启停前的版本。第一次保存用户配置默认停用；修改已启用配置的捕获/字段范围时会列出变化并停用，核对后再启用。保存、启停、回滚在当前页面立即应用，其他已打开页面需刷新。停用不撤销已创建的任务。

配置只包含声明式规则，不接受 JavaScript、请求头、Cookie 或 Token。访问令牌与站点配置分别存储，导出 JSON 不包含故障正文、日志或附件内容。

## 默认标签

全局默认标签仍在「设置 → 任务默认配置」。每份站点配置可选择：

| `defaultLabel` | 行为 |
| --- | --- |
| 缺省，或 `{"mode":"inherit"}` | 继承全局默认标签。 |
| `{"mode":"none"}` | 明确不指定标签，即使全局有默认标签。 |
| `{"mode":"fixed","id":"标签 UUID","api":"https://api.multica.ai","workspace":"工作区 UUID"}` | 使用指定标签；仅在绑定的 API 和工作区生效。 |

连接 Multica 后，配置页提供模式和标签下拉框，选择会写入编辑框中的 JSON；点击「校验并保存」生效。指定标签的 `id` 与 `workspace` 必须是完整 UUID，`api` 必须是合法服务根地址。切到其他服务或工作区时不带这个标签，并给出提示；不要用其他工作区的标签 ID 替代。

点击「下一步：AI任务创建」时应用默认标签，任务创建页最后选择的值优先；空白任务使用全局默认。刷新同一工作区的选项目录保留用户手选值，切换工作区不沿用旧值。最终选中的单个标签通过 `label_ids` 提交，选择无标签时不发送该字段。复用已有任务不会修改它的标签。

## 最小配置和示例

可直接使用界面的合成模板。可复制的文件见 [example-issues.json](./site-profiles/example-issues.json)，配套合成响应见 [example-response.json](./site-profiles/example-response.json)。内置规则快照也保存在同一目录，供查看字段；实际运行以脚本内置版本及用户覆盖为准。

```json
{
  "schemaVersion": 2,
  "id": "example-issues",
  "metadata": { "name": "示例问题站点" },
  "version": 1,
  "enabled": false,
  "defaultLabel": { "mode": "inherit" },
  "allowedOrigins": ["https://issues.example.test"],
  "pages": [
    { "kind": "list", "path": "/issues" },
    { "kind": "detail", "path": "/issues/:id" }
  ],
  "captures": [{
    "id": "issues", "method": "POST",
    "origin": "https://issues.example.test", "path": "/api/issues",
    "maxResponseBytes": 1000000,
    "success": { "path": "$.ok", "equals": true },
    "variants": [
      { "kind": "list", "path": "$.data.items", "type": "array" },
      { "kind": "detail", "path": "$.data.issue", "type": "object" }
    ]
  }],
  "record": {
    "scopeId": "$.projectId", "recordId": "$.id", "title": "$.title",
    "number": "$.number", "descriptionHtml": "$.description"
  },
  "draft": { "titleTemplate": "[Example] #{{number}} {{title}}" },
  "dedup": { "keyTemplate": "example-issues:{{scopeId}}:{{recordId}}" },
  "attachments": [], "postActions": []
}
```

`pages` 是网页地址规则，`captures` 是网络接口规则，二者不必相同。`:id` 匹配一个路径段；`*` 只匹配本段，不跨 `/`。路径匹配不区分大小写，查询参数不参与匹配；根页面 `/` 也可以配置。接口必须在 `allowedOrigins` 内，按 GET/POST 方法匹配。相对请求地址先按当前页面解析，不能误用配置中另一个域名。

多个启用配置匹配同一页面时，先按 `priority` 从大到小选择；相同优先级按 `id` 排序。当前只启用一份配置，避免同一响应被不同站点配置重复解释。未匹配的 HTTPS 页面只显示手动入口，不安装网络钩子。

## 字段说明

| 字段 | 含义与约束 |
| --- | --- |
| `schemaVersion` / `version` | 格式版本为 1 或 2；规则修订号为正整数。 |
| `id` / `enabled` | 小写字母开头的站点标识；是否启用自动捕获。已有 ID 不可修改。 |
| `metadata.name` / `priority` | 可选显示名称，省略时使用配置 ID；匹配优先级 -100～100，缺省 0。 |
| `allowedOrigins` | 1～8 个 HTTPS 根地址，仅决定可读取的页面/接口域。 |
| `pages` | 最多 20 条，`kind` 为 list/detail，`path` 使用上述路径语法。 |
| `captures` | 最多 20 条；包含唯一 `id`、`method`、`origin`、`path`、`maxResponseBytes`（最大 4000000）。 |
| `captures[].success` | 可省略；有限 JSON `path` 与标量 `equals`，判断响应是否成功。 |
| `captures[].variants` | `kind`、JSON `path`、array/object `type`；列表包装项可用 `itemPath` 取实际记录。 |
| `captures[].requestKeys` | 最多 8 个必要的请求关联字段，只复制字符串/数字，不复制其他请求参数。 |
| `captures[].requestOnPage` | 可省略或 false，表示被动监听；为 true 时，在匹配页面主动以同源会话 GET 当前 URL，发送 `Accept: application/json`。只允许已声明页面路径的 GET。 |
| `record` | `scopeId`、`recordId`、`title` 必填；`number`、`descriptionHtml`、`descriptionText`、`sourceUrl` 可选。有限 JSON 路径或最多 4 个候选路径，依次取非空值。 |
| `record.fields` | 最多 20 个扩展文本字段，如 `{"productName":"$.product.name"}`，供正文模板使用；禁止覆盖来源身份和系统字段。 |
| `identity` | 可选页面/响应身份核对：`scopeTemplate`、`recordParam`、`recordFormat`（positive-integer/hex32）、`sourceTemplate`。不能通过正文或标题猜来源。 |
| `draft.titleTemplate` | 使用 `siteId/scopeId/recordId/number/title`；可选 `number` 缺失时留空，`#{{number}}` 会整体省略；缺少必要身份字段仍停止生成。 |
| `draft.descriptionTemplate` | 可选；除上述字段还可用 `description/sourceUrl/shareUrl/attachmentLinks` 以及 `record.fields`。空的可选字段生成空字符串。 |
| `links.shareTemplate` | 可省略；同源只读分享 URL 模板，支持来源身份字段，范围与记录 ID 按 URL 编码。缺少分享所需字段时只跳过链接。 |
| `dedup.keyTemplate` | 必须包含 `scopeId` 和 `recordId`。已有配置的身份路径、适配器与键模板不可更改，避免升级后重复创建。 |
| `attachments` | 可省略或 null，按空数组处理；最多 8 条文本或图片规则，详见下节。 |
| `presentation` | `recordLabel` 是记录选择标题；`hideSelectors`/`drawerSelectors` 是最多 8 个简单 ID 或 class，用于隐藏源站入口/调整抽屉布局。 |
| `processors.stack` | 友盟精简堆栈参数：`maxStacks`（1～10）、`maxLines`（1～200）、`maxChars`（1～20000）。 |
| `adapter` | 可信复杂协议适配器，仅内置 BugDone/友盟站点可选，不能加载任意代码。 |
| `postActions` | 可省略或 null，表示无回写；可信源站动作目前只支持 BugDone 的 `bugdone.start-processing`，由 `enabled` 控制。 |
| `defaultLabel` | 继承、无标签或绑定服务与工作区的指定标签，详见前文。 |

正文纯文本/Markdown 最多取 20000 字符，HTML 转为文本时保留段落与图片链接。描述模板前始终加入 `[Source:…]` 标记；BugDone 还保留旧标题标记和旧缓存键。进入任务创建页时保存独立快照，后续捕获与配置刷新不会替换正在编辑任务的来源。标题和描述的最终编辑值就是提交值；若删除可靠查重所需标记，会阻止自动创建。

## 手动填写与可选任务配置

已配置站点也可以在记录选项中选择「不关联问题 · 手动填写」。没有捕获列表或详情时，填写非空标题和内容即可进入下一步；后续列表响应不会替换手填内容。也可以直接在任务创建页填写标题和内容，无需先选取网页文字。

手动任务不继承未选择记录的身份、截图或源站回写动作。同一内容的下一步重试复用当前手动草稿身份，修改内容后生成新的草稿身份；URL/内容指纹只提示可能重复，不承诺跨设备业务查重。自动关联记录仍要求捕获详情，避免把列表摘要当作完整问题提交。

设置允许先保存部分配置；真正连接时需要服务地址与令牌，创建任务时还需要工作区、处理智能体、标题和内容。项目、标签、开始日期、截止日期均可空，留空时不发送对应可选字段。明确选择「无默认项目」或「无默认智能体」后，刷新目录不会再自动选回第一项；没有默认智能体时，创建前需主动选择处理智能体。

SPA 页面通过同步监听 `pushState`、`replaceState` 与历史导航及时切换配置，800 毫秒轮询只作兜底。友盟从 `/error_analysis` 自动跳转 `/crash` 时，也会在首个列表请求发出前安装捕获。只有当前页面、当前配置与当前监听代次对应的响应才会被接收。

## 附件与变换

文本规则：`kind: "text"`，`path` 指向响应内字符串，需要 `maxChars`（1～200000）；超过限制会提示未包含，不静默截成完整文件。

图片规则：`kind: "image-url"`，`path` 指向 URL。单独的 `allowedOrigins` 可允许 CDN 下载域，省略时使用站点域；增加下载域不会扩大接口捕获范围。

数组图片示例：

```json
{
  "id": "screenshots", "kind": "image-url", "path": "$.files",
  "items": {
    "url": "$.url", "name": "$.name",
    "filter": { "path": "$.active", "notEquals": false }
  },
  "filenameTemplate": "issue-{{recordId}}.png",
  "allowedOrigins": ["https://cdn.example.test"],
  "transform": { "preset": "image", "maxDimension": 2200, "quality": 0.9 }
}
```

`items` 只遍历最多 100 项。`filter` 排除字段等于 notEquals 的项；可选 `extension` 指向扩展名，只保留支持的图片格式。文件名优先取 `items.name`，其次 URL 文件名，最后模板。图片地址要求 HTTPS 且符合允许域；上传前再次校验。压缩 `maxDimension` 为 100～4096，`quality` 为 0.3～1；使用内建算法，不能传入转换脚本。

BugDone 截图默认压缩，可切换原图；自定义图片声明 transform 后也可在附件 item 上切换原图。压缩失败会停止，需用户选择原图。附件可以预览或移除；移除只影响当前草稿。上传成功通过创建接口的 `attachment_ids` 关联，不依赖智能体访问外链。非图片源站文件目前保留链接；用户可通过回形针补充本地文件。

跨域下载仍受 Tampermonkey 或 Mac 原生桥的 `@connect` 许可约束。JSON 配置不能扩大宿主授予的权限。Mac 原生桥不带源站 Cookie，必须登录才能访问的图片可能无法转传。

## 内置适配器与回写

- BugDone：数组图片、分享链接、标题/正文模板、布局选择器均在配置中；保留旧查重缓存和 `[BugDone:<id>]`，避免升级导致重复任务。
- 友盟：按页面 appId/errorId、请求 logId 和 stackMd5 关联乱序日志；关联算法由可信适配器实现。行为日志进入描述，堆栈默认精简 TXT，可切换完整版。只包含用户实际打开并加载的明细，显示完整度。
- GitHub Issues：页面同源 JSON GET 获取当前列表和详情；配置身份规则核对 owner/repo、Issue 编号与规范链接。Markdown 正文保留，不自动遍历全部分页、评论或附件；网页内部协议变化时需要更新配置或适配器。

BugDone 新建成功后，`postActions: [{"adapter":"bugdone.start-processing","enabled":true}]` 先读取状态，只有“待处理”才改“处理中”，最后重读确认。改为 enabled:false 或空数组可关闭。复用已有任务不执行，失败只提示核对，不把已创建的 Multica 任务判为失败。其他站点不得借此执行任意 POST。

## 试运行、存储和兼容

「试运行」使用用户粘贴的合成响应，报告条数和缺失身份，不调用 Multica 或源站写接口，也不保存正文。JSON 校验失败时不会替换已保存版本。规则诊断只记录规则 ID、数量和错误类别。

运行时在配置变化/SPA 路由切换时卸载旧监听、废弃迟到响应，再按新上下文安装监听；两个 JS 世界使用同一匹配语义。进入页面后已发生的历史请求不会重放；BugDone/友盟可能需要重新打开详情触发源站请求。

Tampermonkey 使用脚本级存储，新 FastlaneTool 使用 `@fastlane-storage` 原生存储，旧 WebView 回退到站点本地存储。原命名空间、`submittedBugs` 历史记录和 pending 状态保持兼容；处理列表最多 100 条，第 101 条淘汰最旧记录。

任意未配置 HTTPS 网页可手动选取可见文字。手动草稿没有稳定业务 ID，只在本次草稿内防重；相同 URL/文字的本地指纹用于“可能重复”提示，不当作业务来源强查重。
