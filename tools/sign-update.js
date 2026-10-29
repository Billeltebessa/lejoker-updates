'use strict';
// توقيع تحديث LE JOKER POS — أداة مستقلة (لا تحتاج المشروع).
// الاستعمال: node sign-update.js <LE-JOKER-POS-Setup-X.Y.Z.exe> <private-key.pem> [ملاحظات]
// تُنتج update.json بجانب ملف التثبيت. المفتاح الخاص لا يُرسل لأي مكان.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = 'https://github.com/Billeltebessa/lejoker-updates/releases/download';
const PUBLIC = process.env.LJ_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAD8TDALNffy56YDnhFG6xZkTaIlaBo8VBaSHIRwj1cnA=
-----END PUBLIC KEY-----
`;
const clean = (p) => String(p || '').trim().replace(/^"|"$/g, '');
const die = (m, en) => { console.error('\n  X  ' + (en || m) + '\n'); process.exit(1); };

const exe = clean(process.argv[2]);
// المفتاح: المسار المعطى، وإلا private-key.pem بجانب الأداة
let keyFile = clean(process.argv[3]);
if (!keyFile || !fs.existsSync(keyFile)) { const near = path.join(__dirname, 'private-key.pem'); if (fs.existsSync(near)) keyFile = near; }
const notes = process.argv.slice(4).join(' ').trim();
if (!exe || !fs.existsSync(exe)) die('', 'Setup file not found: ' + exe);
if (!keyFile || !fs.existsSync(keyFile)) die('', 'private-key.pem not found. Put sign-update.cmd and sign-update.js in the SAME folder as private-key.pem (the keys folder).');
const m = path.basename(exe).match(/(\d+\.\d+\.\d+)/);
if (!m) die('', 'Setup file name must contain the version, e.g. LE-JOKER-POS-Setup-1.1.0.exe');
const version = m[1];

let priv;
try { priv = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')); } catch { die('', 'Not a valid private-key.pem'); }
// التأكد أن المفتاح الخاص يطابق المفتاح العام المضمّن في البرنامج
const derived = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
const expected = crypto.createPublicKey(PUBLIC).export({ type: 'spki', format: 'der' });
if (!derived.equals(expected)) die('', 'This private key does NOT match the app public key. Use the correct private-key.pem.');

const buf = fs.readFileSync(exe);
const url = `${REPO}/v${version}/${path.basename(exe)}`;
const payload = { v: 1, kind: 'update', version, url, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, notes, iat: new Date().toISOString().slice(0, 10) };
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const token = `LJ1.${body}.${crypto.sign(null, Buffer.from(`LJ1.${body}`), priv).toString('base64url')}`;
const out = path.join(path.dirname(exe), 'update.json');
fs.writeFileSync(out, JSON.stringify({ token, version, notes, url }, null, 2) + '\n');
console.log(`\n  OK  Signed version ${version}\n  Created: ${out}\n\n  Next on GitHub: lejoker-updates -> Releases -> Draft a new release\n  Tag: v${version}\n  Upload: ${path.basename(exe)} + update.json, then Publish release\n`);
