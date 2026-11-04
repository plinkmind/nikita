// Garment cut-out for photos WITHOUT a plain background (a shirt on a bed sheet, on a wooden floor, on a hanger in front of a wall).
// Used by prepGarment() only when its plain-background flood fill does not apply.
//
// How it works (all on a small working copy, about 160 px, then the result is refined at full size):
//  1. Colour models: the photo's border is taken as background, an ellipse in the middle as garment. Each is described by a few colour
//     clusters (k-means in Lab colour space, so distances match what the eye sees).
//  2. Every pixel gets a garment / background score from the two models; neighbouring pixels are encouraged to agree (a few rounds of
//     "iterated conditional modes", a cheap stand-in for a graph cut). The models are then re-learned from the result (3 rounds), so a
//     garment with a print, or a background with several colours, is learned from the picture itself.
//  3. Only the piece connected to the middle is kept; small holes inside it are filled (prints that look like the background).
//  4. The edge is refined at full size with a guided filter (follows the real fabric edge in the photo).
// It refuses (returns null) when the result is not believable: almost nothing or almost everything kept, or the garment touches most of
// the photo's border (then there is no background to remove). The caller then keeps the photo as it is.
//
// px: RGBA bytes (w x h). Returns { alpha: Uint8ClampedArray(w*h), frac, sep, L, D, W, H } or null (L, D: the working-size cut and
// garment log-odds, used by prepGarment to judge a flood-fill result).

const lin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
const fl = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
function lab(r, g, b, out, o) {
  const R = lin[r], G = lin[g], B = lin[b]
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089
  const fx = fl(X), fy = fl(Y), fz = fl(Z)
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz)
}

// deterministic k-means (farthest-point start) on a list of Lab points; returns clusters { m:[3], v (variance), w (weight) }
function kmeans(F, ids, K) {
  if (ids.length < K) K = Math.max(1, ids.length)
  if (!ids.length) return []
  const C = [], d2 = new Float32Array(ids.length).fill(1e9)
  let pick = ids[ids.length >> 1]
  for (let k = 0; k < K; k++) {
    C.push([F[pick * 3], F[pick * 3 + 1], F[pick * 3 + 2]])
    let best = -1, bi = 0
    ids.forEach((o, n) => { const e = (F[o * 3] - C[k][0]) ** 2 + (F[o * 3 + 1] - C[k][1]) ** 2 + (F[o * 3 + 2] - C[k][2]) ** 2; if (e < d2[n]) d2[n] = e; if (d2[n] > best) { best = d2[n]; bi = o } })
    pick = bi
  }
  const lab2 = new Uint8Array(ids.length)
  for (let it = 0; it < 8; it++) {
    const S = C.map(() => [0, 0, 0, 0])
    ids.forEach((o, n) => { let bk = 0, be = 1e18; for (let k = 0; k < C.length; k++) { const e = (F[o * 3] - C[k][0]) ** 2 + (F[o * 3 + 1] - C[k][1]) ** 2 + (F[o * 3 + 2] - C[k][2]) ** 2; if (e < be) { be = e; bk = k } } lab2[n] = bk; const s = S[bk]; s[0] += F[o * 3]; s[1] += F[o * 3 + 1]; s[2] += F[o * 3 + 2]; s[3]++ })
    S.forEach((s, k) => { if (s[3]) C[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]] })
  }
  const V = C.map(() => [0, 0])
  ids.forEach((o, n) => { const k = lab2[n], c = C[k]; V[k][0] += (F[o * 3] - c[0]) ** 2 + (F[o * 3 + 1] - c[1]) ** 2 + (F[o * 3 + 2] - c[2]) ** 2; V[k][1]++ })
  return C.map((m, k) => ({ m, v: Math.max(20, V[k][0] / Math.max(1, V[k][1]) / 3), w: V[k][1] / ids.length })).filter((c) => c.w > 0)
}
// log-likelihood of a Lab point under a cluster set (best cluster; isotropic Gaussian per cluster)
const ll = (G, F, o) => { let best = -1e18; for (const c of G) { const e = (F[o] - c.m[0]) ** 2 + (F[o + 1] - c.m[1]) ** 2 + (F[o + 2] - c.m[2]) ** 2, l = Math.log(c.w + 1e-3) - 1.5 * Math.log(c.v) - e / (2 * c.v); if (l > best) best = l } return best }

// a garment lying on a surface casts a soft shadow on it: every background colour also counts as background when it is darker
// (same hue, a little less colour), so the shadow is not taken for part of the garment
const shadows = (G) => G.concat(G.filter((c) => c.w > 0.05 && c.m[0] > 25).flatMap((c) => [0.75, 0.58].map((k) => ({ m: [c.m[0] * k, c.m[1] * 0.85, c.m[2] * 0.85], v: c.v, w: c.w * 0.25 }))))

// box mean of a float image (radius r), separable, O(N)
function box(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let j = 0; j < h; j++) { let s = 0; const row = j * w; for (let i = -r; i <= r; i++) s += src[row + Math.min(w - 1, Math.max(0, i))]; for (let i = 0; i < w; i++) { tmp[row + i] = s / (2 * r + 1); s += src[row + Math.min(w - 1, i + r + 1)] - src[row + Math.max(0, i - r)] } }
  for (let i = 0; i < w; i++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[Math.min(h - 1, Math.max(0, j)) * w + i]; for (let j = 0; j < h; j++) { out[j * w + i] = s / (2 * r + 1); s += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i] } }
  return out
}
// guided filter (He et al.): smooths p while following the edges of the guide image I
export function guided(I, p, w, h, r, eps) {
  const mI = box(I, w, h, r), mp = box(p, w, h, r), Ip = new Float32Array(w * h), II = new Float32Array(w * h)
  for (let o = 0; o < w * h; o++) { Ip[o] = I[o] * p[o]; II[o] = I[o] * I[o] }
  const mIp = box(Ip, w, h, r), mII = box(II, w, h, r), a = new Float32Array(w * h), b = new Float32Array(w * h)
  for (let o = 0; o < w * h; o++) { const v = mII[o] - mI[o] * mI[o], cv = mIp[o] - mI[o] * mp[o]; a[o] = cv / (v + eps); b[o] = mp[o] - a[o] * mI[o] }
  const ma = box(a, w, h, r), mb = box(b, w, h, r), q = new Float32Array(w * h)
  for (let o = 0; o < w * h; o++) q[o] = ma[o] * I[o] + mb[o]
  return q
}

export function cutBusy(px, w, h) {
  // ---- working copy (area average) ----
  const s = Math.min(1, 160 / Math.max(w, h)), W = Math.max(8, Math.round(w * s)), H = Math.max(8, Math.round(h * s)), N = W * H
  const F = new Float32Array(N * 3), acc = new Float32Array(N * 4)
  for (let j = 0; j < h; j++) { const J = Math.min(H - 1, (j * H / h) | 0); for (let i = 0; i < w; i++) { const I = Math.min(W - 1, (i * W / w) | 0), o = (j * w + i) * 4, a = (J * W + I) * 4; acc[a] += px[o]; acc[a + 1] += px[o + 1]; acc[a + 2] += px[o + 2]; acc[a + 3]++ } }
  for (let o = 0; o < N; o++) { const n = acc[o * 4 + 3] || 1; lab(Math.round(acc[o * 4] / n), Math.round(acc[o * 4 + 1] / n), Math.round(acc[o * 4 + 2] / n), F, o * 3) }
  // ---- first guess: border = background, centre ellipse = garment ----
  const band = Math.max(2, Math.round(Math.min(W, H) * 0.04)), isBorder = (i, j) => i < band || j < band || i >= W - band || j >= H - band
  const inCore = (i, j) => ((i + 0.5) / W - 0.5) ** 2 / 0.2 ** 2 + ((j + 0.5) / H - 0.52) ** 2 / 0.27 ** 2 < 1
  const bgIds = [], fgIds = []
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (isBorder(i, j)) bgIds.push(j * W + i); else if (inCore(i, j)) fgIds.push(j * W + i) }
  let GB = shadows(kmeans(F, bgIds, 6)), GF = kmeans(F, fgIds, 5)
  // the garment model must not simply copy background clusters that reach into the centre (a background seen between the sleeves):
  // a SMALL garment cluster very close to a background cluster that is common on the border is dropped (a big one is the garment itself:
  // a cream shirt on a cream wall keeps its colour, and the neighbours and position decide)
  const prune = () => { const keep = GF.filter((c) => c.w > 0.2 || !GB.some((b) => b.w > 0.1 && (c.m[0] - b.m[0]) ** 2 + (c.m[1] - b.m[1]) ** 2 + (c.m[2] - b.m[2]) ** 2 < 6 * Math.min(c.v, b.v))); if (keep.length) { const t = keep.reduce((q, c) => q + c.w, 0); GF = keep.map((c) => ({ ...c, w: c.w / t })) } }
  prune()
  const D = new Float32Array(N), L = new Uint8Array(N)
  const LAMBDA = 2.0, SYM = 1.5 // neighbour agreement (log-likelihood units per neighbour), symmetry push
  for (let round = 0; round < 3; round++) {
    for (let o = 0; o < N; o++) D[o] = Math.max(-12, Math.min(12, ll(GF, F, o * 3) - ll(GB, F, o * 3)))
    // weak prior: the border is background, the middle a little more likely garment
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const o = j * W + i; if (isBorder(i, j)) D[o] -= 3; else { const r2 = ((i + 0.5) / W - 0.5) ** 2 / 0.35 ** 2 + ((j + 0.5) / H - 0.52) ** 2 / 0.42 ** 2; D[o] += r2 < 1 ? 0.6 * (1 - r2) : 0 } }
    // symmetry: garment photos are nearly always taken from the front, so the left and right halves match. From round 2 on, a pixel
    // whose mirror image (about the garment's own centre line) is garment gets a small push toward garment, and the other way round.
    // A background blob stuck to one side (a shadow, a dark stone) has no partner on the other side.
    if (round > 0) {
      let sx = 0, n = 0; for (let o = 0; o < N; o++) if (L[o]) { sx += o % W; n++ }
      const ax = n ? sx / n : W / 2
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const mi = Math.round(2 * ax - i); if (mi < 0 || mi >= W) continue; D[j * W + i] += L[j * W + mi] ? SYM : -SYM }
    }
    // graph cut: the best garment / background split given every pixel's colour score AND a cost for cutting between similar
    // neighbours (so the cut runs along real edges in the photo)
    mincut(D, F, W, H, LAMBDA, L)
    // short gaps between garment parts that the colours cannot decide (a white stripe of a striped shirt on a light background):
    // filled when garment is found on both sides within a short distance, along rows and along columns
    closeGaps(L, D, W, H)
    // keep the garment piece that covers the middle; fill holes that do not reach the border
    keepCentre(L, W, H); fillHoles(L, W, H, 0.04)
    if (round < 2) { // re-learn both models from the current cut (eroded by one pixel so mixed edge pixels do not pollute them)
      const fi = [], bi = []
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const o = j * W + i, all = L[o] && L[o - 1] && L[o + 1] && L[o - W] && L[o + W], none = !L[o] && !L[o - 1] && !L[o + 1] && !L[o - W] && !L[o + W]; if (all) fi.push(o); else if (none) bi.push(o) }
      if (fi.length < 30 || bi.length < 30) break
      GF = kmeans(F, fi, 5); GB = shadows(kmeans(F, bi.concat(bgIds), 6)); prune()
    }
  }
  // ---- is the result believable? ----
  let n1 = 0, touch = 0, per = 0
  for (let o = 0; o < N; o++) n1 += L[o]
  for (let i = 0; i < W; i++) { per += 2; touch += L[i] + L[(H - 1) * W + i] } for (let j = 0; j < H; j++) { per += 2; touch += L[j * W] + L[j * W + W - 1] }
  const frac = n1 / N
  let sf = 0, sb = 0, cf = 0, cb = 0; for (let o = 0; o < N; o++) { const v = 1 / (1 + Math.exp(-D[o])); if (L[o]) { sf += v; cf++ } else { sb += v; cb++ } }
  const sep = (cf ? sf / cf : 0) - (cb ? sb / cb : 1) // mean garment score inside minus outside: near 1 = the two are clearly different
  cutBusy.last = { frac: +frac.toFixed(3), touch: +(touch / per).toFixed(3), sep: +sep.toFixed(3) } // for tests
  if (frac < 0.06 || frac > 0.9 || touch / per > 0.35 || sep < 0.45) return null
  return { alpha: refine(px, w, h, L, W, H), frac, sep, L, D, W, H }
}

// full-size edge for a working-size cut L (W x H): soft label upsampled, then a guided filter on the photo's brightness
export function refine(px, w, h, L, W, H) {
  const N = W * H, s = W / w
  const soft = new Float32Array(N); for (let o = 0; o < N; o++) soft[o] = L[o]
  const sm = box(soft, W, H, 1), Ifull = new Float32Array(w * h), Pfull = new Float32Array(w * h)
  for (let j = 0; j < h; j++) {
    const y = Math.max(0, Math.min(H - 1.001, (j + 0.5) * H / h - 0.5)), y0 = y | 0, fy = y - y0
    for (let i = 0; i < w; i++) {
      const x = Math.max(0, Math.min(W - 1.001, (i + 0.5) * W / w - 0.5)), x0 = x | 0, fx = x - x0, o = y0 * W + x0
      Pfull[j * w + i] = (sm[o] * (1 - fx) + sm[o + 1] * fx) * (1 - fy) + (sm[o + W] * (1 - fx) + sm[o + W + 1] * fx) * fy
      const q = (j * w + i) * 4; Ifull[j * w + i] = (0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2]) / 255
    }
  }
  const r = Math.max(2, Math.round(1.5 / s)), q = guided(Ifull, Pfull, w, h, r, 0.002)
  const alpha = new Uint8ClampedArray(w * h)
  for (let o = 0; o < w * h; o++) { const v = (q[o] - 0.3) / 0.4; alpha[o] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * v * (3 - 2 * v) * 255) }
  return alpha
}

export function tidy(L, W, H) { keepCentre(L, W, H); fillHoles(L, W, H, 0.04) }

// keep only the 4-connected label-1 piece with the most pixels inside the middle third (others become 0)
function keepCentre(L, W, H) {
  const lab = new Int32Array(W * H), score = [0]
  for (let o0 = 0; o0 < W * H; o0++) {
    if (!L[o0] || lab[o0]) continue
    const id = score.length, st = [o0]; lab[o0] = id; let sc = 0
    while (st.length) { const o = st.pop(), i = o % W, j = (o / W) | 0; sc += (i > W / 3 && i < 2 * W / 3 && j > H / 3 && j < 2 * H / 3) ? 10 : 1; for (const nb of [i + 1 < W ? o + 1 : -1, i > 0 ? o - 1 : -1, j + 1 < H ? o + W : -1, j > 0 ? o - W : -1]) if (nb >= 0 && L[nb] && !lab[nb]) { lab[nb] = id; st.push(nb) } }
    score.push(sc)
  }
  let best = 0; score.forEach((v, k) => { if (v > score[best]) best = k })
  for (let o = 0; o < W * H; o++) if (L[o] && lab[o] !== best) L[o] = 0
}
// background pieces that do not touch the border and are smaller than maxFrac of the picture are filled
function fillHoles(L, W, H, maxFrac) {
  const seen = new Uint8Array(W * H)
  for (let o0 = 0; o0 < W * H; o0++) {
    if (L[o0] || seen[o0]) continue
    const st = [o0], piece = []; seen[o0] = 1; let edge = false
    while (st.length) { const o = st.pop(), i = o % W, j = (o / W) | 0; piece.push(o); if (!i || !j || i === W - 1 || j === H - 1) edge = true; for (const nb of [i + 1 < W ? o + 1 : -1, i > 0 ? o - 1 : -1, j + 1 < H ? o + W : -1, j > 0 ? o - W : -1]) if (nb >= 0 && !L[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb) } }
    if (!edge && piece.length < W * H * maxFrac) for (const o of piece) L[o] = 1
  }
}

// minimum s-t cut on the pixel grid (Dinic's max-flow). D: garment log-odds per pixel (>0 garment), F: Lab colours, 8 neighbours with
// weight lambda * exp(-colour difference / 2 sigma^2) / distance. Writes 1 (garment) / 0 into L.
function mincut(D, F, W, H, lambda, L) {
  const N = W * H, S = N, T = N + 1, V = N + 2
  const maxE = N * 8 + N * 2 + 8, to = new Int32Array(maxE), cap = new Float32Array(maxE), nxt = new Int32Array(maxE), head = new Int32Array(V).fill(-1)
  let E = 0
  const add = (a, b, c1, c2) => { to[E] = b; cap[E] = c1; nxt[E] = head[a]; head[a] = E++; to[E] = a; cap[E] = c2; nxt[E] = head[b]; head[b] = E++ }
  // mean colour difference between neighbours sets sigma (adapts to how textured the photo is)
  let sum = 0, cnt = 0
  for (let j = 0; j < H; j++) for (let i = 0; i < W - 1; i++) { const o = j * W + i, q = o + 1; sum += (F[o * 3] - F[q * 3]) ** 2 + (F[o * 3 + 1] - F[q * 3 + 1]) ** 2 + (F[o * 3 + 2] - F[q * 3 + 2]) ** 2; cnt++ }
  const beta = 1 / (2 * Math.max(4, sum / cnt))
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = j * W + i
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const ii = i + di, jj = j + dj; if (ii < 0 || ii >= W || jj >= H) continue
      const q = jj * W + ii, c = (F[o * 3] - F[q * 3]) ** 2 + (F[o * 3 + 1] - F[q * 3 + 1]) ** 2 + (F[o * 3 + 2] - F[q * 3 + 2]) ** 2
      const w = lambda * Math.exp(-beta * c) / (di && dj ? 1.414 : 1); add(o, q, w, w)
    }
    if (D[o] > 0) add(S, o, D[o], 0); else if (D[o] < 0) add(o, T, -D[o], 0)
  }
  const level = new Int32Array(V), it = new Int32Array(V), qu = new Int32Array(V), EPS = 1e-5
  const bfs = () => { level.fill(-1); let a = 0, b = 0; qu[b++] = S; level[S] = 0; while (a < b) { const u = qu[a++]; for (let e = head[u]; e >= 0; e = nxt[e]) if (cap[e] > EPS && level[to[e]] < 0) { level[to[e]] = level[u] + 1; qu[b++] = to[e] } } return level[T] >= 0 }
  const stack = new Int32Array(V), path = new Int32Array(V)
  const dfs = () => { // one augmenting path along the level graph (iterative); returns the flow pushed
    let sp = 0; stack[0] = S
    while (sp >= 0) {
      const u = stack[sp]
      if (u === T) { let f = Infinity; for (let k = 0; k < sp; k++) f = Math.min(f, cap[path[k]]); for (let k = 0; k < sp; k++) { cap[path[k]] -= f; cap[path[k] ^ 1] += f } return f }
      let e = it[u]
      while (e >= 0 && !(cap[e] > EPS && level[to[e]] === level[u] + 1)) e = nxt[e]
      it[u] = e
      if (e < 0) { level[u] = -1; sp--; if (sp >= 0) it[stack[sp]] = nxt[it[stack[sp]]]; continue }
      path[sp] = e; stack[++sp] = to[e]
    }
    return 0
  }
  let rounds = 0
  while (bfs() && rounds++ < 200) { for (let v = 0; v < V; v++) it[v] = head[v]; while (dfs() > 0) {} }
  // garment = reachable from the source in what is left of the network
  L.fill(0); const seen = new Uint8Array(V); let a = 0, b = 0; qu[b++] = S; seen[S] = 1
  while (a < b) { const u = qu[a++]; if (u < N) L[u] = 1; for (let e = head[u]; e >= 0; e = nxt[e]) if (cap[e] > EPS && !seen[to[e]]) { seen[to[e]] = 1; qu[b++] = to[e] } }
}

// fill runs of background no longer than 7% of the picture height (columns) or 3.5% of its width (rows), with garment at both ends,
// whose colour score is not clearly background (D > -2 on average), or (keep given) where keep(first pixel of the gap) says so
export function closeGaps(L, D, W, H, keep) {
  const run = (len, at, lim) => {
    let last = -1
    for (let k = 0; k < len; k++) {
      if (!L[at(k)]) continue
      if (last >= 0 && k - last > 1 && k - last - 1 <= lim) { let s = 0; for (let m = last + 1; m < k; m++) s += D[at(m)]; if (keep ? keep(at(last + 1)) : s / (k - last - 1) > -2) for (let m = last + 1; m < k; m++) L[at(m)] = 1 }
      last = k
    }
  }
  const limV = Math.round(H * 0.07), limH = Math.round(W * 0.035) // (rows: shorter, so the gap under a sleeve is not filled)
  for (let i = 0; i < W; i++) run(H, (k) => k * W + i, limV)
  for (let j = 0; j < H; j++) run(W, (k) => j * W + k, limH)
}
