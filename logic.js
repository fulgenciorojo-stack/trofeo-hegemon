/* Motor de reglas · XXVI Trofeo Hegemón 2026-27
   Funciones puras sobre el "state". Sin DOM, para poder probarlas con node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- utilidades ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const diffDays = (a, b) =>
    Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ---------- estado ----------
  function makePlayer(name, phone) {
    return {
      id: uid(), name: name.trim(), phone: (phone || '').trim(),
      blocked: false, blockedCount: 0,        // "no retable" (norma l)
      rp: false, rpRounds: 0, rpUsed: false,  // Ranking Protegido (norma n)
      down: false,                            // 🔽
      sinPref: false,                         // vuelve "sin preferencia"
      leveWithdrawals: 0,                     // renuncias no graves previas (norma k)
    };
  }

  function makePeriod(n, start, days, rankingStart) {
    return {
      n, start, end: addDays(start, days - 1), closed: false,
      challenges: [], rankingStart: rankingStart.slice(), rankingEnd: null, log: [],
    };
  }

  function defaultState() {
    const settings = {
      title: 'XXVI Trofeo Hegemón', season: '2026-27', referee: 'Luis Nicolás',
      startDate: '2026-10-05', periodDays: 15, dayOverride: 'auto',
    };
    return {
      version: 1, settings, players: {}, ranking: [],
      periods: [makePeriod(1, settings.startDate, settings.periodDays, [])],
      finalRanking: null, bracket: {}, history: [],
    };
  }

  const currentPeriod = (st) => st.periods[st.periods.length - 1];
  const nameOf = (st, id) => (st.players[id] ? st.players[id].name : '¿?');

  function addPlayer(st, name, phone, position) {
    const p = makePlayer(name, phone);
    st.players[p.id] = p;
    const pos = position == null || position > st.ranking.length ? st.ranking.length : Math.max(0, position - 1);
    st.ranking.splice(pos, 0, p.id);
    return p;
  }

  function removePlayer(st, id) {
    st.ranking = st.ranking.filter((x) => x !== id);
    delete st.players[id];
    const p = currentPeriod(st);
    p.challenges = p.challenges.filter((c) => c.challengerId !== id && c.challengedId !== id);
  }

  // ---------- reglas de reto ----------
  // d) penalización del retador que pierde según la distancia a la que retó
  function penaltyForDistance(d) {
    if (d <= 5) return 2;
    if (d === 6) return 3;
    if (d <= 8) return 4;
    return 5;
  }

  const effectiveWinner = (c) => {
    if (c.status === 'jugado') return c.winnerId;
    if (c.status === 'noPuede') return c.noPuedeId === c.challengerId ? c.challengedId : c.challengerId;
    return null;
  };

  const isActive = (c) => c.status !== 'anulado';

  // Contexto del periodo actual: quién está en reto, restricciones del periodo anterior (o, p)
  function context(st) {
    const cur = currentPeriod(st);
    const prev = st.periods[st.periods.length - 2];
    const ctx = {
      involved: new Set(), prevChallengers: new Set(), prevChallengersWon: new Set(),
      prevChallenged: new Set(), noRetar: {},
    };
    cur.challenges.filter(isActive).forEach((c) => { ctx.involved.add(c.challengerId); ctx.involved.add(c.challengedId); });
    if (prev) {
      prev.challenges.filter(isActive).forEach((c) => {
        ctx.prevChallengers.add(c.challengerId);
        ctx.prevChallenged.add(c.challengedId);
        const w = effectiveWinner(c);
        if (!w) return;
        if (w === c.challengerId) ctx.prevChallengersWon.add(w);
        const loser = w === c.challengerId ? c.challengedId : c.challengerId;
        (ctx.noRetar[loser] = ctx.noRetar[loser] || new Set()).add(w); // quien pierde no puede retar a quien le ganó
      });
    }
    return ctx;
  }

  // o) quién puede retar según el día del periodo (1, 2 o 3)
  function whyCannotChallenge(st, ctx, id, day) {
    const pl = st.players[id];
    if (!pl) return 'No existe';
    if (pl.blocked) return 'No retable (bloqueado)';
    if (pl.rp) return 'Ranking protegido';
    if (ctx.involved.has(id)) return 'Ya está en un reto';
    if (day <= 1 && ctx.prevChallengers.has(id)) return 'Día 1: retó el periodo anterior';
    if (day === 2 && ctx.prevChallengers.has(id) && !ctx.prevChallengersWon.has(id))
      return 'Día 2: retó el periodo anterior y no ganó';
    return null;
  }

  function whyNotTarget(st, ctx, challengerId, targetId, day) {
    const pl = st.players[targetId];
    if (pl.blocked) return 'No retable';
    if (pl.rp) return 'Ranking protegido';
    if (ctx.involved.has(targetId)) return 'En reto';
    if (day <= 1 && ctx.prevChallenged.has(targetId)) return 'P (retado el periodo anterior, día 1)';
    if (ctx.noRetar[challengerId] && ctx.noRetar[challengerId].has(targetId)) return 'Perdió contra él/ella el periodo anterior';
    return null;
  }

  // d) + e) a quién puede retar un jugador
  function computeOptions(st, challengerId, day) {
    const ctx = context(st);
    const err = whyCannotChallenge(st, ctx, challengerId, day);
    if (err) return { error: err, mode: 'none', rows: [] };
    const idx = st.ranking.indexOf(challengerId);
    const above = [];
    for (let d = 1; d <= 10 && idx - d >= 0; d++) {
      const id = st.ranking[idx - d];
      above.push({ id, dist: d, pos: idx - d + 1, reason: whyNotTarget(st, ctx, challengerId, id, day), dir: 'up' });
    }
    const freeNear = above.filter((r) => r.dist <= 5 && !r.reason);
    let mode = 'none';
    if (freeNear.length) { mode = 'normal'; freeNear.forEach((r) => (r.ok = true)); }
    else {
      const far = above.find((r) => r.dist > 5 && !r.reason);
      if (far) { mode = 'extendido'; far.ok = true; }
    }
    let rows = above;
    if (mode === 'none') {
      mode = 'inverso';
      rows = [];
      let found = false;
      for (let d = 1; d <= 5 && idx + d < st.ranking.length; d++) {
        const id = st.ranking[idx + d];
        const reason = whyNotTarget(st, ctx, challengerId, id, day);
        const row = { id, dist: d, pos: idx + d + 1, reason, dir: 'down' };
        if (!reason && !found) { row.ok = true; found = true; }
        rows.push(row);
      }
      if (!found) mode = 'none';
    }
    return { mode, rows, error: null };
  }

  function createChallenge(st, challengerId, targetId, day, force) {
    const cur = currentPeriod(st);
    const ci = st.ranking.indexOf(challengerId), ti = st.ranking.indexOf(targetId);
    if (ci < 0 || ti < 0 || ci === ti) return { error: 'Jugadores no válidos' };
    if (!force) {
      const opts = computeOptions(st, challengerId, day);
      if (opts.error) return { error: opts.error };
      const row = opts.rows.find((r) => r.id === targetId);
      if (!row || !row.ok) return { error: 'Ese reto no está permitido por las normas' };
    }
    const type = ti < ci ? 'normal' : 'inverso';
    const c = {
      id: uid(), type, challengerId, challengedId: targetId,
      posChallenger: ci + 1, posChallenged: ti + 1, dist: Math.abs(ci - ti),
      status: 'pendiente', winnerId: null, score: '', noPuedeId: null, grave: true, forced: !!force,
    };
    cur.challenges.push(c);
    return { challenge: c };
  }

  // ---------- movimientos ----------
  function moveTo(arr, id, to) {
    const i = arr.indexOf(id);
    if (i < 0) return;
    arr.splice(i, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, id);
  }
  const moveDown = (arr, id, n) => moveTo(arr, id, arr.indexOf(id) + n);
  const moveUp = (arr, id, n) => moveTo(arr, id, arr.indexOf(id) - n);
  function swap(arr, a, b) {
    const i = arr.indexOf(a), j = arr.indexOf(b);
    arr[i] = b; arr[j] = a;
  }

  // Aplica el cierre del periodo sobre `st` (mutándolo). Devuelve el registro de movimientos.
  function applyClose(st) {
    const cur = currentPeriod(st);
    const arr = st.ranking.slice();
    const log = [];
    const nm = (id) => nameOf(st, id);
    Object.values(st.players).forEach((p) => (p.down = false));

    const active = cur.challenges.filter(isActive)
      .sort((a, b) => Math.min(a.posChallenger, a.posChallenged) - Math.min(b.posChallenger, b.posChallenged));

    // anulados (g): se penaliza al retador que no envió el privado
    cur.challenges.filter((c) => c.status === 'anulado').forEach((c) => {
      moveDown(arr, c.challengerId, 2);
      st.players[c.challengerId].down = true;
      log.push(`${nm(c.challengerId)}: reto anulado (sin mensaje privado) → baja 2 y 🔽`);
    });

    active.forEach((c) => {
      const A = c.challengerId, B = c.challengedId;
      let status = c.status;
      if (status === 'pendiente' || (status === 'jugado' && !c.winnerId)) status = 'sinResultado';
      if (status === 'sinResultado') {
        moveDown(arr, A, 3); moveDown(arr, B, 3);
        log.push(`${nm(A)} vs ${nm(B)}: sin resultado a tiempo (j) → ambos bajan 3`);
        return;
      }
      if (status === 'noPuede') {
        const who = c.noPuedeId, pl = st.players[who];
        const pen = !c.grave && pl.leveWithdrawals > 0 ? 5 : 3;
        if (!c.grave) pl.leveWithdrawals++;
        pl.down = true;
        if (c.type === 'normal') {
          if (who === A) { moveDown(arr, A, pen); moveUp(arr, B, 2); }
          else { if (arr.indexOf(A) > arr.indexOf(B)) moveTo(arr, A, arr.indexOf(B)); moveDown(arr, B, pen - 1); }
        } else {
          if (who === A) moveDown(arr, A, pen);
          else { moveUp(arr, A, 1); moveDown(arr, B, pen); }
        }
        log.push(`${nm(who)} no puede jugar contra ${nm(who === A ? B : A)} (${c.grave ? 'causa grave' : 'causa no grave'}) → pierde el reto, baja ${pen} y 🔽`);
        return;
      }
      // jugado
      const aWon = c.winnerId === A;
      if (c.type === 'normal') {
        if (aWon) {
          if (arr.indexOf(A) > arr.indexOf(B)) moveTo(arr, A, arr.indexOf(B));
          log.push(`${nm(A)} gana a ${nm(B)} y ocupa su puesto`);
        } else {
          const pen = penaltyForDistance(c.dist);
          moveDown(arr, A, pen); moveUp(arr, B, 2);
          log.push(`${nm(B)} gana a ${nm(A)}: ${nm(B)} sube 2, ${nm(A)} baja ${pen}`);
        }
      } else if (aWon) {
        moveUp(arr, A, 1);
        log.push(`Reto inverso: ${nm(A)} gana a ${nm(B)} y sube 1`);
      } else {
        swap(arr, A, B);
        log.push(`Reto inverso: ${nm(A)} pierde con ${nm(B)} y se intercambian los puestos`);
      }
    });

    // l) bloqueados y n) ranking protegido
    Object.values(st.players).forEach((p) => {
      if (p.blocked) {
        p.blockedCount++;
        if (p.blockedCount >= 2) { moveDown(arr, p.id, 2); log.push(`${p.name}: bloqueado desde la 2.ª ronda → baja 2`); }
      }
      if (p.rp) p.rpRounds++;
    });

    cur.closed = true;
    cur.rankingEnd = arr.slice();
    cur.log = log;
    st.ranking = arr;
    const next = makePeriod(cur.n + 1, addDays(cur.end, 1), st.settings.periodDays, arr);
    st.periods.push(next);
    return log;
  }

  function previewClose(st) {
    const copy = clone(st);
    copy.history = [];
    const before = copy.ranking.slice();
    const log = applyClose(copy);
    return { before, after: copy.ranking, log, players: copy.players };
  }

  function closePeriod(st) {
    const snap = clone(st);
    snap.history = [];
    st.history.push(JSON.stringify(snap));
    if (st.history.length > 15) st.history.shift();
    return applyClose(st);
  }

  function undoClose(st) {
    if (!st.history.length) return false;
    const prev = JSON.parse(st.history.pop());
    const history = st.history;
    Object.keys(st).forEach((k) => delete st[k]);
    Object.assign(st, prev, { history });
    return true;
  }

  // ---------- RP y bloqueos ----------
  function setBlocked(st, id, on) {
    const p = st.players[id];
    if (on) { p.blocked = true; p.blockedCount = 0; }
    else { p.blocked = false; p.blockedCount = 0; p.sinPref = true; }
  }
  function startRP(st, id) {
    const p = st.players[id];
    if (p.rpUsed) return 'Este jugador ya usó su Ranking Protegido (solo una vez).';
    p.rp = true; p.rpRounds = 0;
    return null;
  }
  function endRP(st, id) {
    const p = st.players[id];
    if (p.rpRounds < 3) return 'El RP dura como mínimo 3 rondas completas.';
    if (p.rpRounds > 6) { moveDown(st.ranking, id, 10); }
    p.rp = false; p.rpUsed = true; p.sinPref = true;
    return p.rpRounds > 6 ? 'Reactivado con penalización de 10 puestos (RP de más de 6 rondas).' : null;
  }

  // ---------- fase 2: cuadros finales ----------
  const PAIRS = {
    16: [[1, 16], [9, 8], [5, 12], [13, 4], [3, 14], [6, 11], [7, 10], [15, 2]],
    8: [[1, 8], [5, 4], [3, 6], [7, 2]],
  };
  const ROUND_NAMES = { 16: ['Octavos', 'Cuartos', 'Semifinales', 'Final'], 8: ['Cuartos', 'Semifinales', 'Final'] };

  function buildGroups(ranking) {
    const groups = [];
    for (let i = 0; i < ranking.length; i += 16) {
      const g = ranking.slice(i, i + 16);
      if (g.length >= 8) groups.push(g);
    }
    return groups;
  }

  function buildBracket(group, gi, winners) {
    const size = group.length <= 8 ? 8 : 16;
    const seed = (s) => group[s - 1] || null;
    let slots = PAIRS[size].map(([a, b]) => [seed(a), seed(b)]);
    const rounds = [];
    for (let r = 0; r < ROUND_NAMES[size].length; r++) {
      const matches = slots.map(([a, b], m) => {
        const key = `g${gi}-r${r}-m${m}`;
        let winner = null;
        if (a && !b) winner = a;
        else if (b && !a) winner = b;
        else if (a && b && (winners[key] === a || winners[key] === b)) winner = winners[key];
        return { key, a, b, winner, bye: !(a && b) };
      });
      rounds.push({ name: ROUND_NAMES[size][r], matches });
      const next = [];
      for (let m = 0; m < matches.length; m += 2) next.push([matches[m].winner, matches[m + 1] ? matches[m + 1].winner : null]);
      slots = next;
    }
    return { size, rounds };
  }

  return {
    clone, uid, addDays, diffDays, todayStr, makePlayer, makePeriod, defaultState, currentPeriod, nameOf,
    addPlayer, removePlayer, penaltyForDistance, effectiveWinner, context, whyCannotChallenge,
    computeOptions, createChallenge, applyClose, previewClose, closePeriod, undoClose,
    setBlocked, startRP, endRP, buildGroups, buildBracket, moveTo, moveDown, moveUp,
  };
});
