const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');

test('站点捕获配置是设置之后的独立 Tab，控件只属于该面板', () => {
  const navigation = source.slice(source.indexOf('<nav class="tabs"'), source.indexOf('</nav>'));
  const names = [...navigation.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(names, ['bug', 'multica', 'processing', 'settings', 'profiles']);
  assert.match(navigation, /id="tab-profiles"[^>]*aria-controls="view-profiles"[^>]*>站点捕获配置</);

  const settings = source.slice(source.indexOf('<section id="view-settings"'), source.indexOf('</section>', source.indexOf('<section id="view-settings"')));
  const profiles = source.slice(source.indexOf('<section id="view-profiles"'), source.indexOf('</section>', source.indexOf('<section id="view-profiles"')));
  assert.doesNotMatch(settings, /id="(?:profile-list|profile-json|enable-umeng)"/);
  assert.match(profiles, /role="tabpanel" aria-labelledby="tab-profiles"/);
  for (const id of ['enable-umeng', 'profile-list', 'profile-json', 'save-profile', 'toggle-profile', 'export-profile', 'test-profile', 'delete-profile']) {
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
