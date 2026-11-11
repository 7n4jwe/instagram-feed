const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['owner', 'repo', 'branch', 'token']).then((c) => {
  $('owner').value = c.owner || '7n4jwe';
  $('repo').value = c.repo || 'instagram-feed';
  $('branch').value = c.branch || 'main';
  $('token').value = c.token || '';
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    owner: $('owner').value.trim(), repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main', token: $('token').value.trim(),
  });
  $('msg').textContent = '確認中…'; $('msg').className = '';
  const r = await chrome.runtime.sendMessage({ type: 'getSelected', force: true });
  if (r && r.ok) {
    $('msg').textContent = '接続できました。選択中の投稿: ' + r.codes.length + ' 件。Instagram のタブを再読み込みすると使えます。';
    $('msg').className = 'ok';
  } else {
    $('msg').textContent = '接続できません: ' + (r && r.error === 'notConfigured' ? 'ユーザー名・リポジトリ名・トークンを入力してください' : (r && r.error));
    $('msg').className = 'err';
  }
});
