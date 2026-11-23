// Reine Raum-Logik ohne Cloudflare-Abhängigkeit (testbar mit Node).
export const TIE_MS = 30;          // Abstand, bis zu dem Buzzer als gleichzeitig gelten
export const MAX_AGE_MS = 3000;    // älteste erlaubte Rückdatierung eines Buzzers

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
  };
}

export function viewForHost(st, online) {
  const R = st.round, ans = new Set(answering(st)), wrong = new Set(R.wrong), t0 = R.buzzes.length ? R.buzzes[0].t : 0;
  const gs = groups(st);
  return {
    t: 'host', round: { no: R.no, open: R.open },
    roster: st.roster.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, taken: !!st.claims[r.id], online: online ? online.has(st.claims[r.id]) : false, guest: !!r.guest })),
    buzzes: R.buzzes.map((b, i) => ({ id: b.id, name: nameOf(st, b.id), dt: Math.round(b.t - t0), rtt: b.rtt, rank: gs.find(g => g.ids.includes(b.id)).start + 1, answering: ans.has(b.id), wrong: wrong.has(b.id) })),
  };
}
