/* app.js — 管理画面: ページの文章をその場で直して、GitHub に保存する。
   方針:
   - 元の HTML を「タグ」と「文章」に切り分け、文章の部分だけを差し替える。タグや装飾、広告コードは触らない。
   - 直した文章と同じ文言がページ内のほかの場所（目次、構造化データなど）にもあれば、一緒に直す。
   - メニュー・フッターなど全ページ共通の部分は、ここでは直さない（ページごとに食い違うのを防ぐ）。 */
(function () {
  'use strict';

  // ---------- 純粋な処理（テストしやすいよう DOM に依存しない） ----------
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', middot: '·', hellip: '…', mdash: '—', ndash: '–', yen: '¥', times: '×', rarr: '→', larr: '←' };
  function decode(s) {
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function jsonInner(s) { return JSON.stringify(s).slice(1, -1); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var SKIP = { script: 1, style: 1, svg: 1, noscript: 1, iframe: 1, textarea: 1, button: 1, select: 1, template: 1 };

  // body の中の「文章」の位置を順番に取り出す
  function segment(src) {
    var segs = [];
    var bodyStart = src.search(/<body[\s>]/i);
    var bodyEnd = src.lastIndexOf('</body>');
    if (bodyStart < 0 || bodyEnd < 0) return segs;
    var re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/g;
    re.lastIndex = bodyStart;
    re.exec(src); // <body ...> 自体
    var last = re.lastIndex;
    var skip = 0;
    var m;
    function push(a, b) {
      var raw = src.slice(a, b);
      if (raw.trim()) segs.push({ start: a, end: b, raw: raw, text: decode(raw) });
    }
    while ((m = re.exec(src)) && m.index < bodyEnd) {
      if (!skip && m.index > last) push(last, m.index);
      var tag = (m[1] || '').toLowerCase();
      if (SKIP[tag]) {
        if (m[0][1] === '/') skip = Math.max(0, skip - 1);
        else if (!/\/>$/.test(m[0])) skip++;
      }
      last = re.lastIndex;
    }
    if (!skip && bodyEnd > last) push(last, bodyEnd);
    return segs;
  }

  function readMeta(src) {
    var t = src.match(/<title>([\s\S]*?)<\/title>/);
    var d = src.match(/<meta name="description" content="([^"]*)"/);
    return { titleRaw: t ? t[1] : null, descRaw: d ? d[1] : null, title: t ? decode(t[1]) : '', desc: d ? decode(d[1]) : '' };
  }

  // 構造化データ（JSON-LD）の中の文言を置き換える
  function replaceInJsonLd(src, from, to, whole) {
    if (!from || from === to) return src;
    var needle = whole ? '"' + jsonInner(from) + '"' : jsonInner(from);
    var repl = whole ? '"' + jsonInner(to) + '"' : jsonInner(to);
    return src.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, function (m, a, body, c) {
      return a + body.split(needle).join(repl) + c;
    });
  }

  // edits: { 段落番号: 新しい文章 }、meta: { title, desc }（変えないときは null）
  function apply(src, segs, edits, meta) {
    var out = src;
    var idx = Object.keys(edits).map(Number).sort(function (a, b) { return b - a; });
    idx.forEach(function (i) {
      var s = segs[i];
      var lead = s.raw.match(/^\s*/)[0];
      var trail = s.raw.match(/\s*$/)[0];
      var body = edits[i].replace(/^\s+|\s+$/g, '');
      out = out.slice(0, s.start) + lead + esc(body) + (body ? trail : '') + out.slice(s.end);
    });
    // 本文の変更を構造化データ（FAQ など）にも反映
    idx.forEach(function (i) {
      var from = segs[i].text.trim();
      var to = edits[i].trim();
      if (from && to) out = replaceInJsonLd(out, from, to, true); // 値がまるごと同じ文言のときだけ（見出し・FAQ など）
    });
    var cur = readMeta(src);
    if (meta && meta.title != null && meta.title !== cur.title && cur.titleRaw != null) {
      out = out.replace('<title>' + cur.titleRaw + '</title>', function () { return '<title>' + esc(meta.title) + '</title>'; });
      out = out.replace(new RegExp('(<meta (?:property|name)="(?:og|twitter):title" content=")' + escRe(cur.titleRaw) + '"', 'g'), function (m, a) { return a + escAttr(meta.title) + '"'; });
      out = replaceInJsonLd(out, cur.title, meta.title, true);
    }
    if (meta && meta.desc != null && meta.desc !== cur.desc && cur.descRaw != null) {
      out = out.replace(new RegExp('(<meta (?:property|name)="(?:description|og:description|twitter:description)" content=")' + escRe(cur.descRaw) + '"', 'g'), function (m, a) { return a + escAttr(meta.desc) + '"'; });
      out = replaceInJsonLd(out, cur.desc, meta.desc, true);
    }
    return out;
  }

  var Core = { decode: decode, esc: esc, segment: segment, readMeta: readMeta, apply: apply };
  if (typeof window === 'undefined') { globalThis.AdminCore = Core; return; }

  // ---------- 画面 ----------
  var $ = function (s) { return document.querySelector(s); };
  var LOCKED = '.sidebar, .topbar, .site-footer, .anchor-ad';
  var state = { config: null, file: '', sha: null, src: '', segs: [], edits: {}, meta: { title: null, desc: null }, labels: {}, spans: {} };

  function toast(html, isErr, ms) {
    var t = $('#toast');
    t.innerHTML = html;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.className = 'toast'; }, ms || 3200);
  }
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }
  function dirtyCount() {
    var n = Object.keys(state.edits).length;
    if (state.meta.title !== null) n++;
    if (state.meta.desc !== null) n++;
    return n;
  }
  function textOf(s) { return s.length > 120 ? s.slice(0, 118) + '…' : s; }

  function changeList() {
    var items = [];
    var cur = readMeta(state.src);
    if (state.meta.title !== null) items.push({ where: 'タイトル', before: cur.title, after: state.meta.title });
    if (state.meta.desc !== null) items.push({ where: '説明文', before: cur.desc, after: state.meta.desc });
    Object.keys(state.edits).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      items.push({ where: state.labels[i] || '本文', before: state.segs[i].text.trim(), after: state.edits[i].trim(), seg: i });
    });
    return items;
  }
  function renderList(el, items, withJump) {
    el.innerHTML = '';
    if (!items.length) { el.innerHTML = '<li class="empty">まだ変更はありません。</li>'; return; }
    items.forEach(function (it) {
      var li = document.createElement('li');
      if (withJump && it.seg != null) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'jump'; b.textContent = '場所を見る';
        b.onclick = function () { var sp = state.spans[it.seg] && state.spans[it.seg][0]; if (sp) { sp.scrollIntoView({ block: 'center', behavior: 'smooth' }); sp.focus(); } };
        li.appendChild(b);
      }
      var w = document.createElement('span'); w.className = 'where'; w.textContent = it.where; li.appendChild(w);
      var d = document.createElement('del'); d.textContent = textOf(it.before) || '（空）'; li.appendChild(d);
      var n = document.createElement('ins'); n.textContent = textOf(it.after) || '（削除）'; li.appendChild(n);
      el.appendChild(li);
    });
  }
  function refresh() {
    var n = dirtyCount();
    $('#count').textContent = n ? '変更 ' + n + ' 件' : '変更なし';
    $('#count').classList.toggle('has', n > 0);
    $('#review').disabled = n === 0;
    $('#reset').disabled = n === 0;
    renderList($('#changes'), changeList(), true);
  }

  function whereLabel(el) {
    if (el.closest('h1')) return '大見出し';
    if (el.closest('h2, h3, summary')) return '見出し';
    if (el.closest('.ad')) return '広告の説明';
    if (el.closest('li, dd, dt')) return 'リスト';
    if (el.closest('.hero, .page-hero')) return '冒頭';
    return '本文';
  }

  function textNodes(doc) {
    var out = [];
    var w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.data.trim()) return NodeFilter.FILTER_REJECT;
        for (var p = n.parentNode; p && p !== doc.body; p = p.parentNode) {
          if (SKIP[p.nodeName.toLowerCase()]) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }

  function onEdit(sp) {
    var i = Number(sp.dataset.seg);
    var val = sp.textContent;
    var orig = state.segs[i].text;
    // 同じ文言の場所（目次など）にも同じ変更を映す
    var twins = state.twins[i] || [i];
    twins.forEach(function (j) {
      (state.spans[j] || []).forEach(function (other) { if (other !== sp && other.textContent !== val) other.textContent = val; });
      if (val === orig) delete state.edits[j]; else state.edits[j] = val;
      (state.spans[j] || []).forEach(function (s) { s.classList.toggle('__chg', val !== orig); });
    });
    refresh();
  }

  function setupFrame(src) {
    var frame = $('#frame');
    var segs = segment(src);
    state.segs = segs; state.edits = {}; state.labels = {}; state.spans = {}; state.twins = {};
    var doc = frame.contentDocument;
    var css = '.__ed{cursor:text;border-radius:3px;outline:1px dashed transparent;outline-offset:2px;transition:background .2s}' +
      '.__ed:hover{outline-color:rgba(31,138,98,.75)}.__ed:focus{outline:2px solid #4fe0a5;background:rgba(79,224,165,.14)}' +
      '.__ed.__chg{background:rgba(255,214,102,.45)}.__lock{cursor:not-allowed}' +
      'html{scroll-behavior:auto}.reveal{opacity:1!important;transform:none!important}';
    var st = doc.createElement('style'); st.textContent = css; doc.head.appendChild(st);
    doc.querySelectorAll('details').forEach(function (d) { d.open = true; });

    // 元の HTML の文章と、画面上の文章を順番に対応づける
    var nodes = textNodes(doc);
    var j = 0;
    var byText = {};
    for (var i = 0; i < segs.length && j < nodes.length; i++) {
      var t = segs[i].text;
      var k = j;
      while (k < nodes.length && k < j + 6 && nodes[k].data !== t) k++;
      if (k >= nodes.length || nodes[k].data !== t) continue;
      var node = nodes[k];
      j = k + 1;
      var host = node.parentNode;
      if (host.closest && host.closest(LOCKED)) { host.classList.add('__lock'); continue; }
      var sp = doc.createElement('span');
      sp.className = '__ed';
      sp.dataset.seg = String(i);
      sp.spellcheck = false;
      try { sp.contentEditable = 'plaintext-only'; } catch (e) { sp.contentEditable = 'true'; }
      if (sp.contentEditable !== 'plaintext-only') sp.contentEditable = 'true';
      host.insertBefore(sp, node);
      sp.appendChild(node);
      state.spans[i] = [sp];
      state.labels[i] = whereLabel(host);
      var key = t.trim();
      if (key.length >= 4) (byText[key] = byText[key] || []).push(i);
    }
    Object.keys(byText).forEach(function (key) { var g = byText[key]; if (g.length > 1) g.forEach(function (i2) { state.twins[i2] = g; }); });

    doc.addEventListener('input', function (e) { var sp2 = e.target.closest && e.target.closest('.__ed'); if (sp2) onEdit(sp2); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.closest && e.target.closest('.__ed')) e.preventDefault(); });
    doc.addEventListener('paste', function (e) {
      if (!(e.target.closest && e.target.closest('.__ed'))) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
      doc.execCommand('insertText', false, text);
    });
    doc.addEventListener('click', function (e) {
      var el = e.target;
      if (el.closest && el.closest('a, button, summary, label')) e.preventDefault();
      if (el.closest && el.closest('.__lock')) toast('メニューやフッターは全ページ共通なので、ここでは直せません。', false, 2600);
    }, true);
    doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);

    var meta = readMeta(src);
    state.meta = { title: null, desc: null };
    $('#metaTitle').value = meta.title; $('#metaDesc').value = meta.desc;
    $('#metaTitle').parentNode.classList.remove('changed'); $('#metaDesc').parentNode.classList.remove('changed');
    refresh();
    $('#loading').hidden = true;
  }

  function loadPage(file) {
    if (dirtyCount() && !confirm('保存していない変更があります。破棄してほかのページを開きますか？')) {
      $('#page').value = state.file; return;
    }
    $('#loading').hidden = false;
    api('/admin/api/page?file=' + encodeURIComponent(file)).then(function (d) {
      if (!d.content) { $('#loading').textContent = d.error || 'ページを読み込めませんでした。'; return; }
      state.file = file; state.sha = d.sha; state.src = d.content;
      try { history.replaceState(null, '', '#' + file); } catch (e) { /* noop */ }
      var frame = $('#frame');
      // スクリプトは動かさず（sandbox）、見た目だけを表示する
      frame.onload = function () { frame.onload = null; setupFrame(d.content); };
      frame.srcdoc = d.content;
    });
  }

  function bindMeta(id, key) {
    $(id).addEventListener('input', function () {
      var cur = readMeta(state.src)[key];
      var v = $(id).value.replace(/\s*\n\s*/g, ' ');
      state.meta[key] = v === cur ? null : v;
      $(id).parentNode.classList.toggle('changed', state.meta[key] !== null);
      refresh();
    });
  }

  function save() {
    var content = apply(state.src, state.segs, state.edits, state.meta);
    var btn = $('#save');
    btn.disabled = true; btn.textContent = '保存中…';
    api('/admin/api/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ file: state.file, sha: state.sha, content: content, message: $('#msg').value }),
    }).then(function (d) {
      btn.disabled = false; btn.textContent = '保存する';
      if (!d.ok) { toast(d.error || '保存できませんでした。', true, 6000); return; }
      $('#dlg').close();
      $('#msg').value = '';
      toast('保存しました。1〜2分で本番サイトに反映されます。', false, 6000);
      state.edits = {}; state.meta = { title: null, desc: null };
      var f = state.file; state.file = '';
      loadPage(f);
    }).catch(function () {
      btn.disabled = false; btn.textContent = '保存する';
      toast('通信に失敗しました。もう一度お試しください。', true, 6000);
    });
  }

  function init() {
    api('/admin/api/config').then(function (cfg) {
      if (!cfg.pages) { toast('管理画面の設定を読み込めませんでした。', true, 8000); return; }
      state.config = cfg;
      var sel = $('#page');
      cfg.pages.forEach(function (p) { var o = document.createElement('option'); o.value = p.file; o.textContent = p.label; sel.appendChild(o); });
      if (cfg.mode !== 'live') {
        $('#mode').hidden = false;
        $('#mode').textContent = 'プレビュー版（保存はできません）';
      }
      var first = decodeURIComponent((location.hash || '').slice(1));
      if (!cfg.pages.some(function (p) { return p.file === first; })) first = cfg.pages[0].file;
      sel.value = first;
      sel.addEventListener('change', function () { loadPage(sel.value); });
      loadPage(first);
    });
    bindMeta('#metaTitle', 'title');
    bindMeta('#metaDesc', 'desc');
    $('#reset').addEventListener('click', function () {
      if (!confirm('このページの変更をすべて取り消しますか？')) return;
      state.edits = {}; state.meta = { title: null, desc: null };
      var f = state.file; state.file = ''; loadPage(f);
    });
    $('#review').addEventListener('click', function () {
      renderList($('#dlgList'), changeList(), false);
      var live = state.config && state.config.mode === 'live';
      $('#dlgNote').textContent = live
        ? '保存すると GitHub に記録され、1〜2分で本番サイトに反映されます。'
        : 'プレビュー版なので、ここでは保存できません。本番の管理画面では、この内容がそのまま保存されます。';
      $('#save').disabled = !live;
      $('#dlg').showModal();
    });
    $('#save').addEventListener('click', function (e) { e.preventDefault(); save(); });
    window.addEventListener('beforeunload', function (e) { if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });
  }

  init();
})();
