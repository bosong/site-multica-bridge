import { siteModeForUrl } from './capture/matching.js';
import { startApp } from './app.js';
if(typeof window!=='undefined' && siteModeForUrl(window.location.href)!=='unsupported') startApp();
