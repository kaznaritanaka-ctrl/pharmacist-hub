// worker/index.js — FIRE薬剤師ラボの配信 Worker
// - 人間向け: HTML をそのまま返す。
// - AIエージェント向け: 各ページの Markdown 版を返す（/strategy.md のように拡張子を .md に、
//   または Accept: text/markdown で HTML と同じ URL を取得）。/llms.txt はサイトの索引、
//   /llms-full.txt は全ページの Markdown をまとめたもの。
// ファイルの中身は tools/build.mjs が ASSETS に埋め込む（本番）。プレビューでは env.SOURCE_BASE から読む。

import { handleAdmin } from './admin.js';

/* __ASSETS__ */

const SITE = 'https://pharma.ai-investment-research.net';
const PAGES = ['index.html', 'strategy.html', 'simulator.html', 'land.html', 'future.html', 'about.html', 'privacy.html', 'contact.html'];
const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', md: 'text/markdown; charset=utf-8',
};

async function load(name, env) {
  if (typeof ASSETS !== 'undefined' && ASSETS) return ASSETS[name] ?? null;
  if (!env || !env.SOURCE_BASE) return null;
  const r = await fetch(env.SOURCE_BASE + name, { cf: { cacheTtl: 60 } });
  return r.ok ? await r.text() : null;
}

// ---- HTML → Markdown（このサイトのマークアップ専用の小さな変換器） ----
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
const abs = (href) => (href.startsWith('/') ? SITE + href : href.startsWith('#') ? href : href);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };

export function htmlToMarkdown(html, path) {
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  const desc = decode((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  let s = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/) || [])[1] || '';
  // 取り除くもの: 装飾・重複・未提携の広告枠・スクリプト
  s = s.replace(/<(script|style|svg|button)[\s\S]*?<\/\1>/g, '')
    .replace(/<aside class="rail"[\s\S]*?<\/aside>/g, '')
    .replace(/<details class="toc-inline">[\s\S]*?<\/details>/g, '')
    .replace(/<aside class="ad[^"]*is-pending[^"]*"[\s\S]*?<\/aside>/g, '')
    .replace(/<span class="(?:go|n|dots)"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<p class="fallback">[\s\S]*?<\/p>/g, '')
    .replace(/<span class="arr"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<nav class="breadcrumb[\s\S]*?<\/nav>/g, '')
    .replace(/<span class="ad-label">[\s\S]*?<\/span>(?=\s*<span class="ad-title">|\s*<div class="ad-creative">)/g, '')
    .replace(/<div class="tool-frame-bar"[\s\S]*?<\/div>/g, '')
    .replace(/<li><b>([^<]*)<\/b>/g, '<li><b>$1</b>：')
    .replace(/<p class="sec-label[\s\S]*?<\/p>/g, '')
    .replace(/<a class="index-row" href="([^"]*)"[^>]*>[\s\S]*?<h3>([\s\S]*?)<small>([\s\S]*?)<\/small><\/h3><p>([\s\S]*?)<\/p>[\s\S]*?<\/a>/g, '<h3><a href="$1">$2</a>（$3）</h3><p>$4</p>')
    .replace(/<li class="map-item[^"]*">/g, '\n')
    .replace(/<\/span><span class="note">/g, ' — ')
    .replace(/<small>([^<]*)<\/small> — /g, '$1 — ')
    .replace(/<\/span><span>/g, ' · ')
    .replace(/<li>(?=<a class="index-row")/g, '')
    .replace(/<(h[1-3])([^>]*)>([\s\S]*?)<\/\1>/g, (m, t, a, inner) => `<${t}${a}>${inner.replace(/<br[^>]*>/g, ' ')}</${t}>`)
    .replace(/<span class="badge"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<span class="no">(\d+)<\/span>/g, '$1. ')
    .replace(/<small[^>]*>([\s\S]*?)<\/small>/g, '（$1）')
    .replace(/<p class="footer-word"[\s\S]*?<\/p>/g, '');
  // 提携済みの広告は PR と明示して残す
  s = s.replace(/<aside class="ad[^"]*"[^>]*>/g, '\n\n> **PR（広告）** ').replace(/<\/aside>/g, '\n\n');
  s = s.replace(/<img[^>]*\balt="([^"]*)"[^>]*>/g, '$1');
  s = s.replace(/<iframe[^>]*src="([^"]*)"[^>]*title="([^"]*)"[^>]*><\/iframe>/g, '\n\n[ツール: $2]($1)\n\n');
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (m, a, text) => {
    const href = attr(' ' + a, 'href'); const t = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!href || !t || attr(' ' + a, 'aria-disabled') === 'true') return t;
    const rel = attr(' ' + a, 'rel') || '';
    return `[${t}](${abs(href)})${/sponsored/.test(rel) ? '（PR）' : ''}`;
  });
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, '\n\n# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, '\n\n## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, '\n\n### $1\n\n')
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/g, '\n\n### $1\n\n')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '$1')
    .replace(/<br[^>]*>/g, '\n')
    .replace(/<li[^>]*>/g, '\n- ').replace(/<\/li>/g, '')
    .replace(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g, '\n- **$1**: $2')
    .replace(/<\/(p|div|section|ul|ol|dl|details|nav|header|article)>/g, '\n\n')
    .replace(/<[^>]+>/g, '');
  s = decode(s).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/^-\s*$/gm, '').replace(/\)\[/g, ') [').replace(/\n{3,}/g, '\n\n')
    .replace(/^(- .*)\n\n(?=- )/gm, '$1\n').replace(/^(- .*)\n\n(?=- )/gm, '$1\n').trim();
  return `---\ntitle: ${title}\nurl: ${SITE}${path}\ndescription: ${desc}\nsite: FIRE薬剤師ラボ (${SITE}/)\n---\n\n${s}\n`;
}

const pageFor = (p) => (p === '/' || p === '/index' ? 'index.html' : p.slice(1));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const base = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'public, max-age=300',
    };
    if (env && env.SOURCE_BASE) base['X-Robots-Tag'] = 'noindex'; // プレビューは検索に載せない
    const send = (body, type, extra = {}) => new Response(body, { headers: { ...base, 'Content-Type': type, ...extra } });

    // 管理画面（文章の修正）。Access の検証は handleAdmin の中で行う。
    const admin = await handleAdmin(request, env, url, load);
    if (admin) return admin;

    // 全ページまとめ（AIエージェント向け）
    if (path === '/llms-full.txt') {
      const parts = [];
      for (const f of PAGES) { const h = await load(f, env); if (h) parts.push(htmlToMarkdown(h, f === 'index.html' ? '/' : '/' + f)); }
      return send(parts.join('\n\n---\n\n'), TYPES.txt);
    }
    // Markdown 版: /strategy.md, /index.md
    if (path.endsWith('.md')) {
      const f = path === '/index.md' ? 'index.html' : path.slice(1, -3) + '.html';
      const h = PAGES.includes(f) ? await load(f, env) : null;
      if (h) return send(htmlToMarkdown(h, f === 'index.html' ? '/' : '/' + f), TYPES.md);
    }
    // 拡張子なしのURLも受ける（/strategy → strategy.html）
    let file = pageFor(path);
    if (!/\.[a-z]+$/.test(file)) file += '.html';
    const ext = file.split('.').pop();
    const body = TYPES[ext] ? await load(file, env) : null;
    if (body === null) {
      const nf = await load('404.html', env);
      return new Response(nf || 'Not Found', { status: 404, headers: { ...base, 'Content-Type': TYPES.html } });
    }
    if (ext === 'html') {
      const canonical = file === 'index.html' ? '/' : '/' + file;
      const md = file === 'index.html' ? '/index.md' : '/' + file.replace(/\.html$/, '.md');
      const accept = request.headers.get('Accept') || '';
      const wantsMd = /text\/markdown/.test(accept) && !/text\/html/.test(accept);
      if (wantsMd) return send(htmlToMarkdown(body, canonical), TYPES.md, { Vary: 'Accept' });
      return send(body, TYPES.html, { Vary: 'Accept', Link: `<${md}>; rel="alternate"; type="text/markdown"` });
    }
    return send(body, TYPES[ext]);
  },
};
