// Optional account: sign in / create account / profile. The whole site works without an account (guest mode);
// an account keeps your AI try-on looks (history) instead of removing them after 24 hours.
import './account.css'
import { api, session } from '../api/client.js'

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmt = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' } }

let root = null, mode = 'login', busy = false, msg = '', msgKind = '', profile = null, available = true
const draft = { email: '', name: '' } // what the person typed, kept when the form re-renders (e.g. after a wrong password)

function render() {
  const u = session.user
  const head = `<div class="ac-head"><div><span class="ac-k">Glamify Mirror Me</span><h2>${u ? 'Your account' : mode === 'login' ? 'Welcome back' : 'Create your account'}</h2></div><button class="ac-x" data-ac="close" aria-label="Close">&times;</button></div>`
  const note = msg ? `<p class="ac-msg ${msgKind}" role="${msgKind === 'err' ? 'alert' : 'status'}">${esc(msg)}</p>` : ''
  let body
  if (!available) body = `<p class="ac-msg err">Accounts are not available on this copy of the website (no backend is running). Everything else still works.</p>`
  else if (u) {
    body = `<div class="ac-card">
        <label class="ac-f">Name<input data-ac-name maxlength="60" value="${esc(u.name)}" autocomplete="name" placeholder="Your name"></label>
        <p class="ac-row"><span>E-mail</span><b>${esc(u.email)}</b></p>
        <p class="ac-row"><span>Member since</span><b>${fmt(u.createdAt)}</b></p>
        <p class="ac-row"><span>Saved AI looks</span><b>${profile ? profile.stats.looks : '&hellip;'}</b></p>
        <div class="ac-btns"><button class="ac-primary" data-ac="save"${busy ? ' disabled' : ''}>Save name</button><button data-ac="looks">My looks</button><button data-ac="logout"${busy ? ' disabled' : ''}>Sign out</button></div>
      </div>
      <details class="ac-danger"><summary>Delete my account</summary>
        <p>This permanently deletes your account and all your saved looks. It cannot be undone.</p>
        <label class="ac-f">Your password<input type="password" data-ac-delpw autocomplete="current-password"></label>
        <button class="ac-del" data-ac="delete"${busy ? ' disabled' : ''}>Delete account and data</button>
      </details>`
  } else {
    const reg = mode === 'register'
    body = `<form class="ac-card" data-ac-form novalidate>
        ${reg ? `<label class="ac-f">Name <small>(optional)</small><input name="name" maxlength="60" autocomplete="name" value="${esc(draft.name)}"></label>` : ''}
        <label class="ac-f">E-mail<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(draft.email)}"></label>
        <label class="ac-f">Password${reg ? ' <small>(at least 8 characters)</small>' : ''}<input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
        <button class="ac-primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Please wait&hellip;' : reg ? 'Create account' : 'Sign in'}</button>
        <p class="ac-switch">${reg ? 'Already have an account?' : 'New here?'} <button type="button" data-ac="${reg ? 'to-login' : 'to-register'}">${reg ? 'Sign in' : 'Create an account'}</button></p>
        <p class="ac-fine">An account keeps your AI try-on looks. Without one you can still use everything as a guest; guest looks are removed after 24 hours. Passwords are stored only as a secure hash.</p>
      </form>`
  }
  root.querySelector('.ac-box').innerHTML = head + note + body
}

function setMsg(t, kind = 'ok') { msg = t; msgKind = kind; render() }
async function loadProfile() { try { profile = await api.profile() } catch { profile = null } if (root && !root.hidden) render() }

export function openAccount(startMode) {
  if (startMode) mode = startMode
  msg = ''; root.hidden = false; document.body.classList.add('ac-open'); render()
  if (session.user) loadProfile()
  root.querySelector('input, button.ac-primary')?.focus({ preventScroll: true })
}
function close() { root.hidden = true; document.body.classList.remove('ac-open') }

export function initAccount() {
  root = document.createElement('div'); root.className = 'ac'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Your account')
  root.innerHTML = '<div class="ac-box"></div>'; document.body.appendChild(root)
  root.addEventListener('click', async (e) => {
    if (e.target === root) return close()
    const b = e.target.closest('[data-ac]'); if (!b) return
    const a = b.dataset.ac
    if (a === 'close') return close()
    if (a === 'to-login' || a === 'to-register') { mode = a === 'to-login' ? 'login' : 'register'; msg = ''; return render() }
    if (a === 'looks') { close(); document.querySelector('[data-aitryon]')?.click(); return }
    busy = true; render()
    try {
      if (a === 'save') { const r = await api.updateProfile(root.querySelector('[data-ac-name]').value); session.set(r.user); busy = false; return setMsg('Saved.') }
      if (a === 'logout') { await api.logout(); profile = null; session.set(null); busy = false; mode = 'login'; return setMsg('You are signed out.') }
      if (a === 'delete') { await api.deleteAccount(root.querySelector('[data-ac-delpw]').value); profile = null; session.set(null); busy = false; mode = 'register'; return setMsg('Your account and all its data have been deleted.') }
    } catch (er) { busy = false; setMsg(er.message, 'err') }
  })
  root.addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = new FormData(e.target), email = String(f.get('email') || ''), pw = String(f.get('password') || '')
    draft.email = email; draft.name = String(f.get('name') || '')
    if (!email || !pw) return setMsg('Please enter your e-mail and password.', 'err')
    busy = true; render()
    try {
      const r = mode === 'register' ? await api.register(email, pw, String(f.get('name') || '')) : await api.login(email, pw)
      busy = false; draft.email = draft.name = ''; session.set(r.user)
      setMsg(r.claimedLooks ? `Welcome! ${r.claimedLooks} look${r.claimedLooks > 1 ? 's' : ''} from this visit ${r.claimedLooks > 1 ? 'were' : 'was'} saved to your account.` : mode === 'register' ? 'Your account is ready.' : 'You are signed in.')
      loadProfile()
    } catch (er) { busy = false; setMsg(er.message, 'err') }
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close() })

  // header button: shows "Sign in" or the person's name
  const paint = (u) => document.querySelectorAll('[data-account]').forEach((b) => {
    b.classList.toggle('in', !!u); const t = b.querySelector('.acct-t'); if (t) t.textContent = u ? (u.name || u.email.split('@')[0]) : 'Sign in'
    b.setAttribute('aria-label', u ? `Your account (${u.email})` : 'Sign in or create an account')
  })
  session.on((u) => { paint(u); if (root && !root.hidden) render() })
  document.querySelectorAll('[data-account]').forEach((b) => b.addEventListener('click', () => openAccount()))
  api.me().then((r) => session.set(r.user)).catch((e) => { session.set(null); if (e.code === 'offline' || e.code === 'not_api' || e.status === 404) available = false })
}
