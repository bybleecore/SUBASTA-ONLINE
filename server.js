const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const NAMES = require('./names');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public', { setHeaders: (res, p) => { if (/\.(html|js)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } })); // que el navegador no se quede con una versión vieja
app.get('/health', (q, res) => res.send('ok'));
// Modo solo / sin conexión: el navegador descarga el MISMO motor de este archivo (lo que hay entre los dos marcadores) y lo ejecuta en local con bots
let ENGINE_JS = null;
app.get('/engine.js', (q, res) => {
  try {
    if (!ENGINE_JS) {
      const src = fs.readFileSync(__filename, 'utf8');
      const a = src.indexOf('// >>> ' + 'ENGINE START'), b = src.indexOf('// <<< ' + 'ENGINE END');
      ENGINE_JS = 'window.__makeEngine=function(io){\nconst NAMES=' + JSON.stringify(NAMES) + ';\n' + src.slice(a, b) + '\n};';
    }
    res.set('Content-Type', 'application/javascript; charset=utf-8').set('Cache-Control', 'no-cache').send(ENGINE_JS);
  } catch (e) { res.status(500).send('// motor no disponible'); }
});

// >>> ENGINE START (todo lo de aquí hasta ENGINE END también se ejecuta en el navegador en el modo solo)

// ---- Ajustes del juego (cámbialos aquí) ----
const SIM_LEAGUES = ['FMS España', 'FMS Argentina', 'FMS México', 'FMS Chile', 'FMS Perú', 'FMS Colombia', 'FMS Caribe'];
const SIM_MAX = SIM_LEAGUES.length; // «Simulaciones»: una liga por jugador (1 a 7 jugadores)
const SIM_TEAM = 8;      // freestylers por jugador = participantes de su liga (7 jornadas de 4 batallas)
const CACHE_START = 1000, CACHE_WIN = 300, CACHE_WIN_REP = 150, CACHE_UPSET = 0.25; // caché: base, premio por victoria, premio tras réplica y extra por ganar a alguien con más caché
const SIM_INTL_PLAYERS = 4; // con exactamente 4 jugadores (4 ligas) se juega la FMS Internacional (4 por liga = 16 en cada corte)
const SIM_CUT_J = 3;        // el primer corte internacional se juega al terminar esta jornada en todas las ligas
const CACHE_INTL_WIN = 400, CACHE_INTL_WIN_REP = 200, CACHE_INTL_CHAMP = 3000; // caché en la internacional: por victoria, tras réplica y premio gordo al campeón
const KO_NAMES = ['Octavos de final', 'Cuartos de final', 'Semifinales', 'Gran final'];
const MAXP = 10;         // máximo de jugadores por sala
const GOAL = 5;          // personajes que hay que conseguir (= número de rondas)
const MONEY = 50;        // dinero inicial
const MONEY_TEMA = 70;   // dinero inicial en el modo «amar tema»
const MONEY_XI = 100;    // dinero inicial en el modo «armar 11» (Blue Lock)
const MONEY_BEST = 100;  // dinero inicial en «armar el mejor»
const XI_SIZE = 11;      // jugadores del once
const MARKET_ROUND = 6;  // ronda en la que se abre el mercado (armar 11): intercambios con personajes y dinero entre subastas
const OPEN_MS = 25000;   // segundos para ofertar desde que el anfitrión abre las ofertas
const BID_MS = 8000;     // tiempo extra tras cada puja
const DELAY = [2, 3, 4]; // retraso máximo de la voz por dificultad (s)
const MAX_PLAYS = 2;     // veces que se puede oír la voz en cada subasta
// Temáticas del modo cast (se elige una al azar al empezar). Para añadir otra, copia un bloque.
const THEMES = [
  { name: 'NEW GEN BLUE LOCK', roles: ['LOKI', 'DON LORENZO', 'SAE ITOSHI', 'MICHAEL KAISER', 'HUGO VIVIEN', 'TEDDY KNIGHT', 'BUNNY IGLESIAS'] }
];
// Temáticas del modo «amar tema» (se elige una al azar al empezar)
const TEMA_THEMES = ['BLUE LOCK', 'JUJUTSU KAISEN', 'KIMETSU NO YAIBA', 'ANIME ROMCOM', 'CUALQUIER VIDEOJUEGO', 'MACRORAP LIBRE'];
// En «amar tema» los 3 puestos de PARTICIPANTE son libres: cada jugador escribe a mano qué personaje hace cada uno
// (respetar la temática queda en su mano) y lo que se subasta es el frikirapper de cada puesto.
const TEMA_CHAR_COUNT = 3;
const SLOT_FIXED_START = ['INSTRUMENTAL', 'MINIATURA', 'MIX Y MASTER', 'VIDEO', 'ESTRIBILLO CANTADO POR']; // orden de subasta (la 1.ª ronda es la especial de INSTRUMENTAL)
const SHEET_ORDER = ['MINIATURA', 'INSTRUMENTAL', 'MIX Y MASTER', 'VIDEO', 'ESTRIBILLO CANTADO POR']; // orden en que se muestra la ficha
const TEMA_TOTAL = SLOT_FIXED_START.length + TEMA_CHAR_COUNT;
function buildTema(name) {
  const chars = Array.from({ length: TEMA_CHAR_COUNT }, (_, i) => 'PARTICIPANTE ' + (i + 1));
  return { theme: { name, slots: [...SHEET_ORDER, ...chars], charSlots: chars }, order: [...SLOT_FIXED_START, ...chars] };
}
// Modo «armar 11» (Blue Lock): puestos de cada formación (cada jugador elige la suya)
const FORMS = {
  '433': ['POR', 'D1', 'D2', 'D3', 'D4', 'M1', 'M2', 'M3', 'F1', 'F2', 'F3'],
  '442': ['POR', 'D1', 'D2', 'D3', 'D4', 'M1', 'M2', 'M3', 'M4', 'F1', 'F2']
};
// Modo «armar el mejor»: categorías que se llenan con los personajes que salgan (una lista por modo de personajes)
const BEST_PICK = 8; // cada partida de «armar el mejor» usa 8 categorías al azar de la lista del modo
const BEST = {
  f: ['Visitas', 'Punchline', 'Respuestas', 'Puesta en escena', 'Flow', 'Skills', 'Autenticidad', 'Perfil', 'Ingenio', 'Prime', 'Proyeccion', 'Consolidacion', 'Titulos', 'Coherencia'],
  k: ['Contenido (Variedad)', 'Manejo vocal', 'Agudos', 'Graves', 'Interpretacion', 'Potencia', 'Flow', 'Escritura', 'Comunidad', 'Experiencia', 'Proyeccion', 'Contactos', 'Estilo', 'Contenido y variedad', 'Gestion de apartado tecnico'],
  b: ['Control', 'Tiro', 'Lectura de campo', 'Regate', 'Estado De Flow', 'Pase', 'Defensa', 'Velocidad', 'Equipo profesional', 'Estilo de juego', 'Liderazgo']
};
const CHAT_MAX = 50;      // mensajes del chat que se guardan por sala
const CHAT_LEN = 200;     // longitud máxima de un mensaje
const CHAT_GAP = 600;     // ms mínimos entre mensajes del mismo jugador (anti-spam)
const ROULETTE_MS = 4500; // duración de la ruleta en caso de empate

const rooms = {};
const bySock = {};
let pidSeq = 0;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const spoken = n => n.replace(/\(.*?\)/g, '').replace('$', '').replace(/\./g, ' ').trim();
const key = n => spoken(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const dedupe = arr => { const seen = new Set(); return arr.filter(n => { const k = key(n); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
// Personajes del modo Blue Lock (van aquí para que server.js funcione aunque names.js sea una versión antigua)
const BLUE_NAMES = [
  'Ryosuke Kira',
  'Asahi Naruhaya',
  'Gin Gagamaru',
  'Gurimu Igarashi',
  'Hyoma Chigiri',
  'Jingo Raichi',
  'Meguru Bachira',
  'Okuhito Lemon',
  'Rensuke Kunigami',
  'Wataru Kuon',
  'Yoichi Isagi',
  'Yuudai Imamura',
  'Ikki Nikko',
  'Hibiki Ookawa',
  'Shouei Barou',
  'Keisuke Wanima',
  'Junichi Wanima',
  'Zantetsu Tsurugi',
  'Reo Mikage',
  'Seishiro Nagi',
  'Aoshi Tokimitsu',
  'Eita Otoya',
  'Hajime Nishioka',
  'Jin Kiyora',
  'Jyubei Aryu',
  'Kenyu Yukimiya',
  'Nijiro Nanase',
  'Ranze Kurona',
  'Reiji Hiiragi',
  'Itoshi Rin',
  'Ryusei Shidou',
  'Tabito Karasu',
  'Yo Hiori',
  'Adam Blake',
  'Dada Silva',
  'Julian Loki',
  'Leonardo Luna',
  'Pablo Cavasoz',
  'Gen Fukaku',
  'Kazuma Niou',
  'Miroku Darai',
  'Itoshi Sae',
  'Shuuto Sendou',
  'Oliver Aiku',
  'Teppei Neru',
  'Alexis Ness',
  'Michael Kaiser',
  'Noel Noa',
  'Lavinho',
  'Chris Prince',
  'Agi',
  'Marc Snuffy',
  'Don Lorenzo',
  'Charles Chevalier',
  'Onazi',
  'Kuso',
  'Bello',
  'Oboabona',
  'Vivian Hugo',
  'Camus',
  'Leyden',
  'Teddy Knight',
  'Lookhart',
  'Bunny Iglesias'
];
const POOL = { f: dedupe(NAMES.f), k: dedupe(NAMES.k), b: dedupe(BLUE_NAMES) };
// Listas del modo «amar tema» (van aquí para que server.js funcione aunque names.js sea una versión antigua)
const INSTR_NAMES = ['Kenn', 'Kenkisaurio', 'IsurMX', 'Alaxtor', 'Keyto', 'Dokkyzach', 'Proii', 'Akinno', 'Byaki', 'Natzhu', 'Elevenn'];
const VIDEO_EXTRA = ['Kaneki', 'Puntotoni', 'Sz', 'Leg4', 'Aztra', 'Corekar', 'Darkz', 'Burrito', 'Fabz', 'Yenova', 'Billzo', 'TakionRL'];
const TEMA_INSTR = dedupe(INSTR_NAMES);
const TEMA_VIDEO = dedupe([...POOL.k, ...VIDEO_EXTRA]); // cualquier artista + los agregados
const moneyOf = r => r.gm === 'tema' ? MONEY_TEMA : r.gm === 'xi' ? MONEY_XI : r.gm === 'best' ? MONEY_BEST : MONEY;
// Bolsa de nombres de la subasta actual (en «amar tema» depende del puesto)
const poolFor = r => {
  if (r.gm === 'tema') {
    if (r.curSlot === 'INSTRUMENTAL') return TEMA_INSTR;
    if (r.curSlot === 'VIDEO') return TEMA_VIDEO;
    return POOL.k;
  }
  return POOL[r.mode];
};
// Puestos donde cada jugador puede colocar a sus personajes (según el modo de partida)
const rolesOf = (r, p) => r.gm === 'xi' ? FORMS[p.form || '433']
  : r.gm === 'versus' ? p.rivals
  : (r.gm === 'tema' && r.theme) ? r.theme.slots
  : ((r.gm === 'cast' || r.gm === 'best') && r.theme) ? r.theme.roles : null;
const specialOf = slot => (slot === 'INSTRUMENTAL' || slot === 'VIDEO') ? '⭐ Ronda especial' : null;
const freeLeft = r => poolFor(r).filter(n => !r.used.has(key(n)));
const find = (r, id) => r.players.find(p => p.id === id);
// ¿se puede intercambiar ahora? Siempre en la fase final; en «armar 11» también entre subastas desde la ronda del mercado
const marketOpen = r => r.phase === 'trade' || (r.gm === 'xi' && r.market && ['idle', 'sold'].includes(r.phase));
const minCount = r => Math.min(...r.players.map(p => p.roster.length));
const duel = r => r.players.length === 2; // 1 vs 1: no hay rondas, puja cualquiera que aún no tenga el cupo completo
const roundIdx = r => duel(r) ? Math.min(Math.floor((r.sales || 0) / 2), 99) : minCount(r); // «ronda» para elegir el puesto en «amar tema»
const rdOf = r => Math.floor((r.sales || 0) / Math.max(1, r.players.length)) + 1; // ronda según subastas hechas (para el mercado)
const goalOf = r => r.gm === 'xi' ? XI_SIZE : r.gm === 'tema' ? TEMA_TOTAL : ((r.gm === 'cast' || r.gm === 'best') && r.theme) ? r.theme.roles.length : GOAL; // personajes por jugador
const allDone = r => duel(r) ? r.players.every(p => p.roster.length >= goalOf(r)) : minCount(r) >= goalOf(r);
const eligible = r => {
  if (duel(r)) return r.players.filter(p => p.roster.length < goalOf(r)); // da igual que uno tenga 3 y el rival 0
  const m = minCount(r); return m >= goalOf(r) ? [] : r.players.filter(p => p.roster.length === m);
};

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms[c]);
  return c;
}

// Puesto que se está subastando (o el siguiente, si aún no se lanzó)
function temaSlot(r) {
  if (r.gm !== 'tema' || !r.order || r.phase === 'lobby') return null;
  return ['auction', 'roulette', 'sold'].includes(r.phase) ? r.curSlot : (r.order[Math.min(roundIdx(r), r.order.length - 1)] || null);
}
function view(r) {
  const el = eligible(r);
  return {
    code: r.code, hostId: r.hostId, phase: r.phase, mode: r.mode, dif: r.dif, vol: r.vol, vv: r.vv,
    gm: r.gm, theme: r.theme, goal: goalOf(r), forms: r.gm === 'xi' ? FORMS : null, market: !!r.market, marketRound: MARKET_ROUND,
    slot: temaSlot(r), special: specialOf(temaSlot(r)), round: duel(r) ? null : allDone(r) ? goalOf(r) : minCount(r) + 1, duel: duel(r), sales: r.sales || 0, mktAt: (MARKET_ROUND - 1) * r.players.length,
    bid: r.bid, bidder: r.bidder,
    ms: r.phase === 'roulette' ? Math.max(0, r.endsAt - Date.now()) : (r.phase === 'auction' && r.bidsOpen ? (r.paused ? r.pausedLeft : Math.max(0, r.endsAt - Date.now())) : 0),
    paused: !!r.paused, bidsOpen: !!r.bidsOpen, plays: r.plays || 0, maxPlays: MAX_PLAYS, openMs: OPEN_MS,
    auc: r.auc,
    sealed: r.auc === 'blind' && r.phase === 'auction' ? Object.keys(r.sealed) : [],
    reveal: r.phase === 'roulette' ? r.reveal : null,
    last: r.last,
    players: r.players.map(p => ({ id: p.id, name: p.name, money: p.money, roster: p.roster, cast: p.cast, chars: p.chars, tname: p.tname, rivals: p.rivals, form: p.form, on: p.on, bot: !!p.bot, eligible: el.includes(p) })),
    offers: r.offers, jury: r.jury || 3, sim: r.gm === 'sim' && r.sim ? simView(r) : null,
    voted: r.phase === 'vote' ? Object.keys(r.votes) : [],
    results: r.results
  };
}
function push(r) { io.to(r.code).emit('state', view(r)); }

function pickName(r) {
  let pool = freeLeft(r);
  if (!pool.length) { if (r.gm !== 'tema') r.used.clear(); pool = poolFor(r); } // solo si se agotaron todos
  const n = pool[Math.floor(Math.random() * pool.length)];
  r.used.add(key(n));
  return n;
}

function sell(r, p, price, how) {
  clearTimeout(r.timer);
  r.players.forEach(b => { clearTimeout(b.bt); b.bt = null; });
  r.paused = false; r.bidsOpen = false;
  p.money -= price;
  if (r.gm === 'tema' && r.curSlot && !p.cast[r.curSlot]) p.cast[r.curSlot] = r.cur; // se coloca solo en el puesto de la ronda si está libre; luego el jugador puede moverlo
  if (r.gm === 'versus') { const f = p.rivals.find(x => !p.cast[x]); if (f) p.cast[f] = r.cur; } // va al primer rival libre; luego el jugador puede moverlo
  p.roster.push(r.cur);
  r.sales = (r.sales || 0) + 1;
  if (r.gm === 'xi' && rdOf(r) === MARKET_ROUND) r.market = true; // el mercado se abre al empezar la ronda 6 y dura solo esa ronda
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
  if (r.market && rdOf(r) > MARKET_ROUND) { r.market = false; r.offers = []; } // terminó la ronda del mercado
  const el = eligible(r);
  r.curSlot = r.gm === 'tema' && r.order ? r.order[Math.min(roundIdx(r), r.order.length - 1)] : null;
  r.cur = pickName(r);
  r.bid = 0; r.bidder = null; r.last = null;
  r.sealed = {}; r.reveal = null;
  botPlan(r);
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

function autofill(r) { // los personajes sin puesto se colocan solos en los puestos vacíos
  r.players.forEach(p => {
    const roles = rolesOf(r, p); if (!roles) return;
    const free = p.roster.filter(n => !Object.values(p.cast).includes(n));
    roles.forEach(role => { if (!p.cast[role] && free.length) p.cast[role] = free.shift(); });
  });
}

function finishVote(r) {
  const tally = {};
  r.players.forEach(p => tally[p.id] = 0);
  // cada voto es un ranking de peor a mejor: el peor suma 1 punto, el siguiente 2, etc.
  Object.values(r.votes).forEach(rk => rk.forEach((id, i) => { if (tally[id] !== undefined) tally[id] += i + 1; }));
  const max = Math.max(...Object.values(tally));
  r.results = { tally, winners: max > 0 ? r.players.filter(p => tally[p.id] === max).map(p => p.id) : [] };
  r.phase = 'end';
  push(r);
}

// ---- Pujas (jugadores y bots) ----
function doBid(r, p, n) {
  if (r.phase !== 'auction' || !r.bidsOpen || r.paused) return;
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
  botTick(r);
}

// ---- Bots (para jugar solo o completar una sala) ----
const BOT_NAMES = ['Kuro', 'Nami', 'Rex', 'Luna', 'Toru', 'Mika', 'Zed', 'Kira', 'Dante', 'Yuki'];
const rnd = (a, b) => a + Math.random() * (b - a);
function botPlan(r) { // al empezar cada subasta cada bot decide lo máximo que pagaría
  r.players.forEach(b => {
    if (!b.bot) return;
    clearTimeout(b.bt); b.bt = null;
    const need = Math.max(1, goalOf(r) - b.roster.length);
    const fair = (b.money - (need - 1)) / need; // deja al menos 1$ por cada personaje que le falta
    b.max = Math.max(0, Math.min(b.money, Math.floor(fair * rnd(0.5, 2.2))));
  });
}
function botTick(r) {
  if (r.phase !== 'auction' || !r.bidsOpen || r.paused) return;
  const el = eligible(r);
  r.players.forEach(b => {
    if (!b.bot || b.bt || !el.includes(b)) return;
    if (r.auc === 'blind') {
      if (b.id in r.sealed) return;
      b.bt = setTimeout(() => { b.bt = null; botBlind(r, b); }, rnd(1500, 9000));
    } else {
      if (r.bidder === b.id || r.bid >= Math.min(b.max, b.money)) return;
      b.bt = setTimeout(() => { b.bt = null; botBid(r, b); }, rnd(900, 3500));
    }
  });
}
function botBid(r, b) {
  if (r.phase !== 'auction' || !r.bidsOpen || r.paused || r.auc === 'blind' || r.bidder === b.id) return;
  const cap = Math.min(b.max, b.money);
  if (r.bid >= cap) return;
  doBid(r, b, Math.min(cap, r.bid + 1 + Math.floor(Math.random() * 3)));
}
function botBlind(r, b) {
  if (r.phase !== 'auction' || !r.bidsOpen || r.paused || r.auc !== 'blind' || b.id in r.sealed) return;
  doBid(r, b, Math.floor(rnd(0, Math.min(b.max, b.money) + 1)));
}
function botVotes(r) {
  r.players.forEach(b => {
    if (!b.bot) return;
    setTimeout(() => {
      if (r.phase !== 'vote' || b.id in r.votes || !find(r, b.id)) return;
      r.votes[b.id] = r.players.filter(q => q.id !== b.id).map(q => q.id).sort(() => Math.random() - 0.5);
      if (r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
      push(r);
    }, rnd(1500, 5000));
  });
}
function botReply(r, o) { // un bot responde a una oferta que le hacen (acepta una parte de las veces)
  const b = find(r, o.to); if (!b || !b.bot) return;
  setTimeout(() => {
    if (!marketOpen(r) || !r.offers.includes(o)) return;
    respondOffer(r, b, o.id, Math.random() < (0.25 + (o.cash && o.cdir === 'pay' ? 0.25 : 0)));
  }, rnd(1500, 4000));
}

// ---- Intercambios: responder (jugadores y bots) ----
function respondOffer(r, p, id, ok) {
  if (!marketOpen(r)) return;
  const o = r.offers.find(x => x.id === id); if (!o) return;
  if (o.from === p.id && !ok) { r.offers = r.offers.filter(x => x !== o); return push(r); } // cancelar
  if (o.to !== p.id) return;
  r.offers = r.offers.filter(x => x !== o);
  if (ok) {
    const a = find(r, o.from), b = p;
    const cash = o.cash || 0;
    const payer = o.cdir === 'pay' ? a : b, getter = payer === a ? b : a;
    const valid = a && (!o.give || a.roster.includes(o.give)) && (!o.want || b.roster.includes(o.want)) && (!cash || payer.money >= cash);
    if (valid) {
      if (o.give && o.want) {
        a.roster[a.roster.indexOf(o.give)] = o.want;
        b.roster[b.roster.indexOf(o.want)] = o.give;
        for (const k of Object.keys(a.cast)) if (a.cast[k] === o.give) a.cast[k] = o.want;
        for (const k of Object.keys(b.cast)) if (b.cast[k] === o.want) b.cast[k] = o.give;
      } else if (o.give) { // vende un personaje por dinero
        a.roster.splice(a.roster.indexOf(o.give), 1); b.roster.push(o.give);
        for (const k of Object.keys(a.cast)) if (a.cast[k] === o.give) delete a.cast[k];
      } else if (o.want) { // compra un personaje con dinero
        b.roster.splice(b.roster.indexOf(o.want), 1); a.roster.push(o.want);
        for (const k of Object.keys(b.cast)) if (b.cast[k] === o.want) delete b.cast[k];
      }
      if (cash) { payer.money -= cash; getter.money += cash; }
      r.offers = r.offers.filter(x => ![x.give, x.want].some(n => n && (n === o.give || n === o.want)));
    }
  }
  push(r);
}

// ================= SIMULACIONES (ligas FMS) =================
// Cada jugador recibe una liga y 8 freestylers que son los participantes de esa liga (todos contra todos, 7 jornadas de 4 batallas).
// Un jurado de jugadores vota cada batalla (A, B o réplica). Victoria directa 3 pts; tras réplica 2 pts y el perdedor 1 pt.
// Con 4 jugadores se añade la FMS INTERNACIONAL (como en 2019):
//   · Tras la jornada SIM_CUT_J de todas las ligas: PRIMER CORTE. Los 4 primeros de cada liga se cruzan con los de otra liga
//     (1.º vs 4.º de otra liga, 2.º vs 3.º de otra liga = 8 batallas). Los 8 ganadores clasifican a la Gran Final.
//   · Al acabar las ligas: SEGUNDO CORTE con los 4 mejores de cada tabla que aún NO estén clasificados (mismos cruces). Otros 8 billetes.
//   · GRAN FINAL: los 16 clasificados en eliminatorias (octavos, cuartos, semis y final). El campeón gana mucho caché.
//   · Gana la partida el jugador cuyo freestyler tenga más caché al final.
//   · Con MÁS de 4 jugadores: tras la jornada SIM_CUT_J todos los jugadores VOTAN las 4 mejores ligas, y solo esas 4 van a la inter.
const simShuffle = a => a.map(x => [Math.random(), x]).sort((u, v) => u[0] - v[0]).map(x => x[1]);
const maxPlayers = r => r.gm === 'sim' ? SIM_MAX : MAXP;
function simFixture(teams) { // método del círculo: 8 participantes -> 7 jornadas, todos contra todos una sola vez
  const t = simShuffle(teams), n = t.length, rounds = [];
  for (let j = 0; j < n - 1; j++) {
    const m = [];
    for (let i = 0; i < n / 2; i++) m.push(simShuffle([t[i], t[n - 1 - i]]));
    rounds.push(simShuffle(m));
    t.splice(1, 0, t.pop());
  }
  return rounds;
}
function simStart(r) {
  const n = r.players.length;
  const leagueIdx = simShuffle(SIM_LEAGUES.map((_, i) => i)).slice(0, n); // a cada jugador le toca una liga al azar
  let bag = simShuffle(POOL.f);
  const leagues = r.players.map((p, i) => {
    if (bag.length < SIM_TEAM) { const left = new Set(bag.map(key)); bag = [...bag, ...simShuffle(POOL.f).filter(x => !left.has(key(x)))]; }
    const teams = bag.splice(0, SIM_TEAM);
    p.roster = teams.slice(); p.cast = {}; p.chars = {};
    const cache = {}, st = {};
    teams.forEach(t => { cache[t] = CACHE_START; st[t] = { pts: 0, w: 0, wr: 0, lr: 0, l: 0 }; });
    return { name: SIM_LEAGUES[leagueIdx[i]], ownerId: p.id, ownerName: p.name, teams, cache, st, fix: simFixture(teams) };
  });
  r.sim = {
    id: Date.now(), jury: (r.jury === 5 && n >= 6) ? 5 : 3, leagues,
    order: simShuffle(leagues.map((_, i) => i)), // orden (al azar) en que se juega cada jornada de cada liga
    stage: 'league', ko: -1, intl: n >= SIM_INTL_PLAYERS ? { q: [], champ: null, lgs: n === SIM_INTL_PLAYERS ? leagues.map((_, i) => i) : null, vres: null } : null, lvotes: {}, // q = clasificados a la Gran Final {l: liga, n: freestyler, via}
    j: 1, li: 0, b: 0, round: 1, step: 'draw', battles: [], jurors: [], votes: {}, last: null, needRep: false
  };
  r.phase = 'sim';
  push(r);
}
function simMakeJury(r, exclude, auto) { // 3 (o 5) jurados; los dueños de los freestylers que se enfrentan no votan; el último voto puede ser del favorito por caché
  const S = r.sim, seats = S.jury - (auto ? 1 : 0);
  const others = simShuffle(r.players.filter(p => !exclude.includes(p.id)));
  const jurors = others.slice(0, seats).map(p => ({ k: 'p', id: p.id, name: p.name }));
  for (let i = jurors.length; i < seats; i++) jurors.push({ k: 'v', id: 'v' + i, name: 'Jurado invitado ' + (i - others.length + 1) });
  if (auto) jurors.push({ k: 'c', id: 'c', name: 'Favorito por caché' });
  return jurors;
}
const simCacheOf = (S, bt, side) => side === 'a' ? S.leagues[bt.la].cache[bt.a] : S.leagues[bt.lb].cache[bt.b];
function simBegin(r) { // empieza la jornada de una liga: se muestran las 4 batallas y se eligen los jurados
  const S = r.sim, li = S.order[S.li], lg = S.leagues[li];
  S.stage = 'league'; S.step = 'intro'; S.b = 0; S.round = 1; S.votes = {}; S.last = null; S.needRep = false;
  S.battles = lg.fix[S.j - 1].map(([a, b]) => ({ a, b, la: li, lb: li, res: null, fav: null }));
  S.jurors = simMakeJury(r, [lg.ownerId], S.j >= 2); // desde la jornada 2 el último voto es del favorito por caché
  push(r);
}
function simAi(ca, cb, allowR) { // voto de un bot / jurado invitado / jugador desconectado
  const hi = ca === cb ? (Math.random() < 0.5 ? 'a' : 'b') : (ca > cb ? 'a' : 'b'), lo = hi === 'a' ? 'b' : 'a';
  if (allowR && Math.random() < 0.14) return 'r';
  return Math.random() < 0.62 ? hi : lo;
}
function simAutoVotes(r) {
  const S = r.sim; if (!S || S.step !== 'vote') return;
  const bt = S.battles[S.b], ca = simCacheOf(S, bt, 'a'), cb = simCacheOf(S, bt, 'b');
  if (!bt.fav) bt.fav = ca === cb ? (Math.random() < 0.5 ? 'a' : 'b') : (ca > cb ? 'a' : 'b');
  S.jurors.forEach((j, i) => {
    if (i in S.votes) return;
    if (j.k === 'c') S.votes[i] = bt.fav;
    else if (j.k === 'v') S.votes[i] = simAi(ca, cb, S.round === 1);
    else { const q = find(r, j.id); if (!q || q.bot || !q.on) S.votes[i] = simAi(ca, cb, S.round === 1); }
  });
}
function simOpenVote(r) {
  r.sim.step = 'vote'; r.sim.votes = {};
  simAutoVotes(r); simCheck(r);
}
function simStartBattle(r) { // primera ronda de una batalla (en la internacional cada batalla tiene su propio jurado, sin los dueños de los dos freestylers)
  const S = r.sim; S.round = 1;
  if (S.stage !== 'league') { const bt = S.battles[S.b]; S.jurors = simMakeJury(r, [S.leagues[bt.la].ownerId, S.leagues[bt.lb].ownerId], true); }
  simOpenVote(r);
}
function simCheck(r) {
  const S = r.sim; if (!S || S.step !== 'vote') return;
  if (S.jurors.every((_, i) => i in S.votes)) simTally(r); else push(r);
}
function simTally(r) {
  const S = r.sim, bt = S.battles[S.b];
  const cnt = { a: 0, b: 0, r: 0 };
  Object.values(S.votes).forEach(v => cnt[v]++);
  const need = Math.floor(S.jurors.length / 2) + 1;
  let w = null;
  if (S.round === 1) { if (cnt.a >= need) w = 'a'; else if (cnt.b >= need) w = 'b'; } // sin mayoría (o con réplicas) -> réplica
  else w = cnt.a > cnt.b ? 'a' : 'b';
  S.last = { round: S.round, cnt, votes: { ...S.votes } };
  S.needRep = !w;
  if (w) simApply(r, w);
  S.step = 'reveal';
  push(r);
}
function simApply(r, w) {
  const S = r.sim, bt = S.battles[S.b], isLg = S.stage === 'league';
  const W = w === 'a' ? bt.a : bt.b, lW = w === 'a' ? bt.la : bt.lb, L = w === 'a' ? bt.b : bt.a, lL = w === 'a' ? bt.lb : bt.la, rep = S.round === 2;
  const cw = S.leagues[lW].cache[W], cl = S.leagues[lL].cache[L];
  let gain = isLg ? (rep ? CACHE_WIN_REP : CACHE_WIN) : (rep ? CACHE_INTL_WIN_REP : CACHE_INTL_WIN);
  if (cl > cw) gain += Math.round((cl - cw) * CACHE_UPSET / 10) * 10; // ganar a alguien con más caché paga más
  S.leagues[lW].cache[W] += gain;
  if (isLg) { // los puntos de la tabla solo se mueven en la liga; la internacional solo mueve caché
    const sw = S.leagues[lW].st[W], sl = S.leagues[lL].st[L];
    if (rep) { sw.pts += 2; sw.wr++; sl.pts += 1; sl.lr++; } else { sw.pts += 3; sw.w++; sl.l++; }
  }
  if ((S.stage === 'cut1' || S.stage === 'cut2') && !S.intl.q.some(x => x.l === lW && x.n === W)) S.intl.q.push({ l: lW, n: W, via: S.stage }); // el ganador de un corte clasifica
  bt.res = { w, rep, gain, lg: isLg, pw: isLg ? (rep ? 2 : 3) : 0, pl: isLg ? (rep ? 1 : 0) : 0, cnt: { ...S.last.cnt } };
}
function simTable(lg) {
  return lg.teams.map(t => ({ n: t, c: lg.cache[t], ...lg.st[t] })).sort((a, b) => b.pts - a.pts || b.c - a.c || a.n.localeCompare(b.n));
}
// ---- FMS Internacional ----
// ---- Votación de las 4 mejores ligas (solo con más de 4 jugadores) ----
function simLeagueAuto(r) { // bots y jugadores desconectados votan solos: prefieren ligas con más caché, con algo de azar
  const S = r.sim;
  r.players.forEach(p => {
    if (p.id in S.lvotes) return;
    if (!p.bot && p.on) return;
    const sc = S.leagues.map((lg, l) => ({ l, s: lg.teams.reduce((a, t) => a + lg.cache[t], 0) * (0.7 + Math.random() * 0.6) }));
    S.lvotes[p.id] = sc.sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.l);
  });
}
function simLeagueBegin(r) {
  const S = r.sim; S.stage = 'lvote'; S.step = 'lvote'; S.lvotes = {};
  simLeagueAuto(r); simLeagueCheck(r);
}
function simLeagueCheck(r) {
  const S = r.sim; if (!S || S.step !== 'lvote') return;
  if (r.players.every(p => p.id in S.lvotes)) simLeagueTally(r); else push(r);
}
function simLeagueTally(r) {
  const S = r.sim, cnt = S.leagues.map(() => 0);
  Object.values(S.lvotes).forEach(v => v.forEach(l => { cnt[l]++; }));
  const tot = S.leagues.map(lg => lg.teams.reduce((a, t) => a + lg.cache[t], 0));
  const rank = S.leagues.map((_, l) => ({ l, v: cnt[l], t: tot[l], z: Math.random() })).sort((a, b) => b.v - a.v || b.t - a.t || a.z - b.z); // empate: más caché total, y si no al azar
  S.intl.lgs = rank.slice(0, 4).map(x => x.l);
  S.intl.vres = rank.map((x, i) => ({ l: x.l, v: x.v, in: i < 4 }));
  S.step = 'lres'; push(r);
}
function simPending(r) { // tras una desconexión / salida: repasar lo que estaba esperando votos
  const S = r.sim; if (!S) return;
  if (S.step === 'vote') { simAutoVotes(r); return simCheck(r); }
  if (S.step === 'lvote') { simLeagueAuto(r); return simLeagueCheck(r); }
  push(r);
}
function simIntlBegin(r, kind) { // kind: 'cut1' | 'cut2'
  const S = r.sim, taken = new Set(S.intl.q.map(x => x.l + '|' + x.n)); // quien ya clasificó en el primer corte no puede clasificar otra vez
  const lgs = S.intl.lgs, tops = {};
  lgs.forEach(l => { tops[l] = simTable(S.leagues[l]).filter(x => !taken.has(l + '|' + x.n)).slice(0, 4).map(x => x.n); });
  if (lgs.some(l => tops[l].length < 4)) { // no debería pasar nunca (8 - 4 ya clasificados = 4), pero por si acaso la temporada sigue sin internacional
    S.intl = null; S.stage = 'league';
    if (kind === 'cut1') return simNextJornada(r);
    S.step = 'end'; return push(r);
  }
  const ord = simShuffle(lgs), n = ord.length, pairs = [];
  const mk = (A, ia, B, ib) => ({ a: tops[A][ia], la: A, ra: ia + 1, b: tops[B][ib], lb: B, rb: ib + 1, res: null, fav: null });
  for (let i = 0; i < n; i++) { // ciclo de ligas: cada liga da su 1.º y su 2.º, y recibe a un 4.º y a un 3.º de ligas distintas (todas distintas a la suya)
    const A = ord[i], B = ord[(i + 1) % n], C = ord[(i - 1 + n) % n];
    pairs.push(mk(A, 0, B, 3)); // 1.º contra el 4.º de otra liga
    pairs.push(mk(A, 1, C, 2)); // 2.º contra el 3.º de otra liga
  }
  S.stage = kind; S.battles = simShuffle(pairs); S.step = 'intro'; S.b = 0; S.round = 1; S.votes = {}; S.last = null; S.needRep = false; S.jurors = [];
  push(r);
}
function simKoPairs(q) { // sorteo de octavos: se evita (si se puede) cruzar a dos freestylers de la misma liga
  let s = simShuffle(q);
  for (let t = 0; t < 300; t++) {
    s = simShuffle(q);
    let ok = true; for (let i = 0; i < s.length; i += 2) if (s[i].l === s[i + 1].l) ok = false;
    if (ok) break;
  }
  const p = []; for (let i = 0; i < s.length; i += 2) p.push([s[i], s[i + 1]]);
  return p;
}
function simKoBegin(r, k) { // k: 0 octavos, 1 cuartos, 2 semis, 3 final
  const S = r.sim; let pairs;
  if (k === 0) pairs = simKoPairs(S.intl.q);
  else {
    const prev = S.battles.map(bt => bt.res.w === 'a' ? { l: bt.la, n: bt.a } : { l: bt.lb, n: bt.b }); // ganadores en el orden del cuadro
    pairs = []; for (let i = 0; i < prev.length; i += 2) pairs.push([prev[i], prev[i + 1]]);
  }
  S.stage = 'ko'; S.ko = k;
  S.battles = pairs.map(([x, y]) => ({ a: x.n, la: x.l, b: y.n, lb: y.l, res: null, fav: null }));
  S.step = 'intro'; S.b = 0; S.round = 1; S.votes = {}; S.last = null; S.needRep = false; S.jurors = [];
  push(r);
}
function simFinish(r) { // fin: el campeón de la internacional se lleva el premio gordo de caché
  const S = r.sim;
  if (S.intl && S.stage === 'ko' && S.ko === 3 && S.battles[0] && S.battles[0].res) {
    const bt = S.battles[0], w = bt.res.w, l = w === 'a' ? bt.la : bt.lb, n = w === 'a' ? bt.a : bt.b;
    S.leagues[l].cache[n] += CACHE_INTL_CHAMP;
    S.intl.champ = { l, n, bonus: CACHE_INTL_CHAMP };
  }
  S.step = 'end'; push(r);
}
function simNextJornada(r) { // la liga sigue con la siguiente jornada; si ya no quedan, empieza el segundo corte (o acaba la temporada)
  const S = r.sim;
  if (S.j < SIM_TEAM - 1) { S.j++; S.li = 0; return simBegin(r); }
  if (S.intl) return simIntlBegin(r, 'cut2');
  S.step = 'end'; push(r);
}
function simAdvance(r) { // desde la pantalla de cierre (jEnd) a lo siguiente
  const S = r.sim;
  if (S.stage === 'league') {
    if (S.li < S.order.length - 1) { S.li++; return simBegin(r); } // la jornada de la siguiente liga
    if (S.intl && S.j === SIM_CUT_J) return S.intl.lgs ? simIntlBegin(r, 'cut1') : simLeagueBegin(r); // acaba la jornada 3 en todas las ligas: (votación de ligas si hay más de 4) y primer corte internacional
    return simNextJornada(r);
  }
  if (S.stage === 'cut1') return simNextJornada(r); // de vuelta a las ligas (jornada 4)
  if (S.stage === 'cut2') return simKoBegin(r, 0);
  if (S.stage === 'ko') return S.ko < 3 ? simKoBegin(r, S.ko + 1) : simFinish(r);
}
function simNextStep(r) { // paso del anfitrión (botón «siguiente»)
  const S = r.sim; if (!S) return;
  if (S.step === 'draw') return simBegin(r);
  if (S.step === 'intro') { S.b = 0; return simStartBattle(r); }
  if (S.step === 'reveal') {
    if (S.needRep) { S.round = 2; S.needRep = false; return simOpenVote(r); } // ronda extra: ya no se puede votar réplica
    if (S.b < S.battles.length - 1) { S.b++; return simStartBattle(r); }
    S.step = 'jEnd'; return push(r);
  }
  if (S.step === 'jEnd') return simAdvance(r);
  if (S.step === 'lres') return simIntlBegin(r, 'cut1');
}
function simWinner(r) { // gana el jugador cuyo freestyler tiene más caché al final (el campeón de la inter ya lleva su premio sumado)
  const S = r.sim; if (!S || S.step !== 'end') return null;
  const rank = S.leagues.map((lg, l) => {
    const n = lg.teams.slice().sort((a, b) => lg.cache[b] - lg.cache[a] || lg.st[b].pts - lg.st[a].pts || a.localeCompare(b))[0];
    return { l, owner: lg.ownerId, ownerName: lg.ownerName, league: lg.name, n, c: lg.cache[n], pts: lg.st[n].pts };
  }).sort((x, y) => y.c - x.c || y.pts - x.pts || x.ownerName.localeCompare(y.ownerName));
  return { ...rank[0], ranking: rank };
}
function simView(r) {
  const S = r.sim;
  const v = {
    id: S.id, step: S.step, j: S.j, jn: SIM_TEAM - 1, jury: S.jury, li: S.li, total: S.order.length, order: S.order,
    stage: S.stage, ko: S.ko, cutJ: SIM_CUT_J, intlChamp: CACHE_INTL_CHAMP,
    intl: S.intl ? { q: S.intl.q.map(x => ({ l: x.l, n: x.n, via: x.via })), champ: S.intl.champ, lgs: S.intl.lgs, vres: S.step === 'lres' ? S.intl.vres : null } : null,
    lvoted: S.step === 'lvote' ? Object.keys(S.lvotes) : [], lvoters: S.step === 'lvote' || S.step === 'lres' ? r.players.map(p => ({ id: p.id, name: p.name })) : [],
    leagues: S.leagues.map(lg => ({ name: lg.name, owner: lg.ownerId, ownerName: lg.ownerName, teams: lg.teams, table: simTable(lg) })),
    winner: simWinner(r), cur: null
  };
  if (['intro', 'vote', 'reveal', 'jEnd'].includes(S.step)) {
    v.cur = {
      lg: S.stage === 'league' ? S.order[S.li] : null, b: S.b, round: S.round, needRep: !!S.needRep,
      jurors: S.jurors.map(j => ({ k: j.k, id: j.id, name: j.name })),
      voted: S.step === 'vote' ? Object.keys(S.votes).map(Number) : [],
      battles: S.battles.map(bt => ({ a: bt.a, b: bt.b, la: bt.la, lb: bt.lb, ra: bt.ra || 0, rb: bt.rb || 0, ca: S.leagues[bt.la].cache[bt.a], cb: S.leagues[bt.lb].cache[bt.b], res: bt.res })),
      last: S.step === 'reveal' ? S.last : null
    };
  }
  return v;
}

function toLobby(r) {
  clearTimeout(r.timer);
  r.players.forEach(b => { clearTimeout(b.bt); b.bt = null; });
  r.players = r.players.filter(p => p.on);
  r.theme = null; r.order = null; r.curSlot = null; r.market = false; r.sales = 0; r.sim = null;
  r.players.forEach(p => { p.money = moneyOf(r); p.roster = []; p.cast = {}; p.chars = {}; p.tname = null; p.rivals = []; p.form = (p.bot && Math.random() < 0.5) ? '442' : '433'; });
  r.offers = []; r.votes = {}; r.results = null; r.last = null; r.sealed = {}; r.reveal = null; r.bid = 0; r.bidder = null; r.bidsOpen = false; r.paused = false;
  r.phase = 'lobby';
  push(r);
}
function removePlayer(r, t) {
  clearTimeout(t.bt);
  r.players = r.players.filter(q => q !== t);
  r.offers = r.offers.filter(o => o.from !== t.id && o.to !== t.id);
  delete r.votes[t.id];
  Object.keys(r.votes).forEach(k => { r.votes[k] = r.votes[k].filter(id => id !== t.id); });
  delete r.sealed[t.id];
  if (r.bidder === t.id) { r.bidder = null; r.bid = 0; }
  if (r.last && r.last.winner === t.id) r.last = null;
  if (r.phase !== 'lobby' && r.players.length < (r.gm === 'sim' ? 1 : 2)) return toLobby(r); // sin rivales no hay partida
  if (r.phase === 'sim' && r.sim) return simPending(r);
  if (r.phase === 'auction' && r.auc === 'blind' && Object.keys(r.sealed).length && eligible(r).filter(q => q.on).every(q => q.id in r.sealed)) return closeBlind(r);
  if (r.phase === 'vote' && r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
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
      if (r.players.length >= maxPlayers(r)) return cb({ err: 'Sala llena (máx. ' + maxPlayers(r) + ')' });
      const nm = String(name || '').trim().slice(0, 14) || 'Jugador ' + (r.players.length + 1);
      p = { id: 'p' + (++pidSeq), tok, name: nm, money: moneyOf(r), roster: [], cast: {}, chars: {}, on: true, sid: null, tname: null, rivals: [], form: '433' };
      r.players.push(p);
      if (!r.hostId) r.hostId = p.id;
    }
    attach(r, p);
    cb({ ok: true, id: p.id, code: r.code });
    s.emit('chatHistory', r.chat);
    push(r);
  }

  s.on('create', ({ name, tok }, cb) => {
    const r = {
      code: newCode(), chat: [], mode: 'f', gm: 'std', theme: null, auc: 'open', sealed: {}, reveal: null, dif: 1, vol: 70, vv: 25, phase: 'lobby', players: [], used: new Set(),
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
    if (r.phase === 'lobby' && (d.mode === 'f' || d.mode === 'k' || d.mode === 'b')) r.mode = d.mode;
    if (['lobby', 'idle', 'sold'].includes(r.phase) && (d.auc === 'open' || d.auc === 'blind')) r.auc = d.auc;
    if (r.phase === 'lobby' && ['std', 'cast', 'tema', 'versus', 'best', 'xi', 'sim'].includes(d.gm)) r.gm = d.gm;
    if (r.phase === 'lobby' && (d.jury === 3 || d.jury === 5)) r.jury = d.jury;
    if ((r.gm === 'cast' || r.gm === 'tema') && r.mode !== 'k') r.gm = 'std'; // cast y amar tema solo existen con Frikirappers
    if ((r.gm === 'versus' || r.gm === 'sim') && r.mode !== 'f') r.gm = 'std'; // versus y simulaciones solo existen con Freestylers
    if (r.mode === 'b') { if (r.gm !== 'xi' && r.gm !== 'best') r.gm = 'xi'; } // Blue Lock: «armar 11» o «armar el mejor»
    else if (r.gm === 'xi') r.gm = 'std';
    if (r.phase === 'lobby') r.players.forEach(p => p.money = moneyOf(r));
    push(r);
  });

  s.on('start', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'lobby' || r.players.length < (r.gm === 'sim' ? 1 : 2)) return;
    if ((r.gm === 'cast' || r.gm === 'tema') && r.mode !== 'k') r.gm = 'std';
    if ((r.gm === 'versus' || r.gm === 'sim') && r.mode !== 'f') r.gm = 'std';
    if (r.gm === 'sim') { if (r.players.length > SIM_MAX) return; return simStart(r); } // simulaciones: sin subasta
    if (r.mode === 'b') { if (r.gm !== 'xi' && r.gm !== 'best') r.gm = 'xi'; } else if (r.gm === 'xi') r.gm = 'std';
    r.theme = r.gm === 'cast' ? THEMES[Math.floor(Math.random() * THEMES.length)]
      : r.gm === 'best' ? { name: 'ARMAR EL MEJOR', roles: BEST[r.mode].map(c => [Math.random(), c]).sort((a, b) => a[0] - b[0]).slice(0, BEST_PICK).map(x => x[1]).sort((a, b) => BEST[r.mode].indexOf(a) - BEST[r.mode].indexOf(b)) }
      : null;
    r.order = null;
    if (r.gm === 'tema') {
      const t = buildTema('AMAR TEMA'); r.theme = t.theme; r.order = t.order;
      // cada jugador recibe una temática distinta (si hay más jugadores que temáticas, se vuelven a repartir)
      let bag = [];
      r.players.forEach(p => {
        if (!bag.length) bag = [...TEMA_THEMES].sort(() => Math.random() - 0.5);
        p.tname = bag.pop();
      });
    }
    r.curSlot = null; r.market = false; r.sales = 0;
    r.players.forEach(p => { p.money = moneyOf(r); p.roster = []; p.cast = {}; p.chars = {}; p.rivals = []; p.form = (p.bot && Math.random() < 0.5) ? '442' : '433'; });
    if (r.gm === 'tema' || r.gm === 'versus' || POOL[r.mode].filter(n => !r.used.has(key(n))).length < r.players.length * goalOf(r)) r.used.clear();
    if (r.gm === 'versus') { // 5 rivales distintos para cada jugador, sacados de la bolsa y apartados de la subasta
      let bag = [...POOL.f].sort(() => Math.random() - 0.5);
      r.players.forEach(p => {
        if (bag.length < GOAL) { // con muchos jugadores la bolsa puede agotarse: se rellena (sin repetir nombres dentro de los 5 del mismo jugador)
          const left = new Set(bag.map(key));
          bag = [...bag, ...[...POOL.f].sort(() => Math.random() - 0.5).filter(n => !left.has(key(n)))];
        }
        p.rivals = bag.splice(0, GOAL); p.rivals.forEach(n => r.used.add(key(n)));
      });
    }
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
    botTick(r);
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
    botTick(r);
  });

  s.on('bid', n => {
    const { r, p } = ctxOf(); if (!r || !p) return;
    doBid(r, p, n);
  });

  // ---- Cast ----
  s.on('place', ({ name, role } = {}) => {
    const { r, p } = ctxOf();
    if (!r || !p || ['lobby', 'vote', 'end'].includes(r.phase)) return;
    const roles = rolesOf(r, p); if (!roles) return;
    if (!p.roster.includes(name)) return;
    if (role !== null && !roles.includes(role)) return;
    for (const k of Object.keys(p.cast)) if (p.cast[k] === name) delete p.cast[k];
    if (role !== null) p.cast[role] = name; // si el puesto estaba ocupado, el anterior queda sin colocar
    push(r);
  });

  // ---- Armar 11: elegir formación ----
  s.on('form', f => {
    const { r, p } = ctxOf();
    if (!r || !p || r.gm !== 'xi' || ['lobby', 'vote', 'end'].includes(r.phase) || !FORMS[f]) return;
    p.form = f;
    for (const k of Object.keys(p.cast)) if (!FORMS[f].includes(k)) delete p.cast[k]; // los puestos que ya no existen quedan sin colocar
    push(r);
  });

  // ---- Chat ----
  s.on('chat', text => {
    const { r, p } = ctxOf(); if (!r || !p) return;
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN);
    const now = Date.now();
    if (!text || now - (p.lastChat || 0) < CHAT_GAP) return;
    p.lastChat = now;
    const m = { from: p.id, name: p.name, text, t: now };
    r.chat.push(m);
    if (r.chat.length > CHAT_MAX) r.chat.shift();
    io.to(r.code).emit('chat', m);
  });

  // ---- Amar tema: personaje de cada participante ----
  s.on('char', ({ slot, text } = {}) => {
    const { r, p } = ctxOf();
    if (!r || !p || r.gm !== 'tema' || !r.theme || ['lobby', 'vote', 'end'].includes(r.phase)) return;
    if (!r.theme.charSlots.includes(slot)) return;
    p.chars[slot] = String(text || '').slice(0, 30);
    push(r);
  });

  // ---- Intercambios ----
  s.on('offer', ({ to, give, want, cash, cdir } = {}) => {
    const { r, p } = ctxOf(); if (!r || !p || !marketOpen(r)) return;
    const t = find(r, to);
    if (!t || t.id === p.id) return;
    give = give || null; want = want || null;
    if (give && !p.roster.includes(give)) return;
    if (want && !t.roster.includes(want)) return;
    if (r.gm === 'xi') {
      // en «armar 11» se puede añadir dinero: «pago» (yo pongo) o «pido» (el otro pone)
      cash = Math.min(999, Math.max(0, Math.floor(+cash) || 0));
      if (cdir !== 'pay' && cdir !== 'ask') cdir = 'pay';
      if (!give && !want) return;
      if (!give && !(cash > 0 && cdir === 'pay')) return; // comprar un personaje: hay que pagar
      if (!want && !(cash > 0 && cdir === 'ask')) return; // vender un personaje: hay que pedir dinero
      if (cash > 0 && (cdir === 'pay' ? p : t).money < cash) return; // quien paga debe tener el dinero
    } else {
      if (!give || !want) return;
      cash = 0; cdir = null;
    }
    if (r.offers.filter(o => o.from === p.id).length >= 6) return;
    const o = { id: ++r.oid, from: p.id, to: t.id, give, want, cash, cdir };
    r.offers.push(o);
    push(r);
    botReply(r, o);
  });

  s.on('respond', ({ id, ok } = {}) => {
    const { r, p } = ctxOf(); if (!r || !p) return;
    respondOffer(r, p, id, ok);
  });

  // ---- Votación ----
  s.on('voteStart', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'trade') return;
    autofill(r);
    r.phase = 'vote'; r.votes = {}; r.offers = [];
    push(r);
    botVotes(r);
  });
  s.on('vote', ranking => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'vote' || p.id in r.votes) return;
    const others = r.players.filter(q => q.id !== p.id).map(q => q.id);
    if (!Array.isArray(ranking) || ranking.length !== others.length || new Set(ranking).size !== others.length || !ranking.every(id => others.includes(id))) return;
    r.votes[p.id] = ranking;
    if (r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
    push(r);
  });
  s.on('voteEnd', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'vote') return;
    finishVote(r);
  });

  s.on('restart', () => {
    const { r } = hostCtx(); if (!r || !(r.phase === 'end' || (r.phase === 'sim' && r.sim && r.sim.step === 'end'))) return;
    toLobby(r);
  });

  // ---- Simulaciones: jurado y avance de la temporada ----
  s.on('simVote', c => {
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'sim' || !r.sim) return;
    const S = r.sim; if (S.step !== 'vote') return;
    if (!['a', 'b', 'r'].includes(c) || (c === 'r' && S.round === 2)) return;
    const i = S.jurors.findIndex(j => j.k === 'p' && j.id === p.id);
    if (i < 0 || i in S.votes) return;
    S.votes[i] = c;
    simCheck(r);
  });
  s.on('simLeagueVote', c => { // voto de las 4 mejores ligas (solo con más de 4 jugadores)
    const { r, p } = ctxOf(); if (!r || !p || r.phase !== 'sim' || !r.sim || r.sim.step !== 'lvote') return;
    const S = r.sim;
    if (!Array.isArray(c) || c.length !== 4 || p.id in S.lvotes) return;
    if (!c.every(x => Number.isInteger(x) && x >= 0 && x < S.leagues.length) || new Set(c).size !== 4) return;
    S.lvotes[p.id] = c.slice();
    simLeagueCheck(r);
  });
  s.on('simSkip', () => { // el anfitrión da por votados (al azar) a los que faltan
    const { r } = hostCtx(); if (!r || r.phase !== 'sim' || !r.sim) return;
    if (r.sim.step === 'lvote') { // quien no ha votado vota solo como un bot
      const S = r.sim; r.players.forEach(p => { if (!(p.id in S.lvotes)) { const t = S.leagues.map((_, l) => l); S.lvotes[p.id] = simShuffle(t).slice(0, 4); } });
      return simLeagueCheck(r);
    }
    if (r.sim.step !== 'vote') return;
    const S = r.sim, bt = S.battles[S.b];
    S.jurors.forEach((j, i) => { if (!(i in S.votes)) S.votes[i] = simAi(simCacheOf(S, bt, 'a'), simCacheOf(S, bt, 'b'), S.round === 1); });
    simAutoVotes(r); simCheck(r);
  });
  s.on('simNext', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'sim' || !r.sim) return;
    simNextStep(r);
  });

  // ---- Bots ----
  s.on('addBot', () => {
    const { r } = hostCtx(); if (!r || r.phase !== 'lobby' || r.players.length >= maxPlayers(r)) return;
    const taken = new Set(r.players.map(q => q.name));
    const nm = '🤖 ' + (BOT_NAMES.find(n => !taken.has('🤖 ' + n)) || 'Bot ' + (r.players.length + 1));
    const id = 'p' + (++pidSeq);
    r.players.push({ id, tok: 'bot-' + id, name: nm, money: moneyOf(r), roster: [], cast: {}, chars: {}, on: true, sid: null, tname: null, rivals: [], form: '433', bot: true, max: 0, bt: null });
    push(r);
  });

  // ---- Sacar de la sala a un jugador desconectado (solo el anfitrión) ----
  s.on('kick', id => {
    const { r, p } = hostCtx(); if (!r) return;
    const t = find(r, id);
    if (!t || t.id === p.id || (t.on && !t.bot)) return; // solo se puede sacar a quien está sin conexión (o a un bot)
    removePlayer(r, t);
  });

  s.on('disconnect', () => {
    const x = bySock[s.id]; delete bySock[s.id]; if (!x) return;
    const r = rooms[x.code]; if (!r) return;
    const p = find(r, x.pid); if (!p || p.sid !== s.id) return;
    p.on = false;
    if (r.phase === 'lobby') r.players = r.players.filter(q => q !== p);
    if (r.hostId === p.id) { const n = r.players.find(q => q.on && !q.bot); if (n) r.hostId = n.id; }
    if (!r.players.some(q => q.on && !q.bot)) {
      r.gc = setTimeout(() => { clearTimeout(r.timer); delete rooms[r.code]; }, 10 * 60 * 1000);
    } else {
      if (r.phase === 'auction' && r.auc === 'blind' && Object.keys(r.sealed).length && eligible(r).filter(q => q.on).every(q => q.id in r.sealed)) return closeBlind(r);
      if (r.phase === 'vote' && r.players.filter(q => q.on).every(q => r.votes[q.id])) return finishVote(r);
      if (r.phase === 'sim' && r.sim && (r.sim.step === 'vote' || r.sim.step === 'lvote')) return simPending(r);
      push(r);
    }
  });
});

// <<< ENGINE END
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Subasta a sordas escuchando en el puerto ' + PORT));
