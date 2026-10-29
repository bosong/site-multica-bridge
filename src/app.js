import {createPageLayout, resolveDrawerPresentation} from './ui/page-layout.js';
import { siteModeForUrl } from './capture/matching.js';
import { UI_DELAY_MS, DEFAULT_SHORTCUT } from './config/constants.js';
import { BUGDONE_PROFILE, UMENG_PROFILE, BUILTIN_PROFILES, PROFILE_TEMPLATE, PAGE_TEXT_TEMPLATE, PAGE_BLANK_TEMPLATE } from './sites/builtins.js';
import { entryShouldShow, selectSiteProfile, profileIdentityMatches, matchSiteCapture, pathMatches, matchProfilePage, locationOf, extractProfileItems, testProfileSample } from './capture/matching.js';
import { bugTaskTitle, parseResponse, safeURL, mergeBug, startBugDoneProcessing } from './sites/bugdone.js';
import { validateConfig, validateConnection, validateStoredConfig, agentCacheKey, agentChoices, listItems, connectionCacheTag, needsCatalogRefresh, connectionBadge, verifyConnection } from './multica/config.js';
import { buildIssueBody, issueLabelState, cacheKey, issueStatusLabel, loadSubmittedStatuses, submitTaskOnce } from './multica/tasks.js';
import { validateSiteProfile, resolveProfileLabel, runProfilePostActions, assertProfileIdentityUnchanged, profileObservationChanges } from './capture/profiles.js';
import { normalizeCapturedRecord, recordKey, collectStandardRecords } from './capture/records.js';
import { profileShareUrl, buildCapturedDraft, buildManualDraft, buildPageCaptureDraft, manualDraftContext, buildTypedManualDraft, selectedVisibleText, capturePreviewUpdate, needsCapturedDetail, snapshotTaskDraft, chooseCapturedRecord } from './capture/drafts.js';
import { submittedSourceUrl, processingSiteView, draftSourceDetailUrl } from './history/sites.js';
import { buildUmengDraft, createUmengCaptureState, umengRoute, applyUmengCapture } from './sites/umeng.js';
import { fitLaunchPosition } from './ui/geometry.js';
import { installRouteHooks, installCaptureHooks } from './platform/hooks.js';
import { shortcutFromEvent, shortcutMatches, capturePreferences, nextDraftAttachments, restorePreferenceDefaults, normalizeShortcutConfig } from './config/preferences.js';
import { createMount } from './ui/mount.js';
import { createStorage } from './platform/storage.js';
import { createNetwork } from './multica/network.js';
import { createAttachments } from './attachments/service.js';
import { captureBootstrap,routeBootstrap } from './platform/page-injection.js';
import { SCRIPT_VERSION } from './config/version.js';

export function startApp() {
  let siteMode=siteModeForUrl(window.location.href);
  // 调试桩：仅打印阶段、数量和 HTTP 状态，不打印令牌、请求头或 Bug 正文。
  const DEBUG = true;
  
  function debug(stage, data = {}, level = 'info') {
    if (DEBUG) console[level](`[网页→Multica] ${stage}`, data);
  }
  debug('脚本已启动', {
    version: SCRIPT_VERSION, path: location.pathname, readyState: document.readyState,
    unsafeWindow: typeof unsafeWindow !== 'undefined',
    GM_xmlhttpRequest: typeof GM_xmlhttpRequest === 'function',
    FastlaneNativeNetwork: typeof window.FastlaneNativeNetwork?.request === 'function',
    fetch: typeof fetch === 'function',
    abortController: typeof AbortController === 'function',
    webLocks: !!navigator.locks
  });

  const bugs = new Map(), capturedRecords = new Map(), umengState = createUmengCaptureState();
  let currentId = '', root, busy = false, previewFingerprint = '', previewRecordId = '', activeDraft = null, taskDraft = null;
  let selectedAttachments = [];
  let captureRecordChoice = null;
  let uiScheduled = false, pagePreviewContext = '';
  let attachmentDraftKey = '';
  let umengStackMode = 'summary', bugImageMode = 'compressed', captureModeRecordKey='';
  const removedAutoAttachments = new Set();
const storage=createStorage({debug,GM_getValue:typeof GM_getValue==='function'?GM_getValue:undefined,GM_setValue:typeof GM_setValue==='function'?GM_setValue:undefined});
  const {readValue,writeValue}=storage;
  let customProfiles = [];
  try {
    const saved = readValue('siteProfiles', []);
    if (Array.isArray(saved)) customProfiles = saved.slice(0, 20).flatMap(value => {
      try { return [validateSiteProfile(value)]; } catch { return []; }
    });
  } catch (_) { /* 无效旧配置不应阻止启动 */ }
  let activeProfile = null;
  let builtinOverrides = readValue('builtinProfileOverrides', {}) || {};
  function profileRegistry() {
    return [...BUILTIN_PROFILES.map(base=>{
      const fallback={...base, enabled:base.adapter === 'umeng' ? config.umengCaptureEnabled !== false : base.enabled};
      try { return builtinOverrides[base.id] ? validateSiteProfile(builtinOverrides[base.id]) : fallback; } catch { return fallback; }
    }), ...customProfiles];
  }
  function sourceName(id) { return id === 'manual' ? '手动捕获' : profileRegistry().find(p=>p.id===id)?.metadata?.name || id || 'BugDone'; }
  let config = { api: 'https://api.multica.ai', workspace: '', workspaceAlias: '', token: '', agent: '', defaultAgent: '', project: '', projectAlias: '', label: '' };
  config.hideNativeAI = true;
  config.umengCaptureEnabled = true;
  config.displayMode = 'floating';
  config.entryVisibility = 'configured';
  config.shortcut = DEFAULT_SHORTCUT;
  config.shortcutCustomized = false;
  let submittedBugs = [];
  const processingStates = new WeakMap(), processingRows = new Map();
  let processingRefreshPromise = null, processingRefreshAt = 0, processingRefreshContext = '';
  let processingSiteSelection='', processingPageKey='';
  let launchPosition = readValue('launchPosition', null);
  const savedConfig = readValue('config', null);
  config = normalizeShortcutConfig({ ...config, ...(savedConfig || {}) });
  config={...config,...capturePreferences(config)};
  bugImageMode=config.defaultImageMode;umengStackMode=config.defaultLogMode;
  config.projectCustomized = savedConfig?.projectCustomized ?? !!(savedConfig && Object.hasOwn(savedConfig,'project'));
  config.defaultAgentCustomized = savedConfig?.defaultAgentCustomized ?? !!(savedConfig && Object.hasOwn(savedConfig,'defaultAgent'));
  if (siteMode === 'umeng' && config.umengCaptureEnabled === false) siteMode = 'manual';
  if (!['floating', 'sidebar'].includes(config.displayMode)) config.displayMode = 'floating';
  if (!/^(?=.*(?:Ctrl|Alt|Meta))(?:Ctrl\+)?(?:Alt\+)?(?:Meta\+)?(?:Shift\+)?[A-Z0-9]$/.test(config.shortcut || '')) config.shortcut = DEFAULT_SHORTCUT;
  if (!['configured','all','shortcut'].includes(config.entryVisibility)) config.entryVisibility = 'configured';
  let connectionPhase = 'idle';
  function setConnectionPhase(phase, expectedTag) {
    if (expectedTag && root && expectedTag !== connectionCacheTag($('api').value, $('token').value)) return;
    connectionPhase = phase;
    if (!root) return;
    const launch = $('launch');
    if (!launch) return;
    const badge = connectionBadge({ api: $('api').value, token: $('token').value }, phase);
    launch.querySelector('.launch-text').textContent = `Multica-AI · ${badge.text}`;
    launch.querySelector('.status-dot').style.backgroundColor = badge.color;
    launch.title = `${badge.text} · 脚本 v${SCRIPT_VERSION}；点击查看详情`;
  }
  const savedBugs = readValue('submittedBugs', []);
  submittedBugs = Array.isArray(savedBugs) ? savedBugs.slice(0, 100) : [];
  function submittedFor(id) { return submittedBugs.find(x => x && x.bugId === id); }
  function rememberSubmittedDraft(draft, issue, c) {
    const identity = draft.sourceKey || `manual:${draft.draftId}`;
    const item = { siteId: draft.siteId, sourceKey: identity, fingerprint: draft.fingerprint || '',
      captureSiteId:draft.profile?.id || draft.captureProfile?.id || (draft.siteId!=='manual' ? draft.siteId : ''),
      captureSiteName:draft.profile?.metadata?.name || draft.captureProfile?.metadata?.name || '',
      ...(draft.legacyBug ? {bugId:draft.legacyBug.BugId,bugCode:draft.legacyBug.BugCode} : {}),
      title: draft.title, issueId: issue.id, sourceUrl:draft.sourceUrl || '', detailUrl:draftSourceDetailUrl(draft),
      identifier: issue.identifier || '', issueTitle: issue.title || '', submittedAt: new Date().toISOString(),
      api: c.api, status: issue.status || '', workspace: c.workspace, workspaceAlias: c.workspaceAlias || '',
      project: c.project || '', projectAlias: c.projectAlias || '' };
    submittedBugs = [item, ...submittedBugs.filter(x => x.workspace !== c.workspace || x.sourceKey !== identity && (!draft.legacyBug || x.bugId !== draft.legacyBug.BugId))].slice(0, 100);
    processingRefreshAt = 0;
    try { writeValue('submittedBugs', submittedBugs); }
    catch (error) { debug('通用处理列表保存失败', { errorType: error.name }, 'warn'); }
    return item;
  }
  function forgetSubmitted(item) {
    const identity=item.sourceKey || item.bugId;
    submittedBugs = submittedBugs.filter(x => x !== item && !(identity && (x.sourceKey || x.bugId) === identity && x.workspace === item.workspace && (x.api || '') === (item.api || '')));
    try { writeValue('submittedBugs', submittedBugs); } catch (e) { debug('已处理列表删除失败', { errorType: e.name }, 'warn'); }
  }
  const hiddenSiteElements=new Map();
  function setNativeAIVisibility(hidden) {
    for(const [el,display] of hiddenSiteElements) el.style.display=display;
    hiddenSiteElements.clear();
    if(!hidden) return;
    for(const selector of activeProfile?.presentation?.hideSelectors || []) document.querySelectorAll(selector).forEach(el=>{
      hiddenSiteElements.set(el,el.style.display);el.style.display='none';
    });
  }
  function updateSiteLayoutStyle() {
    pageLayout.updateStyle();
    if(root) syncPageLayout($('launch').getAttribute('aria-expanded') === 'true');
  }

  function watchNativeAI() {
    setNativeAIVisibility(config.hideNativeAI !== false);
    if (!document.body) return;
    const observer = new MutationObserver(() => setNativeAIVisibility(config.hideNativeAI !== false));
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }
  const $ = id => root.getElementById(id);
  let panelCloseTimer = 0;
  const pageLayout = createPageLayout({document, window, getPresentation:()=>resolveDrawerPresentation(activeProfile, BUILTIN_PROFILES)});
  function syncPageLayout(open) { pageLayout.sync(open, config.displayMode); }
  function openPanel() {
    const panel = $('panel');
    clearTimeout(panelCloseTimer);
    panel.hidden = false;
    $('launch').setAttribute('aria-expanded', 'true');
    syncPageLayout(true);
    if (config.displayMode === 'sidebar') {
      panel.dataset.open = 'false';
      panel.getBoundingClientRect();
      panel.dataset.open = 'true';
    }
    if(!$('view-processing').hidden) {renderProcessing();void refreshProcessingStatuses();}
  }
  function closePanel() {
    closeAttachmentPreview();
    if ($('reset-preferences-dialog')?.open) $('reset-preferences-dialog').close();
    const panel = $('panel');
    $('launch').setAttribute('aria-expanded', 'false');
    syncPageLayout(false);
    if (config.displayMode === 'sidebar' && !panel.hidden) {
      panel.dataset.open = 'false';
      panelCloseTimer = setTimeout(() => { if (panel.dataset.open !== 'true') panel.hidden = true; }, pageLayout.duration() + 20);
    } else panel.hidden = true;
  }
  function applyPanelMode(mode) {
    config.displayMode = mode === 'sidebar' ? 'sidebar' : 'floating';
    $('panel').dataset.display = config.displayMode;
    $('mode-sidebar').setAttribute('aria-pressed', String(config.displayMode === 'sidebar'));
    $('mode-floating').setAttribute('aria-pressed', String(config.displayMode === 'floating'));
    $('panel').dataset.open = String(!$('panel').hidden);
    syncPageLayout(!$('panel').hidden);
  }
  function collect(data) {
    try {
      const items = parseResponse(data, activeProfile?.adapter === 'bugdone' ? activeProfile : BUGDONE_PROFILE, {sourceUrl:location.href});
      const profile=activeProfile?.adapter === 'bugdone' ? activeProfile : BUGDONE_PROFILE;
      collectStandardRecords(profile, extractProfileItems(profile.captures[0], data), capturedRecords, location.href);
      debug('响应解析完成', { bugs: items.length, details: items.filter(b => b.detail).length });
      for (const b of items) {
        b.sourceUrl = location.href;
        if(b.captureRecord) b.captureRecord.sourceUrl=location.href;
        bugs.set(b.BugId, mergeBug(bugs.get(b.BugId), b));
        if (b.detail && (!root || $('bug').dataset.manual !== 'true')) currentId = b.BugId;
      }
      if (items.length && root) renderBugs();
    } catch (e) {
      debug('响应解析跳过', { errorType: e.name }, 'warn');
    }
  }
  function collectUmeng(response, meta) {
    try {
      const record = applyUmengCapture(umengState, response, meta, activeProfile || UMENG_PROFILE);
      if (record && root) renderCapturedRecords();
      if (record) debug('友盟记录已更新', { kind: meta.ruleId, detail: record.detail, logs: record.logs.length });
    } catch (error) { debug('友盟响应解析跳过', { errorType: error.name }, 'warn'); }
  }
  function collectCustom(response, meta) {
    try {
      const rule = activeProfile?.captures.find(item => item.id === meta.ruleId);
      if (!rule || !matchProfilePage(activeProfile, meta.sourceUrl)) return;
      const count = collectStandardRecords(activeProfile, extractProfileItems(rule, response), capturedRecords, meta.sourceUrl);
      if (count && root) renderCapturedRecords();
      if (count) debug('配置站点记录已更新', { profile: activeProfile.id, records: count });
    } catch (error) { debug('配置站点响应解析跳过', { errorType: error.name }, 'warn'); }
  }
  // One lifecycle owns both JS worlds. Reconfiguration invalidates in-flight responses.
  let captureEpoch=0, captureStops=[], captureHookFailed=false, observedCaptureContext='', observedProfileSignature='';
  function injectCaptureScript(code) {
    const node=document.createElement('script'); node.textContent=code;
    (document.head || document.documentElement).appendChild(node); node.remove();
  }
  function installConfiguredPageBridge(profile, receive, epoch) {
    let cancelled=false, timer=0;
    const channel=`multica-${epoch}-${Math.random().toString(36).slice(2)}`;
    const listener=event=>{
      const data=event.data;
      if (cancelled || event.source !== window || event.origin !== location.origin || data?.channel !== channel || typeof data.text !== 'string') return;
      const rule=profile.captures.find(x=>x.id===data.meta?.ruleId);
      if (!rule || new TextEncoder().encode(data.text).byteLength>rule.maxResponseBytes) return;
      receive(data.text,data.meta);
    };
    window.addEventListener('message',listener);
    const start=()=>{
      if(cancelled) return;
      if(!document.documentElement) {timer=setTimeout(start,30);return;}
      try {
        injectCaptureScript(captureBootstrap(profile,channel));
      } catch(error) {debug('页面世界监听安装失败',{errorType:error.name},'warn');}
    };
    start();
    return ()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('message',listener);
      if(document.documentElement) try{injectCaptureScript('window.__multicaCaptureStop?.(); window.__multicaCaptureStop=null;');}catch{}};
  }
  function syncEntryVisibility() {
    if (!root) return;
    $('launch').hidden = !entryShouldShow(config.entryVisibility,activeProfile);
  }
  function renderPageCapturePreview() {
    if(config.captureEnabled===false) return;
    const context = JSON.stringify([location.href,activeProfile]);
    if (pagePreviewContext === context) return;
    pagePreviewContext = context;
    if (['capture-title','capture-description'].some(id=>$(id).dataset.generated==='false' && $(id).value)) return;
    activeDraft = buildPageCaptureDraft(activeProfile,{title:document.title,url:location.href});
    for (const [id,value] of [['capture-title',activeDraft.title],['capture-description',activeDraft.description]]) {
      $(id).value=value;$(id).dataset.generated='true';
    }
    $('capture-state').textContent=activeProfile.captureMode==='blank'?'空白填写':'文本模板';
    renderCaptureAttachments();
  }
  function syncCaptureUI() {
    if(!root) { if(document.body && entryShouldShow(config.entryVisibility,activeProfile)) scheduleDelayedMount(); return; }
    syncEntryVisibility();
    $('capture-paused').hidden=config.captureEnabled!==false;
    $('bugdone-capture').hidden=siteMode!=='bugdone';
    $('generic-capture').hidden=siteMode==='bugdone';
    $('umeng-selector').hidden=!['umeng','custom'].includes(siteMode);
    $('umeng-stack-options').hidden=siteMode!=='umeng';
    $('reset-page-capture').hidden=!activeProfile?.captureMode || activeProfile.captureMode==='api';
    $('manual-selector').hidden=siteMode!=='manual' || activeProfile?.captureMode==='blank';
    $('capture-heading').textContent=activeProfile ? `${sourceName(activeProfile.id)} 捕获` : '网页内容选取';
    $('capture-help').textContent=activeProfile?.captureMode==='text' ? '按文本模板组合页面标题、地址和主动选取的文字；不监听接口。' : activeProfile?.captureMode==='blank' ? '此站点使用空白填写；补充标题和内容后即可进入下一步。' : activeProfile ? '按站点配置读取列表和详情；核对内容与附件后创建任务。' : '选取网页可见文字后创建通用 AI 任务。';
    const label=$('umeng-selector').querySelector('label');if(label) label.textContent=activeProfile?.presentation?.recordLabel || '选择记录';
    root.querySelector('.brand small').textContent='Issues处理工作台';
    root.querySelectorAll('.brand-icon, #launch img').forEach(image=>{image.hidden=siteMode!=='bugdone';});
    if(siteMode==='bugdone') renderBugs(); else if(siteMode==='manual' && activeProfile) renderPageCapturePreview(); else if(activeProfile) renderCapturedRecords();
    setNativeAIVisibility(config.hideNativeAI !== false);
    updateSiteLayoutStyle();
  }
  function refreshCaptureRuntime(force=false) {
    const profile=selectSiteProfile(profileRegistry(),location.href);
    const context=JSON.stringify([location.href,profile,config.captureEnabled]);
    if(!force && context===observedCaptureContext) return;
    observedCaptureContext=context; const epoch=++captureEpoch;
    captureStops.splice(0).reverse().forEach(stop=>stop());
    const signature=JSON.stringify(profile);
    if(signature!==observedProfileSignature) {
      capturedRecords.clear();bugs.clear();for(const value of Object.values(umengState)) value.clear();
      if(activeDraft?.siteId!=='manual') activeDraft=null;previewFingerprint='';previewRecordId='';currentId='';captureRecordChoice=null;observedProfileSignature=signature;
    }
    activeProfile=profile;siteMode=profile?.captureMode && profile.captureMode!=='api' ? 'manual' : profile?.adapter || (profile?'custom':'manual');
    syncCaptureUI();
    if(root) {renderProcessing();if(!$('panel').hidden && !$('view-processing').hidden) void refreshProcessingStatuses();}
    if(config.captureEnabled===false || !profile || profile.captureMode && profile.captureMode!=='api') return;
    const sourceUrl=location.href;
    const receive=(text,meta)=>{
      if(config.captureEnabled===false || epoch!==captureEpoch || location.href!==sourceUrl || meta?.sourceUrl!==sourceUrl || !matchProfilePage(profile,meta.sourceUrl)) return;
      if(profile.adapter==='bugdone') collect(text);
      else if(profile.adapter==='umeng') collectUmeng(text,meta);
      else collectCustom(text,meta);
    };
    // Active-page GET rules use one explicit fetch; passive rules observe source requests.
    const passive={...profile,captures:profile.captures.filter(rule=>!rule.requestOnPage)};
    if(passive.captures.length) {
      try {
        captureStops.push(installConfiguredPageBridge(passive,receive,epoch));
        const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
        const hooks=installCaptureHooks(page,receive,(url,method)=>matchSiteCapture(passive,{url,method}));
        captureStops.push(hooks.stop);
      } catch(error) {captureHookFailed=true;debug('接口监听安装失败',{errorType:error.name},'warn');}
    }
    const rule=profile.captures.find(rule=>rule.requestOnPage && rule.origin===location.origin && pathMatches(rule.path,location.pathname));
    if(!rule) return;
    const controller=new AbortController();captureStops.push(()=>controller.abort());
    void (async()=>{
      try {
        const response=await window.fetch(sourceUrl,{method:'GET',credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});
        const text=await response.text();
        if(epoch!==captureEpoch || location.href!==sourceUrl) return;
        if(!response.ok || !matchSiteCapture(profile,{url:sourceUrl,method:'GET',bytes:new TextEncoder().encode(text).byteLength,contentType:response.headers.get('content-type') || 'text/html'})) throw Error('接口返回非 JSON、错误状态或超出大小限制');
        if (matchProfilePage(profile, sourceUrl)?.kind === 'detail' && !extractProfileItems(rule, text).some(({item, kind}) =>
          profileIdentityMatches(profile, item, sourceUrl) && normalizeCapturedRecord(profile, item, {kind, sourceUrl})))
          throw Error('详情响应缺少有效记录，可能是接口结构已变化');
        receive(text,{ruleId:rule.id,sourceUrl,request:{}});
      } catch(error) {if(epoch===captureEpoch && error.name!=='AbortError') {debug('页面接口捕获失败',{errorType:error.name},'warn');if(root) message(`接口捕获失败：${error.message}`,'warning');}}
    })();
  }
  // SPA redirects can request their list immediately after changing history. Observe
  // synchronously in both worlds so capture is installed before that first request.
  const routeChannel = `multica-route-${Math.random().toString(36).slice(2)}`;
  window.addEventListener(routeChannel, () => refreshCaptureRuntime());
  try { installRouteHooks(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window, () => refreshCaptureRuntime()); }
  catch (error) { debug('路由监听安装失败', { errorType:error.name }, 'warn'); }
  const installPageRoutes = () => {
    if (!document.documentElement) { setTimeout(installPageRoutes, 30); return; }
    try { injectCaptureScript(routeBootstrap(routeChannel)); }
    catch (error) { debug('页面路由监听安装失败', { errorType:error.name }, 'warn'); }
  };
  installPageRoutes();
  refreshCaptureRuntime();
  setInterval(()=>refreshCaptureRuntime(),800);
  function message(text, kind = 'info') { const el = $('message'); el.textContent = text; el.className = `status-${kind}`; }
  function settings(requireConnection = true) {
    const values = { ...capturePreferences(config), api: $('api').value.trim(), workspace: $('workspace').value, workspaceAlias: $('workspace').selectedOptions[0]?.textContent || '', token: $('token').value, project: $('default-project').value, projectAlias: $('default-project').selectedOptions[0]?.textContent || '', agent: $('agent').value, defaultAgent: $('default-agent').value, label: $('default-label').value, hideNativeAI: $('hide-native-ai').checked, umengCaptureEnabled: config.umengCaptureEnabled, displayMode: config.displayMode, entryVisibility:config.entryVisibility, shortcut: config.shortcut, shortcutCustomized: config.shortcutCustomized, projectCustomized:config.projectCustomized, defaultAgentCustomized:config.defaultAgentCustomized };
    return requireConnection ? validateConfig(values) : validateStoredConfig(values);
  }
  function persistConfig(next = config) {
    try {
      writeValue('config',next);
      if (root && $('settings-save-state')) {
        const mode=typeof storage.mode==='string' ? storage.mode : '', limited=/会话|内存/.test(mode);
        $('settings-save-state').textContent=mode.includes('内存')?'仅保存在当前页面':mode.includes('会话')?'已保存到当前会话':'已保存';
        $('settings-save-state').dataset.kind=limited?'warning':'success';
      }
    } catch (error) {
      if (root && $('settings-save-state')) { $('settings-save-state').textContent='保存失败，请重试';$('settings-save-state').dataset.kind='error'; }
      throw error;
    }
  }
  function persistConnectionSettings() {
    const api=$('api').value==='__add__' ? config.api : $('api').value, changed=config.api!==api;
    const next=validateStoredConfig({...config,api,token:$('token').value,
      ...(changed ? {workspace:'',workspaceAlias:'',project:'',projectAlias:'',defaultAgent:'',agent:'',label:'',projectCustomized:false,defaultAgentCustomized:false} : {})});
    persistConfig(next);
    if(changed || config.token!==next.token) setConnectionPhase('idle');
    config=next;
  }
  const network=createNetwork({debug,setConnectionPhase,GM_xmlhttpRequest:typeof GM_xmlhttpRequest==='function'?GM_xmlhttpRequest:undefined});
  const {bugDoneForm,request,gmCall}=network;
  
  
  const attachments=createAttachments({message,gmCall,GM_xmlhttpRequest:typeof GM_xmlhttpRequest==='function'?GM_xmlhttpRequest:undefined});
  const {loadBugDoneImageBlob,compressBugDoneImage,prepareBugDoneImages,uploadImage,uploadLocalAttachment,prepareSelectedAttachments}=attachments;
  
  
  
  
  
  
  function configuredShareUrl(b,profile) {
    return profileShareUrl(profile, {scopeId:b.ProjectId,recordId:b.BugId,siteId:profile.id,number:b.BugCode});
  }
  function description(b) {
    const profile=activeProfile?.adapter==='bugdone'?activeProfile:BUGDONE_PROFILE;
    const record=b.captureRecord || normalizeCapturedRecord(profile,b,{kind:b.detail?'detail':'list',sourceUrl:b.sourceUrl});
    return record ? buildCapturedDraft({...record,sourceUrl:b.sourceUrl,attachments:b.attachments},profile).description : '';
  }
  function renderBugs() {
    const select = $('bug');
    const selected = currentId || select.value;
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = '不关联问题 · 手动填写'; select.append(empty);
    for (const b of bugs.values()) {
      const o = document.createElement('option'); o.value = b.BugId;
      o.textContent = `#${b.BugCode} ${b.detail ? '✓详情' : '列表'} ${submittedFor(b.BugId) ? '· 已提交 Multica-AI 处理 ·' : ''}${b.BugTitle}`; select.append(o);
    }
    if (select.dataset.manual === 'true') select.value = '';
    else if (bugs.has(selected)) select.value = selected;
    else if (bugs.size) select.value = bugs.keys().next().value;
    currentId = select.value;
    $('count').textContent = bugs.size ? `已捕获 ${bugs.size} 个 Bug · ${[...bugs.values()].filter(b => b.detail).length} 个详情` : '等待捕获 · 请打开一个 Bug 的详情';
    const b = bugs.get(currentId);
    if (b && JSON.stringify(b) !== previewFingerprint) {
      preview();
    }
  }
  function renderCapturedRecords() {
    if (!root || !['umeng', 'custom'].includes(siteMode)) return;
    const select = $('capture-record');
    const selected = select.value;
    const records = siteMode === 'umeng' ? umengState.records : capturedRecords;
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = '不关联问题 · 手动填写'; select.append(empty);
    for (const [key, record] of records) {
      const option = document.createElement('option'); option.value = key;
      option.textContent = `#${record.number || record.recordId} ${record.detail ? '✓详情' : '列表'} ${record.title}`;
      select.append(option);
    }
    const route = siteMode === 'umeng' ? umengRoute(location.href) : null;
    const preferred = route?.errorId && [...records].find(([, item]) => item.scopeId === route.appId && item.recordId === route.errorId)?.[0]
      || [...records].find(([,item])=>item.sourceUrl && locationOf(item.sourceUrl)?.pathname===location.pathname && item.detail)?.[0];
    const manualChoice = captureRecordChoice?.url === location.href && captureRecordChoice.key === '';
    select.value = manualChoice ? '' : chooseCapturedRecord(records, {selected, preferred,
      manual:captureRecordChoice?.url === location.href ? captureRecordChoice.key : ''});
    const record = records.get(select.value);
    $('capture-state').textContent = record ? (record.detail ? '详情已捕获' : '仅列表摘要') : manualChoice ? '手动填写' : '等待接口响应';
    if (!record || activeDraft?.siteId === 'manual') { renderCaptureAttachments(); return; }
    applyRecordCaptureDefaults(recordKey(record));
    const draft = siteMode === 'umeng' ? buildUmengDraft(record, umengStackMode, activeProfile || UMENG_PROFILE) : buildCapturedDraft(record, activeProfile);
    const update = capturePreviewUpdate(activeDraft?.sourceKey, draft.sourceKey,
      $('capture-title').dataset.generated === 'true', $('capture-description').dataset.generated === 'true');
    activeDraft = draft;
    if (update.title) {
      $('capture-title').value = draft.title;
      $('capture-title').dataset.generated = 'true';
    }
    if (update.description) {
      $('capture-description').value = draft.description;
      $('capture-description').dataset.generated = 'true';
    }
    const coverage = record.logCoverage;
    $('capture-coverage').textContent = siteMode === 'umeng'
      ? `${record.detail ? '已捕获详情' : '请打开崩溃详情'} · 行为日志 ${record.logs.filter(x => x.kind === 'behavior').length} 条 · 堆栈 ${record.logs.filter(x => x.kind === 'stack').length} 份${coverage ? ` · 明细列表 ${coverage.captured}/${coverage.total}，已加载详情 ${record.logDetailCoverage?.captured || 0}/${coverage.total}（点击其他明细以继续捕获）` : ' · 尚未捕获错误明细列表'}`
      : `${record.detail ? '已捕获详情' : '仅捕获列表摘要，请进入详情页面'} · ${activeProfile.id} · 文本附件 ${(record.attachments || []).length} 份${record.attachmentWarnings?.length ? ` · ${record.attachmentWarnings.join('；')}` : ''}`;
    renderCaptureAttachments();
  }
  function captureSelection() {
    const selection = selectedVisibleText(window.getSelection(), root);
    const draft = activeProfile?.captureMode==='text' ? buildPageCaptureDraft(activeProfile,{title:document.title,text:selection,url:location.href}) : buildManualDraft({ title: document.title, text: selection, url: location.href });
    activeDraft = { ...draft, draftId: crypto.randomUUID() };
    $('capture-title').value = draft.title;
    $('capture-description').value = draft.description;
    $('capture-title').dataset.generated='false';$('capture-description').dataset.generated='false';
    $('capture-state').textContent = '已选取';
    renderCaptureAttachments();
    const possible = submittedBugs.find(item => item.fingerprint === draft.fingerprint &&
      item.api === config.api && item.workspace === config.workspace);
    message(possible ? `可能重复：本地处理列表已有相同网页和选取内容（${possible.identifier || possible.issueId}）。请核对后再创建。`
      : '已捕获所选文字；请核对并进入 AI 任务创建。', possible ? 'warning' : 'success');
  }
  async function readRemotePreviewText(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('文本预览只接受 HTTPS 地址');
    let body;
    if (typeof window.FastlaneNativeNetwork?.request === 'function') {
      const response = await window.FastlaneNativeNetwork.request({ method: 'GET', url: url.href,
        responseType: 'text', timeoutMs: 30000 });
      if (response.status < 200 || response.status >= 300) throw Error(`HTTP ${response.status}`);
      body = response.body;
    } else if (typeof GM_xmlhttpRequest === 'function') {
      const response = await gmCall({ method: 'GET', url: url.href, responseType: 'text' });
      if (response.status < 200 || response.status >= 300) throw Error(`HTTP ${response.status}`);
      body = response.responseText;
    } else {
      const response = await fetch(url.href, { credentials: 'omit', mode: 'cors' });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > 1_000_000) throw Error('文件过大');
      body = await response.text();
    }
    if (typeof body !== 'string' || body.length > 1_000_000) throw Error('文件过大或不是文本');
    return body;
  }
  function attachmentPreviewDescriptor(item) {
    const name = String(item?.name || '附件');
    const file = item?.file instanceof Blob ? item.file : null;
    const url = safeURL(item?.url);
    const image = !!(item?.image || item?.remoteImage || file?.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(name));
    const text = typeof item?.content === 'string' || !!file?.type.startsWith('text/') || /\.(?:txt|log|json|csv|md)$/i.test(name);
    if (file) return { kind: image ? 'image-file' : text ? 'text-file' : 'unavailable', name, file };
    if (typeof item?.content === 'string') return { kind: 'text-content', name, content: item.content };
    if (url) return { kind: image ? 'image-url' : text ? 'text-url' : 'link', name, url };
    return { kind: 'unavailable', name };
  }
  let attachmentPreviewUrl = '', attachmentPreviewRequest = 0;
  function closeAttachmentPreview() {
    attachmentPreviewRequest++;
    $('attachment-preview').hidden = true;
    $('attachment-preview-image').removeAttribute('src');
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = '';
  }
  async function openAttachmentPreview(item) {
    closeAttachmentPreview();
    const requestId = attachmentPreviewRequest;
    const descriptor = attachmentPreviewDescriptor(item);
    const view = $('attachment-preview');
    const image = $('attachment-preview-image');
    const text = $('attachment-preview-text');
    const link = $('attachment-preview-link');
    $('attachment-preview-title').textContent = descriptor.name;
    image.hidden = true; text.hidden = true;
    link.hidden = !descriptor.url;
    if (descriptor.url) link.href = descriptor.url;
    else link.removeAttribute('href');
    view.hidden = false;
    $('attachment-preview-close').focus();
    if (descriptor.kind === 'image-url' || descriptor.kind === 'image-file') {
      if (descriptor.kind === 'image-file') attachmentPreviewUrl = URL.createObjectURL(descriptor.file);
      image.src = descriptor.url || attachmentPreviewUrl;
      image.hidden = false;
      image.onerror = () => {
        if (requestId !== attachmentPreviewRequest) return;
        image.hidden = true; text.textContent = '图片无法加载，可尝试打开原始附件。'; text.hidden = false;
      };
      return;
    }
    text.hidden = false;
    if (descriptor.kind === 'text-content') {
      text.textContent = descriptor.content.slice(0, 200_000) + (descriptor.content.length > 200_000 ? '\n\n（预览仅显示前 200,000 字符）' : '');
      return;
    }
    if (descriptor.kind === 'text-file' || descriptor.kind === 'text-url') {
      text.textContent = '正在读取文本…';
      try {
        const content = descriptor.file ? await descriptor.file.slice(0, 200_000).text() : await readRemotePreviewText(descriptor.url);
        const length = descriptor.file?.size || content.length;
        if (requestId === attachmentPreviewRequest) text.textContent = content.slice(0, 200_000) + (length > 200_000 ? '\n\n（预览仅显示前 200 KB）' : '');
      } catch (_) {
        if (requestId === attachmentPreviewRequest) text.textContent = '无法在面板内读取此文本附件。可尝试打开原始附件。';
      }
      return;
    }
    text.textContent = descriptor.kind === 'link' ? '此文件格式暂不支持面板内预览，可打开原始附件。' : '此附件无法预览。';
  }
  function renderAttachmentItems(list, items, removable = false, onAdd = null) {
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'attachment-item';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'attachment-open';
      open.textContent = item.name; open.setAttribute('aria-label', `查看 ${item.name}`);
      open.onclick = () => { void openAttachmentPreview(item); };
      row.append(open);
      if(onAdd) {const add=document.createElement('button');add.type='button';add.textContent='添加';add.setAttribute('aria-label',`添加 ${item.name}`);add.onclick=()=>onAdd(item);row.append(add);}
      if(removable && item.remoteImage && item.transform) {
        const toggle=document.createElement('button');toggle.type='button';toggle.textContent=item.original?'原图 · 切换压缩':'压缩 · 切换原图';
        toggle.onclick=()=>{item.original=!item.original;renderSelectedAttachments();};row.append(toggle);
      }
      if (removable) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
        remove.setAttribute('aria-label', `移除 ${item.name}`);
        remove.onclick = () => {
          if (item.generated) removedAutoAttachments.add(`${item.attachmentScope}:${item.attachmentKey || item.name}`);
          selectedAttachments = selectedAttachments.filter(value => value !== item); renderSelectedAttachments();
        };
        row.append(remove);
      }
      list.append(row);
    }
  }
  function renderCaptureAttachments() {
    if (!root) return;
    const items = siteMode === 'bugdone' ? bugs.get($('bug').value)?.attachments || [] : activeDraft?.attachments || [];
    const list = $(siteMode === 'bugdone' ? 'bug-attachments' : 'capture-attachments');
    renderAttachmentItems(list, items);
    list.parentElement.hidden = !items.length;
  }
  function renderSelectedAttachments() {
    if (!root) return;
    renderAttachmentItems($('selected-attachments'), selectedAttachments, true);
    const key=item=>`${item.url || ''}|${item.attachmentKey || item.name || ''}`;
    const available=(taskDraft?.attachments || []).filter(item=>!selectedAttachments.some(selected=>(selected.generated || selected.fromCapture) && key(selected)===key(item)));
    $('source-attachments').hidden=!available.length;
    renderAttachmentItems($('available-source-attachments'),available,false,item=>{
      selectedAttachments.push({...structuredClone(item),fromCapture:true,generated:false,attachmentKey:item.name,
        original:(taskDraft.captureDefaults || capturePreferences(config)).defaultImageMode==='original'});
      renderSelectedAttachments();message('已添加来源附件，提交任务时上传。','success');
    });
  }
  function applyRecordCaptureDefaults(key) {
    if(captureModeRecordKey===key) return;
    captureModeRecordKey=key;bugImageMode=config.defaultImageMode;umengStackMode=config.defaultLogMode;
    if(!root) return;
    for(const [id,selected] of [['bug-image-compressed',bugImageMode==='compressed'],['bug-image-original',bugImageMode==='original'],
      ['umeng-stack-summary',umengStackMode==='summary'],['umeng-stack-full',umengStackMode==='full']]) $(id).setAttribute('aria-pressed',String(selected));
  }
  function preview(force = false) {
    const b = bugs.get($('bug').value);
    if (!b) return;
    currentId = b.BugId;applyRecordCaptureDefaults(`bugdone:${b.BugId}`);
    previewFingerprint = JSON.stringify(b);
    const update = capturePreviewUpdate(force ? '' : previewRecordId, b.BugId,
      $('title').dataset.generated !== 'false', $('description').dataset.generated !== 'false');
    previewRecordId = b.BugId;
    if (update.title) { $('title').value = b.captureRecord ? buildCapturedDraft(b.captureRecord, activeProfile || BUGDONE_PROFILE).title : bugTaskTitle(b); $('title').dataset.generated = 'true'; }
    if (update.description) { $('description').value = description(b); $('description').dataset.generated = 'true'; }
    $('share-url').value = configuredShareUrl(b,activeProfile || BUGDONE_PROFILE);
    renderCaptureAttachments();
    $('bug-state').textContent = b.detail ? '详情已就绪' : '等待详情';
    const expected = Number(b.PicCount) + Number(b.AttachmentCount);
    $('warning').textContent = !b.detail ? '仅捕获列表：请先打开此 Bug 的详情，待出现“✓详情”后提交。' :
      b.attachments.length < expected ? `原始记录有 ${expected} 个附件，目前仅捕获 ${b.attachments.length} 个；请核对附件是否完整。` :
      '已捕获详情。提交时会先上传截图到 Multica，再创建并指派任务。';
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button[data-action]').forEach(x => x.disabled = true);
    try { await action(); } catch (e) { message(e.message || String(e), 'error'); }
    finally { busy = false; root.querySelectorAll('button[data-action]').forEach(x => x.disabled = false); }
  }
  function renderAgentChoices(c, list) {
    const choices = agentChoices(c, list);
    for (const [id, label, selected] of [
      ['agent', '先读取智能体', choices.selectedAgent],
      ['default-agent', '未设置默认智能体', choices.selectedDefault]
    ]) {
      const select = $(id);
      select.replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = label; select.append(empty);
      for (const agent of choices.agents) {
        const option = document.createElement('option'); option.value = agent.id; option.textContent = agent.name; select.append(option);
      }
      select.value = selected;
    }
    return choices.agents.length;
  }
  function fillSelect(id, items, selected, emptyLabel, chooseFirst = false) {
    const select = $(id); select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = emptyLabel; select.append(empty);
    for (const item of items) {
      if (!item?.id || item.is_archived === true) continue;
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = item.name || item.title || item.key || item.id; select.append(option);
    }
    if (selected && ![...select.options].some(option => option.value === selected)) {
      const saved = document.createElement('option'); saved.value = selected; saved.textContent = `已保存 · ${selected}`; select.append(saved);
    }
    if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
    else if (chooseFirst && select.options.length > 1) select.selectedIndex = 1;
    return select.value;
  }
  function configuredServers() {
    const saved = readValue('servers', []);
    return ['https://api.multica.ai', ...(Array.isArray(saved) ? saved : [])].filter((value, index, all) => all.indexOf(value) === index);
  }
  function renderServers() {
    const servers = configuredServers().map(api => ({ id: api, name: api === 'https://api.multica.ai' ? 'Multica 官方 · https://api.multica.ai' : api }));
    if (config.api && !servers.some(item => item.id === config.api)) servers.push({ id: config.api, name: config.api });
    fillSelect('api', servers, config.api, '选择 API 服务', true);
    const add = document.createElement('option'); add.value = '__add__'; add.textContent = '＋ 添加自建服务器'; $('api').append(add);
  }
  function applyCatalog(c, data) {
    const sameContext = c.api === config.api && c.workspace === config.workspace;
    const project = sameContext && data.projects.some(item => item.id === config.project) ? config.project : '';
    const agent = sameContext && data.agents.some(item => item.id === config.agent) ? config.agent : '';
    const defaultAgent = sameContext && data.agents.some(item => item.id === config.defaultAgent) ? config.defaultAgent : '';
    const projectContext=`${c.api}:${c.workspace}`, projectSelect=$('task-project');
    const keepProject=projectSelect.dataset.userEdited==='true' && projectSelect.dataset.context===projectContext;
    fillSelect('default-project', data.projects, project, '不指定项目', !sameContext || !config.projectCustomized);
    fillSelect('task-project', data.projects, keepProject?projectSelect.value:project, '无项目', !keepProject && (!sameContext || !config.projectCustomized));
    projectSelect.dataset.context=projectContext;projectSelect.dataset.userEdited=String(keepProject);
    renderAgentChoices({ ...c, agent, defaultAgent }, data.agents);
    if ((!sameContext || !config.defaultAgentCustomized) && !$('default-agent').value && $('default-agent').options.length > 1) $('default-agent').selectedIndex = 1;
    if ((!sameContext || !config.defaultAgentCustomized) && !$('agent').value && $('agent').options.length > 1) $('agent').selectedIndex = 1;
    // 目录可能暂时不完整；保留已保存的标签，避免刷新时把默认值写成空。
    const label = sameContext ? config.label || '' : '';
    fillSelect('default-label', data.labels, label, '不指定标签');
    const labelContext = `${c.api}:${c.workspace}`, labelSelect = $('task-label');
    const keepEdited = labelSelect.dataset.userEdited === 'true' && labelSelect.dataset.context === labelContext;
    fillSelect('task-label', data.labels, keepEdited ? labelSelect.value : resolveProfileLabel(taskDraft ? taskDraft.profile : activeProfile, {...c,label}).value, '无标签');
    labelSelect.dataset.context = labelContext;
    labelSelect.dataset.userEdited = String(keepEdited);
  }
  function applyTaskDefaultLabel(profile=activeProfile) {
    const c={...config,api:$('api').value,workspace:$('workspace').value,label:$('default-label').value};
    const result=resolveProfileLabel(profile,c),catalog=readValue(`catalog:${c.api}:${c.workspace}`,{}) || {};
    fillSelect('task-label',catalog.labels || [],result.value,'无标签');
    $('task-label').dataset.userEdited='false';
    $('task-label').dataset.context=`${c.api}:${c.workspace}`;
    if(result.warning) message(result.warning,'warning');
  }
  async function loadWorkspaceData(c) {
    const paths = [['projects', '/api/projects'], ['agents', '/api/agents'], ['labels', '/api/labels']];
    const results = await Promise.all(paths.map(async ([key, path]) => {
      const response = await request(c)('GET', path);
      if (response.status !== 200) throw Error(`读取${key}失败（HTTP ${response.status}）`);
      return [key, listItems(response.data, key)];
    }));
    const data = Object.fromEntries(results);
    applyCatalog(c, data);
    writeValue(`catalog:${c.api}:${c.workspace}`, data);
    return data;
  }
  async function connect() {
    let tag;
    setConnectionPhase('connecting');
    try {
      const c = validateConnection({ api: $('api').value, token: $('token').value, workspace: '' });
      tag = connectionCacheTag(c.api, c.token);
      message('正在连接并读取工作区…');
      const response = await request(c)('GET', '/api/workspaces');
      if (response.status !== 200) throw Error(`连接失败（HTTP ${response.status}），请检查地址和令牌`);
      const workspaces = listItems(response.data, 'workspaces');
      const preferred = workspaces.some(item => item.id === config.workspace) ? config.workspace : '';
      const selected = fillSelect('workspace', workspaces, preferred, '选择工作区', true);
      if (!selected) throw Error('连接成功，但此账号没有可用工作区');
      const scoped = { ...c, workspace: selected };
      await loadWorkspaceData(scoped);
      config = { ...config, ...scoped, workspace: selected, project: $('default-project').value,
        defaultAgent: $('default-agent').value, agent: $('agent').value, label: $('default-label').value };
      persistConfig(config);
      writeValue(`workspaces:${c.api}`, workspaces);
      writeValue(`connection-tag:${c.api}`, tag);
      setConnectionPhase('connected', tag);
      message(`连接成功，已读取 ${workspaces.length} 个工作区及当前工作区的选项。`, 'success');
    } catch (error) { setConnectionPhase('error', tag); throw error; }
  }
  async function connectIfNeeded() {
    if (!$('token').value.trim() || $('api').value === '__add__') { setConnectionPhase('idle'); return; }
    const c = { api: $('api').value, token: $('token').value, workspace: $('workspace').value };
    const tag = connectionCacheTag(c.api, c.token);
    setConnectionPhase('connecting', tag);
    const workspaces = readValue(`workspaces:${c.api}`, null);
    const catalog = readValue(`catalog:${c.api}:${c.workspace}`, null);
    try {
      if (needsCatalogRefresh(c, readValue(`connection-tag:${c.api}`, ''), workspaces, catalog)) {
        await connect(); return;
      }
      await verifyConnection(request({ ...c, workspace: '' }));
      fillSelect('workspace', workspaces, c.workspace, '选择工作区', true);
      applyCatalog(c, catalog);
      config = { ...config, ...c, project: $('default-project').value, defaultAgent: $('default-agent').value,
        agent: $('agent').value, label: $('default-label').value };
      persistConfig(config);
      setConnectionPhase('connected', tag);
      message('连接已验证，已恢复本地选项；需要更新时点击刷新。', 'success');
    } catch (error) {
      setConnectionPhase('error', tag);
      throw error;
    }
  }
  async function submit() {
    if (!taskDraft) taskDraft=snapshotTaskDraft(buildTypedManualDraft({title:$('task-title').value,description:$('task-description').value,url:location.href}));
    if (needsCapturedDetail(taskDraft) && !taskDraft.detail) throw Error('任务草稿只有列表摘要，请先打开详情并重新进入任务创建');
    const c=settings();c.project=$('task-project').value;c.projectAlias=$('task-project').selectedOptions[0]?.textContent || '';
    if (!$('agent-task').checked) throw Error('当前桥接只支持智能体任务');
    const body=buildIssueBody({title:$('task-title').value,description:$('task-description').value,
      agent:c.agent,project:c.project,status:$('task-status').value,priority:$('task-priority').value,
      label:$('task-label').value,startDate:$('task-start').value,dueDate:$('task-due').value});
    const draft={...taskDraft,title:body.title},attachments=[...selectedAttachments];
    const lockName=draft.legacyBug ? cacheKey(c,draft.legacyBug.BugId) : `multica-draft:${c.api}:${c.workspace}:${draft.sourceKey || draft.draftId}`;
    const create=()=>submitTaskOnce({c,draft,body,api:request(c),get:readValue,set:writeValue,
      prepareBody:value=>prepareSelectedAttachments(c,value,attachments)});
    message('正在检查重复任务，确认不存在后上传附件并创建…');
    const result=navigator.locks ? await navigator.locks.request(lockName,create) : await create();
    rememberSubmittedDraft(draft,result.issue,c);renderProcessing();if(siteMode==='bugdone') renderBugs();
    const text=`${result.existing?'已找到并复用已有任务，未重复创建':'任务已创建并指派'}：${result.issue.identifier || ''}\n任务 ID：${result.issue.id}`;
    if(!result.existing) showSuccess(text);
    const notes=[];
    if(issueLabelState(result.issue,body.label_ids?.[0])==='missing') notes.push(result.existing
      ? '复用任务未带当前所选标签，请在 Multica 中添加。' : '创建响应未包含所选标签，请在 Multica 中核对。');
    const profile=profileRegistry().find(p=>p.id===draft.siteId) || draft.profile;
    const actions=await runProfilePostActions(profile,{siteId:draft.siteId,sourceUrl:draft.sourceUrl,bug:draft.legacyBug,existing:result.existing},
      {'bugdone.start-processing':context=>startBugDoneProcessing(context.bug,bugDoneForm)});
    for(const action of actions) {
      if(action.kind==='started' || action.kind==='already-processing') {
        notes.push('BugDone 状态已确认为「处理中」。');const bug=bugs.get(draft.legacyBug?.BugId);
        if(bug){bug.StrBugStatus='处理中';if(bug.captureRecord?.fields) bug.captureRecord.fields.state='处理中';renderBugs();}
      } else if(action.kind==='error') notes.push(`BugDone 状态同步未确认：${action.message}。Multica 任务已创建，请到 BugDone 核对。`);
      else notes.push(`BugDone 当前为「${action.state}」，未自动修改。`);
    }
    const warning=result.existing || issueLabelState(result.issue,body.label_ids?.[0])==='missing' || actions.some(x=>!['started','already-processing'].includes(x.kind));
    message([text,...notes].join('\n'),warning?'warning':'success');
    if($('continue-create').checked) {
      taskDraft=null;if(activeDraft?.siteId==='manual') activeDraft=null;selectedAttachments=[];renderSelectedAttachments();$('task-title').value='';$('task-description').value='';switchTab('bug');
    }
  }
  function switchTab(name, focus = false) {
    root.querySelectorAll('[role="tab"]').forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    root.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== `view-${name}`; });
    $('bug-action-bar').hidden = name !== 'bug';
    if (name === 'processing') { renderProcessing(); void refreshProcessingStatuses(); }
    if (name === 'profiles') $('profile-json').dispatchEvent(new Event('catalogrefresh'));
  }
  function showSuccess(text) {
    const box = $('success'); box.querySelector('.success-copy').textContent = text;
    box.hidden = false; box.classList.remove('success-pop'); void box.offsetWidth; box.classList.add('success-pop');
    try { if (typeof box.showPopover === 'function' && !box.matches(':popover-open')) box.showPopover(); } catch (_) { /* 旧版 WebView 使用最高层级兜底 */ }
    clearTimeout(showSuccess.timer); showSuccess.timer = setTimeout(() => {
      try { if (box.matches(':popover-open')) box.hidePopover(); } catch (_) {}
      box.hidden = true;
    }, 5500);
  }
  function renderProcessing() {
    const list = $('processing-list'); if (!list) return; list.replaceChildren(); processingRows.clear();
    const view=processingSiteView(submittedBugs,profileRegistry(),location.href,processingSiteSelection,processingPageKey);
    processingSiteSelection=view.selected;processingPageKey=view.pageKey;
    const select=$('processing-site');select.replaceChildren();
    for(const option of view.options) {
      const node=document.createElement('option');node.value=option.key;node.textContent=`${option.label}（${option.count}）`;select.append(node);
    }
    select.value=view.selected;select.title=select.selectedOptions[0]?.textContent || '切换处理列表站点';
    $('processing-count').textContent = `当前 ${view.items.length} 条 · 总计 ${submittedBugs.length}/100`;
    $('refresh-processing').disabled=!view.items.length || !!processingRefreshPromise;
    if (!view.items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '此站点暂无处理记录，可切换其他站点或全部站点查看。'; list.append(empty); return; }
    for (const item of view.items) {
      const row = document.createElement('article'); row.className = 'processing-item';
      const submittedAt=new Date(item.submittedAt);
      const time=Number.isNaN(submittedAt.getTime()) ? '提交时间未知' : `提交于 ${submittedAt.toLocaleString('zh-CN',{hour12:false})}`;
      row.innerHTML = `<div class="processing-main"><div class="processing-identifier"></div><div class="processing-title"></div><div class="processing-meta"></div></div><div class="processing-bottom"><div class="processing-status"></div><div class="processing-item-actions"><button class="text-button processing-delete">删除</button></div></div>`;
      row.querySelector('.processing-identifier').textContent=item.identifier || item.issueId || '任务 ID 未返回';
      const title=row.querySelector('.processing-title');title.textContent=item.title || item.sourceKey || item.bugId || '未命名任务';title.title=title.textContent;
      row.querySelector('.processing-meta').textContent = `${sourceName(item.captureSiteId || item.siteId)} · ${time}${item.workspaceAlias ? ` · ${item.workspaceAlias}` : ''}`;
      const status = row.querySelector('.processing-status');
      const saved = processingStates.get(item);
      const context = `${$('api').value}:${$('workspace').value}:${connectionCacheTag($('api').value, $('token').value)}`;
      if (saved?.context === context) setProcessingStatus(status, saved.result);
      else status.textContent = item.status ? `Multica 状态：${issueStatusLabel(item.status)}（提交时）` : 'Multica 状态：待查询';
      processingRows.set(item, status);
      const url=submittedSourceUrl(item), detail=document.createElement(url?'a':'button');
      detail.className='text-button processing-detail';detail.textContent='去详情页>';
      if (url) { detail.href=url;detail.target='_blank';detail.rel='noopener noreferrer';detail.title='打开关联的原始问题详情页'; }
      else { detail.type='button';detail.disabled=true;detail.title='旧记录未保存来源链接，且无法从来源标识恢复'; }
      row.querySelector('.processing-item-actions').prepend(detail);
      row.querySelector('.processing-delete').onclick = () => { forgetSubmitted(item); renderProcessing(); renderBugs(); message('已从本地处理列表删除；不会删除 Multica 中的任务。'); };
      list.append(row);
    }
  }
  function setProcessingStatus(el, result) {
    el.dataset.kind = result.kind;
    if (result.kind === 'ready') el.textContent = `Multica 状态：${issueStatusLabel(result.status)}`;
    else if (result.kind === 'missing') el.textContent = 'Multica 状态：未找到对应任务';
    else if (result.kind === 'unavailable') el.textContent = 'Multica 状态：请切换到提交时的服务和工作区';
    else el.textContent = `Multica 状态：查询失败（${String(result.error?.message || '请稍后重试').slice(0, 90)}）`;
  }
  async function refreshProcessingStatuses(force = false) {
    if (processingRefreshPromise) {await processingRefreshPromise;return refreshProcessingStatuses(force);}
    const visible=[...processingRows.keys()],site=processingSiteSelection;
    if (!visible.length) return;
    let c;
    try { c = settings(); }
    catch (_) { processingRows.forEach(el => { delete el.dataset.kind; el.textContent = 'Multica 状态：请先完成 API 和工作区配置'; }); return; }
    const context = `${c.api}:${c.workspace}:${connectionCacheTag(c.api, c.token)}`;
    if (!force && processingRefreshContext === `${context}:${site}` && Date.now() - processingRefreshAt < 60000) return;
    $('refresh-processing').disabled = true;
    processingRows.forEach(el => { delete el.dataset.kind; el.textContent = 'Multica 状态：查询中…'; });
    processingRefreshPromise = loadSubmittedStatuses(visible, c, request(c), (item, result) => {
      processingStates.set(item, { context, result });
      const el = processingRows.get(item);
      if (el && el.isConnected && processingSiteSelection===site && `${$('api').value}:${$('workspace').value}:${connectionCacheTag($('api').value, $('token').value)}` === context)
        setProcessingStatus(el, result);
    }).finally(() => {
      processingRefreshAt = Date.now(); processingRefreshContext = `${context}:${site}`;
      processingRefreshPromise = null; $('refresh-processing').disabled = !processingRows.size;
    });
    return processingRefreshPromise;
  }
  const mount=createMount({
    get siteMode(){return siteMode},
    get SCRIPT_VERSION(){return SCRIPT_VERSION},
    get debug(){return debug},
    get bugs(){return bugs},
    get capturedRecords(){return capturedRecords},
    get umengState(){return umengState},
    get currentId(){return currentId},set currentId(value){currentId=value},
    get root(){return root},set root(value){root=value},
    get activeDraft(){return activeDraft},set activeDraft(value){activeDraft=value},
    get taskDraft(){return taskDraft},set taskDraft(value){taskDraft=value},
    get selectedAttachments(){return selectedAttachments},set selectedAttachments(value){selectedAttachments=value},
    get captureRecordChoice(){return captureRecordChoice},set captureRecordChoice(value){captureRecordChoice=value},
    get pagePreviewContext(){return pagePreviewContext},set pagePreviewContext(value){pagePreviewContext=value},
    get attachmentDraftKey(){return attachmentDraftKey},set attachmentDraftKey(value){attachmentDraftKey=value},
    get umengStackMode(){return umengStackMode},set umengStackMode(value){umengStackMode=value},
    get bugImageMode(){return bugImageMode},set bugImageMode(value){bugImageMode=value},
    get removedAutoAttachments(){return removedAutoAttachments},
    get hasGMStorage(){return storage.hasGMStorage},
    get storageFailed(){return storage.failed},
    get readValue(){return readValue},
    get writeValue(){return writeValue},
    get customProfiles(){return customProfiles},set customProfiles(value){customProfiles=value},
    get activeProfile(){return activeProfile},
    get builtinOverrides(){return builtinOverrides},set builtinOverrides(value){builtinOverrides=value},
    get profileRegistry(){return profileRegistry},
    get config(){return config},set config(value){config=value},
    get processingSiteSelection(){return processingSiteSelection},set processingSiteSelection(value){processingSiteSelection=value},
    get launchPosition(){return launchPosition},set launchPosition(value){launchPosition=value},
    get connectionPhase(){return connectionPhase},
    get setConnectionPhase(){return setConnectionPhase},
    get setNativeAIVisibility(){return setNativeAIVisibility},
    get watchNativeAI(){return watchNativeAI},
    get $(){return $},
    get syncPageLayout(){return syncPageLayout},
    get openPanel(){return openPanel},
    get closePanel(){return closePanel},
    get applyPanelMode(){return applyPanelMode},
    get collect(){return collect},
    get captureHookFailed(){return captureHookFailed},
    get syncEntryVisibility(){return syncEntryVisibility},
    get renderPageCapturePreview(){return renderPageCapturePreview},
    get syncCaptureUI(){return syncCaptureUI},
    get refreshCaptureRuntime(){return refreshCaptureRuntime},
    get message(){return message},
    get persistConfig(){return persistConfig},
    get persistConnectionSettings(){return persistConnectionSettings},
    get prepareBugDoneImages(){return prepareBugDoneImages},
    get renderCapturedRecords(){return renderCapturedRecords},
    get captureSelection(){return captureSelection},
    get closeAttachmentPreview(){return closeAttachmentPreview},
    get renderCaptureAttachments(){return renderCaptureAttachments},
    get renderSelectedAttachments(){return renderSelectedAttachments},
    get preview(){return preview},
    get run(){return run},
    get renderAgentChoices(){return renderAgentChoices},
    get fillSelect(){return fillSelect},
    get configuredServers(){return configuredServers},
    get renderServers(){return renderServers},
    get applyCatalog(){return applyCatalog},
    get applyTaskDefaultLabel(){return applyTaskDefaultLabel},
    get loadWorkspaceData(){return loadWorkspaceData},
    get connect(){return connect},
    get connectIfNeeded(){return connectIfNeeded},
    get submit(){return submit},
    get switchTab(){return switchTab},
    get renderProcessing(){return renderProcessing},
    get refreshProcessingStatuses(){return refreshProcessingStatuses}
  });
  function mountWithDiagnostics() {
    try { mount(); }
    catch (e) { debug('界面挂载失败', { errorType: e.name }, 'error'); }
  }
  function scheduleDelayedMount() {
    if (uiScheduled) return;
    uiScheduled = true;
    debug('页面已就绪，安排延迟初始化', { delayMs: UI_DELAY_MS });
    setTimeout(function delayedFunction() {
      uiScheduled = false;
      if (!entryShouldShow(config.entryVisibility,activeProfile)) { debug('入口按显示范围隐藏',{mode:config.entryVisibility}); return; }
      debug('延迟回调已执行', { bodyReady: !!document.body });
      if (!document.body) {
        uiScheduled = false;
        debug('页面主体尚不可用，等待后重试', {}, 'warn');
        setTimeout(scheduleDelayedMount, 300);
        return;
      }
      if (!document.getElementById('bugdone-multica-bridge')) mountWithDiagnostics();
    }, UI_DELAY_MS);
  }
  function openWorkbenchFromCommand(tab = 'multica') {
    if (!document.body) { document.addEventListener('DOMContentLoaded',()=>openWorkbenchFromCommand(tab),{once:true}); return; }
    if (!root) mountWithDiagnostics();
    if (!root || !$('panel')) return;
    openPanel();switchTab(tab,true);
    if (config.token && config.api) void run(connectIfNeeded);
  }
  window.addEventListener('keydown', event => {
    if (root || event.repeat || event.isComposing || !shortcutMatches(event,config.shortcut)) return;
    event.preventDefault();event.stopImmediatePropagation();openWorkbenchFromCommand();
  },true);
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开 Issues处理工作台',()=>openWorkbenchFromCommand());
    GM_registerMenuCommand('设置入口显示范围',()=>openWorkbenchFromCommand('settings'));
  }
  if (document.readyState !== 'loading') scheduleDelayedMount();
  else {
    debug('等待 DOMContentLoaded，再延迟初始化');
    document.addEventListener('DOMContentLoaded', scheduleDelayedMount, { once: true });
  }

}
