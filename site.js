/* site.js — 演出だけを担当する小さなスクリプト。
   これが読み込めなくても、すべての文章・リンク・ツールはそのまま使える（AIエージェントや読み上げ環境を含む）。 */
(function () {
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 出現アニメーション
  var targets = document.querySelectorAll('.reveal, .hero');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
  } else {
    targets.forEach(function (el) { el.classList.add('is-in'); });
  }

  // 目次の現在地
  var tocLinks = document.querySelectorAll('.toc a[href^="#"]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && map[e.target.id]) {
          tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
          map[e.target.id].classList.add('is-active');
        }
      });
    }, { rootMargin: '0px 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) spy.observe(el); });
  }

  // スマホ下部の広告バー: 閉じるとそのタブを閉じるまで出さない
  var bar = document.querySelector('.anchor-ad');
  if (bar) {
    var KEY = 'ph-anchor-closed';
    var closed = false;
    try { closed = sessionStorage.getItem(KEY) === '1'; } catch (err) {}
    if (closed) { bar.hidden = true; document.body.classList.remove('has-anchor'); }
    var btn = bar.querySelector('.ad-close');
    if (btn) btn.addEventListener('click', function () {
      bar.hidden = true; document.body.classList.remove('has-anchor');
      try { sessionStorage.setItem(KEY, '1'); } catch (err) {}
    });
  }

  // 現在のタブを横スクロールの見える位置へ
  var tabs = document.querySelector('.tabs');
  var cur = tabs && tabs.querySelector('a[aria-current="page"]');
  if (cur) { tabs.scrollLeft = Math.max(0, cur.offsetLeft - (tabs.clientWidth - cur.clientWidth) / 2); }
})();
