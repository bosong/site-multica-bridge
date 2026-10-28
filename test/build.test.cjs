const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {execFileSync}=require('node:child_process');const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('3.0可构建为唯一单文件，保留元数据及无外部模块依赖',()=>{
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,stdio:'pipe'});
 assert.ok(fs.existsSync(path.join(root,'site-multica.user.js')),'build must emit site-multica.user.js');
 assert.equal(fs.existsSync(path.join(root,'bugdone-multica.user.js')),false,'obsolete installation artifact must be removed');
 const script=fs.readFileSync(path.join(root,'site-multica.user.js'),'utf8');
 assert.ok(script.startsWith('// ==UserScript=='));assert.equal((script.match(/==UserScript==/g)||[]).length,1);assert.match(script,/@version\s+3\.0\.0/);
 for(const name of ['GM_xmlhttpRequest','GM_getValue','GM_setValue','unsafeWindow']) assert.ok(script.includes('// @grant        '+name));
 for(const key of ['updateURL','downloadURL']) assert.match(script,new RegExp('^// @'+key+'\\s+https://raw\\.githubusercontent\\.com/bosong/site-multica-bridge/main/site-multica\\.user\\.js$','m'));
 assert.equal(/\bimport\s*(?:\(|\{)|\brequire\s*\(|new Function\(|\beval\(/.test(script),false);new vm.Script(script);
 assert.equal(script.includes('/Users/songbo/'),false);
 const first=script;execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,stdio:'pipe'});assert.equal(fs.readFileSync(path.join(root,'site-multica.user.js'),'utf8'),first);
});
test('页面世界脚本独立执行，不依赖主bundle变量名',()=>{
 const code=fs.readFileSync(path.join(root,'.generated/page-world.txt'),'utf8');const window={};
 vm.runInNewContext(code,{window});assert.equal(typeof window.__multicaPageWorld.capture,'function');assert.equal(typeof window.__multicaPageWorld.routes,'function');
});
test('独立注入bundle可监听并停止真实fetch包装，不引用外部模块作用域',async()=>{
 const {BUGDONE_PROFILE}=await import('../src/core/index.js');const messages=[];let completed;const received=new Promise(resolve=>completed=resolve);
 const original=async()=>new Response('{"Result":1}',{headers:{'content-type':'application/json'}});
 const window={location:new URL('https://www.bugdone.cn/cn/bugManagement_'+'a'.repeat(32)),fetch:original,postMessage:data=>{messages.push(data);completed();}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'.generated/page-world.txt'),'utf8'),{window,location:window.location,URL,TextEncoder,TextDecoder,console,setTimeout,clearTimeout});
 window.__multicaPageWorld.capture(BUGDONE_PROFILE,'synthetic-channel');await window.fetch('https://www.bugdone.cn/Service/BugDone/BugAPI.ashx',{method:'POST'});await received;
 assert.equal(messages[0].channel,'synthetic-channel');assert.equal(messages[0].meta.sourceUrl,window.location.href);assert.equal(messages[0].text,'{"Result":1}');window.__multicaCaptureStop();assert.equal(window.fetch,original);
});
