import { BUILTIN_PROFILES } from '../sites/builtins.js';
import { shareURL } from '../sites/bugdone.js';
import { selectSiteProfile, locationOf } from '../capture/matching.js';
import { profileShareUrl } from '../capture/drafts.js';

export function submittedSourceUrl(item) {
    const safe = value => {
      const url = locationOf(value);
      return url?.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    };
    for (const value of [item?.detailUrl,item?.sourceUrl]) { const url=safe(value); if(url) return url; }
    const key = String(item?.sourceKey || '');
    let match = key.match(/^bugdone:([a-f\d]{32}):([a-f\d]{32})$/i);
    if (match) return shareURL({ProjectId:match[1],BugId:match[2]});
    match = key.match(/^umeng-apm-crash:([a-f\d]{24}):(\d{5,25})$/i);
    if (match) return `https://apm.umeng.com/platform/${match[1]}/error_analysis/crash/detail/${match[2]}`;
    match = key.match(/^github-issues:([^:]+):([1-9]\d*)$/);
    if (match) {
      try {
        const parts=decodeURIComponent(match[1]).split('/');
        if (parts.length===2 && parts.every(part=>/^[A-Za-z0-9_.-]+$/.test(part) && part!=='.' && part!=='..'))
          return `https://github.com/${parts.map(encodeURIComponent).join('/')}/issues/${match[2]}`;
      } catch (_) { /* 无法恢复身份时不猜测来源 */ }
    }
    return '';
  }

export function processingPageSite(url, profiles) {
    const parsed=locationOf(url);
    if(!parsed || parsed.protocol!=='https:') return {key:'unknown',label:'未识别来源'};
    const candidates=profiles.map(p=>({...p,enabled:true}));
    const profile=selectSiteProfile(profiles,url) || selectSiteProfile(candidates,url)
      || profiles.find(p=>p.enabled && p.allowedOrigins.includes(parsed.origin)) || candidates.find(p=>p.allowedOrigins.includes(parsed.origin));
    return profile ? {key:`profile:${profile.id}`,label:profile.metadata?.name || profile.id}
      : {key:`origin:${parsed.origin}`,label:parsed.hostname};
  }

export function processingItemSite(item, profiles) {
    const id=item.captureSiteId || (item.siteId && item.siteId!=='manual' ? item.siteId : '')
      || (item.bugId ? 'bugdone' : profiles.find(p=>item.sourceKey?.startsWith(p.id+':'))?.id);
    if(id) return {key:`profile:${id}`,label:profiles.find(p=>p.id===id)?.metadata?.name || item.captureSiteName || id};
    return processingPageSite(submittedSourceUrl(item),profiles);
  }

export function processingSiteView(items, profiles, url, selection, previousPageKey) {
    const page=processingPageSite(url,profiles),options=new Map([['all',{key:'all',label:'全部站点',count:items.length}]]);
    for(const profile of profiles) options.set(`profile:${profile.id}`,{key:`profile:${profile.id}`,label:profile.metadata?.name || profile.id,count:0});
    if(!options.has(page.key)) options.set(page.key,{...page,count:0});
    const grouped=items.map(item=>({item,site:processingItemSite(item,profiles)}));
    for(const {site} of grouped) {
      if(!options.has(site.key)) options.set(site.key,{...site,count:0});
      options.get(site.key).count++;
    }
    const selected=previousPageKey===page.key && options.has(selection) ? selection : page.key;
    return {pageKey:page.key,selected,options:[...options.values()],items:grouped.filter(x=>selected==='all' || x.site.key===selected).map(x=>x.item)};
  }

export function draftSourceDetailUrl(draft) {
    const profile=draft.profile || BUILTIN_PROFILES.find(p=>p.id===draft.siteId);
    const detailUrl=profile ? profileShareUrl(profile,{siteId:draft.siteId,scopeId:draft.scopeId,
      recordId:draft.recordId,number:draft.number}) : '';
    return submittedSourceUrl({detailUrl,sourceUrl:draft.sourceUrl,sourceKey:draft.sourceKey});
  }
