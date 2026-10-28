const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=require('./helpers/source.cjs').source;
const names=['validateSiteProfile','matchProfilePage','matchSiteCapture','selectSiteProfile','entryShouldShow','buildPageCaptureDraft','PAGE_TEXT_TEMPLATE','PAGE_BLANK_TEMPLATE','BUGDONE_PROFILE','GITHUB_PROFILE'];
const core=require('../.generated/test-core.cjs');
const profile=mode=>({schemaVersion:2,id:'example-page',version:1,enabled:true,captureMode:mode,allowedOrigins:['https://docs.example.test'],pages:[{kind:'manual',path:'/**'}]});
test('缺省只在配置页面显示，all/shortcut 可覆盖，失效配置不显示',()=>{
 assert.equal(typeof core.entryShouldShow,'function');
 assert.equal(core.entryShouldShow(undefined,null),false);assert.equal(core.entryShouldShow(undefined,core.GITHUB_PROFILE),true);
 assert.equal(core.entryShouldShow('all',null),true);assert.equal(core.entryShouldShow('shortcut',core.GITHUB_PROFILE),false);
 assert.equal(core.entryShouldShow('configured',{...core.GITHUB_PROFILE,enabled:false}),false);
 assert.equal(core.entryShouldShow('invalid',null),false);
});
test('文本/空白配置不需要接口和业务身份字段，旧 API 配置保持兼容',()=>{
 for(const mode of ['text','blank']){const p=core.validateSiteProfile(profile(mode));assert.deepEqual(p.captures,[]);assert.deepEqual(p.attachments,[]);assert.deepEqual(p.postActions,[]);}
 assert.equal(core.validateSiteProfile(core.GITHUB_PROFILE).id,'github-issues');
 assert.throws(()=>core.validateSiteProfile({...profile('wrong')}),/捕获方式/);
 assert.throws(()=>core.validateSiteProfile({...profile('text'),captures:core.GITHUB_PROFILE.captures}),/文本|空白/);
 assert.throws(()=>core.validateSiteProfile({...profile('text'),postActions:[{adapter:'bugdone.start-processing',enabled:true}]}),/文本|空白/);
});
test('轻量配置可匹配整站或指定页面，GitHub非Issues页面仍不匹配',()=>{
 const p=core.validateSiteProfile(profile('text'));
 assert.ok(core.matchProfilePage(p,'https://docs.example.test/a/b/c'));assert.ok(core.matchProfilePage(p,'https://docs.example.test/'));
 assert.equal(core.matchProfilePage(p,'https://other.example.test/a'),null);
 assert.equal(core.matchProfilePage(core.GITHUB_PROFILE,'https://github.com/cli/cli'),null);
 assert.equal(core.matchSiteCapture(p,{url:'https://docs.example.test/api/data',method:'GET'}),null);
 const scoped={...p,pages:[{kind:'manual',path:'/docs/:id'}]};assert.equal(core.selectSiteProfile([scoped],'https://docs.example.test/home'),null);
});
test('文本模板只用显式选区生成可编辑手动草稿，不生成业务身份或附件',()=>{
 assert.equal(typeof core.buildPageCaptureDraft,'function');
 const p=core.validateSiteProfile({...profile('text'),draft:{titleTemplate:'阅读：{{pageTitle}}',descriptionTemplate:'链接：{{pageUrl}}\n正文：{{selectedText}}'}});
 const draft=core.buildPageCaptureDraft(p,{title:'演示文档',url:'https://docs.example.test/read/1',text:'用户主动选择的文字'});
 assert.equal(draft.title,'阅读：演示文档');assert.equal(draft.description,'链接：https://docs.example.test/read/1\n正文：用户主动选择的文字');
 assert.equal(draft.siteId,'manual');assert.equal(draft.sourceKey,'');assert.deepEqual(draft.attachments,[]);assert.ok(draft.draftId);
 assert.throws(()=>core.validateSiteProfile({...profile('text'),draft:{titleTemplate:'{{cookie}}'}}),/模板/);
 assert.throws(()=>core.buildPageCaptureDraft(p,{title:'演示',url:'https://evil.example/',text:'text'}),/页面|站点/);
});
test('空白模板不自动填充页面正文；参考模板可直接校验',()=>{
 const draft=core.buildPageCaptureDraft(core.validateSiteProfile(profile('blank')),{title:'网页标题',url:'https://docs.example.test/',text:''});
 assert.equal(draft.title,'');assert.equal(draft.description,'');assert.equal(draft.sourceUrl,'https://docs.example.test/');
 assert.equal(core.validateSiteProfile(core.PAGE_TEXT_TEMPLATE).captureMode,'text');assert.equal(core.validateSiteProfile(core.PAGE_BLANK_TEMPLATE).captureMode,'blank');
});

test('轻量配置再次编辑可保存；已有 API 身份和捕获类别不能被改写',()=>{
 const name='assertProfileIdentityUnchanged';
 const helper=require('../.generated/test-core.cjs')[name];
 assert.equal(typeof helper,'function');
 const old=core.validateSiteProfile(profile('text')),next=core.validateSiteProfile({...profile('text'),draft:{titleTemplate:'新：{{pageTitle}}'}});
 assert.doesNotThrow(()=>helper(old,next));assert.doesNotThrow(()=>helper(old,core.validateSiteProfile(profile('blank'))));
 assert.throws(()=>helper(core.GITHUB_PROFILE,{...core.GITHUB_PROFILE,record:{...core.GITHUB_PROFILE.record,recordId:'$.other'}}),/身份/);
 assert.throws(()=>helper(core.GITHUB_PROFILE,next),/身份|类别/);
});

test('编辑中的轻量草稿跨页面保留时，来源和默认标签仍属于原捕获配置',()=>{
 const helper=require('../.generated/test-core.cjs').manualDraftContext;
 assert.equal(typeof helper,'function');
 const old=core.validateSiteProfile({...profile('text'),defaultLabel:{mode:'none'}});
 const draft=core.buildPageCaptureDraft(old,{title:'页面A',url:'https://docs.example.test/docs/a',text:'原选区'});
 const current=core.validateSiteProfile({...profile('blank'),id:'another-blank'});
 const context=helper(draft,current,'https://docs.example.test/blank');
 assert.equal(context.url,'https://docs.example.test/docs/a');assert.equal(context.profile.id,'example-page');assert.equal(context.profile.defaultLabel.mode,'none');
 assert.equal(helper(null,current,'https://docs.example.test/blank').url,'https://docs.example.test/blank');
});

test('轻量草稿编辑后切入同站 API 页面，真实下一步仍携带旧草稿来源',async()=>{
 const start=source.indexOf("    $('next').onclick = () => run(async () => {");const end=source.indexOf("    $('new-blank-task').onclick",start);
 const helpers=require('../.generated/test-core.cjs');
 const result=await new Function('helpers',`
 const {capturePreferences,manualDraftContext,buildTypedManualDraft,snapshotTaskDraft}=helpers;
 const values=Object.fromEntries(['next','capture-record','capture-title','capture-description','task-title','task-description','task-source','task-attachment-mode','source-attachments'].map(id=>[id,{value:''}]));
 values['capture-title'].value='页面A的编辑';values['capture-description'].value='页面A的内容';const $=id=>values[id];
 const config={},siteMode='custom',bugs=new Map(),capturedRecords=new Map(),activeProfile={id:'api-b'},location={href:'https://docs.example.test/issues'};
 let activeDraft={siteId:'manual',sourceUrl:'https://docs.example.test/docs/a',captureProfile:{id:'text-a',captureMode:'text'},title:'页面A',description:'原内容'},taskDraft=null,selectedAttachments=[],attachmentDraftKey='';
 const run=fn=>fn(),renderSelectedAttachments=()=>{},message=()=>{},applyTaskDefaultLabel=()=>{},switchTab=()=>{};
 ${source.slice(start,end)}
 return values.next.onclick().then(()=>taskDraft);`)(helpers);
 assert.equal(result.sourceUrl,'https://docs.example.test/docs/a');assert.equal(result.profile.id,'text-a');
});

test('主动捕获的选区在锚点变化时保留，不被自动空选区模板替换',()=>{
 const capture=source.slice(source.indexOf('  function captureSelection()'),source.indexOf('  async function readRemotePreviewText'));
 const preview=source.slice(source.indexOf('  function renderPageCapturePreview()'),source.indexOf('  function syncCaptureUI()'));
 const p=core.validateSiteProfile(profile('text'));
 const result=new Function('buildPageCaptureDraft','profile',`
 const values=Object.fromEntries(['capture-title','capture-description','capture-state'].map(id=>[id,{value:'',dataset:{generated:'true'}}]));const $=id=>values[id];
 const activeProfile=profile,root={},document={title:'演示页面'},window={getSelection:()=>({})},location={href:'https://docs.example.test/docs/a'},selectedVisibleText=()=> '显式选取的文字';
 let activeDraft=null,pagePreviewContext='';const renderCaptureAttachments=()=>{},message=()=>{},submittedBugs=[],config={};
 ${capture}\n${preview}
 captureSelection();const body=values['capture-description'].value;location.href+='#section';renderPageCapturePreview();
 return{body,after:values['capture-description'].value,source:activeDraft.sourceUrl};`)(core.buildPageCaptureDraft,p);
 assert.equal(result.after,result.body);assert.match(result.after,/显式选取的文字/);assert.equal(result.source,'https://docs.example.test/docs/a');
});
