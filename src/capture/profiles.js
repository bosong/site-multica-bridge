import { UUID, PROFILE_PATH } from '../config/constants.js';
import { PAGE_TEXT_TEMPLATE, PAGE_BLANK_TEMPLATE } from '../sites/builtins.js';
import { validateConnection } from '../multica/config.js';
import { locationOf } from './matching.js';

export function profileValue(data, path) {
    if (Array.isArray(path)) {
      for (const option of path) { const value = profileValue(data, option); if (value !== undefined && value !== null && value !== '') return value; }
      return undefined;
    }
    if (typeof path !== 'string' || !PROFILE_PATH.test(path)) return undefined;
    return path === '$' ? data : path.slice(2).split('.').reduce((value, key) =>
      value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, data);
  }

export function validRoutePattern(path) {
    return typeof path==='string' && path.startsWith('/') && path.length<=500 && !path.includes('//') &&
      path.split('/').slice(1).every(part=>!part || /^:[A-Za-z][A-Za-z0-9]*$/.test(part) || /^[A-Za-z0-9_.*-]+$/.test(part));
  }

export function validateSiteProfile(profile) {
    if (profile && typeof profile === 'object' && !Array.isArray(profile))
      profile = {...profile,attachments:profile.attachments ?? [],postActions:profile.postActions ?? []};
    const fields = (value, allowed, context) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${context} 必须是对象`);
      for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`不支持的配置字段：${context}.${key}`);
    };
    fields(profile, ['schemaVersion', 'id', 'version', 'enabled', 'allowedOrigins', 'pages', 'captures', 'record', 'draft', 'dedup', 'attachments', 'postActions', 'metadata', 'priority', 'adapter', 'identity', 'links', 'presentation', 'defaultLabel', 'processors', 'captureMode'], 'profile');
    if (![1, 2].includes(profile.schemaVersion) || !/^[a-z][a-z0-9-]{1,63}$/.test(profile.id || '') || !Number.isInteger(profile.version) || profile.version < 1 || typeof profile.enabled !== 'boolean') throw Error('站点配置版本或标识无效');
    if (!Array.isArray(profile.allowedOrigins) || !profile.allowedOrigins.length || profile.allowedOrigins.length > 8) throw Error('允许的站点不能为空');
    for (const origin of profile.allowedOrigins) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw Error('允许的站点必须是 HTTPS 根地址');
    }
    const mode = profile.captureMode ?? 'api';
    if (!['api','text','blank'].includes(mode)) throw Error('捕获方式无效');
    if (!Array.isArray(profile.pages) || !profile.pages.length || profile.pages.length > 20) throw Error('页面规则不能为空或超过 20 条');
    for (const page of profile.pages) {
      fields(page, ['kind', 'path'], 'pages');
      if (!(mode === 'api' ? ['list','detail'] : ['manual','list','detail']).includes(page.kind) || !validRoutePattern(page.path)) throw Error('页面路径规则无效');
    }
    if (mode !== 'api') {
      if (profile.captures !== undefined && (!Array.isArray(profile.captures) || profile.captures.length) ||
          !Array.isArray(profile.attachments) || profile.attachments.length || !Array.isArray(profile.postActions) || profile.postActions.length ||
          ['adapter','identity','record','dedup','links','processors'].some(key => profile[key] !== undefined))
        throw Error('文本或空白配置不能包含接口、业务身份、自动附件或源站动作');
      const defaults = mode === 'text' ? PAGE_TEXT_TEMPLATE.draft : PAGE_BLANK_TEMPLATE.draft;
      profile = {...profile,captures:[],draft:{...defaults,...profile.draft}};
      fields(profile.draft,['titleTemplate','descriptionTemplate'],'draft');
      for (const value of Object.values(profile.draft)) {
        if (typeof value !== 'string' || value.length > 10000 ||
            [...value.matchAll(/{{([^}]*)}}/g)].some(m=>!['pageTitle','pageUrl','selectedText'].includes(m[1])) ||
            /[{}]/.test(value.replace(/{{(?:pageTitle|pageUrl|selectedText)}}/g,''))) throw Error('文本模板字段或格式无效');
      }
      validateProfileExtensions(profile,fields);
      return profile;
    }
    if (!Array.isArray(profile.captures) || !profile.captures.length || profile.captures.length > 20) throw Error('网络捕获规则不能为空或超过 20 条');
    for (const rule of profile.captures) {
      fields(rule, ['id', 'method', 'origin', 'path', 'maxResponseBytes', 'requestKeys', 'success', 'variants', 'requestOnPage'], 'captures');
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(rule.id || '') || !['GET', 'POST'].includes(rule.method) || !profile.allowedOrigins.includes(rule.origin) || !validRoutePattern(rule.path) || !Number.isInteger(rule.maxResponseBytes) || rule.maxResponseBytes < 1 || rule.maxResponseBytes > 4_000_000) throw Error('捕获规则超出允许的站点或范围');
      if (rule.requestOnPage !== undefined && (typeof rule.requestOnPage !== 'boolean' || rule.requestOnPage &&
        (rule.method !== 'GET' || !profile.pages.some(page => page.path === rule.path)))) throw Error('主动请求仅支持已声明页面的 GET 接口');
      if (rule.requestKeys && (!Array.isArray(rule.requestKeys) || rule.requestKeys.length > 8 || rule.requestKeys.some(key => !/^[A-Za-z][A-Za-z\d_]*$/.test(key)))) throw Error('请求身份字段无效');
      if (rule.success) {
        fields(rule.success, ['path', 'equals'], 'success');
        if (!PROFILE_PATH.test(rule.success.path || '') || !['string', 'number', 'boolean'].includes(typeof rule.success.equals)) throw Error('成功条件无效');
      }
      if (!Array.isArray(rule.variants) || !rule.variants.length) throw Error('响应变体不能为空');
      for (const variant of rule.variants) {
        fields(variant, ['kind', 'path', 'type', 'itemPath'], 'variants');
        if (!['list', 'detail'].includes(variant.kind) || !PROFILE_PATH.test(variant.path || '') || !['array', 'object'].includes(variant.type) ||
            (variant.itemPath && !PROFILE_PATH.test(variant.itemPath))) throw Error('响应变体无效');
      }
    }
    fields(profile.record, ['scopeId', 'recordId', 'title', 'number', 'descriptionHtml', 'descriptionText', 'sourceUrl', 'fields'], 'record');
    const validPaths = value => typeof value === 'string' ? PROFILE_PATH.test(value) :
      Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every(path => typeof path === 'string' && PROFILE_PATH.test(path));
    for (const key of ['scopeId', 'recordId', 'title']) if (!validPaths(profile.record[key])) throw Error(`字段路径无效：${key}`);
    for (const key of ['number', 'descriptionHtml', 'descriptionText', 'sourceUrl']) if (profile.record[key] && !validPaths(profile.record[key])) throw Error(`字段路径无效：${key}`);
    if (profile.record.fields) {
      const extra = profile.record.fields;
      if (typeof extra !== 'object' || Array.isArray(extra) || Object.keys(extra).length > 20 ||
          Object.entries(extra).some(([name, path]) => !/^[a-z][A-Za-z0-9]{0,39}$/.test(name) ||
            ['siteId','scopeId','recordId','number','title','description','sourceUrl','shareUrl','attachmentLinks','constructor','prototype'].includes(name) || !validPaths(path)))
        throw Error('扩展字段名称或路径无效，最多 20 个且不能覆盖来源身份');
    }
    fields(profile.draft, ['titleTemplate', 'descriptionTemplate'], 'draft');
    fields(profile.dedup, ['keyTemplate'], 'dedup');
    if (typeof profile.draft.titleTemplate !== 'string' || typeof profile.dedup.keyTemplate !== 'string' ||
        profile.draft.titleTemplate.length > 500 || profile.dedup.keyTemplate.length > 500 ||
        !Array.isArray(profile.attachments) || !Array.isArray(profile.postActions)) throw Error('任务草稿或附件配置无效');
    const allowedTemplateKeys = new Set(['siteId', 'scopeId', 'recordId', 'number', 'title']);
    for (const template of [profile.draft.titleTemplate, profile.dedup.keyTemplate]) {
      for (const placeholder of template.matchAll(/{{([^}]*)}}/g))
        if (!allowedTemplateKeys.has(placeholder[1])) throw Error(`不支持的模板字段：${placeholder[1]}`);
    }
    if (!profile.dedup.keyTemplate.includes('{{scopeId}}') || !profile.dedup.keyTemplate.includes('{{recordId}}'))
      throw Error('来源键必须包含 scopeId 和 recordId');
    if (profile.attachments.length > 8 || profile.postActions.length > 2) throw Error('附件规则最多 8 条，动作最多 2 条');
    for (const [name, rules, key] of [['captures',profile.captures,'id'],['attachments',profile.attachments,'id'],['postActions',profile.postActions,'adapter']]) {
      if (new Set(rules.map(rule=>rule?.[key])).size !== rules.length) throw Error(`${name} 中的规则标识重复`);
    }
    validateProfileExtensions(profile, fields);
    for (const rule of profile.attachments) {
      fields(rule, ['id', 'kind', 'path', 'filenameTemplate', 'maxChars', 'items', 'allowedOrigins', 'transform'], 'attachments');
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(rule.id || '') || !['text', 'image-url'].includes(rule.kind) ||
          !PROFILE_PATH.test(rule.path || '') || typeof rule.filenameTemplate !== 'string' ||
          !rule.filenameTemplate || rule.filenameTemplate.length > 180 || /[\\/\r\n]/.test(rule.filenameTemplate) ||
          (rule.kind === 'text' ? !Number.isInteger(rule.maxChars) || rule.maxChars < 1 || rule.maxChars > 200_000
            : rule.maxChars !== undefined) ||
          [...rule.filenameTemplate.matchAll(/{{([^}]*)}}/g)].some(match => !allowedTemplateKeys.has(match[1])) ||
          /[{}]/.test(rule.filenameTemplate.replace(/{{[A-Za-z][A-Za-z\d]*}}/g, '')))
        throw Error(`附件规则无效：${rule.id || '未命名'}`);
    }
    return profile;
  }

export function validateProfileExtensions(profile, fields) {
    const origins = list => {
      if (!Array.isArray(list) || !list.length || list.length > 8 || list.some(value => {
        const u = locationOf(value); return !u || u.protocol !== 'https:' || u.origin !== value || u.username || u.password;
      })) throw Error('下载域必须是 HTTPS 根地址，最多 8 个');
    };
    const template = (value, keys) => {
      if (typeof value !== 'string' || value.length > 10000 || [...value.matchAll(/{{([^}]*)}}/g)].some(m => !keys.includes(m[1]))) throw Error('模板字段或长度无效');
    };
    if (profile.metadata) { fields(profile.metadata, ['name'], 'metadata'); if (profile.metadata.name != null &&
      (typeof profile.metadata.name !== 'string' || profile.metadata.name.length > 80)) throw Error('站点名称无效'); }
    if (profile.priority !== undefined && (!Number.isInteger(profile.priority) || Math.abs(profile.priority) > 100)) throw Error('站点优先级须为 -100 至 100');
    if (profile.adapter && !['bugdone', 'umeng'].includes(profile.adapter)) throw Error('未知的可信捕获适配器');
    if (profile.adapter === 'bugdone' && (profile.id !== 'bugdone' || profile.allowedOrigins.some(x => !['https://bugdone.cn','https://www.bugdone.cn'].includes(x)))) throw Error('BugDone 适配器仅用于 BugDone');
    if (profile.adapter === 'umeng' && (profile.id !== 'umeng-apm-crash' || profile.allowedOrigins.some(x => x !== 'https://apm.umeng.com'))) throw Error('友盟适配器仅用于友盟');
    if (profile.adapter === 'bugdone') {
      const title = profile.draft.titleTemplate.trim(), mark = '[BugDone:{{recordId}}]';
      if (!title.startsWith(mark + ' ') && !title.endsWith(' ' + mark))
        throw Error('BugDone 标题必须在开头或末尾保留兼容查重标记 [BugDone:{{recordId}}]，并用空格分隔');
    }
    if (profile.defaultLabel) {
      const x = profile.defaultLabel; fields(x, ['mode','id','api','workspace'], 'defaultLabel');
      if (!['inherit','none','fixed'].includes(x.mode)) throw Error('标签模式无效');
      if (x.mode === 'fixed' && (!UUID.test(x.id || '') || !UUID.test(x.workspace || '') || !locationOf(x.api) || validateConnection({api:x.api,token:'validation'}).api !== x.api)) throw Error('指定标签必须绑定 API、工作区 UUID 和标签 UUID');
    }
    if (profile.identity) {
      fields(profile.identity, ['scopeTemplate','recordParam','recordFormat','sourceTemplate'], 'identity');
      const params = [...new Set(profile.pages.flatMap(page => [...page.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map(m => m[1])))];
      for (const key of ['scopeTemplate','sourceTemplate']) if (profile.identity[key]) template(profile.identity[key], [...params,'scopeId','recordId']);
      if (profile.identity.recordParam && !params.includes(profile.identity.recordParam)) throw Error('身份字段必须来自页面参数');
      if (profile.identity.recordFormat && !['positive-integer','hex32'].includes(profile.identity.recordFormat)) throw Error('身份格式无效');
    }
    if (profile.links) { fields(profile.links, ['shareTemplate'], 'links'); if (profile.links.shareTemplate != null)
      template(profile.links.shareTemplate, ['siteId','scopeId','recordId','number']); }
    if ((!profile.captureMode || profile.captureMode === 'api') && profile.draft.descriptionTemplate !== undefined) template(profile.draft.descriptionTemplate, ['siteId','scopeId','recordId','number','title','description','sourceUrl','shareUrl','attachmentLinks', ...Object.keys(profile.record.fields || {})]);
    if (profile.presentation) {
      fields(profile.presentation, ['recordLabel','hideSelectors','drawerSelectors','drawerPaddingSelectors'], 'presentation');
      if (profile.presentation.recordLabel && (typeof profile.presentation.recordLabel !== 'string' || profile.presentation.recordLabel.length > 80)) throw Error('记录名称无效');
      for (const key of ['hideSelectors','drawerSelectors','drawerPaddingSelectors']) if (profile.presentation[key] && (!Array.isArray(profile.presentation[key]) || profile.presentation[key].length > 8 || profile.presentation[key].some(x => typeof x !== 'string' || !/^[#.][A-Za-z][A-Za-z0-9_-]{0,80}$/.test(x)))) throw Error('布局选择器只接受简单 ID 或 class');
    }
    if (profile.processors) {
      fields(profile.processors, ['stack'], 'processors');
      if (profile.processors.stack) {
        const x=profile.processors.stack; fields(x, ['maxStacks','maxLines','maxChars'], 'processors.stack');
        for (const [key,max] of [['maxStacks',10],['maxLines',200],['maxChars',20000]]) if (!Number.isInteger(x[key]) || x[key]<1 || x[key]>max) throw Error('堆栈精简参数无效');
      }
    }
    for (const x of profile.attachments) {
      if (x.allowedOrigins) origins(x.allowedOrigins);
      if (x.items) {
        fields(x.items,['url','name','filter','extension'],'attachments.items');
        if (x.kind !== 'image-url' || !PROFILE_PATH.test(x.items.url || '') || x.items.name && !PROFILE_PATH.test(x.items.name)) throw Error('数组附件字段无效');
        if(x.items.extension && !PROFILE_PATH.test(x.items.extension)) throw Error('附件扩展名路径无效');
        if (x.items.filter) { fields(x.items.filter,['path','notEquals'],'attachments.items.filter'); if (!PROFILE_PATH.test(x.items.filter.path || '') || !['boolean','number','string'].includes(typeof x.items.filter.notEquals)) throw Error('附件过滤器无效'); }
      }
      if (x.transform) {
        fields(x.transform,['preset','maxDimension','quality'],'attachments.transform');
        if (x.kind !== 'image-url' || x.transform.preset !== 'image' || !Number.isInteger(x.transform.maxDimension) || x.transform.maxDimension<100 || x.transform.maxDimension>4096 || typeof x.transform.quality !== 'number' || x.transform.quality<0.3 || x.transform.quality>1) throw Error('压缩参数无效');
      }
    }
    for (const x of profile.postActions) {
      fields(x, ['adapter','enabled'], 'postActions');
      if (x.adapter !== 'bugdone.start-processing' || profile.adapter !== 'bugdone' || typeof x.enabled !== 'boolean') throw Error('不支持的源站回写动作');
    }
  }

export function resolveProfileLabel(profile, config) {
    const label = profile?.defaultLabel;
    if (!label || label.mode === 'inherit') return {value:config.label || '',warning:''};
    if (label.mode === 'none') return {value:'',warning:''};
    if (label.api !== config.api || label.workspace !== config.workspace) return {value:'',warning:'站点默认标签绑定了其他服务或工作区，请重新选择标签'};
    return {value:label.id,warning:''};
  }

export async function runProfilePostActions(profile, context, adapters) {
    if (!profile?.enabled || context.existing || context.siteId !== profile.id || !profile.allowedOrigins.includes(locationOf(context.sourceUrl)?.origin)) return [];
    const results=[];
    for (const action of profile.postActions || []) if (action.enabled && typeof adapters[action.adapter] === 'function') {
      try { results.push(await adapters[action.adapter](context)); }
      catch(error) { results.push({kind:'error',message:error.message}); }
    }
    return results;
  }

export function assertProfileIdentityUnchanged(previous, profile) {
    if (!previous) return;
    const oldAPI = (previous.captureMode || 'api') === 'api', newAPI = (profile.captureMode || 'api') === 'api';
    if (oldAPI !== newAPI || previous.adapter !== profile.adapter || oldAPI &&
        (JSON.stringify(profile.record?.scopeId)!==JSON.stringify(previous.record?.scopeId) ||
         JSON.stringify(profile.record?.recordId)!==JSON.stringify(previous.record?.recordId) || profile.dedup?.keyTemplate!==previous.dedup?.keyTemplate))
      throw Error('已有配置的来源身份、捕获类别、适配器和查重键不可更改；请新建配置以避免重复任务');
  }

export function profileObservationChanges(previous, next) {
    const added = (oldItems, newItems, identity, label) => {
      const known = new Set((oldItems || []).map(identity));
      return (newItems || []).filter(item => !known.has(identity(item))).map(label);
    };
    const changes = [
      ...added(previous?.allowedOrigins, next.allowedOrigins, value => value, value => `站点 ${value}`),
      ...added(previous?.pages, next.pages, value => `${value.kind} ${value.path}`,
        value => `页面 ${value.kind} ${value.path}`),
      ...added(previous?.captures, next.captures, value => `${value.method} ${value.origin}${value.path}`,
        value => `接口 ${value.method} ${value.origin}${value.path}`)
    ];
    if (previous && !changes.length && JSON.stringify({ captures: previous.captures, record: previous.record,
      draft: previous.draft, dedup: previous.dedup, attachments: previous.attachments }) !==
      JSON.stringify({ captures: next.captures, record: next.record, draft: next.draft,
        dedup: next.dedup, attachments: next.attachments })) changes.push('接口响应上限或字段规则已改变');
    return changes;
  }
