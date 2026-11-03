// Minimal .env loader (KEY=value lines, # comments). Existing environment variables always win.
import { readFileSync } from 'node:fs'
export function loadDotEnv(path) {
  let text; try { text = readFileSync(path, 'utf8') } catch { return }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue
    let v = m[2]; if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '') // KEY=value  # comment
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
