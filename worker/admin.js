// worker/admin.js — 文章を直すための管理画面（/admin）。
// 仕組み:
// - 入口は Cloudflare Access で守る。Worker 側でも Access の署名付きトークン（Cf-Access-Jwt-Assertion）を
//   検証し、正しいトークンがないリクエストは通さない（workers.dev など Access を通らない経路も塞ぐ）。
// - ページの HTML は GitHub の最新版を読み、保存は GitHub へのコミットとして記録する。
//   本番への反映は GitHub Actions（.github/workflows/deploy.yml）が main への push を受けて行う。
// - 設定（Worker の変数とシークレット）:
//     ACCESS_TEAM_DOMAIN  例: example.cloudflareaccess.com
//     ACCESS_AUD          Access アプリの Application Audience (AUD) タグ
//     GITHUB_TOKEN        シークレット。このリポジトリの Contents に読み書きできるトークン
//     GITHUB_REPO         省略時 kaznaritanaka-ctrl/pharmacist-hub
//     GITHUB_BRANCH       省略時 main
//   3つ（ACCESS_TEAM_DOMAIN / ACCESS_AUD / GITHUB_TOKEN）が揃うまで、本番では管理画面は開かない。
// - プレビュー（env.SOURCE_BASE がある）では、保存できない見本として開く。

export const EDITABLE = [
  { file: 'index.html', label: 'トップ' },
  { file: 'strategy.html', label: '1億円への戦略' },
  { file: 'simulator.html', label: '資産寿命シミュレータ' },
  { file: 'land.html', label: '土地の未来図' },
  { file: 'future.html', label: '薬剤師の将来とAI' },
  { file: 'about.html', label: '運営者について' },
  { file: 'privacy.html', label: 'プライバシーポリシー' },
  { file: 'contact.html', label: 'お問い合わせ' },
  { file: '404.html', label: 'ページが見つからないとき' },
];
const ALLOWED = new Set(EDITABLE.map((p) => p.file));
const MAX_BYTES = 600 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

const isLive = (env) => !!(env && env.GITHUB_TOKEN && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
const isDemo = (env) => !isLive(env) && !!(env && env.SOURCE_BASE);
const repoOf = (env) => (env && env.GITHUB_REPO) || 'kaznaritanaka-ctrl/pharmacist-hub';
const branchOf = (env) => (env && env.GITHUB_BRANCH) || 'main';

// ---- Cloudflare Access のトークン検証 ----
const b64urlBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
let certCache = { at: 0, issuer: '', keys: [] };

async function accessKeys(issuer) {
  if (certCache.issuer === issuer && Date.now() - certCache.at < 10 * 60 * 1000) return certCache.keys;
  const r = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!r.ok) return [];
  const data = await r.json();
  certCache = { at: Date.now(), issuer, keys: data.keys || [] };
  return certCache.keys;
}

export async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header; let payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const team = String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const issuer = `https://${team}`;
  if (payload.iss !== issuer) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 60)) return null;
  const jwk = (await accessKeys(issuer)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const allow = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(String(payload.email || '').toLowerCase())) return null;
  return { email: payload.email || '' };
}

// ---- GitHub ----
const toB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${repoOf(env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'fire-pharmacist-lab-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function readPage(env, file, load) {
  if (!isLive(env)) {
    const content = await load(file, env);
    return content === null ? null : { file, sha: null, content };
  }
  const r = await gh(env, `/contents/${encodeURIComponent(file)}?ref=${encodeURIComponent(branchOf(env))}`);
  if (!r.ok) return null;
  const data = await r.json();
  return { file, sha: data.sha, content: fromB64(data.content || '') };
}

async function savePage(env, body, who) {
  const { file, sha, content } = body || {};
  if (!ALLOWED.has(file)) return json({ error: 'このページは編集できません。' }, 400);
  if (typeof content !== 'string' || typeof sha !== 'string' || !sha) return json({ error: '保存する内容が正しくありません。' }, 400);
  if (new TextEncoder().encode(content).length > MAX_BYTES) return json({ error: 'ページが大きすぎます。' }, 400);
  if (!/<\/html>\s*$/i.test(content) || !/<body[\s>]/i.test(content)) return json({ error: 'ページの形が崩れているため保存しませんでした。' }, 400);
  const note = String(body.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  const label = (EDITABLE.find((p) => p.file === file) || {}).label || file;
  const message = `管理画面から文章を修正: ${label}${note ? `（${note}）` : ''}`;
  const r = await gh(env, `/contents/${encodeURIComponent(file)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toB64(content), sha, branch: branchOf(env) }),
  });
  if (r.status === 409 || r.status === 422) {
    return json({ error: 'GitHub 上でこのページが先に変更されていました。読み込み直してから、もう一度直してください。', conflict: true }, 409);
  }
  if (!r.ok) return json({ error: `GitHub への保存に失敗しました（${r.status}）。` }, 502);
  const data = await r.json();
  return json({
    ok: true,
    sha: data.content && data.content.sha,
    commitUrl: data.commit && data.commit.html_url,
    actionsUrl: `https://github.com/${repoOf(env)}/actions`,
    by: who ? who.email : '',
  });
}

function setupPage() {
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>管理画面は準備中です</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;line-height:1.8;color:#1b1f24">
<h1 style="font-size:20px">管理画面は準備中です</h1><p>入口の保護（Cloudflare Access）か、GitHub への保存の設定がまだ終わっていません。設定が揃うと、ここから文章を直せるようになります。</p></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const ADMIN_TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

// /admin 以下のリクエストを処理する。admin でなければ null を返す。
export async function handleAdmin(request, env, url, load) {
  const path = url.pathname;
  if (!(path === '/admin' || path.startsWith('/admin/'))) return null;

  let who = null;
  if (isLive(env)) {
    who = await verifyAccess(request, env);
    if (!who) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  } else if (!isDemo(env)) {
    return setupPage();
  }

  if (path.startsWith('/admin/api/')) {
    if (path === '/admin/api/config' && request.method === 'GET') {
      return json({ mode: isLive(env) ? 'live' : 'demo', pages: EDITABLE, repo: repoOf(env), branch: branchOf(env), user: who ? who.email : '' });
    }
    if (path === '/admin/api/page' && request.method === 'GET') {
      const file = url.searchParams.get('file') || '';
      if (!ALLOWED.has(file)) return json({ error: 'このページは編集できません。' }, 400);
      const page = await readPage(env, file, load);
      return page ? json(page) : json({ error: 'ページを読み込めませんでした。' }, 502);
    }
    if (path === '/admin/api/page' && request.method === 'POST') {
      if (!isLive(env)) return json({ error: 'プレビュー版なので保存はできません。' }, 403);
      if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403);
      if (!/application\/json/.test(request.headers.get('Content-Type') || '')) return json({ error: 'Bad request' }, 400);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
      return savePage(env, body, who);
    }
    return json({ error: 'Not found' }, 404);
  }

  // 画面のファイル: /admin → admin/index.html, /admin/app.js → admin/app.js
  const name = path === '/admin' || path === '/admin/' ? 'admin/index.html' : 'admin/' + path.slice('/admin/'.length);
  const ext = name.split('.').pop();
  const body = ADMIN_TYPES[ext] && /^admin\/[\w.-]+$/.test(name) ? await load(name, env) : null;
  if (body === null) return new Response('Not Found', { status: 404 });
  return new Response(body, {
    headers: {
      'Content-Type': ADMIN_TYPES[ext],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
