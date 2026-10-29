const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=require('./helpers/source.cjs').source;
const core=require('../.generated/test-core.cjs');
test('捕获偏好兼容旧配置并校验版本值',()=>{
 assert.equal(typeof core.capturePreferences,'function');
 assert.deepEqual(core.capturePreferences({}),{captureEnabled:true,defaultImageMode:'compressed',defaultLogMode:'summary',autoCaptureAttachments:true});
 assert.deepEqual(core.capturePreferences({captureEnabled:false,defaultImageMode:'original',defaultLogMode:'full',autoCaptureAttachments:false}),{captureEnabled:false,defaultImageMode:'original',defaultLogMode:'full',autoCaptureAttachments:false});
 assert.equal(core.capturePreferences({defaultImageMode:'invalid',defaultLogMode:'invalid'}).defaultImageMode,'compressed');
});
test('恢复偏好重置附件版本，保留暂停及站点启停旧配置',()=>{
 const result=core.restorePreferenceDefaults({api:'https://api.multica.ai',token:'',captureEnabled:false,umengCaptureEnabled:false,defaultImageMode:'original',defaultLogMode:'full',autoCaptureAttachments:false});
 assert.equal(result.captureEnabled,false);assert.equal(result.umengCaptureEnabled,false);assert.equal(result.defaultImageMode,'compressed');assert.equal(result.defaultLogMode,'summary');assert.equal(result.autoCaptureAttachments,true);
});
test('关闭自动关联的新草稿不带附件，同一草稿保留手动及原有附件，不受默认变更影响',()=>{
 assert.equal(typeof core.nextDraftAttachments,'function');const manual={name:'local.txt'},original={name:'source.png',original:true},incoming={name:'new.png'};
 assert.deepEqual(core.nextDraftAttachments([manual,original],[incoming],{previousKey:'old',key:'new',include:false}),[]);
 assert.deepEqual(core.nextDraftAttachments([manual,original],[incoming],{previousKey:'same',key:'same',include:false}),[manual,original]);
 assert.deepEqual(core.nextDraftAttachments([],[incoming],{previousKey:'old',key:'new',include:true}),[incoming]);
});
test('暂停会拆除监听并使旧响应失效，但保留已捕获记录和草稿',()=>{
 const a=source.indexOf('  function refreshCaptureRuntime('),b=source.indexOf('  // SPA redirects',a);
 const profile={id:'synthetic',enabled:true,captures:[]},draft={title:'保留草稿'};
 const result=new Function('profile','draft',`const config={captureEnabled:false},location={href:'https://example.test/list'},root=null,profileRegistry=()=>[profile],selectSiteProfile=()=>profile,syncCaptureUI=()=>{};let stopped=0,captureStops=[()=>stopped++],captureEpoch=1,observedCaptureContext='',observedProfileSignature=JSON.stringify(profile),activeProfile=profile,siteMode='custom',activeDraft=draft;const capturedRecords=new Map([['keep',{}]]),bugs=new Map(),umengState={};${source.slice(a,b)}refreshCaptureRuntime(true);return {stopped,epoch:captureEpoch,records:capturedRecords.size,draft:activeDraft};`)(profile,draft);
 assert.equal(result.stopped,1);assert.equal(result.epoch,2);assert.equal(result.records,1);assert.equal(result.draft,draft);
});
test('更改默认版本不会重置当前记录的选择，下一条记录才应用新默认',()=>{
 const a=source.indexOf('  function applyRecordCaptureDefaults('),b=source.indexOf('  function preview(',a);
 const result=new Function(`let config={defaultImageMode:'original',defaultLogMode:'full'},captureModeRecordKey='',bugImageMode='',umengStackMode='';const root=null;${source.slice(a,b)}applyRecordCaptureDefaults('first');config={defaultImageMode:'compressed',defaultLogMode:'summary'};applyRecordCaptureDefaults('first');const current=[bugImageMode,umengStackMode];applyRecordCaptureDefaults('second');return {current,next:[bugImageMode,umengStackMode]};`)();
 assert.deepEqual(result.current,['original','full']);assert.deepEqual(result.next,['compressed','summary']);
});
test('卡片启停只更改存储的启用状态，不丢未保存的配置JSON或切换编辑目标',()=>{
 const a=source.indexOf('    const persistProfile='),b=source.indexOf('    renderProfileList();renderProfileSelection();',a);
 const profile={id:'bugdone',metadata:{name:'BugDone'},enabled:true},fields={'profile-list':{value:'builtin:bugdone'},'profile-json':{value:JSON.stringify({id:'bugdone',metadata:{name:'未保存的编辑'},enabled:true})}},saved=[];
 new Function('profile','fields','saved',`const $=id=>fields[id],BUILTIN_PROFILES=[profile],profileRegistry=()=>[profile],writeValue=(key,value)=>saved.push([key,value]),refreshCaptureRuntime=()=>{},renderProfileList=value=>{fields['profile-list'].value=value;},renderProfileSelection=()=>{throw Error('must preserve editor');};let builtinOverrides={},customProfiles=[];${source.slice(a,b)}persistProfile({...profile,enabled:false},true,true);`)(profile,fields,saved);
 assert.equal(fields['profile-list'].value,'builtin:bugdone');assert.equal(JSON.parse(fields['profile-json'].value).metadata.name,'未保存的编辑');assert.equal(JSON.parse(fields['profile-json'].value).enabled,false);
 assert.equal(saved.find(([key])=>key==='builtinProfileOverrides')[1].bugdone.metadata.name,'BugDone');
});
