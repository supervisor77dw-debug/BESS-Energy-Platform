// Datei-basierte Attrappe für @vercel/blob (nur Tests, mehrere Prozesse): ein Ordner je Store-Kennung aus dem Token.
// Ohne token-Option gilt BLOB_READ_WRITE_TOKEN der Umgebung (wie das echte SDK). Aktivierung: --import dieser Datei.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
const ROOT = process.env.ATTRAPPE_DIR;
const tokenVon = (o) => { const t = String(o?.token || process.env.BLOB_READ_WRITE_TOKEN || ''); if (!t.startsWith('vercel_blob_rw_')) { const e = new Error('Vercel Blob: Access denied'); throw e; } return t; };
const dir = (o) => join(ROOT, tokenVon(o).split('_')[3]);
const etag = (b) => `"${createHash('sha256').update(b).digest('hex').slice(0, 16)}"`;
const walk = (d, pre = '') => existsSync(d) ? readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n), pre + n + '/') : [pre + n]) : [];
const nf = () => { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobNotFoundError'; return e; };
globalThis.__bessBlobSdk = {
  async list(o = {}) { const d = dir(o); return { blobs: walk(d).filter((p) => p.startsWith(o.prefix || '')).map((pathname) => ({ pathname, size: statSync(join(d, pathname)).size })), hasMore: false }; },
  async head(p, o) { const f = join(dir(o), p); if (!existsSync(f)) throw nf(); return { etag: etag(readFileSync(f)) }; },
  async get(p, o) { const f = join(dir(o), p); if (!existsSync(f)) return null; const b = readFileSync(f); return { statusCode: 200, stream: Readable.from([b]), blob: { etag: etag(b) } }; },
  async put(p, data, o = {}) {
    const f = join(dir(o), p); const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (existsSync(f) && o.allowOverwrite === false) throw new Error('Vercel Blob: This blob already exists');
    if (o.ifMatch && (!existsSync(f) || etag(readFileSync(f)) !== o.ifMatch)) { const e = new Error('Precondition failed'); e.name = 'BlobPreconditionFailedError'; throw e; }
    mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, b); return { etag: etag(b) };
  },
  async del() { throw new Error('Löschen ist in dieser Attrappe nicht vorgesehen'); },
};
