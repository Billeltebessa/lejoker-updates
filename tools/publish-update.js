'use strict';
// نشر تحديث LE JOKER POS بضغطة واحدة — يعمل على حاسوب صاحب البرنامج فقط.
// 1) يجد آخر نسخة مبنية بنجاح على GitHub (ويبنيها إن لزم)  2) ينزّلها ويفك ضغطها
// 3) يوقّعها محلياً بـ private-key.pem (لا يُرفع المفتاح أبداً)  4) ينشرها في lejoker-updates كأحدث إصدار
// 5) يتحقق أن update.json المنشور صحيح وموقّع ويطابق الملف.
// الاستعمال: node publish-update.js [--yes] [--notes "..."] [--dry-run] [--test-draft]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline');

const OWNER = 'Billeltebessa';
const SRC = 'lejoker-pos';
const DST = 'lejoker-updates';
const WORKFLOW = 'build-windows.yml';
const ARTIFACT = 'LE-JOKER-POS-windows';
const PUBLIC = process.env.LJ_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAD8TDALNffy56YDnhFG6xZkTaIlaBo8VBaSHIRwj1cnA=
-----END PUBLIC KEY-----
`;
const HERE = process.env.LJ_KEYS_DIR || __dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('dry-run');
const TEST_DRAFT = flag('test-draft');

const step = (n, t) => console.log(`\n[${n}] ${t}`);
const ok = (t) => console.log(`    OK  ${t}`);
const info = (t) => console.log(`        ${t}`);
const die = (t) => { console.error(`\n  X  ${t}\n`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });

// ---------- إعدادات محلية (في مجلد المفاتيح، لا تُرفع) ----------
const CONFIG_FILE = path.join(HERE, 'publish-config.json');
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } }
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + '\n'); }

async function getToken(cfg) {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (cfg.github_token) return cfg.github_token;
  console.log(`
  First time only: a GitHub access token is needed.
  1. Open: https://github.com/settings/personal-access-tokens/new
  2. Name: LE JOKER publish   Expiration: 1 year
  3. Repository access: "Only select repositories" -> ${SRC} and ${DST}
  4. Permissions -> Repository permissions:
       Actions: Read and write      Contents: Read and write
  5. Generate token, copy it, and paste it here (right-click to paste).
`);
  const t = await ask('  Token: ');
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) die('This does not look like a GitHub token. Run the tool again and paste the full token.');
  cfg.github_token = t;
  saveConfig(cfg);
  ok(`Token saved in ${path.basename(CONFIG_FILE)} (keys folder only).`);
  return t;
}

// ---------- GitHub API ----------
let TOKEN = '';
async function gh(method, url, body, { raw = false, headers = {}, retries = 3 } = {}) {
  const full = url.startsWith('http') ? url : `https://api.github.com${url}`;
  for (let a = 1; ; a++) {
    let r;
    try {
      r = await fetch(full, { method, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'lejoker-publish', ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined });
    } catch (e) {
      if (a < retries) { info(`network error, retrying (${a})…`); await sleep(2000 * a); continue; }
      die(`Network error: ${e.message}. Check the internet connection.`);
    }
    if (r.status >= 500 && a < retries) { info(`GitHub error ${r.status}, retrying (${a})…`); await sleep(3000 * a); continue; }
    if (raw) return r;
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* نص */ }
    if (!r.ok) {
      const e = new Error(`${method} ${url} -> ${r.status} ${(j && j.message) || txt.slice(0, 200)}`);
      e.status = r.status;
      throw e;
    }
    return j;
  }
}

// ---------- فك ضغط ملف zip (دون مكتبات) ----------
function unzipFirst(buf, pattern) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (!pattern.test(name)) continue;
    const ln = buf.readUInt16LE(local + 26); const le = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + ln + le, local + 30 + ln + le + csize);
    return { name: path.basename(name), data: method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data) };
  }
  throw new Error('Setup .exe not found inside the build');
}

// ---------- التوقيع (نفس صيغة sign-update.js) ----------
function loadKey() {
  const keyFile = process.env.LJ_PRIVATE_KEY || path.join(HERE, 'private-key.pem');
  if (!fs.existsSync(keyFile)) die(`private-key.pem not found in ${HERE}. Put this tool in the keys folder.`);
  let priv;
  try { priv = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')); } catch { die('private-key.pem is not a valid key.'); }
  const a = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const b = crypto.createPublicKey(PUBLIC).export({ type: 'spki', format: 'der' });
  if (!a.equals(b)) die('This private key does NOT match the app public key. Use the correct private-key.pem.');
  return priv;
}
function sign(priv, { version, exeName, exe, notes, extra }) {
  const url = `https://github.com/${OWNER}/${DST}/releases/download/v${version}/${exeName}`;
  const payload = { v: 1, kind: 'update', version, url, sha256: crypto.createHash('sha256').update(exe).digest('hex'), size: exe.length, notes, iat: new Date().toISOString().slice(0, 10), ...extra };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `LJ1.${body}.${crypto.sign(null, Buffer.from(`LJ1.${body}`), priv).toString('base64url')}`;
  return { json: JSON.stringify({ token, version, notes, url }, null, 2) + '\n', payload };
}
function verifyToken(token) {
  const [a, b, c] = String(token).split('.');
  if (a !== 'LJ1' || !b || !c) return null;
  if (!crypto.verify(null, Buffer.from(`${a}.${b}`), crypto.createPublicKey(PUBLIC), Buffer.from(c, 'base64url'))) return null;
  return JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
}

async function uploadAsset(release, name, data, type) {
  const url = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`;
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await gh('POST', url, data, { headers: { 'Content-Type': type }, retries: 1 });
      if (r && r.state === 'uploaded' && r.size === data.length) return r;
      throw new Error('incomplete upload');
    } catch (e) {
      info(`upload of ${name} failed (${e.message.slice(0, 80)}), retry ${a}/4…`);
      // حذف الملف الناقص إن وُجد ثم إعادة المحاولة
      const assets = await gh('GET', `/repos/${OWNER}/${DST}/releases/${release.id}/assets`).catch(() => []);
      for (const x of assets) if (x.name === name) await gh('DELETE', `/repos/${OWNER}/${DST}/releases/assets/${x.id}`).catch(() => {});
      await sleep(3000 * a);
    }
  }
  die(`Could not upload ${name} after 4 tries. Check the internet and run the tool again (nothing was published).`);
}

(async function main() {
  console.log('\n  ===== LE JOKER POS - publish update =====');
  const cfg = loadConfig();
  const priv = loadKey();
  ok('private-key.pem matches the app.');
  TOKEN = await getToken(cfg);

  step(1, 'Finding the latest Windows build on GitHub…');
  const head = await gh('GET', `/repos/${OWNER}/${SRC}/commits/main`).catch((e) => die(e.status === 401 || e.status === 403 || e.status === 404 ? 'GitHub token is not valid or lacks access. Delete "github_token" from publish-config.json and run again.' : e.message));
  let runs = (await gh('GET', `/repos/${OWNER}/${SRC}/actions/workflows/${WORKFLOW}/runs?branch=main&status=success&per_page=5`)).workflow_runs;
  let run = runs.find((r) => r.head_sha === head.sha);
  if (!run) {
    info(`No build yet for the latest code (${head.sha.slice(0, 7)}). Starting a build (about 3 minutes)…`);
    const startedAt = Date.now();
    await gh('POST', `/repos/${OWNER}/${SRC}/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main' });
    for (let i = 0; i < 120; i++) {
      await sleep(10000);
      const all = (await gh('GET', `/repos/${OWNER}/${SRC}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=5`)).workflow_runs
        .filter((r) => r.head_sha === head.sha && new Date(r.created_at).getTime() >= startedAt - 60000);
      const r = all[0];
      process.stdout.write('.');
      if (r && r.status === 'completed') {
        console.log('');
        if (r.conclusion !== 'success') die(`The build failed on GitHub. Open: ${r.html_url}`);
        run = r; break;
      }
    }
    if (!run) die('The build is taking too long. Try again in a few minutes.');
  }
  ok(`Build #${run.run_number} of ${run.created_at.slice(0, 16).replace('T', ' ')} (code ${run.head_sha.slice(0, 7)})`);

  step(2, 'Downloading the installer…');
  const arts = (await gh('GET', `/repos/${OWNER}/${SRC}/actions/runs/${run.id}/artifacts`)).artifacts;
  const art = arts.find((a) => a.name === ARTIFACT && !a.expired);
  if (!art) die('The build file has expired on GitHub. Start a new build: Actions -> build-windows -> Run workflow, then run this tool again.');
  let zip;
  if (process.env.LJ_LOCAL_ZIP) zip = fs.readFileSync(process.env.LJ_LOCAL_ZIP); // للاختبار فقط
  else {
    // GitHub يحوّل إلى رابط تخزين مؤقت: نطلبه دون ترويسة الدخول (وإلا يرفضه خادم التخزين)
    const first = await fetch(art.archive_download_url, { redirect: 'manual', headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'lejoker-publish' } });
    const loc = first.headers.get('location');
    const zr = loc ? await fetch(loc) : first;
    if (!zr.ok) die(`Download failed (${zr.status}).`);
    zip = Buffer.from(await zr.arrayBuffer());
    if (zip.length !== art.size_in_bytes) info(`note: size ${zip.length} vs expected ${art.size_in_bytes}`);
  }
  const { name: exeName, data: exe } = unzipFirst(zip, /LE-JOKER-POS-Setup-\d+\.\d+\.\d+\.exe$/i);
  if (exe.subarray(0, 2).toString() !== 'MZ') die('The downloaded file is not a Windows program.');
  const version = exeName.match(/(\d+\.\d+\.\d+)/)[1];
  const outDir = path.join(HERE, 'releases', `v${version}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, exeName), exe);
  ok(`${exeName} (${(exe.length / 1048576).toFixed(1)} MB)`);

  step(3, `Checking that version ${version} is not published yet…`);
  const tag = TEST_DRAFT ? `test-${Date.now()}` : `v${version}`;
  const existing = await gh('GET', `/repos/${OWNER}/${DST}/releases/tags/${tag}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
  if (existing && !existing.draft) die(`Version ${version} is already published. Increase the version in the code before publishing again.`);
  // مسودات قديمة فاشلة لنفس الإصدار: نحذفها ونبدأ نظيفاً
  const drafts = (await gh('GET', `/repos/${OWNER}/${DST}/releases?per_page=30`)).filter((r) => r.draft && (r.tag_name === tag || r.name === version));
  for (const d of drafts) { await gh('DELETE', `/repos/${OWNER}/${DST}/releases/${d.id}`); info(`removed an old unfinished draft (${d.name || d.tag_name})`); }
  ok('Not published yet.');

  let notes = opt('notes');
  if (notes === undefined && !flag('yes')) notes = await ask('\n  What is new in this version? (short, French/English, or press Enter to skip)\n  > ');
  notes = (notes || '').trim();

  step(4, 'Signing with your private key (stays on this computer)…');
  const extra = {};
  if (cfg.telemetry_url) extra.telemetry = cfg.telemetry_url;
  const { json, payload } = sign(priv, { version, exeName, exe, notes, extra });
  fs.writeFileSync(path.join(outDir, 'update.json'), json);
  ok(`update.json created (sha256 ${payload.sha256.slice(0, 12)}…)`);

  if (DRY) { console.log(`\n  DRY RUN: nothing published. Files are in ${outDir}\n`); return; }

  step(5, `Publishing ${TEST_DRAFT ? '(TEST draft) ' : ''}on GitHub…`);
  const rel = await gh('POST', `/repos/${OWNER}/${DST}/releases`, { tag_name: tag, target_commitish: 'main', name: TEST_DRAFT ? `TEST ${version}` : version, body: notes || `LE JOKER POS ${version}`, draft: true });
  info('uploading installer…');
  await uploadAsset(rel, exeName, exe, 'application/octet-stream');
  ok(exeName);
  await uploadAsset(rel, 'update.json', Buffer.from(json), 'application/json');
  ok('update.json');
  if (TEST_DRAFT) {
    await gh('DELETE', `/repos/${OWNER}/${DST}/releases/${rel.id}`);
    console.log('\n  TEST OK: draft created with both files, then deleted. Nothing was published.\n');
    return;
  }
  await gh('PATCH', `/repos/${OWNER}/${DST}/releases/${rel.id}`, { draft: false, make_latest: 'true' });
  ok(`Release v${version} published as Latest.`);

  step(6, 'Checking what customers will receive…');
  let good = false;
  for (let i = 0; i < 6 && !good; i++) {
    await sleep(i ? 5000 : 2000);
    try {
      const r = await fetch(`https://github.com/${OWNER}/${DST}/releases/latest/download/update.json`, { cache: 'no-store' });
      const j = await r.json();
      const p = verifyToken(j.token);
      good = !!p && p.version === version && p.sha256 === payload.sha256;
    } catch { /* نعيد المحاولة */ }
  }
  if (!good) die('Published, but update.json could not be verified yet. Wait a minute and check the release page.');
  ok(`Customers now get version ${version} (signature and file verified).`);
  console.log(`\n  DONE. Shops will see the update in Settings -> System -> Updates.\n  ${rel.html_url.replace('/untagged-', '/tag/')}\n`);
})().catch((e) => die(e.message));
