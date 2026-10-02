const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const NAMES = require('./names');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));
app.get('/health', (q, res) => res.send('ok'));

// ---- Ajustes del juego (cámbialos aquí) ----
const MAXP = 8;          // máximo de jugadores por sala
const GOAL = 4;          // personajes que hay que conseguir
const MONEY = 50;        // dinero inicial
const OPEN_MS = 15000;   // segundos para ofertar desde que el anfitrión abre las ofertas
const BID_MS = 8000;     // tiempo extra tras cada puja
const DELAY = [2, 3, 4]; // retraso máximo de la voz por dificultad (s)
const MAX_PLAYS = 2;     // veces que se puede oír la voz en cada subasta
const ROULETTE_MS = 4500; // duración de la ruleta en caso de empate

const rooms = {};
const bySock = {};
let pidSeq = 0;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const spoken = n => n.replace(/\(.*?\)/g, '').replace('$', '').replace(/\./g, ' ').trim();
const key = n => spoken(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const dedupe = arr => { const seen = new Set(); return arr.filter(n => { const k = key(n); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const POOL = { f: dedupe(NAMES.f), k: dedupe(NAMES.k) };
const freeLeft = r => POOL[r.mode].filter(n => !r.used.has(key(n)));
const find = (r, id) => r.players.find(p => p.id === id);
const minCount = r => Math.min(...r.players.map(p => p.roster.length));
const allDone = r => minCount(r) >= GOAL;
const eligible = r => { const m = minCount(r); return m >= GOAL ? [] : r.players.filter(p => p.roster.length === m); };

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms[c]);
  return c;
}

function view(r) {
  const el = eligible(r);
  return {
    code: r.code, hostId: r.hostId, phase: r.phase, mode: r.mode, dif: r.dif, vol: r.vol, vv: r.vv,
    goal: GOAL, round: allDone(r) ? GOAL : minCount(r) + 1,
    bid: r.bid, bidder: r.bidder,
    ms: r.phase === 'roulette' ? Math.max(0, r.endsAt - Date.now()) : (r.phase === 'auction' && r.bidsOpen ? (r.paused ? r.pausedLeft : Math.max(0, r.endsAt - Date.now())) : 0),
    paused: !!r.paused, bidsOpen: !!r.bidsOpen, plays: r.plays || 0, maxPlays: MAX_PLAYS, openMs: OPEN_MS,
    auc: r.auc,
    sealed: r.auc === 'blind' && r.phase === 'auction' ? Object.keys(r.sealed) : [],
    reveal: r.phase === 'roulette' ? r.reveal : null,
    last: r.last,
    players: r.players.map(p => ({ id: p.id, name: p.name, money: p.money, roster: p.roster, on: p.on, eligible: el.includes(p) })),
    offers: r.offers,
    voted: r.phase === 'vote' ? Object.keys(r.votes) : [],
    results: r.results
  };
}
function push(r) { io.to(r.code).emit('state', view(r)); }

function pickName(r) {
  let pool = freeLeft(r);
  if (!pool.length) { r.used.clear(); pool = POOL[r.mode]; } // solo si se agotaron todos
  const n = pool[Math.floor(Math.random() * pool.length)];
  r.used.add(key(n));
  return n;
}

function sell(r, p, price, how) {
  clearTimeout(r.timer);
  r.paused = false; r.bidsOpen = false;
  p.money -= price;
  p.roster.push(r.cur);
  r.last = { name: r.cur, winner: p.id, price, how, bids: r.reveal ? r.reveal.bids : null, tie: r.reveal ? r.reveal.tie : null };
  r.phase = 'sold';
  push(r);
}

function closeBlind(r) {
  if (r.phase !== 'auction') return;
  clearTimeout(r.timer);
  const ids = Object.keys(r.sealed);
  const max = Math.max(...ids.map(i => r.sealed[i]));
  const top = ids.filter(i => r.sealed[i] === max);
  r.reveal = { bids: { ...r.sealed }, tie: top.length > 1 ? top : null };
  if (top.length > 1) { // empate: ruleta entre los empatados
    const winner = top[Math.floor(Math.random() * top.length)];
    r.phase = 'roulette';
    r.endsAt = Date.now() + ROULETTE_MS;
    push(r);
    r.timer = setTimeout(() => sell(r, find(r, winner), max, 'blind'), ROULETTE_MS);
  } else {
    sell(r, find(r, top[0]), max, 'blind');
  }
}

function close(r) {
  if (r.phase !== 'auction') return;
  if (r.auc === 'blind' && Object.keys(r.sealed).length) return closeBlind(r);
  if (r.bidder) return sell(r, find(r, r.bidder), r.bid, 'bid');
  // nadie pujó: se lo lleva gratis un jugador elegible al azar
  const el = eligible(r);
  const on = el.filter(p => p.on);
  const pool = on.length ? on : el;
  sell(r, pool[Math.floor(Math.random() * pool.length)], 0, 'free');
}

function startAuction(r) {
  const el = eligible(r);
  r.cur = pickName(r);
  r.bid = 0; r.bidder = null; r.last = null;
  r.sealed = {}; r.reveal = null;
  if (el.length === 1) { // el último de la ronda: compra directa a 1$
    return sell(r, el[0], Math.min(1, el[0].money), 'solo');
  }
  r.phase = 'auction';
  // las ofertas NO se abren solas: las abre el anfitrión (s.on('openBids'))
  r.bidsOpen = false; r.paused = false; r.plays = 1; r.endsAt = 0;
  clearTimeout(r.timer);
  r.lastPitch = 0.85 + Math.random() * 0.3;
  io.to(r.code).emit('play', {
    text: spoken(r.cur),
    pitch: r.lastPitch,
    delay: 1200 + Math.random() * DELAY[r.dif] * 1000,
    rep: false
  });
  r.lastAudioText = spoken(r.cur);
  push(r);
}

function finishVote(r) {
  const tally = {};
  r.players.forEach(p => tally[p.id] = 0);
  Object.values(r.votes).forEach(t => { if (tally[t] !== undefined) tally[t]++; });
  const max = Math.max(...Object.values(tally));
  r.results = { tally, winners: max > 0 ? r.players.filter(p => tally[p.id] === max).map(p => p.id) : [] };
  r.phase = 'end';
  push(r);
}

io.on('connection', s => {
  const ctxOf = () => {
    const x = bySock[s.id]; if (!x) return {};
    const r = rooms[x.code]; if (!r) return {};
    return { r, p: find(r, x.pid) };
  };
  const hostCtx = () => { const c = ctxOf(); return c.r && c.p && c.p.id === c.r.hostId ? c : {}; };

  function attach(r, p) {
    p.sid = s.id; p.on = true;
    bySock[s.id] = { code: r.code, pid: p.id };
    s.join(r.code);
    clearTimeout(r.gc);
  }
  function joinRoom(r, name, tok, cb) {
    let p = r.players.find(q => q.tok === tok);
    if (!p) {
      if (r.phase !== 'lobby') return cb({ err: 'La partida ya empezó' });
      if (r.players.length >= MAXP) return cb({ err: 'Sala llena (máx. ' + MAXP + ')' });
      const nm = String(name || '').trim().slice(0, 14) || 'Jugador ' + (r.players.length + 1);
      p = { id: 'p' + (++pidSeq), tok, name: nm, money: MONEY, roster: [], on: true, sid: null };
      r.players.push(p);
      if (!r.hostId) r.hostId = p.id;
    }
    attach(r, p);
    cb({ ok: true, id: p.id, code: r.code });
    push(r);
  }

  s.on('create', ({ name, tok }, cb) => {
    const r = {
      code: newCode(), mode: 'f', auc: 'open', sealed: {}, reveal: null, dif: 1, vol: 70, vv: 25, phase: 'lobby', players: [], used: new Set(),
      cur: null, bid: 0, bidder: null, last: null, offers: [], oid: 0, votes: {}, results: null,
      timer: null, endsAt: 0, hostId: null, gc: null
    };
    rooms[r.code] = r;
    joinRoom(r, name, tok, cb);
  });

  s.on('join', ({ code, name, tok }, cb) => {
    const r = rooms[String(code || '').toUpperCase().trim()];
    if (!r) return cb({ err: 'Sala no encontrada' });
    joinRoom(r, name, tok, cb);
  });

  s.on('settings', d => {
    const { r } = hostCtx(); if (!r || !d) return;
    if (typeof d.vol === 'number') r.vol = clamp(d.vol, 0, 100);
    if (typeof d.vv === 'number') r.vv = clamp(d.vv, 1, 100);
    if ([0, 1, 2].includes(+d.dif)) r.dif = +d.dif;
    if (r.phase === 'lobby' && (d.mode === 'f' || d.mode === 'k')) r.mode = d.mode;
    if (['lobby', 'idle', 'sold'].includes(r.phase) && (d.auc === 'open' || d.auc === 'blind')) r.auc = d.auc;
    push(r);
  });

  s.on('start', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'lobby' || r.players.length < 2) return;
    if (freeLeft(r).length < r.players.length * GOAL) r.used.clear();
    r.phase = 'idle';
    push(r);
  });

  s.on('next', () => {
    const { r } = hostCtx(); if (!r || !['idle', 'sold'].includes(r.phase)) return;
    if (allDone(r)) { r.phase = 'trade'; r.last = null; return push(r); }
    startAuction(r);
  });

  s.on('repeat', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'auction' || r.paused || r.plays >= MAX_PLAYS) return;
    r.plays++;
    io.to(r.code).emit('play', { text: r.lastAudioText, pitch: r.lastPitch || 1, delay: 0, rep: true });
    push(r);
  });

  s.on('openBids', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'auction' || r.bidsOpen || r.paused) return;
    r.bidsOpen = true;
    r.endsAt = Date.now() + OPEN_MS;
    clearTimeout(r.timer);
    r.timer = setTimeout(() => close(r), OPEN_MS);
    push(r);
  });

  s.on('pause', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'auction') return;
    if (!r.paused) {
      r.paused = true;
      if (r.bidsOpen) { r.pausedLeft = Math.max(0, r.endsAt - Date.now()); clearTimeout(r.timer); }
    } else {
      r.paused = false;
      if (r.bidsOpen) { r.endsAt = Date.now() + r.pausedLeft; r.timer = setTimeout(() => close(r), r.pausedLeft); }
    }
    push(r);
  });

  s.on('bid', n => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'auction' || !r.bidsOpen || r.paused) return;
    n = Math.floor(+n);
    if (r.auc === 'blind') { // oferta secreta: una sola vez, sin cambios
      if (!(n >= 0) || n > p.money || !eligible(r).includes(p) || p.id in r.sealed) return;
      r.sealed[p.id] = n;
      if (eligible(r).filter(q => q.on).every(q => q.id in r.sealed)) return closeBlind(r);
      return push(r);
    }
    if (!(n > r.bid) || n > p.money || !eligible(r).includes(p) || r.bidder === p.id) return;
    r.bid = n; r.bidder = p.id;
    const left = Math.max(BID_MS, r.endsAt - Date.now());
    r.endsAt = Date.now() + left;
    clearTimeout(r.timer);
    r.timer = setTimeout(() => close(r), left);
    push(r);
  });

  // ---- Intercambios ----
  s.on('offer', ({ to, give, want } = {}) => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'trade') return;
    const t = find(r, to);
    if (!t || t.id === p.id || !p.roster.includes(give) || !t.roster.includes(want)) return;
    if (r.offers.filter(o => o.from === p.id).length >= 6) return;
    r.offers.push({ id: ++r.oid, from: p.id, to: t.id, give, want });
    push(r);
  });

  s.on('respond', ({ id, ok } = {}) => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'trade') return;
    const o = r.offers.find(x => x.id === id); if (!o) return;
    if (o.from === p.id && !ok) { r.offers = r.offers.filter(x => x !== o); return push(r); } // cancelar
    if (o.to !== p.id) return;
    r.offers = r.offers.filter(x => x !== o);
    if (ok) {
      const a = find(r, o.from), b = p;
      if (a && a.roster.includes(o.give) && b.roster.includes(o.want)) {
        a.roster[a.roster.indexOf(o.give)] = o.want;
        b.roster[b.roster.indexOf(o.want)] = o.give;
        r.offers = r.offers.filter(x => ![x.give, x.want].some(n => n === o.give || n === o.want));
      }
    }
    push(r);
  });

  // ---- Votación ----
  s.on('voteStart', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'trade') return;
    r.phase = 'vote'; r.votes = {}; r.offers = [];
    push(r);
  });
  s.on('vote', target => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'vote') return;
    if (target === p.id || !find(r, target)) return;
    r.votes[p.id] = target;
    if (r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
    push(r);
  });
  s.on('voteEnd', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'vote') return;
    finishVote(r);
  });

  s.on('restart', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'end') return;
    r.players = r.players.filter(p => p.on);
    r.players.forEach(p => { p.money = MONEY; p.roster = []; });
    r.offers = []; r.votes = {}; r.results = null; r.last = null;
    r.phase = 'lobby';
    push(r);
  });

  s.on('disconnect', () => {
    const x = bySock[s.id]; delete bySock[s.id]; if (!x) return;
    const r = rooms[x.code]; if (!r) return;
    const p = find(r, x.pid); if (!p || p.sid !== s.id) return;
    p.on = false;
    if (r.phase === 'lobby') r.players = r.players.filter(q => q !== p);
    if (r.hostId === p.id) { const n = r.players.find(q => q.on); if (n) r.hostId = n.id; }
    if (!r.players.some(q => q.on)) {
      r.gc = setTimeout(() => { clearTimeout(r.timer); delete rooms[r.code]; }, 10 * 60 * 1000);
    } else {
      if (r.phase === 'auction' && r.auc === 'blind' && Object.keys(r.sealed).length && eligible(r).filter(q => q.on).every(q => q.id in r.sealed)) return closeBlind(r);
      if (r.phase === 'vote' && r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
      push(r);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Subasta a sordas escuchando en el puerto ' + PORT));
