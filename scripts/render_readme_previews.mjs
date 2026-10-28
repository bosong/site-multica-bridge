/** Generate inert README preview pages from the current userscript's real markup.
 * node scripts/render_readme_previews.mjs /tmp/site-multica-readme-previews
 * Capture CSS viewports: task 1440×1100, profiles 1440×1400, sidebar 1520×1050 in Ego Lite.
 * All page content is synthetic. No userscript runtime or network API is started.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {BUILTIN_PROFILES,GITHUB_PROFILE} from '../src/sites/builtins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '/tmp/site-multica-readme-previews');
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const markup=('<style>'+await readFile(path.join(root,'src/ui/styles.css'),'utf8')+'</style>'+await readFile(path.join(root,'src/ui/panel.html'),'utf8')).replaceAll('${SCRIPT_VERSION}',version);
if(markup.includes('${')) throw Error('UI template added an interpolation; update the preview generator');

const css = `
*{box-sizing:border-box}body{margin:0;background:#edf2f8;color:#25334a;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
.preview-page{padding:58px 54px;width:calc(100% - 750px)}.preview-page.sidebar{width:calc(100% - 520px);padding:50px}
.kicker{font-size:12px;letter-spacing:2px;font-weight:700;color:#2563eb}.preview-page h1{font-size:38px;line-height:1.3;letter-spacing:-1.3px;margin:22px 0 16px;max-width:520px}.lead{font-size:15px;color:#68788e;line-height:1.9;max-width:520px}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}.pills span{font-size:12px;color:#466386;background:#fff;border:1px solid #dbe5f1;border-radius:30px;padding:8px 13px}
.example-card{margin-top:32px;border:1px solid #dce5ef;border-radius:16px;background:#fff;padding:25px;box-shadow:0 6px 24px #2f4b6a05}.example-card small{font-size:11px;letter-spacing:1px;color:#8c98a8}.example-card h2{font-size:17px;margin:12px 0;color:#33445a}.example-card p{font-size:13px;line-height:1.9;color:#718097}.example-card .tag{display:inline-block;padding:4px 9px;border-radius:7px;background:#eff6ff;color:#2563eb;font-size:11px}
.feature{display:flex;gap:14px;margin:24px 0;align-items:flex-start}.feature>b{font-size:12px;display:grid;place-items:center;background:#dfeafe;color:#2563eb;width:28px;height:28px;border-radius:50%;flex:none}.feature strong{font-size:14px;display:block;margin:3px 0 6px}.feature p{font-size:13px;line-height:1.8;color:#748297;margin:0}
.privacy-note{position:absolute;left:54px;bottom:34px;color:#8b98a8;font-size:12px;line-height:1.8}.sidebar .privacy-note{left:50px}.example-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px}.example-grid .example-card{margin:0;padding:22px}.preview-page.sidebar h1{max-width:none}.flow-line{height:1px;background:#dce5ee;margin:30px 0}.small-status{display:inline-flex;align-items:center;gap:7px;margin:14px 0;font-size:12px;color:#5f7891}.small-status:before{content:'';width:7px;height:7px;background:#22c55e;border-radius:50%}
`;

const demo = {
  title: '[演示] 筛选列表后保留已选条件',
  description: '演示任务 · 所有信息均为虚构\n\n现象：切换分页后，示例列表的筛选条件被重置。\n\n复现步骤\n1. 选择「待处理」，切换到第二页。\n2. 返回第一页，检查筛选项和结果。\n\n期望：保留筛选条件，正确展示对应结果。\n交付：说明根因、修复方案和验证结果。',
};

function fixture(mode) {
  const sidebar = mode === 'sidebar';
  const target = sidebar ? 'settings' : mode === 'profiles' ? 'profiles' : 'multica';
  const story = mode === 'profiles' ? `
    <div class="kicker">SITE → MULTICA BRIDGE / ${version}</div><h1>为不同网站<br>配置捕获规则</h1>
    <p class="lead">信息捕获、AI 任务创建、处理列表、设置、站点配置，五栏协同完成问题处理。</p>
    <div class="pills"><span>接口捕获</span><span>文本捕获</span><span>空白填写</span></div>
    <div class="example-card"><small>SOURCE CONFIGURATION · 内置与自定义</small><div class="feature"><b>1</b><div><strong>按站点启用或停用</strong><p>BugDone、友盟 APM、GitHub Issues 均提供内置规则。</p></div></div><div class="feature"><b>2</b><div><strong>配置字段映射与来源身份</strong><p>声明列表、详情接口与任务草稿模板，关联附件和查重键。</p></div></div><div class="feature"><b>3</b><div><strong>从模板添加更多网站</strong><p>选择「新建配置」后使用模板，核对后手动启用。</p></div></div></div>` : sidebar ? `
    <div class="kicker">SITE → MULTICA BRIDGE / ${version}</div><h1>抽屉展开，网页依然可用</h1>
    <p class="lead">侧边栏显示在右侧，原网页留在左侧。<br>在 UI 设置中切换显示方式、修改快捷键与管理页面入口。</p>
    <div class="pills"><span>侧边栏抽屉</span><span>浮窗模式</span><span>Ctrl + Shift + M</span></div>
    <div class="example-card"><small>SYNTHETIC WEBSITE · 示例网页</small><h2>问题列表</h2><p>这个区域代表被抽屉推开的原网页，仍然可以阅读和操作。</p><div class="small-status">示例工作区 · 仅作演示</div></div>
    <div class="example-grid"><div class="example-card"><span class="tag">DEMO-01</span><h2>筛选条件没有保留</h2><p>状态：待处理<br>来源：虚构示例页面</p></div><div class="example-card"><span class="tag">DEMO-02</span><h2>空状态提示待完善</h2><p>状态：处理中<br>来源：虚构示例页面</p></div></div>
    <div class="flow-line"></div><div class="feature"><b>↔</b><div><strong>设置随时调整</strong><p>显示样式与快捷键集中在「设置 → UI 设置」。</p></div></div>` : `
    <div class="kicker">SITE → MULTICA BRIDGE / ${version}</div><h1>从网页信息<br>到可执行的 AI 任务</h1>
    <p class="lead">捕获、核对、编辑，再交给智能体处理。<br>任务创建页显示的标题与内容，就是最终提交值。</p>
    <div class="pills"><span>BugDone</span><span>友盟 APM</span><span>GitHub Issues</span><span>手动选取</span></div>
    <div class="example-card"><small>AI TASK CREATION · 演示流程</small><div class="feature"><b>1</b><div><strong>核对与编辑内容</strong><p>可从捕获结果生成草稿，也可直接手动填写。</p></div></div><div class="feature"><b>2</b><div><strong>选择智能体与任务选项</strong><p>设置状态、优先级、项目、标签和日期。</p></div></div><div class="feature"><b>3</b><div><strong>预览附件，再创建任务</strong><p>先查重，再上传已选附件并关联到新任务。</p></div></div></div>`;
  const init = `
const shadow=document.getElementById('preview-host').attachShadow({mode:'open'});
shadow.innerHTML=${JSON.stringify(markup).replaceAll('<', '\\u003c')};
const $=id=>shadow.getElementById(id);
for(const image of shadow.querySelectorAll('img')) {image.removeAttribute('src');image.hidden=true;}
const setOption=(id,label)=>{const option=document.createElement('option');option.value='synthetic-demo';option.textContent=label;$(id).replaceChildren(option);};
for(const [id,label] of Object.entries({api:'Multica 官方 · https://api.multica.ai',workspace:'演示工作区', 'default-project':'演示项目', 'task-project':'演示项目','default-agent':'演示智能体',agent:'演示智能体','default-label':'演示标签','task-label':'演示标签'}))setOption(id,label);
$('panel').hidden=false;$('panel').dataset.display=${JSON.stringify(sidebar ? 'sidebar' : 'floating')};$('panel').dataset.open='true';
$('launch').setAttribute('aria-expanded','true');$('launch').querySelector('.launch-text').textContent='Multica-AI · 已连接';
for(const section of shadow.querySelectorAll('[role="tabpanel"]'))section.hidden=true;
$('view-'+${JSON.stringify(target)}).hidden=false;
for(const tab of shadow.querySelectorAll('[role="tab"]'))tab.setAttribute('aria-selected',String(tab.dataset.tab===${JSON.stringify(target)}));
$('bug-action-bar').hidden=true;$('message').textContent='演示界面 · 所有信息均为虚构，未提交真实任务。';
for(const id of ['hide-native-ai','capture-enabled','capture-auto-attachments','builtin-enable-bugdone','builtin-enable-umeng','builtin-enable-github'])$(id).checked=true;
for(const site of ${JSON.stringify(BUILTIN_PROFILES.map(p=>({name:p.metadata.name,domains:p.allowedOrigins.map(origin=>new URL(origin).hostname).join('、')})))}){
 const row=document.createElement('div');row.className='setting-row';
 const copy=document.createElement('div');copy.className='setting-copy';
 const title=document.createElement('strong');title.textContent=site.name;
 const description=document.createElement('small');description.textContent=site.domains;copy.append(title,description);
 const label=document.createElement('label');label.className='switch setting-control';label.setAttribute('aria-label','启用'+site.name+'捕获');
 const input=document.createElement('input');input.type='checkbox';input.checked=true;
 const track=document.createElement('span');track.className='switch-track';track.setAttribute('aria-hidden','true');label.append(input,track);row.append(copy,label);$('capture-sites').append(row);
}
for(const id of ['capture-image-compressed','capture-log-summary'])$(id).setAttribute('aria-pressed','true');
for(const id of ['capture-image-original','capture-log-full'])$(id).setAttribute('aria-pressed','false');
setOption('profile-list','内置 · GitHub Issues · 已启用');$('profile-json').value=${JSON.stringify(JSON.stringify(GITHUB_PROFILE,null,2))};
$('profile-feedback').textContent='示例：当前选择内置规则，模板仅在新建配置时可用。';$('shortcut').value='Ctrl + Shift + M';$('shortcut-description').textContent='在当前网页按 Ctrl + Shift + M 打开或关闭面板';
$('mode-sidebar').setAttribute('aria-pressed',${JSON.stringify(String(sidebar))});$('mode-floating').setAttribute('aria-pressed',${JSON.stringify(String(!sidebar))});
$('task-title').value=${JSON.stringify(demo.title)};$('task-description').value=${JSON.stringify(demo.description)};
$('task-source').textContent='https://issues.example.test/demo/01';$('task-priority').value='medium';
$('selected-attachments').innerHTML='<span class="attachment-item"><button class="attachment-open">▤ demo-steps.txt</button><button aria-label="移除演示附件">×</button></span>';
$('task-attachment-mode').textContent='演示附件 · 可点击预览、可移除';$('task-attachment-mode').hidden=false;
if(${JSON.stringify(sidebar)})requestAnimationFrame(()=>{const group=[...shadow.querySelectorAll('.settings-group')].find(el=>el.querySelector('h4')?.textContent==='UI 设置');const content=shadow.querySelector('.content');content.scrollTop=group.getBoundingClientRect().top-content.getBoundingClientRect().top+content.scrollTop-260;});
requestAnimationFrame(()=>requestAnimationFrame(()=>{document.documentElement.dataset.previewReady='true';}));
`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;"><title>Site Multica Bridge ${version} · 合成 UI 预览</title><style>${css}</style></head><body><main class="preview-page ${sidebar ? 'sidebar' : ''}">${story}<p class="privacy-note">模拟 UI · 根据当前 ${version} 界面生成<br>任务、配置、附件与网址均为合成数据。</p></main><div id="preview-host"></div><script>${init}</script></body></html>`;
}
await mkdir(out,{recursive:true});
for(const mode of ['task','sidebar','profiles'])await writeFile(path.join(out,mode+'.html'),fixture(mode));
console.log(JSON.stringify({version,output:out,pages:['task.html','sidebar.html','profiles.html']}));
