// All API routes in one place. ":name" segments become ctx.params.name.
import { authController as A } from './controllers/authController.js'
import { userController as U } from './controllers/userController.js'
import { tryonController as T } from './controllers/tryonController.js'
import { healthController as H } from './controllers/healthController.js'

export const ROUTES = [
  ['GET', '/api/health', H.health],
  ['POST', '/api/auth/register', A.register],
  ['POST', '/api/auth/login', A.login],
  ['POST', '/api/auth/logout', A.logout],
  ['GET', '/api/auth/me', A.me],
  ['GET', '/api/user/profile', U.profile],
  ['PATCH', '/api/user/profile', U.update],
  ['DELETE', '/api/user', U.remove],
  ['POST', '/api/tryon/generate', T.generate],
  ['GET', '/api/tryon/status/:id', T.status],
  ['GET', '/api/tryon/history', T.history],
  ['POST', '/api/tryon/:id/complete', T.complete],
  ['POST', '/api/tryon/:id/fail', T.fail],
  ['DELETE', '/api/tryon/:id', T.remove],
  ['GET', '/api/images/:id/:kind', T.image],
]

const compiled = ROUTES.map(([method, path, handler]) => {
  const names = [], re = new RegExp('^' + path.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([A-Za-z0-9_-]{1,64})' }) + '/?$')
  return { method, re, names, handler, path }
})
export function match(method, pathname) {
  let pathMatched = false
  for (const r of compiled) {
    const m = r.re.exec(pathname); if (!m) continue
    pathMatched = true
    if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue
    return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]])) }
  }
  return { methodNotAllowed: pathMatched }
}
