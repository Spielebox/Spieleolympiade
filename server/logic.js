// Reine Raum-Logik ohne Cloudflare-Abhängigkeit (testbar mit Node).
export const TIE_MS = -1;          // keine Gleichzeitigkeit: laut ermittelter Zeit gibt es immer genau einen Ersten
export const MAX_AGE_MS = 3000;    // älteste erlaubte Rückdatierung eines Buzzers
export const HAND_MAX = 14000;     // größte erlaubte Handschrift-Antwort (Zeichen der Bild-URL)

export function newState(hostKey, now) {
  return { hostKey, created: now, roster: [], claims: {}, guestNo: 0,
    round: { no: 0, open: false, openedAt: 0, buzzes: [], wrong: [] } };
}

const clean = (s, n = 40) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

export function setRoster(st, list) {
  const guests = st.roster.filter(r => r.guest);
  st.roster = (Array.isArray(list) ? list : []).slice(0, 60).map(r => ({
    id: clean(r.id, 24), name: clean(r.name), emoji: clean(r.emoji, 8), color: clean(r.color, 12),
  })).filter(r => r.id && r.name);
  guests.forEach(g => { if (!st.roster.some(r => r.id === g.id)) st.roster.push(g); });
  Object.keys(st.claims).forEach(id => { if (!st.roster.some(r => r.id === id)) delete st.claims[id]; });
  return true;
}

export function claim(st, dev, rid) {
  const r = st.roster.find(x => x.id === rid);
  if (!r) return 'unknown';
  if (st.claims[rid] && st.claims[rid] !== dev) return 'taken';
  release(st, dev);
  st.claims[rid] = dev;
  return 'ok';
}
export function release(st, dev) { Object.keys(st.claims).forEach(id => { if (st.claims[id] === dev) delete st.claims[id]; }); }
export const ridOf = (st, dev) => Object.keys(st.claims).find(id => st.claims[id] === dev) || null;

export function addGuest(st, dev, name) {
  name = clean(name, 24); if (!name) return 'empty';
  if (st.roster.some(r => r.name.toLowerCase() === name.toLowerCase())) return 'exists';
  const id = 'g' + (++st.guestNo);
  st.roster.push({ id, name, emoji: '', color: '', guest: true });
  release(st, dev); st.claims[id] = dev;
  return 'ok';
}

export function openRound(st, now) { st.round = { no: st.round.no + 1, open: true, openedAt: now, buzzes: [], wrong: [] }; }
export function closeRound(st) { st.round.open = false; }
export function reopen(st) { st.round.open = true; }

export function buzz(st, rid, ts, now, rtt) {
  const R = st.round;
  if (!R.open || !st.roster.some(r => r.id === rid) || R.buzzes.some(b => b.id === rid)) return false;
  let t = Number(ts); if (!isFinite(t)) t = now;
  t = Math.min(now, Math.max(now - MAX_AGE_MS, t));
  R.buzzes.push({ id: rid, t, rtt: isFinite(rtt) ? Math.round(rtt) : null });
  R.buzzes.sort((a, b) => a.t - b.t);
  return true;
}

// Gruppen gleichzeitiger Buzzer: [{ids, t0, start}] (start = Index des ersten, rank = start+1)
export function groups(st) {
  const out = [];
  st.round.buzzes.forEach((b, i) => {
    const g = out[out.length - 1];
    if (g && b.t - g.t0 <= TIE_MS) g.ids.push(b.id); else out.push({ ids: [b.id], t0: b.t, start: i });
  });
  return out;
}
export function answering(st) {
  const wrong = new Set(st.round.wrong);
  for (const g of groups(st)) { const ids = g.ids.filter(i => !wrong.has(i)); if (ids.length) return ids; }
  return [];
}
export function markWrong(st, ids) { ids.forEach(i => { if (!st.round.wrong.includes(i)) st.round.wrong.push(i); }); }
export function wrongNext(st) { markWrong(st, answering(st)); }
export function resetBuzz(st) { st.round.buzzes = []; st.round.wrong = []; }

/* ---- Fragen mit Antworten am Handy ---- */
export function niceStep(span) {
  const raw = span / 200, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}
export function askQuestion(st, q, now) {
  if (!q || typeof q !== 'object') return false;
  const input = ['tap', 'type', 'hand', 'dial'].includes(q.input) ? q.input : null; if (!input) return false;
  const o = { no: 0, input, text: clean(q.text, 400), open: true, at: now, answers: {} };
  if (input === 'tap') {
    o.options = (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(x => clean(x, 80));
    if (o.options.filter(x => x).length < 2) return false;
  }
  if (input === 'dial') {
    const a = Number(q.est && q.est.min), b = Number(q.est && q.est.max);
    if (!(isFinite(a) && isFinite(b) && a < b)) return false;
    o.est = { min: a, max: b, unit: clean(q.est.unit, 12), step: niceStep(b - a) };
  }
  o.no = st.qno = (st.qno || 0) + 1; st.q = o; return true;
}
export const lockQuestion = st => { if (st.q) st.q.open = false; };
export const openQuestion = st => { if (st.q) st.q.open = true; };
export const clearQuestion = st => { st.q = null; };
// Ergebnis: 'ok' | 'hand' (Bild muss vom Aufrufer abgelegt werden) | 'closed' | 'dup' | 'bad'
export function submitAnswer(st, rid, v) {
  const Q = st.q; if (!Q || !Q.open) return 'closed';
  if (!st.roster.some(r => r.id === rid)) return 'bad';
  if (Q.answers[rid] !== undefined) return 'dup';
  if (Q.input === 'tap') { const i = Number(v); if (!Number.isInteger(i) || i < 0 || i >= Q.options.length || !Q.options[i]) return 'bad'; Q.answers[rid] = { v: i, t: Date.now() }; return 'ok'; }
  if (Q.input === 'type') { const x = clean(v, 200); if (!x) return 'bad'; Q.answers[rid] = { v: x, t: Date.now() }; return 'ok'; }
  if (Q.input === 'dial') { let n = Number(v); if (!isFinite(n)) return 'bad'; n = Math.min(Q.est.max, Math.max(Q.est.min, n)); Q.answers[rid] = { v: n, t: Date.now() }; return 'ok'; }
  if (Q.input === 'hand') { if (typeof v !== 'string' || !v.startsWith('data:image/jpeg;base64,') || v.length > HAND_MAX) return 'bad'; Q.answers[rid] = { hand: true, t: Date.now() }; return 'hand'; }
  return 'bad';
}

const nameOf = (st, id) => (st.roster.find(r => r.id === id) || {}).name || '?';

export function viewForPlayer(st, dev) {
  const me = ridOf(st, dev), R = st.round, gs = groups(st), ans = answering(st);
  let mine = null;
  if (me) {
    const g = gs.find(x => x.ids.includes(me));
    if (g) mine = { rank: g.start + 1, answering: ans.includes(me), wrong: R.wrong.includes(me) };
  }
  return {
    t: 'state', me,
    roster: st.roster.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, taken: !!st.claims[r.id], mine: r.id === me })),
    round: { no: R.no, open: R.open, mine, answering: ans.map(i => nameOf(st, i)), anyBuzz: R.buzzes.length > 0 },
    q: st.q ? { no: st.q.no, input: st.q.input, text: st.q.text, options: st.q.options || null, est: st.q.est || null, open: st.q.open, mine: me ? st.q.answers[me] !== undefined : false, v: me && st.q.answers[me] && !st.q.answers[me].hand ? st.q.answers[me].v : null } : null,
  };
}

export function viewForHost(st, online, hand) {
  const R = st.round, ans = new Set(answering(st)), wrong = new Set(R.wrong), t0 = R.buzzes.length ? R.buzzes[0].t : 0;
  const gs = groups(st);
  return {
    t: 'host', round: { no: R.no, open: R.open },
    roster: st.roster.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, taken: !!st.claims[r.id], online: online ? online.has(st.claims[r.id]) : false, guest: !!r.guest })),
    buzzes: R.buzzes.map((b, i) => ({ id: b.id, name: nameOf(st, b.id), dt: Math.round(b.t - t0), rtt: b.rtt, rank: gs.find(g => g.ids.includes(b.id)).start + 1, answering: ans.has(b.id), wrong: wrong.has(b.id) })),
    q: st.q ? { no: st.q.no, input: st.q.input, open: st.q.open, est: st.q.est || null,
      answers: Object.keys(st.q.answers).map(id => { const a = st.q.answers[id]; return { id, name: nameOf(st, id), v: a.hand ? ((hand && hand[id]) || null) : a.v, t: a.t }; }).sort((x, y) => x.t - y.t) } : null,
  };
}
