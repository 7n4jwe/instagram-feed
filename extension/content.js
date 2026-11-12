// Instagram の画面に「選ぶ」ボタンと「選択中」の印を付ける。
// - プロフィールや検索の一覧：各写真の左上に ＋／✓ ボタン。選択中は緑の枠
// - 投稿を開いているとき（ページでも拡大表示でも）：右下に大きなボタン
// - ホームのフィード：各投稿の右上にボタン
// 保存は background.js が GitHub に対して行う。
(function () {
  if (window.__igfLoaded) return;
  window.__igfLoaded = true;

  const POST_RE = /\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reels?|tv)\/([A-Za-z0-9_-]{5,})/;
  const RESERVED = new Set(['explore', 'accounts', 'direct', 'stories', 'reels', 'p', 'reel', 'tv', 'about', 'legal', 'developer']);
  let selected = new Set();
  let profiles = []; // 登録アカウント（管理画面の「アカウント」と共通）
  let counts = {};   // アカウントごとの選択中の件数
  let configured = true;
  const busy = new Set();

  function parsePost(href) {
    const m = POST_RE.exec(href || '');
    if (!m) return null;
    const type = m[2] === 'p' ? 'p' : (m[2] === 'tv' ? 'tv' : 'reel');
    const author = m[1] && !RESERVED.has(m[1].toLowerCase()) ? m[1].toLowerCase() : '';
    return { code: m[3], type, author };
  }
  // プロフィールページを見ているときのユーザー名（一覧の写真の投稿者として使う）
  function pageUser() {
    const first = location.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9._]{1,30}$/.test(first) && !RESERVED.has(first.toLowerCase()) ? first.toLowerCase() : '';
  }

  const send = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })); }
    catch (e) { resolve({ ok: false, error: '拡張が更新されました。ページを再読み込みしてください' }); }
  });

  // ---------- 通知 ----------
  let toastTimer = null;
  function toast(text, kind) {
    let t = document.getElementById('igf-toast');
    if (!t) { t = document.createElement('div'); t.id = 'igf-toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.className = 'igf-toast ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'igf-toast igf-hide'; }, 2600);
  }

  // ---------- 選択の切り替え ----------
  async function toggle(post) {
    if (!configured) { toast('最初に接続設定（トークン）を入力してください', 'err'); send({ type: 'openOptions' }); return; }
    if (busy.has(post.code)) return;
    const select = !selected.has(post.code);
    busy.add(post.code);
    // 先に見た目を変える（失敗したら戻す）
    if (select) selected.add(post.code); else selected.delete(post.code);
    paint();
    const r = await send({ type: 'setSelected', code: post.code, postType: post.type, author: post.author, select });
    busy.delete(post.code);
    if (r && r.ok) {
      applyState(r);
      renderBar();
      toast(select ? '✓ 選びました（' + selected.size + ' 件選択中）' : '選択を外しました', 'ok');
    } else {
      if (select) selected.delete(post.code); else selected.add(post.code);
      toast('保存できませんでした：' + ((r && r.error) || '不明なエラー'), 'err');
    }
    paint();
  }

  function makeButton(post, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'igf-btn ' + cls;
    b.dataset.code = post.code;
    b.dataset.type = post.type;
    b.dataset.author = post.author || '';
    const stop = (e) => { e.stopPropagation(); };
    ['pointerdown', 'mousedown', 'mouseup', 'touchstart'].forEach((t) => b.addEventListener(t, stop, true));
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      toggle({ code: b.dataset.code, type: b.dataset.type, author: b.dataset.author });
    }, true);
    return b;
  }

  function paintButton(b) {
    const on = selected.has(b.dataset.code);
    const wait = busy.has(b.dataset.code);
    b.classList.toggle('igf-on', on);
    b.classList.toggle('igf-wait', wait);
    if (b.classList.contains('igf-fab')) b.textContent = on ? '✓ 選択中（クリックで外す）' : '＋ この投稿を選ぶ';
    else b.textContent = on ? '✓' : '＋';
    b.title = on ? '選択中：クリックで外す' : 'この投稿を選ぶ';
    const host = b.closest('.igf-host');
    if (host) host.classList.toggle('igf-sel', on);
  }
  function paint() { document.querySelectorAll('.igf-btn').forEach(paintButton); }

  // ---------- 一覧の写真にボタンを付ける ----------
  // フィードの投稿（日時表示のある article）の中かどうか。そこは右上のボタンに任せる
  // （動画の上には再生用の画像が重なるので、写真・動画の上にボタンを置くと隠れてしまう）
  const inFeedPost = (el) => { const art = el.closest('article'); return !!(art && art.querySelector('time')); };

  function decorateTiles() {
    const user = pageUser();
    document.querySelectorAll('a[href]:not([data-igf="0"])').forEach((a) => {
      if (a.dataset.igf === '1' && a.querySelector(':scope > .igf-btn')) return; // 付与済み
      const post = parsePost(a.getAttribute('href'));
      if (!post || inFeedPost(a)) { a.dataset.igf = '0'; return; }
      // 写真・動画のタイル（ある程度大きいリンク）だけを対象にする。
      // 動画のタイルは <img> ではなく背景画像や <video> で描かれることがあるので、画像の有無ではなく大きさで判断する
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) return; // まだ表示されていない（後で再確認）
      if (r.width < 100 || r.height < 100) {
        if (!a.querySelector('img, video')) { a.dataset.igf = '0'; return; } // 文字だけの小さなリンク（日時など）
        if (r.width < 80) { a.dataset.igf = '0'; return; }
      }
      a.dataset.igf = '1';
      if (!post.author && user) post.author = user;
      if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
      a.classList.add('igf-host');
      const b = makeButton(post, 'igf-tile');
      a.appendChild(b);
      paintButton(b);
    });
  }

  // ---------- ホームのフィード：いいね・コメント・シェアの列の右側（保存アイコンの左） ----------
  // 投稿の右上は「フォローする」ボタンと重なることがあり、写真・動画の上は再生用の画像に隠れるため、操作アイコンの列に置く
  function decorateArticles() {
    document.querySelectorAll('article').forEach((art) => {
      if (art.dataset.igf === '1' && art.querySelector('.igf-btn')) return; // 付与済み（描き直しで消えていたら付け直す）
      if (!art.querySelector('time')) return; // 広告など投稿へのリンクが無いもの（後で読み込まれる場合に備えて印は付けない）
      const link = [...art.querySelectorAll('a[href]')].map((a) => parsePost(a.getAttribute('href'))).find(Boolean);
      if (!link) return;
      art.dataset.igf = '1';
      if (art.querySelector('video')) link.type = 'reel'; // 動画は表示側で黒帯を除くためリールとして保存
      if (!link.author) {
        // 投稿の最初にあるプロフィールへのリンク（/ユーザー名/）が投稿者
        const h = [...art.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href').split('?')[0].split('/').filter(Boolean)).find((p) => p.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(p[0]) && !RESERVED.has(p[0].toLowerCase()));
        if (h) link.author = h[0].toLowerCase();
      }
      if (getComputedStyle(art).position === 'static') art.style.position = 'relative';
      art.classList.add('igf-host', 'igf-article'); // 選択中は投稿全体を緑の枠に
      const save = [...art.querySelectorAll('svg[aria-label]')].find((v) => /^(保存する|保存を取り消す|保存|Save|Remove)$/.test(v.getAttribute('aria-label')));
      const bar = save && save.closest('section');
      if (bar && art.contains(bar)) {
        if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
        const b = makeButton(link, 'igf-bar');
        bar.appendChild(b);
        paintButton(b);
      } else {
        const b = makeButton(link, 'igf-art'); // 列が見つからないときは右上
        art.appendChild(b);
        paintButton(b);
      }
    });
  }

  // ---------- フィードなどの大きな動画・写真（リンクで囲まれていないもの） ----------
  // 動画の投稿は <article> の外に描かれたり、写真のようなリンクで囲まれていないことがあるので、
  // 大きな動画／画像から親をたどり、投稿へのリンクが1つだけ見つかった範囲をその投稿とみなす
  function postInside(el) {
    const codes = new Map();
    el.querySelectorAll('a[href]').forEach((a) => { const p = parsePost(a.getAttribute('href')); if (p && !codes.has(p.code)) codes.set(p.code, p); });
    return codes;
  }
  function decorateMedia() {
    if (parsePost(location.pathname)) return; // 投稿を開いているときは右下のボタンで扱う
    document.querySelectorAll('video, img').forEach((m) => {
      if (m.dataset.igf || m.closest('.igf-host') || inFeedPost(m)) return;
      const r = m.getBoundingClientRect();
      if (r.width < 200 || r.height < 200) return;
      let el = m.parentElement, post = null;
      for (let k = 0; k < 25 && el && el !== document.body; k++, el = el.parentElement) {
        const codes = postInside(el);
        if (codes.size === 1) { post = [...codes.values()][0]; break; }
        if (codes.size > 1) break; // 複数の投稿を含む範囲まで来たら諦める
      }
      m.dataset.igf = post ? '1' : '0';
      if (!post) return;
      if (m.tagName === 'VIDEO') post.type = 'reel'; // 動画は表示側で黒帯を除くためリールとして保存
      if (!post.author) {
        const h = [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href').split('/').filter(Boolean)).find((p) => p.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(p[0]) && !RESERVED.has(p[0].toLowerCase()));
        if (h) post.author = h[0].toLowerCase();
      }
      // 同じ投稿にすでにボタンがあれば付けない（写真が複数枚の投稿など）
      if (el.querySelector('.igf-btn[data-code="' + CSS.escape(post.code) + '"]')) return;
      const host = m.parentElement;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.classList.add('igf-host');
      const b = makeButton(post, 'igf-tile');
      host.appendChild(b);
      paintButton(b);
    });
  }

  // ---------- 投稿を開いているとき：右下の大きなボタン ----------
  function currentPost() {
    const post = parsePost(location.pathname);
    if (!post) return null;
    // /p/ のURLでも中身が動画ならリールとして保存（表示側で黒帯を除くため）
    if (post.type === 'p' && [...document.querySelectorAll('main video, [role="dialog"] video')].some((v) => v.getBoundingClientRect().width >= 200)) post.type = 'reel';
    if (!post.author) {
      // 投稿ページの og:url（/ユーザー名/p/コード/）から投稿者を取る
      const og = document.querySelector('meta[property="og:url"]');
      const fromOg = og && parsePost(og.content);
      if (fromOg && fromOg.code === post.code) post.author = fromOg.author;
    }
    return post;
  }
  function updateFab() {
    const post = currentPost();
    let fab = document.querySelector('.igf-fab');
    if (!post) { if (fab) fab.remove(); return; }
    if (!fab || fab.dataset.code !== post.code) {
      if (fab) fab.remove();
      fab = makeButton(post, 'igf-fab');
      document.body.appendChild(fab);
    } else if (!fab.dataset.author && post.author) {
      fab.dataset.author = post.author;
    }
    paintButton(fab);
  }

  // ---------- 選択モード（一覧の写真をクリックするだけで選択／解除） ----------
  let pickMode = false;
  try { chrome.storage.local.get('pickMode', (c) => { pickMode = !!(c && c.pickMode); updateModeToggle(); }); } catch (_) {}
  function setPickMode(on) {
    pickMode = on;
    try { chrome.storage.local.set({ pickMode: on }); } catch (_) {}
    updateModeToggle();
    toast(on ? '選択モード：写真をクリックすると選択／解除します' : '選択モードを終了しました（クリックで投稿が開きます）', on ? 'ok' : '');
  }
  function updateModeToggle() {
    // 一覧の写真があるページ（プロフィール・検索など）でだけ表示する。投稿を開いているときは出さない
    const show = !!document.querySelector('.igf-tile') && !parsePost(location.pathname);
    let t = document.querySelector('.igf-mode');
    if (!show) { if (t) t.remove(); document.documentElement.classList.remove('igf-picking'); return; }
    if (!t) {
      t = document.createElement('button');
      t.type = 'button';
      t.className = 'igf-mode';
      t.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPickMode(!pickMode); }, true);
      document.body.appendChild(t);
    }
    t.classList.toggle('igf-mode-on', pickMode);
    t.textContent = pickMode ? '✓ 選択モード中（写真をクリックで選択）— 終了' : '選択モード';
    t.title = pickMode ? 'クリックで選択モードを終了' : '写真をクリックするだけで選べるようにする';
    document.documentElement.classList.toggle('igf-picking', pickMode);
  }
  // 選択モード中は、一覧の写真のクリックで投稿を開かず、選択／解除する。
  // Instagram の処理より先に受け取るため、window の捕捉段階で止める
  function tileFromEvent(e) {
    if (!pickMode || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return null;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.closest('.igf-btn, .igf-mode')) return null; // ボタン自身の操作はそちらに任せる
    const host = el.closest('a.igf-host');
    return host && host.querySelector(':scope > .igf-tile') ? host : null;
  }
  ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'touchstart'].forEach((type) => window.addEventListener(type, (e) => {
    if (tileFromEvent(e)) e.stopPropagation();
  }, true));
  window.addEventListener('click', (e) => {
    const host = tileFromEvent(e);
    if (!host) return;
    e.preventDefault();
    e.stopPropagation();
    const b = host.querySelector(':scope > .igf-tile');
    toggle({ code: b.dataset.code, type: b.dataset.type, author: b.dataset.author });
  }, true);

  // ---------- アカウントバー（登録アカウントをワンクリックで行き来する） ----------
  let barOpen = true;
  try { chrome.storage.local.get('barOpen', (c) => { if (c && c.barOpen === false) { barOpen = false; renderBar(); } }); } catch (_) {}
  function goAccount(user) {
    // 移動先ですぐ選べるよう、選択モードをオンにしてからプロフィールへ
    pickMode = true;
    try { chrome.storage.local.set({ pickMode: true }, () => { location.href = 'https://www.instagram.com/' + encodeURIComponent(user) + '/'; }); }
    catch (_) { location.href = 'https://www.instagram.com/' + encodeURIComponent(user) + '/'; }
  }
  async function changeProfile(user, add) {
    const r = await send({ type: 'setProfile', user, add });
    if (r && r.ok) { applyState(r); toast(add ? '@' + user + ' を登録しました' : '@' + user + ' を一覧から外しました', 'ok'); }
    else toast('保存できませんでした：' + ((r && r.error) || '不明なエラー'), 'err');
    renderBar();
  }
  function renderBar() {
    let bar = document.querySelector('.igf-bar-acc');
    if (!configured) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'igf-bar-acc';
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        if (b.dataset.act === 'go') goAccount(b.dataset.user);
        if (b.dataset.act === 'add') changeProfile(b.dataset.user, true);
        if (b.dataset.act === 'rm') changeProfile(b.dataset.user, false);
        if (b.dataset.act === 'fold') { barOpen = !barOpen; try { chrome.storage.local.set({ barOpen }); } catch (_) {} renderBar(); }
      }, true);
      document.body.appendChild(bar);
    }
    const here = parsePost(location.pathname) ? '' : pageUser();
    const key = [barOpen, here, profiles.join(','), profiles.map((u) => counts[u] || 0).join(',')].join('|');
    if (bar.dataset.key === key) return; // 変化が無ければ描き直さない
    bar.dataset.key = key;
    bar.textContent = '';
    const mk = (tag, cls, text, data) => { const el = document.createElement(tag); el.className = cls; el.textContent = text; Object.assign(el.dataset, data || {}); return el; };
    bar.appendChild(mk('button', 'igf-acc-fold', barOpen ? '選ぶアカウント ▾' : '選ぶアカウント ▸', { act: 'fold' }));
    if (!barOpen) return;
    profiles.forEach((u) => {
      const chip = mk('span', 'igf-acc' + (u === here ? ' igf-acc-here' : ''), '', {});
      chip.appendChild(mk('button', 'igf-acc-go', '@' + u + (counts[u] ? ' ✓' + counts[u] : ''), { act: 'go', user: u }));
      if (u === here) chip.appendChild(mk('button', 'igf-acc-rm', '×', { act: 'rm', user: u }));
      bar.appendChild(chip);
    });
    if (!profiles.length) bar.appendChild(mk('span', 'igf-acc-hint', 'プロフィールを開いて「＋登録」', {}));
    // 表示中のプロフィールが未登録なら登録ボタン（一覧の写真があるページ＝プロフィールのときだけ）
    if (here && !profiles.includes(here) && document.querySelector('.igf-tile')) bar.appendChild(mk('button', 'igf-acc-add', '＋ @' + here + ' を登録', { act: 'add', user: here }));
  }

  // ---------- 監視 ----------
  let scheduled = false;
  function scan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      decorateTiles();
      decorateArticles();
      decorateMedia();
      updateFab();
      updateModeToggle();
      renderBar();
    }, 250);
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; scan(); } }, 400);

  function applyState(r) {
    selected = new Set(r.codes);
    profiles = Array.isArray(r.profiles) ? r.profiles : [];
    counts = r.counts || {};
  }
  async function refresh(force) {
    const r = await send({ type: 'getSelected', force });
    if (r && r.ok) { configured = true; applyState(r); }
    else if (r && r.error === 'notConfigured') configured = false;
    paint();
    renderBar();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });

  scan();
  refresh(true);
})();
