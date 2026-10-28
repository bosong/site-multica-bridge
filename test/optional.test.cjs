const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source=fs.readFileSync(require.resolve('../bugdone-multica.user.js'),'utf8');
const names=['manualDraftContext','buildManualDraft','buildTypedManualDraft','snapshotTaskDraft','validateStoredConfig','validateConfig','validateSiteProfile','buildCapturedDraft','buildIssueBody','PROFILE_TEMPLATE'];
const core=new Function('return '+source.slice(source.indexOf('(() => {'),source.indexOf('  // 调试桩：'))+
 `return {${names.map(n=>`${n}:typeof ${n}==='undefined'?undefined:${n}`).join(',')}};})();`)();

test('没有问题记录，手填标题和正文能生成独立手动草稿并保留真实内容',()=>{
 assert.equal(typeof core.buildTypedManualDraft,'function');
 const input={title:'手工填写的问题',description:'用户补充的详细说明',url:'https://issues.example.test/issues'};
 const draft=core.buildTypedManualDraft(input);
 assert.equal(draft.siteId,'manual');assert.equal(draft.sourceKey,'');assert.equal(draft.title,input.title);assert.equal(draft.description,input.description);
 assert.ok(draft.draftId);assert.deepEqual(draft.attachments,[]);
 assert.equal(core.buildTypedManualDraft({...input,previous:draft}).draftId,draft.draftId,'同一手填草稿再次点下一步不更换防重标识');
 assert.notEqual(core.buildTypedManualDraft({...input,description:'修改后的说明',previous:draft}).draftId,draft.draftId);
 assert.throws(()=>core.buildTypedManualDraft({...input,title:'  '}),/标题/);
 assert.throws(()=>core.buildTypedManualDraft({...input,description:'  '}),/描述/);
});
test('附件、后置动作、分享链接和显示名称均可省略或留空',()=>{
 const {attachments,postActions,...p}=structuredClone(core.PROFILE_TEMPLATE);
 const minimal=core.validateSiteProfile({...p,links:{},metadata:{name:''}});
 assert.deepEqual(minimal.attachments,[]);assert.deepEqual(minimal.postActions,[]);
 const empty=core.validateSiteProfile({...p,attachments:null,postActions:null,links:null});
 assert.deepEqual(empty.attachments,[]);assert.throws(()=>core.validateSiteProfile({...p,attachments:{}}),/附件/);
});
test('可选编号未提供时仍能生成任务标题和查重键',()=>{
 const p={...core.PROFILE_TEMPLATE,attachments:[],postActions:[]};
 const draft=core.buildCapturedDraft({siteId:p.id,scopeId:'project',recordId:'42',title:'模拟问题',descriptionText:'说明',detail:true},p);
 assert.match(draft.title,/模拟问题/);assert.doesNotMatch(draft.title,/undefined|null/);
 assert.equal(draft.sourceKey,'example-issues:project:42');
});
test('可选主动请求开关可以明确关闭，错误类型仍拒绝',()=>{
 const p=structuredClone(core.PROFILE_TEMPLATE);p.captures[0].requestOnPage=false;
 assert.equal(core.validateSiteProfile(p).captures[0].requestOnPage,false);
 p.captures[0].requestOnPage='false';assert.throws(()=>core.validateSiteProfile(p),/主动请求/);
});
test('允许保存未填写令牌和工作区的本地设置，真正提交仍要求完整配置',()=>{
 assert.equal(typeof core.validateStoredConfig,'function');
 const draft=core.validateStoredConfig({api:'https://api.multica.ai',token:'',workspace:'',project:'',defaultAgent:'',label:''});
 assert.equal(draft.token,'');assert.equal(draft.workspace,'');
 assert.throws(()=>core.validateConfig(draft),/Token|工作区/);
 assert.throws(()=>core.validateStoredConfig({...draft,api:'javascript:alert(1)'}),/HTTPS|根地址/);
});
test('项目、标签、开始和截止日期可空，默认状态和优先级可正常提交',()=>{
 const body=core.buildIssueBody({title:'标题',description:'描述',agent:'33333333-3333-4333-8333-333333333333',project:'',label:'',startDate:'',dueDate:'',status:'',priority:''});
 assert.equal(body.status,'todo');assert.equal(body.priority,'none');
 for(const key of ['project_id','label_ids','start_date','due_date','attachment_ids']) assert.equal(Object.hasOwn(body,key),false);
});

test('文本选取或空白手动草稿再次填写时，下一步使用当前输入而非旧草稿身份',async()=>{
 const begin=source.indexOf("    $('next').onclick = () => run(async () => {");
 const end=source.indexOf("    $('new-blank-task').onclick",begin);
 const execute=new Function('core','title','description','previous',`
 const {buildTypedManualDraft,snapshotTaskDraft,manualDraftContext}=core;
 const values=Object.fromEntries(['next','capture-record','capture-title','capture-description','task-title','task-description','task-source','task-attachment-mode'].map(id=>[id,{value:''}]));
 values['capture-title'].value=title;values['capture-description'].value=description;const $=id=>values[id];
 const siteMode='manual',bugs=new Map(),capturedRecords=new Map(),activeProfile=null,location={href:'https://example.test/page'};
 let activeDraft={siteId:'manual',draftId:'old-draft',title:'旧标题',description:'旧内容',attachments:[]},taskDraft=previous,selectedAttachments=[],attachmentDraftKey='';
 const run=fn=>fn(),renderSelectedAttachments=()=>{},message=()=>{},applyTaskDefaultLabel=()=>{},switchTab=()=>{};
 ${source.slice(begin,end)}
 return values.next.onclick().then(()=>taskDraft);`);
 const first=await execute(core,'新标题 A','新内容 A',null);
 assert.equal(first.title,'新标题 A');assert.equal(first.description,'新内容 A');assert.notEqual(first.draftId,'old-draft');
 const second=await execute(core,'新标题 B','新内容 B',first);
 assert.notEqual(second.draftId,first.draftId);
 assert.equal((await execute(core,'新标题 B','新内容 B',second)).draftId,second.draftId);
});

test('文本选取进入下一步保留原选取指纹，重复选取仍可提示可能重复',()=>{
 const sourceDraft=core.buildManualDraft({title:'网页标题',text:'合成选中文字',url:'https://example.test/page'});
 const input={title:sourceDraft.title,description:sourceDraft.description,url:sourceDraft.sourceUrl,sourceDraft};
 const task=core.buildTypedManualDraft(input);
 assert.equal(task.fingerprint,sourceDraft.fingerprint);
 assert.equal(core.buildTypedManualDraft({...input,previous:task}).fingerprint,sourceDraft.fingerprint);
 const edited=core.buildTypedManualDraft({...input,description:'手动改写内容',previous:task});
 assert.notEqual(edited.fingerprint,sourceDraft.fingerprint);
 assert.notEqual(edited.draftId,task.draftId);
});
