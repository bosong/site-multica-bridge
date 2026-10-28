const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');

test('站点配置是设置之后的独立 Tab，控件只属于该面板', () => {
  const navigation = source.slice(source.indexOf('<nav class="tabs"'), source.indexOf('</nav>'));
  const names = [...navigation.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(names, ['bug', 'multica', 'processing', 'settings', 'profiles']);
  assert.match(navigation, /id="tab-profiles"[^>]*aria-controls="view-profiles"[^>]*>站点配置</);

  const settings = source.slice(source.indexOf('<section id="view-settings"'), source.indexOf('</section>', source.indexOf('<section id="view-settings"')));
  const profiles = source.slice(source.indexOf('<section id="view-profiles"'), source.indexOf('</section>', source.indexOf('<section id="view-profiles"')));
  assert.doesNotMatch(settings, /id="(?:profile-list|profile-json)"/);
  assert.match(settings,/id="capture-sites"/);
  assert.doesNotMatch(profiles,/启用友盟 APM 崩溃捕获/);
  assert.match(profiles, /role="tabpanel" aria-labelledby="tab-profiles"/);
  for (const id of ['profile-list', 'profile-json', 'save-profile', 'toggle-profile', 'export-profile', 'test-profile', 'delete-profile']) {
    assert.match(profiles, new RegExp(`id="${id}"`));
    assert.equal(source.match(new RegExp(`id="${id}"`, 'g')).length, 1);
  }
});

test('配置页展示三个内置站点、合成模板和字段说明', () => {
  assert.match(source, /id="use-profile-template"/);
  assert.match(source, /id="profile-field-guide"/);
  assert.match(source, /id="open-bugdone-profile"/);
  assert.match(source, /id="open-umeng-profile"/);
  assert.match(source, /id="open-github-profile"/);
  assert.match(source, /id="umeng-profile-state"/);
  for (const field of ['schemaVersion', 'allowedOrigins', 'pages', 'captures', 'record', 'draft', 'dedup', 'attachments', 'postActions']) {
    assert.match(source, new RegExp(`<dt>${field}</dt>`));
  }
});

test('模板控件只在新建配置时启用，已有内置及自定义配置保持禁用',()=>{
 const start=source.indexOf('    const renderProfileSelection=()=>{'),end=source.indexOf('    const persistProfile=',start);
 const fields=Object.fromEntries(['profile-list','profile-json','profile-template-mode','use-profile-template','profile-response-test','profile-feedback'].map(id=>[id,{}]));
 const render=new Function('$','selectedProfile','renderProfileLabel',source.slice(start,end)+'return renderProfileSelection;')(id=>fields[id],()=>fields['profile-list'].value ? {id:fields['profile-list'].value}:null,()=>{});
 for(const value of ['builtin:bugdone','custom-site','']){
  fields['profile-list'].value=value;render();
  assert.equal(fields['profile-template-mode'].disabled,!!value);assert.equal(fields['use-profile-template'].disabled,!!value);
 }
});
test('已有配置即使直接触发模板处理函数也不会清空JSON或切换到新建',()=>{
 const start=source.indexOf("    $('use-profile-template').onclick="),end=source.indexOf("    $('save-profile').onclick",start);
 const fields={'profile-list':{value:'builtin:bugdone'},'profile-json':{value:'existing-json'},'use-profile-template':{disabled:true}};
 new Function('$','renderProfileSelection',source.slice(start,end))(id=>fields[id],()=>{throw Error('must not reset existing profile');});
 fields['use-profile-template'].onclick();assert.equal(fields['profile-list'].value,'builtin:bugdone');assert.equal(fields['profile-json'].value,'existing-json');
});
