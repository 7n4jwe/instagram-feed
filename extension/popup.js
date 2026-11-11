const $ = (id) => document.getElementById(id);
$('opts').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

(async () => {
  const c = await chrome.runtime.sendMessage({ type: 'getCfg' });
  if (!c.configured) {
    $('count').textContent = '最初に「設定」でトークンを入力してください';
    $('count').className = 'count err';
    $('embed').style.display = $('admin').style.display = 'none';
    return;
  }
  const base = 'https://' + c.owner.toLowerCase() + '.github.io/' + c.repo + '/';
  $('embed').href = base + 'embed.html';
  $('admin').href = base + 'admin/';
  const r = await chrome.runtime.sendMessage({ type: 'getSelected', force: true });
  if (r.ok) $('count').textContent = '選択中の投稿：' + r.codes.length + ' 件';
  else { $('count').textContent = '接続できません：' + r.error; $('count').className = 'count err'; }
})();
