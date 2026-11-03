// Storage layer. Everything the backend keeps goes through ONE small interface, so the place where data lives can change
// without touching the rest of the code:
//   getJSON(key) / setJSON(key, value, { onlyIfNew }) / getBytes(key) / setBytes(key, bytes, meta) / delete(key) / list(prefix)
// Drivers:
//   "blobs"  - Netlify Blobs (default on Netlify; included in every Netlify plan, no setup)
//   "fs"     - a folder on disk (default on your computer / a VPS)
//   "memory" - in memory only (automated tests)
// Two namespaces are used: "db" (records: users, sessions, try-on jobs) and "files" (images).
import { mkdir, readFile, writeFile, rename, rm, readdir, open } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,400}$/
export function checkKey(key) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//') || key.endsWith('/')) throw new Error('invalid storage key')
  return key
}

// ---------------- memory ----------------
class MemoryStore {
  constructor() { this.m = new Map() }
  async getJSON(k) { const v = this.m.get(checkKey(k)); return v && v.json !== undefined ? structuredClone(v.json) : null }
  async setJSON(k, value, { onlyIfNew } = {}) { checkKey(k); if (onlyIfNew && this.m.has(k)) return false; this.m.set(k, { json: structuredClone(value) }); return true }
  async getBytes(k) { const v = this.m.get(checkKey(k)); return v && v.bytes ? { bytes: v.bytes.slice(), meta: { ...v.meta } } : null }
  async setBytes(k, bytes, meta = {}) { this.m.set(checkKey(k), { bytes: new Uint8Array(bytes), meta: { ...meta } }) }
  async delete(k) { this.m.delete(checkKey(k)) }
  async list(prefix = '') { return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort() }
}

// ---------------- fs ----------------
// key "tryons/u_1/abc" -> <dir>/<ns>/tryons/u_1/abc.json (records) or .bin + .meta.json (files). Writes are atomic (temp + rename).
class FsStore {
  constructor(dir) { this.dir = dir }
  path(k, ext) { return join(this.dir, ...checkKey(k).split('/')) + ext }
  async write(p, data) { await mkdir(dirname(p), { recursive: true }); const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(tmp, data); await rename(tmp, p) }
  async getJSON(k) { try { return JSON.parse(await readFile(this.path(k, '.json'), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  async setJSON(k, value, { onlyIfNew } = {}) {
    const p = this.path(k, '.json'), data = JSON.stringify(value)
    if (onlyIfNew) { // atomic "create if missing": open with the exclusive flag
      await mkdir(dirname(p), { recursive: true })
      let fh; try { fh = await open(p, 'wx') } catch (e) { if (e.code === 'EEXIST') return false; throw e }
      try { await fh.writeFile(data) } finally { await fh.close() }
      return true
    }
    await this.write(p, data); return true
  }
  async getBytes(k) {
    try { const bytes = new Uint8Array(await readFile(this.path(k, '.bin'))); let meta = {}; try { meta = JSON.parse(await readFile(this.path(k, '.meta.json'), 'utf8')) } catch { /* no meta */ } return { bytes, meta } }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  async setBytes(k, bytes, meta = {}) { await this.write(this.path(k, '.meta.json'), JSON.stringify(meta)); await this.write(this.path(k, '.bin'), bytes) }
  async delete(k) { for (const ext of ['.json', '.bin', '.meta.json']) await rm(this.path(k, ext), { force: true }) }
  async list(prefix = '') {
    const out = [], walk = async (d, rel) => {
      let ents; try { ents = await readdir(d, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(join(d, e.name), r)
        else if (e.name.endsWith('.json') && !e.name.endsWith('.meta.json')) out.push(r.slice(0, -5))
        else if (e.name.endsWith('.bin')) out.push(r.slice(0, -4))
      }
    }
    // start from the deepest folder the prefix names, then filter
    const parts = prefix.split('/'), base = parts.slice(0, -1)
    await walk(join(this.dir, ...base), base.join('/'))
    return out.filter((k) => k.startsWith(prefix)).sort()
  }
}

// ---------------- Netlify Blobs ----------------
class BlobsStore {
  constructor(store) { this.s = store }
  async getJSON(k) { return (await this.s.get(checkKey(k), { type: 'json' })) ?? null }
  async setJSON(k, value, { onlyIfNew } = {}) { const r = await this.s.setJSON(checkKey(k), value, onlyIfNew ? { onlyIfNew: true } : {}); return r?.modified !== false }
  async getBytes(k) { const r = await this.s.getWithMetadata(checkKey(k), { type: 'arrayBuffer' }); return r && r.data ? { bytes: new Uint8Array(r.data), meta: r.metadata || {} } : null }
  async setBytes(k, bytes, meta = {}) { await this.s.set(checkKey(k), bytes, { metadata: meta }) }
  async delete(k) { await this.s.delete(checkKey(k)) }
  async list(prefix = '') { const r = await this.s.list({ prefix }); return r.blobs.map((b) => b.key).sort() }
}

export async function createStorage(cfg) {
  const { driver, dir, blobs, prefix } = cfg.storage
  if (driver === 'memory') return { driver, db: new MemoryStore(), files: new MemoryStore() }
  if (driver === 'fs') return { driver, db: new FsStore(join(dir, 'db')), files: new FsStore(join(dir, 'files')) }
  const { getStore } = await import('@netlify/blobs')
  const mk = (name) => getStore({ name: `${prefix}-${name}`, consistency: 'strong', ...(blobs || {}) })
  return { driver, db: new BlobsStore(mk('db')), files: new BlobsStore(mk('files')) }
}
