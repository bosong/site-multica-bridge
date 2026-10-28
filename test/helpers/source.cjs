// Compatibility view for legacy runtime-fragment tests. All text comes from current
// modules; core assertions execute the actual compiled module exports, not a v2 copy.
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=require('../../.generated/test-core.cjs');globalThis.__siteMulticaTestCore=core;
const parse=text=>acorn.parse(text,{ecmaVersion:2022,sourceType:'module'});
function exportedFunction(file){const text=read(file),node=parse(text).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='FunctionDeclaration').declaration;return {text,node};}
function factoryBody(file){const{text,node}=exportedFunction(file);const ret=node.body.body.findLast(n=>n.type==='ReturnStatement');return text.slice(node.body.start+1,ret.start).replace(/^(?=(?:async )?function )/gm,'  ');}
let app=read('src/app.js');const appFn=parse(app).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='startApp').declaration;app=app.slice(appFn.body.start+1,appFn.body.end-1);
app=app.replace(/\s*let siteMode=siteModeForUrl\(window\.location\.href\);/,'');
app=app.replace(/const storage=createStorage\([\s\S]*?const \{readValue,writeValue\}=storage;/,()=>factoryBody('src/platform/storage.js'));
app=app.replace(/const network=createNetwork\([\s\S]*?const \{[^}]+\}=network;/,()=>factoryBody('src/multica/network.js'));
const htmlFile=read('src/shared/html.js'),htmlNode=parse(htmlFile).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='htmlText').declaration;
const htmlFunction='  '+htmlFile.slice(htmlNode.start,htmlNode.end);
app=app.replace(/const attachments=createAttachments\([\s\S]*?const \{[^}]+\}=attachments;/,()=>factoryBody('src/attachments/service.js')+'\n'+htmlFunction);
app=app.replace(/storage\.mode/g,'storageMode').replace(/storage\.failed/g,'storageFailed').replace(/storage\.hasGMStorage/g,'hasGMStorage').replace(/storage\.hasNativeStorage/g,'hasNativeStorage');
const mounted=exportedFunction('src/ui/mount.js');const ret=mounted.node.body.body.find(n=>n.type==='ReturnStatement');let mount=mounted.text.slice(ret.argument.start,ret.argument.end).replace(/\bctx\./g,'');
const markup='<style>\n'+read('src/ui/styles.css')+'</style>\n'+read('src/ui/panel.html');mount=mount.replace('root.innerHTML = createPanelMarkup(SCRIPT_VERSION);',()=> 'root.innerHTML = `'+markup+'`;');
app=app.replace(/const mount=createMount\(\{[\s\S]*?\n  \}\);/,()=>mount);
// The template source has no independent runtime version; package.json is canonical.
app=app.replace('  const DEBUG = true;',()=>`  const DEBUG = true;\n  const SCRIPT_VERSION = '${require('../../package.json').version}';`);
const coreFiles=read('src/core/index.js').matchAll(/from '([^']+)'/g);let raw='';for(const match of coreFiles){raw+='\n'+read(path.posix.normalize('src/core/'+match[1])).replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/^(?=(?:async )?function )/gm,'  ');}
const meta=read('src/userscript.meta.txt').replaceAll('__VERSION__',require('../../package.json').version);
exports.source=meta+'\n(() => {\n const { '+Object.keys(core).join(',')+' }=globalThis.__siteMulticaTestCore;\n'+app+'\n})();\n'+raw;
exports.core=core;
