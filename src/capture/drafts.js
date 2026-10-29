import { PAGE_TEXT_TEMPLATE, PAGE_BLANK_TEMPLATE } from '../sites/builtins.js';
import { safeURL } from '../sites/bugdone.js';
import { matchProfilePage, locationOf } from './matching.js';
import { captureHtmlText } from '../shared/html.js';

export function renderCaptureTemplate(template, values, optionalFields = []) {
    return template.replace(/{{([A-Za-z][A-Za-z\d]*)}}/g, (_, field) => {
      const value = values[field];
      if (value === undefined || value === null || value === '') {
        if (optionalFields.includes(field)) return '';
        throw Error(`生成任务草稿缺少字段 ${field}`);
      }
      return String(value);
    });
  }

export function sourceMarker(sourceKey) { return `[Source:${sourceKey}]`; }

export function profileShareUrl(profile, values) {
    if (!profile.links?.shareTemplate) return '';
    try {
      const link = locationOf(renderCaptureTemplate(profile.links.shareTemplate, {...values,
        scopeId: values.scopeId ? encodeURIComponent(values.scopeId) : '',
        recordId: values.recordId ? encodeURIComponent(values.recordId) : ''}));
      return link?.protocol === 'https:' && profile.allowedOrigins.includes(link.origin) ? link.href : '';
    } catch { return ''; } // 分享链接可缺失，不能阻止信息预览或入口初始化。
  }

export function buildCapturedDraft(record, profile) {
    const values = { siteId: record.siteId, scopeId: record.scopeId, recordId: record.recordId,
      number: record.number, title: record.title };
    const titleTemplate = values.number === undefined || values.number === null || values.number === ''
      ? profile.draft.titleTemplate.replace(/#\s*{{number}}\s*/g, '') : profile.draft.titleTemplate;
    const title = renderCaptureTemplate(titleTemplate, values, ['number']);
    const sourceKey = renderCaptureTemplate(profile.dedup.keyTemplate, {
      ...values, scopeId: encodeURIComponent(record.scopeId), recordId: encodeURIComponent(record.recordId)
    });
    const source = locationOf(record.sourceUrl);
    const sourceUrl = source && profile.allowedOrigins.includes(source.origin) && source.protocol === 'https:' ? source.href : '';
    const blocks = (record.descriptionBlocks || []).filter(block => typeof block?.text === 'string' && block.text.trim())
      .map(block => `${block.heading || '内容'}：\n${block.text.trim()}`);
    const detailText = record.descriptionText || captureHtmlText(record.descriptionHtml);
    const shareUrl = profileShareUrl(profile, values);
    const attachmentLinks = (record.attachments || []).filter(item => safeURL(item.url)).map(item =>
      `${item.remoteImage || item.image ? '!' : ''}[${String(item.name).replace(/[\[\]\\\r\n]/g, '_')}](${item.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`).join('\n');
    const customDescription=profile.draft.descriptionTemplate?.replace(/{{([A-Za-z][A-Za-z\d]*)}}/g,(_,key)=>String(({...record.fields,...values,description:detailText,sourceUrl,shareUrl,attachmentLinks})[key] ?? ''));
    const description = [sourceMarker(sourceKey), customDescription ?? (sourceUrl ? `来源：${sourceUrl}` : ''), !customDescription && shareUrl ? `只读分享：${shareUrl}` : '', !customDescription && detailText ? `详细描述：\n${detailText}` : '', ...blocks,
      ...(record.attachmentWarnings || []).map(warning => `附件未包含：${warning}`)].filter(Boolean).join('\n\n');
    return { sourceKey, siteId: record.siteId, scopeId: record.scopeId, recordId: record.recordId,
      sourceUrl, title, description, detail:record.detail === true, attachments: [...(record.attachments || [])] };
  }

export function manualFingerprint(url, text) {
    let hash = 2166136261;
    for (const char of `${url}\n${text}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

export function buildManualDraft({ title, text, url }) {
    const source = locationOf(url);
    if (source?.protocol !== 'https:' || !source.hostname) throw Error('手动捕获仅支持 HTTPS 网页');
    const selected = String(text || '').trim();
    if (!selected) throw Error('请先在网页选中要提交的可见内容');
    if (selected.length > 200_000) throw Error('选中内容过长，请缩小范围后重试');
    return { siteId: 'manual', scopeId: source.origin, recordId: '', sourceKey: '',
      fingerprint: manualFingerprint(source.href, selected),
      sourceUrl: source.href, title: String(title || selected.split('\n')[0]).trim().slice(0, 180),
      description: `来源：${source.href}\n\n选取内容：\n${selected}`, attachments: [] };
  }

export function buildPageCaptureDraft(profile, {title, url, text = ''}) {
    if (!['text','blank'].includes(profile?.captureMode) || !matchProfilePage(profile,url)) throw Error('当前页面不匹配文本或空白站点配置');
    const selected = String(text).trim();
    if (selected.length > 200000) throw Error('选中内容过长，请缩小范围后重试');
    const values = {pageTitle:String(title || ''),pageUrl:new URL(url).href,selectedText:selected};
    const defaults = profile.captureMode === 'text' ? PAGE_TEXT_TEMPLATE.draft : PAGE_BLANK_TEMPLATE.draft;
    const render = template => template.replace(/{{(pageTitle|pageUrl|selectedText)}}/g,(_,key)=>values[key]);
    const draftTitle = render(profile.draft?.titleTemplate ?? defaults.titleTemplate).slice(0,180);
    const description = render(profile.draft?.descriptionTemplate ?? defaults.descriptionTemplate);
    if (description.length > 200000) throw Error('模板生成内容过长，请缩小选区或模板');
    return {siteId:'manual',scopeId:new URL(url).origin,recordId:'',sourceKey:'',sourceUrl:values.pageUrl,
      title:draftTitle,description,fingerprint:manualFingerprint(values.pageUrl,selected || description),attachments:[],draftId:crypto.randomUUID(),captureProfile:structuredClone(profile)};
  }

export function manualDraftContext(draft, profile, url) {
    if (draft?.siteId === 'manual' && draft.captureProfile && draft.sourceUrl)
      return {url:draft.sourceUrl,profile:draft.captureProfile};
    return {url,profile:profile?.captureMode && profile.captureMode!=='api' ? profile : null};
  }

export function buildTypedManualDraft({title, description, url, previous, sourceDraft}) {
    if (!String(title || '').trim()) throw Error('请填写任务标题');
    if (!String(description || '').trim()) throw Error('请填写任务描述');
    const draft = buildManualDraft({title,text:description,url});
    const unchanged = item => item?.siteId === 'manual' && item.sourceUrl === draft.sourceUrl &&
      item.title === title && item.description === description;
    const fingerprint = [sourceDraft, previous].find(item => unchanged(item) && item.fingerprint)?.fingerprint || draft.fingerprint;
    return {...draft,title,description,fingerprint,draftId:unchanged(previous) ? previous.draftId : crypto.randomUUID()};
  }

export function selectedVisibleText(selection, panelRoot) {
    if (!selection?.rangeCount || selection.isCollapsed) throw Error('请先在网页选中要提交的可见内容');
    if (panelRoot?.contains(selection.anchorNode) || panelRoot?.contains(selection.focusNode))
      throw Error('请在原网页选取内容，不要选中工作台文字');
    const excluded = 'input,textarea,select,script,style,iframe,object,[hidden],[aria-hidden="true"]';
    for (const node of [selection.anchorNode, selection.focusNode]) {
      if (node?.parentElement?.closest(excluded)) throw Error('选取范围包含表单或隐藏内容，请重新选取');
    }
    if (selection.getRangeAt(0).cloneContents().querySelector(excluded))
      throw Error('选取范围包含表单或隐藏内容，请重新选取');
    return selection.toString().trim();
  }

export function capturePreviewUpdate(currentKey, nextKey, titleGenerated, descriptionGenerated) {
    const changedRecord = currentKey !== nextKey;
    return { title: changedRecord || titleGenerated, description: changedRecord || descriptionGenerated };
  }

export function needsCapturedDetail(draft) { return draft?.siteId !== 'manual'; }

export function snapshotTaskDraft(draft, profile=null, bug=null) {
    return {...structuredClone(draft),profile:profile ? structuredClone(profile) : null,
      legacyBug:bug ? structuredClone(bug) : null};
  }

export function chooseCapturedRecord(records, {selected, preferred, manual}) {
    return [manual, preferred, selected].find(key=>records.has(key)) || records.keys().next().value || '';
  }
