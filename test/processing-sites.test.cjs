const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=require('./helpers/source.cjs').source;
const core=require('../.generated/test-core.cjs');
const profiles=[core.BUGDONE_PROFILE,core.GITHUB_PROFILE],bug={bugId:'b'.repeat(32)},github={siteId:'github-issues'},manual={siteId:'manual',sourceUrl:'https://github.com/example/repo/issues/42'},unknown={siteId:'manual'},other={siteId:'manual',sourceUrl:'https://docs.example.test/topic'};
const items=[bug,github,manual,unknown,other],bugUrl='https://www.bugdone.cn/cn/bugManagement_'+'a'.repeat(32);
test('当前站点默认筛选，兼容旧BugDone和配置站点的手动来源记录',()=>{
 assert.equal(typeof core.processingSiteView,'function');
 const view=core.processingSiteView(items,profiles,bugUrl,'','');assert.equal(view.selected,'profile:bugdone');assert.deepEqual(view.items,[bug]);
 const gh=core.processingSiteView(items,profiles,'https://github.com/example/repo/issues','','');assert.deepEqual(gh.items,[github,manual]);assert.equal(gh.options.find(o=>o.key==='profile:github-issues').count,2);
});
test('同站路由变化保留手选范围，切换站点优先关联新站点',()=>{
 assert.equal(typeof core.processingSiteView,'function');
 const view=core.processingSiteView(items,profiles,bugUrl,'profile:github-issues','profile:bugdone');assert.deepEqual(view.items,[github,manual]);
 const next=core.processingSiteView(items,profiles,'https://github.com/example/repo/issues/42',view.selected,view.pageKey);assert.equal(next.selected,'profile:github-issues');
 const back=core.processingSiteView(items,profiles,bugUrl,'all',next.pageKey);assert.equal(back.selected,'profile:bugdone');
});
test('全部站点、未配置网页与历史已删除配置均可查看且不丢记录',()=>{
 assert.equal(typeof core.processingSiteView,'function');
 assert.equal(core.processingSiteView(items,profiles,bugUrl,'all','profile:bugdone').items.length,5);
 const view=core.processingSiteView([...items,{captureSiteId:'removed',captureSiteName:'旧站点',siteId:'manual'}],profiles,'https://docs.example.test/topic','','');assert.deepEqual(view.items,[other]);assert.ok(view.options.some(o=>o.label==='旧站点'));assert.ok(view.options.some(o=>o.key==='unknown'));
 const empty=core.processingSiteView([],profiles,bugUrl,'','');assert.equal(empty.selected,'profile:bugdone');assert.equal(empty.items.length,0);
});
test('停用站点仍能按来源查看历史记录，文本配置按保存的配置身份归类',()=>{
 assert.equal(typeof core.processingSiteView,'function');
 const text={...core.BUGDONE_PROFILE,id:'text-site',captureMode:'text',enabled:false,metadata:{name:'文本来源'},allowedOrigins:['https://docs.example.test'],pages:[{kind:'manual',path:'/**'}]};
 const record={siteId:'manual',captureSiteId:text.id,captureSiteName:'文本来源',sourceUrl:'https://docs.example.test/page'};
 assert.deepEqual(core.processingSiteView([record],[text],'https://docs.example.test/page','','').items,[record]);
 const disabled={...text,allowedOrigins:['https://github.com'],priority:99};
 assert.equal(core.processingSiteView([github],[core.GITHUB_PROFILE,disabled],'https://github.com/example/repo/issues','','').selected,'profile:github-issues');
});

test('状态刷新只查询当前站点，查询中切换站点后自动刷新新列表',async()=>{
 const start=source.indexOf('  async function refreshProcessingStatuses('),end=source.indexOf('  function mount()',start);
 const calls=[];let release;const first=new Promise(resolve=>{release=resolve;});
 const load=async items=>{calls.push(items);if(calls.length===1)await first;};
 const env=new Function('loadSubmittedStatuses','connectionCacheTag',`let processingRefreshPromise=null,processingRefreshAt=0,processingRefreshContext='',processingSiteSelection='profile:bugdone';const processingStates=new WeakMap();let processingRows=new Map();const fields={api:{value:'https://api.multica.ai'},workspace:{value:'workspace'},token:{value:'token'},'refresh-processing':{disabled:false}};const $=id=>fields[id],settings=()=>({api:fields.api.value,workspace:'workspace',token:'token'}),request=()=>()=>{},setProcessingStatus=()=>{};${source.slice(start,end)}return {refresh:refreshProcessingStatuses,set:(item,site)=>{processingRows=new Map([[item,{dataset:{},isConnected:true}]]);processingSiteSelection=site;}};`)(load,core.connectionCacheTag);
 env.set(bug,'profile:bugdone');const pending=env.refresh();env.set(github,'profile:github-issues');const next=env.refresh();release();await Promise.all([pending,next]);assert.deepEqual(calls,[[bug],[github]]);
});
test('删除缺少来源标识的旧记录不误删其他站点，同源不同API记录也保留',()=>{
 const start=source.indexOf('  function forgetSubmitted('),end=source.indexOf('  const hiddenSiteElements=',start);
 const run=new Function('items','target',`let submittedBugs=items;const writeValue=()=>{},debug=()=>{};${source.slice(start,end)}forgetSubmitted(target);return submittedBugs;`);
 const rows=[{siteId:'bugdone',bugId:'a'},{siteId:'manual',issueId:'one'},{siteId:'github-issues',issueId:'two'}];
 assert.deepEqual(run(rows,rows[1]),[rows[0],rows[2]]);
 const apiRows=[{sourceKey:'same',workspace:'same',api:'https://one.test'},{sourceKey:'same',workspace:'same',api:'https://two.test'}];
 assert.deepEqual(run(apiRows,apiRows[0]),[apiRows[1]]);
});
