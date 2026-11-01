// Saved looks and favourites, kept in this browser only (localStorage). Nothing is uploaded and there is no cloud sync.
// Every call is wrapped in try/catch because some browsers (private mode) block storage.
const LOOKS = 'glamify.looks.v1', FAVS = 'glamify.favs.v1', MAX = 24
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || [] } catch { return [] } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

export const getLooks = () => read(LOOKS)
export function saveLook(state, thumb, label) {
  const looks = getLooks(), n = (looks.reduce((m, l) => Math.max(m, l.n || 0), 0)) + 1
  const look = { id: 'l' + Date.now(), n, name: (label || 'Look') + ' ' + n, ts: Date.now(), state: JSON.parse(JSON.stringify(state)), thumb: thumb || null }
  looks.unshift(look)
  return write(LOOKS, looks.slice(0, MAX)) ? look : null // null = the browser refused to store it
}
export const deleteLook = (id) => write(LOOKS, getLooks().filter((l) => l.id !== id))
export const getFavs = () => read(FAVS)
export const isFav = (id) => getFavs().includes(id)
export function toggleFav(id) { const f = getFavs(), i = f.indexOf(id); if (i < 0) f.push(id); else f.splice(i, 1); write(FAVS, f); return i < 0 }
