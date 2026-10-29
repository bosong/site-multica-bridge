import {installRouteHooks,installCaptureHooks} from './hooks.js';
import {matchSiteCapture} from '../capture/matching.js';
window.__multicaPageWorld ||= {
 capture(profile,channel) {window.__multicaCaptureStop?.();const hooks=installCaptureHooks(window,(value,meta)=>window.postMessage({channel,text:typeof value==='string'?value:JSON.stringify(value),meta},location.origin),(url,method)=>matchSiteCapture(profile,{url,method}));window.__multicaCaptureStop=hooks.stop;},
 routes(channel) {installRouteHooks(window,()=>window.dispatchEvent(new Event(channel)));}
};
