import * as L from './logic.js';
import assert from 'node:assert/strict';
const st = L.newState('k', 0);
L.setRoster(st, [{id:'a',name:'Anna'},{id:'b',name:'Ben'},{id:'c',name:'Chris'},{id:'d',name:'Dana'}]);
assert.equal(L.claim(st,'dev1','a'),'ok'); assert.equal(L.claim(st,'dev2','a'),'taken');
assert.equal(L.claim(st,'dev2','b'),'ok'); assert.equal(L.claim(st,'dev3','c'),'ok'); assert.equal(L.claim(st,'dev4','d'),'ok');
// Wechsel des Namens gibt den alten frei
assert.equal(L.claim(st,'dev1','d'),'taken'); assert.equal(L.ridOf(st,'dev1'),'a');
// Buzzer vor Öffnen ignoriert
assert.equal(L.buzz(st,'a',1000,1000),false);
L.openRound(st, 1000);
assert.ok(L.buzz(st,'b',1100,1200,40));
assert.ok(L.buzz(st,'a',1090,1210,60));        // 10 ms vor Ben -> Anna ist klar die Erste
assert.ok(L.buzz(st,'c',1200,1300,30));        // 110 ms später
assert.ok(!L.buzz(st,'a',1500,1500));          // doppelt
assert.ok(L.buzz(st,'d',9999,1600));           // Zukunft wird auf now geklemmt
let g = L.groups(st); assert.deepEqual(g.map(x=>x.ids), [['a'],['b'],['c'],['d']]); assert.deepEqual(g.map(x=>x.start),[0,1,2,3]);
assert.deepEqual(L.answering(st), ['a']);
let v = L.viewForPlayer(st,'dev1'); assert.equal(v.round.mine.rank,1); assert.equal(v.round.mine.answering,true);
v = L.viewForPlayer(st,'dev2'); assert.equal(v.round.mine.rank,2); assert.equal(v.round.mine.answering,false);
v = L.viewForPlayer(st,'dev3'); assert.equal(v.round.mine.rank,3); assert.equal(v.round.mine.answering,false);
v = L.viewForPlayer(st,'dev4'); assert.equal(v.round.mine.rank,4);
L.wrongNext(st); assert.deepEqual(L.answering(st),['b']); L.wrongNext(st); assert.deepEqual(L.answering(st),['c']);
assert.equal(L.viewForPlayer(st,'dev1').round.mine.wrong,true);
L.wrongNext(st); assert.deepEqual(L.answering(st),['d']); L.wrongNext(st); assert.deepEqual(L.answering(st),[]);
let h = L.viewForHost(st,new Set(['dev1','dev2'])); assert.equal(h.buzzes[0].dt,0); assert.equal(h.buzzes[1].dt,10); assert.equal(h.buzzes[2].dt,110); assert.deepEqual(h.buzzes.map(b=>b.rank),[1,2,3,4]);
// Neue Runde leert
L.openRound(st,2000); assert.equal(st.round.buzzes.length,0); assert.equal(st.round.no,2);
// Zu alte Zeitstempel werden begrenzt
L.buzz(st,'a',0,5000); assert.equal(st.round.buzzes[0].t,2000);
// Gast
assert.equal(L.addGuest(st,'dev9','Oma'),'ok'); assert.equal(L.addGuest(st,'dev8','oma'),'exists');
L.setRoster(st,[{id:'a',name:'Anna'}]); assert.ok(st.roster.some(r=>r.name==='Oma')); assert.ok(!st.claims.b);
// Reset ohne neue Runde
L.resetBuzz(st); assert.equal(st.round.buzzes.length,0);

// ---- Fragen mit Antworten am Handy ----
assert.equal(L.askQuestion(st,{input:'tap',text:'F?',options:['x']},5000),false);            // zu wenige Optionen
assert.equal(L.askQuestion(st,{input:'dial',text:'S?',est:{min:5,max:5}},5000),false);        // ungültige Spanne
assert.equal(L.askQuestion(st,{input:'foo'},5000),false);
assert.ok(L.askQuestion(st,{input:'tap',text:'Flagge?',options:['A1','B2','C3','D4']},5000));
assert.equal(st.q.no,1);
assert.equal(L.submitAnswer(st,'a',1),'ok'); assert.equal(L.submitAnswer(st,'a',2),'dup');
assert.equal(L.submitAnswer(st,'g1',9),'bad'); assert.equal(L.submitAnswer(st,'zz',0),'bad');
let pv = L.viewForPlayer(st,'dev1'); assert.equal(pv.q.mine,true); assert.equal(pv.q.v,1);
pv = L.viewForPlayer(st,'dev9'); assert.equal(pv.q.mine,false); assert.equal(pv.q.v,null); assert.equal(pv.q.options.length,4);
let hv = L.viewForHost(st,null,{}); assert.deepEqual(hv.q.answers.map(x=>[x.id,x.v]),[['a',1]]);
L.lockQuestion(st); assert.equal(L.submitAnswer(st,'g1',0),'closed');
L.openQuestion(st); assert.equal(L.submitAnswer(st,'g1',0),'ok');
// Schätzen
assert.ok(L.askQuestion(st,{input:'dial',text:'Höhe?',est:{min:0,max:200,unit:'m'}},6000)); assert.equal(st.q.no,2); assert.equal(st.q.est.step,1);
assert.equal(L.submitAnswer(st,'a',999),'ok'); assert.equal(st.q.answers.a.v,200);        // geklemmt
assert.equal(L.submitAnswer(st,'g1','abc'),'bad');
assert.equal(L.niceStep(4000),20); assert.equal(L.niceStep(10),0.05);
// Tippen
assert.ok(L.askQuestion(st,{input:'type',text:'Wer?'},7000)); assert.equal(L.submitAnswer(st,'a','   '),'bad');
assert.equal(L.submitAnswer(st,'a','Canberra'),'ok'); assert.equal(st.q.answers.a.v,'Canberra');
// Handschrift
assert.ok(L.askQuestion(st,{input:'hand',text:'Zeichne'},8000));
assert.equal(L.submitAnswer(st,'a','data:image/png;base64,xx'),'bad');
assert.equal(L.submitAnswer(st,'a','data:image/jpeg;base64,'+'A'.repeat(L.HAND_MAX)),'bad');
assert.equal(L.submitAnswer(st,'a','data:image/jpeg;base64,AAAA'),'hand');
hv = L.viewForHost(st,null,{a:'data:image/jpeg;base64,AAAA'}); assert.equal(hv.q.answers[0].v,'data:image/jpeg;base64,AAAA');
assert.equal(L.viewForPlayer(st,'dev1').q.v,null);
L.clearQuestion(st); assert.equal(L.viewForPlayer(st,'dev1').q,null); assert.equal(L.viewForHost(st).q,null);

console.log('LOGIC OK');

// ---- Einwurf (Olympiade-Raum) ----
{
  const so = L.newState('k', 1, 'oly'); assert.equal(so.kind, 'oly'); assert.equal(L.newState('k',1).kind, 'quiz');
  L.setRoster(so, [{id:'m',name:'Mia'},{id:'b',name:'Ben'}]); L.claim(so, 'devM', 'm');
  assert.equal(L.dropStart(so, 'm', { name: 'Länder', n: 2, bytes: 200000, qn: 12 }), 'ok');
  assert.equal(L.dropInfo(so, 'm').has, false);
  assert.equal(L.dropChunk(so, 'm', 0, 'x'.repeat(100)), 'ok');
  assert.equal(L.dropChunk(so, 'm', 5, 'x'), 'bad');
  assert.equal(L.dropChunk(so, 'm', 1, 'y'.repeat(L.CHUNK_MAX + 1)), 'bad');
  assert.equal(L.dropChunk(so, 'm', 1, 'y'), 'done');
  assert.deepEqual(L.dropInfo(so, 'm'), { has: true, name: 'Länder', qn: 12, bytes: 200000, n: 2 });
  assert.equal(L.dropStart(so, 'm', { name: 'x', n: 1, bytes: L.DROP_MAX + 1 }), 'bad');
  assert.ok(!JSON.stringify(L.viewForHost(so, new Set(), {})).includes('Länder'), 'Host sieht Einwurf nicht');
  assert.equal(L.viewForPlayer(so, 'devM').drop.has, true);
  assert.equal(L.viewForPlayer(so, 'devB').drop, null);
  L.dropDel(so, 'm'); assert.equal(L.dropInfo(so, 'm').has, false);
  console.log('EINWURF OK');
}

// ---- Spielleiter ----
{
  const sl = L.newState('k', 1, 'oly'); L.setRoster(sl, [{id:'m',name:'Mia'},{id:'b',name:'Ben'}]); L.claim(sl,'dM','m'); L.claim(sl,'dB','b');
  assert.equal(L.gameStart(sl, 'x', 'T'), false);
  assert.equal(L.gameStart(sl, 'm', 'Länder'), true); assert.equal(L.isLeader(sl,'m'), true); assert.equal(L.isLeader(sl,'b'), false);
  L.openRound(sl, 100); assert.equal(L.buzz(sl, 'm', 100, 100, 0), false, 'Leiter buzzert nicht'); assert.equal(L.buzz(sl, 'b', 100, 100, 0), true);
  assert.equal(L.viewForPlayer(sl,'dM').game.mine, true); assert.equal(L.viewForPlayer(sl,'dB').game.mine, false); assert.equal(L.viewForPlayer(sl,'dB').game.leader, 'Mia');
  assert.equal(L.viewForHost(sl, new Set(), {}).leader, 'm');
  L.gameEnd(sl); assert.equal(sl.leader, null); assert.equal(L.viewForPlayer(sl,'dB').game, null);
  console.log('SPIELLEITER OK');
}

// ---- Vorbereitung und Start durch den Spielleiter ----
{
  const sp = L.newState('k', 1, 'oly'); L.setRoster(sp, [{id:'m',name:'Mia'},{id:'b',name:'Ben'}]); L.claim(sp,'dM','m'); L.claim(sp,'dB','b');
  assert.equal(L.gamePrep(sp, 'x', 'T', true), false); assert.equal(L.gamePrep(sp, 'm', 'Länder', true), true);
  assert.deepEqual(L.viewForPlayer(sp,'dM').prep, { title: 'Länder', quiz: true, mine: true }); assert.equal(L.viewForPlayer(sp,'dB').prep.mine, false);
  assert.equal(L.leadStart(sp, 'b'), false); assert.equal(sp.leader, null);
  assert.equal(L.leadStart(sp, 'm'), true); assert.equal(sp.leader, 'm'); assert.equal(L.viewForPlayer(sp,'dB').prep, null); assert.equal(L.viewForPlayer(sp,'dM').game.mine, true);
  L.gameEnd(sp); assert.equal(sp.prep, null);
  console.log('VORBEREITUNG OK');
}
