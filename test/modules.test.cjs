const {test}=require('node:test');const assert=require('node:assert/strict');
test('源ES模块可直接加载并保持核心身份、偏好和草稿接口',async()=>{
 const core=await import('../src/core/index.js');assert.ok(Object.keys(core).length>=100);
 const [bug]=core.parseResponse({Result:1,ReturnObj:{BugId:'b'.repeat(32),ProjectId:'a'.repeat(32),BugTitle:'合成模块测试',BugCode:42}},core.BUGDONE_PROFILE,{sourceUrl:'https://www.bugdone.cn/cn/bugManagement_'+'a'.repeat(32)});
 assert.equal(core.buildCapturedDraft(bug.captureRecord,core.BUGDONE_PROFILE).sourceKey,'bugdone:'+'a'.repeat(32)+':'+'b'.repeat(32));
 assert.equal(core.capturePreferences({}).defaultLogMode,'summary');
});
test('真实存储模块仍跨站使用相同GM键，保留存储模式',async()=>{
 const {createStorage}=await import('../src/platform/storage.js');const shared=new Map();const deps={window:{},GM_getValue:(k,d)=>shared.has(k)?shared.get(k):d,GM_setValue:(k,v)=>shared.set(k,v)};
 const first=createStorage(deps),second=createStorage(deps);first.writeValue('config',{token:'synthetic'});assert.deepEqual(second.readValue('config',{}),{token:'synthetic'});assert.ok(shared.has('bugdone-multica:config'));assert.equal(first.mode,'油猴脚本存储');
});
test('真实请求工厂在无GM时使用原生桥，保留身份头和401状态通知',async()=>{
 const {createNetwork}=await import('../src/multica/network.js');const calls=[],phases=[];
 const client=createNetwork({window:{FastlaneNativeNetwork:{request:async options=>{calls.push(options);return{status:401,url:options.url,body:'{}'};}}},setConnectionPhase:phase=>phases.push(phase),fetch:()=>{throw Error('must prefer native bridge');}});
 const result=await client.request({api:'https://api.example.test',workspace:'workspace',token:'synthetic'})('GET','/api/issues');
 assert.equal(result.status,401);assert.equal(calls[0].headers.Authorization,'Bearer synthetic');assert.equal(calls[0].headers['X-Workspace-ID'],'workspace');assert.deepEqual(phases,['error']);
});
test('真实附件模块通过原生桥上传文本，不下载任何外链',async()=>{
 const {createAttachments}=await import('../src/attachments/service.js');const requests=[];
 const attachments=createAttachments({window:{FastlaneNativeNetwork:{request:async options=>{requests.push(options);return {status:200,body:JSON.stringify({id:'attachment-demo'})};}}},gmCall:()=>{throw Error('GM unavailable');}});
 const id=await attachments.uploadLocalAttachment({api:'https://api.example.test',token:'synthetic',workspace:'workspace'},{name:'demo.txt',content:'synthetic',mimeType:'text/plain'});
 assert.equal(id,'attachment-demo');assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.example.test/api/upload-file');
});
test('真实存储模块迁移旧原生命名空间且无存储时保留内存回退',async()=>{
 const {createStorage}=await import('../src/platform/storage.js');const writes=[];
 const native=createStorage({window:{FastlaneNativeStorage:{getValue:(ns,key,d)=>ns==='local.bugdone.multica'?{kept:true}:d,setValue:(ns,key,value)=>writes.push({ns,key,value})}}});
 assert.deepEqual(native.readValue('config',{}),{kept:true});assert.equal(writes[0].ns,'local.site.multica');assert.equal(writes[0].key,'bugdone-multica:config');
 const memory=createStorage({window:{}});memory.writeValue('config',{keep:true});assert.deepEqual(memory.readValue('config',{}),{keep:true});assert.equal(memory.mode,'页面内存缓存');
});
test('真实请求模块无GM/原生桥时保留fetch兼容通道',async()=>{
 const {createNetwork}=await import('../src/multica/network.js');const calls=[];
 const client=createNetwork({window:{},fetch:async(url,options)=>{calls.push({url,options});return{status:200,text:async()=>'{"items":[]}'};},location:{origin:'https://source.example.test'}});
 const result=await client.request({api:'https://api.example.test',token:'synthetic',workspace:''})('GET','/api/workspaces');assert.equal(result.status,200);assert.notEqual(calls[0].options.credentials,'include');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic');assert.equal(calls[0].options.redirect,'error');
});
