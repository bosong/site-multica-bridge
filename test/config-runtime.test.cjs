const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');
const names = ['validateSiteProfile','normalizeCapturedRecord','buildCapturedDraft','matchSiteCapture','matchProfilePage','resolveProfileLabel','selectSiteProfile','profileIdentityMatches','runProfilePostActions','snapshotTaskDraft','submitTaskOnce','chooseCapturedRecord','PROFILE_TEMPLATE','BUGDONE_PROFILE','GITHUB_PROFILE'];
const core = new Function('return ' + source.slice(source.indexOf('(() => {'), source.indexOf('  // 调试桩：')) +
 `return {${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',')}};})();`)();
const make = () => ({...structuredClone(core.PROFILE_TEMPLATE), schemaVersion:2, enabled:true,
 metadata:{name:'演示问题'}, defaultLabel:{mode:'none'},
 presentation:{recordLabel:'选择问题',hideSelectors:['#nativeAI'],drawerSelectors:['#detail']},
 attachments:[{id:'screens',kind:'image-url',path:'$.files',items:{url:'$.url',name:'$.name',filter:{path:'$.active',notEquals:false}},
 allowedOrigins:['https://cdn.example.test'],filenameTemplate:'issue-{{recordId}}.png',transform:{preset:'image',maxDimension:1600,quality:0.85}}]});

test('v2 数组附件和独立下载域不扩大捕获域；禁用附件过滤',()=>{
 const p=core.validateSiteProfile(make());
 const r=core.normalizeCapturedRecord(p,{projectId:'p',id:'42',number:42,title:'演示',files:[
 {url:'https://cdn.example.test/a.png',name:'one.png',active:true},
 {url:'https://cdn.example.test/b.png',name:'two.png',active:false},
 {url:'https://evil.test/a.png',name:'bad.png'}]},{kind:'detail'});
 assert.equal(r.attachments.length,1);assert.equal(r.attachments[0].name,'one.png');
 assert.deepEqual(r.attachments[0].allowedOrigins,['https://cdn.example.test']);
 assert.equal(r.attachments[0].transform.maxDimension,1600);
 assert.equal(core.matchSiteCapture(p,{url:'https://cdn.example.test/api/issues',method:'POST'}),null);
});
test('默认标签支持继承、明确无标签、绑定工作区的指定标签',()=>{
 const c={api:'https://api.multica.ai',workspace:'w1',label:'global'};
 assert.equal(typeof core.resolveProfileLabel,'function');
 assert.equal(core.resolveProfileLabel({},c).value,'global');
 assert.equal(core.resolveProfileLabel({defaultLabel:{mode:'none'}},c).value,'');
 assert.equal(core.resolveProfileLabel({defaultLabel:{mode:'fixed',id:'label',api:c.api,workspace:'w1'}},c).value,'label');
 assert.equal(core.resolveProfileLabel({defaultLabel:{mode:'fixed',id:'label',api:c.api,workspace:'w2'}},c).value,'');
 assert.ok(core.resolveProfileLabel({defaultLabel:{mode:'fixed',id:'label',api:c.api,workspace:'w2'}},c).warning);
});
test('参数路径在页面、接口均匹配，注册表按优先级选择且停用后退出',()=>{
 const p={...make(),priority:5}; const q={...make(),id:'other',priority:1};
 assert.equal(typeof core.selectSiteProfile,'function');
 assert.equal(core.selectSiteProfile([q,p],'https://issues.example.test/issues/42').id,p.id);
 assert.equal(core.selectSiteProfile([{...p,enabled:false}],'https://issues.example.test/issues/42'),null);
 assert.equal(core.matchProfilePage(p,'https://issues.example.test/issues/42').kind,'detail');
 const rule={...p.captures[0],path:'/issues/:id'};
 assert.equal(core.matchSiteCapture({...p,captures:[rule]},{url:'https://issues.example.test/issues/42',method:'POST'}).id,'issues');
});
test('身份规则拒绝跨仓库响应并约束详情编号',()=>{
 assert.equal(typeof core.profileIdentityMatches,'function');
 const p=core.GITHUB_PROFILE;
 const row={repoNameWithOwner:'team/repo',number:42,permalink:'https://github.com/team/repo/issues/42'};
 assert.equal(core.profileIdentityMatches(p,row,'https://github.com/team/repo/issues'),true);
 assert.equal(core.profileIdentityMatches(p,row,'https://github.com/other/repo/issues'),false);
 assert.equal(core.profileIdentityMatches(p,row,'https://github.com/team/repo/issues/43'),false);
});
test('草稿配置描述及分享链接；旧来源键稳定',()=>{
 const p={...make(),draft:{titleTemplate:'[问题] #{{number}} {{title}}',descriptionTemplate:'{{description}}\n分享：{{shareUrl}}'},
 links:{shareTemplate:'https://issues.example.test/preview/{{scopeId}}/{{recordId}}'}};
 core.validateSiteProfile(p);
 const r=core.normalizeCapturedRecord(p,{projectId:'p',id:'42',number:42,title:'演示',description:'<p>内容</p>'},{kind:'detail'});
 const d=core.buildCapturedDraft(r,p);
 assert.equal(d.sourceKey,'example-issues:p:42');assert.match(d.description,/分享：https:\/\/issues.example.test\/preview\/p\/42/);
 assert.match(d.description,/内容/);assert.match(d.description,/\[Source:example-issues:p:42\]/);
});
test('可信动作只在新建成功执行，停用/复用/错误来源均不能写回',async()=>{
 assert.equal(typeof core.runProfilePostActions,'function');
 let calls=0; const actions={'bugdone.start-processing':async()=>{calls++;return {kind:'started'};}};
 const p=core.BUGDONE_PROFILE, context={siteId:'bugdone',sourceUrl:'https://www.bugdone.cn/cn/bugManagement_x',bug:{BugId:'a'.repeat(32)}};
 await core.runProfilePostActions(p,{...context,existing:true},actions); assert.equal(calls,0);
 await core.runProfilePostActions({...p,enabled:false},context,actions); assert.equal(calls,0);
 await core.runProfilePostActions({...p,postActions:[]},context,actions);assert.equal(calls,0);
 await core.runProfilePostActions(p,{...context,sourceUrl:'https://evil.test'},actions);assert.equal(calls,0);
 await core.runProfilePostActions(p,context,actions);assert.equal(calls,1);
});
test('拒绝任意代码、任意回写动作和过大压缩参数',()=>{
 assert.throws(()=>core.validateSiteProfile({...make(),postActions:[{adapter:'fetch',url:'https://evil.test'}]}));
 const p=make();p.attachments[0].transform.maxDimension=99999;assert.throws(()=>core.validateSiteProfile(p));
});

test('卸载网络监听后不交付旧请求，恢复原 fetch',async()=>{
 const load = new Function('return '+source.slice(source.indexOf('(() => {'), source.indexOf('  // 调试桩：'))+'return {installCaptureHooks};})();')();
 let finish; const original=()=>new Promise(resolve=>{finish=resolve;});
 const page={fetch:original,location:{href:'https://issues.example.test/issues'}}; const received=[];
 const hooks=load.installCaptureHooks(page,(...args)=>received.push(args),()=>({id:'issues',maxResponseBytes:1000}));
 const pending=page.fetch('/api/issues');
 assert.equal(typeof hooks.stop,'function'); hooks.stop();
 finish({ok:true,clone:()=>({text:async()=>'{"ok":true}'})}); await pending;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(received.length,0);assert.equal(page.fetch,original);
});

test('可配置扩展字段进入正文模板，HTML 保留换行且不可覆盖来源身份',()=>{
 const p={...make(),record:{...make().record,fields:{product:'$.product.name',environment:'$.env'}},
 draft:{titleTemplate:'[问题] #{{number}} {{title}}',descriptionTemplate:'产品：{{product}}\n环境：{{environment}}\n{{description}}\n{{attachmentLinks}}'}};
 core.validateSiteProfile(p);
 const record=core.normalizeCapturedRecord(p,{projectId:'p',id:'42',number:42,title:'演示',product:{name:'演示产品'},env:'测试',description:'<p>步骤一</p><p>步骤二</p>'},{kind:'detail'});
 const draft=core.buildCapturedDraft(record,p);
 assert.match(draft.description,/产品：演示产品\n环境：测试/);
 assert.match(draft.description,/步骤一\n步骤二/);
 assert.throws(()=>core.validateSiteProfile({...p,record:{...p.record,fields:{recordId:'$.product.name'}}}),/扩展字段/);
});

test('站点指定标签必须是有效且绑定工作区的 UUID；缺省仍兼容 v1',()=>{
 const p=make(),label={mode:'fixed',id:'11111111-1111-4111-8111-111111111111',api:'https://api.multica.ai',workspace:'22222222-2222-4222-8222-222222222222'};
 assert.equal(core.validateSiteProfile({...p,defaultLabel:label}).defaultLabel.id,label.id);
 assert.throws(()=>core.validateSiteProfile({...p,defaultLabel:{...label,workspace:''}}),/标签/);
 assert.equal(core.validateSiteProfile({...p,schemaVersion:1,defaultLabel:undefined}).schemaVersion,1);
});

 test('任务草稿快照隔离后续捕获和配置修改，旧 BugDone 仍复用原缓存任务',async()=>{
 assert.equal(typeof core.snapshotTaskDraft,'function');
 const record={siteId:'bugdone',scopeId:'p',recordId:'a'.repeat(32),detail:true,sourceKey:'bugdone:p:'+ 'a'.repeat(32),title:'测试',description:'内容',attachments:[]};
 const bug={BugId:'a'.repeat(32),BugCode:42};
 const task=core.snapshotTaskDraft(record,core.BUGDONE_PROFILE,bug);
 record.recordId='other';core.BUGDONE_PROFILE.metadata.name='临时名称';bug.BugId='b'.repeat(32);
 assert.equal(task.recordId,'a'.repeat(32));assert.equal(task.profile.metadata.name,'BugDone');
 const requests=[];
 const result=await core.submitTaskOnce({c:{api:'https://api.multica.ai',workspace:'w'},draft:task,body:{title:'[BugDone:'+ 'a'.repeat(32)+'] 演示'},
 api:async(method,path)=>{requests.push([method,path]);return {status:200,data:{id:'existing',title:'[BugDone:'+ 'a'.repeat(32)+'] 演示'}};},
 get:()=>({id:'existing'}),set:()=>{throw Error('不应重写缓存');},prepareBody:()=>{throw Error('不应上传附件');}});
 assert.equal(result.existing,true);assert.deepEqual(requests,[['GET','/api/issues/existing']]);
 core.BUGDONE_PROFILE.metadata.name='BugDone';
});

 test('根页面和带通配符接口使用同样路径语义，通配符不能跨目录',()=>{
 const p={...make(),pages:[{kind:'list',path:'/'}],captures:[{...make().captures[0],path:'/api/issues-*'}]};
 core.validateSiteProfile(p);
 assert.equal(core.matchProfilePage(p,'https://issues.example.test/').kind,'list');
 assert.equal(core.matchSiteCapture(p,{url:'https://issues.example.test/api/issues-list',method:'POST'}).id,'issues');
 assert.equal(core.matchSiteCapture(p,{url:'https://issues.example.test/api/issues-list/other',method:'POST'}),null);
 });

test('BugDone 大写 ID 被归一化为旧查重与缓存使用的小写',()=>{
 const raw={ProjectId:'ABCDEF0123456789ABCDEF0123456789',BugId:'FEDCBA9876543210FEDCBA9876543210',BugTitle:'演示',BugCode:42};
 const record=core.normalizeCapturedRecord(core.BUGDONE_PROFILE,raw,{kind:'detail'});
 const draft=core.buildCapturedDraft(record,core.BUGDONE_PROFILE);
 assert.equal(record.recordId,'fedcba9876543210fedcba9876543210');
 assert.equal(record.scopeId,'abcdef0123456789abcdef0123456789');
 assert.match(draft.title,/ \[BugDone:fedcba9876543210fedcba9876543210\]$/);
});
test('BugDone 标题模板只能把兼容标记放在可查重边界',()=>{
 assert.throws(()=>core.validateSiteProfile({...core.BUGDONE_PROFILE,draft:{titleTemplate:'Task [BugDone:{{recordId}}] {{title}}'}}),/查重标记/);
 assert.equal(core.validateSiteProfile({...core.BUGDONE_PROFILE,draft:{titleTemplate:'[BugDone:{{recordId}}] {{title}}'}}).id,'bugdone');
});

test('BugDone 同时支持旧路径、实际列表路由和只读分享详情',()=>{
 for(const url of ['https://www.bugdone.cn/cn/bugManagement_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'https://www.bugdone.cn/cn/bugManagement/bug-all/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
 'https://bugdone.cn/cn/bugPreview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccc'])
 assert.ok(core.matchProfilePage(core.BUGDONE_PROFILE,url));
});

test('同一配置不能重复规则 ID，避免把响应交给错误解析器',()=>{
 const p=make();assert.throws(()=>core.validateSiteProfile({...p,captures:[p.captures[0],{...p.captures[0],path:'/api/other'}]}),/重复/);
 assert.throws(()=>core.validateSiteProfile({...p,attachments:[p.attachments[0],p.attachments[0]]}),/重复/);
});
test('文档中的配置可直接校验，合成样本可生成包含附件的草稿',()=>{
 const path=require('node:path');
 const directory=path.join(__dirname,'../doc/site-profiles');
 for(const file of fs.readdirSync(directory).filter(x=>x.endsWith('.json') && x!=='example-response.json'))
   core.validateSiteProfile(JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')));
 const p=JSON.parse(fs.readFileSync(path.join(directory,'example-issues.json'),'utf8'));
 const sample=JSON.parse(fs.readFileSync(path.join(directory,'example-response.json'),'utf8'));
 const r=core.normalizeCapturedRecord(p,sample.data.issue,{kind:'detail'}),d=core.buildCapturedDraft(r,p);
 assert.equal(d.sourceKey,'example-issues:demo-project:42');assert.equal(d.attachments.length,2);
});

test('用户手选记录优先于当前页面推荐记录，失效选择才回退',()=>{
 assert.equal(typeof core.chooseCapturedRecord,'function');
 const records=new Map([['42',{}],['43',{}]]);
 assert.equal(core.chooseCapturedRecord(records,{selected:'42',preferred:'42',manual:'43'}),'43');
 assert.equal(core.chooseCapturedRecord(records,{selected:'42',preferred:'missing',manual:'deleted'}),'42');
 assert.equal(core.chooseCapturedRecord(records,{selected:'42',preferred:'43'}),'43');
});
