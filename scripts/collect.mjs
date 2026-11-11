// 自動収集スクリプト（GitHub Actions から実行）
// data/sources.json のユーザー/ハッシュタグから新しい投稿を探し、
// data/posts.json に「未確認の候補」（approved: false）として追加する。
//
// 収集対象と設定は data/sources.json（管理画面で編集）:
//   users            ユーザー名の配列
//   hashtags         ハッシュタグの配列
//   hashtag_enabled  true でハッシュタグ検索を行う（Meta の審査通過後）
//   max_per_source   1ソースあたりの取得件数（既定 12）
//
// 必要な環境変数（GitHub の Secrets / Variables に設定）:
//   IG_USER_ID        API を使う自分の Instagram プロアカウントの IG User ID
//   IG_ACCESS_TOKEN   長期アクセストークン（Facebook Login 経由）
//   GRAPH_VERSION     Graph API バージョン（例 v23.0）。未設定なら v23.0
//   ENABLE_HASHTAG    "true" でもハッシュタグ検索を有効化（sources.json より優先度は同等）
//   MAX_PER_SOURCE    sources.json に max_per_source が無いときの取得件数
//
// 実行結果は data/collect_status.json に書き出し、管理画面で確認できる。
// IG_USER_ID / IG_ACCESS_TOKEN が無ければ何もせず終了する。

import { readFile, writeFile } from 'node:fs/promises';

const POSTS = 'data/posts.json';
const SOURCES = 'data/sources.json';
const STATUS = 'data/collect_status.json';
const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
const VER = process.env.GRAPH_VERSION || 'v23.0';

if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.log('IG_USER_ID / IG_ACCESS_TOKEN が未設定のため収集をスキップします。');
  process.exit(0);
}

async function graph(path, params = {}) {
  const u = new URL(`https://graph.facebook.com/${VER}/${path}`);
  for (const [k, v] of Object.entries({ ...params, access_token: IG_ACCESS_TOKEN })) u.searchParams.set(k, v);
  const res = await fetch(u);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error ? `${j.error.type}: ${j.error.message}` : `HTTP ${res.status}`);
  return j;
}

function codeFromPermalink(permalink) {
  const m = /instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(permalink || '');
  return m ? { type: m[1] === 'reels' ? 'reel' : m[1], code: m[2] } : null;
}

const trim = (s, n = 140) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

async function fromUser(username) {
  const fields = `business_discovery.username(${username}){media.limit(${LIMIT}){id,permalink,timestamp,media_type,caption}}`;
  const j = await graph(IG_USER_ID, { fields });
  return (j.business_discovery?.media?.data || []).map((m) => ({ ...m, author: username, source: `user:${username}` }));
}

async function fromHashtag(tag) {
  const s = await graph('ig_hashtag_search', { user_id: IG_USER_ID, q: tag });
  const id = s.data?.[0]?.id;
  if (!id) return [];
  const j = await graph(`${id}/recent_media`, { user_id: IG_USER_ID, fields: 'id,permalink,timestamp,media_type,caption', limit: LIMIT });
  return (j.data || []).map((m) => ({ ...m, author: '', source: `tag:${tag}` }));
}

const posts = JSON.parse(await readFile(POSTS, 'utf8'));
const sources = JSON.parse(await readFile(SOURCES, 'utf8'));
const ENABLE_HASHTAG = sources.hashtag_enabled === true || process.env.ENABLE_HASHTAG === 'true';
const LIMIT = Math.min(50, Math.max(1, parseInt(sources.max_per_source || process.env.MAX_PER_SOURCE || '12', 10) || 12));
posts.posts ||= [];
posts.dismissed ||= [];
const known = new Set([...posts.posts.map((p) => p.code), ...posts.dismissed]);

const jobs = [
  ...(sources.users || []).map((u) => ['user', u, () => fromUser(u)]),
  ...(ENABLE_HASHTAG ? (sources.hashtags || []).map((t) => ['tag', t, () => fromHashtag(t)]) : []),
];
if (!ENABLE_HASHTAG && sources.hashtags?.length) console.log('ハッシュタグ検索が無効のため、ハッシュタグはスキップします。');

let added = 0;
const now = new Date().toISOString();
const results = [];
for (const [kind, name, run] of jobs) {
  try {
    const media = await run();
    let n = 0;
    for (const m of media) {
      const c = codeFromPermalink(m.permalink);
      if (!c || known.has(c.code)) continue;
      known.add(c.code);
      posts.posts.push({
        code: c.code,
        url: `https://www.instagram.com/${c.type}/${c.code}/`,
        author: m.author,
        source: m.source,
        added_at: now,
        posted_at: m.timestamp || null,
        caption: trim(m.caption),
        approved: false,
        note: '',
      });
      added++; n++;
    }
    results.push({ kind, name, ok: true, fetched: media.length, added: n });
    console.log(`${kind} ${name}: ${media.length} 件取得 / 新規 ${n}`);
  } catch (e) {
    results.push({ kind, name, ok: false, error: e.message });
    console.warn(`${kind} ${name}: 失敗 — ${e.message}`);
  }
}
if (!ENABLE_HASHTAG) for (const t of sources.hashtags || []) results.push({ kind: 'tag', name: t, ok: false, skipped: true, error: 'ハッシュタグ検索が無効' });
await writeFile(STATUS, JSON.stringify({ ran_at: now, added, results }, null, 2) + '\n');

if (added) {
  posts.updated_at = now;
  await writeFile(POSTS, JSON.stringify(posts, null, 2) + '\n');
}
console.log(`新しい候補: ${added} 件`);
