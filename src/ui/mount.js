import { BUGDONE_PROFILE, BUILTIN_PROFILES, PROFILE_TEMPLATE, PAGE_TEXT_TEMPLATE, PAGE_BLANK_TEMPLATE } from '../sites/builtins.js';
import { entryShouldShow, testProfileSample } from '../capture/matching.js';
import { parseResponse } from '../sites/bugdone.js';
import { validateConfig, validateConnection, agentCacheKey, connectionCacheTag, needsCatalogRefresh } from '../multica/config.js';
import { validateSiteProfile, assertProfileIdentityUnchanged, profileObservationChanges } from '../capture/profiles.js';
import { buildCapturedDraft, manualDraftContext, buildTypedManualDraft, snapshotTaskDraft } from '../capture/drafts.js';
import { fitLaunchPosition } from './geometry.js';
import { DEFAULT_SHORTCUT } from '../config/constants.js';
import { shortcutFromEvent, shortcutMatches, capturePreferences, nextDraftAttachments, restorePreferenceDefaults } from '../config/preferences.js';
import { createPanelMarkup } from './template.js';
import { SCRIPT_VERSION } from '../config/version.js';

export function createMount(ctx) {
  return function mount() {
    ctx.debug('开始挂载按钮');
    if (!document.getElementById('bugdone-multica-page-shift')) {
      const style = document.createElement('style');
      style.id = 'bugdone-multica-page-shift';
      style.textContent = '';
      document.head.append(style);
    }
    const host = document.createElement('div'); host.id = 'bugdone-multica-bridge';
    document.body.append(host); ctx.root = host.attachShadow({ mode: 'closed' });
    document.documentElement.setAttribute('data-bugdone-multica-started', ctx.SCRIPT_VERSION);
    ctx.watchNativeAI();
    ctx.root.innerHTML = createPanelMarkup(SCRIPT_VERSION);
    ctx.renderServers();
    const renderCaptureSettings=()=>{
      ctx.$('capture-enabled').checked=ctx.config.captureEnabled!==false;ctx.$('capture-auto-attachments').checked=ctx.config.autoCaptureAttachments!==false;
      for(const [id,selected] of [['capture-image-compressed',ctx.config.defaultImageMode==='compressed'],['capture-image-original',ctx.config.defaultImageMode==='original'],
        ['capture-log-summary',ctx.config.defaultLogMode==='summary'],['capture-log-full',ctx.config.defaultLogMode==='full']]) ctx.$(id).setAttribute('aria-pressed',String(selected));
      const list=ctx.$('capture-sites');list.replaceChildren();
      for(const profile of ctx.profileRegistry()) {
        const row=document.createElement('div');row.className='setting-row';row.dataset.profileId=profile.id;
        const copy=document.createElement('div');copy.className='setting-copy';
        const title=document.createElement('strong');title.textContent=profile.metadata?.name || profile.id;
        const description=document.createElement('small');description.textContent=profile.allowedOrigins.map(url=>new URL(url).hostname).join('、');copy.append(title,description);
        const label=document.createElement('label');label.className='switch setting-control';label.setAttribute('aria-label',`启用${title.textContent}捕获`);
        const input=document.createElement('input');input.type='checkbox';input.checked=profile.enabled;input.dataset.profileId=profile.id;
        input.id=profile.adapter==='umeng'?'enable-umeng':`capture-site-${profile.id}`;
        input.onchange=()=>ctx.run(()=>{const current=ctx.profileRegistry().find(p=>p.id===profile.id);if(current)persistProfile({...current,enabled:input.checked},true,true);});
        const track=document.createElement('span');track.className='switch-track';track.setAttribute('aria-hidden','true');label.append(input,track);row.append(copy,label);list.append(row);
      }
      for(const [name,id] of [['bugdone','bugdone'],['umeng','umeng-apm-crash'],['github','github-issues']]) {
        const input=ctx.$(`builtin-enable-${name}`),profile=ctx.profileRegistry().find(p=>p.id===id);input.checked=!!profile?.enabled;
        input.onchange=()=>ctx.run(()=>{const current=ctx.profileRegistry().find(p=>p.id===id);if(current)persistProfile({...current,enabled:input.checked},true,true);});
      }
    };
    const selectedProfileId=()=>ctx.$('profile-list').value.replace(/^builtin:/,'');
    const selectedProfile=()=>ctx.profileRegistry().find(p=>p.id===selectedProfileId());
    const renderProfileList=(selected='builtin:bugdone')=>{
      const list=ctx.$('profile-list');list.replaceChildren();
      for(const profile of ctx.profileRegistry()) {
        const builtin=BUILTIN_PROFILES.some(p=>p.id===profile.id), option=document.createElement('option');
        option.value=(builtin?'builtin:':'')+profile.id;
        option.textContent=`${builtin?'内置':'自定义'} · ${profile.metadata?.name || profile.id} · ${profile.allowedOrigins.map(x=>new URL(x).hostname).join('、')} · ${profile.enabled?'已启用':'已停用'}`;list.append(option);
      }
      const empty=document.createElement('option');empty.value='';empty.textContent='新建配置';list.append(empty);list.value=selected;
      const umeng=ctx.profileRegistry().find(p=>p.adapter==='umeng');
      renderCaptureSettings();
      ctx.$('umeng-profile-state').textContent=`内置 · ${umeng?.enabled?'已启用':'已停用'} · 查看规则`;
      for(const profile of BUILTIN_PROFILES) {
        const button=ctx.$(profile.adapter==='umeng'?'open-umeng-profile':profile.adapter==='bugdone'?'open-bugdone-profile':'open-github-profile');
        button.querySelector('span').textContent=`内置 · ${ctx.profileRegistry().find(p=>p.id===profile.id)?.enabled?'已启用':'已停用'} · 查看规则`;
      }
    };
    const renderProfileLabel=(profile)=>{
      const label=profile?.defaultLabel || {mode:'inherit'};
      ctx.$('profile-label-mode').value=label.mode;
      const c={api:ctx.$('api').value || ctx.config.api,workspace:ctx.$('workspace').value || ctx.config.workspace};
      const catalog=ctx.readValue(`catalog:${c.api}:${c.workspace}`,{}) || {};
      ctx.fillSelect('profile-label-value',catalog.labels || [],label.mode==='fixed'?label.id:'','选择标签');
      ctx.$('profile-label-value').hidden=label.mode!=='fixed';
    };
    const renderProfileSelection=()=>{
      const profile=selectedProfile(), creating=ctx.$('profile-list').value==='';ctx.$('profile-json').readOnly=false;
      for(const id of ['profile-template-mode','use-profile-template']) {
        ctx.$(id).disabled=!creating;ctx.$(id).title=creating?'将模板填入新配置 JSON':'仅在选择“新建配置”时可使用模板';
      }
      ctx.$('profile-json').value=profile?JSON.stringify(profile,null,2):'';renderProfileLabel(profile);
      ctx.$('profile-response-test').hidden=!!profile?.captureMode && profile.captureMode!=='api';
      ctx.$('profile-feedback').textContent=profile?`${profile.metadata?.name || profile.id} · 保存后立即应用。来源身份与查重键不可改；回滚可恢复上一版。`:'';
    };
    const persistProfile=(profile,remember=true,preserveEditor=false)=>{
      const editing=ctx.$('profile-list').value,editor=ctx.$('profile-json').value;
      const previous=ctx.profileRegistry().find(p=>p.id===profile.id);
      if(previous && remember) ctx.writeValue(`profilePrevious:${profile.id}`,previous);
      if(BUILTIN_PROFILES.some(p=>p.id===profile.id)) {
        ctx.builtinOverrides={...ctx.builtinOverrides,[profile.id]:profile};ctx.writeValue('builtinProfileOverrides',ctx.builtinOverrides);
      } else {
        const next=[...ctx.customProfiles.filter(p=>p.id!==profile.id),profile];if(next.length>20) throw Error('最多保存 20 个站点配置');
        ctx.writeValue('siteProfiles',next);ctx.customProfiles=next;
      }
      ctx.refreshCaptureRuntime(true);
      renderProfileList(preserveEditor?editing:(BUILTIN_PROFILES.some(p=>p.id===profile.id)?'builtin:':'')+profile.id);
      if(!preserveEditor) renderProfileSelection();
      else try {const draft=JSON.parse(editor);if(draft.id===profile.id) {draft.enabled=profile.enabled;ctx.$('profile-json').value=JSON.stringify(draft,null,2);}}catch(_) { /* 开关不清空尚未保存的编辑内容 */ }
    };
    renderProfileList();renderProfileSelection();
    ctx.$('profile-list').onchange=renderProfileSelection;
    const editLabelJson=()=>{
      ctx.$('profile-label-value').hidden=ctx.$('profile-label-mode').value!=='fixed';
      try {
        const profile=JSON.parse(ctx.$('profile-json').value),mode=ctx.$('profile-label-mode').value;
        profile.defaultLabel=mode==='fixed'?{mode,id:ctx.$('profile-label-value').value,api:ctx.$('api').value,workspace:ctx.$('workspace').value}:{mode};
        ctx.$('profile-json').value=JSON.stringify(profile,null,2);
      } catch { ctx.$('profile-feedback').textContent='请先填写有效的配置 JSON'; }
    };
    ctx.$('profile-label-mode').onchange=editLabelJson;ctx.$('profile-label-value').onchange=editLabelJson;
    ctx.$('profile-json').addEventListener('change',()=>{try{renderProfileLabel(JSON.parse(ctx.$('profile-json').value));}catch{}});
    ctx.$('profile-json').addEventListener('catalogrefresh',()=>{try{renderProfileLabel(JSON.parse(ctx.$('profile-json').value));}catch{}});
    ctx.$('capture-enabled').onchange=()=>ctx.run(()=>{ctx.config.captureEnabled=ctx.$('capture-enabled').checked;ctx.persistConfig(ctx.config);ctx.refreshCaptureRuntime(true);renderCaptureSettings();ctx.message(ctx.config.captureEnabled?'自动捕获已恢复。':'自动捕获已暂停，已有内容与草稿仍保留。');});
    ctx.$('capture-auto-attachments').onchange=()=>ctx.run(()=>{ctx.config.autoCaptureAttachments=ctx.$('capture-auto-attachments').checked;ctx.persistConfig(ctx.config);renderCaptureSettings();ctx.message('附件默认设置已保存，仅影响后续新草稿。','success');});
    for(const [id,key,value] of [['capture-image-compressed','defaultImageMode','compressed'],['capture-image-original','defaultImageMode','original'],
      ['capture-log-summary','defaultLogMode','summary'],['capture-log-full','defaultLogMode','full']]) ctx.$(id).onclick=()=>ctx.run(()=>{
        ctx.config[key]=value;ctx.persistConfig(ctx.config);renderCaptureSettings();ctx.message('版本默认值已保存，当前记录和任务中的版本选择保持不变。','success');
      });
    for(const [button,id] of [['open-bugdone-profile','bugdone'],['open-umeng-profile','umeng-apm-crash'],['open-github-profile','github-issues']]) ctx.$(button).onclick=()=>{
      ctx.$('profile-list').value='builtin:'+id;renderProfileSelection();ctx.$('profile-json').scrollIntoView({block:'nearest'});
    };
    ctx.$('use-profile-template').onclick=()=>{
      if(ctx.$('profile-list').value!=='' || ctx.$('use-profile-template').disabled) return;
      renderProfileSelection();ctx.$('profile-json').value=JSON.stringify(({api:PROFILE_TEMPLATE,text:PAGE_TEXT_TEMPLATE,blank:PAGE_BLANK_TEMPLATE})[ctx.$('profile-template-mode').value] || PROFILE_TEMPLATE,null,2);ctx.$('profile-json').focus();
      ctx.$('profile-response-test').hidden=ctx.$('profile-template-mode').value!=='api';
    };
    ctx.$('save-profile').onclick=()=>ctx.run(()=>{
      const raw=ctx.$('profile-json').value;if(raw.length>80000) throw Error('配置文件不得超过 80 KB');
      const profile=validateSiteProfile(JSON.parse(raw)),previous=ctx.profileRegistry().find(p=>p.id===profile.id);
      if(selectedProfileId() && profile.id!==selectedProfileId()) throw Error('不能修改已有配置 ID；请使用新建配置');
      assertProfileIdentityUnchanged(previous,profile);
      const changes=profileObservationChanges(previous,profile);
      const saved={...profile,enabled:!!previous?.enabled && profile.enabled && !changes.length};
      persistProfile(saved);
      ctx.$('profile-feedback').textContent=`已保存并应用。${changes.length?'读取规则变更：'+changes.join('；')+'。请核对后启用。':''}`;
      ctx.message('配置已保存；当前页面已重载捕获规则。','success');
    });
    ctx.$('toggle-profile').onclick=()=>ctx.run(()=>{const p=selectedProfile();if(!p) throw Error('请先保存配置');persistProfile({...p,enabled:!p.enabled},true,true);ctx.message('捕获配置已立即启用或停用。','success');});
    ctx.$('rollback-profile').onclick=()=>ctx.run(()=>{
      const previous=ctx.readValue(`profilePrevious:${selectedProfileId()}`,null);if(!previous) throw Error('没有可回滚的上一版');
      persistProfile(validateSiteProfile(previous));ctx.message('已恢复上一版配置并重载。','success');
    });
    ctx.$('export-profile').onclick=()=>ctx.run(()=>{
      const profile=selectedProfile();if(!profile) throw Error('请先选择已保存配置');
      const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`${profile.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    ctx.$('test-profile').onclick=()=>ctx.run(()=>{
      const profile=validateSiteProfile(JSON.parse(ctx.$('profile-json').value)),sample=ctx.$('profile-sample').value;
      if(sample.length>4000000) throw Error('响应样本超过 4 MB');
      const result=testProfileSample(profile,JSON.parse(sample));
      ctx.$('profile-feedback').textContent=`试运行 ${result.ruleId}：匹配 ${result.matched} 条，有效 ${result.valid} 条，详情 ${result.detail} 条，缺少身份 ${result.missingIdentity} 条。样本未保存。`;
    });
    ctx.$('delete-profile').onclick=()=>ctx.run(()=>{
      const id=selectedProfileId();if(!id) throw Error('请先选择配置');
      const builtin=BUILTIN_PROFILES.some(p=>p.id===id);
      if(builtin){delete ctx.builtinOverrides[id];ctx.writeValue('builtinProfileOverrides',ctx.builtinOverrides);}
      else {ctx.customProfiles=ctx.customProfiles.filter(p=>p.id!==id);ctx.writeValue('siteProfiles',ctx.customProfiles);}
      ctx.refreshCaptureRuntime(true);renderProfileList(builtin?'builtin:'+id:'');renderProfileSelection();ctx.message(builtin?'已恢复内置配置':'配置已删除并停止捕获','success');
    });
    ctx.$('token').value = ctx.config.token || '';
    ctx.setConnectionPhase('idle');
    ctx.fillSelect('workspace', ctx.readValue(`workspaces:${ctx.config.api}`, []), ctx.config.workspace, '请先连接', false);
    if (ctx.config.workspace && !ctx.$('workspace').value) ctx.fillSelect('workspace', [{ id: ctx.config.workspace, name: ctx.config.workspaceAlias || ctx.config.workspace }], ctx.config.workspace, '请先连接');
    const catalog = ctx.readValue(`catalog:${ctx.config.api}:${ctx.config.workspace}`, {}) || {};
    ctx.fillSelect('default-project', catalog.projects || (ctx.config.project ? [{ id: ctx.config.project, name: ctx.config.projectAlias || ctx.config.project }] : []), ctx.config.project, '不指定项目');
    ctx.fillSelect('task-project', catalog.projects || (ctx.config.project ? [{ id: ctx.config.project, name: ctx.config.projectAlias || ctx.config.project }] : []), ctx.config.project, '无项目');
    ctx.fillSelect('default-label', catalog.labels || [], ctx.config.label, '不指定标签');
    ctx.fillSelect('task-label', catalog.labels || [], ctx.config.label, '无标签');
    for(const id of ['task-label','task-project']) ctx.$(id).addEventListener('change',()=>{
      ctx.$(id).dataset.userEdited='true';ctx.$(id).dataset.context=`${ctx.$('api').value}:${ctx.$('workspace').value}`;
    });
    ctx.$('hide-native-ai').checked = ctx.config.hideNativeAI !== false;
    ctx.$('entry-visibility').value=ctx.config.entryVisibility;
    ctx.$('entry-visibility').addEventListener('change',()=>{
      ctx.config.entryVisibility=ctx.$('entry-visibility').value;ctx.syncEntryVisibility();ctx.persistConfig({...ctx.config});
      ctx.message('入口显示范围已保存；快捷键仍可打开工作台。','success');
    });
    ctx.applyPanelMode(ctx.config.displayMode);
    function showShortcut() {
      const label = ctx.config.shortcut.replaceAll('+', ' + ');
      ctx.$('shortcut').value = label;
      ctx.$('shortcut-description').textContent = `在当前网页按 ${label} 打开或关闭面板`;
    }
    showShortcut();
    const launch = ctx.$('launch');
    let drag = null, suppressLaunchClick = false;
    const launchViewport = () => ({
      left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0,
      width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight
    });
    const placeLaunch = position => {
      launch.style.left = `${position.left}px`; launch.style.top = `${position.top}px`;
      launch.style.right = 'auto'; launch.style.bottom = 'auto';
    };
    function constrainLaunch(reason, requested) {
      if (drag && !requested) return;
      const rect = launch.getBoundingClientRect(), viewport = launchViewport();
      if (!rect.width || !rect.height || !viewport.width || !viewport.height) return;
      const before = requested || rect, position = fitLaunchPosition(before, rect, viewport);
      const corrected = Math.abs(position.left - before.left) > .5 || Math.abs(position.top - before.top) > .5;
      if (requested || corrected) placeLaunch(position);
      if (corrected) {
        ctx.launchPosition = position;
        try { ctx.writeValue('launchPosition', position); } catch (_) { /* 当前页面仍保持可见位置 */ }
        ctx.debug('入口位置已自动校正', { reason, previous: { left: before.left, top: before.top }, position, viewport });
      }
    }
    if (ctx.launchPosition && Number.isFinite(Number(ctx.launchPosition.left)) && Number.isFinite(Number(ctx.launchPosition.top))) {
      constrainLaunch('restore', { left: Number(ctx.launchPosition.left), top: Number(ctx.launchPosition.top) });
    }
    launch.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      const rect = launch.getBoundingClientRect(); launch.setPointerCapture?.(e.pointerId);
      drag = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top, x: e.clientX, y: e.clientY, moved: false };
    });
    launch.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      if (!drag.moved) return;
      placeLaunch(fitLaunchPosition({ left: e.clientX - drag.dx, top: e.clientY - drag.dy }, launch.getBoundingClientRect(), launchViewport()));
    });
    launch.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.moved) { suppressLaunchClick = true; try { ctx.writeValue('launchPosition', { left: launch.getBoundingClientRect().left, top: launch.getBoundingClientRect().top }); } catch (_) {} setTimeout(() => { suppressLaunchClick = false; }, 0); }
      drag = null;
      constrainLaunch('drag-end');
    });
    launch.addEventListener('pointercancel', () => { drag = null; constrainLaunch('drag-cancel'); });
    launch.onclick = () => { if (suppressLaunchClick) return; if (launch.getAttribute('aria-expanded') === 'true') ctx.closePanel(); else { ctx.openPanel(); ctx.root.querySelector('[role=tab][aria-selected=true]').focus(); } };
    ctx.$('close').onclick = () => { ctx.closePanel(); ctx.$('launch').focus(); };
    window.addEventListener('resize', () => { ctx.syncPageLayout(ctx.$('launch').getAttribute('aria-expanded') === 'true'); constrainLaunch('window-resize'); });
    window.visualViewport?.addEventListener('resize', () => constrainLaunch('viewport-resize'));
    window.visualViewport?.addEventListener('scroll', () => constrainLaunch('viewport-scroll'));
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => constrainLaunch('button-resize')).observe(launch);
    ctx.$('panel').addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!ctx.$('attachment-preview').hidden) ctx.closeAttachmentPreview();
      else ctx.$('close').click();
    });
    ctx.$('attachment-preview-close').onclick = ctx.closeAttachmentPreview;
    ctx.$('attachment-preview').onclick = event => { if (event.target === ctx.$('attachment-preview')) ctx.closeAttachmentPreview(); };
    const tabs = [...ctx.root.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.onclick = () => ctx.switchTab(tab.dataset.tab);
      tab.onkeydown = e => {
        let next;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = tabs.length - 1;
        if (next !== undefined) { e.preventDefault(); ctx.switchTab(tabs[next].dataset.tab, true); }
      };
    });
    const showStackMode = () => {
      ctx.$('umeng-stack-summary').setAttribute('aria-pressed', String(ctx.umengStackMode === 'summary'));
      ctx.$('umeng-stack-full').setAttribute('aria-pressed', String(ctx.umengStackMode === 'full'));
    };
    const showImageMode = () => {
      ctx.$('bug-image-compressed').setAttribute('aria-pressed', String(ctx.bugImageMode === 'compressed'));
      ctx.$('bug-image-original').setAttribute('aria-pressed', String(ctx.bugImageMode === 'original'));
    };
    const chooseStackMode = mode => {
      ctx.umengStackMode = mode; showStackMode(); ctx.renderCapturedRecords();
      if(ctx.taskDraft?.sourceKey && ctx.taskDraft.sourceKey===ctx.activeDraft?.sourceKey) {ctx.taskDraft={...ctx.taskDraft,attachments:structuredClone(ctx.activeDraft.attachments)};ctx.renderSelectedAttachments();}
      if (ctx.activeDraft?.sourceKey && ctx.attachmentDraftKey === ctx.activeDraft.sourceKey && ctx.selectedAttachments.some(item=>item.generated)) {
        ctx.selectedAttachments = [...ctx.selectedAttachments.filter(item => !item.generated),
          ...ctx.activeDraft.attachments.filter(item => !ctx.removedAutoAttachments.has(`${ctx.activeDraft.sourceKey}:${item.name}`))
            .map(item => ({ ...item, generated: true, attachmentScope: ctx.activeDraft.sourceKey }))];
        ctx.$('task-attachment-mode').textContent = `友盟堆栈：${mode === 'summary' ? '精简版 TXT' : '完整版 TXT'}`;
        ctx.$('task-attachment-mode').hidden = !ctx.activeDraft.attachments.length;
        ctx.renderSelectedAttachments();
      }
    };
    ctx.$('umeng-stack-summary').onclick = () => chooseStackMode('summary');
    ctx.$('umeng-stack-full').onclick = () => chooseStackMode('full');
    const chooseImageMode = mode => ctx.run(async () => {
      const previous = ctx.bugImageMode;
      ctx.bugImageMode = mode; showImageMode();
      const bug = ctx.bugs.get(ctx.$('bug').value);
      if(bug && ctx.taskDraft?.legacyBug?.BugId===bug.BugId) ctx.taskDraft={...ctx.taskDraft,captureDefaults:{...(ctx.taskDraft.captureDefaults || capturePreferences(ctx.config)),defaultImageMode:mode}};
      if (bug && ctx.attachmentDraftKey === `bugdone:${bug.BugId}` && ctx.selectedAttachments.some(item=>item.generated)) {
        try {
          const generated = await ctx.prepareBugDoneImages(bug, mode, ctx.removedAutoAttachments);
          ctx.selectedAttachments = [...ctx.selectedAttachments.filter(item => !item.generated), ...generated];
          ctx.$('task-attachment-mode').textContent = `BugDone 截图：${mode === 'compressed' ? '压缩版' : '原图'}`;
          ctx.$('task-attachment-mode').hidden = !generated.length;
          ctx.renderSelectedAttachments();
        } catch (error) { ctx.bugImageMode = previous; showImageMode(); throw error; }
      }
    });
    ctx.$('bug-image-compressed').onclick = () => { void chooseImageMode('compressed'); };
    ctx.$('bug-image-original').onclick = () => { void chooseImageMode('original'); };
    showImageMode();showStackMode();
    ctx.$('next').onclick = () => ctx.run(async () => {
      const previousCaptureDefaults=ctx.taskDraft?.captureDefaults, previousAttachmentKey=ctx.attachmentDraftKey;
      const bug = ctx.siteMode === 'bugdone' ? ctx.bugs.get(ctx.$('bug').value) : null;
      const records = ctx.siteMode === 'umeng' ? ctx.umengState.records : ctx.capturedRecords;
      const selectedRecord = ctx.siteMode === 'bugdone' ? bug?.captureRecord : records.get(ctx.$('capture-record').value);
      const useManual = !selectedRecord || ctx.activeDraft?.siteId === 'manual';
      if (useManual) {
        const title = ctx.$(ctx.siteMode === 'bugdone' ? 'title' : 'capture-title').value;
        const description = ctx.$(ctx.siteMode === 'bugdone' ? 'description' : 'capture-description').value;
        const context = manualDraftContext(ctx.siteMode!=='bugdone'?ctx.activeDraft:null,ctx.activeProfile,location.href);
        ctx.taskDraft = snapshotTaskDraft(buildTypedManualDraft({title,description,url:context.url,previous:ctx.taskDraft,sourceDraft:ctx.activeDraft}),context.profile);
        ctx.selectedAttachments = ctx.selectedAttachments.filter(item=>!item.generated);
        ctx.attachmentDraftKey = `manual:${ctx.taskDraft.draftId}`;
        ctx.$('task-title').value = title; ctx.$('task-description').value = description;
        ctx.$('task-source').textContent = ctx.taskDraft.sourceUrl;
        ctx.$('task-attachment-mode').hidden = true;
        ctx.renderSelectedAttachments();
        ctx.message('已作为手动草稿进入任务创建；仅对本次草稿防重复，不自动修改源站问题状态。');
      } else if (ctx.siteMode === 'bugdone') {
        const nextKey = `bugdone:${ctx.$('bug').value}`;
        if (ctx.attachmentDraftKey!==nextKey && ctx.config.autoCaptureAttachments && ctx.bugImageMode === 'compressed' && bug.attachments?.some(item => item.image)) ctx.message('正在生成压缩截图，请稍候…');
        const generated = ctx.attachmentDraftKey!==nextKey && ctx.config.autoCaptureAttachments ? await ctx.prepareBugDoneImages(bug, ctx.bugImageMode, ctx.removedAutoAttachments) : [];
        if(!bug.captureRecord) throw Error('缺少有效来源身份，请重新打开 BugDone 详情');
        ctx.taskDraft=snapshotTaskDraft({...buildCapturedDraft(bug.captureRecord,ctx.activeProfile || BUGDONE_PROFILE),detail:bug.detail},ctx.activeProfile || BUGDONE_PROFILE,bug);
        ctx.selectedAttachments = nextDraftAttachments(ctx.selectedAttachments,generated,{previousKey:ctx.attachmentDraftKey,key:nextKey,include:ctx.config.autoCaptureAttachments});
        ctx.attachmentDraftKey = nextKey;
        ctx.$('task-title').value = ctx.$('title').value; ctx.$('task-description').value = ctx.$('description').value;
        ctx.$('task-source').textContent = bug.sourceUrl || location.href;
        ctx.$('task-attachment-mode').textContent = `BugDone 截图：${ctx.bugImageMode === 'compressed' ? '压缩版' : '原图'}`;
        ctx.$('task-attachment-mode').hidden = !ctx.selectedAttachments.some(item=>item.generated);
        ctx.renderSelectedAttachments();
      } else {
        if (!ctx.activeDraft) { ctx.message('请先捕获一条记录或选取网页文字。', 'warning'); return; }
        if (ctx.siteMode === 'umeng') {
          const record = ctx.umengState.records.get(ctx.$('capture-record').value);
          if (record?.logDetailCoverage?.total > record.logDetailCoverage.captured)
            ctx.message(`友盟已加载 ${record.logDetailCoverage.captured}/${record.logDetailCoverage.total} 条日志详情；未打开的明细不会包含在任务中。`, 'warning');
        }
        ctx.taskDraft=snapshotTaskDraft(ctx.activeDraft,ctx.activeDraft.siteId==='manual'?null:ctx.activeProfile);
        const nextKey = ctx.activeDraft.sourceKey || `manual:${ctx.activeDraft.draftId}`;
        const previousKey=ctx.attachmentDraftKey;ctx.attachmentDraftKey = nextKey;
        ctx.$('task-title').value = ctx.$('capture-title').value;
        ctx.$('task-description').value = ctx.$('capture-description').value;
        ctx.$('task-source').textContent = ctx.activeDraft.sourceUrl || location.href;
        ctx.selectedAttachments = nextDraftAttachments(ctx.selectedAttachments,(ctx.activeDraft.attachments || []).filter(item => !ctx.removedAutoAttachments.has(`${ctx.activeDraft.sourceKey}:${item.name}`))
            .map(item => ({ ...item, original:ctx.config.defaultImageMode==='original',generated: true, attachmentScope: ctx.activeDraft.sourceKey })),{previousKey,key:nextKey,include:ctx.config.autoCaptureAttachments});
        ctx.$('task-attachment-mode').textContent = ctx.siteMode === 'umeng' ? `友盟堆栈：${ctx.umengStackMode === 'summary' ? '精简版 TXT' : '完整版 TXT'}` : '';
        ctx.$('task-attachment-mode').hidden = ctx.siteMode !== 'umeng' || !ctx.selectedAttachments.some(item=>item.generated || item.fromCapture);
        ctx.renderSelectedAttachments();
      }
      ctx.taskDraft.captureDefaults=previousAttachmentKey===ctx.attachmentDraftKey && previousCaptureDefaults || {...capturePreferences(ctx.config),defaultImageMode:ctx.siteMode==='bugdone'?ctx.bugImageMode:ctx.config.defaultImageMode,defaultLogMode:ctx.siteMode==='umeng'?ctx.umengStackMode:ctx.config.defaultLogMode};
      ctx.$('source-attachments').open=ctx.taskDraft.captureDefaults.autoCaptureAttachments===false;ctx.renderSelectedAttachments();
      ctx.applyTaskDefaultLabel(ctx.taskDraft?.profile || null);
      ctx.switchTab('multica', true);
    });
    ctx.$('new-blank-task').onclick = () => {
      ctx.activeDraft = { siteId: 'manual', scopeId: location.origin, recordId: '', sourceKey: '',
        draftId: crypto.randomUUID(), sourceUrl: location.href, title: '', description: '', attachments: [] };
      ctx.taskDraft=snapshotTaskDraft(ctx.activeDraft);
      ctx.selectedAttachments = []; ctx.attachmentDraftKey = `manual:${ctx.activeDraft.draftId}`; ctx.renderSelectedAttachments();
      ctx.$('task-attachment-mode').hidden = true;
      ctx.$('task-title').value = ''; ctx.$('task-description').value = `来源：${location.href}\n\n`;
      ctx.$('task-source').textContent = location.href;
      ctx.applyTaskDefaultLabel(null);
      ctx.$('task-title').focus();
      ctx.message('已新建空白任务；没有稳定来源 ID，仅对本次草稿防重复。');
    };
    ctx.$('task-more').onclick = () => { ctx.$('task-extras').open = !ctx.$('task-extras').open; };
    let capturingShortcut = false;
    ctx.$('edit-shortcut').onclick = () => { capturingShortcut = true; ctx.$('shortcut').value = '请按快捷键…'; ctx.$('shortcut').focus(); };
    ctx.$('shortcut').onblur = () => { if (capturingShortcut) { capturingShortcut = false; showShortcut(); } };
    ctx.$('reset-shortcut').onclick = () => { capturingShortcut = false; ctx.config.shortcut = DEFAULT_SHORTCUT; ctx.config.shortcutCustomized = false; showShortcut(); ctx.persistConfig({ ...ctx.config }); ctx.message('快捷键已恢复默认。', 'success'); };
    window.addEventListener('keydown', event => {
      if (event.repeat || event.isComposing) return;
      if (capturingShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { capturingShortcut = false; showShortcut(); return; }
        const shortcut = shortcutFromEvent(event);
        if (!shortcut) return;
        ctx.config.shortcut = shortcut;
        ctx.config.shortcutCustomized = true;
        capturingShortcut = false;
        showShortcut();
        ctx.persistConfig({ ...ctx.config });
        ctx.message(`快捷键已保存：${ctx.$('shortcut').value}`, 'success');
        return;
      }
      if (!shortcutMatches(event, ctx.config.shortcut)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (ctx.$('launch').getAttribute('aria-expanded') === 'true') ctx.closePanel();
      else { ctx.openPanel(); ctx.switchTab('multica', true); }
    }, true);
    ctx.$('task-attachments').onclick = () => ctx.$('attachment-picker').click();
    ctx.$('attachment-picker').onchange = event => {
      const files = [...(event.target.files || [])];
      if (files.some(file => !file.size || file.size > 20 * 1024 * 1024)) {
        ctx.message('每个附件须为 1 字节至 20 MiB。', 'warning'); event.target.value = ''; return;
      }
      ctx.selectedAttachments.push(...files.map(file => ({ name: file.name, file })));
      event.target.value = ''; ctx.renderSelectedAttachments();
    };
    ctx.$('capture-selection').onclick = () => ctx.run(ctx.captureSelection);
    ctx.$('reset-page-capture').onclick=()=>ctx.run(()=>{
      if (!ctx.activeProfile?.captureMode || ctx.activeProfile.captureMode==='api') return;
      ctx.activeDraft=null;ctx.pagePreviewContext='';
      ctx.$('capture-title').dataset.generated='true';ctx.$('capture-description').dataset.generated='true';
      ctx.renderPageCapturePreview();ctx.message('已按当前页面重新生成草稿。');
    });
    ctx.$('capture-record').onchange = () => {
      ctx.captureRecordChoice = {url:location.href,key:ctx.$('capture-record').value};
      ctx.activeDraft = null; ctx.renderCapturedRecords();
    };
    const keepManualCapture = () => {
      if (!ctx.$('capture-record').value) ctx.captureRecordChoice = {url:location.href,key:''};
    };
    ctx.$('capture-title').addEventListener('input', () => { ctx.$('capture-title').dataset.generated = 'false'; keepManualCapture(); });
    ctx.$('capture-description').addEventListener('input', () => { ctx.$('capture-description').dataset.generated = 'false'; keepManualCapture(); });
    ctx.$('processing-site').onchange=()=>{ctx.processingSiteSelection=ctx.$('processing-site').value;ctx.renderProcessing();void ctx.refreshProcessingStatuses();};
    ctx.$('refresh-processing').onclick = () => { void ctx.refreshProcessingStatuses(true); };
    ctx.$('agent-task').onchange = () => { ctx.$('submit').disabled = !ctx.$('agent-task').checked; if (!ctx.$('agent-task').checked) ctx.message('当前桥接只支持智能体任务。'); };
    ctx.$('open-multica').onclick = () => {
      // 桌面端注册 multica://；网页无法直接查询安装状态，用失焦和原生回执判断是否需要回退。
      let opened = false;
      const openWebsite = () => {
        const tab = window.open('about:blank', '_blank');
        if (!tab) { window.location.assign('https://multica.ai'); return; }
        tab.opener = null;
        tab.location.replace('https://multica.ai');
      };
      const onNativeOpen = () => { opened = true; clearTimeout(fallbackTimer); };
      window.addEventListener('fastlane:multica-opened', onNativeOpen, { once: true });
      const fallbackTimer = setTimeout(() => {
        window.removeEventListener('fastlane:multica-opened', onNativeOpen);
        if (opened || document.hidden || !document.hasFocus()) return;
        openWebsite();
      }, 1800);
      try { window.location.href = 'multica://open'; }
      catch {
        clearTimeout(fallbackTimer);
        window.removeEventListener('fastlane:multica-opened', onNativeOpen);
        openWebsite();
      }
    };
    const manuallyConnect=()=>ctx.run(async()=>{clearTimeout(tokenSaveTimer);ctx.persistConnectionSettings();await ctx.connect();});
    ctx.$('refresh-connection').onclick = manuallyConnect;
    ctx.$('connect').onclick = manuallyConnect;
    ctx.$('add-api').onclick = () => ctx.run(async () => {
      const c = validateConnection({ api: ctx.$('custom-api').value.trim(), token: 'address-only' });
      const saved = ctx.configuredServers().filter(api => api !== 'https://api.multica.ai');
      if (!saved.includes(c.api)) saved.push(c.api);
      ctx.writeValue('servers', saved); ctx.renderServers(); ctx.$('api').value=c.api; ctx.$('custom-api').value = '';
      ctx.$('custom-server-panel').hidden = true;
      ctx.$('api').dispatchEvent(new Event('change'));
      ctx.message('自建服务已添加并保存，请手动连接。', 'success');
    });
    ctx.switchTab('bug');
    ctx.$('bug').onchange = () => {
      ctx.currentId = ctx.$('bug').value; ctx.$('bug').dataset.manual = String(!ctx.currentId);
      if (ctx.currentId) ctx.preview();
      else { ctx.$('bug-state').textContent = '手动填写'; ctx.$('share-url').value = ''; ctx.$('warning').textContent = '可直接填写标题和描述；下一步按手动草稿处理。'; ctx.renderCaptureAttachments(); }
    };
    ctx.$('restore').onclick = () => ctx.preview(true);
    const keepManualBug = () => { if (!ctx.$('bug').value) { ctx.$('bug').dataset.manual='true';ctx.currentId=''; } };
    ctx.$('title').addEventListener('input', () => { ctx.$('title').dataset.generated = 'false'; keepManualBug(); });
    ctx.$('description').addEventListener('input', () => { ctx.$('description').dataset.generated = 'false'; keepManualBug(); });
    ctx.$('agent').addEventListener('change', () => { ctx.config.agent = ctx.$('agent').value; try { ctx.writeValue('config', { ...ctx.config, agent: ctx.config.agent }); } catch (e) { ctx.debug('智能体选择保存失败', { errorType: e.name }, 'warn'); } });
    ctx.renderAgentChoices(ctx.config, catalog.agents || ctx.readValue(agentCacheKey(ctx.config), []));
    ctx.$('default-agent').addEventListener('change', () => {
      const previous = ctx.config.defaultAgent;
      ctx.config.defaultAgent = ctx.$('default-agent').value;
      ctx.config.defaultAgentCustomized = true;
      if (!ctx.$('agent').value || ctx.$('agent').value === previous) ctx.$('agent').value = ctx.config.defaultAgent;
      ctx.config.agent = ctx.$('agent').value;
      try { ctx.persistConfig({ ...ctx.config }); ctx.message('默认处理智能体已保存。', 'success'); }
      catch (e) { ctx.message('默认处理智能体保存失败。', 'error'); }
    });
    ctx.$('api').addEventListener('change', () => {
      const api = ctx.$('api').value;
      ctx.setConnectionPhase('idle');
      if (api === '__add__') { ctx.$('custom-server-panel').hidden = false; ctx.$('custom-api').focus(); return; }
      ctx.$('custom-server-panel').hidden = true;
      ctx.fillSelect('workspace', ctx.readValue(`workspaces:${api}`, []), '', '请先连接', true);
      for (const id of ['default-project', 'task-project', 'default-label', 'task-label']) ctx.fillSelect(id, [], '', '请先连接');
      ctx.renderAgentChoices({ agent: '', defaultAgent: '' }, []);
      try {ctx.persistConnectionSettings();} catch(error) {ctx.message(error.message,'error');}
    });
    let tokenSaveTimer;
    const saveToken=()=>{clearTimeout(tokenSaveTimer);tokenSaveTimer=null;try{ctx.persistConnectionSettings();}catch(error){ctx.message(error.message,'error');}};
    ctx.$('token').addEventListener('input', () => {
      ctx.setConnectionPhase('idle');ctx.$('settings-save-state').textContent='正在保存…';
      clearTimeout(tokenSaveTimer);tokenSaveTimer=setTimeout(saveToken,300);
    });
    ctx.$('token').addEventListener('change', saveToken);
    window.addEventListener('pagehide',()=>{if(tokenSaveTimer) saveToken();});
    ctx.$('workspace').addEventListener('change', () => ctx.run(async () => {
      const workspace = ctx.$('workspace').value;
      ctx.config = { ...ctx.config, api: ctx.$('api').value, token: ctx.$('token').value, workspace, workspaceAlias:workspace ? ctx.$('workspace').selectedOptions[0]?.textContent || '' : '', project: '', projectAlias:'', defaultAgent: '', agent: '', label: '', projectCustomized:false, defaultAgentCustomized:false };
      ctx.persistConfig(ctx.config);
      for (const id of ['default-project','task-project','default-label','task-label']) ctx.fillSelect(id,[],'','请先选择工作区');
      ctx.renderAgentChoices({agent:'',defaultAgent:''},[]);
      if (!workspace) {ctx.message('默认工作区已清空并保存。','success');return;}
      const catalog = ctx.readValue(`catalog:${ctx.config.api}:${workspace}`, null);
      const workspaces = ctx.readValue(`workspaces:${ctx.config.api}`, null);
      if (needsCatalogRefresh(ctx.config, ctx.readValue(`connection-tag:${ctx.config.api}`, ''), workspaces, catalog))
        await ctx.loadWorkspaceData(validateConfig(ctx.config));
      else ctx.applyCatalog(ctx.config, catalog);
      ctx.config = { ...ctx.config, project: ctx.$('default-project').value, defaultAgent: ctx.$('default-agent').value,
        agent: ctx.$('agent').value, label: ctx.$('default-label').value };
      ctx.persistConfig(ctx.config);
      ctx.message('已切换工作区，相关选项已更新。', 'success');
    }));
    for (const id of ['default-project', 'default-label']) ctx.$(id).addEventListener('change', () => {
      const taskId = id === 'default-project' ? 'task-project' : 'task-label';
      if(id === 'default-project') {
        ctx.config.project=ctx.$(id).value;ctx.config.projectCustomized=true;ctx.$(taskId).value=ctx.$(id).value;
        try{ctx.persistConfig({...ctx.config});ctx.message('默认项目已保存。','success');}catch{ctx.message('默认项目保存失败。','error');}
      }
      else if(ctx.$('task-label').dataset.userEdited !== 'true') ctx.applyTaskDefaultLabel(ctx.taskDraft ? ctx.taskDraft.profile : ctx.activeProfile);
      if (id === 'default-label') {
        ctx.config.label = ctx.$(id).value;
        try { ctx.persistConfig({ ...ctx.config }); ctx.message('默认标签已保存。', 'success'); }
        catch (error) { ctx.message('默认标签保存失败。', 'error'); }
      }
    });
    ctx.$('hide-native-ai').addEventListener('change', () => { ctx.config.hideNativeAI = ctx.$('hide-native-ai').checked; ctx.setNativeAIVisibility(ctx.config.hideNativeAI); try { ctx.persistConfig({ ...ctx.config }); ctx.message(ctx.config.hideNativeAI ? '已隐藏 BugDone 原有 AI 按钮。' : '已显示 BugDone 原有 AI 按钮。', 'success'); } catch (e) { ctx.message('AI 按钮显示设置保存失败。', 'error'); } });
    for (const [id, mode] of [['mode-sidebar', 'sidebar'], ['mode-floating', 'floating']]) ctx.$(id).onclick = () => {
      ctx.applyPanelMode(mode);
      try { ctx.persistConfig({ ...ctx.config }); ctx.message(`已切换为${mode === 'sidebar' ? '侧边栏' : '浮窗'}模式。`, 'success'); }
      catch (e) { ctx.message('主面板显示样式保存失败。', 'error'); }
    };
    ctx.$('reset-preferences').onclick=()=>ctx.$('reset-preferences-dialog').showModal();
    ctx.$('cancel-reset-preferences').onclick=()=>ctx.$('reset-preferences-dialog').close();
    ctx.$('confirm-reset-preferences').onclick=()=>{
      ctx.$('reset-preferences-dialog').close();
      void ctx.run(()=>{
        clearTimeout(tokenSaveTimer);ctx.persistConnectionSettings();
        const verified=ctx.readValue(`connection-tag:${ctx.config.api}`,'')===connectionCacheTag(ctx.config.api,ctx.config.token);
        const workspaces=verified ? ctx.readValue(`workspaces:${ctx.config.api}`,[]) || [] : [];
        const first=workspaces.find(item=>item?.id && item.is_archived!==true);
        const cached=first ? ctx.readValue(`catalog:${ctx.config.api}:${first.id}`,{}) || {} : {};
        const catalog={projects:cached.projects || [],agents:cached.agents || [],labels:cached.labels || []};
        const next=restorePreferenceDefaults(ctx.config,workspaces,catalog);
        ctx.persistConfig(next);ctx.config=next;
        ctx.fillSelect('workspace',workspaces,ctx.config.workspace,'请先连接');
        ctx.applyCatalog(ctx.config,catalog);ctx.$('hide-native-ai').checked=ctx.config.hideNativeAI;
        ctx.$('entry-visibility').value=ctx.config.entryVisibility;capturingShortcut=false;showShortcut();
        ctx.applyPanelMode(ctx.config.displayMode);ctx.setNativeAIVisibility(ctx.config.hideNativeAI);ctx.syncEntryVisibility();renderCaptureSettings();ctx.refreshCaptureRuntime(true);
        ctx.launchPosition=null;ctx.writeValue('launchPosition',null);
        for(const property of ['left','top','right','bottom']) launch.style.removeProperty(property);constrainLaunch('reset-preferences');
        if(!ctx.config.workspace) ctx.setConnectionPhase('idle');
        ctx.message('偏好已恢复默认；连接配置和用户数据已保留。','success');
      });
    };
    ctx.$('submit').onclick = () => ctx.run(ctx.submit);
    ctx.$('import').onclick = () => ctx.run(async () => {
      const text = ctx.$('json').value;
      if (!parseResponse(text).length) throw Error('未找到有效的 BugDone Bug 数据');
      ctx.collect(text); ctx.$('json').value = ''; ctx.switchTab('bug', true); ctx.message('响应已导入，请选择 Bug 核对预览。');
    });
    // 先恢复配置、绑定入口和设置事件，再渲染可能不完整的捕获记录。
    ctx.syncCaptureUI();
    ctx.renderProcessing();
    if (ctx.captureHookFailed) ctx.message('当前环境未能安装自动捕获。可在“Bug 详情”中使用“手动导入 BugDone 响应”继续操作。');
    if (!ctx.hasGMStorage) ctx.message('当前使用网页本地存储保存配置和处理列表。');
    if (ctx.storageFailed) ctx.message('浏览器存储不可用，请允许当前网站保存数据后刷新。');
    ctx.debug('界面挂载完成', { buttonConnected: host.isConnected, capturedBugs: ctx.bugs.size });
    requestAnimationFrame(() => {
      if (launch.hidden) { ctx.debug('入口按显示范围隐藏',{mode:ctx.config.entryVisibility}); return; }
      constrainLaunch('initial-layout');
      const rect = launch.getBoundingClientRect(), style = getComputedStyle(launch);
      const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      const visible = launch.isConnected && rect.width > 0 && rect.height > 0 && inViewport &&
        style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const topElement = visible ? document.elementFromPoint(x, y) : null;
      const covered = visible && topElement !== host && topElement !== launch;
      ctx.debug(visible && !covered ? '入口已显示' : '入口未显示或被遮挡', {
        buttonConnected: launch.isConnected, visible, inViewport, covered,
        position: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        viewport: { width: innerWidth, height: innerHeight }, zIndex: style.zIndex, connectionState: ctx.connectionPhase
      }, visible && !covered ? 'info' : 'warn');
    });
    if (ctx.config.token && ctx.config.api && entryShouldShow(ctx.config.entryVisibility,ctx.activeProfile)) void ctx.run(ctx.connectIfNeeded);
  };
}
