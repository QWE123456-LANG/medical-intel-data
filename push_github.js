#!/usr/bin/env node
/* ============================================================
 * push_github.js —— 云端任务用：把最新 data.json 推送到 GitHub 仓库
 * 用法：
 *   GH_TOKEN=ghp_xxx GH_OWNER=QWE123456-LANG GH_REPO=medical-intel-data \
 *   GH_BRANCH=main node push_github.js [工作目录]
 *
 * 步骤：
 *   1) 确认仓库存在（不存在则创建，public）
 *   2) 用 Git Data API 提交 blob -> tree -> commit -> 更新 ref
 *   3) 调 jsDelivr purge API 清缓存（否则 CDN 12h 才刷新）
 *   4) 轮询校验 CDN 上的 data.json 已含今天日期
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const TOKEN   = process.env.GH_TOKEN || '';
const OWNER   = process.env.GH_OWNER || 'QWE123456-LANG';
const REPO    = process.env.GH_REPO  || 'medical-intel-data';
const BRANCH  = process.env.GH_BRANCH|| 'main';
const DIR     = process.argv[2] || '.';
const API     = 'https://api.github.com';

if (!TOKEN) { console.error('FATAL: 缺少环境变量 GH_TOKEN'); process.exit(1); }

const H = {
  'Authorization': 'Bearer ' + TOKEN,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'medical-intel-bot',
  'Content-Type': 'application/json'
};

async function gh(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
  if (!res.ok) {
    const err = new Error('GitHub API ' + res.status + ' ' + (json && json.message ? json.message : txt.slice(0, 200)));
    err.status = res.status;
    throw err;
  }
  return json;
}

async function ensureRepo() {
  try {
    await gh('GET', API + '/repos/' + OWNER + '/' + REPO);
    console.log('[1/4] 仓库已存在：' + OWNER + '/' + REPO);
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  console.log('[1/4] 仓库不存在，尝试创建…');
  await gh('POST', API + '/user/repos', {
    name: REPO, private: false, auto_init: true,
    description: '基层医疗行业情报系统 数据源'
  });
  console.log('      已创建 public 仓库：' + OWNER + '/' + REPO);
}

async function getRefSha() {
  try {
    const r = await gh('GET', API + '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BRANCH);
    return r.object.sha;
  } catch (e) {
    if (e.status === 404) {
      // 分支不存在，用仓库默认分支的 sha 创建
      const repo = await gh('GET', API + '/repos/' + OWNER + '/' + REPO);
      const def = repo.default_branch || 'main';
      const r2 = await gh('GET', API + '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + def);
      const sha = r2.object.sha;
      await gh('POST', API + '/repos/' + OWNER + '/' + REPO + '/git/refs', {
        ref: 'refs/heads/' + BRANCH, sha: sha
      });
      console.log('      已创建分支 ' + BRANCH);
      return sha;
    }
    throw e;
  }
}

async function pushFile(contentStr) {
  const enc = Buffer.from(contentStr, 'utf8').toString('base64');
  // 1) blob
  const blob = await gh('POST', API + '/repos/' + OWNER + '/' + REPO + '/git/blobs', {
    content: enc, encoding: 'base64'
  });
  // 2) tree（基于当前分支 tip，保证只改这一个文件）
  const baseSha = await getRefSha();
  const tree = await gh('POST', API + '/repos/' + OWNER + '/' + REPO + '/git/trees', {
    base_tree: baseSha,
    tree: [{ path: 'data.json', mode: '100644', type: 'blob', sha: blob.sha }]
  });
  // 3) commit
  const commit = await gh('POST', API + '/repos/' + OWNER + '/' + REPO + '/git/commits', {
    message: 'update data.json ' + new Date().toISOString(),
    tree: tree.sha,
    parents: [baseSha]
  });
  // 4) ref
  await gh('PATCH', API + '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + BRANCH, {
    sha: commit.sha, force: false
  });
  console.log('[2/4] 已提交到 GitHub，commit=' + commit.sha.slice(0, 8));
  return commit.sha;
}

async function purgeCdn() {
  const urls = [
    'https://purge.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH,
    'https://purge.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH + '/data.json'
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'GET' });
      console.log('      purge ' + u.slice(0, 72) + ' -> ' + r.status);
    } catch (e) {
      console.warn('      purge 失败（可忽略）: ' + e.message);
    }
  }
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function verify() {
  const want = todayCN();
  const cands = [
    'https://cdn.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH + '/data.json',
    'https://fastly.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH + '/data.json'
  ];
  for (let i = 0; i < 6; i++) {
    for (const u of cands) {
      try {
        const res = await fetch(u + '?_v=' + Date.now(), { headers: { 'Accept': 'application/json' } });
        if (!res.ok) continue;
        const d = await res.json();
        if (d && d.updated) {
          if (d.updated === want) {
            console.log('[4/4] 校验通过：CDN 上 updated=' + d.updated + ' daily=' + d.daily.length);
            return true;
          }
          console.log('      CDN 上 updated=' + d.updated + '（期望 ' + want + '），继续等待缓存刷新…');
        }
      } catch (e) { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  console.warn('[4/4] 警告：CDN 未在等待窗口内刷新到 ' + want + '（GitHub 已更新，稍后自动生效）');
  return false;
}

(async () => {
  try {
    const fp = path.join(DIR, 'data.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const d = JSON.parse(raw);
    if (!d || !d.categories || !Array.isArray(d.daily)) {
      console.error('FATAL: data.json 结构不完整，拒绝推送'); process.exit(1);
    }
    console.log('本地 data.json: updated=' + d.updated + ' daily=' + d.daily.length);

    await ensureRepo();
    await pushFile(raw);
    console.log('[3/4] 清理 CDN 缓存…');
    await purgeCdn();
    const ok = await verify();
    console.log('【' + (ok ? '成功' : '部分成功（GitHub已更新，CDN待刷新）') + '】仓库=' + OWNER + '/' + REPO + ' 分支=' + BRANCH);
    console.log('前端读取地址：https://cdn.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH + '/data.json');
  } catch (e) {
    console.error('【失败】' + e.message);
    process.exit(1);
  }
})();
