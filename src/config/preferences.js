import { DEFAULT_SHORTCUT } from './constants.js';

export function shortcutFromEvent(event) {
    const key = String(event.key || '').toUpperCase();
    if (!/^[A-Z0-9]$/.test(key) || !(event.altKey || event.ctrlKey || event.metaKey)) return '';
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.metaKey && 'Meta', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
  }

export function shortcutMatches(event, shortcut) { return !!shortcut && shortcutFromEvent(event) === shortcut; }

export function capturePreferences(value = {}) {
    return {captureEnabled:value.captureEnabled!==false,defaultImageMode:value.defaultImageMode==='original'?'original':'compressed',
      defaultLogMode:value.defaultLogMode==='full'?'full':'summary',autoCaptureAttachments:value.autoCaptureAttachments!==false};
  }

export function nextDraftAttachments(current, candidates, {previousKey,key,include}) {
    return previousKey===key ? [...current] : include ? [...candidates] : [];
  }

export function restorePreferenceDefaults(saved, workspaces = [], catalog = {}) {
    const first = list => (Array.isArray(list) ? list : []).find(item=>item?.id && item.is_archived!==true);
    const workspace=first(workspaces),project=workspace && first(catalog.projects),agent=workspace && first(catalog.agents);
    return {...capturePreferences({captureEnabled:saved.captureEnabled}),api:saved.api,token:saved.token,umengCaptureEnabled:saved.umengCaptureEnabled ?? true,
      workspace:workspace?.id || '',workspaceAlias:workspace?.name || '',project:project?.id || '',projectAlias:project?.name || '',
      defaultAgent:agent?.id || '',agent:agent?.id || '',label:'',hideNativeAI:true,showDrawerHandle:true,displayMode:'floating',entryVisibility:'configured',
      shortcut:DEFAULT_SHORTCUT,shortcutCustomized:false,projectCustomized:false,defaultAgentCustomized:false};
  }

export function normalizeShortcutConfig(saved) {
    return saved.shortcut === 'Alt+Shift+M' && saved.shortcutCustomized !== true
      ? { ...saved, shortcut: DEFAULT_SHORTCUT } : saved;
  }
