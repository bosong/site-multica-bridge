import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rename,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {Script} from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const watching=process.argv.includes('--watch'),checking=process.argv.includes('--check');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
async function save(file,data){const destination=path.join(root,file);await mkdir(path.dirname(destination),{recursive:true});let old;try{old=await readFile(destination,'utf8');}catch{}if(old!==data){const temporary=destination+'.'+process.pid+'.tmp';try{await writeFile(temporary,data);await rename(temporary,destination);}finally{await rm(temporary,{force:true});}}}
export async function buildAll(){
 await save('.generated/version.js',`export const SCRIPT_VERSION = ${JSON.stringify(pkg.version)};\n`);
 const base={absWorkingDir:root,bundle:true,platform:'browser',format:'iife',target:'es2020',minify:false,keepNames:true,charset:'utf8',legalComments:'none',logLevel:'warning'};
 const page=await build({...base,entryPoints:['src/platform/page-world.js'],write:false});await save('.generated/page-world.txt',page.outputFiles[0].text);
 const banner=(await readFile(path.join(root,'src/userscript.meta.txt'),'utf8')).replaceAll('__VERSION__',pkg.version).trimEnd()+'\n';
 const result=await build({...base,entryPoints:['src/index.js'],loader:{'.css':'text','.html':'text','.txt':'text'},banner:{js:banner},write:false,metafile:true});
 const code=result.outputFiles[0].text;new Script(code);
 if(!code.startsWith('// ==UserScript==')||(code.match(/==UserScript==/g)||[]).length!==1)throw Error('Invalid userscript metadata');
 if(/\bimport\s*(?:\(|\{)|\brequire\s*\(|new Function\(|\beval\(/.test(code))throw Error('Runtime module loading is not allowed');
 if(code.includes(root))throw Error('Absolute build path leaked into release');
 if(checking){const current=await readFile(path.join(root,'bugdone-multica.user.js'),'utf8');if(current!==code)throw Error('Generated userscript is stale. Run npm run build.');}
 else await save('bugdone-multica.user.js',code);
 const core=await build({absWorkingDir:root,entryPoints:['src/core/index.js'],bundle:true,platform:'node',format:'cjs',target:'node22',write:false,logLevel:'warning'});
 await save('.generated/test-core.cjs',core.outputFiles[0].text);
 await save('.generated/metafile.json',JSON.stringify(result.metafile,null,2)+'\n');
 if(watching)await build({...base,entryPoints:['src/index.js'],loader:{'.css':'text','.html':'text','.txt':'text'},banner:{js:banner},sourcemap:'external',outfile:'.generated/dev/bugdone-multica.user.js'});
 console.log(`${checking?'Checked':'Built'} v${pkg.version}: bugdone-multica.user.js (${Buffer.byteLength(code)} bytes)`);
}
await buildAll();
if(watching){
 let running=false,signature='';
 async function fingerprint(directory){const entries=await readdir(directory,{withFileTypes:true});const values=await Promise.all(entries.map(async entry=>{const file=path.join(directory,entry.name);if(entry.isDirectory())return fingerprint(file);const info=await stat(file);return `${path.relative(root,file)}:${info.mtimeMs}:${info.size}`;}));return values.sort().join('|');}
 async function currentSignature(){const info=await stat(path.join(root,'package.json'));return await fingerprint(path.join(root,'src'))+`|package:${info.mtimeMs}:${info.size}`;}
 signature=await currentSignature();
 setInterval(async()=>{if(running)return;running=true;try{const next=await currentSignature();if(next!==signature){signature=next;const updated=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));pkg.version=updated.version;await buildAll();}}catch(error){console.error(error.message);}finally{running=false;}},750);
 console.log('Watching src/ and package.json (polling, 750 ms); press Ctrl+C to stop.');
}
