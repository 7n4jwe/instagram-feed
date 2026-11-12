// GitHub とのやり取り（data/posts.json の読み書き）を担当する。
// content.js / popup / options からメッセージで呼ばれる。

const FILE = 'data/posts.json';
const CACHE_MS = 20 * 1000;
let cache = null; // { codes: string[], at: number }

async function getCfg() {
  const c = await chrome.storage.local.get(['owner', 'repo', 'branch', 'token']);
  return { owner: (c.owner || '').trim(), repo: (c.repo || '').trim(), branch: (c.branch || 'main').trim(), token: (c.token || '').trim() };
}
const configured = (c) => !!(c.owner && c.repo && c.token);

const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (ch) => ch.charCodeAt(0)));

async function gh(cfg, path, opts = {}) {
  const res = await fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j.message) msg += ' — ' + j.message; } catch (_) {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res.json();
}

async function readPosts(cfg) {
  const j = await gh(cfg, '/contents/' + FILE + '?ref=' + encodeURIComponent(cfg.branch));
  const data = JSON.parse(b64dec(j.content));
  data.posts = Array.isArray(data.posts) ? data.posts : [];
  data.dismissed = Array.isArray(data.dismissed) ? data.dismissed : [];
  return { sha: j.sha, data };
}

// 選択中の投稿コード・登録アカウント・アカウントごとの選択件数を覚えておく
function remember(data) {
  const approved = data.posts.filter((p) => p.approved);
  const counts = {};
  approved.forEach((p) => { if (p.author) counts[p.author] = (counts[p.author] || 0) + 1; });
  cache = { codes: approved.map((p) => p.code), profiles: Array.isArray(data.profiles) ? data.profiles : [], counts, at: Date.now() };
  return view();
}
const view = () => ({ codes: cache.codes, profiles: cache.profiles, counts: cache.counts });

async function getSelected(force) {
  const cfg = await getCfg();
  if (!configured(cfg)) return { ok: false, error: 'notConfigured' };
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ok: true, ...view() };
  const { data } = await readPosts(cfg);
  return { ok: true, ...remember(data) };
}

// 読む→変更→書く。他で更新されていたら（409/422）読み直してやり直す
async function setSelected({ code, postType, author, select }) {
  const cfg = await getCfg();
  if (!configured(cfg)) return { ok: false, error: 'notConfigured' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readPosts(cfg);
    let p = data.posts.find((x) => x.code === code);
    const before = !!(p && p.approved);
    if (before === select) return { ok: true, ...remember(data), selected: select };
    if (select) {
      if (p) { p.approved = true; p.reviewed = true; if (!p.author && author) p.author = author; }
      else {
        data.dismissed = data.dismissed.filter((c) => c !== code);
        p = { code, url: 'https://www.instagram.com/' + (postType || 'p') + '/' + code + '/', author: author || '', source: 'manual', added_at: new Date().toISOString(), approved: true, reviewed: true, note: '' };
        data.posts.push(p); // 選んだ順に、選択中の最後へ
      }
    } else {
      p.approved = false; p.reviewed = true;
    }
    data.updated_at = new Date().toISOString();
    try {
      await gh(cfg, '/contents/' + FILE, {
        method: 'PUT',
        body: JSON.stringify({ message: (select ? 'Select' : 'Unselect') + ' post ' + code, sha, branch: cfg.branch, content: b64enc(JSON.stringify(data, null, 2) + '\n') }),
      });
      return { ok: true, ...remember(data), selected: select };
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
      throw e;
    }
  }
}

// アカウントを登録／解除（管理画面の「アカウント」と同じ data/posts.json の profiles）
async function setProfile({ user, add }) {
  const cfg = await getCfg();
  if (!configured(cfg)) return { ok: false, error: 'notConfigured' };
  if (!/^[a-z0-9._]{1,30}$/.test(user || '')) return { ok: false, error: 'ユーザー名が正しくありません' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readPosts(cfg);
    data.profiles = Array.isArray(data.profiles) ? data.profiles : [];
    const has = data.profiles.includes(user);
    if (has === add) return { ok: true, ...remember(data) };
    if (add) data.profiles.push(user); else data.profiles = data.profiles.filter((u) => u !== user);
    data.updated_at = new Date().toISOString();
    try {
      await gh(cfg, '/contents/' + FILE, {
        method: 'PUT',
        body: JSON.stringify({ message: (add ? 'Add' : 'Remove') + ' account ' + user, sha, branch: cfg.branch, content: b64enc(JSON.stringify(data, null, 2) + '\n') }),
      });
      return { ok: true, ...remember(data) };
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
      throw e;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'getSelected') return reply(await getSelected(msg.force));
      if (msg.type === 'setSelected') return reply(await setSelected(msg));
      if (msg.type === 'setProfile') return reply(await setProfile(msg));
      if (msg.type === 'openOptions') { chrome.runtime.openOptionsPage(); return reply({ ok: true }); }
      if (msg.type === 'getCfg') { const c = await getCfg(); return reply({ ok: true, owner: c.owner, repo: c.repo, branch: c.branch, configured: configured(c) }); }
      reply({ ok: false, error: 'unknown' });
    } catch (e) {
      reply({ ok: false, error: e.message, status: e.status });
    }
  })();
  return true; // 非同期で返す
});

// 設定が変わったらキャッシュを捨てる
chrome.storage.onChanged.addListener(() => { cache = null; });
