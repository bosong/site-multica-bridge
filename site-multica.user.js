// ==UserScript==
// @name         Site 接入 Multica
// @namespace    local.site.multica
// @version      3.0.0
// @description  多站点信息捕获与 Multica 智能体任务桥接
// @updateURL    https://raw.githubusercontent.com/bosong/site-multica-bridge/main/site-multica.user.js
// @downloadURL  https://raw.githubusercontent.com/bosong/site-multica-bridge/main/site-multica.user.js
// @match        https://*/*
// @run-at       document-start
// @fastlane-network
// @fastlane-storage
// @noframes
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @connect      api.multica.ai
// @connect      img.bugdone.cn
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// ==/UserScript==

(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // src/config/constants.js
  var UI_DELAY_MS = 300;
  var VERSION = 1;
  var UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  var BUGID = /^[a-f\d]{32}$/i;
  var PROFILE_PATH = /^\$(?:\.[A-Za-z_][A-Za-z\d_]*)*$/;
  var DEFAULT_SHORTCUT = "Ctrl+Shift+M";

  // src/sites/builtins.js
  var BUGDONE_PROFILE = {
    schemaVersion: 2,
    id: "bugdone",
    version: 2,
    enabled: true,
    metadata: { name: "BugDone" },
    adapter: "bugdone",
    defaultLabel: { mode: "inherit" },
    presentation: { recordLabel: "选择问题", hideSelectors: ["#openIntelligentTracking"], drawerSelectors: ["#asideProblem"] },
    links: { shareTemplate: "https://www.bugdone.cn/cn/bugPreview/{{scopeId}}/{{recordId}}" },
    allowedOrigins: ["https://www.bugdone.cn", "https://bugdone.cn"],
    pages: [
      { kind: "list", path: "/cn/bugManagement_*" },
      { kind: "list", path: "/cn/bugManagement/:view/:projectId/:productId" },
      { kind: "detail", path: "/cn/bugPreview/:projectId/:bugId" }
    ],
    captures: [{
      id: "bug-api",
      method: "POST",
      origin: "https://www.bugdone.cn",
      path: "/Service/BugDone/BugAPI.ashx",
      maxResponseBytes: 4e6,
      success: { path: "$.Result", equals: 1 },
      variants: [
        { kind: "list", path: "$.ReturnObj.ItemList", type: "array" },
        { kind: "detail", path: "$.ReturnObj", type: "object" }
      ]
    }],
    record: {
      scopeId: "$.ProjectId",
      recordId: "$.BugId",
      title: "$.BugTitle",
      number: "$.BugCode",
      descriptionHtml: "$.Description",
      fields: {
        projectName: "$.ProjectName",
        productName: "$.ProductName",
        moduleName: "$.ModuleName",
        priority: "$.StrPriority",
        state: "$.StrBugStatus",
        environment: "$.Environment"
      }
    },
    draft: {
      titleTemplate: "[BugDone] #{{number}} {{title}} [BugDone:{{recordId}}]",
      descriptionTemplate: "[BugDone:{{recordId}}]\n\n来源：{{sourceUrl}}\n只读分享：{{shareUrl}}\nBug ID：{{recordId}}\n编号：{{number}}\n项目：{{projectName}}\n产品：{{productName}}\n模块：{{moduleName}}\n优先级：{{priority}}\nBugDone 状态：{{state}}\n环境：{{environment}}\n\n任务要求：\n{{title}}\n\n详细描述：\n{{description}}\n\n截图与附件：\n{{attachmentLinks}}\n\n请分析问题并修复，在交付时说明根因、修改和验证结果；遇到信息不足时先在任务中说明。"
    },
    dedup: { keyTemplate: "bugdone:{{scopeId}}:{{recordId}}" },
    attachments: [{
      id: "screenshots",
      kind: "image-url",
      path: "$.BugAccessoryList",
      items: { url: "$.FullFileUrl", name: "$.FileName", extension: "$.ext", filter: { path: "$.ActiveFlg", notEquals: false } },
      filenameTemplate: "bug-{{recordId}}.png",
      allowedOrigins: ["https://img.bugdone.cn"],
      transform: { preset: "image", maxDimension: 2200, quality: 0.9 }
    }],
    postActions: [{ adapter: "bugdone.start-processing", enabled: true }]
  };
  var UMENG_PROFILE = {
    schemaVersion: 2,
    id: "umeng-apm-crash",
    version: 2,
    enabled: false,
    metadata: { name: "友盟 APM" },
    adapter: "umeng",
    defaultLabel: { mode: "inherit" },
    presentation: { recordLabel: "选择崩溃记录" },
    processors: { stack: { maxStacks: 2, maxLines: 40, maxChars: 4e3 } },
    allowedOrigins: ["https://apm.umeng.com"],
    pages: [
      { kind: "list", path: "/platform/:appId/error_analysis/crash" },
      { kind: "detail", path: "/platform/:appId/error_analysis/crash/detail/:errorId" }
    ],
    captures: [
      {
        id: "umeng-error-list",
        method: "POST",
        origin: "https://apm.umeng.com",
        path: "/hsf/analysis/errorList",
        maxResponseBytes: 4e6,
        requestKeys: ["dataSourceId"],
        success: { path: "$.code", equals: 200 },
        variants: [{ kind: "list", path: "$.data.list", type: "array" }]
      },
      {
        id: "umeng-error-detail",
        method: "POST",
        origin: "https://apm.umeng.com",
        path: "/hsf/analysis/errorDetail",
        maxResponseBytes: 4e6,
        requestKeys: ["dataSourceId", "errorId"],
        success: { path: "$.code", equals: 200 },
        variants: [{ kind: "detail", path: "$.data", type: "object" }]
      },
      {
        id: "umeng-log-list",
        method: "POST",
        origin: "https://apm.umeng.com",
        path: "/hsf/analysis/errorlogList",
        maxResponseBytes: 4e6,
        requestKeys: ["dataSourceId", "errorId"],
        success: { path: "$.code", equals: 200 },
        variants: [{ kind: "list", path: "$.data.list", type: "array" }]
      },
      {
        id: "umeng-log-detail",
        method: "POST",
        origin: "https://apm.umeng.com",
        path: "/hsf/analysis/errorlogDetail",
        maxResponseBytes: 4e6,
        requestKeys: ["dataSourceId", "errorId", "logId"],
        success: { path: "$.code", equals: 200 },
        variants: [{ kind: "detail", path: "$.data", type: "object" }]
      },
      {
        id: "umeng-error-stack",
        method: "POST",
        origin: "https://apm.umeng.com",
        path: "/hsf/analysis/errorStack",
        maxResponseBytes: 4e6,
        requestKeys: ["key"],
        success: { path: "$.code", equals: 200 },
        variants: [{ kind: "detail", path: "$.data", type: "object" }]
      }
    ],
    record: { scopeId: "$.__scopeId", recordId: "$.id", title: "$.summary", number: "$.id" },
    draft: { titleTemplate: "[友盟崩溃] #{{recordId}} {{title}}" },
    dedup: { keyTemplate: "umeng-apm-crash:{{scopeId}}:{{recordId}}" },
    attachments: [],
    postActions: []
  };
  var GITHUB_PROFILE = {
    schemaVersion: 2,
    id: "github-issues",
    version: 2,
    enabled: true,
    metadata: { name: "GitHub Issues" },
    defaultLabel: { mode: "inherit" },
    presentation: { recordLabel: "选择 Issue" },
    identity: {
      scopeTemplate: "{{owner}}/{{repo}}",
      recordParam: "number",
      recordFormat: "positive-integer",
      sourceTemplate: "https://github.com/{{owner}}/{{repo}}/issues/{{recordId}}"
    },
    allowedOrigins: ["https://github.com"],
    pages: [
      { kind: "list", path: "/:owner/:repo/issues" },
      { kind: "detail", path: "/:owner/:repo/issues/:number" }
    ],
    captures: [
      {
        id: "github-issue-list",
        method: "GET",
        origin: "https://github.com",
        path: "/:owner/:repo/issues",
        maxResponseBytes: 4e6,
        requestOnPage: true,
        variants: [{ kind: "list", path: "$.payload.issuesIndexContentRoute.results", type: "array", itemPath: "$.issue" }]
      },
      {
        id: "github-issue-detail",
        method: "GET",
        origin: "https://github.com",
        path: "/:owner/:repo/issues/:number",
        maxResponseBytes: 4e6,
        requestOnPage: true,
        variants: [{ kind: "detail", path: "$.payload.issueViewerRoute.data.repository.issue", type: "object" }]
      }
    ],
    record: {
      scopeId: ["$.repoNameWithOwner", "$.repository.nameWithOwner"],
      recordId: "$.number",
      title: "$.title",
      number: "$.number",
      descriptionText: "$.body",
      sourceUrl: ["$.permalink", "$.url"]
    },
    draft: { titleTemplate: "[GitHub Issues] #{{number}} {{title}}" },
    dedup: { keyTemplate: "github-issues:{{scopeId}}:{{recordId}}" },
    attachments: [],
    postActions: []
  };
  BUGDONE_PROFILE.captures.push({ ...BUGDONE_PROFILE.captures[0], id: "bug-api-alias", origin: "https://bugdone.cn" });
  var BUILTIN_PROFILES = [BUGDONE_PROFILE, UMENG_PROFILE, GITHUB_PROFILE];
  var PROFILE_TEMPLATE = {
    schemaVersion: 2,
    metadata: { name: "示例问题站点" },
    defaultLabel: { mode: "inherit" },
    id: "example-issues",
    version: 1,
    enabled: false,
    allowedOrigins: ["https://issues.example.test"],
    pages: [{ kind: "list", path: "/issues" }, { kind: "detail", path: "/issues/:id" }],
    captures: [{
      id: "issues",
      method: "POST",
      origin: "https://issues.example.test",
      path: "/api/issues",
      maxResponseBytes: 1e6,
      success: { path: "$.ok", equals: true },
      variants: [
        { kind: "list", path: "$.data.items", type: "array" },
        { kind: "detail", path: "$.data.issue", type: "object" }
      ]
    }],
    record: { scopeId: "$.projectId", recordId: "$.id", title: "$.title", number: "$.number", descriptionHtml: "$.description" },
    draft: { titleTemplate: "[Example] #{{number}} {{title}}" },
    dedup: { keyTemplate: "example-issues:{{scopeId}}:{{recordId}}" },
    attachments: [
      {
        id: "stack",
        kind: "text",
        path: "$.stack",
        filenameTemplate: "issue-{{recordId}}-stack.txt",
        maxChars: 2e5
      },
      {
        id: "screen",
        kind: "image-url",
        path: "$.screenshot",
        filenameTemplate: "issue-{{recordId}}.png"
      }
    ],
    postActions: []
  };
  var PAGE_TEXT_TEMPLATE = {
    schemaVersion: 2,
    id: "example-text-page",
    version: 1,
    enabled: false,
    captureMode: "text",
    metadata: { name: "文本捕获示例" },
    allowedOrigins: ["https://docs.example.test"],
    pages: [{ kind: "manual", path: "/**" }],
    draft: { titleTemplate: "{{pageTitle}}", descriptionTemplate: "来源：{{pageUrl}}\n\n选取内容：\n{{selectedText}}" }
  };
  var PAGE_BLANK_TEMPLATE = {
    ...PAGE_TEXT_TEMPLATE,
    id: "example-blank-page",
    captureMode: "blank",
    metadata: { name: "空白填写示例" },
    draft: { titleTemplate: "", descriptionTemplate: "" }
  };

  // src/multica/config.js
  function validateConfig(c) {
    const u = new URL(c.api);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") throw Error("API 地址请填写服务根地址，例如 https://api.multica.ai");
    const loopback = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw Error("远程 API 必须使用 HTTPS");
    if (!c.token?.trim() || !UUID.test(c.workspace)) throw Error("请填写 Token 和工作区完整 UUID");
    if (c.project && !UUID.test(c.project)) throw Error("Multica 项目 ID 必须是完整 UUID");
    return { ...c, api: u.origin, token: c.token.trim() };
  }
  __name(validateConfig, "validateConfig");
  function validateConnection(c) {
    const u = new URL(c.api);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") throw Error("API 地址请填写服务根地址");
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) throw Error("远程 API 必须使用 HTTPS");
    if (!c.token?.trim()) throw Error("请填写访问令牌");
    return { ...c, api: u.origin, token: c.token.trim() };
  }
  __name(validateConnection, "validateConnection");
  function validateStoredConfig(c) {
    const api = c.api?.trim() ? validateConnection({ ...c, token: "validate-root-only" }).api : "";
    if (c.workspace && !UUID.test(c.workspace)) throw Error("工作区 ID 必须是完整 UUID，或留空");
    if (c.project && !UUID.test(c.project)) throw Error("项目 ID 必须是完整 UUID，或留空");
    return { ...c, api, token: String(c.token || "").trim() };
  }
  __name(validateStoredConfig, "validateStoredConfig");
  function agentCacheKey(c) {
    return `agents:${VERSION}:${c.api}:${c.workspace}`;
  }
  __name(agentCacheKey, "agentCacheKey");
  function agentChoices(c, list) {
    const agents = [], seen = /* @__PURE__ */ new Set();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id !== "string" || !item.id || item.is_archived === true || seen.has(item.id)) continue;
      seen.add(item.id);
      agents.push({ id: item.id, name: typeof item.name === "string" && item.name ? item.name : item.id });
    }
    for (const id of [c.agent, c.defaultAgent]) {
      if (typeof id === "string" && id && !seen.has(id)) {
        seen.add(id);
        agents.push({ id, name: `已保存的智能体 · ${id}` });
      }
    }
    return { agents, selectedAgent: c.agent || c.defaultAgent || "", selectedDefault: c.defaultAgent || "" };
  }
  __name(agentChoices, "agentChoices");
  function listItems(data, key) {
    if (Array.isArray(data)) return data;
    for (const value of [data?.[key], data?.items, data?.data]) if (Array.isArray(value)) return value;
    throw Error(`读取 ${key} 列表失败：响应结构不受支持`);
  }
  __name(listItems, "listItems");
  function connectionCacheTag(api, token) {
    let hash = 2166136261;
    for (const char of `${api}
${token}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  __name(connectionCacheTag, "connectionCacheTag");
  function needsCatalogRefresh(c, savedTag, workspaces, catalog) {
    return !c.api || !c.token || !c.workspace || savedTag !== connectionCacheTag(c.api, c.token) || !Array.isArray(workspaces) || !workspaces.some((item) => item.id === c.workspace) || !catalog || !["projects", "agents", "labels"].every((key) => Array.isArray(catalog[key]));
  }
  __name(needsCatalogRefresh, "needsCatalogRefresh");
  function connectionBadge(c, phase) {
    if (!c.api || c.api === "__add__" || !c.token?.trim()) return { text: "未配置", color: "#94a3b8" };
    if (phase === "connecting") return { text: "连接中", color: "#3b82f6" };
    if (phase === "connected") return { text: "已连接", color: "#22c55e" };
    if (phase === "error") return { text: "连接失败", color: "#ef4444" };
    return { text: "待连接", color: "#eab308" };
  }
  __name(connectionBadge, "connectionBadge");
  async function verifyConnection(api) {
    const response = await api("GET", "/api/me");
    if (response.status !== 200) throw Error(`连接验证失败（HTTP ${response.status}），请检查地址和令牌`);
  }
  __name(verifyConnection, "verifyConnection");

  // src/capture/profiles.js
  function profileValue(data, path) {
    if (Array.isArray(path)) {
      for (const option of path) {
        const value = profileValue(data, option);
        if (value !== void 0 && value !== null && value !== "") return value;
      }
      return void 0;
    }
    if (typeof path !== "string" || !PROFILE_PATH.test(path)) return void 0;
    return path === "$" ? data : path.slice(2).split(".").reduce((value, key) => value && typeof value === "object" && Object.hasOwn(value, key) ? value[key] : void 0, data);
  }
  __name(profileValue, "profileValue");
  function validRoutePattern(path) {
    return typeof path === "string" && path.startsWith("/") && path.length <= 500 && !path.includes("//") && path.split("/").slice(1).every((part) => !part || /^:[A-Za-z][A-Za-z0-9]*$/.test(part) || /^[A-Za-z0-9_.*-]+$/.test(part));
  }
  __name(validRoutePattern, "validRoutePattern");
  function validateSiteProfile(profile) {
    if (profile && typeof profile === "object" && !Array.isArray(profile))
      profile = { ...profile, attachments: profile.attachments ?? [], postActions: profile.postActions ?? [] };
    const fields = /* @__PURE__ */ __name((value, allowed, context) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${context} 必须是对象`);
      for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`不支持的配置字段：${context}.${key}`);
    }, "fields");
    fields(profile, ["schemaVersion", "id", "version", "enabled", "allowedOrigins", "pages", "captures", "record", "draft", "dedup", "attachments", "postActions", "metadata", "priority", "adapter", "identity", "links", "presentation", "defaultLabel", "processors", "captureMode"], "profile");
    if (![1, 2].includes(profile.schemaVersion) || !/^[a-z][a-z0-9-]{1,63}$/.test(profile.id || "") || !Number.isInteger(profile.version) || profile.version < 1 || typeof profile.enabled !== "boolean") throw Error("站点配置版本或标识无效");
    if (!Array.isArray(profile.allowedOrigins) || !profile.allowedOrigins.length || profile.allowedOrigins.length > 8) throw Error("允许的站点不能为空");
    for (const origin of profile.allowedOrigins) {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw Error("允许的站点必须是 HTTPS 根地址");
    }
    const mode = profile.captureMode ?? "api";
    if (!["api", "text", "blank"].includes(mode)) throw Error("捕获方式无效");
    if (!Array.isArray(profile.pages) || !profile.pages.length || profile.pages.length > 20) throw Error("页面规则不能为空或超过 20 条");
    for (const page of profile.pages) {
      fields(page, ["kind", "path"], "pages");
      if (!(mode === "api" ? ["list", "detail"] : ["manual", "list", "detail"]).includes(page.kind) || !validRoutePattern(page.path)) throw Error("页面路径规则无效");
    }
    if (mode !== "api") {
      if (profile.captures !== void 0 && (!Array.isArray(profile.captures) || profile.captures.length) || !Array.isArray(profile.attachments) || profile.attachments.length || !Array.isArray(profile.postActions) || profile.postActions.length || ["adapter", "identity", "record", "dedup", "links", "processors"].some((key) => profile[key] !== void 0))
        throw Error("文本或空白配置不能包含接口、业务身份、自动附件或源站动作");
      const defaults = mode === "text" ? PAGE_TEXT_TEMPLATE.draft : PAGE_BLANK_TEMPLATE.draft;
      profile = { ...profile, captures: [], draft: { ...defaults, ...profile.draft } };
      fields(profile.draft, ["titleTemplate", "descriptionTemplate"], "draft");
      for (const value of Object.values(profile.draft)) {
        if (typeof value !== "string" || value.length > 1e4 || [...value.matchAll(/{{([^}]*)}}/g)].some((m) => !["pageTitle", "pageUrl", "selectedText"].includes(m[1])) || /[{}]/.test(value.replace(/{{(?:pageTitle|pageUrl|selectedText)}}/g, ""))) throw Error("文本模板字段或格式无效");
      }
      validateProfileExtensions(profile, fields);
      return profile;
    }
    if (!Array.isArray(profile.captures) || !profile.captures.length || profile.captures.length > 20) throw Error("网络捕获规则不能为空或超过 20 条");
    for (const rule of profile.captures) {
      fields(rule, ["id", "method", "origin", "path", "maxResponseBytes", "requestKeys", "success", "variants", "requestOnPage"], "captures");
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(rule.id || "") || !["GET", "POST"].includes(rule.method) || !profile.allowedOrigins.includes(rule.origin) || !validRoutePattern(rule.path) || !Number.isInteger(rule.maxResponseBytes) || rule.maxResponseBytes < 1 || rule.maxResponseBytes > 4e6) throw Error("捕获规则超出允许的站点或范围");
      if (rule.requestOnPage !== void 0 && (typeof rule.requestOnPage !== "boolean" || rule.requestOnPage && (rule.method !== "GET" || !profile.pages.some((page) => page.path === rule.path)))) throw Error("主动请求仅支持已声明页面的 GET 接口");
      if (rule.requestKeys && (!Array.isArray(rule.requestKeys) || rule.requestKeys.length > 8 || rule.requestKeys.some((key) => !/^[A-Za-z][A-Za-z\d_]*$/.test(key)))) throw Error("请求身份字段无效");
      if (rule.success) {
        fields(rule.success, ["path", "equals"], "success");
        if (!PROFILE_PATH.test(rule.success.path || "") || !["string", "number", "boolean"].includes(typeof rule.success.equals)) throw Error("成功条件无效");
      }
      if (!Array.isArray(rule.variants) || !rule.variants.length) throw Error("响应变体不能为空");
      for (const variant of rule.variants) {
        fields(variant, ["kind", "path", "type", "itemPath"], "variants");
        if (!["list", "detail"].includes(variant.kind) || !PROFILE_PATH.test(variant.path || "") || !["array", "object"].includes(variant.type) || variant.itemPath && !PROFILE_PATH.test(variant.itemPath)) throw Error("响应变体无效");
      }
    }
    fields(profile.record, ["scopeId", "recordId", "title", "number", "descriptionHtml", "descriptionText", "sourceUrl", "fields"], "record");
    const validPaths = /* @__PURE__ */ __name((value) => typeof value === "string" ? PROFILE_PATH.test(value) : Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every((path) => typeof path === "string" && PROFILE_PATH.test(path)), "validPaths");
    for (const key of ["scopeId", "recordId", "title"]) if (!validPaths(profile.record[key])) throw Error(`字段路径无效：${key}`);
    for (const key of ["number", "descriptionHtml", "descriptionText", "sourceUrl"]) if (profile.record[key] && !validPaths(profile.record[key])) throw Error(`字段路径无效：${key}`);
    if (profile.record.fields) {
      const extra = profile.record.fields;
      if (typeof extra !== "object" || Array.isArray(extra) || Object.keys(extra).length > 20 || Object.entries(extra).some(([name, path]) => !/^[a-z][A-Za-z0-9]{0,39}$/.test(name) || ["siteId", "scopeId", "recordId", "number", "title", "description", "sourceUrl", "shareUrl", "attachmentLinks", "constructor", "prototype"].includes(name) || !validPaths(path)))
        throw Error("扩展字段名称或路径无效，最多 20 个且不能覆盖来源身份");
    }
    fields(profile.draft, ["titleTemplate", "descriptionTemplate"], "draft");
    fields(profile.dedup, ["keyTemplate"], "dedup");
    if (typeof profile.draft.titleTemplate !== "string" || typeof profile.dedup.keyTemplate !== "string" || profile.draft.titleTemplate.length > 500 || profile.dedup.keyTemplate.length > 500 || !Array.isArray(profile.attachments) || !Array.isArray(profile.postActions)) throw Error("任务草稿或附件配置无效");
    const allowedTemplateKeys = /* @__PURE__ */ new Set(["siteId", "scopeId", "recordId", "number", "title"]);
    for (const template of [profile.draft.titleTemplate, profile.dedup.keyTemplate]) {
      for (const placeholder of template.matchAll(/{{([^}]*)}}/g))
        if (!allowedTemplateKeys.has(placeholder[1])) throw Error(`不支持的模板字段：${placeholder[1]}`);
    }
    if (!profile.dedup.keyTemplate.includes("{{scopeId}}") || !profile.dedup.keyTemplate.includes("{{recordId}}"))
      throw Error("来源键必须包含 scopeId 和 recordId");
    if (profile.attachments.length > 8 || profile.postActions.length > 2) throw Error("附件规则最多 8 条，动作最多 2 条");
    for (const [name, rules, key] of [["captures", profile.captures, "id"], ["attachments", profile.attachments, "id"], ["postActions", profile.postActions, "adapter"]]) {
      if (new Set(rules.map((rule) => rule?.[key])).size !== rules.length) throw Error(`${name} 中的规则标识重复`);
    }
    validateProfileExtensions(profile, fields);
    for (const rule of profile.attachments) {
      fields(rule, ["id", "kind", "path", "filenameTemplate", "maxChars", "items", "allowedOrigins", "transform"], "attachments");
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(rule.id || "") || !["text", "image-url"].includes(rule.kind) || !PROFILE_PATH.test(rule.path || "") || typeof rule.filenameTemplate !== "string" || !rule.filenameTemplate || rule.filenameTemplate.length > 180 || /[\\/\r\n]/.test(rule.filenameTemplate) || (rule.kind === "text" ? !Number.isInteger(rule.maxChars) || rule.maxChars < 1 || rule.maxChars > 2e5 : rule.maxChars !== void 0) || [...rule.filenameTemplate.matchAll(/{{([^}]*)}}/g)].some((match) => !allowedTemplateKeys.has(match[1])) || /[{}]/.test(rule.filenameTemplate.replace(/{{[A-Za-z][A-Za-z\d]*}}/g, "")))
        throw Error(`附件规则无效：${rule.id || "未命名"}`);
    }
    return profile;
  }
  __name(validateSiteProfile, "validateSiteProfile");
  function validateProfileExtensions(profile, fields) {
    const origins = /* @__PURE__ */ __name((list) => {
      if (!Array.isArray(list) || !list.length || list.length > 8 || list.some((value) => {
        const u = locationOf(value);
        return !u || u.protocol !== "https:" || u.origin !== value || u.username || u.password;
      })) throw Error("下载域必须是 HTTPS 根地址，最多 8 个");
    }, "origins");
    const template = /* @__PURE__ */ __name((value, keys) => {
      if (typeof value !== "string" || value.length > 1e4 || [...value.matchAll(/{{([^}]*)}}/g)].some((m) => !keys.includes(m[1]))) throw Error("模板字段或长度无效");
    }, "template");
    if (profile.metadata) {
      fields(profile.metadata, ["name"], "metadata");
      if (profile.metadata.name != null && (typeof profile.metadata.name !== "string" || profile.metadata.name.length > 80)) throw Error("站点名称无效");
    }
    if (profile.priority !== void 0 && (!Number.isInteger(profile.priority) || Math.abs(profile.priority) > 100)) throw Error("站点优先级须为 -100 至 100");
    if (profile.adapter && !["bugdone", "umeng"].includes(profile.adapter)) throw Error("未知的可信捕获适配器");
    if (profile.adapter === "bugdone" && (profile.id !== "bugdone" || profile.allowedOrigins.some((x) => !["https://bugdone.cn", "https://www.bugdone.cn"].includes(x)))) throw Error("BugDone 适配器仅用于 BugDone");
    if (profile.adapter === "umeng" && (profile.id !== "umeng-apm-crash" || profile.allowedOrigins.some((x) => x !== "https://apm.umeng.com"))) throw Error("友盟适配器仅用于友盟");
    if (profile.adapter === "bugdone") {
      const title = profile.draft.titleTemplate.trim(), mark = "[BugDone:{{recordId}}]";
      if (!title.startsWith(mark + " ") && !title.endsWith(" " + mark))
        throw Error("BugDone 标题必须在开头或末尾保留兼容查重标记 [BugDone:{{recordId}}]，并用空格分隔");
    }
    if (profile.defaultLabel) {
      const x = profile.defaultLabel;
      fields(x, ["mode", "id", "api", "workspace"], "defaultLabel");
      if (!["inherit", "none", "fixed"].includes(x.mode)) throw Error("标签模式无效");
      if (x.mode === "fixed" && (!UUID.test(x.id || "") || !UUID.test(x.workspace || "") || !locationOf(x.api) || validateConnection({ api: x.api, token: "validation" }).api !== x.api)) throw Error("指定标签必须绑定 API、工作区 UUID 和标签 UUID");
    }
    if (profile.identity) {
      fields(profile.identity, ["scopeTemplate", "recordParam", "recordFormat", "sourceTemplate"], "identity");
      const params = [...new Set(profile.pages.flatMap((page) => [...page.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1])))];
      for (const key of ["scopeTemplate", "sourceTemplate"]) if (profile.identity[key]) template(profile.identity[key], [...params, "scopeId", "recordId"]);
      if (profile.identity.recordParam && !params.includes(profile.identity.recordParam)) throw Error("身份字段必须来自页面参数");
      if (profile.identity.recordFormat && !["positive-integer", "hex32"].includes(profile.identity.recordFormat)) throw Error("身份格式无效");
    }
    if (profile.links) {
      fields(profile.links, ["shareTemplate"], "links");
      if (profile.links.shareTemplate != null)
        template(profile.links.shareTemplate, ["siteId", "scopeId", "recordId", "number"]);
    }
    if ((!profile.captureMode || profile.captureMode === "api") && profile.draft.descriptionTemplate !== void 0) template(profile.draft.descriptionTemplate, ["siteId", "scopeId", "recordId", "number", "title", "description", "sourceUrl", "shareUrl", "attachmentLinks", ...Object.keys(profile.record.fields || {})]);
    if (profile.presentation) {
      fields(profile.presentation, ["recordLabel", "hideSelectors", "drawerSelectors"], "presentation");
      if (profile.presentation.recordLabel && (typeof profile.presentation.recordLabel !== "string" || profile.presentation.recordLabel.length > 80)) throw Error("记录名称无效");
      for (const key of ["hideSelectors", "drawerSelectors"]) if (profile.presentation[key] && (!Array.isArray(profile.presentation[key]) || profile.presentation[key].length > 8 || profile.presentation[key].some((x) => typeof x !== "string" || !/^[#.][A-Za-z][A-Za-z0-9_-]{0,80}$/.test(x)))) throw Error("布局选择器只接受简单 ID 或 class");
    }
    if (profile.processors) {
      fields(profile.processors, ["stack"], "processors");
      if (profile.processors.stack) {
        const x = profile.processors.stack;
        fields(x, ["maxStacks", "maxLines", "maxChars"], "processors.stack");
        for (const [key, max] of [["maxStacks", 10], ["maxLines", 200], ["maxChars", 2e4]]) if (!Number.isInteger(x[key]) || x[key] < 1 || x[key] > max) throw Error("堆栈精简参数无效");
      }
    }
    for (const x of profile.attachments) {
      if (x.allowedOrigins) origins(x.allowedOrigins);
      if (x.items) {
        fields(x.items, ["url", "name", "filter", "extension"], "attachments.items");
        if (x.kind !== "image-url" || !PROFILE_PATH.test(x.items.url || "") || x.items.name && !PROFILE_PATH.test(x.items.name)) throw Error("数组附件字段无效");
        if (x.items.extension && !PROFILE_PATH.test(x.items.extension)) throw Error("附件扩展名路径无效");
        if (x.items.filter) {
          fields(x.items.filter, ["path", "notEquals"], "attachments.items.filter");
          if (!PROFILE_PATH.test(x.items.filter.path || "") || !["boolean", "number", "string"].includes(typeof x.items.filter.notEquals)) throw Error("附件过滤器无效");
        }
      }
      if (x.transform) {
        fields(x.transform, ["preset", "maxDimension", "quality"], "attachments.transform");
        if (x.kind !== "image-url" || x.transform.preset !== "image" || !Number.isInteger(x.transform.maxDimension) || x.transform.maxDimension < 100 || x.transform.maxDimension > 4096 || typeof x.transform.quality !== "number" || x.transform.quality < 0.3 || x.transform.quality > 1) throw Error("压缩参数无效");
      }
    }
    for (const x of profile.postActions) {
      fields(x, ["adapter", "enabled"], "postActions");
      if (x.adapter !== "bugdone.start-processing" || profile.adapter !== "bugdone" || typeof x.enabled !== "boolean") throw Error("不支持的源站回写动作");
    }
  }
  __name(validateProfileExtensions, "validateProfileExtensions");
  function resolveProfileLabel(profile, config) {
    const label = profile?.defaultLabel;
    if (!label || label.mode === "inherit") return { value: config.label || "", warning: "" };
    if (label.mode === "none") return { value: "", warning: "" };
    if (label.api !== config.api || label.workspace !== config.workspace) return { value: "", warning: "站点默认标签绑定了其他服务或工作区，请重新选择标签" };
    return { value: label.id, warning: "" };
  }
  __name(resolveProfileLabel, "resolveProfileLabel");
  async function runProfilePostActions(profile, context, adapters) {
    if (!profile?.enabled || context.existing || context.siteId !== profile.id || !profile.allowedOrigins.includes(locationOf(context.sourceUrl)?.origin)) return [];
    const results = [];
    for (const action of profile.postActions || []) if (action.enabled && typeof adapters[action.adapter] === "function") {
      try {
        results.push(await adapters[action.adapter](context));
      } catch (error) {
        results.push({ kind: "error", message: error.message });
      }
    }
    return results;
  }
  __name(runProfilePostActions, "runProfilePostActions");
  function assertProfileIdentityUnchanged(previous, profile) {
    if (!previous) return;
    const oldAPI = (previous.captureMode || "api") === "api", newAPI = (profile.captureMode || "api") === "api";
    if (oldAPI !== newAPI || previous.adapter !== profile.adapter || oldAPI && (JSON.stringify(profile.record?.scopeId) !== JSON.stringify(previous.record?.scopeId) || JSON.stringify(profile.record?.recordId) !== JSON.stringify(previous.record?.recordId) || profile.dedup?.keyTemplate !== previous.dedup?.keyTemplate))
      throw Error("已有配置的来源身份、捕获类别、适配器和查重键不可更改；请新建配置以避免重复任务");
  }
  __name(assertProfileIdentityUnchanged, "assertProfileIdentityUnchanged");
  function profileObservationChanges(previous, next) {
    const added = /* @__PURE__ */ __name((oldItems, newItems, identity, label) => {
      const known = new Set((oldItems || []).map(identity));
      return (newItems || []).filter((item) => !known.has(identity(item))).map(label);
    }, "added");
    const changes = [
      ...added(previous?.allowedOrigins, next.allowedOrigins, (value) => value, (value) => `站点 ${value}`),
      ...added(
        previous?.pages,
        next.pages,
        (value) => `${value.kind} ${value.path}`,
        (value) => `页面 ${value.kind} ${value.path}`
      ),
      ...added(
        previous?.captures,
        next.captures,
        (value) => `${value.method} ${value.origin}${value.path}`,
        (value) => `接口 ${value.method} ${value.origin}${value.path}`
      )
    ];
    if (previous && !changes.length && JSON.stringify({
      captures: previous.captures,
      record: previous.record,
      draft: previous.draft,
      dedup: previous.dedup,
      attachments: previous.attachments
    }) !== JSON.stringify({
      captures: next.captures,
      record: next.record,
      draft: next.draft,
      dedup: next.dedup,
      attachments: next.attachments
    })) changes.push("接口响应上限或字段规则已改变");
    return changes;
  }
  __name(profileObservationChanges, "profileObservationChanges");

  // src/sites/bugdone.js
  function shareURL(b) {
    if (!BUGID.test(b.ProjectId || "") || !BUGID.test(b.BugId || "")) return "";
    return `https://www.bugdone.cn/cn/bugPreview/${b.ProjectId}/${b.BugId}`;
  }
  __name(shareURL, "shareURL");
  var marker = /* @__PURE__ */ __name((id) => `[BugDone:${id.toLowerCase()}]`, "marker");
  function bugTaskTitle(b) {
    return `[BugDone] #${b.BugCode} ${b.BugTitle} ${marker(b.BugId)}`;
  }
  __name(bugTaskTitle, "bugTaskTitle");
  function parseResponse(value, profile = BUGDONE_PROFILE, context = {}) {
    return extractProfileItems(profile.captures[0], value).filter(
      ({ item: b }) => b && BUGID.test(b.BugId || "") && typeof b.BugTitle === "string"
    ).map(({ item: b, kind }) => {
      const record = normalizeCapturedRecord(profile, b, { ...context, kind });
      return {
        BugId: String(record?.recordId || b.BugId).toLowerCase(),
        BugCode: record?.number ?? b.BugCode,
        BugTitle: record?.title || b.BugTitle,
        captureRecord: record,
        ProjectId: record?.scopeId || b.ProjectId || "",
        ProjectName: b.ProjectName || "",
        ProductName: b.ProductName || "",
        ModuleName: b.ModuleName || "",
        StrPriority: b.StrPriority || "",
        StrBugStatus: b.StrBugStatus || "",
        Description: typeof b.Description === "string" ? b.Description : "",
        Environment: b.Environment || "",
        PicCount: b.PicCount || 0,
        AttachmentCount: b.AttachmentCount || 0,
        detail: kind === "detail",
        sourceUrl: record?.sourceUrl || "",
        attachments: [...normalizeProfileAttachments(profile, b, { siteId: profile.id, scopeId: b.ProjectId, recordId: b.BugId, number: b.BugCode, title: b.BugTitle }).attachments.map((a) => ({ ...a, image: !!a.remoteImage })), ...(Array.isArray(b.BugAccessoryList) ? b.BugAccessoryList : []).filter((a) => a && a.ActiveFlg !== false && a.FullFileUrl && !/^(png|jpe?g|gif|webp|bmp)$/i.test(a.ext || "")).map((a) => ({ url: safeURL(a.FullFileUrl), name: String(a.FileName || a.AccessoryName || a.FileUrl || "附件"), image: /^(png|jpe?g|gif|webp|bmp)$/i.test(a.ext || "") })).filter((a) => a.url)]
      };
    });
  }
  __name(parseResponse, "parseResponse");
  function safeURL(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" ? u.href : "";
    } catch {
      return "";
    }
  }
  __name(safeURL, "safeURL");
  function mergeBug(old, next) {
    if (old?.detail && !next.detail) return { ...next, ...old, BugTitle: next.BugTitle, StrBugStatus: next.StrBugStatus };
    return { ...old, ...next };
  }
  __name(mergeBug, "mergeBug");
  var owns = /* @__PURE__ */ __name((issue, id) => typeof issue?.title === "string" && (issue.title.startsWith(marker(id) + " ") || issue.title.endsWith(" " + marker(id))), "owns");
  async function startBugDoneProcessing(bug, postForm) {
    const bugId = String(bug?.BugId || "").toLowerCase();
    if (!BUGID.test(bugId)) throw Error("BugDone Bug ID 无效");
    const read = /* @__PURE__ */ __name(async () => {
      const response = await postForm({ Method: "getBugInfo", bugId });
      if (response?.Result !== 1) throw Error(`BugDone 读取状态失败：${response?.Message || "未知错误"}`);
      const detail = response.ReturnObj;
      if (String(detail?.BugId || "").toLowerCase() !== bugId) throw Error("BugDone 返回的 Bug ID 不匹配");
      if (!detail.StrBugStatus) throw Error("BugDone 未返回当前状态");
      return detail.StrBugStatus;
    }, "read");
    const state = await read();
    if (state === "处理中") return { kind: "already-processing", state };
    if (state !== "待处理") return { kind: "skipped", state };
    const changed = await postForm({ Method: "addBugAssign", bugId, actionType: "toprocessing", reason: "" });
    if (changed?.Result !== 1) throw Error(`BugDone 开始处理失败：${changed?.Message || "未知错误"}`);
    const verified = await read();
    if (verified !== "处理中") throw Error(`BugDone 状态更新未确认：当前为${verified}`);
    return { kind: "started", state: verified };
  }
  __name(startBugDoneProcessing, "startBugDoneProcessing");

  // src/shared/html.js
  function captureHtmlText(html) {
    if (typeof html !== "string") return "";
    if (typeof DOMParser !== "undefined") return htmlText(html).slice(0, 2e4);
    return html.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2e4);
  }
  __name(captureHtmlText, "captureHtmlText");
  function htmlText(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script,style,iframe,object").forEach((x) => x.remove());
    doc.querySelectorAll("img").forEach((x) => {
      const url = safeURL(x.getAttribute("src"));
      x.replaceWith(doc.createTextNode(url ? `
[内嵌图片](${url})
` : ""));
    });
    doc.querySelectorAll("br").forEach((x) => x.replaceWith(doc.createTextNode("\n")));
    doc.querySelectorAll("p,div,li").forEach((x) => x.appendChild(doc.createTextNode("\n")));
    return doc.body.textContent.trim();
  }
  __name(htmlText, "htmlText");

  // src/capture/drafts.js
  function renderCaptureTemplate(template, values, optionalFields = []) {
    return template.replace(/{{([A-Za-z][A-Za-z\d]*)}}/g, (_, field) => {
      const value = values[field];
      if (value === void 0 || value === null || value === "") {
        if (optionalFields.includes(field)) return "";
        throw Error(`生成任务草稿缺少字段 ${field}`);
      }
      return String(value);
    });
  }
  __name(renderCaptureTemplate, "renderCaptureTemplate");
  function sourceMarker(sourceKey) {
    return `[Source:${sourceKey}]`;
  }
  __name(sourceMarker, "sourceMarker");
  function profileShareUrl(profile, values) {
    if (!profile.links?.shareTemplate) return "";
    try {
      const link = locationOf(renderCaptureTemplate(profile.links.shareTemplate, {
        ...values,
        scopeId: values.scopeId ? encodeURIComponent(values.scopeId) : "",
        recordId: values.recordId ? encodeURIComponent(values.recordId) : ""
      }));
      return link?.protocol === "https:" && profile.allowedOrigins.includes(link.origin) ? link.href : "";
    } catch {
      return "";
    }
  }
  __name(profileShareUrl, "profileShareUrl");
  function buildCapturedDraft(record, profile) {
    const values = {
      siteId: record.siteId,
      scopeId: record.scopeId,
      recordId: record.recordId,
      number: record.number,
      title: record.title
    };
    const titleTemplate = values.number === void 0 || values.number === null || values.number === "" ? profile.draft.titleTemplate.replace(/#\s*{{number}}\s*/g, "") : profile.draft.titleTemplate;
    const title = renderCaptureTemplate(titleTemplate, values, ["number"]);
    const sourceKey = renderCaptureTemplate(profile.dedup.keyTemplate, {
      ...values,
      scopeId: encodeURIComponent(record.scopeId),
      recordId: encodeURIComponent(record.recordId)
    });
    const source = locationOf(record.sourceUrl);
    const sourceUrl = source && profile.allowedOrigins.includes(source.origin) && source.protocol === "https:" ? source.href : "";
    const blocks = (record.descriptionBlocks || []).filter((block) => typeof block?.text === "string" && block.text.trim()).map((block) => `${block.heading || "内容"}：
${block.text.trim()}`);
    const detailText = record.descriptionText || captureHtmlText(record.descriptionHtml);
    const shareUrl = profileShareUrl(profile, values);
    const attachmentLinks = (record.attachments || []).filter((item) => safeURL(item.url)).map((item) => `${item.remoteImage || item.image ? "!" : ""}[${String(item.name).replace(/[\[\]\\\r\n]/g, "_")}](${item.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`).join("\n");
    const customDescription = profile.draft.descriptionTemplate?.replace(/{{([A-Za-z][A-Za-z\d]*)}}/g, (_, key) => String({ ...record.fields, ...values, description: detailText, sourceUrl, shareUrl, attachmentLinks }[key] ?? ""));
    const description = [
      sourceMarker(sourceKey),
      customDescription ?? (sourceUrl ? `来源：${sourceUrl}` : ""),
      !customDescription && shareUrl ? `只读分享：${shareUrl}` : "",
      !customDescription && detailText ? `详细描述：
${detailText}` : "",
      ...blocks,
      ...(record.attachmentWarnings || []).map((warning) => `附件未包含：${warning}`)
    ].filter(Boolean).join("\n\n");
    return {
      sourceKey,
      siteId: record.siteId,
      scopeId: record.scopeId,
      recordId: record.recordId,
      sourceUrl,
      title,
      description,
      detail: record.detail === true,
      attachments: [...record.attachments || []]
    };
  }
  __name(buildCapturedDraft, "buildCapturedDraft");
  function manualFingerprint(url, text) {
    let hash = 2166136261;
    for (const char of `${url}
${text}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  __name(manualFingerprint, "manualFingerprint");
  function buildManualDraft({ title, text, url }) {
    const source = locationOf(url);
    if (source?.protocol !== "https:" || !source.hostname) throw Error("手动捕获仅支持 HTTPS 网页");
    const selected = String(text || "").trim();
    if (!selected) throw Error("请先在网页选中要提交的可见内容");
    if (selected.length > 2e5) throw Error("选中内容过长，请缩小范围后重试");
    return {
      siteId: "manual",
      scopeId: source.origin,
      recordId: "",
      sourceKey: "",
      fingerprint: manualFingerprint(source.href, selected),
      sourceUrl: source.href,
      title: String(title || selected.split("\n")[0]).trim().slice(0, 180),
      description: `来源：${source.href}

选取内容：
${selected}`,
      attachments: []
    };
  }
  __name(buildManualDraft, "buildManualDraft");
  function buildPageCaptureDraft(profile, { title, url, text = "" }) {
    if (!["text", "blank"].includes(profile?.captureMode) || !matchProfilePage(profile, url)) throw Error("当前页面不匹配文本或空白站点配置");
    const selected = String(text).trim();
    if (selected.length > 2e5) throw Error("选中内容过长，请缩小范围后重试");
    const values = { pageTitle: String(title || ""), pageUrl: new URL(url).href, selectedText: selected };
    const defaults = profile.captureMode === "text" ? PAGE_TEXT_TEMPLATE.draft : PAGE_BLANK_TEMPLATE.draft;
    const render = /* @__PURE__ */ __name((template) => template.replace(/{{(pageTitle|pageUrl|selectedText)}}/g, (_, key) => values[key]), "render");
    const draftTitle = render(profile.draft?.titleTemplate ?? defaults.titleTemplate).slice(0, 180);
    const description = render(profile.draft?.descriptionTemplate ?? defaults.descriptionTemplate);
    if (description.length > 2e5) throw Error("模板生成内容过长，请缩小选区或模板");
    return {
      siteId: "manual",
      scopeId: new URL(url).origin,
      recordId: "",
      sourceKey: "",
      sourceUrl: values.pageUrl,
      title: draftTitle,
      description,
      fingerprint: manualFingerprint(values.pageUrl, selected || description),
      attachments: [],
      draftId: crypto.randomUUID(),
      captureProfile: structuredClone(profile)
    };
  }
  __name(buildPageCaptureDraft, "buildPageCaptureDraft");
  function manualDraftContext(draft, profile, url) {
    if (draft?.siteId === "manual" && draft.captureProfile && draft.sourceUrl)
      return { url: draft.sourceUrl, profile: draft.captureProfile };
    return { url, profile: profile?.captureMode && profile.captureMode !== "api" ? profile : null };
  }
  __name(manualDraftContext, "manualDraftContext");
  function buildTypedManualDraft({ title, description, url, previous, sourceDraft }) {
    if (!String(title || "").trim()) throw Error("请填写任务标题");
    if (!String(description || "").trim()) throw Error("请填写任务描述");
    const draft = buildManualDraft({ title, text: description, url });
    const unchanged = /* @__PURE__ */ __name((item) => item?.siteId === "manual" && item.sourceUrl === draft.sourceUrl && item.title === title && item.description === description, "unchanged");
    const fingerprint = [sourceDraft, previous].find((item) => unchanged(item) && item.fingerprint)?.fingerprint || draft.fingerprint;
    return { ...draft, title, description, fingerprint, draftId: unchanged(previous) ? previous.draftId : crypto.randomUUID() };
  }
  __name(buildTypedManualDraft, "buildTypedManualDraft");
  function selectedVisibleText(selection, panelRoot) {
    if (!selection?.rangeCount || selection.isCollapsed) throw Error("请先在网页选中要提交的可见内容");
    if (panelRoot?.contains(selection.anchorNode) || panelRoot?.contains(selection.focusNode))
      throw Error("请在原网页选取内容，不要选中工作台文字");
    const excluded = 'input,textarea,select,script,style,iframe,object,[hidden],[aria-hidden="true"]';
    for (const node of [selection.anchorNode, selection.focusNode]) {
      if (node?.parentElement?.closest(excluded)) throw Error("选取范围包含表单或隐藏内容，请重新选取");
    }
    if (selection.getRangeAt(0).cloneContents().querySelector(excluded))
      throw Error("选取范围包含表单或隐藏内容，请重新选取");
    return selection.toString().trim();
  }
  __name(selectedVisibleText, "selectedVisibleText");
  function capturePreviewUpdate(currentKey, nextKey, titleGenerated, descriptionGenerated) {
    const changedRecord = currentKey !== nextKey;
    return { title: changedRecord || titleGenerated, description: changedRecord || descriptionGenerated };
  }
  __name(capturePreviewUpdate, "capturePreviewUpdate");
  function needsCapturedDetail(draft) {
    return draft?.siteId !== "manual";
  }
  __name(needsCapturedDetail, "needsCapturedDetail");
  function snapshotTaskDraft(draft, profile = null, bug = null) {
    return {
      ...structuredClone(draft),
      profile: profile ? structuredClone(profile) : null,
      legacyBug: bug ? structuredClone(bug) : null
    };
  }
  __name(snapshotTaskDraft, "snapshotTaskDraft");
  function chooseCapturedRecord(records, { selected, preferred, manual }) {
    return [manual, preferred, selected].find((key) => records.has(key)) || records.keys().next().value || "";
  }
  __name(chooseCapturedRecord, "chooseCapturedRecord");

  // src/capture/records.js
  function normalizeProfileAttachments(profile, raw, values) {
    const attachments = [], attachmentWarnings = [];
    for (const rule of profile.attachments || []) {
      const content = profileValue(raw, rule.path);
      const items = rule.items ? Array.isArray(content) ? content.slice(0, 100) : [] : [content];
      for (const item of items) {
        if (rule.items?.extension && !/^(png|jpe?g|gif|webp|bmp)$/i.test(profileValue(item, rule.items.extension) || "")) continue;
        if (rule.items?.filter && profileValue(item, rule.items.filter.path) === rule.items.filter.notEquals) continue;
        const value = rule.items ? profileValue(item, rule.items.url) : item;
        if (typeof value !== "string" || !value.trim()) continue;
        try {
          const name = String(rule.items?.name && profileValue(item, rule.items.name) || rule.items && locationOf(value)?.pathname.split("/").pop() || renderCaptureTemplate(rule.filenameTemplate, values)).replace(/[\\/\r\n]/g, "_").slice(0, 180);
          if (rule.kind === "text") {
            if (value.length > rule.maxChars) {
              attachmentWarnings.push(`${rule.id} 超过 ${rule.maxChars} 字符上限`);
              continue;
            }
            attachments.push({ name, content: value, mimeType: "text/plain" });
          } else {
            const image = locationOf(value), allowedOrigins = rule.allowedOrigins || profile.allowedOrigins;
            if (value.length > 2048 || image?.protocol !== "https:" || !allowedOrigins.includes(image.origin) || image.username || image.password || image.hash) {
              attachmentWarnings.push(`${rule.id} 图片地址不属于配置允许的 HTTPS 站点`);
              continue;
            }
            attachments.push({ name, url: image.href, remoteImage: true, allowedOrigins: [...allowedOrigins], sourceSite: profile.id, transform: rule.transform });
          }
        } catch {
          attachmentWarnings.push(`${rule.id} 文件名缺少模板字段`);
        }
      }
    }
    return { attachments, attachmentWarnings };
  }
  __name(normalizeProfileAttachments, "normalizeProfileAttachments");
  function normalizeCapturedRecord(profile, raw, context = {}) {
    const field = /* @__PURE__ */ __name((name) => profileValue(raw, profile.record[name]), "field");
    let scopeId = field("scopeId"), recordId = field("recordId");
    const title = field("title");
    if (profile.adapter === "bugdone") {
      if (!scopeId) {
        const page = locationOf(context.sourceUrl);
        if (page && profile.allowedOrigins.includes(page.origin) && matchProfilePage(profile, page.href)) {
          const candidate = profileRouteParams(profile, page.href)?.projectId || page.pathname.match(/^\/cn\/bugManagement_([a-f\d]{32})\/?$/i)?.[1];
          if (BUGID.test(candidate || "")) scopeId = candidate;
        }
      }
      scopeId = typeof scopeId === "string" ? scopeId.toLowerCase() : scopeId;
      recordId = typeof recordId === "string" ? recordId.toLowerCase() : recordId;
    }
    if (!scopeId || !recordId || typeof title !== "string" || !title.trim()) return null;
    const values = {
      siteId: profile.id,
      scopeId: String(scopeId),
      recordId: String(recordId),
      number: field("number") ?? "",
      title
    };
    const { attachments, attachmentWarnings } = normalizeProfileAttachments(profile, raw, values);
    if (typeof field("descriptionText") === "string" && field("descriptionText").length > 2e4) attachmentWarnings.push("正文超过 20000 字符，任务中仅包含前 20000 字符；请打开来源查看完整正文");
    const source = locationOf(field("sourceUrl"));
    const sourceUrl = source && profile.allowedOrigins.includes(source.origin) && !source.username && !source.password && matchProfilePage(profile, source.href)?.kind === "detail" ? source.href : context.sourceUrl || "";
    return {
      siteId: profile.id,
      scopeId: String(scopeId),
      recordId: String(recordId),
      pageKind: context.kind || "list",
      detail: context.kind === "detail",
      sourceUrl,
      title,
      number: field("number") ?? "",
      descriptionHtml: field("descriptionHtml") || "",
      descriptionText: typeof field("descriptionText") === "string" ? field("descriptionText").slice(0, 2e4) : "",
      fields: Object.fromEntries(Object.entries(profile.record.fields || {}).map(([name, path]) => {
        const value = profileValue(raw, path);
        return [name, ["string", "number", "boolean"].includes(typeof value) ? String(value).slice(0, 2e4) : ""];
      })),
      descriptionBlocks: [],
      attachments,
      attachmentWarnings,
      logs: [],
      fieldSources: {},
      capturedAt: context.capturedAt || (/* @__PURE__ */ new Date()).toISOString(),
      completeness: context.kind === "detail" ? "detail" : "summary"
    };
  }
  __name(normalizeCapturedRecord, "normalizeCapturedRecord");
  function recordKey(record) {
    return [record.siteId, record.scopeId, record.recordId].map((value) => `${String(value).length}:${value}`).join("");
  }
  __name(recordKey, "recordKey");
  function mergeCapturedRecord(previous, next) {
    if (!previous) return next;
    if (recordKey(previous) !== recordKey(next)) throw Error("不能合并不同来源的记录");
    if (previous.detail && !next.detail) return previous;
    const merged = { ...previous, ...next, detail: previous.detail || next.detail };
    for (const [key, value] of Object.entries(next)) {
      if ((value === null || value === void 0 || value === "" || Array.isArray(value) && !value.length) && previous[key] !== void 0) merged[key] = previous[key];
    }
    return merged;
  }
  __name(mergeCapturedRecord, "mergeCapturedRecord");
  function collectStandardRecords(profile, entries, store, sourceUrl) {
    let count = 0;
    for (const { kind, item } of entries) {
      if (!profileIdentityMatches(profile, item, sourceUrl)) continue;
      const record = normalizeCapturedRecord(profile, item, { kind, sourceUrl });
      if (!record) continue;
      const key = recordKey(record);
      store.set(key, mergeCapturedRecord(store.get(key), record));
      count++;
    }
    return count;
  }
  __name(collectStandardRecords, "collectStandardRecords");

  // src/capture/matching.js
  function siteModeForUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return "unsupported";
      if (["www.bugdone.cn", "bugdone.cn"].includes(url.hostname)) return "bugdone";
      if (url.hostname === "apm.umeng.com") return "umeng";
      if (url.hostname === "github.com") return "github";
      return "manual";
    } catch {
      return "unsupported";
    }
  }
  __name(siteModeForUrl, "siteModeForUrl");
  function entryShouldShow(mode, profile) {
    return mode === "all" || mode !== "shortcut" && !!profile?.enabled;
  }
  __name(entryShouldShow, "entryShouldShow");
  function selectSiteProfile(profiles, url) {
    return profiles.filter((p) => matchProfilePage(p, url)).sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id))[0] || null;
  }
  __name(selectSiteProfile, "selectSiteProfile");
  function profileRouteParams(profile, url) {
    const page = matchProfilePage(profile, url), parsed = locationOf(url);
    if (!page || !parsed) return null;
    const parts = parsed.pathname.replace(/\/$/, "").split("/"), params = {};
    page.path.replace(/\/$/, "").split("/").forEach((part, i) => {
      if (part.startsWith(":")) params[part.slice(1)] = parts[i];
    });
    return params;
  }
  __name(profileRouteParams, "profileRouteParams");
  function profileIdentityMatches(profile, raw, url) {
    const identity = profile.identity;
    if (!identity) return true;
    const params = profileRouteParams(profile, url);
    if (!params) return false;
    const scopeId = String(profileValue(raw, profile.record.scopeId) || ""), recordId = String(profileValue(raw, profile.record.recordId) || "");
    if (identity.recordFormat === "positive-integer" && !/^[1-9]\d*$/.test(recordId) || identity.recordFormat === "hex32" && !/^[a-f\d]{32}$/i.test(recordId)) return false;
    try {
      if (identity.scopeTemplate && renderCaptureTemplate(identity.scopeTemplate, params).toLowerCase() !== scopeId.toLowerCase()) return false;
      if (identity.recordParam && params[identity.recordParam] && params[identity.recordParam] !== recordId) return false;
      if (identity.sourceTemplate) {
        const expected = renderCaptureTemplate(identity.sourceTemplate, { ...params, scopeId, recordId });
        const actual = profileValue(raw, profile.record.sourceUrl);
        if (typeof actual !== "string" || actual.toLowerCase() !== expected.toLowerCase()) return false;
      }
    } catch {
      return false;
    }
    return true;
  }
  __name(profileIdentityMatches, "profileIdentityMatches");
  function matchSiteCapture(profile, { url, method, bytes = 0, contentType = "" }) {
    if (!profile?.enabled) return null;
    const parsed = locationOf(url, profile.allowedOrigins[0]);
    if (!profile.allowedOrigins.includes(parsed?.origin)) return null;
    if (!parsed || contentType && !/\bjson\b|\+json\b/i.test(contentType)) return null;
    return (profile.captures || []).find((rule) => rule.method === String(method).toUpperCase() && rule.origin === parsed.origin && pathMatches(rule.path, parsed.pathname) && bytes <= rule.maxResponseBytes) || null;
  }
  __name(matchSiteCapture, "matchSiteCapture");
  function pathMatches(pattern, pathname) {
    const source = pattern.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part.split("*").map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join("/");
    return new RegExp(`^${source}/?$`, "i").test(pathname);
  }
  __name(pathMatches, "pathMatches");
  function matchProfilePage(profile, value) {
    if (!profile?.enabled) return null;
    const url = locationOf(value);
    if (!url || url.protocol !== "https:" || !profile.allowedOrigins.includes(url.origin)) return null;
    return profile.pages.find((page) => profile.captureMode && profile.captureMode !== "api" && page.path === "/**" || pathMatches(page.path, url.pathname)) || null;
  }
  __name(matchProfilePage, "matchProfilePage");
  function locationOf(url, base) {
    try {
      return new URL(String(url), base);
    } catch {
      return null;
    }
  }
  __name(locationOf, "locationOf");
  function extractProfileItems(rule, value) {
    let data = value;
    for (let i = 0; i < 2 && typeof data === "string"; i++) {
      try {
        data = JSON.parse(data);
      } catch {
        return [];
      }
    }
    if (!data || rule.success && profileValue(data, rule.success.path) !== rule.success.equals) return [];
    for (const variant of rule.variants) {
      const result = profileValue(data, variant.path);
      if (variant.type === "array" && Array.isArray(result)) return result.map((item) => variant.itemPath ? profileValue(item, variant.itemPath) : item).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({ kind: variant.kind, item }));
      if (variant.type === "object" && result && typeof result === "object" && !Array.isArray(result)) return [{ kind: variant.kind, item: result }];
    }
    return [];
  }
  __name(extractProfileItems, "extractProfileItems");
  function testProfileSample(profile, sample) {
    validateSiteProfile(profile);
    if (profile.captureMode && profile.captureMode !== "api") throw Error("文本或空白模式不使用接口响应试运行");
    const choices = profile.captures.map((rule) => ({ rule, entries: extractProfileItems(rule, sample) }));
    const selected = choices.find((choice) => choice.entries.length) || choices[0];
    const valid = selected.entries.filter(({ item, kind }) => normalizeCapturedRecord(profile, item, { kind }));
    return {
      ruleId: selected.rule.id,
      matched: selected.entries.length,
      valid: valid.length,
      detail: valid.filter((entry) => entry.kind === "detail").length,
      missingIdentity: selected.entries.length - valid.length
    };
  }
  __name(testProfileSample, "testProfileSample");

  // src/multica/tasks.js
  function buildIssueBody({ title, description, agent, project, status, priority, label, startDate, dueDate }) {
    if (!title?.trim() || !description?.trim()) throw Error("标题和描述不能为空");
    if (!UUID.test(agent || "")) throw Error("请选择处理智能体");
    if (startDate && dueDate && startDate > dueDate) throw Error("截止日期不能早于开始日期");
    const body = {
      title,
      description,
      status: status || "todo",
      priority: priority || "none",
      assignee_type: "agent",
      assignee_id: agent,
      allow_duplicate: false
    };
    if (project) body.project_id = project;
    if (label) body.label_ids = [label];
    if (startDate) body.start_date = startDate;
    if (dueDate) body.due_date = dueDate;
    return body;
  }
  __name(buildIssueBody, "buildIssueBody");
  function issueLabelState(issue, label) {
    if (!label) return "none";
    if (!Array.isArray(issue?.labels)) return "unknown";
    return issue.labels.some((item) => item?.id === label) ? "applied" : "missing";
  }
  __name(issueLabelState, "issueLabelState");
  function cacheKey(c, id) {
    return `task:${VERSION}:${c.api}:${c.workspace}:${id}`;
  }
  __name(cacheKey, "cacheKey");
  async function findExisting(api, id) {
    for (let offset = 0; offset < 5e3; offset += 50) {
      const r = await api("GET", `/api/issues/search?q=${encodeURIComponent(marker(id))}&include_closed=true&limit=50&offset=${offset}`);
      if (r.status !== 200 || !Array.isArray(r.data?.issues)) throw Error("查询已有任务失败；已停止创建以防重复");
      const hit = r.data.issues.find((x) => x.id && owns(x, id));
      if (hit) return hit;
      if (r.data.issues.length < 50) return null;
    }
    throw Error("搜索结果过多，无法确认是否重复；请人工核对");
  }
  __name(findExisting, "findExisting");
  async function lookupSubmittedIssue(api, item) {
    if (item.issueId) {
      const r = await api("GET", `/api/issues/${encodeURIComponent(item.issueId)}`);
      if (r.status === 200) {
        if (!r.data?.id || r.data.id !== item.issueId) throw Error("任务响应 ID 不匹配");
        if (item.api || owns(r.data, item.bugId)) return r.data;
      } else if (r.status !== 404) throw Error(`任务状态查询失败（HTTP ${r.status}）`);
    }
    return item.bugId ? findExisting(api, item.bugId) : null;
  }
  __name(lookupSubmittedIssue, "lookupSubmittedIssue");
  function issueStatusLabel(status) {
    const labels = { backlog: "待整理", todo: "待办", in_progress: "进行中", in_review: "待审核", done: "已完成", blocked: "已阻塞" };
    const value = typeof status === "string" ? status : status?.name;
    return labels[value] || value || "未知";
  }
  __name(issueStatusLabel, "issueStatusLabel");
  async function loadSubmittedStatuses(items, c, api, report) {
    let next = 0;
    const worker = /* @__PURE__ */ __name(async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item.workspace !== c.workspace || item.api && item.api !== c.api) {
          report(item, { kind: "unavailable" });
          continue;
        }
        try {
          const issue = await lookupSubmittedIssue(api, item);
          report(item, issue ? { kind: "ready", status: issue.status, issue } : { kind: "missing" });
        } catch (error) {
          report(item, { kind: "error", error });
        }
      }
    }, "worker");
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  }
  __name(loadSubmittedStatuses, "loadSubmittedStatuses");
  async function submitOnce({ c, bug, body, api, get, set, prepareBody }) {
    const key = cacheKey(c, bug.BugId);
    const record = get(key, null);
    if (record?.id) {
      const r2 = await api("GET", `/api/issues/${encodeURIComponent(record.id)}`);
      if (r2.status === 200 && owns(r2.data, bug.BugId)) return { issue: r2.data, existing: true };
      throw Error("已有本地关联，但任务暂时无法核验；请检查权限、归档或标题修改，已停止重复创建");
    }
    const hit = await findExisting(api, bug.BugId);
    if (hit) {
      set(key, { id: hit.id });
      return { issue: hit, existing: true };
    }
    if (record?.pending) throw Error("上次提交结果未确认，当前搜索仍未找到任务。请在 Multica 人工核对；脚本不会自动再次创建。");
    if (prepareBody) body = await prepareBody(body);
    set(key, { pending: true, time: (/* @__PURE__ */ new Date()).toISOString() });
    const r = await api("POST", "/api/issues", body);
    let issue;
    if (r.status === 201 && owns(r.data, bug.BugId) && r.data.id) issue = r.data;
    else if (r.status === 409 && r.data?.code === "active_duplicate_issue" && r.data.issue?.id && owns(r.data.issue, bug.BugId)) issue = r.data.issue;
    else {
      if ([400, 401, 403, 404, 422, 429].includes(r.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${r.status}）：${String(r.data?.error || "请在 Multica 核对后处理").slice(0, 250)}`);
    }
    set(key, { id: issue.id });
    return { issue, existing: r.status === 409 };
  }
  __name(submitOnce, "submitOnce");
  function issueHasSource(issue, mark) {
    return typeof issue?.title === "string" && (issue.title.includes(mark) || typeof issue.description === "string" && issue.description.includes(mark));
  }
  __name(issueHasSource, "issueHasSource");
  async function submitDraftOnce({ c, draft, body, api, get, set, prepareBody }) {
    if (!draft?.sourceKey) throw Error("缺少稳定来源键，不能执行自动查重创建");
    const mark = sourceMarker(draft.sourceKey);
    if (!issueHasSource(body, mark)) throw Error("标题或描述缺少来源标记，无法可靠查重；请在信息捕获中重新生成");
    const key = `task-source:${VERSION}:${c.api}:${c.workspace}:${draft.sourceKey}`;
    const saved = get(key, null);
    if (saved?.id) {
      const response2 = await api("GET", `/api/issues/${encodeURIComponent(saved.id)}`);
      if (response2.status === 200 && issueHasSource(response2.data, mark)) return { issue: response2.data, existing: true };
      throw Error("本地关联任务无法核验；已停止重复创建");
    }
    for (let offset = 0; offset < 5e3; offset += 50) {
      const path = `/api/issues/search?q=${encodeURIComponent(mark)}&include_closed=true&limit=50&offset=${offset}`;
      const response2 = await api("GET", path);
      if (response2.status !== 200 || !Array.isArray(response2.data?.issues)) throw Error("查询已有任务失败；已停止创建以防重复");
      const found = response2.data.issues.find((issue2) => issue2.id && issueHasSource(issue2, mark));
      if (found) {
        set(key, { id: found.id });
        return { issue: found, existing: true };
      }
      if (response2.data.issues.length < 50) break;
      if (offset === 4950) throw Error("搜索结果过多，无法确认是否重复；请人工核对");
    }
    if (saved?.pending) throw Error("上次提交结果未确认；请先在 Multica 核对，脚本不会自动重发");
    const prepared = prepareBody ? await prepareBody(body) : body;
    set(key, { pending: true, time: (/* @__PURE__ */ new Date()).toISOString() });
    const response = await api("POST", "/api/issues", prepared);
    let issue;
    if (response.status === 201 && response.data?.id && issueHasSource(response.data, mark)) issue = response.data;
    else if (response.status === 409 && response.data?.code === "active_duplicate_issue" && response.data.issue?.id && issueHasSource(response.data.issue, mark)) issue = response.data.issue;
    else {
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${response.status}）：${String(response.data?.error || "请在 Multica 核对后处理").slice(0, 250)}`);
    }
    set(key, { id: issue.id });
    return { issue, existing: response.status === 409 };
  }
  __name(submitDraftOnce, "submitDraftOnce");
  async function submitManualOnce({ c, draft, body, api, get, set, prepareBody }) {
    if (!draft?.draftId || draft.sourceKey) throw Error("手动草稿缺少本次捕获标识");
    const key = `task-manual:${VERSION}:${c.api}:${c.workspace}:${draft.draftId}`;
    const saved = get(key, null);
    if (saved?.id) {
      const response2 = await api("GET", `/api/issues/${encodeURIComponent(saved.id)}`);
      if (response2.status === 200 && response2.data?.id === saved.id) return { issue: response2.data, existing: true };
      throw Error("本次手动草稿的已提交任务暂时无法核验；已停止重复创建");
    }
    if (saved?.pending) throw Error("本次手动草稿的提交结果未确认；请先在 Multica 核对");
    const prepared = prepareBody ? await prepareBody(body) : body;
    set(key, { pending: true, time: (/* @__PURE__ */ new Date()).toISOString() });
    const response = await api("POST", "/api/issues", prepared);
    if (response.status !== 201 || !response.data?.id) {
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${response.status}）；请在 Multica 核对后再操作`);
    }
    set(key, { id: response.data.id });
    return { issue: response.data, existing: false };
  }
  __name(submitManualOnce, "submitManualOnce");
  function submitTaskOnce(options) {
    if (options.draft.legacyBug) {
      if (!owns(options.body, options.draft.legacyBug.BugId)) throw Error("任务标题缺少 BugDone 查重标记，请在信息捕获中重新生成");
      return submitOnce({ ...options, bug: options.draft.legacyBug });
    }
    return options.draft.sourceKey ? submitDraftOnce(options) : submitManualOnce(options);
  }
  __name(submitTaskOnce, "submitTaskOnce");

  // src/history/sites.js
  function submittedSourceUrl(item) {
    const safe = /* @__PURE__ */ __name((value) => {
      const url = locationOf(value);
      return url?.protocol === "https:" && !url.username && !url.password ? url.href : "";
    }, "safe");
    for (const value of [item?.detailUrl, item?.sourceUrl]) {
      const url = safe(value);
      if (url) return url;
    }
    const key = String(item?.sourceKey || "");
    let match = key.match(/^bugdone:([a-f\d]{32}):([a-f\d]{32})$/i);
    if (match) return shareURL({ ProjectId: match[1], BugId: match[2] });
    match = key.match(/^umeng-apm-crash:([a-f\d]{24}):(\d{5,25})$/i);
    if (match) return `https://apm.umeng.com/platform/${match[1]}/error_analysis/crash/detail/${match[2]}`;
    match = key.match(/^github-issues:([^:]+):([1-9]\d*)$/);
    if (match) {
      try {
        const parts = decodeURIComponent(match[1]).split("/");
        if (parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."))
          return `https://github.com/${parts.map(encodeURIComponent).join("/")}/issues/${match[2]}`;
      } catch (_) {
      }
    }
    return "";
  }
  __name(submittedSourceUrl, "submittedSourceUrl");
  function processingPageSite(url, profiles) {
    const parsed = locationOf(url);
    if (!parsed || parsed.protocol !== "https:") return { key: "unknown", label: "未识别来源" };
    const candidates = profiles.map((p) => ({ ...p, enabled: true }));
    const profile = selectSiteProfile(profiles, url) || selectSiteProfile(candidates, url) || profiles.find((p) => p.enabled && p.allowedOrigins.includes(parsed.origin)) || candidates.find((p) => p.allowedOrigins.includes(parsed.origin));
    return profile ? { key: `profile:${profile.id}`, label: profile.metadata?.name || profile.id } : { key: `origin:${parsed.origin}`, label: parsed.hostname };
  }
  __name(processingPageSite, "processingPageSite");
  function processingItemSite(item, profiles) {
    const id = item.captureSiteId || (item.siteId && item.siteId !== "manual" ? item.siteId : "") || (item.bugId ? "bugdone" : profiles.find((p) => item.sourceKey?.startsWith(p.id + ":"))?.id);
    if (id) return { key: `profile:${id}`, label: profiles.find((p) => p.id === id)?.metadata?.name || item.captureSiteName || id };
    return processingPageSite(submittedSourceUrl(item), profiles);
  }
  __name(processingItemSite, "processingItemSite");
  function processingSiteView(items, profiles, url, selection, previousPageKey) {
    const page = processingPageSite(url, profiles), options = /* @__PURE__ */ new Map([["all", { key: "all", label: "全部站点", count: items.length }]]);
    for (const profile of profiles) options.set(`profile:${profile.id}`, { key: `profile:${profile.id}`, label: profile.metadata?.name || profile.id, count: 0 });
    if (!options.has(page.key)) options.set(page.key, { ...page, count: 0 });
    const grouped = items.map((item) => ({ item, site: processingItemSite(item, profiles) }));
    for (const { site } of grouped) {
      if (!options.has(site.key)) options.set(site.key, { ...site, count: 0 });
      options.get(site.key).count++;
    }
    const selected = previousPageKey === page.key && options.has(selection) ? selection : page.key;
    return { pageKey: page.key, selected, options: [...options.values()], items: grouped.filter((x) => selected === "all" || x.site.key === selected).map((x) => x.item) };
  }
  __name(processingSiteView, "processingSiteView");
  function draftSourceDetailUrl(draft) {
    const profile = draft.profile || BUILTIN_PROFILES.find((p) => p.id === draft.siteId);
    const detailUrl = profile ? profileShareUrl(profile, {
      siteId: draft.siteId,
      scopeId: draft.scopeId,
      recordId: draft.recordId,
      number: draft.number
    }) : "";
    return submittedSourceUrl({ detailUrl, sourceUrl: draft.sourceUrl, sourceKey: draft.sourceKey });
  }
  __name(draftSourceDetailUrl, "draftSourceDetailUrl");

  // src/sites/umeng.js
  function buildUmengDraft(record, stackMode = "summary", profile = UMENG_PROFILE) {
    const draft = buildCapturedDraft(record, profile);
    const policy = profile.processors?.stack || { maxStacks: 2, maxLines: 40, maxChars: 4e3 };
    const behavior = (record.logs || []).filter((log) => log.kind === "behavior" && log.text);
    const stacks = (record.logs || []).filter((log) => log.kind === "stack" && log.text);
    const logText = behavior.map((log) => `行为日志 (${log.id})：
${log.text}`).join("\n\n");
    draft.description = [draft.description, logText].filter(Boolean).join("\n\n");
    if (stackMode === "full") {
      draft.attachments = stacks.map((log, index) => ({
        name: `umeng-stack-${record.recordId}-${index + 1}-full.txt`,
        content: log.text,
        mimeType: "text/plain"
      }));
    } else if (stacks.length) {
      const excerpts = stacks.slice(0, policy.maxStacks).map((log, index) => {
        const embeddedSymbolicated = log.text.match(/(?:^|\n\n)符号化堆栈：\n([\s\S]*)$/);
        const source = String(log.afterStack || embeddedSymbolicated?.[1] || log.originStack || log.text).trim();
        const lines = source.split(/\r?\n/);
        const excerpt = lines.slice(0, policy.maxLines).join("\n").slice(0, policy.maxChars);
        const omitted = lines.length > policy.maxLines || source.length > excerpt.length ? "\n（其余堆栈帧已省略；可切换完整版）" : "";
        return `堆栈 ${index + 1} · ${log.id} · ${log.afterStack || embeddedSymbolicated ? "符号化" : "原始"}
${excerpt}${omitted}`;
      });
      if (stacks.length > policy.maxStacks) excerpts.push(`另有 ${stacks.length - policy.maxStacks} 种堆栈未包含；可切换完整版。`);
      draft.attachments = [{
        name: `umeng-stack-${record.recordId}-summary.txt`,
        content: excerpts.join("\n\n"),
        mimeType: "text/plain"
      }];
    } else draft.attachments = [];
    return draft;
  }
  __name(buildUmengDraft, "buildUmengDraft");
  function createUmengCaptureState() {
    return { records: /* @__PURE__ */ new Map(), pendingLogs: /* @__PURE__ */ new Map(), pendingStacks: /* @__PURE__ */ new Map(), stackOwners: /* @__PURE__ */ new Map(), logCounts: /* @__PURE__ */ new Map(), loadedLogIds: /* @__PURE__ */ new Map() };
  }
  __name(createUmengCaptureState, "createUmengCaptureState");
  function umengRoute(sourceUrl) {
    const url = locationOf(sourceUrl);
    if (url?.origin !== "https://apm.umeng.com") return null;
    const match = url.pathname.match(/^\/platform\/([a-f\d]{24})\/error_analysis\/crash(?:\/detail\/(\d{5,25}))?\/?$/i);
    return match ? { appId: match[1], errorId: match[2] || "" } : null;
  }
  __name(umengRoute, "umengRoute");
  function addCapturedLog(state, key, log) {
    const record = state.records.get(key);
    if (!record || !log.text) return;
    const logs = record.logs.filter((item) => !(item.kind === log.kind && item.id === log.id));
    logs.push(log);
    state.records.set(key, { ...record, logs });
  }
  __name(addCapturedLog, "addCapturedLog");
  function attachUmengLogDetail(state, key, data) {
    if (data.logId) {
      const ids = state.loadedLogIds.get(key) || /* @__PURE__ */ new Set();
      ids.add(String(data.logId));
      state.loadedLogIds.set(key, ids);
      const record = state.records.get(key);
      if (record) state.records.set(key, { ...record, logDetailCoverage: {
        captured: ids.size,
        total: state.logCounts.get(key)?.total || 0
      } });
    }
    if (typeof data.pagesBehavior === "string" && data.pagesBehavior.trim())
      addCapturedLog(state, key, { kind: "behavior", id: String(data.logId), text: data.pagesBehavior });
    if (typeof data.stackMd5 !== "string" || !data.stackMd5) return;
    const owners = state.stackOwners.get(data.stackMd5) || /* @__PURE__ */ new Set();
    owners.add(key);
    state.stackOwners.set(data.stackMd5, owners);
    const pending = state.pendingStacks.get(data.stackMd5) || [];
    for (const stack of pending.filter((item) => item.ownerKey === key)) addCapturedLog(state, key, stack.log);
    const remaining = pending.filter((item) => item.ownerKey !== key);
    if (remaining.length) state.pendingStacks.set(data.stackMd5, remaining);
    else state.pendingStacks.delete(data.stackMd5);
  }
  __name(attachUmengLogDetail, "attachUmengLogDetail");
  function applyUmengCapture(state, response, meta, profile = UMENG_PROFILE) {
    if (typeof response === "string") {
      try {
        response = JSON.parse(response);
      } catch {
        return null;
      }
    }
    const rule = profile.captures.find((item) => item.id === meta?.ruleId);
    const route = umengRoute(meta?.sourceUrl);
    if (!rule || !route) return null;
    const entries = extractProfileItems(rule, response);
    if (!entries.length) return null;
    const request = meta.request || {};
    const scopeId = String(request.dataSourceId || route.appId);
    if (scopeId !== route.appId) return null;
    const routeKey = route.errorId ? recordKey({ siteId: profile.id, scopeId, recordId: route.errorId }) : "";
    if (rule.id === "umeng-error-stack") {
      const data = entries[0].item, key = String(request.key || "");
      if (!routeKey || !key || data.key !== key) return null;
      const text = [data.originStack && `原始堆栈：
${data.originStack}`, data.afterStack && `符号化堆栈：
${data.afterStack}`].filter(Boolean).join("\n\n");
      if (!text) return null;
      const log = { kind: "stack", id: key, text, originStack: data.originStack || "", afterStack: data.afterStack || "" };
      if (state.stackOwners.get(key)?.has(routeKey)) addCapturedLog(state, routeKey, log);
      else {
        const pending = state.pendingStacks.get(key) || [];
        pending.push({ ownerKey: routeKey, log });
        state.pendingStacks.set(key, pending.slice(-10));
      }
      return state.records.get(routeKey) || null;
    }
    if (rule.id === "umeng-log-list") {
      if (!routeKey || String(request.errorId) !== route.errorId) return null;
      state.logCounts.set(routeKey, { captured: entries.length, total: Number(response?.data?.total || entries.length) });
      const record = state.records.get(routeKey);
      if (record) state.records.set(routeKey, {
        ...record,
        logCoverage: state.logCounts.get(routeKey),
        logDetailCoverage: { captured: state.loadedLogIds.get(routeKey)?.size || 0, total: state.logCounts.get(routeKey).total }
      });
      return record || null;
    }
    if (rule.id === "umeng-log-detail") {
      if (!routeKey || String(request.errorId) !== route.errorId || String(request.logId || "") !== String(entries[0].item.logId || "")) return null;
      const data = entries[0].item;
      if (state.records.has(routeKey)) attachUmengLogDetail(state, routeKey, data);
      else {
        const pending = state.pendingLogs.get(routeKey) || [];
        pending.push(data);
        state.pendingLogs.set(routeKey, pending.slice(-10));
      }
      return state.records.get(routeKey) || null;
    }
    let latest = null;
    for (const { kind, item } of entries) {
      const id = String(item.id || "");
      if (!/^\d{5,25}$/.test(id) || rule.id === "umeng-error-detail" && (id !== route.errorId || String(request.errorId) !== id)) continue;
      const sourceUrl = `https://apm.umeng.com/platform/${scopeId}/error_analysis/crash/detail/${id}`;
      const record = normalizeCapturedRecord(profile, { ...item, __scopeId: scopeId }, { kind, sourceUrl });
      if (!record) continue;
      record.descriptionBlocks = [
        item.appVersion && { heading: "应用版本", text: String(item.appVersion) },
        item.lastHappenTime && { heading: "最近发生时间", text: String(item.lastHappenTime) }
      ].filter(Boolean);
      const key = recordKey(record);
      state.records.set(key, mergeCapturedRecord(state.records.get(key), record));
      const coverage = state.logCounts.get(key);
      if (coverage) state.records.set(key, {
        ...state.records.get(key),
        logCoverage: coverage,
        logDetailCoverage: { captured: state.loadedLogIds.get(key)?.size || 0, total: coverage.total }
      });
      for (const pending of state.pendingLogs.get(key) || []) attachUmengLogDetail(state, key, pending);
      state.pendingLogs.delete(key);
      latest = state.records.get(key);
    }
    return latest;
  }
  __name(applyUmengCapture, "applyUmengCapture");

  // src/ui/geometry.js
  function fitLaunchPosition(position, size, viewport) {
    const axis = /* @__PURE__ */ __name((value, start, extent, length) => {
      const margin = Math.min(8, Math.max(0, (extent - length) / 2));
      const minimum = start + margin, maximum = Math.max(minimum, start + extent - length - margin);
      return Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum));
    }, "axis");
    return {
      left: axis(position.left, viewport.left || 0, viewport.width, size.width),
      top: axis(position.top, viewport.top || 0, viewport.height, size.height)
    };
  }
  __name(fitLaunchPosition, "fitLaunchPosition");

  // src/platform/hooks.js
  function installRouteHooks(page, changed) {
    const restores = [];
    const notify = /* @__PURE__ */ __name(() => {
      try {
        changed();
      } catch (_) {
      }
    }, "notify");
    for (const method of ["pushState", "replaceState"]) {
      const original = page.history?.[method];
      if (typeof original !== "function") continue;
      const wrapped = /* @__PURE__ */ __name(function(...args) {
        const before = page.location.href;
        const result = original.apply(this, args);
        if (page.location.href !== before) notify();
        return result;
      }, "wrapped");
      page.history[method] = wrapped;
      restores.push(() => {
        if (page.history[method] === wrapped) page.history[method] = original;
      });
    }
    page.addEventListener("popstate", notify);
    page.addEventListener("hashchange", notify);
    return () => {
      restores.reverse().forEach((restore) => restore());
      page.removeEventListener("popstate", notify);
      page.removeEventListener("hashchange", notify);
    };
  }
  __name(installRouteHooks, "installRouteHooks");
  function installCaptureHooks(page, collectResponse, matches) {
    let stopped = false;
    const restores = [];
    const requests = /* @__PURE__ */ new WeakMap();
    const absoluteURL = /* @__PURE__ */ __name((value) => {
      try {
        return new URL(String(value), page.location?.href).href;
      } catch {
        return String(value);
      }
    }, "absoluteURL");
    const selectRequest = /* @__PURE__ */ __name((body, rule) => {
      if (!rule?.requestKeys?.length || typeof body !== "string" || body.length > 1e5) return {};
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return {};
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(rule.requestKeys.filter((key) => Object.hasOwn(parsed, key) && ["string", "number"].includes(typeof parsed[key])).map((key) => [key, parsed[key]]));
    }, "selectRequest");
    const deliver = /* @__PURE__ */ __name((value, rule, request, sourceUrl) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (stopped || typeof text !== "string" || new TextEncoder().encode(text).byteLength > (rule?.maxResponseBytes || 4e6)) return;
      collectResponse(value, { ruleId: rule?.id || "", request, sourceUrl });
    }, "deliver");
    const prototype = page.XMLHttpRequest?.prototype;
    if (prototype) {
      const originalOpen = prototype.open, originalSend = prototype.send;
      prototype.open = function(method, url, ...args) {
        requests.set(this, { method: String(method).toUpperCase(), url: String(url) });
        return originalOpen.call(this, method, url, ...args);
      };
      prototype.send = function(...args) {
        const request = requests.get(this);
        const rule = !stopped && request && matches(absoluteURL(request.url), request.method);
        const selected = selectRequest(args[0], rule);
        const sourceUrl = page.location?.href || "";
        if (rule) this.addEventListener("load", function() {
          if (this.status !== 200) return;
          try {
            deliver(this.responseType === "json" ? this.response : this.responseText, rule, selected, sourceUrl);
          } catch (_) {
          }
        }, { once: true });
        return originalSend.apply(this, args);
      };
      const wrappedOpen = prototype.open, wrappedSend = prototype.send;
      restores.push(() => {
        if (prototype.open === wrappedOpen) prototype.open = originalOpen;
        if (prototype.send === wrappedSend) prototype.send = originalSend;
      });
    }
    if (typeof page.fetch === "function") {
      const originalFetch = page.fetch;
      page.fetch = function(...args) {
        const result = originalFetch.apply(this, args);
        const input = args[0];
        const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
        const method = String(args[1]?.method || input?.method || "GET").toUpperCase();
        const rule = !stopped && matches(absoluteURL(url), method), selected = selectRequest(args[1]?.body, rule);
        const sourceUrl = page.location?.href || "";
        if (rule) Promise.resolve(result).then(async (response) => {
          if (response.ok) deliver(await response.clone().text(), rule, selected, sourceUrl);
        }).catch(() => {
        });
        return result;
      };
      const wrappedFetch = page.fetch;
      restores.push(() => {
        if (page.fetch === wrappedFetch) page.fetch = originalFetch;
      });
    }
    return { xhr: !!prototype, fetch: typeof page.fetch === "function", stop() {
      stopped = true;
      restores.reverse().forEach((restore) => restore());
    } };
  }
  __name(installCaptureHooks, "installCaptureHooks");

  // src/config/preferences.js
  function shortcutFromEvent(event) {
    const key = String(event.key || "").toUpperCase();
    if (!/^[A-Z0-9]$/.test(key) || !(event.altKey || event.ctrlKey || event.metaKey)) return "";
    return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.metaKey && "Meta", event.shiftKey && "Shift", key].filter(Boolean).join("+");
  }
  __name(shortcutFromEvent, "shortcutFromEvent");
  function shortcutMatches(event, shortcut) {
    return !!shortcut && shortcutFromEvent(event) === shortcut;
  }
  __name(shortcutMatches, "shortcutMatches");
  function capturePreferences(value = {}) {
    return {
      captureEnabled: value.captureEnabled !== false,
      defaultImageMode: value.defaultImageMode === "original" ? "original" : "compressed",
      defaultLogMode: value.defaultLogMode === "full" ? "full" : "summary",
      autoCaptureAttachments: value.autoCaptureAttachments !== false
    };
  }
  __name(capturePreferences, "capturePreferences");
  function nextDraftAttachments(current, candidates, { previousKey, key, include }) {
    return previousKey === key ? [...current] : include ? [...candidates] : [];
  }
  __name(nextDraftAttachments, "nextDraftAttachments");
  function restorePreferenceDefaults(saved, workspaces = [], catalog = {}) {
    const first = /* @__PURE__ */ __name((list) => (Array.isArray(list) ? list : []).find((item) => item?.id && item.is_archived !== true), "first");
    const workspace = first(workspaces), project = workspace && first(catalog.projects), agent = workspace && first(catalog.agents);
    return {
      ...capturePreferences({ captureEnabled: saved.captureEnabled }),
      api: saved.api,
      token: saved.token,
      umengCaptureEnabled: saved.umengCaptureEnabled ?? true,
      workspace: workspace?.id || "",
      workspaceAlias: workspace?.name || "",
      project: project?.id || "",
      projectAlias: project?.name || "",
      defaultAgent: agent?.id || "",
      agent: agent?.id || "",
      label: "",
      hideNativeAI: true,
      displayMode: "floating",
      entryVisibility: "configured",
      shortcut: DEFAULT_SHORTCUT,
      shortcutCustomized: false,
      projectCustomized: false,
      defaultAgentCustomized: false
    };
  }
  __name(restorePreferenceDefaults, "restorePreferenceDefaults");
  function normalizeShortcutConfig(saved) {
    return saved.shortcut === "Alt+Shift+M" && saved.shortcutCustomized !== true ? { ...saved, shortcut: DEFAULT_SHORTCUT } : saved;
  }
  __name(normalizeShortcutConfig, "normalizeShortcutConfig");

  // src/ui/styles.css
  var styles_default = ':host{all:initial;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#243247;font-size:14px;line-height:1.5;color-scheme:light}\n*,*::before,*::after{box-sizing:border-box} [hidden]{display:none!important}\nbutton,input,select,textarea{font:inherit} button{cursor:pointer;border:1px solid transparent;border-radius:10px;background:#2563eb;color:#fff;padding:10px 16px;font-weight:600;transition:background .15s,box-shadow .15s}\nbutton:hover{background:#1d4ed8} button:disabled{opacity:.5;cursor:wait} button:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}\n#launch{position:fixed;right:24px;bottom:28px;z-index:2147483646;display:flex;align-items:center;gap:7px;padding:11px 17px;background:linear-gradient(to right,#fff,#F5F7FA,#EEF2F6,#E6EBF2);box-shadow:0 0 5px #00000024;color:#475569;font-size:14px;border:1px solid #e2e8f0;border-radius:10px;touch-action:none;user-select:none}\n#launch{width:max-content;max-width:calc(100vw - 16px)}#launch:hover{background:linear-gradient(to right,#fff,#F5F7FA,#EEF2F6);box-shadow:0 4px 18px #47556926} #launch img{width:22px;height:22px;object-fit:contain} .status-dot{width:6px;height:6px;border-radius:50%;background:#22c55e}\n#panel{position:fixed;right:24px;top:24px;bottom:88px;width:min(680px,calc(100vw - 48px));z-index:2147483647;display:flex;flex-direction:column;background:#f7f8fc;border:1px solid #e1e5ee;border-radius:20px;box-shadow:0 20px 70px #1e293b35;overflow:hidden}\nheader{display:flex;justify-content:space-between;align-items:center;padding:23px 24px 18px;background:#fff;gap:12px}.brand{display:flex;align-items:center;gap:12px}.brand-icon{width:42px;height:42px;padding:9px;border:1px solid #dbeafe;border-radius:13px;background:#eff6ff}.brand h2{font-size:19px;line-height:1.3;margin:0;letter-spacing:-.4px}.brand small{font-size:12px;color:#8993a3}.icon-button{background:#f4f5f8;color:#677489;font-size:22px;line-height:1;padding:8px 12px}.icon-button:hover{background:#e8eaf0}\n.tabs{display:flex;padding:0 24px;gap:20px;background:#fff;border-bottom:1px solid #e7eaf1;overflow-x:auto;scrollbar-width:thin}.tabs button{flex:none;border:0;border-bottom:3px solid transparent;border-radius:0;padding:13px 2px;color:#7c8697;background:transparent;white-space:nowrap}.tabs button[aria-selected=true]{color:#2563eb;border-bottom-color:#3b82f6}.tabs button:hover{color:#2563eb}\n.content{overflow-y:auto;min-height:0;flex:1;overscroll-behavior:contain;padding:22px 24px}.section-intro{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.eyebrow{font-size:11px;letter-spacing:1.6px;color:#9399aa;font-weight:700}.section-intro h3{margin:3px 0 0;font-size:17px;color:#273449}.badge{font-size:12px;padding:4px 9px;border-radius:20px;color:#2563eb;background:#eff6ff;white-space:nowrap}.empty{padding:30px 8px;text-align:center;color:#94a3b8}#processing-list{display:flex;flex-direction:column;gap:10px}.hint.processing-help{margin:0 0 14px}.processing-item{padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 1px 3px #0f172a08;transition:border-color .15s,box-shadow .15s}.processing-item:hover{border-color:#cbd5e1;box-shadow:0 3px 10px #0f172a0a}.processing-main{min-width:0}.processing-identifier{margin-bottom:5px;font-size:11px;line-height:1.5;color:#64748b;overflow-wrap:anywhere}.processing-title{font-size:14px;font-weight:600;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.processing-meta{margin-top:8px;color:#8791a3;font-size:11px;line-height:1.6;overflow-wrap:anywhere}.processing-bottom{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:10px;padding-top:9px;border-top:1px solid #f1f5f9}.processing-status{min-width:0;flex:1;font-size:12px;line-height:1.7;color:#64748b;overflow-wrap:anywhere}.processing-status[data-kind=ready]{color:#2563eb}.processing-status[data-kind=error]{color:#b45309}.processing-delete{flex:none}.processing-item-actions{flex:none;display:flex;align-items:center;gap:12px}.processing-item-actions .text-button{padding:0;line-height:1.7}.processing-detail{text-decoration:none;white-space:nowrap;font-size:12px}.processing-detail:disabled{cursor:not-allowed}.processing-heading{align-items:center}.processing-heading>div{flex:none}.processing-site-select{width:150px;text-align:right;text-align-last:right;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;max-width:calc(100% - 110px);margin-left:auto;font-size:13px;font-weight:400;padding:8px 10px}.processing-site-select option{text-align:right;text-align-last:right}.processing-actions{display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap;margin:-6px 0 12px;font-size:12px;color:#8290a5}.processing-actions .text-button{font-size:inherit;font-weight:400;line-height:inherit;color:#3b82f6}.processing-actions .text-button:hover{color:#1d4ed8}.success{position:fixed;left:50%;top:18%;transform:translate(-50%,-50%);z-index:2147483648;display:flex;align-items:center;gap:12px;min-width:290px;max-width:calc(100vw - 40px);padding:15px 18px;background:#fff;border:1px solid #bbf7d0;border-radius:14px;box-shadow:0 18px 55px #14532d30}.success-mark{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#22c55e;color:#fff;font-size:21px;font-weight:800}.success strong{display:block;color:#166534}.success-copy{display:block;margin-top:3px;color:#64748b;font-size:12px;white-space:pre-line}.success-pop{animation:success-pop .35s ease-out}@keyframes success-pop{0%{opacity:0;transform:translate(-50%,-65%) scale(.9)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}\n.card{padding:18px;border:1px solid #e5e8f0;background:#fff;border-radius:14px;margin-bottom:16px}.card-title{font-weight:650;margin:0 0 12px}.field{margin-top:16px}.field:first-child{margin-top:0}label{display:block;font-size:13px;font-weight:600;color:#46536a;margin:0 0 7px}input,select,textarea{width:100%;padding:10px 12px;border:1px solid #dce1ec;border-radius:9px;background:#fff;color:#273449;outline:none}input:focus,select:focus,textarea:focus{border-color:#60a5fa;box-shadow:0 0 0 3px #3b82f612}textarea{resize:vertical;line-height:1.7;font-size:13px}input[readonly]{background:#f8f9fc;color:#64748b;font-size:12px}.hint,small{font-size:12px;line-height:1.7;color:#8791a3}.hint{margin:7px 0 0}.row{display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap}.row.end{justify-content:flex-end}.secondary{background:#fff;border-color:#dfe3ed;color:#526075}.secondary:hover{background:#f1f3f9}.text-button{padding:4px 0;background:transparent;color:#3b82f6;font-size:12px}.text-button:hover{background:transparent;color:#1d4ed8}.label-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.label-row label{margin:0}\n.header-actions{display:flex;align-items:center;gap:8px}.header-actions .text-button{white-space:nowrap}.header-actions .icon-button{font-size:17px}.task-title{font-size:20px;font-weight:650;border:0;padding:8px 0}.task-description{min-height:250px;border:0;padding:8px 0;resize:vertical}.task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.task-grid .field{margin:0}.settings-category{box-shadow:0 1px 3px #0f172a08}.settings-group{border-top:1px solid #edf0f5;padding-top:18px;margin-top:18px}.settings-group:first-child{border-top:0;padding-top:0;margin-top:0}.settings-group h4{margin:0 0 12px;font-size:14px}.inline-control{display:flex;gap:8px}.inline-control>*:first-child{flex:1;min-width:0}.inline-control button{white-space:nowrap}.link-note{padding:10px 12px;border:1px solid #e5e8f0;border-radius:9px;background:#f8f9fc;font-size:12px;color:#64748b;overflow-wrap:anywhere}@media(max-width:520px){.task-grid{grid-template-columns:1fr}.header-actions .text-button{font-size:11px}}\n.quick-card{padding:0;overflow:hidden}.quick-head,.quick-foot{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e8f0}.quick-head strong{font-size:16px;color:#536078}.quick-head small{color:#9ca3af}.quick-body{padding:18px}.quick-body .task-title{font-size:23px;width:100%;border:0;border-bottom:1px solid #dce1ec;border-radius:0;box-shadow:none;padding-bottom:16px;margin-bottom:8px}.quick-body .task-title:focus{border-bottom-color:#60a5fa}.quick-body .task-description{min-height:205px;width:100%;border:0;box-shadow:none}.quick-source{display:flex;justify-content:space-between;gap:10px;padding:12px;border:1px solid #e5e8f0;background:#f6f7f9;border-radius:9px;font-size:12px;color:#667085}.quick-source strong{color:#344054}.quick-assignee{display:flex;align-items:center;gap:10px;margin:14px 0;color:#667085}.quick-avatar{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:#eceff2;color:#4b5563;font-weight:700}.quick-options{display:flex;flex-wrap:wrap;gap:8px}.quick-options select,.quick-options .more-button{width:auto;max-width:230px;border-radius:24px;padding:9px 12px;font-size:12px}.quick-dates{margin-top:14px;border-top:1px solid #edf0f5;padding-top:12px}.quick-dates summary{font-size:12px;color:#667085;cursor:pointer}.quick-foot{border-top:1px solid #e5e8f0;border-bottom:0;gap:8px;flex-wrap:wrap}.quick-foot label{display:flex;align-items:center;gap:6px;margin:0;font-weight:400;font-size:12px}.quick-foot input{width:17px;height:17px;accent-color:#2563eb}.quick-foot .submit{width:auto;margin:0}.quick-foot .text-button{font-size:20px}.custom-server-panel{margin-top:10px;padding:12px;border:1px solid #e5e8f0;border-radius:9px;background:#f8f9fc}\nheader .brand{min-width:0;flex:1}header .header-actions{flex:none;gap:4px}header .header-actions .icon-button{font-size:16px;padding:7px 9px}header .header-actions .text-button{padding:4px 6px}\n#view-multica{height:100%;min-height:max-content;display:flex;flex-direction:column}#view-multica .quick-card{flex:1 0 auto;display:flex;flex-direction:column;margin-bottom:0}#view-multica .quick-body{flex:1 0 auto;display:flex;flex-direction:column}#view-multica .task-description{flex:1 0 260px;height:auto;min-height:260px}\n#panel[data-display="sidebar"]{position:fixed;top:0;right:0;bottom:0;left:auto;width:min(520px,calc(100vw - 320px));height:100dvh;border-radius:0;border-top:0;border-right:0;border-bottom:0;box-shadow:-12px 0 48px #1e293b26;transform:translateX(102%);transition:transform .26s ease}\n#panel[data-display="sidebar"][data-open="true"]{transform:translateX(0)}\n.settings-heading{flex-wrap:wrap}.settings-heading button{white-space:nowrap}.settings-heading small{display:block;margin-top:5px}.settings-heading [data-kind=success]{color:#15803d}.settings-heading [data-kind=error]{color:#b91c1c}.settings-heading [data-kind=warning]{color:#b45309}.settings-reset-dialog{width:min(440px,calc(100vw - 40px));border:1px solid #dce1ec;border-radius:16px;padding:22px;color:#334155;box-shadow:0 24px 80px #0f172a40}.settings-reset-dialog::backdrop{background:#0f172a66}.settings-reset-dialog h3{margin:0 0 14px}.settings-reset-dialog p{font-size:13px;line-height:1.8}.shortcut-control{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.shortcut-control input{width:126px;font-size:12px;text-align:center}.shortcut-control button{padding:8px 9px;font-size:11px}\n.setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid #e5e8f0}.setting-row:last-child{border-bottom:0}.setting-copy{min-width:0}.setting-copy strong{display:block;font-size:13px;color:#273449}.setting-copy small{display:block;margin-top:4px}.setting-control{flex:none}.switch{position:relative;display:inline-flex;align-items:center;width:44px;height:26px;margin:0;cursor:pointer}.switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}.switch-track{width:44px;height:26px;border-radius:20px;background:#cbd5e1;transition:background .15s}.switch-track::after{content:"";display:block;width:20px;height:20px;margin:3px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #1e293b33;transition:transform .15s}.switch input:checked+.switch-track{background:#2563eb}.switch input:checked+.switch-track::after{transform:translateX(18px)}.switch input:focus-visible+.switch-track{outline:3px solid #93c5fd;outline-offset:2px}.segmented{display:flex;padding:3px;border:1px solid #dce1ec;border-radius:9px;background:#f1f3f6}.segmented button{padding:8px 12px;border:0;background:transparent;color:#64748b;font-size:12px;white-space:nowrap}.segmented button:hover{background:#e5eaf2}.segmented button[aria-pressed="true"]{background:#fff;color:#1e293b;box-shadow:0 1px 4px #1e293b1c}.settings-group>.hint{margin:0 0 4px}.settings-group .field>.hint{margin:4px 0 0}.profile-intro{margin:0 0 16px}.profile-json-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:7px}.profile-json-heading label{margin:0}.profile-template-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}.profile-template-actions select{width:auto;max-width:180px;padding:7px 10px;font-size:12px}.profile-template-actions button{padding:8px 11px;font-size:12px}.profile-template-actions :disabled{opacity:.45;cursor:not-allowed}.profile-guide{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:9px 12px;margin:12px 0 0;font-size:12px}.profile-guide dt{font-weight:700;color:#334155;overflow-wrap:anywhere}.profile-guide dd{margin:0;color:#64748b;overflow-wrap:anywhere}.profile-guide dt:not(:first-child),.profile-guide dd:not(:nth-child(2)){padding-top:8px;border-top:1px solid #edf0f5}\n.builtin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}.capture-sites-heading{margin-top:18px;font-size:13px}.builtin-card{position:relative;min-width:0;padding:12px;border-radius:12px;background:#f8fbff;border:1px solid #dbeafe;color:#273449}.builtin-open{display:grid;gap:4px;width:100%;padding:0 52px 0 0;text-align:left;border:0;background:transparent;color:inherit;border-radius:4px}.builtin-open:hover{background:transparent}.builtin-switch{position:absolute;right:12px;top:12px}.builtin-card:hover{background:#eff6ff}.builtin-card strong{font-size:13px}.builtin-card small{font-size:11px;color:#71839a}.builtin-open span{font-size:11px;color:#2563eb}@media(max-width:560px){.builtin-grid{grid-template-columns:1fr}}\n#task-extras>summary{display:none}.quick-foot #submit{margin-left:auto}.quick-source #task-source{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}.quick-options select:hover{border-color:#b7becb}.quick-body .task-description:focus,.quick-body .task-title:focus{box-shadow:none}\n#count{margin:0 0 14px;font-size:12px;color:#8290a5}#warning{margin:10px 0 0;font-size:12px;line-height:1.7;color:#896a31}#handoff-title{margin:0;color:#334155;font-weight:600;overflow-wrap:anywhere}#handoff-meta{margin:8px 0 0}.target{display:grid;gap:4px;overflow-wrap:anywhere}.target small{font-size:11px;text-transform:uppercase;letter-spacing:.8px}.target strong{font-weight:500;font-size:13px}.divider{height:1px;background:#edf0f5;margin:14px 0}.check{display:flex;align-items:flex-start;gap:9px;font-weight:400;line-height:1.7;margin-top:17px}.check input{width:16px;height:16px;flex:none;margin:3px 0;accent-color:#3b82f6}.check span{font-size:12px;color:#66758b}.submit{width:100%;margin-top:16px}\n.bug-action-bar{flex:none;display:flex;justify-content:flex-end;align-items:center;padding:12px 24px;background:#fff;border-top:1px solid #e7eaf1;box-shadow:0 -8px 20px #1e293b0a;z-index:1}\nfooter{flex:none;padding:12px 24px;background:#fff;border-top:1px solid #e7eaf1}#message{white-space:pre-wrap;margin:0;font-size:12px;color:#64748b;overflow-wrap:anywhere;max-height:110px;overflow:auto;display:flex;align-items:flex-start;gap:8px}#message::before{content:"";width:9px;height:9px;flex:none;margin-top:4px;border-radius:50%;background:#94a3b8}.status-success::before{background:#22c55e!important}.status-warning::before{background:#eab308!important}.status-error::before{background:#ef4444!important}details summary{cursor:pointer;font-size:13px;font-weight:600;color:#536078}details textarea{margin-top:12px}.version{font-size:11px;color:#9aa3b2;text-align:center;margin:18px 0 0}\n#success{right:auto;bottom:auto;margin:0;z-index:2147483647}\n.attachment-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.attachment-item{display:flex;align-items:center;gap:4px;padding:4px 6px;border:1px solid #dbeafe;background:#eff6ff;border-radius:8px;color:#315a9b;font-size:12px;max-width:100%}.attachment-item button{padding:2px 5px;border:0;background:transparent;color:#64748b;font-size:16px;line-height:1}.attachment-item button:hover{background:transparent;color:#b91c1c}.attachment-item .attachment-open{max-width:310px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1d4ed8;font-size:12px;text-align:left}.attachment-item .attachment-open:hover{color:#1e40af;text-decoration:underline}\n.attachment-mode{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.attachment-mode strong{font-size:13px;color:#46536a}.attachment-mode .segmented button{font-size:12px}#task-attachment-mode{margin:5px 0 0}\n.capture-attachments{margin-top:14px}.capture-attachments strong{font-size:13px;color:#46536a}.attachment-preview{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;padding:18px;background:#0f172a99}.attachment-preview-card{display:flex;flex-direction:column;width:min(100%,640px);max-height:100%;padding:16px;background:#fff;border-radius:14px;box-shadow:0 16px 50px #0f172a55}.attachment-preview-head{display:flex;align-items:center;gap:12px}.attachment-preview-head strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.attachment-preview-body{display:flex;align-items:center;justify-content:center;min-height:120px;overflow:auto;margin-top:12px;background:#f8fafc;border-radius:9px}.attachment-preview-body img{max-width:100%;max-height:65vh;object-fit:contain}.attachment-preview-body pre{width:100%;max-height:65vh;overflow:auto;margin:0;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;color:#334155;font-size:12px;line-height:1.6}.attachment-preview-link{align-self:flex-end;margin-top:12px;color:#2563eb;font-size:12px}\n@media(max-width:760px){#panel[data-display="sidebar"]{width:min(520px,100vw)}}@media(max-width:520px){#panel{right:8px;top:8px;bottom:76px;width:calc(100vw - 16px);border-radius:15px}#panel[data-display="sidebar"]{top:0;right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}header{padding:16px}.tabs{padding:0 16px;gap:22px;overflow-x:auto}.content{padding:16px}footer{padding:12px 16px}.card{padding:14px}.setting-row{align-items:flex-start}.setting-control{align-self:center}#launch{right:12px;bottom:16px}}\n';

  // src/ui/panel.html
  var panel_default = '<button id="launch" aria-expanded="false" aria-controls="panel"><img src="/Templates/Default/Images/ai.webp" alt=""><span class="launch-text">Multica-AI · 未配置</span><span class="status-dot" aria-hidden="true"></span></button>\n      <section id="panel" role="dialog" aria-label="Issues处理工作台" hidden>\n        <header><div class="brand"><img class="brand-icon" src="/Templates/Default/Images/ai.webp" alt=""><div><h2>Multica-AI</h2><small>Issues处理工作台</small></div></div><div class="header-actions"><button id="open-multica" class="text-button">打开 Multica</button><button id="refresh-connection" data-action class="icon-button" title="刷新连接" aria-label="刷新连接">↻</button><button id="close" class="icon-button" aria-label="关闭面板">×</button></div></header>\n        <nav class="tabs" role="tablist" aria-label="工作台栏目">\n          <button id="tab-bug" role="tab" data-tab="bug" aria-selected="true" aria-controls="view-bug">信息捕获</button>\n          <button id="tab-multica" role="tab" data-tab="multica" aria-selected="false" aria-controls="view-multica" tabindex="-1">AI任务创建</button>\n          <button id="tab-processing" role="tab" data-tab="processing" aria-selected="false" aria-controls="view-processing" tabindex="-1">处理列表</button>\n          <button id="tab-settings" role="tab" data-tab="settings" aria-selected="false" aria-controls="view-settings" tabindex="-1">设置</button>\n          <button id="tab-profiles" role="tab" data-tab="profiles" aria-selected="false" aria-controls="view-profiles" tabindex="-1">站点配置</button>\n        </nav>\n        <div class="content">\n          <section id="view-bug" role="tabpanel" aria-labelledby="tab-bug"><p id="capture-paused" class="hint" hidden>自动捕获已暂停，已有内容与草稿仍保留，可继续手动填写或在捕获设置中恢复。</p>\n            <div id="generic-capture" hidden>\n              <div class="section-intro"><div><div class="eyebrow">SOURCE CAPTURE</div><h3 id="capture-heading">信息捕获</h3></div><span id="capture-state" class="badge">待捕获</span></div>\n              <p id="capture-help" class="hint"></p>\n              <div id="umeng-selector" class="card" hidden><label for="capture-record">选择崩溃记录</label><select id="capture-record"></select><p id="capture-coverage" class="hint"></p></div>\n              <div id="umeng-stack-options" class="card" hidden><div class="attachment-mode"><strong>堆栈 TXT 版本</strong><div class="segmented" role="group" aria-label="堆栈 TXT 版本"><button id="umeng-stack-summary" type="button" aria-pressed="true" data-action>精简版</button><button id="umeng-stack-full" type="button" aria-pressed="false" data-action>完整版</button></div></div><p class="hint">精简版优先保留符号化堆栈，最多两种堆栈、每种前 40 行；完整版会上传捕获到的全部堆栈。</p></div>\n              <div id="manual-selector" class="card" hidden><p class="hint">先在网页中选中需要的可见文字，再点击捕获。仅在点击时读取选区，不监听接口或复制整页。</p><div class="row"><button id="capture-selection" type="button">捕获所选文字</button></div></div>\n              <div class="card"><div class="field"><div class="label-row"><label for="capture-title">任务标题草稿</label><button id="reset-page-capture" type="button" class="text-button" hidden>按当前页面重新生成</button></div><input id="capture-title" placeholder="可直接填写，也可选择记录或捕获网页文字"></div><div class="field"><label for="capture-description">任务描述草稿</label><textarea id="capture-description" rows="15" placeholder="可直接填写任务描述；没有关联问题也能进入下一步。"></textarea></div><div class="capture-attachments" hidden><strong>已捕获附件 · 点击查看</strong><div id="capture-attachments" class="attachment-list"></div></div></div>\n            </div>\n            <div id="bugdone-capture">\n            <div class="section-intro"><div><div class="eyebrow">BUG CONTEXT</div><h3>确认问题与上下文</h3></div><span id="bug-state" class="badge">等待详情</span></div>\n            <p id="count">等待捕获 · 请打开一个 Bug 的详情</p>\n            <div class="card"><label for="bug">选择 Bug</label><select id="bug" aria-describedby="warning"></select><p id="warning">打开 Bug 详情后，内容会自动同步到这里。</p></div>\n            <div class="card"><div class="attachment-mode"><strong>截图上传版本</strong><div class="segmented" role="group" aria-label="截图上传版本"><button id="bug-image-compressed" type="button" aria-pressed="true" data-action>压缩版</button><button id="bug-image-original" type="button" aria-pressed="false" data-action>原图</button></div></div><p class="hint">压缩版最长边不超过 2200 像素；点击下一步时生成并预览实际要上传的文件。无法压缩时请切换原图。</p></div>\n            <div class="card">\n              <div class="field"><label for="title">任务标题</label><input id="title" placeholder="可直接填写，或捕获 Bug 后自动填入"><p class="hint">已生成 [BugDone] #编号 和末尾查重标记；点击下一步后可编辑，提交时不会改写。</p></div>\n              <div class="field"><label for="share-url">只读分享链接</label><input id="share-url" readonly placeholder="捕获项目 ID 和 Bug ID 后生成"><p class="hint">采用 BugDone 原生分享地址规则，已同步到下方预览。</p></div>\n              <div class="field"><div class="label-row"><label for="description">提交内容预览（可编辑）</label><button id="restore" class="text-button">重新生成</button></div><textarea id="description" rows="13" placeholder="可直接填写任务内容；捕获详情后也会自动生成。"></textarea></div><div class="capture-attachments" hidden><strong>已捕获附件 · 点击查看</strong><div id="bug-attachments" class="attachment-list"></div></div>\n            </div>\n            <details class="card"><summary>手动导入 BugDone 响应</summary><p class="hint">自动捕获不可用时，可导入列表或详情接口的响应。</p><textarea id="json" rows="6" aria-label="BugDone 响应 JSON" placeholder="粘贴 Result / ReturnObj 格式 JSON，不要粘贴请求头或 Cookie"></textarea><div class="row"><button id="import" data-action class="secondary">导入响应</button></div></details>\n            </div>\n          </section>\n          <section id="view-multica" role="tabpanel" aria-labelledby="tab-multica" hidden>\n            <div class="card quick-card"><div class="quick-head"><strong>快速创建</strong><button id="new-blank-task" type="button" class="text-button">新建空白任务</button></div><div class="quick-body"><input id="task-title" class="task-title" aria-label="任务标题" placeholder="任务标题"><textarea id="task-description" class="task-description" rows="7" aria-label="任务描述" placeholder="添加描述..."></textarea><div class="quick-source"><strong>🔗 当前浏览页面</strong><span id="task-source">来源将随任务保存</span></div><p id="task-attachment-mode" class="hint" hidden></p><div id="selected-attachments" class="attachment-list" aria-live="polite"></div><details id="source-attachments" class="field" hidden><summary>来源附件 · 查看或手动添加</summary><div id="available-source-attachments" class="attachment-list"></div></details><div class="quick-assignee"><span class="quick-avatar">M</span><span>连接后可选择智能体接收任务</span></div><div class="quick-options"><select id="task-status" aria-label="任务状态"><option value="todo">◯ 待办</option><option value="backlog">待整理</option><option value="in_progress">进行中</option><option value="in_review">待审核</option><option value="done">已完成</option><option value="blocked">已阻塞</option></select><select id="task-priority" aria-label="优先级"><option value="none">－ 无优先级</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="urgent">紧急</option></select><select id="agent" aria-label="处理智能体"><option value="">选择智能体</option></select><select id="task-project" aria-label="项目"><option value="">无项目</option></select><button id="task-more" class="secondary more-button" type="button" aria-label="更多选项">•••</button></div><details id="task-extras" class="quick-dates"><summary>更多选项</summary><div class="task-grid"><div class="field"><label for="task-label">标签</label><select id="task-label"><option value="">无标签</option></select></div><div class="field"><label for="task-start">开始日期</label><input id="task-start" type="date"></div><div class="field"><label for="task-due">截止日期</label><input id="task-due" type="date"></div></div></details></div><div class="quick-foot"><button id="task-attachments" class="text-button" type="button" title="添加本地附件" aria-label="添加本地附件">📎</button><input id="attachment-picker" type="file" multiple hidden><label><input id="agent-task" type="checkbox" checked>智能体任务</label><label><input id="continue-create" type="checkbox">继续创建</label><button id="submit" data-action class="submit">创建任务 ↵</button></div></div>\n          </section>\n          <section id="view-settings" role="tabpanel" aria-labelledby="tab-settings" hidden>\n            <div class="section-intro settings-heading"><div><div class="eyebrow">PREFERENCES</div><h3>设置</h3><small id="settings-save-state" role="status" aria-live="polite">更改会自动保存</small></div><button id="reset-preferences" class="secondary" type="button" data-action>恢复偏好默认值</button></div>\n            <div class="card settings-category"><div class="settings-group"><h4>基础配置</h4><div class="field"><label for="api">API 服务根地址</label><select id="api"></select><p class="hint">选择官方服务，或添加你自己的 Multica 服务。</p><div id="custom-server-panel" class="custom-server-panel" hidden><label for="custom-api">添加自建服务器</label><div class="inline-control"><input id="custom-api" type="url" placeholder="https://your-multica.example"><button id="add-api" class="secondary">添加</button></div></div></div><div class="field"><label for="token">访问令牌（API Token）</label><input id="token" type="password" autocomplete="off"><p class="hint">用于连接 Multica，自动保存到脚本存储；修改后点击手动连接验证。</p></div><div class="row"><button id="connect" data-action>手动连接 / 刷新</button></div><p class="hint">自建服务器还需允许油猴或 Mac App 网络桥访问。</p></div>\n              </div><div class="card settings-category"><div class="settings-group"><h4>任务默认配置</h4><div class="field"><label for="workspace">默认工作区</label><select id="workspace"><option value="">请先连接</option></select><p class="hint">新任务使用这个工作区，可随时切换。</p></div><div class="field"><label for="default-project">默认项目</label><select id="default-project"><option value="">请先连接</option></select><p class="hint">预先填入任务创建页，提交前仍可修改。</p></div><div class="field"><label for="default-agent">默认处理智能体</label><select id="default-agent"><option value="">请先连接</option></select><p class="hint">新任务默认指派给这位智能体。</p></div><div class="field"><label for="default-label">默认标签</label><select id="default-label"><option value="">不指定标签</option></select><p class="hint">新任务默认使用的标签，可留空。</p></div></div>\n              </div><div class="card settings-category"><div class="settings-group"><h4>捕获设置</h4>\n<div class="setting-row"><div class="setting-copy"><strong>启用信息捕获</strong><small>暂停自动捕获，保留已有内容与草稿；不改变各站点的启停状态。</small></div><label class="switch setting-control" aria-label="启用信息捕获"><input id="capture-enabled" type="checkbox"><span class="switch-track" aria-hidden="true"></span></label></div>\n<div class="capture-sites-heading"><strong>站点捕获</strong><p class="hint">与站点配置中的开关共用状态；关闭总开关时，下面的站点不会自动捕获。</p></div><div id="capture-sites"></div>\n<div class="setting-row"><div class="setting-copy"><strong>图片默认版本</strong><small>后续捕获默认使用的图片版本，单次任务仍可切换。</small></div><div class="setting-control segmented" role="group" aria-label="图片默认版本"><button id="capture-image-compressed" type="button">压缩图</button><button id="capture-image-original" type="button">原图</button></div></div>\n<div class="setting-row"><div class="setting-copy"><strong>日志默认版本</strong><small>后续捕获默认使用的日志版本；仅对支持日志精简的来源生效。</small></div><div class="setting-control segmented" role="group" aria-label="日志默认版本"><button id="capture-log-summary" type="button">精简版</button><button id="capture-log-full" type="button">完整版</button></div></div>\n<div class="setting-row"><div class="setting-copy"><strong>自动带入捕获附件</strong><small>新草稿自动关联捕获的附件；关闭后仍可在任务页预览并手动添加，已有任务草稿不变。</small></div><label class="switch setting-control" aria-label="自动带入捕获附件"><input id="capture-auto-attachments" type="checkbox"><span class="switch-track" aria-hidden="true"></span></label></div>\n</div></div><div class="card settings-category"><div class="settings-group"><h4>UI 设置</h4><div class="setting-row"><div class="setting-copy"><strong>入口显示范围</strong><small>隐藏入口时，仍可用快捷键或油猴菜单打开工作台。</small></div><div class="setting-control"><select id="entry-visibility" aria-label="入口显示范围"><option value="configured">仅匹配配置的页面（默认）</option><option value="all">所有 HTTPS 网页</option><option value="shortcut">仅快捷键或菜单打开</option></select></div></div><div class="setting-row"><div class="setting-copy"><strong>打开／关闭任务面板快捷键</strong><small id="shortcut-description">在当前网页按快捷键打开或关闭面板</small></div><div class="setting-control shortcut-control"><input id="shortcut" type="text" readonly aria-label="当前任务面板快捷键"><button id="edit-shortcut" class="secondary" type="button">修改</button><button id="reset-shortcut" class="secondary" type="button">恢复默认</button></div></div><div class="setting-row"><div class="setting-copy"><strong>主面板显示样式</strong><small>选择工作台以侧边栏或浮窗方式显示</small></div><div class="setting-control segmented" role="group" aria-label="主面板显示样式"><button id="mode-sidebar" type="button" aria-pressed="false">侧边栏</button><button id="mode-floating" type="button" aria-pressed="true">浮窗</button></div></div><div class="setting-row"><div class="setting-copy"><strong>隐藏 BugDone 原有 AI 按钮</strong><small>隐藏页面内置的 AI 入口（openIntelligentTracking）</small></div><label class="switch setting-control" aria-label="隐藏 BugDone 原有 AI 按钮"><input type="checkbox" id="hide-native-ai"><span class="switch-track" aria-hidden="true"></span></label></div></div></div>\n            <p class="version">Issues → Multica · v${SCRIPT_VERSION}</p>\n          </section>\n          <section id="view-profiles" role="tabpanel" aria-labelledby="tab-profiles" hidden>\n            <div class="section-intro"><div><div class="eyebrow">SOURCE CONFIGURATION</div><h3>站点配置</h3></div></div>\n            <p class="hint profile-intro">用于定义目标网站、适用页面和信息捕获规则，将捕获结果整理为 AI 任务的标题、内容和附件。内置配置可直接使用或调整；新增网站请先选择“新建配置”，再使用模板。</p>\n            <div class="card"><div class="settings-group"><h4>内置站点配置</h4><div class="builtin-grid"><div class="builtin-card"><button id="open-bugdone-profile" type="button" class="builtin-open"><strong>BugDone</strong><small>www.bugdone.cn</small><span>内置 · 已启用 · 查看规则</span></button><label class="switch builtin-switch" aria-label="启用BugDone站点"><input type="checkbox" id="builtin-enable-bugdone"><span class="switch-track" aria-hidden="true"></span></label></div><div class="builtin-card"><button id="open-umeng-profile" type="button" class="builtin-open"><strong>友盟 APM</strong><small>apm.umeng.com</small><span id="umeng-profile-state">内置 · 已启用 · 查看规则</span></button><label class="switch builtin-switch" aria-label="启用友盟 APM站点"><input type="checkbox" id="builtin-enable-umeng"><span class="switch-track" aria-hidden="true"></span></label></div><div class="builtin-card"><button id="open-github-profile" type="button" class="builtin-open"><strong>GitHub Issues</strong><small>github.com</small><span>内置 · 已启用 · 查看规则</span></button><label class="switch builtin-switch" aria-label="启用GitHub Issues站点"><input type="checkbox" id="builtin-enable-github"><span class="switch-track" aria-hidden="true"></span></label></div></div><p class="hint">导入声明式 JSON 配置，可为 HTTPS 网站指定列表页、详情页、接口和字段映射。配置不会执行网页脚本；保存后当前页面立即应用；其他已打开页面需刷新。</p><div class="field"><label for="profile-list">站点配置</label><select id="profile-list"></select><p class="hint">内置配置也可调整；删除内置覆盖会恢复默认。来源身份与查重键保持稳定，自定义配置保存后手动启用。</p></div><div class="field"><label for="profile-label-mode">此站点的默认标签</label><select id="profile-label-mode"><option value="inherit">继承全局默认标签</option><option value="none">不指定标签</option><option value="fixed">指定标签（绑定当前服务和工作区）</option></select><select id="profile-label-value" hidden aria-label="站点指定标签"></select><p class="hint">进入任务创建页时应用；用户最后的选择优先。指定标签不会跨工作区使用。修改后点击校验并保存。</p></div><div class="field"><div class="profile-json-heading"><label for="profile-json">配置 JSON</label><div class="profile-template-actions"><select id="profile-template-mode" disabled aria-label="新建配置模板类型"><option value="api">接口捕获模板</option><option value="text">文本捕获模板</option><option value="blank">空白填写模板</option></select><button id="use-profile-template" disabled type="button" class="secondary">使用合成模板新建</button></div></div><textarea id="profile-json" rows="8" placeholder="粘贴符合 schemaVersion: 2 的站点配置，不要包含 Token、Cookie 或私密日志"></textarea></div><div class="row"><button id="save-profile" type="button" class="secondary">校验并保存</button><button id="toggle-profile" type="button" class="secondary">启用 / 停用</button><button id="export-profile" type="button" class="secondary">导出配置</button><button id="rollback-profile" type="button" class="secondary">回滚上一版</button><button id="delete-profile" type="button" class="secondary">删除所选配置</button></div><details id="profile-response-test" class="field"><summary>用合成响应试运行字段映射</summary><textarea id="profile-sample" rows="4" placeholder="粘贴不含私密信息的合成响应 JSON；内容不会保存"></textarea><div class="row"><button id="test-profile" type="button" class="secondary">试运行</button></div></details><p id="profile-feedback" class="hint"></p><details id="profile-field-guide" class="field"><summary>配置字段说明与填写规则</summary><dl class="profile-guide">\n<dt>captureMode</dt><dd>api（缺省）接口捕获；text 只在主动捕获时把 pageTitle/pageUrl/selectedText 填入 draft 模板；blank 空白填写。text/blank 可省略 captures、record、dedup，不能声明自动附件或源站动作。</dd><dt>schemaVersion</dt><dd>配置格式版本；支持 1 和 2，新配置使用 2。</dd>\n<dt>id</dt><dd>站点配置唯一标识，使用小写字母、数字和连字符；不能与内置配置重复。</dd>\n<dt>version</dt><dd>此配置的修订号，修改映射时建议递增。</dd>\n<dt>enabled</dt><dd>是否自动捕获；新导入默认停用，核对后在此页启用。</dd>\n<dt>allowedOrigins</dt><dd>允许读取的 HTTPS 站点根地址；不是页面路径，也不包含请求密钥。</dd>\n<dt>pages</dt><dd>浏览器地址规则：kind 为 list 或 detail，path 支持单段 :参数 与 *。页面地址不等于接口地址。</dd>\n<dt>captures</dt><dd>接口规则：id、GET/POST method、同站点 origin、path（可含 :参数）、maxResponseBytes；requestOnPage 可在当前匹配页面主动 GET JSON，可选 requestKeys 用于核对请求身份。</dd>\n<dt>success</dt><dd>可选接口响应成功条件：有限的 JSON path 与 equals 值；若响应没有成功标志可省略。</dd>\n<dt>variants</dt><dd>从响应中提取列表或详情：kind、JSON path、array/object type；列表包装项可用 itemPath 指向实际记录。</dd>\n<dt>record</dt><dd>记录字段路径：scopeId、recordId、title 必填；number、descriptionHtml、descriptionText、sourceUrl 可选。路径支持 $.field.subfield，或按顺序取非空值的路径数组。</dd>\n<dt>draft</dt><dd>任务标题模板 titleTemplate、可选正文模板 descriptionTemplate（支持 description/sourceUrl/shareUrl）；可插入 {{siteId}}、{{scopeId}}、{{recordId}}、{{number}}、{{title}}。</dd>\n<dt>defaultLabel</dt><dd>mode: inherit 继承全局、none 不带标签、fixed 指定标签；fixed 必须同时配置 id、api、workspace。用户在任务创建页可覆盖。</dd><dt>identity</dt><dd>scopeTemplate 校验页面与记录范围，recordParam 校验详情编号，recordFormat 限制编号格式，sourceTemplate 核对规范来源链接。</dd><dt>metadata / presentation</dt><dd>name 显示来源名称；recordLabel 记录选择标题；hideSelectors / drawerSelectors 为简单 ID 或 class 选择器。</dd><dt>links / processors</dt><dd>shareTemplate 生成只读分享链接；stack 中的 maxStacks、maxLines、maxChars 控制精简堆栈。</dd><dt>dedup</dt><dd>来源键模板 keyTemplate，必须包含 {{scopeId}} 和 {{recordId}}，用于跨浏览器查重。</dd>\n<dt>attachments</dt><dd>最多 8 条：kind: text 读取响应文本，需 maxChars（最多 200000）；kind: image-url 读取配置允许的 HTTPS 图片地址。两者均需 id、path、filenameTemplate；items 配置数组内 url/name/filter，allowedOrigins 单独限定下载域，transform 配置图片压缩；提交前可移除。</dd>\n<dt>postActions</dt><dd>可信动作列表。BugDone 支持 bugdone.start-processing，可用 enabled 关闭；仅新建成功执行，复用任务不写回。禁止任意脚本或 POST。</dd>\n</dl></details></div></div>\n          </section>\n          <section id="view-processing" role="tabpanel" aria-labelledby="tab-processing" hidden>\n            <div class="section-intro processing-heading"><div><div class="eyebrow">LOCAL HISTORY</div><h3>处理列表</h3></div><select id="processing-site" class="processing-site-select" aria-label="处理列表站点"></select></div><div class="processing-actions"><button id="refresh-processing" class="text-button" type="button">刷新状态</button><span id="processing-count">共 0 条</span></div>\n            <p id="processing-help" class="hint processing-help">这里记录本浏览器中已提交给 Multica-AI 的 Bug。打开本栏会查询任务状态；删除只移除本地记录，不会删除 Multica 任务。</p><div id="processing-list" aria-describedby="processing-help"></div>\n          </section>\n        </div>\n        <div id="bug-action-bar" class="bug-action-bar"><button id="next" data-action>下一步：AI任务创建 →</button></div>\n        <footer><p id="message" role="status" aria-live="polite">尚未提交 · 请先核对 Bug 详情。</p></footer>\n        <dialog id="reset-preferences-dialog" class="settings-reset-dialog" aria-labelledby="reset-preferences-title"><h3 id="reset-preferences-title">恢复偏好默认值？</h3><p>任务默认配置、图片和日志版本、附件默认关联、界面样式、入口位置和快捷键将恢复默认。</p><p>保留服务器、访问令牌、自建服务器列表、处理列表、站点配置和启停状态、捕获总开关、附件及当前任务草稿。未缓存的默认选项将在下次连接时选择首项。</p><div class="row end"><button id="cancel-reset-preferences" class="secondary" type="button">取消</button><button id="confirm-reset-preferences" type="button" data-action>恢复默认</button></div></dialog>\n        <div id="attachment-preview" class="attachment-preview" hidden role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title"><div class="attachment-preview-card"><div class="attachment-preview-head"><strong id="attachment-preview-title">附件预览</strong><button id="attachment-preview-close" class="icon-button" type="button" aria-label="关闭附件预览">×</button></div><div class="attachment-preview-body"><img id="attachment-preview-image" alt="附件图片" hidden><pre id="attachment-preview-text" hidden></pre></div><a id="attachment-preview-link" class="attachment-preview-link" target="_blank" rel="noopener noreferrer" hidden>打开原始附件 ↗</a></div></div>\n      </section>\n      <div id="success" class="success" popover="manual" hidden role="status" aria-live="polite"><span class="success-mark">✓</span><div><strong>创建成功</strong><span class="success-copy"></span></div></div>\n';

  // src/ui/template.js
  function createPanelMarkup(version) {
    return "<style>" + styles_default + "</style>" + panel_default.replaceAll("${SCRIPT_VERSION}", version);
  }
  __name(createPanelMarkup, "createPanelMarkup");

  // .generated/version.js
  var SCRIPT_VERSION = "3.0.0";

  // src/ui/mount.js
  function createMount(ctx) {
    return /* @__PURE__ */ __name(function mount() {
      ctx.debug("开始挂载按钮");
      if (!document.getElementById("bugdone-multica-page-shift")) {
        const style = document.createElement("style");
        style.id = "bugdone-multica-page-shift";
        style.textContent = "";
        document.head.append(style);
      }
      const host = document.createElement("div");
      host.id = "bugdone-multica-bridge";
      document.body.append(host);
      ctx.root = host.attachShadow({ mode: "closed" });
      document.documentElement.setAttribute("data-bugdone-multica-started", ctx.SCRIPT_VERSION);
      ctx.watchNativeAI();
      ctx.root.innerHTML = createPanelMarkup(SCRIPT_VERSION);
      ctx.renderServers();
      const renderCaptureSettings = /* @__PURE__ */ __name(() => {
        ctx.$("capture-enabled").checked = ctx.config.captureEnabled !== false;
        ctx.$("capture-auto-attachments").checked = ctx.config.autoCaptureAttachments !== false;
        for (const [id, selected] of [
          ["capture-image-compressed", ctx.config.defaultImageMode === "compressed"],
          ["capture-image-original", ctx.config.defaultImageMode === "original"],
          ["capture-log-summary", ctx.config.defaultLogMode === "summary"],
          ["capture-log-full", ctx.config.defaultLogMode === "full"]
        ]) ctx.$(id).setAttribute("aria-pressed", String(selected));
        const list = ctx.$("capture-sites");
        list.replaceChildren();
        for (const profile of ctx.profileRegistry()) {
          const row = document.createElement("div");
          row.className = "setting-row";
          row.dataset.profileId = profile.id;
          const copy = document.createElement("div");
          copy.className = "setting-copy";
          const title = document.createElement("strong");
          title.textContent = profile.metadata?.name || profile.id;
          const description = document.createElement("small");
          description.textContent = profile.allowedOrigins.map((url) => new URL(url).hostname).join("、");
          copy.append(title, description);
          const label = document.createElement("label");
          label.className = "switch setting-control";
          label.setAttribute("aria-label", `启用${title.textContent}捕获`);
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = profile.enabled;
          input.dataset.profileId = profile.id;
          input.id = profile.adapter === "umeng" ? "enable-umeng" : `capture-site-${profile.id}`;
          input.onchange = () => ctx.run(() => {
            const current = ctx.profileRegistry().find((p) => p.id === profile.id);
            if (current) persistProfile({ ...current, enabled: input.checked }, true, true);
          });
          const track = document.createElement("span");
          track.className = "switch-track";
          track.setAttribute("aria-hidden", "true");
          label.append(input, track);
          row.append(copy, label);
          list.append(row);
        }
        for (const [name, id] of [["bugdone", "bugdone"], ["umeng", "umeng-apm-crash"], ["github", "github-issues"]]) {
          const input = ctx.$(`builtin-enable-${name}`), profile = ctx.profileRegistry().find((p) => p.id === id);
          input.checked = !!profile?.enabled;
          input.onchange = () => ctx.run(() => {
            const current = ctx.profileRegistry().find((p) => p.id === id);
            if (current) persistProfile({ ...current, enabled: input.checked }, true, true);
          });
        }
      }, "renderCaptureSettings");
      const selectedProfileId = /* @__PURE__ */ __name(() => ctx.$("profile-list").value.replace(/^builtin:/, ""), "selectedProfileId");
      const selectedProfile = /* @__PURE__ */ __name(() => ctx.profileRegistry().find((p) => p.id === selectedProfileId()), "selectedProfile");
      const renderProfileList = /* @__PURE__ */ __name((selected = "builtin:bugdone") => {
        const list = ctx.$("profile-list");
        list.replaceChildren();
        for (const profile of ctx.profileRegistry()) {
          const builtin = BUILTIN_PROFILES.some((p) => p.id === profile.id), option = document.createElement("option");
          option.value = (builtin ? "builtin:" : "") + profile.id;
          option.textContent = `${builtin ? "内置" : "自定义"} · ${profile.metadata?.name || profile.id} · ${profile.allowedOrigins.map((x) => new URL(x).hostname).join("、")} · ${profile.enabled ? "已启用" : "已停用"}`;
          list.append(option);
        }
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "新建配置";
        list.append(empty);
        list.value = selected;
        const umeng = ctx.profileRegistry().find((p) => p.adapter === "umeng");
        renderCaptureSettings();
        ctx.$("umeng-profile-state").textContent = `内置 · ${umeng?.enabled ? "已启用" : "已停用"} · 查看规则`;
        for (const profile of BUILTIN_PROFILES) {
          const button = ctx.$(profile.adapter === "umeng" ? "open-umeng-profile" : profile.adapter === "bugdone" ? "open-bugdone-profile" : "open-github-profile");
          button.querySelector("span").textContent = `内置 · ${ctx.profileRegistry().find((p) => p.id === profile.id)?.enabled ? "已启用" : "已停用"} · 查看规则`;
        }
      }, "renderProfileList");
      const renderProfileLabel = /* @__PURE__ */ __name((profile) => {
        const label = profile?.defaultLabel || { mode: "inherit" };
        ctx.$("profile-label-mode").value = label.mode;
        const c = { api: ctx.$("api").value || ctx.config.api, workspace: ctx.$("workspace").value || ctx.config.workspace };
        const catalog2 = ctx.readValue(`catalog:${c.api}:${c.workspace}`, {}) || {};
        ctx.fillSelect("profile-label-value", catalog2.labels || [], label.mode === "fixed" ? label.id : "", "选择标签");
        ctx.$("profile-label-value").hidden = label.mode !== "fixed";
      }, "renderProfileLabel");
      const renderProfileSelection = /* @__PURE__ */ __name(() => {
        const profile = selectedProfile(), creating = ctx.$("profile-list").value === "";
        ctx.$("profile-json").readOnly = false;
        for (const id of ["profile-template-mode", "use-profile-template"]) {
          ctx.$(id).disabled = !creating;
          ctx.$(id).title = creating ? "将模板填入新配置 JSON" : "仅在选择“新建配置”时可使用模板";
        }
        ctx.$("profile-json").value = profile ? JSON.stringify(profile, null, 2) : "";
        renderProfileLabel(profile);
        ctx.$("profile-response-test").hidden = !!profile?.captureMode && profile.captureMode !== "api";
        ctx.$("profile-feedback").textContent = profile ? `${profile.metadata?.name || profile.id} · 保存后立即应用。来源身份与查重键不可改；回滚可恢复上一版。` : "";
      }, "renderProfileSelection");
      const persistProfile = /* @__PURE__ */ __name((profile, remember = true, preserveEditor = false) => {
        const editing = ctx.$("profile-list").value, editor = ctx.$("profile-json").value;
        const previous = ctx.profileRegistry().find((p) => p.id === profile.id);
        if (previous && remember) ctx.writeValue(`profilePrevious:${profile.id}`, previous);
        if (BUILTIN_PROFILES.some((p) => p.id === profile.id)) {
          ctx.builtinOverrides = { ...ctx.builtinOverrides, [profile.id]: profile };
          ctx.writeValue("builtinProfileOverrides", ctx.builtinOverrides);
        } else {
          const next = [...ctx.customProfiles.filter((p) => p.id !== profile.id), profile];
          if (next.length > 20) throw Error("最多保存 20 个站点配置");
          ctx.writeValue("siteProfiles", next);
          ctx.customProfiles = next;
        }
        ctx.refreshCaptureRuntime(true);
        renderProfileList(preserveEditor ? editing : (BUILTIN_PROFILES.some((p) => p.id === profile.id) ? "builtin:" : "") + profile.id);
        if (!preserveEditor) renderProfileSelection();
        else try {
          const draft = JSON.parse(editor);
          if (draft.id === profile.id) {
            draft.enabled = profile.enabled;
            ctx.$("profile-json").value = JSON.stringify(draft, null, 2);
          }
        } catch (_) {
        }
      }, "persistProfile");
      renderProfileList();
      renderProfileSelection();
      ctx.$("profile-list").onchange = renderProfileSelection;
      const editLabelJson = /* @__PURE__ */ __name(() => {
        ctx.$("profile-label-value").hidden = ctx.$("profile-label-mode").value !== "fixed";
        try {
          const profile = JSON.parse(ctx.$("profile-json").value), mode = ctx.$("profile-label-mode").value;
          profile.defaultLabel = mode === "fixed" ? { mode, id: ctx.$("profile-label-value").value, api: ctx.$("api").value, workspace: ctx.$("workspace").value } : { mode };
          ctx.$("profile-json").value = JSON.stringify(profile, null, 2);
        } catch {
          ctx.$("profile-feedback").textContent = "请先填写有效的配置 JSON";
        }
      }, "editLabelJson");
      ctx.$("profile-label-mode").onchange = editLabelJson;
      ctx.$("profile-label-value").onchange = editLabelJson;
      ctx.$("profile-json").addEventListener("change", () => {
        try {
          renderProfileLabel(JSON.parse(ctx.$("profile-json").value));
        } catch {
        }
      });
      ctx.$("profile-json").addEventListener("catalogrefresh", () => {
        try {
          renderProfileLabel(JSON.parse(ctx.$("profile-json").value));
        } catch {
        }
      });
      ctx.$("capture-enabled").onchange = () => ctx.run(() => {
        ctx.config.captureEnabled = ctx.$("capture-enabled").checked;
        ctx.persistConfig(ctx.config);
        ctx.refreshCaptureRuntime(true);
        renderCaptureSettings();
        ctx.message(ctx.config.captureEnabled ? "自动捕获已恢复。" : "自动捕获已暂停，已有内容与草稿仍保留。");
      });
      ctx.$("capture-auto-attachments").onchange = () => ctx.run(() => {
        ctx.config.autoCaptureAttachments = ctx.$("capture-auto-attachments").checked;
        ctx.persistConfig(ctx.config);
        renderCaptureSettings();
        ctx.message("附件默认设置已保存，仅影响后续新草稿。", "success");
      });
      for (const [id, key, value] of [
        ["capture-image-compressed", "defaultImageMode", "compressed"],
        ["capture-image-original", "defaultImageMode", "original"],
        ["capture-log-summary", "defaultLogMode", "summary"],
        ["capture-log-full", "defaultLogMode", "full"]
      ]) ctx.$(id).onclick = () => ctx.run(() => {
        ctx.config[key] = value;
        ctx.persistConfig(ctx.config);
        renderCaptureSettings();
        ctx.message("版本默认值已保存，当前记录和任务中的版本选择保持不变。", "success");
      });
      for (const [button, id] of [["open-bugdone-profile", "bugdone"], ["open-umeng-profile", "umeng-apm-crash"], ["open-github-profile", "github-issues"]]) ctx.$(button).onclick = () => {
        ctx.$("profile-list").value = "builtin:" + id;
        renderProfileSelection();
        ctx.$("profile-json").scrollIntoView({ block: "nearest" });
      };
      ctx.$("use-profile-template").onclick = () => {
        if (ctx.$("profile-list").value !== "" || ctx.$("use-profile-template").disabled) return;
        renderProfileSelection();
        ctx.$("profile-json").value = JSON.stringify({ api: PROFILE_TEMPLATE, text: PAGE_TEXT_TEMPLATE, blank: PAGE_BLANK_TEMPLATE }[ctx.$("profile-template-mode").value] || PROFILE_TEMPLATE, null, 2);
        ctx.$("profile-json").focus();
        ctx.$("profile-response-test").hidden = ctx.$("profile-template-mode").value !== "api";
      };
      ctx.$("save-profile").onclick = () => ctx.run(() => {
        const raw = ctx.$("profile-json").value;
        if (raw.length > 8e4) throw Error("配置文件不得超过 80 KB");
        const profile = validateSiteProfile(JSON.parse(raw)), previous = ctx.profileRegistry().find((p) => p.id === profile.id);
        if (selectedProfileId() && profile.id !== selectedProfileId()) throw Error("不能修改已有配置 ID；请使用新建配置");
        assertProfileIdentityUnchanged(previous, profile);
        const changes = profileObservationChanges(previous, profile);
        const saved = { ...profile, enabled: !!previous?.enabled && profile.enabled && !changes.length };
        persistProfile(saved);
        ctx.$("profile-feedback").textContent = `已保存并应用。${changes.length ? "读取规则变更：" + changes.join("；") + "。请核对后启用。" : ""}`;
        ctx.message("配置已保存；当前页面已重载捕获规则。", "success");
      });
      ctx.$("toggle-profile").onclick = () => ctx.run(() => {
        const p = selectedProfile();
        if (!p) throw Error("请先保存配置");
        persistProfile({ ...p, enabled: !p.enabled }, true, true);
        ctx.message("捕获配置已立即启用或停用。", "success");
      });
      ctx.$("rollback-profile").onclick = () => ctx.run(() => {
        const previous = ctx.readValue(`profilePrevious:${selectedProfileId()}`, null);
        if (!previous) throw Error("没有可回滚的上一版");
        persistProfile(validateSiteProfile(previous));
        ctx.message("已恢复上一版配置并重载。", "success");
      });
      ctx.$("export-profile").onclick = () => ctx.run(() => {
        const profile = selectedProfile();
        if (!profile) throw Error("请先选择已保存配置");
        const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${profile.id}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      });
      ctx.$("test-profile").onclick = () => ctx.run(() => {
        const profile = validateSiteProfile(JSON.parse(ctx.$("profile-json").value)), sample = ctx.$("profile-sample").value;
        if (sample.length > 4e6) throw Error("响应样本超过 4 MB");
        const result = testProfileSample(profile, JSON.parse(sample));
        ctx.$("profile-feedback").textContent = `试运行 ${result.ruleId}：匹配 ${result.matched} 条，有效 ${result.valid} 条，详情 ${result.detail} 条，缺少身份 ${result.missingIdentity} 条。样本未保存。`;
      });
      ctx.$("delete-profile").onclick = () => ctx.run(() => {
        const id = selectedProfileId();
        if (!id) throw Error("请先选择配置");
        const builtin = BUILTIN_PROFILES.some((p) => p.id === id);
        if (builtin) {
          delete ctx.builtinOverrides[id];
          ctx.writeValue("builtinProfileOverrides", ctx.builtinOverrides);
        } else {
          ctx.customProfiles = ctx.customProfiles.filter((p) => p.id !== id);
          ctx.writeValue("siteProfiles", ctx.customProfiles);
        }
        ctx.refreshCaptureRuntime(true);
        renderProfileList(builtin ? "builtin:" + id : "");
        renderProfileSelection();
        ctx.message(builtin ? "已恢复内置配置" : "配置已删除并停止捕获", "success");
      });
      ctx.$("token").value = ctx.config.token || "";
      ctx.setConnectionPhase("idle");
      ctx.fillSelect("workspace", ctx.readValue(`workspaces:${ctx.config.api}`, []), ctx.config.workspace, "请先连接", false);
      if (ctx.config.workspace && !ctx.$("workspace").value) ctx.fillSelect("workspace", [{ id: ctx.config.workspace, name: ctx.config.workspaceAlias || ctx.config.workspace }], ctx.config.workspace, "请先连接");
      const catalog = ctx.readValue(`catalog:${ctx.config.api}:${ctx.config.workspace}`, {}) || {};
      ctx.fillSelect("default-project", catalog.projects || (ctx.config.project ? [{ id: ctx.config.project, name: ctx.config.projectAlias || ctx.config.project }] : []), ctx.config.project, "不指定项目");
      ctx.fillSelect("task-project", catalog.projects || (ctx.config.project ? [{ id: ctx.config.project, name: ctx.config.projectAlias || ctx.config.project }] : []), ctx.config.project, "无项目");
      ctx.fillSelect("default-label", catalog.labels || [], ctx.config.label, "不指定标签");
      ctx.fillSelect("task-label", catalog.labels || [], ctx.config.label, "无标签");
      for (const id of ["task-label", "task-project"]) ctx.$(id).addEventListener("change", () => {
        ctx.$(id).dataset.userEdited = "true";
        ctx.$(id).dataset.context = `${ctx.$("api").value}:${ctx.$("workspace").value}`;
      });
      ctx.$("hide-native-ai").checked = ctx.config.hideNativeAI !== false;
      ctx.$("entry-visibility").value = ctx.config.entryVisibility;
      ctx.$("entry-visibility").addEventListener("change", () => {
        ctx.config.entryVisibility = ctx.$("entry-visibility").value;
        ctx.syncEntryVisibility();
        ctx.persistConfig({ ...ctx.config });
        ctx.message("入口显示范围已保存；快捷键仍可打开工作台。", "success");
      });
      ctx.applyPanelMode(ctx.config.displayMode);
      function showShortcut() {
        const label = ctx.config.shortcut.replaceAll("+", " + ");
        ctx.$("shortcut").value = label;
        ctx.$("shortcut-description").textContent = `在当前网页按 ${label} 打开或关闭面板`;
      }
      __name(showShortcut, "showShortcut");
      showShortcut();
      const launch = ctx.$("launch");
      let drag = null, suppressLaunchClick = false;
      const launchViewport = /* @__PURE__ */ __name(() => ({
        left: window.visualViewport?.offsetLeft || 0,
        top: window.visualViewport?.offsetTop || 0,
        width: window.visualViewport?.width || window.innerWidth,
        height: window.visualViewport?.height || window.innerHeight
      }), "launchViewport");
      const placeLaunch = /* @__PURE__ */ __name((position) => {
        launch.style.left = `${position.left}px`;
        launch.style.top = `${position.top}px`;
        launch.style.right = "auto";
        launch.style.bottom = "auto";
      }, "placeLaunch");
      function constrainLaunch(reason, requested) {
        if (drag && !requested) return;
        const rect = launch.getBoundingClientRect(), viewport = launchViewport();
        if (!rect.width || !rect.height || !viewport.width || !viewport.height) return;
        const before = requested || rect, position = fitLaunchPosition(before, rect, viewport);
        const corrected = Math.abs(position.left - before.left) > 0.5 || Math.abs(position.top - before.top) > 0.5;
        if (requested || corrected) placeLaunch(position);
        if (corrected) {
          ctx.launchPosition = position;
          try {
            ctx.writeValue("launchPosition", position);
          } catch (_) {
          }
          ctx.debug("入口位置已自动校正", { reason, previous: { left: before.left, top: before.top }, position, viewport });
        }
      }
      __name(constrainLaunch, "constrainLaunch");
      if (ctx.launchPosition && Number.isFinite(Number(ctx.launchPosition.left)) && Number.isFinite(Number(ctx.launchPosition.top))) {
        constrainLaunch("restore", { left: Number(ctx.launchPosition.left), top: Number(ctx.launchPosition.top) });
      }
      launch.addEventListener("pointerdown", (e) => {
        if (e.button !== void 0 && e.button !== 0) return;
        const rect = launch.getBoundingClientRect();
        launch.setPointerCapture?.(e.pointerId);
        drag = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top, x: e.clientX, y: e.clientY, moved: false };
      });
      launch.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
        if (!drag.moved) return;
        placeLaunch(fitLaunchPosition({ left: e.clientX - drag.dx, top: e.clientY - drag.dy }, launch.getBoundingClientRect(), launchViewport()));
      });
      launch.addEventListener("pointerup", (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (drag.moved) {
          suppressLaunchClick = true;
          try {
            ctx.writeValue("launchPosition", { left: launch.getBoundingClientRect().left, top: launch.getBoundingClientRect().top });
          } catch (_) {
          }
          setTimeout(() => {
            suppressLaunchClick = false;
          }, 0);
        }
        drag = null;
        constrainLaunch("drag-end");
      });
      launch.addEventListener("pointercancel", () => {
        drag = null;
        constrainLaunch("drag-cancel");
      });
      launch.onclick = () => {
        if (suppressLaunchClick) return;
        if (launch.getAttribute("aria-expanded") === "true") ctx.closePanel();
        else {
          ctx.openPanel();
          ctx.root.querySelector("[role=tab][aria-selected=true]").focus();
        }
      };
      ctx.$("close").onclick = () => {
        ctx.closePanel();
        ctx.$("launch").focus();
      };
      window.addEventListener("resize", () => {
        ctx.syncPageLayout(ctx.$("launch").getAttribute("aria-expanded") === "true");
        constrainLaunch("window-resize");
      });
      window.visualViewport?.addEventListener("resize", () => constrainLaunch("viewport-resize"));
      window.visualViewport?.addEventListener("scroll", () => constrainLaunch("viewport-scroll"));
      if (typeof ResizeObserver === "function") new ResizeObserver(() => constrainLaunch("button-resize")).observe(launch);
      ctx.$("panel").addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (!ctx.$("attachment-preview").hidden) ctx.closeAttachmentPreview();
        else ctx.$("close").click();
      });
      ctx.$("attachment-preview-close").onclick = ctx.closeAttachmentPreview;
      ctx.$("attachment-preview").onclick = (event) => {
        if (event.target === ctx.$("attachment-preview")) ctx.closeAttachmentPreview();
      };
      const tabs = [...ctx.root.querySelectorAll('[role="tab"]')];
      tabs.forEach((tab, index) => {
        tab.onclick = () => ctx.switchTab(tab.dataset.tab);
        tab.onkeydown = (e) => {
          let next;
          if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
          if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          if (e.key === "Home") next = 0;
          if (e.key === "End") next = tabs.length - 1;
          if (next !== void 0) {
            e.preventDefault();
            ctx.switchTab(tabs[next].dataset.tab, true);
          }
        };
      });
      const showStackMode = /* @__PURE__ */ __name(() => {
        ctx.$("umeng-stack-summary").setAttribute("aria-pressed", String(ctx.umengStackMode === "summary"));
        ctx.$("umeng-stack-full").setAttribute("aria-pressed", String(ctx.umengStackMode === "full"));
      }, "showStackMode");
      const showImageMode = /* @__PURE__ */ __name(() => {
        ctx.$("bug-image-compressed").setAttribute("aria-pressed", String(ctx.bugImageMode === "compressed"));
        ctx.$("bug-image-original").setAttribute("aria-pressed", String(ctx.bugImageMode === "original"));
      }, "showImageMode");
      const chooseStackMode = /* @__PURE__ */ __name((mode) => {
        ctx.umengStackMode = mode;
        showStackMode();
        ctx.renderCapturedRecords();
        if (ctx.taskDraft?.sourceKey && ctx.taskDraft.sourceKey === ctx.activeDraft?.sourceKey) {
          ctx.taskDraft = { ...ctx.taskDraft, attachments: structuredClone(ctx.activeDraft.attachments) };
          ctx.renderSelectedAttachments();
        }
        if (ctx.activeDraft?.sourceKey && ctx.attachmentDraftKey === ctx.activeDraft.sourceKey && ctx.selectedAttachments.some((item) => item.generated)) {
          ctx.selectedAttachments = [
            ...ctx.selectedAttachments.filter((item) => !item.generated),
            ...ctx.activeDraft.attachments.filter((item) => !ctx.removedAutoAttachments.has(`${ctx.activeDraft.sourceKey}:${item.name}`)).map((item) => ({ ...item, generated: true, attachmentScope: ctx.activeDraft.sourceKey }))
          ];
          ctx.$("task-attachment-mode").textContent = `友盟堆栈：${mode === "summary" ? "精简版 TXT" : "完整版 TXT"}`;
          ctx.$("task-attachment-mode").hidden = !ctx.activeDraft.attachments.length;
          ctx.renderSelectedAttachments();
        }
      }, "chooseStackMode");
      ctx.$("umeng-stack-summary").onclick = () => chooseStackMode("summary");
      ctx.$("umeng-stack-full").onclick = () => chooseStackMode("full");
      const chooseImageMode = /* @__PURE__ */ __name((mode) => ctx.run(async () => {
        const previous = ctx.bugImageMode;
        ctx.bugImageMode = mode;
        showImageMode();
        const bug = ctx.bugs.get(ctx.$("bug").value);
        if (bug && ctx.taskDraft?.legacyBug?.BugId === bug.BugId) ctx.taskDraft = { ...ctx.taskDraft, captureDefaults: { ...ctx.taskDraft.captureDefaults || capturePreferences(ctx.config), defaultImageMode: mode } };
        if (bug && ctx.attachmentDraftKey === `bugdone:${bug.BugId}` && ctx.selectedAttachments.some((item) => item.generated)) {
          try {
            const generated = await ctx.prepareBugDoneImages(bug, mode, ctx.removedAutoAttachments);
            ctx.selectedAttachments = [...ctx.selectedAttachments.filter((item) => !item.generated), ...generated];
            ctx.$("task-attachment-mode").textContent = `BugDone 截图：${mode === "compressed" ? "压缩版" : "原图"}`;
            ctx.$("task-attachment-mode").hidden = !generated.length;
            ctx.renderSelectedAttachments();
          } catch (error) {
            ctx.bugImageMode = previous;
            showImageMode();
            throw error;
          }
        }
      }), "chooseImageMode");
      ctx.$("bug-image-compressed").onclick = () => {
        void chooseImageMode("compressed");
      };
      ctx.$("bug-image-original").onclick = () => {
        void chooseImageMode("original");
      };
      showImageMode();
      showStackMode();
      ctx.$("next").onclick = () => ctx.run(async () => {
        const previousCaptureDefaults = ctx.taskDraft?.captureDefaults, previousAttachmentKey = ctx.attachmentDraftKey;
        const bug = ctx.siteMode === "bugdone" ? ctx.bugs.get(ctx.$("bug").value) : null;
        const records = ctx.siteMode === "umeng" ? ctx.umengState.records : ctx.capturedRecords;
        const selectedRecord = ctx.siteMode === "bugdone" ? bug?.captureRecord : records.get(ctx.$("capture-record").value);
        const useManual = !selectedRecord || ctx.activeDraft?.siteId === "manual";
        if (useManual) {
          const title = ctx.$(ctx.siteMode === "bugdone" ? "title" : "capture-title").value;
          const description = ctx.$(ctx.siteMode === "bugdone" ? "description" : "capture-description").value;
          const context = manualDraftContext(ctx.siteMode !== "bugdone" ? ctx.activeDraft : null, ctx.activeProfile, location.href);
          ctx.taskDraft = snapshotTaskDraft(buildTypedManualDraft({ title, description, url: context.url, previous: ctx.taskDraft, sourceDraft: ctx.activeDraft }), context.profile);
          ctx.selectedAttachments = ctx.selectedAttachments.filter((item) => !item.generated);
          ctx.attachmentDraftKey = `manual:${ctx.taskDraft.draftId}`;
          ctx.$("task-title").value = title;
          ctx.$("task-description").value = description;
          ctx.$("task-source").textContent = ctx.taskDraft.sourceUrl;
          ctx.$("task-attachment-mode").hidden = true;
          ctx.renderSelectedAttachments();
          ctx.message("已作为手动草稿进入任务创建；仅对本次草稿防重复，不自动修改源站问题状态。");
        } else if (ctx.siteMode === "bugdone") {
          const nextKey = `bugdone:${ctx.$("bug").value}`;
          if (ctx.attachmentDraftKey !== nextKey && ctx.config.autoCaptureAttachments && ctx.bugImageMode === "compressed" && bug.attachments?.some((item) => item.image)) ctx.message("正在生成压缩截图，请稍候…");
          const generated = ctx.attachmentDraftKey !== nextKey && ctx.config.autoCaptureAttachments ? await ctx.prepareBugDoneImages(bug, ctx.bugImageMode, ctx.removedAutoAttachments) : [];
          if (!bug.captureRecord) throw Error("缺少有效来源身份，请重新打开 BugDone 详情");
          ctx.taskDraft = snapshotTaskDraft({ ...buildCapturedDraft(bug.captureRecord, ctx.activeProfile || BUGDONE_PROFILE), detail: bug.detail }, ctx.activeProfile || BUGDONE_PROFILE, bug);
          ctx.selectedAttachments = nextDraftAttachments(ctx.selectedAttachments, generated, { previousKey: ctx.attachmentDraftKey, key: nextKey, include: ctx.config.autoCaptureAttachments });
          ctx.attachmentDraftKey = nextKey;
          ctx.$("task-title").value = ctx.$("title").value;
          ctx.$("task-description").value = ctx.$("description").value;
          ctx.$("task-source").textContent = bug.sourceUrl || location.href;
          ctx.$("task-attachment-mode").textContent = `BugDone 截图：${ctx.bugImageMode === "compressed" ? "压缩版" : "原图"}`;
          ctx.$("task-attachment-mode").hidden = !ctx.selectedAttachments.some((item) => item.generated);
          ctx.renderSelectedAttachments();
        } else {
          if (!ctx.activeDraft) {
            ctx.message("请先捕获一条记录或选取网页文字。", "warning");
            return;
          }
          if (ctx.siteMode === "umeng") {
            const record = ctx.umengState.records.get(ctx.$("capture-record").value);
            if (record?.logDetailCoverage?.total > record.logDetailCoverage.captured)
              ctx.message(`友盟已加载 ${record.logDetailCoverage.captured}/${record.logDetailCoverage.total} 条日志详情；未打开的明细不会包含在任务中。`, "warning");
          }
          ctx.taskDraft = snapshotTaskDraft(ctx.activeDraft, ctx.activeDraft.siteId === "manual" ? null : ctx.activeProfile);
          const nextKey = ctx.activeDraft.sourceKey || `manual:${ctx.activeDraft.draftId}`;
          const previousKey = ctx.attachmentDraftKey;
          ctx.attachmentDraftKey = nextKey;
          ctx.$("task-title").value = ctx.$("capture-title").value;
          ctx.$("task-description").value = ctx.$("capture-description").value;
          ctx.$("task-source").textContent = ctx.activeDraft.sourceUrl || location.href;
          ctx.selectedAttachments = nextDraftAttachments(ctx.selectedAttachments, (ctx.activeDraft.attachments || []).filter((item) => !ctx.removedAutoAttachments.has(`${ctx.activeDraft.sourceKey}:${item.name}`)).map((item) => ({ ...item, original: ctx.config.defaultImageMode === "original", generated: true, attachmentScope: ctx.activeDraft.sourceKey })), { previousKey, key: nextKey, include: ctx.config.autoCaptureAttachments });
          ctx.$("task-attachment-mode").textContent = ctx.siteMode === "umeng" ? `友盟堆栈：${ctx.umengStackMode === "summary" ? "精简版 TXT" : "完整版 TXT"}` : "";
          ctx.$("task-attachment-mode").hidden = ctx.siteMode !== "umeng" || !ctx.selectedAttachments.some((item) => item.generated || item.fromCapture);
          ctx.renderSelectedAttachments();
        }
        ctx.taskDraft.captureDefaults = previousAttachmentKey === ctx.attachmentDraftKey && previousCaptureDefaults || { ...capturePreferences(ctx.config), defaultImageMode: ctx.siteMode === "bugdone" ? ctx.bugImageMode : ctx.config.defaultImageMode, defaultLogMode: ctx.siteMode === "umeng" ? ctx.umengStackMode : ctx.config.defaultLogMode };
        ctx.$("source-attachments").open = ctx.taskDraft.captureDefaults.autoCaptureAttachments === false;
        ctx.renderSelectedAttachments();
        ctx.applyTaskDefaultLabel(ctx.taskDraft?.profile || null);
        ctx.switchTab("multica", true);
      });
      ctx.$("new-blank-task").onclick = () => {
        ctx.activeDraft = {
          siteId: "manual",
          scopeId: location.origin,
          recordId: "",
          sourceKey: "",
          draftId: crypto.randomUUID(),
          sourceUrl: location.href,
          title: "",
          description: "",
          attachments: []
        };
        ctx.taskDraft = snapshotTaskDraft(ctx.activeDraft);
        ctx.selectedAttachments = [];
        ctx.attachmentDraftKey = `manual:${ctx.activeDraft.draftId}`;
        ctx.renderSelectedAttachments();
        ctx.$("task-attachment-mode").hidden = true;
        ctx.$("task-title").value = "";
        ctx.$("task-description").value = `来源：${location.href}

`;
        ctx.$("task-source").textContent = location.href;
        ctx.applyTaskDefaultLabel(null);
        ctx.$("task-title").focus();
        ctx.message("已新建空白任务；没有稳定来源 ID，仅对本次草稿防重复。");
      };
      ctx.$("task-more").onclick = () => {
        ctx.$("task-extras").open = !ctx.$("task-extras").open;
      };
      let capturingShortcut = false;
      ctx.$("edit-shortcut").onclick = () => {
        capturingShortcut = true;
        ctx.$("shortcut").value = "请按快捷键…";
        ctx.$("shortcut").focus();
      };
      ctx.$("shortcut").onblur = () => {
        if (capturingShortcut) {
          capturingShortcut = false;
          showShortcut();
        }
      };
      ctx.$("reset-shortcut").onclick = () => {
        capturingShortcut = false;
        ctx.config.shortcut = DEFAULT_SHORTCUT;
        ctx.config.shortcutCustomized = false;
        showShortcut();
        ctx.persistConfig({ ...ctx.config });
        ctx.message("快捷键已恢复默认。", "success");
      };
      window.addEventListener("keydown", (event) => {
        if (event.repeat || event.isComposing) return;
        if (capturingShortcut) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.key === "Escape") {
            capturingShortcut = false;
            showShortcut();
            return;
          }
          const shortcut = shortcutFromEvent(event);
          if (!shortcut) return;
          ctx.config.shortcut = shortcut;
          ctx.config.shortcutCustomized = true;
          capturingShortcut = false;
          showShortcut();
          ctx.persistConfig({ ...ctx.config });
          ctx.message(`快捷键已保存：${ctx.$("shortcut").value}`, "success");
          return;
        }
        if (!shortcutMatches(event, ctx.config.shortcut)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (ctx.$("launch").getAttribute("aria-expanded") === "true") ctx.closePanel();
        else {
          ctx.openPanel();
          ctx.switchTab("multica", true);
        }
      }, true);
      ctx.$("task-attachments").onclick = () => ctx.$("attachment-picker").click();
      ctx.$("attachment-picker").onchange = (event) => {
        const files = [...event.target.files || []];
        if (files.some((file) => !file.size || file.size > 20 * 1024 * 1024)) {
          ctx.message("每个附件须为 1 字节至 20 MiB。", "warning");
          event.target.value = "";
          return;
        }
        ctx.selectedAttachments.push(...files.map((file) => ({ name: file.name, file })));
        event.target.value = "";
        ctx.renderSelectedAttachments();
      };
      ctx.$("capture-selection").onclick = () => ctx.run(ctx.captureSelection);
      ctx.$("reset-page-capture").onclick = () => ctx.run(() => {
        if (!ctx.activeProfile?.captureMode || ctx.activeProfile.captureMode === "api") return;
        ctx.activeDraft = null;
        ctx.pagePreviewContext = "";
        ctx.$("capture-title").dataset.generated = "true";
        ctx.$("capture-description").dataset.generated = "true";
        ctx.renderPageCapturePreview();
        ctx.message("已按当前页面重新生成草稿。");
      });
      ctx.$("capture-record").onchange = () => {
        ctx.captureRecordChoice = { url: location.href, key: ctx.$("capture-record").value };
        ctx.activeDraft = null;
        ctx.renderCapturedRecords();
      };
      const keepManualCapture = /* @__PURE__ */ __name(() => {
        if (!ctx.$("capture-record").value) ctx.captureRecordChoice = { url: location.href, key: "" };
      }, "keepManualCapture");
      ctx.$("capture-title").addEventListener("input", () => {
        ctx.$("capture-title").dataset.generated = "false";
        keepManualCapture();
      });
      ctx.$("capture-description").addEventListener("input", () => {
        ctx.$("capture-description").dataset.generated = "false";
        keepManualCapture();
      });
      ctx.$("processing-site").onchange = () => {
        ctx.processingSiteSelection = ctx.$("processing-site").value;
        ctx.renderProcessing();
        void ctx.refreshProcessingStatuses();
      };
      ctx.$("refresh-processing").onclick = () => {
        void ctx.refreshProcessingStatuses(true);
      };
      ctx.$("agent-task").onchange = () => {
        ctx.$("submit").disabled = !ctx.$("agent-task").checked;
        if (!ctx.$("agent-task").checked) ctx.message("当前桥接只支持智能体任务。");
      };
      ctx.$("open-multica").onclick = () => {
        let opened = false;
        const openWebsite = /* @__PURE__ */ __name(() => {
          const tab = window.open("about:blank", "_blank");
          if (!tab) {
            window.location.assign("https://multica.ai");
            return;
          }
          tab.opener = null;
          tab.location.replace("https://multica.ai");
        }, "openWebsite");
        const onNativeOpen = /* @__PURE__ */ __name(() => {
          opened = true;
          clearTimeout(fallbackTimer);
        }, "onNativeOpen");
        window.addEventListener("fastlane:multica-opened", onNativeOpen, { once: true });
        const fallbackTimer = setTimeout(() => {
          window.removeEventListener("fastlane:multica-opened", onNativeOpen);
          if (opened || document.hidden || !document.hasFocus()) return;
          openWebsite();
        }, 1800);
        try {
          window.location.href = "multica://open";
        } catch {
          clearTimeout(fallbackTimer);
          window.removeEventListener("fastlane:multica-opened", onNativeOpen);
          openWebsite();
        }
      };
      const manuallyConnect = /* @__PURE__ */ __name(() => ctx.run(async () => {
        clearTimeout(tokenSaveTimer);
        ctx.persistConnectionSettings();
        await ctx.connect();
      }), "manuallyConnect");
      ctx.$("refresh-connection").onclick = manuallyConnect;
      ctx.$("connect").onclick = manuallyConnect;
      ctx.$("add-api").onclick = () => ctx.run(async () => {
        const c = validateConnection({ api: ctx.$("custom-api").value.trim(), token: "address-only" });
        const saved = ctx.configuredServers().filter((api) => api !== "https://api.multica.ai");
        if (!saved.includes(c.api)) saved.push(c.api);
        ctx.writeValue("servers", saved);
        ctx.renderServers();
        ctx.$("api").value = c.api;
        ctx.$("custom-api").value = "";
        ctx.$("custom-server-panel").hidden = true;
        ctx.$("api").dispatchEvent(new Event("change"));
        ctx.message("自建服务已添加并保存，请手动连接。", "success");
      });
      ctx.switchTab("bug");
      ctx.$("bug").onchange = () => {
        ctx.currentId = ctx.$("bug").value;
        ctx.$("bug").dataset.manual = String(!ctx.currentId);
        if (ctx.currentId) ctx.preview();
        else {
          ctx.$("bug-state").textContent = "手动填写";
          ctx.$("share-url").value = "";
          ctx.$("warning").textContent = "可直接填写标题和描述；下一步按手动草稿处理。";
          ctx.renderCaptureAttachments();
        }
      };
      ctx.$("restore").onclick = () => ctx.preview(true);
      const keepManualBug = /* @__PURE__ */ __name(() => {
        if (!ctx.$("bug").value) {
          ctx.$("bug").dataset.manual = "true";
          ctx.currentId = "";
        }
      }, "keepManualBug");
      ctx.$("title").addEventListener("input", () => {
        ctx.$("title").dataset.generated = "false";
        keepManualBug();
      });
      ctx.$("description").addEventListener("input", () => {
        ctx.$("description").dataset.generated = "false";
        keepManualBug();
      });
      ctx.$("agent").addEventListener("change", () => {
        ctx.config.agent = ctx.$("agent").value;
        try {
          ctx.writeValue("config", { ...ctx.config, agent: ctx.config.agent });
        } catch (e) {
          ctx.debug("智能体选择保存失败", { errorType: e.name }, "warn");
        }
      });
      ctx.renderAgentChoices(ctx.config, catalog.agents || ctx.readValue(agentCacheKey(ctx.config), []));
      ctx.$("default-agent").addEventListener("change", () => {
        const previous = ctx.config.defaultAgent;
        ctx.config.defaultAgent = ctx.$("default-agent").value;
        ctx.config.defaultAgentCustomized = true;
        if (!ctx.$("agent").value || ctx.$("agent").value === previous) ctx.$("agent").value = ctx.config.defaultAgent;
        ctx.config.agent = ctx.$("agent").value;
        try {
          ctx.persistConfig({ ...ctx.config });
          ctx.message("默认处理智能体已保存。", "success");
        } catch (e) {
          ctx.message("默认处理智能体保存失败。", "error");
        }
      });
      ctx.$("api").addEventListener("change", () => {
        const api = ctx.$("api").value;
        ctx.setConnectionPhase("idle");
        if (api === "__add__") {
          ctx.$("custom-server-panel").hidden = false;
          ctx.$("custom-api").focus();
          return;
        }
        ctx.$("custom-server-panel").hidden = true;
        ctx.fillSelect("workspace", ctx.readValue(`workspaces:${api}`, []), "", "请先连接", true);
        for (const id of ["default-project", "task-project", "default-label", "task-label"]) ctx.fillSelect(id, [], "", "请先连接");
        ctx.renderAgentChoices({ agent: "", defaultAgent: "" }, []);
        try {
          ctx.persistConnectionSettings();
        } catch (error) {
          ctx.message(error.message, "error");
        }
      });
      let tokenSaveTimer;
      const saveToken = /* @__PURE__ */ __name(() => {
        clearTimeout(tokenSaveTimer);
        tokenSaveTimer = null;
        try {
          ctx.persistConnectionSettings();
        } catch (error) {
          ctx.message(error.message, "error");
        }
      }, "saveToken");
      ctx.$("token").addEventListener("input", () => {
        ctx.setConnectionPhase("idle");
        ctx.$("settings-save-state").textContent = "正在保存…";
        clearTimeout(tokenSaveTimer);
        tokenSaveTimer = setTimeout(saveToken, 300);
      });
      ctx.$("token").addEventListener("change", saveToken);
      window.addEventListener("pagehide", () => {
        if (tokenSaveTimer) saveToken();
      });
      ctx.$("workspace").addEventListener("change", () => ctx.run(async () => {
        const workspace = ctx.$("workspace").value;
        ctx.config = { ...ctx.config, api: ctx.$("api").value, token: ctx.$("token").value, workspace, workspaceAlias: workspace ? ctx.$("workspace").selectedOptions[0]?.textContent || "" : "", project: "", projectAlias: "", defaultAgent: "", agent: "", label: "", projectCustomized: false, defaultAgentCustomized: false };
        ctx.persistConfig(ctx.config);
        for (const id of ["default-project", "task-project", "default-label", "task-label"]) ctx.fillSelect(id, [], "", "请先选择工作区");
        ctx.renderAgentChoices({ agent: "", defaultAgent: "" }, []);
        if (!workspace) {
          ctx.message("默认工作区已清空并保存。", "success");
          return;
        }
        const catalog2 = ctx.readValue(`catalog:${ctx.config.api}:${workspace}`, null);
        const workspaces = ctx.readValue(`workspaces:${ctx.config.api}`, null);
        if (needsCatalogRefresh(ctx.config, ctx.readValue(`connection-tag:${ctx.config.api}`, ""), workspaces, catalog2))
          await ctx.loadWorkspaceData(validateConfig(ctx.config));
        else ctx.applyCatalog(ctx.config, catalog2);
        ctx.config = {
          ...ctx.config,
          project: ctx.$("default-project").value,
          defaultAgent: ctx.$("default-agent").value,
          agent: ctx.$("agent").value,
          label: ctx.$("default-label").value
        };
        ctx.persistConfig(ctx.config);
        ctx.message("已切换工作区，相关选项已更新。", "success");
      }));
      for (const id of ["default-project", "default-label"]) ctx.$(id).addEventListener("change", () => {
        const taskId = id === "default-project" ? "task-project" : "task-label";
        if (id === "default-project") {
          ctx.config.project = ctx.$(id).value;
          ctx.config.projectCustomized = true;
          ctx.$(taskId).value = ctx.$(id).value;
          try {
            ctx.persistConfig({ ...ctx.config });
            ctx.message("默认项目已保存。", "success");
          } catch {
            ctx.message("默认项目保存失败。", "error");
          }
        } else if (ctx.$("task-label").dataset.userEdited !== "true") ctx.applyTaskDefaultLabel(ctx.taskDraft ? ctx.taskDraft.profile : ctx.activeProfile);
        if (id === "default-label") {
          ctx.config.label = ctx.$(id).value;
          try {
            ctx.persistConfig({ ...ctx.config });
            ctx.message("默认标签已保存。", "success");
          } catch (error) {
            ctx.message("默认标签保存失败。", "error");
          }
        }
      });
      ctx.$("hide-native-ai").addEventListener("change", () => {
        ctx.config.hideNativeAI = ctx.$("hide-native-ai").checked;
        ctx.setNativeAIVisibility(ctx.config.hideNativeAI);
        try {
          ctx.persistConfig({ ...ctx.config });
          ctx.message(ctx.config.hideNativeAI ? "已隐藏 BugDone 原有 AI 按钮。" : "已显示 BugDone 原有 AI 按钮。", "success");
        } catch (e) {
          ctx.message("AI 按钮显示设置保存失败。", "error");
        }
      });
      for (const [id, mode] of [["mode-sidebar", "sidebar"], ["mode-floating", "floating"]]) ctx.$(id).onclick = () => {
        ctx.applyPanelMode(mode);
        try {
          ctx.persistConfig({ ...ctx.config });
          ctx.message(`已切换为${mode === "sidebar" ? "侧边栏" : "浮窗"}模式。`, "success");
        } catch (e) {
          ctx.message("主面板显示样式保存失败。", "error");
        }
      };
      ctx.$("reset-preferences").onclick = () => ctx.$("reset-preferences-dialog").showModal();
      ctx.$("cancel-reset-preferences").onclick = () => ctx.$("reset-preferences-dialog").close();
      ctx.$("confirm-reset-preferences").onclick = () => {
        ctx.$("reset-preferences-dialog").close();
        void ctx.run(() => {
          clearTimeout(tokenSaveTimer);
          ctx.persistConnectionSettings();
          const verified = ctx.readValue(`connection-tag:${ctx.config.api}`, "") === connectionCacheTag(ctx.config.api, ctx.config.token);
          const workspaces = verified ? ctx.readValue(`workspaces:${ctx.config.api}`, []) || [] : [];
          const first = workspaces.find((item) => item?.id && item.is_archived !== true);
          const cached = first ? ctx.readValue(`catalog:${ctx.config.api}:${first.id}`, {}) || {} : {};
          const catalog2 = { projects: cached.projects || [], agents: cached.agents || [], labels: cached.labels || [] };
          const next = restorePreferenceDefaults(ctx.config, workspaces, catalog2);
          ctx.persistConfig(next);
          ctx.config = next;
          ctx.fillSelect("workspace", workspaces, ctx.config.workspace, "请先连接");
          ctx.applyCatalog(ctx.config, catalog2);
          ctx.$("hide-native-ai").checked = ctx.config.hideNativeAI;
          ctx.$("entry-visibility").value = ctx.config.entryVisibility;
          capturingShortcut = false;
          showShortcut();
          ctx.applyPanelMode(ctx.config.displayMode);
          ctx.setNativeAIVisibility(ctx.config.hideNativeAI);
          ctx.syncEntryVisibility();
          renderCaptureSettings();
          ctx.refreshCaptureRuntime(true);
          ctx.launchPosition = null;
          ctx.writeValue("launchPosition", null);
          for (const property of ["left", "top", "right", "bottom"]) launch.style.removeProperty(property);
          constrainLaunch("reset-preferences");
          if (!ctx.config.workspace) ctx.setConnectionPhase("idle");
          ctx.message("偏好已恢复默认；连接配置和用户数据已保留。", "success");
        });
      };
      ctx.$("submit").onclick = () => ctx.run(ctx.submit);
      ctx.$("import").onclick = () => ctx.run(async () => {
        const text = ctx.$("json").value;
        if (!parseResponse(text).length) throw Error("未找到有效的 BugDone Bug 数据");
        ctx.collect(text);
        ctx.$("json").value = "";
        ctx.switchTab("bug", true);
        ctx.message("响应已导入，请选择 Bug 核对预览。");
      });
      ctx.syncCaptureUI();
      ctx.renderProcessing();
      if (ctx.captureHookFailed) ctx.message("当前环境未能安装自动捕获。可在“Bug 详情”中使用“手动导入 BugDone 响应”继续操作。");
      if (!ctx.hasGMStorage) ctx.message("当前使用网页本地存储保存配置和处理列表。");
      if (ctx.storageFailed) ctx.message("浏览器存储不可用，请允许当前网站保存数据后刷新。");
      ctx.debug("界面挂载完成", { buttonConnected: host.isConnected, capturedBugs: ctx.bugs.size });
      requestAnimationFrame(() => {
        if (launch.hidden) {
          ctx.debug("入口按显示范围隐藏", { mode: ctx.config.entryVisibility });
          return;
        }
        constrainLaunch("initial-layout");
        const rect = launch.getBoundingClientRect(), style = getComputedStyle(launch);
        const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
        const visible = launch.isConnected && rect.width > 0 && rect.height > 0 && inViewport && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
        const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
        const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
        const topElement = visible ? document.elementFromPoint(x, y) : null;
        const covered = visible && topElement !== host && topElement !== launch;
        ctx.debug(visible && !covered ? "入口已显示" : "入口未显示或被遮挡", {
          buttonConnected: launch.isConnected,
          visible,
          inViewport,
          covered,
          position: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
          viewport: { width: innerWidth, height: innerHeight },
          zIndex: style.zIndex,
          connectionState: ctx.connectionPhase
        }, visible && !covered ? "info" : "warn");
      });
      if (ctx.config.token && ctx.config.api && entryShouldShow(ctx.config.entryVisibility, ctx.activeProfile)) void ctx.run(ctx.connectIfNeeded);
    }, "mount");
  }
  __name(createMount, "createMount");

  // src/platform/storage.js
  function createStorage({ debug = /* @__PURE__ */ __name(() => {
  }, "debug"), window: window2 = globalThis.window, GM_getValue: GM_getValue2 = globalThis.GM_getValue, GM_setValue: GM_setValue2 = globalThis.GM_setValue } = {}) {
    const hasGMStorage = typeof GM_getValue2 === "function" && typeof GM_setValue2 === "function";
    const hasNativeStorage = typeof window2.FastlaneNativeStorage?.getValue === "function" && typeof window2.FastlaneNativeStorage?.setValue === "function";
    const nativeStorageNamespace = "local.site.multica";
    const storagePrefix = "bugdone-multica:";
    let storageMode = "网页本地存储";
    let storageFailed = false;
    const memoryStore = /* @__PURE__ */ new Map();
    function readValue(key, fallback) {
      const storageKey = storagePrefix + key;
      if (hasGMStorage) {
        try {
          const value = GM_getValue2(storageKey, void 0);
          if (value !== void 0) {
            storageMode = "油猴脚本存储";
            return value;
          }
        } catch (e) {
          debug("油猴存储读取失败，尝试网页存储", { errorType: e.name }, "warn");
        }
      }
      if (hasNativeStorage) {
        for (const namespace of [nativeStorageNamespace, "local.bugdone.multica"]) {
          try {
            const value = window2.FastlaneNativeStorage.getValue(namespace, storageKey, void 0);
            if (value !== void 0) {
              if (namespace !== nativeStorageNamespace) {
                try {
                  window2.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value);
                } catch (e) {
                  debug("旧原生存储迁移未完成", { errorType: e.name }, "warn");
                }
              }
              storageMode = "Fastlane 原生脚本存储";
              return value;
            }
          } catch (e) {
            debug("原生脚本存储读取失败，尝试回退", { errorType: e.name }, "warn");
          }
        }
      }
      try {
        const raw = window2.localStorage.getItem(storageKey);
        if (raw !== null) {
          const value = JSON.parse(raw);
          if (hasGMStorage) try {
            GM_setValue2(storageKey, value);
            storageMode = "油猴脚本存储";
          } catch (_) {
          }
          else if (hasNativeStorage) try {
            window2.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value);
            storageMode = "Fastlane 原生脚本存储";
          } catch (_) {
          }
          return value;
        }
      } catch (e) {
        debug("localStorage 不可用，尝试 sessionStorage", { errorType: e.name }, "warn");
      }
      try {
        const raw = window2.sessionStorage.getItem(storageKey);
        if (raw !== null) {
          storageMode = "网页会话存储";
          return JSON.parse(raw);
        }
      } catch (e) {
        debug("sessionStorage 不可用，使用内存缓存", { errorType: e.name }, "warn");
      }
      return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    }
    __name(readValue, "readValue");
    function writeValue(key, value) {
      const storageKey = storagePrefix + key;
      const serialized = JSON.stringify(value);
      if (hasGMStorage) {
        try {
          GM_setValue2(storageKey, value);
          storageMode = "油猴脚本存储";
          return;
        } catch (e) {
          debug("油猴存储写入失败，尝试网页存储", { errorType: e.name }, "warn");
        }
      }
      if (hasNativeStorage) {
        try {
          window2.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value);
          storageMode = "Fastlane 原生脚本存储";
          return;
        } catch (e) {
          debug("原生脚本存储写入失败，尝试网页存储", { errorType: e.name }, "warn");
        }
      }
      try {
        window2.localStorage.setItem(storageKey, serialized);
        storageMode = "网页本地存储";
        return;
      } catch (e) {
        debug("localStorage 写入失败，尝试 sessionStorage", { errorType: e.name }, "warn");
      }
      try {
        window2.sessionStorage.setItem(storageKey, serialized);
        storageMode = "网页会话存储";
        return;
      } catch (e) {
        debug("sessionStorage 写入失败，使用内存缓存", { errorType: e.name }, "warn");
      }
      memoryStore.set(key, value);
      storageMode = "页面内存缓存";
    }
    __name(writeValue, "writeValue");
    return { readValue, writeValue, hasGMStorage, hasNativeStorage, get mode() {
      return storageMode;
    }, get failed() {
      return storageFailed;
    } };
  }
  __name(createStorage, "createStorage");

  // src/multica/network.js
  function createNetwork({ debug = /* @__PURE__ */ __name(() => {
  }, "debug"), setConnectionPhase = /* @__PURE__ */ __name(() => {
  }, "setConnectionPhase"), window: window2 = globalThis.window, fetch: fetch2 = globalThis.fetch, AbortController: AbortController2 = globalThis.AbortController, location: location2 = globalThis.location, GM_xmlhttpRequest: GM_xmlhttpRequest2 = globalThis.GM_xmlhttpRequest } = {}) {
    async function bugDoneForm(params) {
      const controller = new AbortController2();
      const timer = setTimeout(() => controller.abort(), 12e3);
      try {
        const response = await fetch2("/Service/Bugdone/BugAPI.ashx", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: new URLSearchParams(params).toString(),
          signal: controller.signal
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        try {
          return await response.json();
        } catch {
          throw Error("响应不是有效 JSON，请检查 BugDone 登录状态");
        }
      } catch (error) {
        if (error.name === "AbortError") throw Error("BugDone 请求超时，状态可能已改变，请刷新确认");
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    __name(bugDoneForm, "bugDoneForm");
    function request(c) {
      return (method, path, body) => new Promise((resolve, reject) => {
        let done = false, handle;
        const tag = connectionCacheTag(c.api, c.token);
        const finish = /* @__PURE__ */ __name((fn, x) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (fn === reject || x?.status === 401) setConnectionPhase("error", tag);
          fn(x);
        }, "finish");
        const timer = setTimeout(() => {
          finish(reject, Error("请求超时；提交结果可能未知，请勿盲目重复创建"));
          handle?.abort();
        }, 3e4);
        const headers = { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" };
        if (c.workspace) headers["X-Workspace-ID"] = c.workspace;
        try {
          if (typeof GM_xmlhttpRequest2 === "function") {
            handle = GM_xmlhttpRequest2({
              method,
              url: c.api + path,
              anonymous: true,
              redirect: "error",
              headers,
              data: body ? JSON.stringify(body) : void 0,
              onload: /* @__PURE__ */ __name((r) => {
                let data;
                try {
                  data = JSON.parse(r.responseText);
                } catch {
                  data = null;
                }
                if (r.finalUrl && new URL(r.finalUrl).origin !== c.api) return finish(reject, Error("API 发生跨域跳转，已停止"));
                finish(resolve, { status: r.status, data });
              }, "onload"),
              onerror: /* @__PURE__ */ __name(() => finish(reject, Error("网络失败：检查 API 地址、油猴 @connect 权限和浏览器网络设置")), "onerror"),
              onabort: /* @__PURE__ */ __name(() => finish(reject, Error("请求已中止")), "onabort")
            });
          } else if (typeof window2.FastlaneNativeNetwork?.request === "function") {
            const options = { method, url: c.api + path, headers, timeoutMs: 3e4, responseType: "text" };
            if (body) options.body = JSON.stringify(body);
            window2.FastlaneNativeNetwork.request(options).then((response) => {
              if (response.url && new URL(response.url).origin !== c.api) throw Error("API 发生跨域跳转，已停止");
              let data;
              try {
                data = JSON.parse(response.body);
              } catch {
                data = null;
              }
              finish(resolve, { status: response.status, data });
            }).catch((error) => finish(reject, Error(`原生网络桥请求失败：${error.message || String(error)}`)));
            debug("Multica API 使用 Fastlane 原生网络桥");
          } else if (typeof fetch2 === "function" && typeof AbortController2 === "function") {
            const controller = new AbortController2();
            handle = { abort: /* @__PURE__ */ __name(() => controller.abort(), "abort") };
            fetch2(c.api + path, { method, headers, body: body ? JSON.stringify(body) : void 0, redirect: "error", signal: controller.signal }).then((response) => {
              if (response.url && new URL(response.url).origin !== c.api) throw Error("API 发生跨域跳转，已停止");
              return response.text().then((text) => {
                let data;
                try {
                  data = JSON.parse(text);
                } catch {
                  data = null;
                }
                return { status: response.status, data };
              });
            }).then((result) => finish(resolve, result)).catch((error) => {
              if (error.name === "AbortError") return finish(reject, Error("请求已中止"));
              const detail = error.message === "Load failed" || error.message === "Failed to fetch" ? `WebView 跨域请求被拒绝（通常是 API CORS、TLS 证书或网络策略）。请更新带原生网络桥的 Mac App，或让 API 允许来源 ${location2.origin} 及 Authorization、X-Workspace-ID、Content-Type 请求头。` : error.message || "请检查 API 地址和网络连接";
              finish(reject, Error(`WebView API 请求失败：${detail}`));
            });
            debug("Multica API 使用 WebView fetch 兼容通道");
          } else throw Error("当前 WebView 没有 GM_xmlhttpRequest、FastlaneNativeNetwork 或 fetch/AbortController，无法访问 Multica API");
        } catch (e) {
          finish(reject, e);
        }
      });
    }
    __name(request, "request");
    function gmCall(options) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest2({
          ...options,
          anonymous: true,
          redirect: "error",
          timeout: 6e4,
          onload: resolve,
          onerror: /* @__PURE__ */ __name(() => reject(Error("网络请求失败")), "onerror"),
          ontimeout: /* @__PURE__ */ __name(() => reject(Error("网络请求超时")), "ontimeout"),
          onabort: /* @__PURE__ */ __name(() => reject(Error("网络请求已中止")), "onabort")
        });
      });
    }
    __name(gmCall, "gmCall");
    return { bugDoneForm, request, gmCall };
  }
  __name(createNetwork, "createNetwork");

  // src/attachments/service.js
  function createAttachments({ message = /* @__PURE__ */ __name(() => {
  }, "message"), gmCall, window: window2 = globalThis.window, document: document2 = globalThis.document, fetch: fetch2 = globalThis.fetch, GM_xmlhttpRequest: GM_xmlhttpRequest2 = globalThis.GM_xmlhttpRequest } = {}) {
    async function loadBugDoneImageBlob(attachment) {
      const source = new URL(attachment.url);
      if (source.protocol !== "https:" || !(attachment.allowedOrigins || ["https://img.bugdone.cn"]).includes(source.origin) || source.username || source.password || source.hash)
        throw Error("BugDone 图片地址不属于允许的 HTTPS 图片域");
      let blob;
      if (typeof window2.FastlaneNativeNetwork?.request === "function") {
        try {
          const response = await window2.FastlaneNativeNetwork.request({
            method: "GET",
            url: source.href,
            responseType: "base64",
            timeoutMs: 6e4
          });
          if (response.status !== 200 || typeof response.bodyBase64 !== "string") throw Error(`HTTP ${response.status}`);
          const binary = atob(response.bodyBase64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          const type = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "image/png";
          blob = new Blob([bytes], { type });
        } catch (nativeError) {
          try {
            const response = await fetch2(source.href, { credentials: "omit", mode: "cors" });
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            blob = await response.blob();
          } catch (_) {
            throw Error(`无法读取压缩所需的图片数据（${nativeError.message}）；请切换原图`);
          }
        }
      } else if (typeof GM_xmlhttpRequest2 === "function") {
        const response = await gmCall({ method: "GET", url: source.href, responseType: "blob" });
        if (response.status !== 200 || !(response.response instanceof Blob)) throw Error(`读取图片失败（HTTP ${response.status}）`);
        blob = response.response;
      } else {
        const response = await fetch2(source.href, { credentials: "omit", mode: "cors" });
        if (!response.ok) throw Error(`读取图片失败（HTTP ${response.status}）`);
        blob = await response.blob();
      }
      if (!blob.size || blob.size > 20 * 1024 * 1024 || !blob.type.toLowerCase().startsWith("image/"))
        throw Error("来源不是有效图片或超过 20 MiB");
      return blob;
    }
    __name(loadBugDoneImageBlob, "loadBugDoneImageBlob");
    async function compressBugDoneImage(attachment) {
      const source = await loadBugDoneImageBlob(attachment);
      if (source.type.toLowerCase() === "image/gif") throw Error(`「${attachment.name}」为 GIF，请切换原图以保留动画`);
      const objectUrl = URL.createObjectURL(source);
      let image;
      try {
        image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(Error("图片解码失败"));
          element.src = objectUrl;
        });
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!width || !height || width * height > 4e7) throw Error("图片尺寸无效或过大");
        const ratio = Math.min(1, (attachment.transform?.maxDimension || 2200) / Math.max(width, height));
        const canvas = document2.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const context = canvas.getContext("2d");
        if (!context) throw Error("当前环境无法压缩图片");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encode = /* @__PURE__ */ __name((type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)), "encode");
        let blob = await encode("image/webp", attachment.transform?.quality || 0.9);
        let extension = "webp";
        if (!blob || blob.type !== "image/webp") {
          blob = await encode("image/jpeg", attachment.transform?.quality || 0.92);
          extension = "jpg";
        }
        if (!blob?.size || blob.size >= source.size) throw Error("压缩后未减小体积，请切换原图提交");
        return { blob, name: `${String(attachment.name || "screenshot").replace(/\.[^.]+$/, "")}.${extension}` };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
    __name(compressBugDoneImage, "compressBugDoneImage");
    async function prepareBugDoneImages(bug, mode, removedNames, compressor = compressBugDoneImage) {
      const images = (bug.attachments || []).filter((item) => item.image && !removedNames.has(`${bug.BugId}:${item.name}`));
      if (mode === "original") return images.map((item) => ({
        ...item,
        remoteImage: true,
        original: true,
        generated: true,
        attachmentScope: bug.BugId,
        attachmentKey: item.name
      }));
      const prepared = [];
      for (const item of images) {
        const compressed = await compressor(item);
        prepared.push({
          ...item,
          name: compressed.name,
          file: compressed.blob,
          remoteImage: false,
          generated: true,
          attachmentScope: bug.BugId,
          attachmentKey: item.name
        });
      }
      return prepared;
    }
    __name(prepareBugDoneImages, "prepareBugDoneImages");
    async function uploadImage(c, attachment) {
      const source = new URL(attachment.url);
      const allowedOrigins = attachment.allowedOrigins || ["https://img.bugdone.cn"];
      if (source.protocol !== "https:" || !allowedOrigins.includes(source.origin) || source.username || source.password || source.hash)
        throw Error("图片地址不属于配置允许的 HTTPS 图片域");
      const target = `${c.api}/api/upload-file`;
      let status, data;
      if (typeof window2.FastlaneNativeNetwork?.request === "function") {
        const response = await window2.FastlaneNativeNetwork.request({
          method: "POST",
          url: target,
          sourceUrl: source.href,
          filename: attachment.name,
          headers: { Authorization: `Bearer ${c.token}`, "X-Workspace-ID": c.workspace },
          timeoutMs: 6e4,
          responseType: "text"
        });
        status = response.status;
        try {
          data = JSON.parse(response.body);
        } catch {
          data = null;
        }
      } else if (typeof GM_xmlhttpRequest2 === "function") {
        const image = await gmCall({ method: "GET", url: source.href, responseType: "blob" });
        if (image.status !== 200 || !(image.response instanceof Blob)) throw Error(`读取图片失败（HTTP ${image.status}）`);
        if (image.response.size > 20 * 1024 * 1024) throw Error("图片超过 20 MiB");
        if (!image.response.type.startsWith("image/")) throw Error("BugDone 返回的不是图片");
        const form = new FormData();
        form.append("file", image.response, attachment.name);
        const uploaded = await gmCall({ method: "POST", url: target, headers: {
          Authorization: `Bearer ${c.token}`,
          "X-Workspace-ID": c.workspace
        }, data: form });
        status = uploaded.status;
        try {
          data = JSON.parse(uploaded.responseText);
        } catch {
          data = null;
        }
      } else {
        throw Error("当前环境没有可用的跨域图片上传通道");
      }
      if (status < 200 || status >= 300 || !data?.id) throw Error(`上传失败（HTTP ${status}）：${String(data?.error || data?.message || "请检查 Multica 文件存储配置").slice(0, 150)}`);
      return data;
    }
    __name(uploadImage, "uploadImage");
    async function uploadLocalAttachment(c, attachment) {
      const blob = attachment.file || new Blob([attachment.content || ""], { type: attachment.mimeType || "text/plain" });
      if (!(blob instanceof Blob) || !blob.size || blob.size > 20 * 1024 * 1024) throw Error("附件必须为 1 字节至 20 MiB 的本地文件");
      const name = String(attachment.name || "attachment").replace(/[\\/\r\n"]/g, "_").slice(0, 180);
      const target = `${c.api}/api/upload-file`;
      let status, data;
      if (typeof GM_xmlhttpRequest2 === "function") {
        const form = new FormData();
        form.append("file", blob, name);
        const result = await gmCall({ method: "POST", url: target, headers: {
          Authorization: `Bearer ${c.token}`,
          "X-Workspace-ID": c.workspace
        }, data: form });
        status = result.status;
        try {
          data = JSON.parse(result.responseText);
        } catch {
          data = null;
        }
      } else if (typeof window2.FastlaneNativeNetwork?.request === "function") {
        const encoder = new TextEncoder();
        const boundary = `Fastlane-${crypto.randomUUID()}`;
        const start = encoder.encode(`--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${name}"\r
Content-Type: ${blob.type || "application/octet-stream"}\r
\r
`);
        const end = encoder.encode(`\r
--${boundary}--\r
`);
        const options = {
          method: "POST",
          url: target,
          headers: {
            Authorization: `Bearer ${c.token}`,
            "X-Workspace-ID": c.workspace,
            "Content-Type": `multipart/form-data; boundary=${boundary}`
          },
          timeoutMs: 6e4,
          responseType: "text"
        };
        const size = start.length + blob.size + end.length;
        let result;
        if (size > 1048576) {
          if (typeof window2.FastlaneNativeNetwork.uploadFile !== "function")
            throw Error("当前 Mac App 网络桥单个本地附件上限为 1 MiB；请更新 FastlaneTool 后重试");
          result = await window2.FastlaneNativeNetwork.uploadFile(
            options,
            new Blob([start, blob, end], { type: options.headers["Content-Type"] })
          );
        } else {
          const payload = new Uint8Array(await blob.arrayBuffer());
          const multipart = new Uint8Array(size);
          multipart.set(start);
          multipart.set(payload, start.length);
          multipart.set(end, start.length + payload.length);
          let binary = "";
          for (let i = 0; i < multipart.length; i += 32768) binary += String.fromCharCode(...multipart.subarray(i, i + 32768));
          result = await window2.FastlaneNativeNetwork.request({ ...options, bodyBase64: btoa(binary) });
        }
        status = result.status;
        try {
          data = JSON.parse(result.body);
        } catch {
          data = null;
        }
      } else throw Error("当前环境没有可用的本地附件上传通道");
      if (status < 200 || status >= 300 || !data?.id) throw Error(`附件上传失败（HTTP ${status}）`);
      return data.id;
    }
    __name(uploadLocalAttachment, "uploadLocalAttachment");
    async function prepareSelectedAttachments(c, body, attachments) {
      const ids = [...body.attachment_ids || []];
      for (let index = 0; index < attachments.length; index++) {
        message(`正在上传附件 ${index + 1}/${attachments.length}：${attachments[index].name}`);
        try {
          const item = attachments[index];
          const prepared = item.remoteImage && item.transform && !item.original ? { ...item, ...await compressBugDoneImage(item) } : null;
          ids.push(prepared ? await uploadLocalAttachment(c, { ...prepared, file: prepared.blob }) : item.remoteImage ? (await uploadImage(c, item)).id : await uploadLocalAttachment(c, item));
        } catch (error) {
          throw Error(`附件「${attachments[index].name}」上传失败：${error.message}；任务尚未创建。此前已上传的文件可能暂存在 Multica。`);
        }
      }
      return ids.length ? { ...body, attachment_ids: ids } : body;
    }
    __name(prepareSelectedAttachments, "prepareSelectedAttachments");
    return { loadBugDoneImageBlob, compressBugDoneImage, prepareBugDoneImages, uploadImage, uploadLocalAttachment, prepareSelectedAttachments };
  }
  __name(createAttachments, "createAttachments");

  // .generated/page-world.txt
  var page_world_default = '(() => {\n  var __defProp = Object.defineProperty;\n  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });\n\n  // src/platform/hooks.js\n  function installRouteHooks(page, changed) {\n    const restores = [];\n    const notify = /* @__PURE__ */ __name(() => {\n      try {\n        changed();\n      } catch (_) {\n      }\n    }, "notify");\n    for (const method of ["pushState", "replaceState"]) {\n      const original = page.history?.[method];\n      if (typeof original !== "function") continue;\n      const wrapped = /* @__PURE__ */ __name(function(...args) {\n        const before = page.location.href;\n        const result = original.apply(this, args);\n        if (page.location.href !== before) notify();\n        return result;\n      }, "wrapped");\n      page.history[method] = wrapped;\n      restores.push(() => {\n        if (page.history[method] === wrapped) page.history[method] = original;\n      });\n    }\n    page.addEventListener("popstate", notify);\n    page.addEventListener("hashchange", notify);\n    return () => {\n      restores.reverse().forEach((restore) => restore());\n      page.removeEventListener("popstate", notify);\n      page.removeEventListener("hashchange", notify);\n    };\n  }\n  __name(installRouteHooks, "installRouteHooks");\n  function installCaptureHooks(page, collectResponse, matches) {\n    let stopped = false;\n    const restores = [];\n    const requests = /* @__PURE__ */ new WeakMap();\n    const absoluteURL = /* @__PURE__ */ __name((value) => {\n      try {\n        return new URL(String(value), page.location?.href).href;\n      } catch {\n        return String(value);\n      }\n    }, "absoluteURL");\n    const selectRequest = /* @__PURE__ */ __name((body, rule) => {\n      if (!rule?.requestKeys?.length || typeof body !== "string" || body.length > 1e5) return {};\n      let parsed;\n      try {\n        parsed = JSON.parse(body);\n      } catch {\n        return {};\n      }\n      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};\n      return Object.fromEntries(rule.requestKeys.filter((key) => Object.hasOwn(parsed, key) && ["string", "number"].includes(typeof parsed[key])).map((key) => [key, parsed[key]]));\n    }, "selectRequest");\n    const deliver = /* @__PURE__ */ __name((value, rule, request, sourceUrl) => {\n      const text = typeof value === "string" ? value : JSON.stringify(value);\n      if (stopped || typeof text !== "string" || new TextEncoder().encode(text).byteLength > (rule?.maxResponseBytes || 4e6)) return;\n      collectResponse(value, { ruleId: rule?.id || "", request, sourceUrl });\n    }, "deliver");\n    const prototype = page.XMLHttpRequest?.prototype;\n    if (prototype) {\n      const originalOpen = prototype.open, originalSend = prototype.send;\n      prototype.open = function(method, url, ...args) {\n        requests.set(this, { method: String(method).toUpperCase(), url: String(url) });\n        return originalOpen.call(this, method, url, ...args);\n      };\n      prototype.send = function(...args) {\n        const request = requests.get(this);\n        const rule = !stopped && request && matches(absoluteURL(request.url), request.method);\n        const selected = selectRequest(args[0], rule);\n        const sourceUrl = page.location?.href || "";\n        if (rule) this.addEventListener("load", function() {\n          if (this.status !== 200) return;\n          try {\n            deliver(this.responseType === "json" ? this.response : this.responseText, rule, selected, sourceUrl);\n          } catch (_) {\n          }\n        }, { once: true });\n        return originalSend.apply(this, args);\n      };\n      const wrappedOpen = prototype.open, wrappedSend = prototype.send;\n      restores.push(() => {\n        if (prototype.open === wrappedOpen) prototype.open = originalOpen;\n        if (prototype.send === wrappedSend) prototype.send = originalSend;\n      });\n    }\n    if (typeof page.fetch === "function") {\n      const originalFetch = page.fetch;\n      page.fetch = function(...args) {\n        const result = originalFetch.apply(this, args);\n        const input = args[0];\n        const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;\n        const method = String(args[1]?.method || input?.method || "GET").toUpperCase();\n        const rule = !stopped && matches(absoluteURL(url), method), selected = selectRequest(args[1]?.body, rule);\n        const sourceUrl = page.location?.href || "";\n        if (rule) Promise.resolve(result).then(async (response) => {\n          if (response.ok) deliver(await response.clone().text(), rule, selected, sourceUrl);\n        }).catch(() => {\n        });\n        return result;\n      };\n      const wrappedFetch = page.fetch;\n      restores.push(() => {\n        if (page.fetch === wrappedFetch) page.fetch = originalFetch;\n      });\n    }\n    return { xhr: !!prototype, fetch: typeof page.fetch === "function", stop() {\n      stopped = true;\n      restores.reverse().forEach((restore) => restore());\n    } };\n  }\n  __name(installCaptureHooks, "installCaptureHooks");\n\n  // src/sites/builtins.js\n  var BUGDONE_PROFILE = {\n    schemaVersion: 2,\n    id: "bugdone",\n    version: 2,\n    enabled: true,\n    metadata: { name: "BugDone" },\n    adapter: "bugdone",\n    defaultLabel: { mode: "inherit" },\n    presentation: { recordLabel: "选择问题", hideSelectors: ["#openIntelligentTracking"], drawerSelectors: ["#asideProblem"] },\n    links: { shareTemplate: "https://www.bugdone.cn/cn/bugPreview/{{scopeId}}/{{recordId}}" },\n    allowedOrigins: ["https://www.bugdone.cn", "https://bugdone.cn"],\n    pages: [\n      { kind: "list", path: "/cn/bugManagement_*" },\n      { kind: "list", path: "/cn/bugManagement/:view/:projectId/:productId" },\n      { kind: "detail", path: "/cn/bugPreview/:projectId/:bugId" }\n    ],\n    captures: [{\n      id: "bug-api",\n      method: "POST",\n      origin: "https://www.bugdone.cn",\n      path: "/Service/BugDone/BugAPI.ashx",\n      maxResponseBytes: 4e6,\n      success: { path: "$.Result", equals: 1 },\n      variants: [\n        { kind: "list", path: "$.ReturnObj.ItemList", type: "array" },\n        { kind: "detail", path: "$.ReturnObj", type: "object" }\n      ]\n    }],\n    record: {\n      scopeId: "$.ProjectId",\n      recordId: "$.BugId",\n      title: "$.BugTitle",\n      number: "$.BugCode",\n      descriptionHtml: "$.Description",\n      fields: {\n        projectName: "$.ProjectName",\n        productName: "$.ProductName",\n        moduleName: "$.ModuleName",\n        priority: "$.StrPriority",\n        state: "$.StrBugStatus",\n        environment: "$.Environment"\n      }\n    },\n    draft: {\n      titleTemplate: "[BugDone] #{{number}} {{title}} [BugDone:{{recordId}}]",\n      descriptionTemplate: "[BugDone:{{recordId}}]\\n\\n来源：{{sourceUrl}}\\n只读分享：{{shareUrl}}\\nBug ID：{{recordId}}\\n编号：{{number}}\\n项目：{{projectName}}\\n产品：{{productName}}\\n模块：{{moduleName}}\\n优先级：{{priority}}\\nBugDone 状态：{{state}}\\n环境：{{environment}}\\n\\n任务要求：\\n{{title}}\\n\\n详细描述：\\n{{description}}\\n\\n截图与附件：\\n{{attachmentLinks}}\\n\\n请分析问题并修复，在交付时说明根因、修改和验证结果；遇到信息不足时先在任务中说明。"\n    },\n    dedup: { keyTemplate: "bugdone:{{scopeId}}:{{recordId}}" },\n    attachments: [{\n      id: "screenshots",\n      kind: "image-url",\n      path: "$.BugAccessoryList",\n      items: { url: "$.FullFileUrl", name: "$.FileName", extension: "$.ext", filter: { path: "$.ActiveFlg", notEquals: false } },\n      filenameTemplate: "bug-{{recordId}}.png",\n      allowedOrigins: ["https://img.bugdone.cn"],\n      transform: { preset: "image", maxDimension: 2200, quality: 0.9 }\n    }],\n    postActions: [{ adapter: "bugdone.start-processing", enabled: true }]\n  };\n  BUGDONE_PROFILE.captures.push({ ...BUGDONE_PROFILE.captures[0], id: "bug-api-alias", origin: "https://bugdone.cn" });\n  var PAGE_TEXT_TEMPLATE = {\n    schemaVersion: 2,\n    id: "example-text-page",\n    version: 1,\n    enabled: false,\n    captureMode: "text",\n    metadata: { name: "文本捕获示例" },\n    allowedOrigins: ["https://docs.example.test"],\n    pages: [{ kind: "manual", path: "/**" }],\n    draft: { titleTemplate: "{{pageTitle}}", descriptionTemplate: "来源：{{pageUrl}}\\n\\n选取内容：\\n{{selectedText}}" }\n  };\n  var PAGE_BLANK_TEMPLATE = {\n    ...PAGE_TEXT_TEMPLATE,\n    id: "example-blank-page",\n    captureMode: "blank",\n    metadata: { name: "空白填写示例" },\n    draft: { titleTemplate: "", descriptionTemplate: "" }\n  };\n\n  // src/capture/matching.js\n  function matchSiteCapture(profile, { url, method, bytes = 0, contentType = "" }) {\n    if (!profile?.enabled) return null;\n    const parsed = locationOf(url, profile.allowedOrigins[0]);\n    if (!profile.allowedOrigins.includes(parsed?.origin)) return null;\n    if (!parsed || contentType && !/\\bjson\\b|\\+json\\b/i.test(contentType)) return null;\n    return (profile.captures || []).find((rule) => rule.method === String(method).toUpperCase() && rule.origin === parsed.origin && pathMatches(rule.path, parsed.pathname) && bytes <= rule.maxResponseBytes) || null;\n  }\n  __name(matchSiteCapture, "matchSiteCapture");\n  function pathMatches(pattern, pathname) {\n    const source = pattern.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part.split("*").map((value) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).join("[^/]*")).join("/");\n    return new RegExp(`^${source}/?$`, "i").test(pathname);\n  }\n  __name(pathMatches, "pathMatches");\n  function locationOf(url, base) {\n    try {\n      return new URL(String(url), base);\n    } catch {\n      return null;\n    }\n  }\n  __name(locationOf, "locationOf");\n\n  // src/platform/page-world.js\n  window.__multicaPageWorld || (window.__multicaPageWorld = {\n    capture(profile, channel) {\n      window.__multicaCaptureStop?.();\n      const hooks = installCaptureHooks(window, (value, meta) => window.postMessage({ channel, text: typeof value === "string" ? value : JSON.stringify(value), meta }, location.origin), (url, method) => matchSiteCapture(profile, { url, method }));\n      window.__multicaCaptureStop = hooks.stop;\n    },\n    routes(channel) {\n      installRouteHooks(window, () => window.dispatchEvent(new Event(channel)));\n    }\n  });\n})();\n';

  // src/platform/page-injection.js
  function captureBootstrap(profile, channel) {
    return page_world_default + "\nwindow.__multicaPageWorld.capture(" + JSON.stringify(profile) + "," + JSON.stringify(channel) + ");";
  }
  __name(captureBootstrap, "captureBootstrap");
  function routeBootstrap(channel) {
    return page_world_default + "\nwindow.__multicaPageWorld.routes(" + JSON.stringify(channel) + ");";
  }
  __name(routeBootstrap, "routeBootstrap");

  // src/app.js
  function startApp() {
    let siteMode = siteModeForUrl(window.location.href);
    const DEBUG = true;
    function debug(stage, data = {}, level = "info") {
      if (DEBUG) console[level](`[网页→Multica] ${stage}`, data);
    }
    __name(debug, "debug");
    debug("脚本已启动", {
      version: SCRIPT_VERSION,
      path: location.pathname,
      readyState: document.readyState,
      unsafeWindow: typeof unsafeWindow !== "undefined",
      GM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function",
      FastlaneNativeNetwork: typeof window.FastlaneNativeNetwork?.request === "function",
      fetch: typeof fetch === "function",
      abortController: typeof AbortController === "function",
      webLocks: !!navigator.locks
    });
    const bugs = /* @__PURE__ */ new Map(), capturedRecords = /* @__PURE__ */ new Map(), umengState = createUmengCaptureState();
    let currentId = "", root, busy = false, previewFingerprint = "", previewRecordId = "", activeDraft = null, taskDraft = null;
    let selectedAttachments = [];
    let captureRecordChoice = null;
    let uiScheduled = false, pagePreviewContext = "";
    let attachmentDraftKey = "";
    let umengStackMode = "summary", bugImageMode = "compressed", captureModeRecordKey = "";
    const removedAutoAttachments = /* @__PURE__ */ new Set();
    const storage = createStorage({ debug, GM_getValue: typeof GM_getValue === "function" ? GM_getValue : void 0, GM_setValue: typeof GM_setValue === "function" ? GM_setValue : void 0 });
    const { readValue, writeValue } = storage;
    let customProfiles = [];
    try {
      const saved = readValue("siteProfiles", []);
      if (Array.isArray(saved)) customProfiles = saved.slice(0, 20).flatMap((value) => {
        try {
          return [validateSiteProfile(value)];
        } catch {
          return [];
        }
      });
    } catch (_) {
    }
    let activeProfile = null;
    let builtinOverrides = readValue("builtinProfileOverrides", {}) || {};
    function profileRegistry() {
      return [...BUILTIN_PROFILES.map((base) => {
        const fallback = { ...base, enabled: base.adapter === "umeng" ? config.umengCaptureEnabled !== false : base.enabled };
        try {
          return builtinOverrides[base.id] ? validateSiteProfile(builtinOverrides[base.id]) : fallback;
        } catch {
          return fallback;
        }
      }), ...customProfiles];
    }
    __name(profileRegistry, "profileRegistry");
    function sourceName(id) {
      return id === "manual" ? "手动捕获" : profileRegistry().find((p) => p.id === id)?.metadata?.name || id || "BugDone";
    }
    __name(sourceName, "sourceName");
    let config = { api: "https://api.multica.ai", workspace: "", workspaceAlias: "", token: "", agent: "", defaultAgent: "", project: "", projectAlias: "", label: "" };
    config.hideNativeAI = true;
    config.umengCaptureEnabled = true;
    config.displayMode = "floating";
    config.entryVisibility = "configured";
    config.shortcut = DEFAULT_SHORTCUT;
    config.shortcutCustomized = false;
    let submittedBugs = [];
    const processingStates = /* @__PURE__ */ new WeakMap(), processingRows = /* @__PURE__ */ new Map();
    let processingRefreshPromise = null, processingRefreshAt = 0, processingRefreshContext = "";
    let processingSiteSelection = "", processingPageKey = "";
    let launchPosition = readValue("launchPosition", null);
    const savedConfig = readValue("config", null);
    config = normalizeShortcutConfig({ ...config, ...savedConfig || {} });
    config = { ...config, ...capturePreferences(config) };
    bugImageMode = config.defaultImageMode;
    umengStackMode = config.defaultLogMode;
    config.projectCustomized = savedConfig?.projectCustomized ?? !!(savedConfig && Object.hasOwn(savedConfig, "project"));
    config.defaultAgentCustomized = savedConfig?.defaultAgentCustomized ?? !!(savedConfig && Object.hasOwn(savedConfig, "defaultAgent"));
    if (siteMode === "umeng" && config.umengCaptureEnabled === false) siteMode = "manual";
    if (!["floating", "sidebar"].includes(config.displayMode)) config.displayMode = "floating";
    if (!/^(?=.*(?:Ctrl|Alt|Meta))(?:Ctrl\+)?(?:Alt\+)?(?:Meta\+)?(?:Shift\+)?[A-Z0-9]$/.test(config.shortcut || "")) config.shortcut = DEFAULT_SHORTCUT;
    if (!["configured", "all", "shortcut"].includes(config.entryVisibility)) config.entryVisibility = "configured";
    let connectionPhase = "idle";
    function setConnectionPhase(phase, expectedTag) {
      if (expectedTag && root && expectedTag !== connectionCacheTag($("api").value, $("token").value)) return;
      connectionPhase = phase;
      if (!root) return;
      const launch = $("launch");
      if (!launch) return;
      const badge = connectionBadge({ api: $("api").value, token: $("token").value }, phase);
      launch.querySelector(".launch-text").textContent = `Multica-AI · ${badge.text}`;
      launch.querySelector(".status-dot").style.backgroundColor = badge.color;
      launch.title = `${badge.text} · 脚本 v${SCRIPT_VERSION}；点击查看详情`;
    }
    __name(setConnectionPhase, "setConnectionPhase");
    const savedBugs = readValue("submittedBugs", []);
    submittedBugs = Array.isArray(savedBugs) ? savedBugs.slice(0, 100) : [];
    function submittedFor(id) {
      return submittedBugs.find((x) => x && x.bugId === id);
    }
    __name(submittedFor, "submittedFor");
    function rememberSubmittedDraft(draft, issue, c) {
      const identity = draft.sourceKey || `manual:${draft.draftId}`;
      const item = {
        siteId: draft.siteId,
        sourceKey: identity,
        fingerprint: draft.fingerprint || "",
        captureSiteId: draft.profile?.id || draft.captureProfile?.id || (draft.siteId !== "manual" ? draft.siteId : ""),
        captureSiteName: draft.profile?.metadata?.name || draft.captureProfile?.metadata?.name || "",
        ...draft.legacyBug ? { bugId: draft.legacyBug.BugId, bugCode: draft.legacyBug.BugCode } : {},
        title: draft.title,
        issueId: issue.id,
        sourceUrl: draft.sourceUrl || "",
        detailUrl: draftSourceDetailUrl(draft),
        identifier: issue.identifier || "",
        issueTitle: issue.title || "",
        submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
        api: c.api,
        status: issue.status || "",
        workspace: c.workspace,
        workspaceAlias: c.workspaceAlias || "",
        project: c.project || "",
        projectAlias: c.projectAlias || ""
      };
      submittedBugs = [item, ...submittedBugs.filter((x) => x.workspace !== c.workspace || x.sourceKey !== identity && (!draft.legacyBug || x.bugId !== draft.legacyBug.BugId))].slice(0, 100);
      processingRefreshAt = 0;
      try {
        writeValue("submittedBugs", submittedBugs);
      } catch (error) {
        debug("通用处理列表保存失败", { errorType: error.name }, "warn");
      }
      return item;
    }
    __name(rememberSubmittedDraft, "rememberSubmittedDraft");
    function forgetSubmitted(item) {
      const identity = item.sourceKey || item.bugId;
      submittedBugs = submittedBugs.filter((x) => x !== item && !(identity && (x.sourceKey || x.bugId) === identity && x.workspace === item.workspace && (x.api || "") === (item.api || "")));
      try {
        writeValue("submittedBugs", submittedBugs);
      } catch (e) {
        debug("已处理列表删除失败", { errorType: e.name }, "warn");
      }
    }
    __name(forgetSubmitted, "forgetSubmitted");
    const hiddenSiteElements = /* @__PURE__ */ new Map();
    function setNativeAIVisibility(hidden) {
      for (const [el, display] of hiddenSiteElements) el.style.display = display;
      hiddenSiteElements.clear();
      if (!hidden) return;
      for (const selector of activeProfile?.presentation?.hideSelectors || []) document.querySelectorAll(selector).forEach((el) => {
        hiddenSiteElements.set(el, el.style.display);
        el.style.display = "none";
      });
    }
    __name(setNativeAIVisibility, "setNativeAIVisibility");
    function updateSiteLayoutStyle() {
      const style = document.getElementById("bugdone-multica-page-shift");
      if (!style) return;
      style.textContent = (activeProfile?.presentation?.drawerSelectors || []).map((selector) => `html[data-bugdone-multica-drawer-open="true"] ${selector}{right:var(--bugdone-multica-drawer-width)!important;max-width:calc(100vw - var(--bugdone-multica-drawer-width))!important}`).join("\n");
    }
    __name(updateSiteLayoutStyle, "updateSiteLayoutStyle");
    function watchNativeAI() {
      setNativeAIVisibility(config.hideNativeAI !== false);
      if (!document.body) return;
      const observer = new MutationObserver(() => setNativeAIVisibility(config.hideNativeAI !== false));
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    }
    __name(watchNativeAI, "watchNativeAI");
    const $ = /* @__PURE__ */ __name((id) => root.getElementById(id), "$");
    let pageLayoutSnapshot = null, layoutRestoreTimer = 0, panelCloseTimer = 0;
    function syncPageLayout(open) {
      const html = document.documentElement;
      const shift = open && config.displayMode === "sidebar" && window.innerWidth > 760 ? Math.min(520, window.innerWidth - 320) : 0;
      clearTimeout(layoutRestoreTimer);
      if (shift) {
        html.dataset.bugdoneMulticaDrawerOpen = "true";
        html.style.setProperty("--bugdone-multica-drawer-width", `${shift}px`);
        if (!pageLayoutSnapshot) pageLayoutSnapshot = { width: html.style.width, transition: html.style.transition };
        html.style.transition = pageLayoutSnapshot.transition ? `${pageLayoutSnapshot.transition}, width .26s ease` : "width .26s ease";
        html.style.width = `calc(100% - ${shift}px)`;
      } else if (pageLayoutSnapshot) {
        delete html.dataset.bugdoneMulticaDrawerOpen;
        html.style.removeProperty("--bugdone-multica-drawer-width");
        html.style.width = pageLayoutSnapshot.width;
        layoutRestoreTimer = setTimeout(() => {
          if (!pageLayoutSnapshot) return;
          html.style.transition = pageLayoutSnapshot.transition;
          pageLayoutSnapshot = null;
        }, 270);
      }
    }
    __name(syncPageLayout, "syncPageLayout");
    function openPanel() {
      const panel = $("panel");
      clearTimeout(panelCloseTimer);
      panel.hidden = false;
      $("launch").setAttribute("aria-expanded", "true");
      syncPageLayout(true);
      if (config.displayMode === "sidebar") {
        panel.dataset.open = "false";
        panel.getBoundingClientRect();
        panel.dataset.open = "true";
      }
      if (!$("view-processing").hidden) {
        renderProcessing();
        void refreshProcessingStatuses();
      }
    }
    __name(openPanel, "openPanel");
    function closePanel() {
      closeAttachmentPreview();
      if ($("reset-preferences-dialog")?.open) $("reset-preferences-dialog").close();
      const panel = $("panel");
      $("launch").setAttribute("aria-expanded", "false");
      syncPageLayout(false);
      if (config.displayMode === "sidebar" && !panel.hidden) {
        panel.dataset.open = "false";
        panelCloseTimer = setTimeout(() => {
          if (panel.dataset.open !== "true") panel.hidden = true;
        }, 270);
      } else panel.hidden = true;
    }
    __name(closePanel, "closePanel");
    function applyPanelMode(mode) {
      config.displayMode = mode === "sidebar" ? "sidebar" : "floating";
      $("panel").dataset.display = config.displayMode;
      $("mode-sidebar").setAttribute("aria-pressed", String(config.displayMode === "sidebar"));
      $("mode-floating").setAttribute("aria-pressed", String(config.displayMode === "floating"));
      $("panel").dataset.open = String(!$("panel").hidden);
      syncPageLayout(!$("panel").hidden);
    }
    __name(applyPanelMode, "applyPanelMode");
    function collect(data) {
      try {
        const items = parseResponse(data, activeProfile?.adapter === "bugdone" ? activeProfile : BUGDONE_PROFILE, { sourceUrl: location.href });
        const profile = activeProfile?.adapter === "bugdone" ? activeProfile : BUGDONE_PROFILE;
        collectStandardRecords(profile, extractProfileItems(profile.captures[0], data), capturedRecords, location.href);
        debug("响应解析完成", { bugs: items.length, details: items.filter((b) => b.detail).length });
        for (const b of items) {
          b.sourceUrl = location.href;
          if (b.captureRecord) b.captureRecord.sourceUrl = location.href;
          bugs.set(b.BugId, mergeBug(bugs.get(b.BugId), b));
          if (b.detail && (!root || $("bug").dataset.manual !== "true")) currentId = b.BugId;
        }
        if (items.length && root) renderBugs();
      } catch (e) {
        debug("响应解析跳过", { errorType: e.name }, "warn");
      }
    }
    __name(collect, "collect");
    function collectUmeng(response, meta) {
      try {
        const record = applyUmengCapture(umengState, response, meta, activeProfile || UMENG_PROFILE);
        if (record && root) renderCapturedRecords();
        if (record) debug("友盟记录已更新", { kind: meta.ruleId, detail: record.detail, logs: record.logs.length });
      } catch (error) {
        debug("友盟响应解析跳过", { errorType: error.name }, "warn");
      }
    }
    __name(collectUmeng, "collectUmeng");
    function collectCustom(response, meta) {
      try {
        const rule = activeProfile?.captures.find((item) => item.id === meta.ruleId);
        if (!rule || !matchProfilePage(activeProfile, meta.sourceUrl)) return;
        const count = collectStandardRecords(activeProfile, extractProfileItems(rule, response), capturedRecords, meta.sourceUrl);
        if (count && root) renderCapturedRecords();
        if (count) debug("配置站点记录已更新", { profile: activeProfile.id, records: count });
      } catch (error) {
        debug("配置站点响应解析跳过", { errorType: error.name }, "warn");
      }
    }
    __name(collectCustom, "collectCustom");
    let captureEpoch = 0, captureStops = [], captureHookFailed = false, observedCaptureContext = "", observedProfileSignature = "";
    function injectCaptureScript(code) {
      const node = document.createElement("script");
      node.textContent = code;
      (document.head || document.documentElement).appendChild(node);
      node.remove();
    }
    __name(injectCaptureScript, "injectCaptureScript");
    function installConfiguredPageBridge(profile, receive, epoch) {
      let cancelled = false, timer = 0;
      const channel = `multica-${epoch}-${Math.random().toString(36).slice(2)}`;
      const listener = /* @__PURE__ */ __name((event) => {
        const data = event.data;
        if (cancelled || event.source !== window || event.origin !== location.origin || data?.channel !== channel || typeof data.text !== "string") return;
        const rule = profile.captures.find((x) => x.id === data.meta?.ruleId);
        if (!rule || new TextEncoder().encode(data.text).byteLength > rule.maxResponseBytes) return;
        receive(data.text, data.meta);
      }, "listener");
      window.addEventListener("message", listener);
      const start = /* @__PURE__ */ __name(() => {
        if (cancelled) return;
        if (!document.documentElement) {
          timer = setTimeout(start, 30);
          return;
        }
        try {
          injectCaptureScript(captureBootstrap(profile, channel));
        } catch (error) {
          debug("页面世界监听安装失败", { errorType: error.name }, "warn");
        }
      }, "start");
      start();
      return () => {
        cancelled = true;
        clearTimeout(timer);
        window.removeEventListener("message", listener);
        if (document.documentElement) try {
          injectCaptureScript("window.__multicaCaptureStop?.(); window.__multicaCaptureStop=null;");
        } catch {
        }
      };
    }
    __name(installConfiguredPageBridge, "installConfiguredPageBridge");
    function syncEntryVisibility() {
      if (!root) return;
      $("launch").hidden = !entryShouldShow(config.entryVisibility, activeProfile);
    }
    __name(syncEntryVisibility, "syncEntryVisibility");
    function renderPageCapturePreview() {
      if (config.captureEnabled === false) return;
      const context = JSON.stringify([location.href, activeProfile]);
      if (pagePreviewContext === context) return;
      pagePreviewContext = context;
      if (["capture-title", "capture-description"].some((id) => $(id).dataset.generated === "false" && $(id).value)) return;
      activeDraft = buildPageCaptureDraft(activeProfile, { title: document.title, url: location.href });
      for (const [id, value] of [["capture-title", activeDraft.title], ["capture-description", activeDraft.description]]) {
        $(id).value = value;
        $(id).dataset.generated = "true";
      }
      $("capture-state").textContent = activeProfile.captureMode === "blank" ? "空白填写" : "文本模板";
      renderCaptureAttachments();
    }
    __name(renderPageCapturePreview, "renderPageCapturePreview");
    function syncCaptureUI() {
      if (!root) {
        if (document.body && entryShouldShow(config.entryVisibility, activeProfile)) scheduleDelayedMount();
        return;
      }
      syncEntryVisibility();
      $("capture-paused").hidden = config.captureEnabled !== false;
      $("bugdone-capture").hidden = siteMode !== "bugdone";
      $("generic-capture").hidden = siteMode === "bugdone";
      $("umeng-selector").hidden = !["umeng", "custom"].includes(siteMode);
      $("umeng-stack-options").hidden = siteMode !== "umeng";
      $("reset-page-capture").hidden = !activeProfile?.captureMode || activeProfile.captureMode === "api";
      $("manual-selector").hidden = siteMode !== "manual" || activeProfile?.captureMode === "blank";
      $("capture-heading").textContent = activeProfile ? `${sourceName(activeProfile.id)} 捕获` : "网页内容选取";
      $("capture-help").textContent = activeProfile?.captureMode === "text" ? "按文本模板组合页面标题、地址和主动选取的文字；不监听接口。" : activeProfile?.captureMode === "blank" ? "此站点使用空白填写；补充标题和内容后即可进入下一步。" : activeProfile ? "按站点配置读取列表和详情；核对内容与附件后创建任务。" : "选取网页可见文字后创建通用 AI 任务。";
      const label = $("umeng-selector").querySelector("label");
      if (label) label.textContent = activeProfile?.presentation?.recordLabel || "选择记录";
      root.querySelector(".brand small").textContent = "Issues处理工作台";
      root.querySelectorAll(".brand-icon, #launch img").forEach((image) => {
        image.hidden = siteMode !== "bugdone";
      });
      if (siteMode === "bugdone") renderBugs();
      else if (siteMode === "manual" && activeProfile) renderPageCapturePreview();
      else if (activeProfile) renderCapturedRecords();
      setNativeAIVisibility(config.hideNativeAI !== false);
      updateSiteLayoutStyle();
    }
    __name(syncCaptureUI, "syncCaptureUI");
    function refreshCaptureRuntime(force = false) {
      const profile = selectSiteProfile(profileRegistry(), location.href);
      const context = JSON.stringify([location.href, profile, config.captureEnabled]);
      if (!force && context === observedCaptureContext) return;
      observedCaptureContext = context;
      const epoch = ++captureEpoch;
      captureStops.splice(0).reverse().forEach((stop) => stop());
      const signature = JSON.stringify(profile);
      if (signature !== observedProfileSignature) {
        capturedRecords.clear();
        bugs.clear();
        for (const value of Object.values(umengState)) value.clear();
        if (activeDraft?.siteId !== "manual") activeDraft = null;
        previewFingerprint = "";
        previewRecordId = "";
        currentId = "";
        captureRecordChoice = null;
        observedProfileSignature = signature;
      }
      activeProfile = profile;
      siteMode = profile?.captureMode && profile.captureMode !== "api" ? "manual" : profile?.adapter || (profile ? "custom" : "manual");
      syncCaptureUI();
      if (root) {
        renderProcessing();
        if (!$("panel").hidden && !$("view-processing").hidden) void refreshProcessingStatuses();
      }
      if (config.captureEnabled === false || !profile || profile.captureMode && profile.captureMode !== "api") return;
      const sourceUrl = location.href;
      const receive = /* @__PURE__ */ __name((text, meta) => {
        if (config.captureEnabled === false || epoch !== captureEpoch || location.href !== sourceUrl || meta?.sourceUrl !== sourceUrl || !matchProfilePage(profile, meta.sourceUrl)) return;
        if (profile.adapter === "bugdone") collect(text);
        else if (profile.adapter === "umeng") collectUmeng(text, meta);
        else collectCustom(text, meta);
      }, "receive");
      const passive = { ...profile, captures: profile.captures.filter((rule2) => !rule2.requestOnPage) };
      if (passive.captures.length) {
        try {
          captureStops.push(installConfiguredPageBridge(passive, receive, epoch));
          const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
          const hooks = installCaptureHooks(page, receive, (url, method) => matchSiteCapture(passive, { url, method }));
          captureStops.push(hooks.stop);
        } catch (error) {
          captureHookFailed = true;
          debug("接口监听安装失败", { errorType: error.name }, "warn");
        }
      }
      const rule = profile.captures.find((rule2) => rule2.requestOnPage && rule2.origin === location.origin && pathMatches(rule2.path, location.pathname));
      if (!rule) return;
      const controller = new AbortController();
      captureStops.push(() => controller.abort());
      void (async () => {
        try {
          const response = await window.fetch(sourceUrl, { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal });
          const text = await response.text();
          if (epoch !== captureEpoch || location.href !== sourceUrl) return;
          if (!response.ok || !matchSiteCapture(profile, { url: sourceUrl, method: "GET", bytes: new TextEncoder().encode(text).byteLength, contentType: response.headers.get("content-type") || "text/html" })) throw Error("接口返回非 JSON、错误状态或超出大小限制");
          if (matchProfilePage(profile, sourceUrl)?.kind === "detail" && !extractProfileItems(rule, text).some(({ item, kind }) => profileIdentityMatches(profile, item, sourceUrl) && normalizeCapturedRecord(profile, item, { kind, sourceUrl })))
            throw Error("详情响应缺少有效记录，可能是接口结构已变化");
          receive(text, { ruleId: rule.id, sourceUrl, request: {} });
        } catch (error) {
          if (epoch === captureEpoch && error.name !== "AbortError") {
            debug("页面接口捕获失败", { errorType: error.name }, "warn");
            if (root) message(`接口捕获失败：${error.message}`, "warning");
          }
        }
      })();
    }
    __name(refreshCaptureRuntime, "refreshCaptureRuntime");
    const routeChannel = `multica-route-${Math.random().toString(36).slice(2)}`;
    window.addEventListener(routeChannel, () => refreshCaptureRuntime());
    try {
      installRouteHooks(typeof unsafeWindow !== "undefined" ? unsafeWindow : window, () => refreshCaptureRuntime());
    } catch (error) {
      debug("路由监听安装失败", { errorType: error.name }, "warn");
    }
    const installPageRoutes = /* @__PURE__ */ __name(() => {
      if (!document.documentElement) {
        setTimeout(installPageRoutes, 30);
        return;
      }
      try {
        injectCaptureScript(routeBootstrap(routeChannel));
      } catch (error) {
        debug("页面路由监听安装失败", { errorType: error.name }, "warn");
      }
    }, "installPageRoutes");
    installPageRoutes();
    refreshCaptureRuntime();
    setInterval(() => refreshCaptureRuntime(), 800);
    function message(text, kind = "info") {
      const el = $("message");
      el.textContent = text;
      el.className = `status-${kind}`;
    }
    __name(message, "message");
    function settings(requireConnection = true) {
      const values = { ...capturePreferences(config), api: $("api").value.trim(), workspace: $("workspace").value, workspaceAlias: $("workspace").selectedOptions[0]?.textContent || "", token: $("token").value, project: $("default-project").value, projectAlias: $("default-project").selectedOptions[0]?.textContent || "", agent: $("agent").value, defaultAgent: $("default-agent").value, label: $("default-label").value, hideNativeAI: $("hide-native-ai").checked, umengCaptureEnabled: config.umengCaptureEnabled, displayMode: config.displayMode, entryVisibility: config.entryVisibility, shortcut: config.shortcut, shortcutCustomized: config.shortcutCustomized, projectCustomized: config.projectCustomized, defaultAgentCustomized: config.defaultAgentCustomized };
      return requireConnection ? validateConfig(values) : validateStoredConfig(values);
    }
    __name(settings, "settings");
    function persistConfig(next = config) {
      try {
        writeValue("config", next);
        if (root && $("settings-save-state")) {
          const mode = typeof storage.mode === "string" ? storage.mode : "", limited = /会话|内存/.test(mode);
          $("settings-save-state").textContent = mode.includes("内存") ? "仅保存在当前页面" : mode.includes("会话") ? "已保存到当前会话" : "已保存";
          $("settings-save-state").dataset.kind = limited ? "warning" : "success";
        }
      } catch (error) {
        if (root && $("settings-save-state")) {
          $("settings-save-state").textContent = "保存失败，请重试";
          $("settings-save-state").dataset.kind = "error";
        }
        throw error;
      }
    }
    __name(persistConfig, "persistConfig");
    function persistConnectionSettings() {
      const api = $("api").value === "__add__" ? config.api : $("api").value, changed = config.api !== api;
      const next = validateStoredConfig({
        ...config,
        api,
        token: $("token").value,
        ...changed ? { workspace: "", workspaceAlias: "", project: "", projectAlias: "", defaultAgent: "", agent: "", label: "", projectCustomized: false, defaultAgentCustomized: false } : {}
      });
      persistConfig(next);
      if (changed || config.token !== next.token) setConnectionPhase("idle");
      config = next;
    }
    __name(persistConnectionSettings, "persistConnectionSettings");
    const network = createNetwork({ debug, setConnectionPhase, GM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : void 0 });
    const { bugDoneForm, request, gmCall } = network;
    const attachments = createAttachments({ message, gmCall, GM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : void 0 });
    const { loadBugDoneImageBlob, compressBugDoneImage, prepareBugDoneImages, uploadImage, uploadLocalAttachment, prepareSelectedAttachments } = attachments;
    function configuredShareUrl(b, profile) {
      return profileShareUrl(profile, { scopeId: b.ProjectId, recordId: b.BugId, siteId: profile.id, number: b.BugCode });
    }
    __name(configuredShareUrl, "configuredShareUrl");
    function description(b) {
      const profile = activeProfile?.adapter === "bugdone" ? activeProfile : BUGDONE_PROFILE;
      const record = b.captureRecord || normalizeCapturedRecord(profile, b, { kind: b.detail ? "detail" : "list", sourceUrl: b.sourceUrl });
      return record ? buildCapturedDraft({ ...record, sourceUrl: b.sourceUrl, attachments: b.attachments }, profile).description : "";
    }
    __name(description, "description");
    function renderBugs() {
      const select = $("bug");
      const selected = currentId || select.value;
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "不关联问题 · 手动填写";
      select.append(empty);
      for (const b2 of bugs.values()) {
        const o = document.createElement("option");
        o.value = b2.BugId;
        o.textContent = `#${b2.BugCode} ${b2.detail ? "✓详情" : "列表"} ${submittedFor(b2.BugId) ? "· 已提交 Multica-AI 处理 ·" : ""}${b2.BugTitle}`;
        select.append(o);
      }
      if (select.dataset.manual === "true") select.value = "";
      else if (bugs.has(selected)) select.value = selected;
      else if (bugs.size) select.value = bugs.keys().next().value;
      currentId = select.value;
      $("count").textContent = bugs.size ? `已捕获 ${bugs.size} 个 Bug · ${[...bugs.values()].filter((b2) => b2.detail).length} 个详情` : "等待捕获 · 请打开一个 Bug 的详情";
      const b = bugs.get(currentId);
      if (b && JSON.stringify(b) !== previewFingerprint) {
        preview();
      }
    }
    __name(renderBugs, "renderBugs");
    function renderCapturedRecords() {
      if (!root || !["umeng", "custom"].includes(siteMode)) return;
      const select = $("capture-record");
      const selected = select.value;
      const records = siteMode === "umeng" ? umengState.records : capturedRecords;
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "不关联问题 · 手动填写";
      select.append(empty);
      for (const [key, record2] of records) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `#${record2.number || record2.recordId} ${record2.detail ? "✓详情" : "列表"} ${record2.title}`;
        select.append(option);
      }
      const route = siteMode === "umeng" ? umengRoute(location.href) : null;
      const preferred = route?.errorId && [...records].find(([, item]) => item.scopeId === route.appId && item.recordId === route.errorId)?.[0] || [...records].find(([, item]) => item.sourceUrl && locationOf(item.sourceUrl)?.pathname === location.pathname && item.detail)?.[0];
      const manualChoice = captureRecordChoice?.url === location.href && captureRecordChoice.key === "";
      select.value = manualChoice ? "" : chooseCapturedRecord(records, {
        selected,
        preferred,
        manual: captureRecordChoice?.url === location.href ? captureRecordChoice.key : ""
      });
      const record = records.get(select.value);
      $("capture-state").textContent = record ? record.detail ? "详情已捕获" : "仅列表摘要" : manualChoice ? "手动填写" : "等待接口响应";
      if (!record || activeDraft?.siteId === "manual") {
        renderCaptureAttachments();
        return;
      }
      applyRecordCaptureDefaults(recordKey(record));
      const draft = siteMode === "umeng" ? buildUmengDraft(record, umengStackMode, activeProfile || UMENG_PROFILE) : buildCapturedDraft(record, activeProfile);
      const update = capturePreviewUpdate(
        activeDraft?.sourceKey,
        draft.sourceKey,
        $("capture-title").dataset.generated === "true",
        $("capture-description").dataset.generated === "true"
      );
      activeDraft = draft;
      if (update.title) {
        $("capture-title").value = draft.title;
        $("capture-title").dataset.generated = "true";
      }
      if (update.description) {
        $("capture-description").value = draft.description;
        $("capture-description").dataset.generated = "true";
      }
      const coverage = record.logCoverage;
      $("capture-coverage").textContent = siteMode === "umeng" ? `${record.detail ? "已捕获详情" : "请打开崩溃详情"} · 行为日志 ${record.logs.filter((x) => x.kind === "behavior").length} 条 · 堆栈 ${record.logs.filter((x) => x.kind === "stack").length} 份${coverage ? ` · 明细列表 ${coverage.captured}/${coverage.total}，已加载详情 ${record.logDetailCoverage?.captured || 0}/${coverage.total}（点击其他明细以继续捕获）` : " · 尚未捕获错误明细列表"}` : `${record.detail ? "已捕获详情" : "仅捕获列表摘要，请进入详情页面"} · ${activeProfile.id} · 文本附件 ${(record.attachments || []).length} 份${record.attachmentWarnings?.length ? ` · ${record.attachmentWarnings.join("；")}` : ""}`;
      renderCaptureAttachments();
    }
    __name(renderCapturedRecords, "renderCapturedRecords");
    function captureSelection() {
      const selection = selectedVisibleText(window.getSelection(), root);
      const draft = activeProfile?.captureMode === "text" ? buildPageCaptureDraft(activeProfile, { title: document.title, text: selection, url: location.href }) : buildManualDraft({ title: document.title, text: selection, url: location.href });
      activeDraft = { ...draft, draftId: crypto.randomUUID() };
      $("capture-title").value = draft.title;
      $("capture-description").value = draft.description;
      $("capture-title").dataset.generated = "false";
      $("capture-description").dataset.generated = "false";
      $("capture-state").textContent = "已选取";
      renderCaptureAttachments();
      const possible = submittedBugs.find((item) => item.fingerprint === draft.fingerprint && item.api === config.api && item.workspace === config.workspace);
      message(possible ? `可能重复：本地处理列表已有相同网页和选取内容（${possible.identifier || possible.issueId}）。请核对后再创建。` : "已捕获所选文字；请核对并进入 AI 任务创建。", possible ? "warning" : "success");
    }
    __name(captureSelection, "captureSelection");
    async function readRemotePreviewText(value) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw Error("文本预览只接受 HTTPS 地址");
      let body;
      if (typeof window.FastlaneNativeNetwork?.request === "function") {
        const response = await window.FastlaneNativeNetwork.request({
          method: "GET",
          url: url.href,
          responseType: "text",
          timeoutMs: 3e4
        });
        if (response.status < 200 || response.status >= 300) throw Error(`HTTP ${response.status}`);
        body = response.body;
      } else if (typeof GM_xmlhttpRequest === "function") {
        const response = await gmCall({ method: "GET", url: url.href, responseType: "text" });
        if (response.status < 200 || response.status >= 300) throw Error(`HTTP ${response.status}`);
        body = response.responseText;
      } else {
        const response = await fetch(url.href, { credentials: "omit", mode: "cors" });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        if (Number(response.headers.get("content-length")) > 1e6) throw Error("文件过大");
        body = await response.text();
      }
      if (typeof body !== "string" || body.length > 1e6) throw Error("文件过大或不是文本");
      return body;
    }
    __name(readRemotePreviewText, "readRemotePreviewText");
    function attachmentPreviewDescriptor(item) {
      const name = String(item?.name || "附件");
      const file = item?.file instanceof Blob ? item.file : null;
      const url = safeURL(item?.url);
      const image = !!(item?.image || item?.remoteImage || file?.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(name));
      const text = typeof item?.content === "string" || !!file?.type.startsWith("text/") || /\.(?:txt|log|json|csv|md)$/i.test(name);
      if (file) return { kind: image ? "image-file" : text ? "text-file" : "unavailable", name, file };
      if (typeof item?.content === "string") return { kind: "text-content", name, content: item.content };
      if (url) return { kind: image ? "image-url" : text ? "text-url" : "link", name, url };
      return { kind: "unavailable", name };
    }
    __name(attachmentPreviewDescriptor, "attachmentPreviewDescriptor");
    let attachmentPreviewUrl = "", attachmentPreviewRequest = 0;
    function closeAttachmentPreview() {
      attachmentPreviewRequest++;
      $("attachment-preview").hidden = true;
      $("attachment-preview-image").removeAttribute("src");
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      attachmentPreviewUrl = "";
    }
    __name(closeAttachmentPreview, "closeAttachmentPreview");
    async function openAttachmentPreview(item) {
      closeAttachmentPreview();
      const requestId = attachmentPreviewRequest;
      const descriptor = attachmentPreviewDescriptor(item);
      const view = $("attachment-preview");
      const image = $("attachment-preview-image");
      const text = $("attachment-preview-text");
      const link = $("attachment-preview-link");
      $("attachment-preview-title").textContent = descriptor.name;
      image.hidden = true;
      text.hidden = true;
      link.hidden = !descriptor.url;
      if (descriptor.url) link.href = descriptor.url;
      else link.removeAttribute("href");
      view.hidden = false;
      $("attachment-preview-close").focus();
      if (descriptor.kind === "image-url" || descriptor.kind === "image-file") {
        if (descriptor.kind === "image-file") attachmentPreviewUrl = URL.createObjectURL(descriptor.file);
        image.src = descriptor.url || attachmentPreviewUrl;
        image.hidden = false;
        image.onerror = () => {
          if (requestId !== attachmentPreviewRequest) return;
          image.hidden = true;
          text.textContent = "图片无法加载，可尝试打开原始附件。";
          text.hidden = false;
        };
        return;
      }
      text.hidden = false;
      if (descriptor.kind === "text-content") {
        text.textContent = descriptor.content.slice(0, 2e5) + (descriptor.content.length > 2e5 ? "\n\n（预览仅显示前 200,000 字符）" : "");
        return;
      }
      if (descriptor.kind === "text-file" || descriptor.kind === "text-url") {
        text.textContent = "正在读取文本…";
        try {
          const content = descriptor.file ? await descriptor.file.slice(0, 2e5).text() : await readRemotePreviewText(descriptor.url);
          const length = descriptor.file?.size || content.length;
          if (requestId === attachmentPreviewRequest) text.textContent = content.slice(0, 2e5) + (length > 2e5 ? "\n\n（预览仅显示前 200 KB）" : "");
        } catch (_) {
          if (requestId === attachmentPreviewRequest) text.textContent = "无法在面板内读取此文本附件。可尝试打开原始附件。";
        }
        return;
      }
      text.textContent = descriptor.kind === "link" ? "此文件格式暂不支持面板内预览，可打开原始附件。" : "此附件无法预览。";
    }
    __name(openAttachmentPreview, "openAttachmentPreview");
    function renderAttachmentItems(list, items, removable = false, onAdd = null) {
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "attachment-item";
        const open = document.createElement("button");
        open.type = "button";
        open.className = "attachment-open";
        open.textContent = item.name;
        open.setAttribute("aria-label", `查看 ${item.name}`);
        open.onclick = () => {
          void openAttachmentPreview(item);
        };
        row.append(open);
        if (onAdd) {
          const add = document.createElement("button");
          add.type = "button";
          add.textContent = "添加";
          add.setAttribute("aria-label", `添加 ${item.name}`);
          add.onclick = () => onAdd(item);
          row.append(add);
        }
        if (removable && item.remoteImage && item.transform) {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.textContent = item.original ? "原图 · 切换压缩" : "压缩 · 切换原图";
          toggle.onclick = () => {
            item.original = !item.original;
            renderSelectedAttachments();
          };
          row.append(toggle);
        }
        if (removable) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "×";
          remove.setAttribute("aria-label", `移除 ${item.name}`);
          remove.onclick = () => {
            if (item.generated) removedAutoAttachments.add(`${item.attachmentScope}:${item.attachmentKey || item.name}`);
            selectedAttachments = selectedAttachments.filter((value) => value !== item);
            renderSelectedAttachments();
          };
          row.append(remove);
        }
        list.append(row);
      }
    }
    __name(renderAttachmentItems, "renderAttachmentItems");
    function renderCaptureAttachments() {
      if (!root) return;
      const items = siteMode === "bugdone" ? bugs.get($("bug").value)?.attachments || [] : activeDraft?.attachments || [];
      const list = $(siteMode === "bugdone" ? "bug-attachments" : "capture-attachments");
      renderAttachmentItems(list, items);
      list.parentElement.hidden = !items.length;
    }
    __name(renderCaptureAttachments, "renderCaptureAttachments");
    function renderSelectedAttachments() {
      if (!root) return;
      renderAttachmentItems($("selected-attachments"), selectedAttachments, true);
      const key = /* @__PURE__ */ __name((item) => `${item.url || ""}|${item.attachmentKey || item.name || ""}`, "key");
      const available = (taskDraft?.attachments || []).filter((item) => !selectedAttachments.some((selected) => (selected.generated || selected.fromCapture) && key(selected) === key(item)));
      $("source-attachments").hidden = !available.length;
      renderAttachmentItems($("available-source-attachments"), available, false, (item) => {
        selectedAttachments.push({
          ...structuredClone(item),
          fromCapture: true,
          generated: false,
          attachmentKey: item.name,
          original: (taskDraft.captureDefaults || capturePreferences(config)).defaultImageMode === "original"
        });
        renderSelectedAttachments();
        message("已添加来源附件，提交任务时上传。", "success");
      });
    }
    __name(renderSelectedAttachments, "renderSelectedAttachments");
    function applyRecordCaptureDefaults(key) {
      if (captureModeRecordKey === key) return;
      captureModeRecordKey = key;
      bugImageMode = config.defaultImageMode;
      umengStackMode = config.defaultLogMode;
      if (!root) return;
      for (const [id, selected] of [
        ["bug-image-compressed", bugImageMode === "compressed"],
        ["bug-image-original", bugImageMode === "original"],
        ["umeng-stack-summary", umengStackMode === "summary"],
        ["umeng-stack-full", umengStackMode === "full"]
      ]) $(id).setAttribute("aria-pressed", String(selected));
    }
    __name(applyRecordCaptureDefaults, "applyRecordCaptureDefaults");
    function preview(force = false) {
      const b = bugs.get($("bug").value);
      if (!b) return;
      currentId = b.BugId;
      applyRecordCaptureDefaults(`bugdone:${b.BugId}`);
      previewFingerprint = JSON.stringify(b);
      const update = capturePreviewUpdate(
        force ? "" : previewRecordId,
        b.BugId,
        $("title").dataset.generated !== "false",
        $("description").dataset.generated !== "false"
      );
      previewRecordId = b.BugId;
      if (update.title) {
        $("title").value = b.captureRecord ? buildCapturedDraft(b.captureRecord, activeProfile || BUGDONE_PROFILE).title : bugTaskTitle(b);
        $("title").dataset.generated = "true";
      }
      if (update.description) {
        $("description").value = description(b);
        $("description").dataset.generated = "true";
      }
      $("share-url").value = configuredShareUrl(b, activeProfile || BUGDONE_PROFILE);
      renderCaptureAttachments();
      $("bug-state").textContent = b.detail ? "详情已就绪" : "等待详情";
      const expected = Number(b.PicCount) + Number(b.AttachmentCount);
      $("warning").textContent = !b.detail ? "仅捕获列表：请先打开此 Bug 的详情，待出现“✓详情”后提交。" : b.attachments.length < expected ? `原始记录有 ${expected} 个附件，目前仅捕获 ${b.attachments.length} 个；请核对附件是否完整。` : "已捕获详情。提交时会先上传截图到 Multica，再创建并指派任务。";
    }
    __name(preview, "preview");
    async function run(action) {
      if (busy) return;
      busy = true;
      root.querySelectorAll("button[data-action]").forEach((x) => x.disabled = true);
      try {
        await action();
      } catch (e) {
        message(e.message || String(e), "error");
      } finally {
        busy = false;
        root.querySelectorAll("button[data-action]").forEach((x) => x.disabled = false);
      }
    }
    __name(run, "run");
    function renderAgentChoices(c, list) {
      const choices = agentChoices(c, list);
      for (const [id, label, selected] of [
        ["agent", "先读取智能体", choices.selectedAgent],
        ["default-agent", "未设置默认智能体", choices.selectedDefault]
      ]) {
        const select = $(id);
        select.replaceChildren();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = label;
        select.append(empty);
        for (const agent of choices.agents) {
          const option = document.createElement("option");
          option.value = agent.id;
          option.textContent = agent.name;
          select.append(option);
        }
        select.value = selected;
      }
      return choices.agents.length;
    }
    __name(renderAgentChoices, "renderAgentChoices");
    function fillSelect(id, items, selected, emptyLabel, chooseFirst = false) {
      const select = $(id);
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = emptyLabel;
      select.append(empty);
      for (const item of items) {
        if (!item?.id || item.is_archived === true) continue;
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name || item.title || item.key || item.id;
        select.append(option);
      }
      if (selected && ![...select.options].some((option) => option.value === selected)) {
        const saved = document.createElement("option");
        saved.value = selected;
        saved.textContent = `已保存 · ${selected}`;
        select.append(saved);
      }
      if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
      else if (chooseFirst && select.options.length > 1) select.selectedIndex = 1;
      return select.value;
    }
    __name(fillSelect, "fillSelect");
    function configuredServers() {
      const saved = readValue("servers", []);
      return ["https://api.multica.ai", ...Array.isArray(saved) ? saved : []].filter((value, index, all) => all.indexOf(value) === index);
    }
    __name(configuredServers, "configuredServers");
    function renderServers() {
      const servers = configuredServers().map((api) => ({ id: api, name: api === "https://api.multica.ai" ? "Multica 官方 · https://api.multica.ai" : api }));
      if (config.api && !servers.some((item) => item.id === config.api)) servers.push({ id: config.api, name: config.api });
      fillSelect("api", servers, config.api, "选择 API 服务", true);
      const add = document.createElement("option");
      add.value = "__add__";
      add.textContent = "＋ 添加自建服务器";
      $("api").append(add);
    }
    __name(renderServers, "renderServers");
    function applyCatalog(c, data) {
      const sameContext = c.api === config.api && c.workspace === config.workspace;
      const project = sameContext && data.projects.some((item) => item.id === config.project) ? config.project : "";
      const agent = sameContext && data.agents.some((item) => item.id === config.agent) ? config.agent : "";
      const defaultAgent = sameContext && data.agents.some((item) => item.id === config.defaultAgent) ? config.defaultAgent : "";
      const projectContext = `${c.api}:${c.workspace}`, projectSelect = $("task-project");
      const keepProject = projectSelect.dataset.userEdited === "true" && projectSelect.dataset.context === projectContext;
      fillSelect("default-project", data.projects, project, "不指定项目", !sameContext || !config.projectCustomized);
      fillSelect("task-project", data.projects, keepProject ? projectSelect.value : project, "无项目", !keepProject && (!sameContext || !config.projectCustomized));
      projectSelect.dataset.context = projectContext;
      projectSelect.dataset.userEdited = String(keepProject);
      renderAgentChoices({ ...c, agent, defaultAgent }, data.agents);
      if ((!sameContext || !config.defaultAgentCustomized) && !$("default-agent").value && $("default-agent").options.length > 1) $("default-agent").selectedIndex = 1;
      if ((!sameContext || !config.defaultAgentCustomized) && !$("agent").value && $("agent").options.length > 1) $("agent").selectedIndex = 1;
      const label = sameContext ? config.label || "" : "";
      fillSelect("default-label", data.labels, label, "不指定标签");
      const labelContext = `${c.api}:${c.workspace}`, labelSelect = $("task-label");
      const keepEdited = labelSelect.dataset.userEdited === "true" && labelSelect.dataset.context === labelContext;
      fillSelect("task-label", data.labels, keepEdited ? labelSelect.value : resolveProfileLabel(taskDraft ? taskDraft.profile : activeProfile, { ...c, label }).value, "无标签");
      labelSelect.dataset.context = labelContext;
      labelSelect.dataset.userEdited = String(keepEdited);
    }
    __name(applyCatalog, "applyCatalog");
    function applyTaskDefaultLabel(profile = activeProfile) {
      const c = { ...config, api: $("api").value, workspace: $("workspace").value, label: $("default-label").value };
      const result = resolveProfileLabel(profile, c), catalog = readValue(`catalog:${c.api}:${c.workspace}`, {}) || {};
      fillSelect("task-label", catalog.labels || [], result.value, "无标签");
      $("task-label").dataset.userEdited = "false";
      $("task-label").dataset.context = `${c.api}:${c.workspace}`;
      if (result.warning) message(result.warning, "warning");
    }
    __name(applyTaskDefaultLabel, "applyTaskDefaultLabel");
    async function loadWorkspaceData(c) {
      const paths = [["projects", "/api/projects"], ["agents", "/api/agents"], ["labels", "/api/labels"]];
      const results = await Promise.all(paths.map(async ([key, path]) => {
        const response = await request(c)("GET", path);
        if (response.status !== 200) throw Error(`读取${key}失败（HTTP ${response.status}）`);
        return [key, listItems(response.data, key)];
      }));
      const data = Object.fromEntries(results);
      applyCatalog(c, data);
      writeValue(`catalog:${c.api}:${c.workspace}`, data);
      return data;
    }
    __name(loadWorkspaceData, "loadWorkspaceData");
    async function connect() {
      let tag;
      setConnectionPhase("connecting");
      try {
        const c = validateConnection({ api: $("api").value, token: $("token").value, workspace: "" });
        tag = connectionCacheTag(c.api, c.token);
        message("正在连接并读取工作区…");
        const response = await request(c)("GET", "/api/workspaces");
        if (response.status !== 200) throw Error(`连接失败（HTTP ${response.status}），请检查地址和令牌`);
        const workspaces = listItems(response.data, "workspaces");
        const preferred = workspaces.some((item) => item.id === config.workspace) ? config.workspace : "";
        const selected = fillSelect("workspace", workspaces, preferred, "选择工作区", true);
        if (!selected) throw Error("连接成功，但此账号没有可用工作区");
        const scoped = { ...c, workspace: selected };
        await loadWorkspaceData(scoped);
        config = {
          ...config,
          ...scoped,
          workspace: selected,
          project: $("default-project").value,
          defaultAgent: $("default-agent").value,
          agent: $("agent").value,
          label: $("default-label").value
        };
        persistConfig(config);
        writeValue(`workspaces:${c.api}`, workspaces);
        writeValue(`connection-tag:${c.api}`, tag);
        setConnectionPhase("connected", tag);
        message(`连接成功，已读取 ${workspaces.length} 个工作区及当前工作区的选项。`, "success");
      } catch (error) {
        setConnectionPhase("error", tag);
        throw error;
      }
    }
    __name(connect, "connect");
    async function connectIfNeeded() {
      if (!$("token").value.trim() || $("api").value === "__add__") {
        setConnectionPhase("idle");
        return;
      }
      const c = { api: $("api").value, token: $("token").value, workspace: $("workspace").value };
      const tag = connectionCacheTag(c.api, c.token);
      setConnectionPhase("connecting", tag);
      const workspaces = readValue(`workspaces:${c.api}`, null);
      const catalog = readValue(`catalog:${c.api}:${c.workspace}`, null);
      try {
        if (needsCatalogRefresh(c, readValue(`connection-tag:${c.api}`, ""), workspaces, catalog)) {
          await connect();
          return;
        }
        await verifyConnection(request({ ...c, workspace: "" }));
        fillSelect("workspace", workspaces, c.workspace, "选择工作区", true);
        applyCatalog(c, catalog);
        config = {
          ...config,
          ...c,
          project: $("default-project").value,
          defaultAgent: $("default-agent").value,
          agent: $("agent").value,
          label: $("default-label").value
        };
        persistConfig(config);
        setConnectionPhase("connected", tag);
        message("连接已验证，已恢复本地选项；需要更新时点击刷新。", "success");
      } catch (error) {
        setConnectionPhase("error", tag);
        throw error;
      }
    }
    __name(connectIfNeeded, "connectIfNeeded");
    async function submit() {
      if (!taskDraft) taskDraft = snapshotTaskDraft(buildTypedManualDraft({ title: $("task-title").value, description: $("task-description").value, url: location.href }));
      if (needsCapturedDetail(taskDraft) && !taskDraft.detail) throw Error("任务草稿只有列表摘要，请先打开详情并重新进入任务创建");
      const c = settings();
      c.project = $("task-project").value;
      c.projectAlias = $("task-project").selectedOptions[0]?.textContent || "";
      if (!$("agent-task").checked) throw Error("当前桥接只支持智能体任务");
      const body = buildIssueBody({
        title: $("task-title").value,
        description: $("task-description").value,
        agent: c.agent,
        project: c.project,
        status: $("task-status").value,
        priority: $("task-priority").value,
        label: $("task-label").value,
        startDate: $("task-start").value,
        dueDate: $("task-due").value
      });
      const draft = { ...taskDraft, title: body.title }, attachments2 = [...selectedAttachments];
      const lockName = draft.legacyBug ? cacheKey(c, draft.legacyBug.BugId) : `multica-draft:${c.api}:${c.workspace}:${draft.sourceKey || draft.draftId}`;
      const create = /* @__PURE__ */ __name(() => submitTaskOnce({
        c,
        draft,
        body,
        api: request(c),
        get: readValue,
        set: writeValue,
        prepareBody: /* @__PURE__ */ __name((value) => prepareSelectedAttachments(c, value, attachments2), "prepareBody")
      }), "create");
      message("正在检查重复任务，确认不存在后上传附件并创建…");
      const result = navigator.locks ? await navigator.locks.request(lockName, create) : await create();
      rememberSubmittedDraft(draft, result.issue, c);
      renderProcessing();
      if (siteMode === "bugdone") renderBugs();
      const text = `${result.existing ? "已找到并复用已有任务，未重复创建" : "任务已创建并指派"}：${result.issue.identifier || ""}
任务 ID：${result.issue.id}`;
      if (!result.existing) showSuccess(text);
      const notes = [];
      if (issueLabelState(result.issue, body.label_ids?.[0]) === "missing") notes.push(result.existing ? "复用任务未带当前所选标签，请在 Multica 中添加。" : "创建响应未包含所选标签，请在 Multica 中核对。");
      const profile = profileRegistry().find((p) => p.id === draft.siteId) || draft.profile;
      const actions = await runProfilePostActions(
        profile,
        { siteId: draft.siteId, sourceUrl: draft.sourceUrl, bug: draft.legacyBug, existing: result.existing },
        { "bugdone.start-processing": /* @__PURE__ */ __name((context) => startBugDoneProcessing(context.bug, bugDoneForm), "bugdone.start-processing") }
      );
      for (const action of actions) {
        if (action.kind === "started" || action.kind === "already-processing") {
          notes.push("BugDone 状态已确认为「处理中」。");
          const bug = bugs.get(draft.legacyBug?.BugId);
          if (bug) {
            bug.StrBugStatus = "处理中";
            if (bug.captureRecord?.fields) bug.captureRecord.fields.state = "处理中";
            renderBugs();
          }
        } else if (action.kind === "error") notes.push(`BugDone 状态同步未确认：${action.message}。Multica 任务已创建，请到 BugDone 核对。`);
        else notes.push(`BugDone 当前为「${action.state}」，未自动修改。`);
      }
      const warning = result.existing || issueLabelState(result.issue, body.label_ids?.[0]) === "missing" || actions.some((x) => !["started", "already-processing"].includes(x.kind));
      message([text, ...notes].join("\n"), warning ? "warning" : "success");
      if ($("continue-create").checked) {
        taskDraft = null;
        if (activeDraft?.siteId === "manual") activeDraft = null;
        selectedAttachments = [];
        renderSelectedAttachments();
        $("task-title").value = "";
        $("task-description").value = "";
        switchTab("bug");
      }
    }
    __name(submit, "submit");
    function switchTab(name, focus = false) {
      root.querySelectorAll('[role="tab"]').forEach((tab) => {
        const selected = tab.dataset.tab === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      });
      root.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        panel.hidden = panel.id !== `view-${name}`;
      });
      $("bug-action-bar").hidden = name !== "bug";
      if (name === "processing") {
        renderProcessing();
        void refreshProcessingStatuses();
      }
      if (name === "profiles") $("profile-json").dispatchEvent(new Event("catalogrefresh"));
    }
    __name(switchTab, "switchTab");
    function showSuccess(text) {
      const box = $("success");
      box.querySelector(".success-copy").textContent = text;
      box.hidden = false;
      box.classList.remove("success-pop");
      void box.offsetWidth;
      box.classList.add("success-pop");
      try {
        if (typeof box.showPopover === "function" && !box.matches(":popover-open")) box.showPopover();
      } catch (_) {
      }
      clearTimeout(showSuccess.timer);
      showSuccess.timer = setTimeout(() => {
        try {
          if (box.matches(":popover-open")) box.hidePopover();
        } catch (_) {
        }
        box.hidden = true;
      }, 5500);
    }
    __name(showSuccess, "showSuccess");
    function renderProcessing() {
      const list = $("processing-list");
      if (!list) return;
      list.replaceChildren();
      processingRows.clear();
      const view = processingSiteView(submittedBugs, profileRegistry(), location.href, processingSiteSelection, processingPageKey);
      processingSiteSelection = view.selected;
      processingPageKey = view.pageKey;
      const select = $("processing-site");
      select.replaceChildren();
      for (const option of view.options) {
        const node = document.createElement("option");
        node.value = option.key;
        node.textContent = `${option.label}（${option.count}）`;
        select.append(node);
      }
      select.value = view.selected;
      select.title = select.selectedOptions[0]?.textContent || "切换处理列表站点";
      $("processing-count").textContent = `当前 ${view.items.length} 条 · 总计 ${submittedBugs.length}/100`;
      $("refresh-processing").disabled = !view.items.length || !!processingRefreshPromise;
      if (!view.items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "此站点暂无处理记录，可切换其他站点或全部站点查看。";
        list.append(empty);
        return;
      }
      for (const item of view.items) {
        const row = document.createElement("article");
        row.className = "processing-item";
        const submittedAt = new Date(item.submittedAt);
        const time = Number.isNaN(submittedAt.getTime()) ? "提交时间未知" : `提交于 ${submittedAt.toLocaleString("zh-CN", { hour12: false })}`;
        row.innerHTML = `<div class="processing-main"><div class="processing-identifier"></div><div class="processing-title"></div><div class="processing-meta"></div></div><div class="processing-bottom"><div class="processing-status"></div><div class="processing-item-actions"><button class="text-button processing-delete">删除</button></div></div>`;
        row.querySelector(".processing-identifier").textContent = item.identifier || item.issueId || "任务 ID 未返回";
        const title = row.querySelector(".processing-title");
        title.textContent = item.title || item.sourceKey || item.bugId || "未命名任务";
        title.title = title.textContent;
        row.querySelector(".processing-meta").textContent = `${sourceName(item.captureSiteId || item.siteId)} · ${time}${item.workspaceAlias ? ` · ${item.workspaceAlias}` : ""}`;
        const status = row.querySelector(".processing-status");
        const saved = processingStates.get(item);
        const context = `${$("api").value}:${$("workspace").value}:${connectionCacheTag($("api").value, $("token").value)}`;
        if (saved?.context === context) setProcessingStatus(status, saved.result);
        else status.textContent = item.status ? `Multica 状态：${issueStatusLabel(item.status)}（提交时）` : "Multica 状态：待查询";
        processingRows.set(item, status);
        const url = submittedSourceUrl(item), detail = document.createElement(url ? "a" : "button");
        detail.className = "text-button processing-detail";
        detail.textContent = "去详情页>";
        if (url) {
          detail.href = url;
          detail.target = "_blank";
          detail.rel = "noopener noreferrer";
          detail.title = "打开关联的原始问题详情页";
        } else {
          detail.type = "button";
          detail.disabled = true;
          detail.title = "旧记录未保存来源链接，且无法从来源标识恢复";
        }
        row.querySelector(".processing-item-actions").prepend(detail);
        row.querySelector(".processing-delete").onclick = () => {
          forgetSubmitted(item);
          renderProcessing();
          renderBugs();
          message("已从本地处理列表删除；不会删除 Multica 中的任务。");
        };
        list.append(row);
      }
    }
    __name(renderProcessing, "renderProcessing");
    function setProcessingStatus(el, result) {
      el.dataset.kind = result.kind;
      if (result.kind === "ready") el.textContent = `Multica 状态：${issueStatusLabel(result.status)}`;
      else if (result.kind === "missing") el.textContent = "Multica 状态：未找到对应任务";
      else if (result.kind === "unavailable") el.textContent = "Multica 状态：请切换到提交时的服务和工作区";
      else el.textContent = `Multica 状态：查询失败（${String(result.error?.message || "请稍后重试").slice(0, 90)}）`;
    }
    __name(setProcessingStatus, "setProcessingStatus");
    async function refreshProcessingStatuses(force = false) {
      if (processingRefreshPromise) {
        await processingRefreshPromise;
        return refreshProcessingStatuses(force);
      }
      const visible = [...processingRows.keys()], site = processingSiteSelection;
      if (!visible.length) return;
      let c;
      try {
        c = settings();
      } catch (_) {
        processingRows.forEach((el) => {
          delete el.dataset.kind;
          el.textContent = "Multica 状态：请先完成 API 和工作区配置";
        });
        return;
      }
      const context = `${c.api}:${c.workspace}:${connectionCacheTag(c.api, c.token)}`;
      if (!force && processingRefreshContext === `${context}:${site}` && Date.now() - processingRefreshAt < 6e4) return;
      $("refresh-processing").disabled = true;
      processingRows.forEach((el) => {
        delete el.dataset.kind;
        el.textContent = "Multica 状态：查询中…";
      });
      processingRefreshPromise = loadSubmittedStatuses(visible, c, request(c), (item, result) => {
        processingStates.set(item, { context, result });
        const el = processingRows.get(item);
        if (el && el.isConnected && processingSiteSelection === site && `${$("api").value}:${$("workspace").value}:${connectionCacheTag($("api").value, $("token").value)}` === context)
          setProcessingStatus(el, result);
      }).finally(() => {
        processingRefreshAt = Date.now();
        processingRefreshContext = `${context}:${site}`;
        processingRefreshPromise = null;
        $("refresh-processing").disabled = !processingRows.size;
      });
      return processingRefreshPromise;
    }
    __name(refreshProcessingStatuses, "refreshProcessingStatuses");
    const mount = createMount({
      get siteMode() {
        return siteMode;
      },
      get SCRIPT_VERSION() {
        return SCRIPT_VERSION;
      },
      get debug() {
        return debug;
      },
      get bugs() {
        return bugs;
      },
      get capturedRecords() {
        return capturedRecords;
      },
      get umengState() {
        return umengState;
      },
      get currentId() {
        return currentId;
      },
      set currentId(value) {
        currentId = value;
      },
      get root() {
        return root;
      },
      set root(value) {
        root = value;
      },
      get activeDraft() {
        return activeDraft;
      },
      set activeDraft(value) {
        activeDraft = value;
      },
      get taskDraft() {
        return taskDraft;
      },
      set taskDraft(value) {
        taskDraft = value;
      },
      get selectedAttachments() {
        return selectedAttachments;
      },
      set selectedAttachments(value) {
        selectedAttachments = value;
      },
      get captureRecordChoice() {
        return captureRecordChoice;
      },
      set captureRecordChoice(value) {
        captureRecordChoice = value;
      },
      get pagePreviewContext() {
        return pagePreviewContext;
      },
      set pagePreviewContext(value) {
        pagePreviewContext = value;
      },
      get attachmentDraftKey() {
        return attachmentDraftKey;
      },
      set attachmentDraftKey(value) {
        attachmentDraftKey = value;
      },
      get umengStackMode() {
        return umengStackMode;
      },
      set umengStackMode(value) {
        umengStackMode = value;
      },
      get bugImageMode() {
        return bugImageMode;
      },
      set bugImageMode(value) {
        bugImageMode = value;
      },
      get removedAutoAttachments() {
        return removedAutoAttachments;
      },
      get hasGMStorage() {
        return storage.hasGMStorage;
      },
      get storageFailed() {
        return storage.failed;
      },
      get readValue() {
        return readValue;
      },
      get writeValue() {
        return writeValue;
      },
      get customProfiles() {
        return customProfiles;
      },
      set customProfiles(value) {
        customProfiles = value;
      },
      get activeProfile() {
        return activeProfile;
      },
      get builtinOverrides() {
        return builtinOverrides;
      },
      set builtinOverrides(value) {
        builtinOverrides = value;
      },
      get profileRegistry() {
        return profileRegistry;
      },
      get config() {
        return config;
      },
      set config(value) {
        config = value;
      },
      get processingSiteSelection() {
        return processingSiteSelection;
      },
      set processingSiteSelection(value) {
        processingSiteSelection = value;
      },
      get launchPosition() {
        return launchPosition;
      },
      set launchPosition(value) {
        launchPosition = value;
      },
      get connectionPhase() {
        return connectionPhase;
      },
      get setConnectionPhase() {
        return setConnectionPhase;
      },
      get setNativeAIVisibility() {
        return setNativeAIVisibility;
      },
      get watchNativeAI() {
        return watchNativeAI;
      },
      get $() {
        return $;
      },
      get syncPageLayout() {
        return syncPageLayout;
      },
      get openPanel() {
        return openPanel;
      },
      get closePanel() {
        return closePanel;
      },
      get applyPanelMode() {
        return applyPanelMode;
      },
      get collect() {
        return collect;
      },
      get captureHookFailed() {
        return captureHookFailed;
      },
      get syncEntryVisibility() {
        return syncEntryVisibility;
      },
      get renderPageCapturePreview() {
        return renderPageCapturePreview;
      },
      get syncCaptureUI() {
        return syncCaptureUI;
      },
      get refreshCaptureRuntime() {
        return refreshCaptureRuntime;
      },
      get message() {
        return message;
      },
      get persistConfig() {
        return persistConfig;
      },
      get persistConnectionSettings() {
        return persistConnectionSettings;
      },
      get prepareBugDoneImages() {
        return prepareBugDoneImages;
      },
      get renderCapturedRecords() {
        return renderCapturedRecords;
      },
      get captureSelection() {
        return captureSelection;
      },
      get closeAttachmentPreview() {
        return closeAttachmentPreview;
      },
      get renderCaptureAttachments() {
        return renderCaptureAttachments;
      },
      get renderSelectedAttachments() {
        return renderSelectedAttachments;
      },
      get preview() {
        return preview;
      },
      get run() {
        return run;
      },
      get renderAgentChoices() {
        return renderAgentChoices;
      },
      get fillSelect() {
        return fillSelect;
      },
      get configuredServers() {
        return configuredServers;
      },
      get renderServers() {
        return renderServers;
      },
      get applyCatalog() {
        return applyCatalog;
      },
      get applyTaskDefaultLabel() {
        return applyTaskDefaultLabel;
      },
      get loadWorkspaceData() {
        return loadWorkspaceData;
      },
      get connect() {
        return connect;
      },
      get connectIfNeeded() {
        return connectIfNeeded;
      },
      get submit() {
        return submit;
      },
      get switchTab() {
        return switchTab;
      },
      get renderProcessing() {
        return renderProcessing;
      },
      get refreshProcessingStatuses() {
        return refreshProcessingStatuses;
      }
    });
    function mountWithDiagnostics() {
      try {
        mount();
      } catch (e) {
        debug("界面挂载失败", { errorType: e.name }, "error");
      }
    }
    __name(mountWithDiagnostics, "mountWithDiagnostics");
    function scheduleDelayedMount() {
      if (uiScheduled) return;
      uiScheduled = true;
      debug("页面已就绪，安排延迟初始化", { delayMs: UI_DELAY_MS });
      setTimeout(/* @__PURE__ */ __name(function delayedFunction() {
        uiScheduled = false;
        if (!entryShouldShow(config.entryVisibility, activeProfile)) {
          debug("入口按显示范围隐藏", { mode: config.entryVisibility });
          return;
        }
        debug("延迟回调已执行", { bodyReady: !!document.body });
        if (!document.body) {
          uiScheduled = false;
          debug("页面主体尚不可用，等待后重试", {}, "warn");
          setTimeout(scheduleDelayedMount, 300);
          return;
        }
        if (!document.getElementById("bugdone-multica-bridge")) mountWithDiagnostics();
      }, "delayedFunction"), UI_DELAY_MS);
    }
    __name(scheduleDelayedMount, "scheduleDelayedMount");
    function openWorkbenchFromCommand(tab = "multica") {
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", () => openWorkbenchFromCommand(tab), { once: true });
        return;
      }
      if (!root) mountWithDiagnostics();
      if (!root || !$("panel")) return;
      openPanel();
      switchTab(tab, true);
      if (config.token && config.api) void run(connectIfNeeded);
    }
    __name(openWorkbenchFromCommand, "openWorkbenchFromCommand");
    window.addEventListener("keydown", (event) => {
      if (root || event.repeat || event.isComposing || !shortcutMatches(event, config.shortcut)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openWorkbenchFromCommand();
    }, true);
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("打开 Issues处理工作台", () => openWorkbenchFromCommand());
      GM_registerMenuCommand("设置入口显示范围", () => openWorkbenchFromCommand("settings"));
    }
    if (document.readyState !== "loading") scheduleDelayedMount();
    else {
      debug("等待 DOMContentLoaded，再延迟初始化");
      document.addEventListener("DOMContentLoaded", scheduleDelayedMount, { once: true });
    }
  }
  __name(startApp, "startApp");

  // src/index.js
  if (typeof window !== "undefined" && siteModeForUrl(window.location.href) !== "unsupported") startApp();
})();
