import { safeURL } from '../sites/bugdone.js';

export function captureHtmlText(html) {
    if (typeof html !== 'string') return '';
    if (typeof DOMParser !== 'undefined') return htmlText(html).slice(0, 20000);
    return html.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  }

export function htmlText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,iframe,object').forEach(x => x.remove());
    doc.querySelectorAll('img').forEach(x => {
      const url = safeURL(x.getAttribute('src'));
      x.replaceWith(doc.createTextNode(url ? `\n[内嵌图片](${url})\n` : ''));
    });
    doc.querySelectorAll('br').forEach(x => x.replaceWith(doc.createTextNode('\n')));
    doc.querySelectorAll('p,div,li').forEach(x => x.appendChild(doc.createTextNode('\n')));
    return doc.body.textContent.trim();
  }
