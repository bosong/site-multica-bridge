

export const BUGDONE_PROFILE = {
    schemaVersion: 2, id: 'bugdone', version: 2, enabled: true,
    metadata: { name: 'BugDone' }, adapter: 'bugdone', defaultLabel: { mode: 'inherit' },
    presentation: { recordLabel: '选择问题', hideSelectors: ['#openIntelligentTracking'], drawerSelectors: ['#asideProblem'] },
    links: { shareTemplate: 'https://www.bugdone.cn/cn/bugPreview/{{scopeId}}/{{recordId}}' },
    allowedOrigins: ['https://www.bugdone.cn', 'https://bugdone.cn'],
    pages: [{ kind: 'list', path: '/cn/bugManagement_*' },
      { kind: 'list', path: '/cn/bugManagement/:view/:projectId/:productId' },
      { kind: 'detail', path: '/cn/bugPreview/:projectId/:bugId' }],
    captures: [{ id: 'bug-api', method: 'POST', origin: 'https://www.bugdone.cn',
      path: '/Service/BugDone/BugAPI.ashx', maxResponseBytes: 4_000_000,
      success: { path: '$.Result', equals: 1 }, variants: [
        { kind: 'list', path: '$.ReturnObj.ItemList', type: 'array' },
        { kind: 'detail', path: '$.ReturnObj', type: 'object' }
      ] }],
    record: { scopeId: '$.ProjectId', recordId: '$.BugId', title: '$.BugTitle', number: '$.BugCode', descriptionHtml: '$.Description',
      fields: { projectName: '$.ProjectName', productName: '$.ProductName', moduleName: '$.ModuleName',
        priority: '$.StrPriority', state: '$.StrBugStatus', environment: '$.Environment' } },
    draft: { titleTemplate: '[BugDone] #{{number}} {{title}} [BugDone:{{recordId}}]',
      descriptionTemplate: '[BugDone:{{recordId}}]\n\n来源：{{sourceUrl}}\n只读分享：{{shareUrl}}\nBug ID：{{recordId}}\n编号：{{number}}\n项目：{{projectName}}\n产品：{{productName}}\n模块：{{moduleName}}\n优先级：{{priority}}\nBugDone 状态：{{state}}\n环境：{{environment}}\n\n任务要求：\n{{title}}\n\n详细描述：\n{{description}}\n\n截图与附件：\n{{attachmentLinks}}\n\n请分析问题并修复，在交付时说明根因、修改和验证结果；遇到信息不足时先在任务中说明。' },
    dedup: { keyTemplate: 'bugdone:{{scopeId}}:{{recordId}}' },
    attachments: [{ id: 'screenshots', kind: 'image-url', path: '$.BugAccessoryList',
      items: { url: '$.FullFileUrl', name: '$.FileName', extension: '$.ext', filter: { path: '$.ActiveFlg', notEquals: false } },
      filenameTemplate: 'bug-{{recordId}}.png', allowedOrigins: ['https://img.bugdone.cn'],
      transform: { preset: 'image', maxDimension: 2200, quality: 0.9 } }],
    postActions: [{ adapter: 'bugdone.start-processing', enabled: true }]
  };

export const UMENG_PROFILE = {
    schemaVersion: 2, id: 'umeng-apm-crash', version: 2, enabled: false,
    metadata: { name: '友盟 APM' }, adapter: 'umeng', defaultLabel: { mode: 'inherit' },
    presentation: { recordLabel: '选择崩溃记录', drawerPaddingSelectors: ['#root'] }, processors: { stack: { maxStacks: 2, maxLines: 40, maxChars: 4000 } },
    allowedOrigins: ['https://apm.umeng.com'],
    pages: [{ kind: 'list', path: '/platform/:appId/error_analysis/crash' },
      { kind: 'detail', path: '/platform/:appId/error_analysis/crash/detail/:errorId' }],
    captures: [
      { id: 'umeng-error-list', method: 'POST', origin: 'https://apm.umeng.com', path: '/hsf/analysis/errorList', maxResponseBytes: 4_000_000,
        requestKeys: ['dataSourceId'], success: { path: '$.code', equals: 200 }, variants: [{ kind: 'list', path: '$.data.list', type: 'array' }] },
      { id: 'umeng-error-detail', method: 'POST', origin: 'https://apm.umeng.com', path: '/hsf/analysis/errorDetail', maxResponseBytes: 4_000_000,
        requestKeys: ['dataSourceId', 'errorId'], success: { path: '$.code', equals: 200 }, variants: [{ kind: 'detail', path: '$.data', type: 'object' }] },
      { id: 'umeng-log-list', method: 'POST', origin: 'https://apm.umeng.com', path: '/hsf/analysis/errorlogList', maxResponseBytes: 4_000_000,
        requestKeys: ['dataSourceId', 'errorId'], success: { path: '$.code', equals: 200 }, variants: [{ kind: 'list', path: '$.data.list', type: 'array' }] },
      { id: 'umeng-log-detail', method: 'POST', origin: 'https://apm.umeng.com', path: '/hsf/analysis/errorlogDetail', maxResponseBytes: 4_000_000,
        requestKeys: ['dataSourceId', 'errorId', 'logId'], success: { path: '$.code', equals: 200 }, variants: [{ kind: 'detail', path: '$.data', type: 'object' }] },
      { id: 'umeng-error-stack', method: 'POST', origin: 'https://apm.umeng.com', path: '/hsf/analysis/errorStack', maxResponseBytes: 4_000_000,
        requestKeys: ['key'], success: { path: '$.code', equals: 200 }, variants: [{ kind: 'detail', path: '$.data', type: 'object' }] }
    ],
    record: { scopeId: '$.__scopeId', recordId: '$.id', title: '$.summary', number: '$.id' },
    draft: { titleTemplate: '[友盟崩溃] #{{recordId}} {{title}}' },
    dedup: { keyTemplate: 'umeng-apm-crash:{{scopeId}}:{{recordId}}' },
    attachments: [], postActions: []
  };

export const GITHUB_PROFILE = {
    schemaVersion: 2, id: 'github-issues', version: 2, enabled: true,
    metadata: { name: 'GitHub Issues' }, defaultLabel: { mode: 'inherit' }, presentation: { recordLabel: '选择 Issue' },
    identity: { scopeTemplate: '{{owner}}/{{repo}}', recordParam: 'number', recordFormat: 'positive-integer',
      sourceTemplate: 'https://github.com/{{owner}}/{{repo}}/issues/{{recordId}}' },
    allowedOrigins: ['https://github.com'],
    pages: [{ kind: 'list', path: '/:owner/:repo/issues' },
      { kind: 'detail', path: '/:owner/:repo/issues/:number' }],
    captures: [
      { id: 'github-issue-list', method: 'GET', origin: 'https://github.com', path: '/:owner/:repo/issues',
        maxResponseBytes: 4_000_000, requestOnPage: true,
        variants: [{ kind: 'list', path: '$.payload.issuesIndexContentRoute.results', type: 'array', itemPath: '$.issue' }] },
      { id: 'github-issue-detail', method: 'GET', origin: 'https://github.com', path: '/:owner/:repo/issues/:number',
        maxResponseBytes: 4_000_000, requestOnPage: true,
        variants: [{ kind: 'detail', path: '$.payload.issueViewerRoute.data.repository.issue', type: 'object' }] }
    ],
    record: { scopeId: ['$.repoNameWithOwner', '$.repository.nameWithOwner'], recordId: '$.number',
      title: '$.title', number: '$.number', descriptionText: '$.body', sourceUrl: ['$.permalink', '$.url'] },
    draft: { titleTemplate: '[GitHub Issues] #{{number}} {{title}}' },
    dedup: { keyTemplate: 'github-issues:{{scopeId}}:{{recordId}}' },
    attachments: [], postActions: []
  };

BUGDONE_PROFILE.captures.push({ ...BUGDONE_PROFILE.captures[0], id: 'bug-api-alias', origin: 'https://bugdone.cn' });

export const BUILTIN_PROFILES = [BUGDONE_PROFILE, UMENG_PROFILE, GITHUB_PROFILE];

export const PROFILE_TEMPLATE = {
    schemaVersion: 2, metadata: { name: '示例问题站点' }, defaultLabel: { mode: 'inherit' }, id: 'example-issues', version: 1, enabled: false,
    allowedOrigins: ['https://issues.example.test'],
    pages: [{ kind: 'list', path: '/issues' }, { kind: 'detail', path: '/issues/:id' }],
    captures: [{ id: 'issues', method: 'POST', origin: 'https://issues.example.test',
      path: '/api/issues', maxResponseBytes: 1_000_000,
      success: { path: '$.ok', equals: true }, variants: [
        { kind: 'list', path: '$.data.items', type: 'array' },
        { kind: 'detail', path: '$.data.issue', type: 'object' }
      ] }],
    record: { scopeId: '$.projectId', recordId: '$.id', title: '$.title', number: '$.number', descriptionHtml: '$.description' },
    draft: { titleTemplate: '[Example] #{{number}} {{title}}' },
    dedup: { keyTemplate: 'example-issues:{{scopeId}}:{{recordId}}' },
    attachments: [{ id: 'stack', kind: 'text', path: '$.stack',
      filenameTemplate: 'issue-{{recordId}}-stack.txt', maxChars: 200_000 },
    { id: 'screen', kind: 'image-url', path: '$.screenshot',
      filenameTemplate: 'issue-{{recordId}}.png' }], postActions: []
  };

export const PAGE_TEXT_TEMPLATE = {
    schemaVersion: 2, id: 'example-text-page', version: 1, enabled: false, captureMode: 'text',
    metadata: { name: '文本捕获示例' }, allowedOrigins: ['https://docs.example.test'],
    pages: [{ kind: 'manual', path: '/**' }],
    draft: { titleTemplate: '{{pageTitle}}', descriptionTemplate: '来源：{{pageUrl}}\n\n选取内容：\n{{selectedText}}' }
  };

export const PAGE_BLANK_TEMPLATE = { ...PAGE_TEXT_TEMPLATE, id: 'example-blank-page', captureMode: 'blank',
    metadata: { name: '空白填写示例' }, draft: { titleTemplate: '', descriptionTemplate: '' } };
