/* Trofeo Hegemón · app de jugadores y juez */
(function () {
  'use strict';
  const L = window.Logic, CFG = window.TENIS_CONFIG;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } },
  };
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- estado ----------
  let S = null;                     // estado público
  let A = null;                     // estado admin (si hay sesión de juez)
  // La sesión (jugador + PIN) se guarda en localStorage y se replica en IndexedDB; si un almacén se pierde, se recupera del otro.
  const idb = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('hegemon', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
    async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* */ } },
    async del(k) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* */ } },
  };
  const askPersist = () => { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ } };
  const saveSession = (v) => { store.set('hegemon.me', v); idb.set('me', v); askPersist(); };
  const clearSession = () => { store.del('hegemon.me'); idb.del('me'); };
  let me = store.get('hegemon.me'); // {id, pin}
  if (me && me.id) idb.set('me', me); else me = null;
  let adminPwd = null; try { adminPwd = sessionStorage.getItem('hegemon.admin'); } catch (e) { /* */ }
  const ui = { tab: 'home', admTab: 'control', filter: '' };
  let clockOffset = 0, lastSig = '', lastEventId = store.get('hegemon.lastEv');
  let firstLoad = true, prevPos = {};

  // ---------- API ----------
  async function rpc(fn, args) {
    const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    if (!r.ok) throw new Error('Error de conexión (' + r.status + ')');
    return r.json();
  }
  const admin = (op, args) => rpc('tenis_admin', { p_pwd: adminPwd, p_op: op, p_args: args || {} });
  const creds = () => ({ p_id: me && me.id, p_pin: me && me.pin });

  // ---------- utilidades ----------
  const P = () => (S ? Object.fromEntries(S.players.map((p) => [p.id, p])) : {});
  const nm = (id) => { const p = P()[id]; return p ? p.name : '¿?'; };
  const pos = (id) => { const p = P()[id]; return p ? p.pos : '?'; };
  const now = () => Date.now() + clockOffset;
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDeadline = (iso) => new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  function ago(iso) {
    const s = Math.max(0, (now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'ahora'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`; return `hace ${Math.floor(s / 86400)} d`;
  }
  function countdown(iso) {
    const ms = new Date(iso).getTime() - now();
    if (ms <= 0) return 'Plazo terminado';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return d > 0 ? `${d} d ${h} h` : `${h} h ${m} min`;
  }
  const myChal = () => (S && me ? S.challenges.find((c) => c.status !== 'anulado' && (c.a === me.id || c.b === me.id)) : null);
  const isMe = (id) => me && me.id === id;
  const waPhone = (p) => { if (!p) return null; let d = p.replace(/\D/g, ''); if (d.length === 9) d = '34' + d; return d; };
  const firstName = (n) => n.split(' ')[0];

  // ---------- notificaciones y efectos ----------
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.innerHTML = msg;
    $('#toasts').appendChild(t); setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 4800);
  }

  const fx = { parts: [], raf: 0 };
  function burst(opts) {
    if (reduce) return;
    const cv = $('#fx'), W = (cv.width = innerWidth), H = (cv.height = innerHeight), n = (opts && opts.n) || 140;
    const colors = ['#d4f53c', '#ffffff', '#ff7a3d', '#4ade80', '#ffd24a'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 12;
      fx.parts.push({
        x: (opts && opts.x != null ? opts.x : W / 2), y: (opts && opts.y != null ? opts.y : H * 0.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6,
        r: 4 + Math.random() * 6, c: colors[i % colors.length], ball: Math.random() < 0.35, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 1,
      });
    }
    if (!fx.raf) fx.raf = requestAnimationFrame(tick);
    function tick() {
      const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
      fx.parts = fx.parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
      fx.parts.forEach((p) => {
        p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.006;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, p.life * 2);
        if (p.ball) {
          ctx.fillStyle = '#d4f53c'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-p.r * .9, 0, p.r * .9, -1, 1); ctx.stroke();
        } else { ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); }
        ctx.restore();
      });
      if (fx.parts.length) fx.raf = requestAnimationFrame(tick); else { fx.raf = 0; ctx.clearRect(0, 0, cv.width, cv.height); }
    }
  }

  function overlay(html, cls, confetti) {
    const ov = $('#ov'); ov.className = 'ov ' + (cls || ''); ov.innerHTML = html; ov.hidden = false;
    if (confetti) { setTimeout(() => burst({ n: 180 }), 650); setTimeout(() => burst({ n: 120, x: innerWidth * .2, y: innerHeight * .6 }), 900); setTimeout(() => burst({ n: 120, x: innerWidth * .8, y: innerHeight * .6 }), 1100); }
  }
  function closeOverlay() { $('#ov').hidden = true; $('#ov').innerHTML = ''; }

  function duelOverlay(a, b, mode) {
    const incoming = mode === 'incoming';
    overlay(`<div class="ovt">${incoming ? '¡Te han retado!' : '¡Reto lanzado!'}</div>
      <div class="stage"><div class="f l"><div class="p">#${a.pos}</div><div class="n">${esc(a.name)}</div></div><div class="vsx">VS</div>
      <div class="f r"><div class="p">#${b.pos}</div><div class="n">${esc(b.name)}</div></div></div>
      <div class="sub">${incoming ? `${esc(firstName(a.name))} te ha retado. Mira tu WhatsApp para fijar fecha y hora, ¡y prepárate!` : `Ahora avisa al grupo y al rival por privado. Tenéis hasta el ${esc(fmtDeadline(S.period.deadline))}.`}</div>
      <button class="btn go big" data-act="closeOv">${incoming ? 'A por él' : 'Seguir'}</button>`, incoming ? 'incoming' : '', true);
  }
  function resultOverlay(win, winnerName, loserName, score) {
    overlay(`<div class="trophy">${win ? '🏆' : '💪'}</div><div class="ovt">${win ? '¡Victoria!' : 'Derrota'}</div>
      <div class="sub">${win ? `Has ganado a ${esc(loserName)}${score ? ' (' + esc(score) + ')' : ''}. El ranking se actualizará al cierre del periodo.` : `${esc(winnerName)} se lleva este reto${score ? ' (' + esc(score) + ')' : ''}. ¡La revancha llegará!`}</div>
      <button class="btn go big" data-act="closeOv">Vale</button>`, win ? '' : 'lose', win);
  }

  // ---------- eventos en vivo ----------
  function evText(e) {
    const d = e.data;
    switch (e.kind) {
      case 'challenge': return `⚔️ <b>${esc(d.a.name)}</b> (#${d.a.pos}) reta a <b>${esc(d.b.name)}</b> (#${d.b.pos})${d.type === 'inverso' ? ' · reto inverso' : d.dist > 5 ? ` · a ${d.dist} puestos` : ''}`;
      case 'result': return `🏆 <b>${esc(d.winner)}</b> gana a ${esc(d.loser)}${d.score ? ' · ' + esc(d.score) : ''}`;
      case 'cant_play': return `🚫 <b>${esc(d.name)}</b> no puede disputar su reto`;
      case 'window': return d.day ? `🟢 <b>¡Retos abiertos!</b> ${d.day === 3 ? 'Pueden retar todos' : 'Día ' + d.day}` : '🔒 Retos cerrados';
      case 'close': return `📊 <b>Periodo ${d.period} cerrado.</b> ¡Nuevo ranking publicado!`;
      case 'notice': return `📢 ${esc(d.text)}`;
      default: return esc(e.kind);
    }
  }

  function handleEvents(events) {
    const maxId = events.length ? events[0].id : 0;
    if (lastEventId == null || firstLoad) { lastEventId = maxId; store.set('hegemon.lastEv', lastEventId); return; }
    const fresh = events.filter((e) => e.id > lastEventId).reverse();
    lastEventId = Math.max(lastEventId, maxId); store.set('hegemon.lastEv', lastEventId);
    fresh.slice(-4).forEach((e) => {
      const d = e.data;
      if (e.kind === 'challenge' && me && d.b.id === me.id) { duelOverlay(d.a, d.b, 'incoming'); return; }
      if (e.kind === 'challenge' && me && d.a.id === me.id) return; // ya lo vio al lanzarlo
      if (e.kind === 'result' && me && (d.winner_id === me.id)) return;
      toast(evText(e), e.kind === 'challenge' ? 'hot' : '');
      if (e.kind === 'window' && d.day) burst({ n: 90 });
      if (e.kind === 'close') burst({ n: 160 });
    });
  }

  // ---------- carga ----------
  async function refresh(force) {
    try {
      const data = await rpc('tenis_state', creds());
      clockOffset = new Date(data.now).getTime() - Date.now();
      if (me && data.me && data.me.error) {
        // Solo se cierra la sesión si el PIN ya no es válido (cambiado por el juez o desde otro dispositivo), confirmado dos veces seguidas.
        // Cualquier otro error (bloqueo temporal, fallo del servidor…) mantiene la sesión.
        if (/PIN incorrecto|no encontrado/i.test(data.me.error)) {
          ui.badPin = (ui.badPin || 0) + 1;
          if (ui.badPin >= 2) { toast('Tu PIN ya no es válido (¿lo han cambiado?). Entra de nuevo con el PIN nuevo.', 'err'); me = null; clearSession(); ui.badPin = 0; }
        }
      }
      if (adminPwd) { const a = await admin('state'); if (a.error) { adminPwd = null; try { sessionStorage.removeItem('hegemon.admin'); } catch (e) { /* */ } } else A = a; }
      if (data.me && !data.me.error) ui.badPin = 0;
      const sig = JSON.stringify([data.players, data.challenges, data.config, data.period, data.events.length && data.events[0].id, data.bracket, data.finalRanking, data.me, A && [A.players.length, A.snapshots, A.periods.length]]);
      const changed = sig !== lastSig; lastSig = sig;
      const old = S; S = data;
      handleEvents(data.events); firstLoad = false;
      if (me && data.me && !data.me.error && data.me.notifLast && data.me.notifLast !== ui.notifFetched && !ui.notifBusy) { ui.notifBusy = true; ui.notifFetched = data.me.notifLast; setTimeout(() => { fetchNotifs().finally(() => { ui.notifBusy = false; }); }, 0); }
      if (changed || force) render(old);
    } catch (e) {
      if (!S) $('#view').innerHTML = `<div class="card empty"><h2>Sin conexión</h2><p>No se pudo cargar el torneo. Revisa tu internet.</p><button class="btn go" data-act="retry">Reintentar</button></div>`;
    }
  }

  // ---------- render ----------
  const IC = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h4.5V14h4v5.5h4.5V10"/>',
    rank: '<path d="M3 20.5h18"/><rect x="9" y="4.5" width="6" height="16" rx="1.5"/><rect x="3" y="11" width="6" height="9.5" rx="1.5"/><rect x="15" y="14" width="6" height="6.5" rx="1.5"/>',
    duels: '<path d="M4 4l11 11M20 4 9 15"/><path d="M13.5 16.5 17 20l3-3-3.5-3.5M10.5 16.5 7 20l-3-3 3.5-3.5"/>',
    bracket: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4.5v1.2A3.8 3.8 0 0 0 8 11M16 6h3.5v1.2A3.8 3.8 0 0 1 16 11"/><path d="M12 13.5V17M8.5 20.5h7M10 17h4"/>',
    hist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
    adm: '<path d="M12 3 20 6v6c0 4.8-3.4 7.9-8 9-4.6-1.1-8-4.2-8-9V6l8-3Z"/><path d="m8.8 12.2 2.2 2.2 4.2-4.4"/>',
  };
  const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  const TABS = [['home', 'home', 'Inicio'], ['rank', 'rank', 'Ranking'], ['duels', 'duels', 'Retos'], ['bracket', 'bracket', 'Cuadros'], ['hist', 'hist', 'Historial']];

  function render(old) {
    if (!S) { $('#view').innerHTML = '<div class="skel"></div>'.repeat(6); return; }
    document.title = S.config.title + ' · Retos';
    $('#title').textContent = S.config.title;
    $('#subtitle').textContent = `Temporada ${S.config.season} · Periodo ${S.period.n}`;
    const mp = me && P()[me.id];
    $('#who').textContent = mp ? mp.name : 'Entrar';
    $('#who').classList.toggle('on', !!mp);
    const tabs = TABS.concat(adminPwd ? [['adm', 'adm', 'Juez']] : []);
    $('#tabs').innerHTML = tabs.map(([k, i, l]) => `<button data-act="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="true"' : ''}>${icon(i)}<em>${l}</em></button>`).join('');
    const rects = {};
    if (old) document.querySelectorAll('[data-flip]').forEach((el) => { rects[el.dataset.flip] = el.getBoundingClientRect(); });
    const views = { home: vHome, rank: vRank, duels: vDuels, bracket: vBracket, hist: vHist, adm: vAdmin };
    $('#view').innerHTML = (views[ui.tab] || vHome)();
    if (old && ui.tab === 'rank') flip(rects, old);
    tickCountdowns();
  }

  function flip(rects, old) {
    const oldPos = Object.fromEntries(old.players.map((p) => [p.id, p.pos]));
    document.querySelectorAll('[data-flip]').forEach((el) => {
      const id = el.dataset.flip, r = rects[id]; if (!r) return;
      const n = el.getBoundingClientRect(), dy = r.top - n.top;
      if (dy && !reduce) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.9,.3,1)' });
      const p = P()[id];
      if (p && oldPos[id] && oldPos[id] !== p.pos) el.classList.add(p.pos < oldPos[id] ? 'up' : 'dn');
    });
  }

  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = countdown(el.dataset.countdown); });
  }

  // --- Inicio
  function vHome() {
    const mp = me && P()[me.id], day = S.config.challengeDay, open = day > 0;
    const active = S.challenges.filter((c) => c.status !== 'anulado');
    const pending = active.filter((c) => c.status === 'pendiente').length;
    const status = `<span class="status ${open ? 'open' : ''}"><i></i>${open ? `Retos abiertos · ${day === 3 ? 'pueden retar todos' : 'día ' + day}` : 'Retos cerrados'}</span>`;
    const cd = `<div class="small muted" style="margin-top:8px">⏱ Fin del periodo: <b data-countdown="${S.period.deadline}">${countdown(S.period.deadline)}</b> · ${esc(fmtDeadline(S.period.deadline))}</div>`;
    let hero;
    if (mp) {
      const mc = myChal();
      const canTry = open && !mc && !mp.blocked && !mp.rp;
      hero = `<section class="hero"><div class="kick">Hola, ${esc(firstName(mp.name))}</div>
        <div class="bigpos">#${mp.pos}<small>de ${S.players.length}</small></div>
        <div class="row" style="margin:6px 0 10px">${status}${mp.blocked ? '<span class="pill">⛔ No retable</span>' : ''}${mp.rp ? '<span class="pill">🛡️ Ranking protegido</span>' : ''}</div>
        ${canTry ? '<button class="btn go big" data-act="picker">⚔️ ¡Retar a alguien!</button>' : ''}
        ${!mc && !open ? '<p>Cuando el juez abra los retos podrás lanzar el tuyo desde aquí.</p>' : ''}
        ${!mc && open && (mp.blocked || mp.rp) ? '<p>Ahora mismo no estás disponible para retar.</p>' : ''}
        ${cd}</section>${S.me && !S.me.error && pushInfo && !pushInfo.on && (pushInfo.supported ? pushInfo.permission !== 'denied' : pushInfo.needsInstall) && !store.get('hegemon.pushHint') ? `<div class="card" style="border-color:var(--ball)"><h2>🔔 Activa los avisos</h2><p class="muted">Te avisamos en el móvil cuando te reten o te apunten un resultado, aunque la web esté cerrada.${pushInfo.needsInstall ? ' En iPhone, primero añade la web a la pantalla de inicio.' : ''}</p><div class="row"><button class="btn go" data-act="who">Configurar avisos</button><button class="btn" data-act="dismissPush">Ahora no</button></div></div>` : ''}${S.me && !S.me.error && !S.me.phone ? `<div class="card" style="border-color:var(--ball)"><h2>📱 Añade tu teléfono</h2><p class="muted">Así tu rival podrá escribirte por WhatsApp para quedar. Solo lo verán el juez y quien tenga un reto contigo.</p><button class="btn go" data-act="who">Añadir mi móvil</button></div>` : ''}${mc ? myDuel(mc) : ''}`;
    } else {
      hero = `<section class="hero"><div class="kick">Torneo social de tenis · ${esc(S.config.season)}</div>
        <h1>${esc(S.config.title)}</h1><p>Escala el ranking retando a quien tienes por encima. Entra con tu PIN para lanzar retos y apuntar resultados.</p>
        <div class="row" style="margin:12px 0">${status}</div>
        <button class="btn go big" data-act="who">Entrar con mi PIN</button>${cd}
        <div class="stats"><div class="stat"><b>${S.players.length}</b><span>jugadores</span></div><div class="stat"><b>${active.length}</b><span>retos en juego</span></div><div class="stat"><b>${pending}</b><span>por jugar</span></div></div></section>`;
    }
    return hero + avisosButton() + installButton() + feedCard();
  }

  function feedCard() {
    const evs = S.events.slice(0, 12);
    return `<div class="card feed"><h2>Lo último</h2>${evs.length ? evs.map((e) => `<div class="ev"><div>${evText(e)}</div><time>${ago(e.at)}</time></div>`).join('') : '<p class="muted">Todavía no hay actividad.</p>'}</div>`;
  }

  function steps(c) {
    const rivalId = c.a === me.id ? c.b : c.a, iChallenged = c.a === me.id, phone = waPhone((S.me && S.me.contacts && S.me.contacts[rivalId]) || '');
    if (!iChallenged) return '';
    const me_ = P()[me.id];
    const grp = `⚔️ RETO · ${me_.name} (#${me_.pos}) reta a ${nm(rivalId)} (#${pos(rivalId)}). ¡A jugar antes del ${fmtDate(S.period.end)} a las 19:00!`;
    const prv = `Hola ${firstName(nm(rivalId))}, soy ${me_.name}. Te he retado en el Hegemón. ¿Qué días y horas te vienen bien para jugar?`;
    const wa = (t, ph) => `https://wa.me/${ph || ''}?text=${encodeURIComponent(t)}`;
    return `<div class="steps">
      <div class="step ${c.msgGroup ? 'done' : ''}"><span class="ck">${c.msgGroup ? '✓' : ''}</span>Mensaje público en el grupo<a class="btn sm go" target="_blank" rel="noopener" href="${wa(grp)}" data-act="sent" data-kind="group" data-id="${c.id}">WhatsApp</a></div>
      <div class="step ${c.msgPrivate ? 'done' : ''}"><span class="ck">${c.msgPrivate ? '✓' : ''}</span>Privado a ${esc(firstName(nm(rivalId)))}, ¡ya!${phone ? `<a class="btn sm go" target="_blank" rel="noopener" href="${wa(prv, phone)}" data-act="sent" data-kind="private" data-id="${c.id}">WhatsApp</a>` : '<span class="small muted" style="margin-left:auto">pide el teléfono al juez</span>'}</div>
      ${!(c.msgGroup && c.msgPrivate) ? '<div class="note small">Si no mandas los dos mensajes, el reto no será válido (norma g).</div>' : ''}</div>`;
  }

  function myDuel(c) {
    return `<h3 style="padding:0 4px">Tu reto</h3>${duelCard(c, true)}`;
  }

  function duelCard(c, mine) {
    const label = { pendiente: 'Por jugar', jugado: 'Jugado', sinResultado: 'Sin resultado', noPuede: 'No puede jugar', anulado: 'Anulado' }[c.status];
    const w = c.status === 'jugado' ? c.winner : c.status === 'noPuede' ? (c.noPuede === c.a ? c.b : c.a) : null;
    const f = (id, p, side) => `<div class="fighter ${side} ${w === id ? 'win' : w ? 'lose' : ''}"><div class="p">#${p}</div><div class="n">${esc(nm(id))}${w === id ? ' ✔' : ''}</div></div>`;
    const typeTxt = c.type === 'inverso' ? 'Reto inverso' : c.dist > 5 ? `Reto a ${c.dist} puestos` : 'Reto';
    let acts = '';
    if (mine && c.status === 'pendiente') acts = `<div class="row" style="margin-top:12px"><button class="btn go big" data-act="resultSheet" data-id="${c.id}">📝 Registrar resultado</button><button class="btn danger" data-act="cantSheet" data-id="${c.id}">No puedo jugar</button></div>`;
    else if (mine && c.status === 'jugado' && c.reportedBy === me.id) acts = `<div class="row" style="margin-top:12px"><button class="btn" data-act="resultSheet" data-id="${c.id}">✏️ Corregir resultado</button></div>`;
    const body = `${c.score ? `<div class="score">${esc(c.score)}</div>` : ''}${mine && c.status === 'pendiente' ? steps(c) : ''}${acts}`;
    return `<div class="duel st-${c.status} ${mine ? 'mine' : ''}"><div class="tag"><span>${mine ? '⭐ Tu reto · ' : ''}${typeTxt}</span><span class="pill ${c.status}">${label}</span></div>
      <div class="vsrow">${f(c.a, c.pa, 'l')}<div class="vsb">VS</div>${f(c.b, c.pb, 'r')}</div>
      ${body ? `<div class="body">${body}</div>` : ''}</div>`;
  }

  // --- Ranking
  function vRank() {
    const q = ui.filter.trim().toLowerCase();
    const inChal = {}; S.challenges.filter((c) => c.status !== 'anulado').forEach((c) => { inChal[c.a] = c.b; inChal[c.b] = c.a; });
    const pchd = new Set(S.prevChallenged);
    const badges = (p) => (S.config.challengeDay === 1 && pchd.has(p.id) ? '<span class="badge p" title="Retado el periodo anterior">P</span>' : '') + (p.down ? '<span class="badge">🔽</span>' : '') +
      (p.blocked ? '<span class="badge">⛔ no retable</span>' : '') + (p.rp ? '<span class="badge">🛡️ RP</span>' : '');
    const top = S.players.slice(0, 3);
    const podium = !q && top.length === 3 ? `<div class="podium">${[1, 0, 2].map((i) => { const p = top[i]; return `<div class="pod g${i + 1} ${isMe(p.id) ? 'me' : ''}" data-flip="${p.id}"><div class="medal">${['🥇', '🥈', '🥉'][i]}</div><div class="num">${p.pos}</div><div class="n">${esc(p.name)}</div>${inChal[p.id] ? '<div class="small" style="color:var(--clay)">⚔️ en reto</div>' : ''}</div>`; }).join('')}</div>` : '';
    let rows = '', lastZone = -1;
    S.players.forEach((p) => {
      if (!q && p.pos <= 3) return;
      if (q && !p.name.toLowerCase().includes(q)) return;
      const zone = Math.floor((p.pos - 1) / 16);
      if (!q && zone !== lastZone) { lastZone = zone; rows += `<div class="zone">${zone === 0 ? 'Zona Trofeo Hegemón · 1–16' : `${zone + 1}.ª división · ${zone * 16 + 1}–${zone * 16 + 16}`}</div>`; }
      rows += `<div class="rrow ${isMe(p.id) ? 'me' : ''} ${inChal[p.id] ? 'inchal' : ''}" data-flip="${p.id}"><div class="num">${p.pos}</div>
        <div class="nm">${esc(p.name)}${badges(p)}${inChal[p.id] ? `<small>⚔️ vs ${esc(nm(inChal[p.id]))}</small>` : ''}</div></div>`;
    });
    return `<div class="card" style="padding:12px"><input type="search" id="filter" placeholder="🔎 Buscar jugador…" value="${esc(ui.filter)}" data-input="filter"></div>${podium}${rows || '<div class="empty">Sin resultados</div>'}`;
  }

  // --- Retos
  function vDuels() {
    const cs = S.challenges;
    if (!cs.length) return '<div class="card empty"><h2>Aún no hay retos</h2><p>Cuando los jugadores empiecen a retarse, los verás aquí en directo.</p></div>';
    const order = { pendiente: 0, jugado: 1, noPuede: 2, sinResultado: 3, anulado: 4 };
    const inMine = (c) => me && (c.a === me.id || c.b === me.id);
    const sorted = cs.slice().sort((x, y) => (inMine(y) - inMine(x)) || (order[x.status] - order[y.status]));
    const hint = !me ? '<div class="note" style="margin-bottom:12px">👋 Entra con tu PIN para apuntar el resultado de tu reto. <button class="btn sm go" data-act="who">Entrar</button></div>' : '';
    return `<div class="row between" style="padding:0 4px 10px"><h2 style="font-size:28px">Periodo ${S.period.n} · ${cs.filter((c) => c.status !== 'anulado').length} retos</h2></div>
      ${hint}<div class="grid">${sorted.map((c) => duelCard(c, !!inMine(c))).join('')}</div>`;
  }

  // --- Cuadros
  function vBracket() {
    const source = S.finalRanking || S.players.map((p) => p.id);
    const groups = L.buildGroups(source), isAdm = !!adminPwd;
    const head = `<div class="card"><h2>Cuadros finales · Trofeo Hegemón</h2><p class="muted small">${S.finalRanking ? 'Clasificación final fijada.' : 'Vista previa con el ranking actual. Se fijará al terminar la fase de retos (mayo-junio).'}</p>
      <p class="muted small">1-16, 9-8, 5-12, 13-4, 3-14, 6-11, 7-10, 15-2. ${isAdm ? 'Toca un nombre para marcar al ganador.' : ''}</p></div>`;
    if (!groups.length) return head;
    const names = ['Cuadro de honor · Trofeo Hegemón', '2.ª división', '3.ª división', '4.ª división', '5.ª división'];
    return head + groups.map((g, gi) => {
      const b = L.buildBracket(g, gi, S.bracket || {});
      const cols = b.rounds.map((r, ri) => `<div class="round"><h4>${r.name}</h4>${r.matches.map((m) => {
        const slot = (id) => id ? `<button class="slot ${m.winner === id ? 'win' : ''}" ${m.bye || !isAdm ? 'disabled' : `data-act="bwin" data-key="${m.key}" data-id="${id}"`}><span>${esc(nm(id))}</span>${ri === 0 ? `<span class="seed">#${g.indexOf(id) + 1}</span>` : ''}</button>` : `<div class="slot empty">${m.a || m.b ? 'Descansa' : 'Por decidir'}</div>`;
        return `<div class="match">${slot(m.a)}${slot(m.b)}</div>`;
      }).join('')}</div>`).join('');
      const champ = b.rounds[b.rounds.length - 1].matches[0].winner;
      return `<div class="card"><h2>${names[gi] || (gi + 1) + '.ª división'} ${champ ? `<span class="badge p">🏆 ${esc(nm(champ))}</span>` : ''}</h2><div class="bracket">${cols}</div></div>`;
    }).join('');
  }

  // --- Historial
  function vHist() {
    if (!S.history.length) return '<div class="card empty"><h2>Historial</h2><p>Aquí aparecerán los periodos cerrados con todos los movimientos del ranking.</p></div>';
    return S.history.map((h) => `<div class="card"><h2>Periodo ${h.n} <span class="muted small">${fmtDate(h.start)} – ${fmtDate(h.end)}</span></h2>
      <ul class="log">${h.log.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">Sin movimientos</li>'}</ul></div>`).join('');
  }


  // ---------- avisos push, instalación y PIN ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/android/i.test(navigator.userAgent));
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const pushCapable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let deferredInstall = null, pushInfo = null;
  const isAndroid = /android/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (S) render(); });
  window.addEventListener('appinstalled', () => { store.set('hegemon.installed', 1); deferredInstall = null; if (S) render(); toast('✅ Web instalada en tu pantalla de inicio'); });
  const b64ToU8 = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

  async function pushStatus() {
    if (!pushCapable) return { supported: false, needsInstall: isIOS && !standalone, on: false };
    let on = false;
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg ? await reg.pushManager.getSubscription() : null; on = !!sub && Notification.permission === 'granted'; } catch (e) { /* */ }
    return { supported: true, permission: Notification.permission, on, needsInstall: false };
  }
  async function refreshPush() { const s = await pushStatus(); const ch = JSON.stringify(s) !== JSON.stringify(pushInfo); pushInfo = s; if (ch && S) render(); return s; }
  // mantiene el dispositivo asociado al jugador que ha entrado (si ya dio permiso)
  async function syncPush() {
    if (!me || !pushCapable || Notification.permission !== 'granted' || window.TENIS_DEMO) return;
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await rpc('tenis_push_subscribe', { ...creds(), p_sub: sub.toJSON() }); } catch (e) { /* */ }
  }

  function profileSheet() {
    const ph = (S.me && S.me.phone) || '', ps = pushInfo || { supported: false }, canInstall = !!deferredInstall;
    let avisos;
    if (ps.supported && ps.on) avisos = `<p class="small">✅ Activados en este dispositivo. Te avisaremos cuando te reten, te apunten un resultado o el juez abra los retos.</p><button class="btn" data-act="disablePush">Desactivar avisos</button>`;
    else if (ps.supported && ps.permission === 'denied') avisos = `<div class="note small">Has bloqueado las notificaciones de esta web. Actívalas en los ajustes del navegador (candado junto a la dirección → Notificaciones) y vuelve aquí.</div>`;
    else if (ps.supported) avisos = `<p class="small muted">Recibe un aviso en el móvil aunque la web esté cerrada.</p><button class="btn go" data-act="enablePush">🔔 Activar avisos</button>`;
    else if (ps.needsInstall) avisos = `<div class="note small">En iPhone los avisos solo funcionan con la web instalada. Pulsa <b>Compartir</b> (el cuadrado con la flecha) → <b>Añadir a pantalla de inicio</b>, abre la web desde ese icono y vuelve aquí.</div>`;
    else avisos = `<p class="small muted">Este navegador no permite avisos. Prueba con Chrome o Safari actualizados.</p>`;
    const instalar = canInstall ? `<h3>📲 Instalar como app</h3><button class="btn" data-act="installApp">Añadir a la pantalla de inicio</button>` : (isIOS && !standalone ? `<h3>📲 Instalar como app</h3><p class="small muted">Compartir → Añadir a pantalla de inicio.</p>` : '');
    sheet(`<h2>${esc(nm(me.id))}</h2>
      <label for="myPhone">Tu móvil</label><input id="myPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="612345678" value="${esc(ph)}">
      <p class="muted small" style="margin:6px 0 0">Para que tu rival te escriba por WhatsApp. Solo lo ven el juez y quien tenga un reto contigo.</p>
      <div class="actions" style="margin-top:8px"><button class="btn go" data-act="savePhone">Guardar móvil</button></div>
      <h3>🔔 Avisos en este dispositivo</h3>${avisos}${instalar}
      <h3>🔑 Cambiar mi PIN</h3><div class="row"><div style="flex:1;min-width:120px"><label for="newPin">PIN nuevo (4 cifras)</label><input id="newPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>
        <div style="flex:1;min-width:120px"><label for="newPin2">Repítelo</label><input id="newPin2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div></div>
      <div class="actions" style="margin-top:8px"><button class="btn" data-act="savePin">Cambiar PIN</button></div>
      <div class="actions" style="margin-top:18px;border-top:1px solid var(--line);padding-top:12px"><button class="btn danger" data-act="logout" style="margin-right:auto">Cerrar sesión</button>${cancel}</div>`);
  }


  // ---------- instalar como app (pantalla de inicio) ----------
  const shareSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>';
  const phoneSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2" width="11" height="20" rx="2.5"/><path d="M12 9v6M9 12h6"/></svg>';
  function installButton() {
    if (window.TENIS_DEMO || standalone || store.get('hegemon.installed')) return '';
    if (!(isIOS || isAndroid || deferredInstall)) return '';
    return `<button class="avisos-btn install-btn" data-act="install">${phoneSvg}<span>Instalar como app<small style="display:block">Añádela a tu pantalla de inicio</small></span><em class="bubble">＋</em></button>`;
  }
  function installSheet() {
    let pasos;
    if (isIOS) pasos = `<ol class="steps-list"><li>Abre esta página en <b>Safari</b> (en otros navegadores del iPhone puede no aparecer).</li><li>Pulsa <b>Compartir</b> ${shareSvg} (el cuadrado con la flecha, abajo en el centro).</li><li>Desliza hacia arriba y elige <b>Añadir a pantalla de inicio</b>.</li><li>Pulsa <b>Añadir</b>. Ya tienes el icono de la bola de tenis.</li></ol><div class="note small">Ábrela siempre desde ese icono: así los avisos llegan al móvil aunque la web esté cerrada.</div>`;
    else if (isAndroid) pasos = `<ol class="steps-list"><li>Abre esta página en <b>Chrome</b>.</li><li>Pulsa el menú <b>⋮</b> (los tres puntos, arriba a la derecha).</li><li>Elige <b>Instalar aplicación</b> o <b>Añadir a la pantalla de inicio</b>.</li><li>Confirma con <b>Instalar</b>. Aparecerá el icono de la bola de tenis.</li></ol><div class="note small">Ábrela desde ese icono: así los avisos llegan al móvil aunque la web esté cerrada.</div>`;
    else pasos = `<ol class="steps-list"><li>En Chrome o Edge, busca el icono de <b>instalar</b> al final de la barra de direcciones.</li><li>O abre el menú <b>⋮</b> → <b>Instalar Trofeo Hegemón</b>.</li></ol>`;
    sheet(`<h2>📲 Instalar como app</h2><p class="muted small">Se queda en tu pantalla de inicio como una app más, sin tiendas ni descargas.</p>${pasos}<div class="actions"><button class="btn go" data-act="closeSheet">Entendido</button></div>`);
  }

  // ---------- bandeja de avisos ----------
  const seenKey = () => 'hegemon.notifSeen.' + (me && me.id);
  const seenId = () => Number(store.get(seenKey()) || 0);
  const unread = () => (ui.notifItems ? ui.notifItems.filter((n) => n.id > seenId()).length : (S && S.me && S.me.notifLast > seenId() ? 1 : 0));
  async function fetchNotifs() {
    if (!me || !S || !S.me || S.me.error) return;
    const r = await rpc('tenis_my_notifications', creds()).catch(() => null);
    if (!r || r.error) return;
    ui.notifItems = r.items; ui.notifFetched = S.me.notifLast; render();
  }
  const bellSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>';
  function avisosButton() {
    if (!me || !S.me || S.me.error) return '';
    const n = unread();
    return `<button class="avisos-btn ${n ? 'has-new' : ''}" data-act="avisos" aria-label="Avisos${n ? ', ' + n + ' sin leer' : ''}">${bellSvg}<span>Avisos</span>${n ? `<em class="bubble">${ui.notifItems ? n : '•'}</em>` : '<small>Sin novedades</small>'}</button>`;
  }
  function renderAvisos(items, seen) {
    return `<h2>🔔 Avisos</h2>${items.length ? `<div class="notifs big">${items.map((n) => `<div class="notif ${n.id > seen ? 'new' : ''}"><b>${esc(n.title)}${n.id > seen ? ' <span class="badge p">NUEVO</span>' : ''}</b><span>${esc(n.body)}</span><time>${ago(n.at)}</time></div>`).join('')}</div>` : '<p class="muted">Todavía no tienes avisos. Aquí aparecerán cuando te reten, te apunten un resultado o el juez publique algo.</p>'}
      <div class="actions"><button class="btn" data-act="who">⚙️ Avisos en el móvil</button><button class="btn go" data-act="closeSheet">Cerrar</button></div>`;
  }

  // ---------- hojas ----------
  function sheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false; }
  function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
  const cancel = '<button class="btn" data-act="closeSheet">Cancelar</button>';

  function loginSheet(preId) {
    const opts = S.players.map((p) => `<option value="${p.id}" ${preId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    sheet(`<h2>Entrar</h2><p class="muted">Elige tu nombre y escribe el PIN de 4 cifras que te dio el juez.</p>
      <label for="lgName">Jugador</label><select id="lgName"><option value="">— elige tu nombre —</option>${opts}</select>
      <label for="lgPin">PIN</label><input id="lgPin" type="password" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••">
      <div class="actions">${cancel}<button class="btn go" data-act="login">Entrar</button></div>`);
  }

  async function openPicker() {
    sheet('<h2>¿A quién retas?</h2><div class="skel"></div><div class="skel"></div>');
    let o;
    try { o = await rpc('tenis_options', creds()); } catch (e) { return sheet(`<h2>Sin conexión</h2><div class="actions">${cancel}</div>`); }
    if (o.error) return sheet(`<h2>No puedes retar ahora</h2><div class="note bad">${esc(o.error)}</div><div class="actions">${cancel}</div>`);
    const intro = {
      normal: 'Puedes retar a cualquiera de los 5 jugadores libres por encima de ti.',
      extendido: 'Los 5 de arriba no están disponibles: puedes retar al siguiente libre. Si pierdes, bajarás más puestos.',
      inverso: 'No hay nadie libre por encima: <b>reto inverso</b>. Retas al primero libre por debajo. Si ganas subes 1; si pierdes, intercambias puesto.',
      none: 'Ahora mismo no hay nadie libre al que puedas retar. Vuelve a mirar más tarde o avisa al juez: puede emparejarte a mano.',
    }[o.mode];
    const ok = o.rows.filter((r) => r.ok), no = o.rows.filter((r) => !r.ok);
    sheet(`<h2>¿A quién retas?</h2><div class="note">${intro}</div>
      ${ok.map((r) => `<button class="cand" data-act="confirmChallenge" data-id="${r.id}" data-name="${esc(r.name)}" data-pos="${r.pos}" data-dist="${r.dist}" data-dir="${r.dir}" data-pen="${r.penalty || ''}"><span class="num">${r.pos}</span><span class="nm">${esc(r.name)}<small>${r.dir === 'up' ? `${r.dist} ${r.dist === 1 ? 'puesto' : 'puestos'} por encima${r.dist > 5 ? ` · si pierdes bajas ${r.penalty}` : ''}` : 'por debajo · reto inverso'}</small></span><span>⚔️</span></button>`).join('')}
      ${no.length ? `<h3>No disponibles</h3>${no.map((r) => `<button class="cand" disabled><span class="num">${r.pos}</span><span class="nm">${esc(r.name)}<small>${esc(r.reason || '')}</small></span></button>`).join('')}` : ''}
      <div class="actions">${cancel}</div>`);
  }

  function confirmChallenge(el) {
    const d = el.dataset, mp = P()[me.id];
    sheet(`<h2>Confirma tu reto</h2>
      <div class="vsrow" style="margin:18px 0"><div class="fighter l"><div class="p">#${mp.pos}</div><div class="n">${esc(mp.name)}</div></div><div class="vsb">VS</div><div class="fighter r"><div class="p">#${d.pos}</div><div class="n">${esc(d.name)}</div></div></div>
      <ul class="log small muted"><li>Si ganas ${d.dir === 'up' ? 'ocupas su puesto' : 'subes 1 puesto'}.</li><li>Si pierdes ${d.dir === 'up' ? `bajas ${d.pen || 2} puestos` : 'intercambiáis puestos'}.</li><li>Tras retar debes avisar al grupo y por privado a ${esc(firstName(d.name))}.</li></ul>
      <div class="actions">${cancel}<button class="btn hot big" data-act="doChallenge" data-id="${d.id}">¡Lanzar reto!</button></div>`);
  }

  async function doChallenge(el) {
    el.disabled = true; el.textContent = 'Lanzando…';
    const r = await rpc('tenis_challenge', { ...creds(), p_target: el.dataset.id }).catch(() => ({ error: 'Sin conexión' }));
    if (r.error) { sheet(`<h2>Vaya…</h2><div class="note bad">${esc(r.error)}</div><div class="actions"><button class="btn go" data-act="picker">Elegir otro</button></div>`); return; }
    closeSheet(); await refresh(true);
    const c = S.challenges.find((x) => x.id === r.challenge);
    if (c) duelOverlay({ name: nm(c.a), pos: c.pa }, { name: nm(c.b), pos: c.pb }, 'launch');
    ui.tab = 'home'; render();
  }

  function resultSheet(id) {
    const c = S.challenges.find((x) => x.id === id);
    sheet(`<h2>Resultado del reto</h2><p class="muted small">¿Quién ha ganado? Recuerda que antes de jugar debéis hacer la foto en pista y subirla al grupo.</p>
      <label class="chk"><input type="radio" name="w" value="${c.a}" checked> Ha ganado <b>${esc(nm(c.a))}</b></label>
      <label class="chk"><input type="radio" name="w" value="${c.b}"> Ha ganado <b>${esc(nm(c.b))}</b></label>
      <label for="score">Marcador (opcional)</label><input id="score" type="text" placeholder="6-4 3-6 10-7" maxlength="40">
      <div class="actions">${cancel}<button class="btn go big" data-act="report" data-id="${id}">Guardar resultado</button></div>`);
  }
  async function report(el) {
    const w = document.querySelector('input[name=w]:checked').value, score = $('#score').value;
    const r = await rpc('tenis_report', { ...creds(), p_challenge: el.dataset.id, p_winner: w, p_score: score }).catch(() => ({ error: 'Sin conexión' }));
    if (r.error) return toast(esc(r.error), 'err');
    closeSheet(); await refresh(true);
    const c = S.challenges.find((x) => x.id === el.dataset.id), loser = w === c.a ? c.b : c.a;
    resultOverlay(w === me.id, nm(w), nm(loser), score);
  }
  function cantSheet(id) {
    sheet(`<h2>¿No puedes jugar?</h2><div class="note bad">Perderás el reto y bajarás 3 puestos (5 si ya te ocurrió por una causa no grave). Si es algo importante, avisa también al juez.</div>
      <div class="actions">${cancel}<button class="btn danger" data-act="cant" data-id="${id}">Sí, no puedo jugar</button></div>`);
  }

  // ---------- panel del juez ----------
  const aPlayers = () => (A ? A.players : []);
  const aNm = (id) => { const p = aPlayers().find((x) => x.id === id); return p ? p.name : '¿?'; };
  const curPeriod = () => A.periods[A.periods.length - 1];

  function toLogicState() {
    const players = {};
    A.players.forEach((p) => { players[p.id] = { id: p.id, name: p.name, phone: p.phone || '', blocked: p.blocked, blockedCount: p.blocked_count, rp: p.rp, rpRounds: p.rp_rounds, rpUsed: p.rp_used, down: p.down, sinPref: p.sin_pref, leveWithdrawals: p.leve_withdrawals }; });
    return {
      settings: { periodDays: A.config.periodDays }, players, ranking: A.players.map((p) => p.id), history: [],
      periods: A.periods.map((p) => ({ n: p.n, start: p.start, end: p.end, closed: p.closed, rankingStart: p.rankingStart, rankingEnd: p.rankingEnd, log: p.log,
        challenges: p.challenges.map((c) => ({ id: c.id, type: c.type, challengerId: c.challenger_id, challengedId: c.challenged_id, posChallenger: c.pos_challenger, posChallenged: c.pos_challenged, dist: c.dist, status: c.status, winnerId: c.winner_id, score: c.score, noPuedeId: c.no_puede_id, grave: c.grave })) })),
    };
  }

  function vAdmin() {
    if (!A) return '<div class="skel"></div>'.repeat(3);
    const tabs = [['control', 'Control'], ['players', 'Jugadores'], ['chal', 'Retos'], ['cfg', 'Ajustes']];
    const body = { control: admControl, players: admPlayers, chal: admChal, cfg: admCfg }[ui.admTab]();
    return `<div class="seg" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="btn" data-act="admTab" data-v="${k}" aria-pressed="${ui.admTab === k}">${l}</button>`).join('')}</div>${body}`;
  }

  function admControl() {
    const cp = curPeriod(), day = A.config.challengeDay;
    const chs = cp.challenges.filter((c) => c.status !== 'anulado'), pend = chs.filter((c) => c.status === 'pendiente').length;
    const noMsg = chs.filter((c) => !c.msg_group || !c.msg_private);
    return `<div class="card"><h2>Ventana de retos</h2><p class="muted small">Decide quién puede retar ahora. Los jugadores lo ven al instante.</p>
        <div class="seg">${[[0, '🔒 Cerrados'], [1, 'Día 1'], [2, 'Día 2'], [3, 'Día 3 · todos']].map(([d, l]) => `<button class="btn" data-act="setDay" data-v="${d}" aria-pressed="${day === d}">${l}</button>`).join('')}</div>
        <p class="small muted" style="margin-top:8px">Día 1: solo retan quienes no retaron el periodo anterior (los retados llevan P). Día 2: también quienes retaron y ganaron. Día 3: todos.</p></div>
      <div class="card"><h2>Periodo ${cp.n}</h2><p>${fmtDate(cp.start)} – ${fmtDate(cp.end)} · <b>${chs.length}</b> retos · <b>${pend}</b> pendientes</p>
        ${noMsg.length ? `<div class="note small">⚠️ Sin los dos mensajes (g): ${noMsg.map((c) => esc(aNm(c.challenger_id))).join(', ')}</div>` : ''}
        <div class="row"><button class="btn" data-act="datesSheet">Cambiar fechas</button><button class="btn hot" data-act="closePreview">Cerrar periodo y actualizar ranking…</button><button class="btn" data-act="undo" ${A.snapshots ? '' : 'disabled'}>Deshacer último cierre</button></div></div>
      ${(() => { const inC = new Set(); chs.forEach((c) => { inC.add(c.challenger_id); inC.add(c.challenged_id); }); const free = A.players.filter((p) => !p.blocked && !p.rp && !inC.has(p.id));
        return `<div class="card"><h2>Sin reto este periodo (${free.length})</h2><p class="muted small">Jugadores disponibles que aún no están en ningún reto. Si se quedan sin rival, puedes emparejarlos a mano en Retos → Reto manual.</p>
        <div class="chips">${free.map((p) => `<span class="chip ok">${p.pos}. ${esc(p.name)}</span>`).join('') || '<span class="muted small">Todos tienen reto</span>'}</div></div>`; })()}
      <div class="card"><h2>Aviso a todos</h2><textarea id="notice" rows="2" maxlength="280" placeholder="Ej.: Esta semana llueve: se amplía el plazo hasta el miércoles"></textarea><div class="actions"><button class="btn go" data-act="notice">Publicar aviso</button></div></div>
      <div class="card"><h2>Copiar para WhatsApp</h2><div class="row"><button class="btn" data-act="copyRank">Ranking</button><button class="btn" data-act="copyChals">Lista de retos</button></div></div>`;
  }

  function admPlayers() {
    const n = A.players.length;
    const rows = A.players.map((p, i) => `<tr class="arow"><td class="apos">${p.pos}</td>
      <td><b>${esc(p.name)}</b>${p.blocked ? ' <span class="badge">⛔ no retable</span>' : ''}${p.rp ? ' <span class="badge">🛡️ RP</span>' : ''}${p.down ? ' <span class="badge">🔽</span>' : ''}${p.sin_pref ? ' <span class="badge">sin pref.</span>' : ''}<div class="small muted">${esc(p.phone || 'sin teléfono')}</div></td>
      <td class="pin">${esc(p.pin)}</td>
      <td class="aacts"><button class="btn sm" data-act="mvPlayer" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button><button class="btn sm" data-act="mvPlayer" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
        <button class="btn sm go" data-act="editPlayer" data-id="${p.id}">Editar</button><button class="btn sm" data-act="copyAccess" data-id="${p.id}">📲 Acceso</button></td></tr>`).join('');
    return `<div class="card"><div class="row between"><h2>Jugadores (${n})</h2><div class="row"><button class="btn go" data-act="addPlayer">+ Añadir</button><button class="btn" data-act="copyAllPins">Copiar PINs</button></div></div>
      <p class="muted small">▲▼ mueven al jugador en el ranking. “Acceso” copia un mensaje con su PIN y su enlace personal para su WhatsApp.</p>
      <div style="overflow:auto"><table class="atable"><thead><tr><th>#</th><th>Jugador</th><th>PIN</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function admChal() {
    const cp = curPeriod(), opts = A.players.map((p) => `<option value="${p.id}">${p.pos}. ${esc(p.name)}</option>`).join('');
    const label = { pendiente: 'Por jugar', jugado: 'Jugado', sinResultado: 'Sin resultado', noPuede: 'No puede', anulado: 'Anulado' };
    const items = cp.challenges.map((c) => {
      const w = L.effectiveWinner({ status: c.status, winnerId: c.winner_id, noPuedeId: c.no_puede_id, challengerId: c.challenger_id, challengedId: c.challenged_id });
      const f = (id, p, side) => `<div class="fighter ${side} ${w === id ? 'win' : w ? 'lose' : ''}"><div class="p">#${p}</div><div class="n">${esc(aNm(id))}${w === id ? ' ✔' : ''}</div></div>`;
      return `<div class="duel st-${c.status}"><div class="tag"><span>${c.type === 'inverso' ? 'Inverso' : 'Reto'}${c.dist > 5 ? ' · ' + c.dist + ' puestos' : ''}${c.forced ? ' · manual' : ''}</span><span class="pill ${c.status}">${label[c.status]}</span></div>
        <div class="vsrow">${f(c.challenger_id, c.pos_challenger, 'l')}<div class="vsb">VS</div>${f(c.challenged_id, c.pos_challenged, 'r')}</div>
        <div class="body">${c.score ? `<div class="score">${esc(c.score)}</div>` : ''}
          <div class="chips"><span class="chip ${c.msg_group ? 'ok' : 'ko'}">${c.msg_group ? '✓' : '✗'} Grupo</span><span class="chip ${c.msg_private ? 'ok' : 'ko'}">${c.msg_private ? '✓' : '✗'} Privado</span></div>
          <div class="row" style="margin-top:10px"><button class="btn sm go" data-act="aEdit" data-id="${c.id}">✏️ Editar todo</button><button class="btn sm" data-act="aResult" data-id="${c.id}">Resultado</button><button class="btn sm" data-act="aCant" data-id="${c.id}">No puede</button>
          <button class="btn sm" data-act="aSet" data-id="${c.id}" data-st="sinResultado">Sin resultado</button><button class="btn sm" data-act="aSet" data-id="${c.id}" data-st="pendiente">Reabrir</button>
          <button class="btn sm danger" data-act="aSet" data-id="${c.id}" data-st="anulado" title="No envió el privado">Anular + penalizar</button><button class="btn sm danger" data-act="aDel" data-id="${c.id}">Borrar</button></div></div></div>`;
    }).join('');
    return `<div class="card"><h2>Reto manual</h2><p class="muted small">Salta las normas (decisión del juez).</p>
      <div class="row"><select id="mA" style="flex:1" aria-label="Retador">${opts}</select><span>→</span><select id="mB" style="flex:1" aria-label="Retado">${opts}</select><button class="btn go" data-act="aCreate">Crear</button></div></div>
      <div class="grid">${items || '<div class="card empty">Sin retos</div>'}</div>`;
  }

  function admCfg() {
    const c = A.config;
    return `<div class="card"><h2>Torneo</h2><label>Nombre</label><input id="cTitle" value="${esc(c.title)}"><label>Temporada</label><input id="cSeason" value="${esc(c.season)}">
      <label>Juez árbitro</label><input id="cRef" value="${esc(c.referee)}"><label>Días por periodo</label><input id="cDays" type="number" min="7" max="30" value="${c.periodDays}">
      <div class="actions"><button class="btn go" data-act="saveCfg">Guardar</button></div></div>
      <div class="card"><h2>Cuadros finales</h2><p class="muted small">Fija la clasificación al terminar la fase de retos. Después marca los ganadores en la pestaña Cuadros.</p>
        <div class="row"><button class="btn go" data-act="freeze" data-on="1">Fijar clasificación final</button><button class="btn danger" data-act="freeze" data-on="0">Liberar</button></div></div>
      <div class="card"><h2>Clave del juez</h2><label for="curPwd">Clave con la que has entrado</label><div class="pwrow"><input id="curPwd" type="password" readonly value="${esc(adminPwd)}"><button class="btn" type="button" data-act="togglePwd" data-target="curPwd" aria-controls="curPwd">Ver</button></div>
        <label for="newPwd" style="margin-top:16px">Nueva clave (mínimo 8 caracteres)</label><input id="newPwd" type="text" autocomplete="off">
        <div class="actions"><button class="btn go" data-act="changePwd">Cambiar</button><button class="btn" data-act="adminOut">Salir del modo juez</button></div></div>`;
  }

  async function adm(op, args, okMsg) {
    const r = await admin(op, args).catch(() => ({ error: 'Sin conexión' }));
    if (r.error) { toast(esc(r.error), 'err'); return null; }
    if (okMsg) toast(okMsg);
    await refresh(true); return r;
  }

  function nextMonday(iso) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  function addDaysIso(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function closePreview() {
    const st = toLogicState(), pv = L.previewClose(st), pending = curPeriod().challenges.filter((c) => c.status === 'pendiente').length;
    const rows = pv.after.map((id, i) => { const d = pv.before.indexOf(id) - i; return `<tr><td><b>${i + 1}</b></td><td>${esc(aNm(id))}</td><td>${d > 0 ? `<span class="delta u">▲ ${d}</span>` : d < 0 ? `<span class="delta d">▼ ${-d}</span>` : '<span class="muted">=</span>'}</td></tr>`; }).join('');
    sheet(`<h2>Cerrar periodo ${curPeriod().n}</h2>${pending ? `<div class="note">⚠️ ${pending} reto(s) sin resultado: ambos jugadores bajarán 3 puestos.</div>` : ''}
      <h3>Movimientos</h3><ul class="log small">${pv.log.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">Ninguno</li>'}</ul>
      <h3>Nuevo ranking</h3><div style="max-height:240px;overflow:auto"><table><tbody>${rows}</tbody></table></div>
      <h3>Fechas del periodo ${curPeriod().n + 1}</h3><p class="muted small">Sugerido: empieza el lunes siguiente. Puedes cambiarlo.</p>
      <div class="row"><div style="flex:1"><label>Primer día</label><input type="date" id="nxS" value="${nextMonday(curPeriod().end)}"></div><div style="flex:1"><label>Último día (19:00)</label><input type="date" id="nxE" value="${addDaysIso(nextMonday(curPeriod().end), A.config.periodDays - 1)}"></div></div>
      <div class="actions">${cancel}<button class="btn hot" data-act="doClose">Cerrar y abrir periodo ${curPeriod().n + 1}</button></div>`);
  }
  async function doClose() {
    const st = toLogicState(), pv = L.previewClose(st);
    const moves = pv.after.map((id, i) => ({ id, name: aNm(id), from: pv.before.indexOf(id) + 1, to: i + 1 })).filter((m) => m.from !== m.to).sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to)).slice(0, 12);
    const players = pv.after.map((id) => { const p = pv.players[id]; return { id, down: p.down, blocked_count: p.blockedCount, rp_rounds: p.rpRounds, leve_withdrawals: p.leveWithdrawals }; });
    const ns = $('#nxS').value, ne = $('#nxE').value;
    if (!ns || !ne || ne < ns) return toast('Revisa las fechas del nuevo periodo', 'err');
    closeSheet();
    if (await adm('close', { ranking: pv.after, players, log: pv.log, moves, next_start: ns, next_end: ne }, 'Periodo cerrado. Ranking actualizado.')) burst({ n: 160 });
  }

  function playerSheet(id) {
    const p = id ? A.players.find((x) => x.id === id) : { name: '', phone: '', pos: A.players.length + 1, blocked: false, rp: false, down: false, sin_pref: false, rp_rounds: 0, rp_used: false };
    sheet(`<h2>${id ? esc(p.name) : 'Nuevo jugador'}</h2>
      <label>Nombre</label><input id="pName" value="${esc(p.name)}"><label>Teléfono (para el WhatsApp privado del reto)</label><input id="pPhone" value="${esc(p.phone || '')}" inputmode="tel" placeholder="6XXXXXXXX">
      <label>Posición</label><input id="pPos" type="number" min="1" max="${A.players.length + 1}" value="${p.pos}">
      ${id ? `<label>PIN</label><input id="pPin" class="pin" maxlength="4" inputmode="numeric" value="${esc(p.pin)}">
      <div class="row"><div style="flex:1"><label>Rondas bloqueado</label><input id="pBc" type="number" min="0" value="${p.blocked_count}"></div><div style="flex:1"><label>Rondas en RP</label><input id="pRr" type="number" min="0" value="${p.rp_rounds}"></div><div style="flex:1"><label>Renuncias no graves</label><input id="pLw" type="number" min="0" value="${p.leve_withdrawals}"></div></div>
      <label class="chk"><input type="checkbox" id="pDown" ${p.down ? 'checked' : ''}> 🔽 Sancionado</label><label class="chk"><input type="checkbox" id="pRpUsed" ${p.rp_used ? 'checked' : ''}> Ya usó su Ranking Protegido</label><label class="chk"><input type="checkbox" id="pSin" ${p.sin_pref ? 'checked' : ''}> Vuelve sin preferencia</label>
      <h3>Estado</h3><div class="row">
        ${p.blocked ? '<button class="btn" data-act="pState" data-id="' + id + '" data-op="unblock">Quitar “no retable”</button>' : `<button class="btn" data-act="pState" data-id="${id}" data-op="block" ${p.rp ? 'disabled' : ''}>Marcar no retable</button>`}
        ${p.rp ? `<button class="btn" data-act="pState" data-id="${id}" data-op="endrp" ${p.rp_rounds < 3 ? 'disabled' : ''}>Reactivar de RP (${p.rp_rounds} rondas)</button>` : `<button class="btn" data-act="pState" data-id="${id}" data-op="startrp" ${p.rp_used || p.blocked ? 'disabled' : ''}>Ranking protegido${p.rp_used ? ' (ya usado)' : ''}</button>`}
        <button class="btn" data-act="pState" data-id="${id}" data-op="pin">Nuevo PIN</button></div>` : ''}
      <div class="actions">${id ? `<button class="btn danger" data-act="delPlayer" data-id="${id}" style="margin-right:auto">Eliminar</button>` : ''}${cancel}<button class="btn go" data-act="savePlayer" data-id="${id || ''}">Guardar</button></div>`);
  }

  // ---------- acciones ----------
  const link = (id) => `${location.origin}${location.pathname}#j=${id}`;
  function copy(text, msg) {
    const ok = () => toast(msg);
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, () => toast('No se pudo copiar', 'err')); else toast('No se pudo copiar', 'err');
  }

  const actions = {
    tab(el) { ui.tab = el.dataset.v; closeOverlay(); render(); scrollTo(0, 0); },
    admTab(el) { ui.admTab = el.dataset.v; render(); },
    closeSheet, closeOv: closeOverlay,
    retry() { refresh(true); },
    async who() {
      if (window.TENIS_DEMO) return toast('Vista previa de solo lectura: la entrada con PIN está desactivada.');
      if (!me) return loginSheet();
      await refreshPush(); profileSheet();
    },
    async install() {
      if (deferredInstall) {
        deferredInstall.prompt();
        try { const r = await deferredInstall.userChoice; if (r && r.outcome === 'accepted') store.set('hegemon.installed', 1); } catch (e) { /* */ }
        deferredInstall = null; render(); return;
      }
      installSheet();
    },
    async avisos() {
      const seen = seenId(); sheet('<h2>🔔 Avisos</h2><div class="skel"></div><div class="skel"></div>');
      const r = await rpc('tenis_my_notifications', creds()).catch(() => null);
      if (!r || r.error) return sheet(`<h2>🔔 Avisos</h2><div class="note bad">No se pudieron cargar los avisos.</div><div class="actions">${cancel}</div>`);
      ui.notifItems = r.items; ui.notifFetched = S.me && S.me.notifLast;
      sheet(renderAvisos(r.items, seen));
      const last = r.items.length ? r.items[0].id : 0; store.set(seenKey(), Math.max(seen, last)); render();
    },
    async enablePush() {
      if (!pushCapable) return toast('Este dispositivo no admite avisos', 'err');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await refreshPush(); return toast('No has dado permiso para avisar. Puedes activarlo en los ajustes del navegador.', 'err'); }
      try {
        const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.vapidPublic) });
        const r = await rpc('tenis_push_subscribe', { ...creds(), p_sub: sub.toJSON() });
        if (r.error) return toast(esc(r.error), 'err');
      } catch (e) { return toast('No se pudieron activar los avisos en este dispositivo', 'err'); }
      await refreshPush(); profileSheet(); toast('🔔 Avisos activados'); burst({ n: 50 });
    },
    async disablePush() {
      try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) { await rpc('tenis_push_unsubscribe', { ...creds(), p_endpoint: sub.endpoint }); await sub.unsubscribe(); } } catch (e) { /* */ }
      await refreshPush(); profileSheet(); toast('Avisos desactivados');
    },
    async installApp() { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) { /* */ } deferredInstall = null; profileSheet(); },
    async savePin() {
      const a = $('#newPin').value.trim(), b = $('#newPin2').value.trim();
      if (!/^\d{4}$/.test(a)) return toast('El PIN nuevo debe tener 4 cifras', 'err');
      if (a !== b) return toast('Los dos PIN no coinciden', 'err');
      const r = await rpc('tenis_set_pin', { ...creds(), p_new: a }).catch(() => ({ error: 'Sin conexión' }));
      if (r.error) return toast(esc(r.error), 'err');
      me = { id: me.id, pin: a }; saveSession(me); closeSheet(); toast('✅ PIN cambiado. Úsalo la próxima vez que entres.');
    },
    dismissPush() { store.set('hegemon.pushHint', 1); render(); },
    async savePhone() {
      const v = $('#myPhone').value, r = await rpc('tenis_set_phone', { ...creds(), p_phone: v }).catch(() => ({ error: 'Sin conexión' }));
      if (r.error) return toast(esc(r.error), 'err');
      closeSheet(); await refresh(true); toast(r.phone ? 'Teléfono guardado' : 'Teléfono borrado'); if (r.phone) burst({ n: 40 });
    },
    async logout() {
      try { if (pushCapable) { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await rpc('tenis_push_unsubscribe', { ...creds(), p_endpoint: sub.endpoint }); } } catch (e) { /* */ }
      me = null; clearSession(); closeSheet(); refresh(true);
    },
    async login() {
      const id = $('#lgName').value, pin = $('#lgPin').value.trim();
      if (!id || pin.length !== 4) return toast('Elige tu nombre y escribe tu PIN de 4 cifras', 'err');
      const r = await rpc('tenis_login', { p_id: id, p_pin: pin }).catch(() => ({ error: 'Sin conexión' }));
      if (r.error) return toast(esc(r.error), 'err');
      me = { id, pin }; saveSession(me); closeSheet(); await refresh(true); ui.tab = 'home'; render();
      toast(`¡Bienvenido, ${esc(firstName(nm(id)))}!`); burst({ n: 70 });
    },
    picker: openPicker, confirmChallenge, doChallenge, resultSheet(el) { resultSheet(el.dataset.id); }, report,
    cantSheet(el) { cantSheet(el.dataset.id); },
    async cant(el) {
      const r = await rpc('tenis_cant_play', { ...creds(), p_challenge: el.dataset.id }).catch(() => ({ error: 'Sin conexión' }));
      if (r.error) return toast(esc(r.error), 'err'); closeSheet(); refresh(true);
    },
    sent(el) { rpc('tenis_mark_sent', { ...creds(), p_challenge: el.dataset.id, p_kind: el.dataset.kind }).then(() => setTimeout(() => refresh(true), 800)); },
    bwin(el) { const k = el.dataset.key, cur = S.bracket && S.bracket[k]; adm('bracket_set', { key: k, winner: cur === el.dataset.id ? null : el.dataset.id }); },
    // juez
    adminEntry() {
      if (adminPwd) { ui.tab = 'adm'; render(); return; }
      sheet(`<h2>Zona del juez</h2><label for="aPwd">Clave de administración</label><div class="pwrow"><input id="aPwd" type="password" autocomplete="current-password"><button class="btn" type="button" data-act="togglePwd" data-target="aPwd" aria-controls="aPwd">Ver</button></div><div class="actions">${cancel}<button class="btn go" data-act="adminLogin">Entrar</button></div>`);
    },
    async adminLogin() {
      const pwd = $('#aPwd').value, r = await rpc('tenis_admin', { p_pwd: pwd, p_op: 'login', p_args: {} }).catch(() => ({ error: 'Sin conexión' }));
      if (r.error) return toast(esc(r.error), 'err');
      adminPwd = pwd; try { sessionStorage.setItem('hegemon.admin', pwd); } catch (e) { /* */ }
      closeSheet(); ui.tab = 'adm'; await refresh(true); render();
    },
    togglePwd(el) {
      const inp = document.getElementById(el.dataset.target); if (!inp) return;
      const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; el.textContent = show ? 'Ocultar' : 'Ver';
      el.setAttribute('aria-pressed', String(show));
    },
    adminOut() { adminPwd = null; A = null; try { sessionStorage.removeItem('hegemon.admin'); } catch (e) { /* */ } ui.tab = 'home'; render(); },
    setDay(el) { adm('config', { challengeDay: Number(el.dataset.v) }, Number(el.dataset.v) ? 'Retos abiertos' : 'Retos cerrados'); },
    notice() { const t = $('#notice').value.trim(); if (t) adm('notice', { text: t }, 'Aviso publicado').then(() => { $('#notice') && ($('#notice').value = ''); }); },
    closePreview, doClose,
    undo() { if (confirm('¿Deshacer el último cierre de periodo?')) adm('undo', {}, 'Cierre deshecho'); },
    datesSheet() { const cp = curPeriod(); sheet(`<h2>Fechas del periodo ${cp.n}</h2><label>Inicio</label><input type="date" id="dS" value="${cp.start}"><label>Último día (resultados hasta las 19:00)</label><input type="date" id="dE" value="${cp.end}"><div class="actions">${cancel}<button class="btn go" data-act="saveDates">Guardar</button></div>`); },
    saveDates() { const s = $('#dS').value, e = $('#dE').value; if (!s || !e || e < s) return toast('Fechas no válidas', 'err'); closeSheet(); adm('period_dates', { start: s, end: e }, 'Fechas guardadas'); },
    copyRank() {
      // Movimiento respecto al ranking con el que empezó el último periodo cerrado (sin iconos)
      const closed = A.periods.filter((p) => p.closed), last = closed[closed.length - 1];
      const ref = last && last.rankingStart && last.rankingStart.length ? last.rankingStart : null;
      const rows = A.players.map((p) => {
        let mv = '';
        if (ref) { const old = ref.indexOf(p.id) + 1; mv = !old ? ' (nuevo)' : old === p.pos ? ' (=)' : old > p.pos ? ` (+${old - p.pos})` : ` (-${p.pos - old})`; }
        return `${p.pos}. ${p.name}${mv}`;
      });
      const head = `*${A.config.title.toUpperCase()}* - Ranking`, sub = last ? `Tras el periodo ${last.n}. Entre paréntesis, los puestos que ha subido (+) o bajado (-) cada jugador.` : `Periodo ${curPeriod().n}`;
      copy(`${head}\n${sub}\n\n${rows.join('\n')}`, 'Ranking copiado');
    },
    copyChals() { const cp = curPeriod(); copy(`⚔️ *Retos del periodo ${cp.n}* (hasta ${fmtDate(cp.end)}, 19:00)\n\n` + cp.challenges.filter((c) => c.status !== 'anulado').map((c) => `${c.pos_challenger}. ${aNm(c.challenger_id)} → ${c.pos_challenged}. ${aNm(c.challenged_id)}`).join('\n'), 'Lista copiada'); },
    editPlayer(el) { playerSheet(el.dataset.id); }, addPlayer() { playerSheet(null); },
    async savePlayer(el) {
      const id = el.dataset.id, args = { name: $('#pName').value, phone: $('#pPhone').value, pos: $('#pPos').value };
      if (!args.name.trim()) return toast('Falta el nombre', 'err');
      if (id) { args.id = id; args.down = $('#pDown').checked; args.sin_pref = $('#pSin').checked; args.rp_used = $('#pRpUsed').checked; args.blocked_count = Number($('#pBc').value) || 0; args.rp_rounds = Number($('#pRr').value) || 0; args.leve_withdrawals = Number($('#pLw').value) || 0; const pin = $('#pPin').value.trim(); if (/^\d{4}$/.test(pin)) args.pin = pin; else if (pin) return toast('El PIN debe tener 4 cifras', 'err'); }
      closeSheet(); const r = await adm('player_save', args, 'Guardado');
      if (r && !id) toast('Jugador creado. PIN en Jugadores → “Enviar acceso”');
    },
    delPlayer(el) { if (confirm('¿Eliminar a este jugador del torneo? Se borran sus retos de este periodo.')) { closeSheet(); adm('player_delete', { id: el.dataset.id }, 'Eliminado'); } },
    async pState(el) {
      const id = el.dataset.id, p = A.players.find((x) => x.id === id), op = el.dataset.op;
      if (op === 'block') await adm('player_save', { id, blocked: true, blocked_count: 0 });
      else if (op === 'unblock') await adm('player_save', { id, blocked: false, blocked_count: 0, sin_pref: true });
      else if (op === 'startrp') await adm('player_save', { id, rp: true, rp_rounds: 0 });
      else if (op === 'endrp') await adm('player_save', { id, rp: false, rp_used: true, sin_pref: true, pos: p.rp_rounds > 6 ? Math.min(A.players.length, p.pos + 10) : p.pos });
      else if (op === 'pin') { const r = await adm('pin_reset', { id }); if (r) { toast(`Nuevo PIN de ${esc(p.name)}: <b class="pin">${r.pin}</b>`); } }
      closeSheet();
    },
    copyAccess(el) {
      const p = A.players.find((x) => x.id === el.dataset.id);
      copy(`Hola ${firstName(p.name)} 🎾 Ya puedes retar desde la web del Trofeo Hegemón.\nTu enlace: ${link(p.id)}\nTu PIN: ${p.pin}\n(Es personal, no lo compartas)`, 'Mensaje copiado: pégalo en su WhatsApp');
    },
    copyAllPins() { copy(A.players.map((p) => `${p.pos};${p.name};${p.pin};${link(p.id)}`).join('\n'), 'PINs y enlaces copiados'); },
    mvPlayer(el) {
      const i = Number(el.dataset.i), j = i + Number(el.dataset.d), ids = A.players.map((p) => p.id);
      if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; adm('order', { ids });
    },
    aEdit(el) {
      const c = curPeriod().challenges.find((x) => x.id === el.dataset.id);
      const opts = (sel) => A.players.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p.pos}. ${esc(p.name)}</option>`).join('');
      const who = (sel) => `<option value="" ${!sel ? 'selected' : ''}>— nadie —</option><option value="a" ${sel === c.challenger_id ? 'selected' : ''}>Retador</option><option value="b" ${sel === c.challenged_id ? 'selected' : ''}>Retado</option>`;
      sheet(`<h2>Editar reto</h2>
        <label>Retador</label><select id="eA">${opts(c.challenger_id)}</select><label>Retado</label><select id="eB">${opts(c.challenged_id)}</select>
        <label>Tipo</label><select id="eType"><option value="normal" ${c.type === 'normal' ? 'selected' : ''}>Reto normal</option><option value="inverso" ${c.type === 'inverso' ? 'selected' : ''}>Reto inverso</option></select>
        <label>Estado</label><select id="eSt">${[['pendiente', 'Por jugar'], ['jugado', 'Jugado'], ['sinResultado', 'Sin resultado'], ['noPuede', 'No puede jugar'], ['anulado', 'Anulado']].map(([k, l]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Ganador</label><select id="eW">${who(c.winner_id)}</select><label>Marcador</label><input id="eScore" value="${esc(c.score || '')}">
        <label>No puede jugar</label><select id="eNp">${who(c.no_puede_id)}</select><label class="chk"><input type="checkbox" id="eGrave" ${c.grave ? 'checked' : ''}> Causa grave</label>
        <label class="chk"><input type="checkbox" id="eMg" ${c.msg_group ? 'checked' : ''}> Mensaje al grupo enviado</label><label class="chk"><input type="checkbox" id="eMp" ${c.msg_private ? 'checked' : ''}> Mensaje privado enviado</label>
        <div class="actions">${cancel}<button class="btn go big" data-act="aSaveEdit" data-id="${c.id}">Guardar</button></div>`);
    },
    aSaveEdit(el) {
      const a = $('#eA').value, b = $('#eB').value; if (a === b) return toast('Retador y retado no pueden ser el mismo', 'err');
      const pa = A.players.find((p) => p.id === a).pos, pb = A.players.find((p) => p.id === b).pos, pick = (v) => (v === 'a' ? a : v === 'b' ? b : '');
      const args = { id: el.dataset.id, challenger: a, challenged: b, type: $('#eType').value, pa, pb, dist: Math.abs(pa - pb), status: $('#eSt').value, winner: pick($('#eW').value), noPuede: pick($('#eNp').value), score: $('#eScore').value, grave: $('#eGrave').checked, msgGroup: $('#eMg').checked, msgPrivate: $('#eMp').checked };
      closeSheet(); adm('challenge_edit', args, 'Reto actualizado');
    },
    aResult(el) {
      const c = curPeriod().challenges.find((x) => x.id === el.dataset.id);
      sheet(`<h2>Resultado</h2><label class="chk"><input type="radio" name="w" value="${c.challenger_id}" checked> Gana ${esc(aNm(c.challenger_id))}</label><label class="chk"><input type="radio" name="w" value="${c.challenged_id}"> Gana ${esc(aNm(c.challenged_id))}</label>
        <label>Marcador</label><input id="aScore" value="${esc(c.score || '')}"><div class="actions">${cancel}<button class="btn go" data-act="aSaveResult" data-id="${c.id}">Guardar</button></div>`);
    },
    aSaveResult(el) { const w = document.querySelector('input[name=w]:checked').value, args = { id: el.dataset.id, status: 'jugado', winner: w, score: $('#aScore').value }; closeSheet(); adm('challenge_set', args, 'Resultado guardado'); },
    aCant(el) {
      const c = curPeriod().challenges.find((x) => x.id === el.dataset.id);
      sheet(`<h2>No puede disputar el reto</h2><label class="chk"><input type="radio" name="w" value="${c.challenger_id}" checked> ${esc(aNm(c.challenger_id))}</label><label class="chk"><input type="radio" name="w" value="${c.challenged_id}"> ${esc(aNm(c.challenged_id))}</label>
        <label class="chk"><input type="checkbox" id="aGrave" checked> Causa grave/importante</label><div class="actions">${cancel}<button class="btn go" data-act="aSaveCant" data-id="${c.id}">Guardar</button></div>`);
    },
    aSaveCant(el) { const w = document.querySelector('input[name=w]:checked').value, args = { id: el.dataset.id, status: 'noPuede', noPuede: w, grave: $('#aGrave').checked }; closeSheet(); adm('challenge_set', args, 'Guardado'); },
    aSet(el) {
      const st = el.dataset.st;
      if (st === 'anulado' && !confirm('El retador no envió el privado: se penaliza con 2 puestos y 🔽 al cerrar el periodo. ¿Seguro?')) return;
      adm('challenge_set', { id: el.dataset.id, status: st, ...(st === 'pendiente' ? { winner: '', noPuede: '' } : {}) }, 'Guardado');
    },
    aDel(el) { if (confirm('¿Borrar este reto sin penalización?')) adm('challenge_delete', { id: el.dataset.id }, 'Borrado'); },
    aCreate() { const a = $('#mA').value, b = $('#mB').value; if (a === b) return toast('Elige dos jugadores distintos', 'err'); adm('challenge_create', { challenger: a, challenged: b, sent: true }, 'Reto creado'); },
    saveCfg() { adm('config', { title: $('#cTitle').value, season: $('#cSeason').value, referee: $('#cRef').value, periodDays: Number($('#cDays').value) }, 'Guardado'); },
    freeze(el) { if (el.dataset.on === '1' && !confirm('Se fijará el ranking actual como clasificación final. ¿Seguro?')) return; adm('freeze', { on: el.dataset.on === '1' }, 'Hecho'); },
    async changePwd() {
      const n = $('#newPwd').value; if (n.length < 8) return toast('Mínimo 8 caracteres', 'err');
      if (await adm('password', { new: n })) { adminPwd = n; try { sessionStorage.setItem('hegemon.admin', n); } catch (e) { /* */ } toast('Clave cambiada. Guárdala en un sitio seguro.'); }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { if (el.tagName !== 'A') e.preventDefault(); fn(el); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.input === 'filter') {
      ui.filter = e.target.value; const pos = e.target.selectionStart; render(); const f = $('#filter'); if (f) { f.focus(); f.setSelectionRange(pos, pos); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); closeOverlay(); }
    if (e.key === 'Enter' && e.target.id === 'lgPin') actions.login();
    if (e.key === 'Enter' && e.target.id === 'aPwd') actions.adminLogin();
  });
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });


  // ---------- animación de entrada: la bola cruza la pantalla y se aplasta junto al título ----------
  function introBall() {
    const target = document.querySelector('.top .ball');
    if (reduce || !target || !target.animate || sessionStorage.getItem('hegemon.intro') === '2') return;
    const t = target.getBoundingClientRect(), size = t.width, tx = t.left + size / 2, ty = t.top + size / 2;
    const cx = innerWidth / 2, cy = innerHeight * 0.42, dx = cx - tx, dy = cy - ty, S = Math.min(innerWidth * 0.34, 150) / size;
    target.style.visibility = 'hidden';
    const veil = document.createElement('div'); veil.className = 'intro-veil'; document.body.appendChild(veil);
    const shadow = document.createElement('div'); shadow.className = 'intro-shadow'; document.body.appendChild(shadow);
    const ball = document.createElement('div'); ball.className = 'ball intro-ball';
    ball.style.cssText = `left:${tx - size / 2}px;top:${ty - size / 2}px;width:${size}px;height:${size}px`;
    document.body.appendChild(ball);
    const D = 2900;
    const kf = [
      { offset: 0, transform: `translate(${dx}px,${dy}px) scale(0) rotate(0deg)`, easing: 'cubic-bezier(.2,1.6,.4,1)' },
      { offset: 0.2, transform: `translate(${dx}px,${dy}px) scale(${S * 1.12}) rotate(260deg)`, easing: 'ease-out' },
      { offset: 0.34, transform: `translate(${dx}px,${dy - 14}px) scale(${S}) rotate(520deg)`, easing: 'ease-in-out' },
      { offset: 0.5, transform: `translate(${dx}px,${dy + 6}px) scale(${S * 1.02}) rotate(900deg)`, easing: 'cubic-bezier(.5,0,.9,.4)' },
      { offset: 0.74, transform: `translate(${dx * 0.42}px,${Math.max(dy * 0.42 - Math.min(190, innerHeight * 0.25), -(ty - size * 1.4))}px) scale(${S * 0.5}) rotate(1500deg)`, easing: 'cubic-bezier(.3,.7,.6,1)' },
      { offset: 0.88, transform: `translate(0px,0px) scale(1.04) rotate(2100deg)`, easing: 'ease-in' },
      { offset: 0.925, transform: `translate(0px,${size * 0.2}px) scale(1.55,0.5) rotate(2100deg)`, easing: 'ease-out' },
      { offset: 0.965, transform: `translate(0px,-${size * 0.12}px) scale(0.92,1.1) rotate(2100deg)`, easing: 'ease-in-out' },
      { offset: 1, transform: `translate(0px,0px) scale(1) rotate(2100deg)` },
    ];
    veil.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration: D * 0.82, fill: 'forwards' }).onfinish = () => veil.remove();
    shadow.style.cssText = `left:${cx - 60}px;top:${cy + S * size * 0.62}px`;
    shadow.animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: .5, transform: 'scale(1)', offset: .22 }, { opacity: .35, transform: 'scale(.9)', offset: .5 }, { opacity: 0, transform: 'scale(.2)', offset: .72 }, { opacity: 0 }], { duration: D, fill: 'forwards' }).onfinish = () => shadow.remove();
    const done = () => {
      ball.remove(); target.style.visibility = ''; target.classList.add('landed');
      const ring = document.createElement('div'); ring.className = 'intro-ring'; ring.style.cssText = `left:${tx}px;top:${ty}px`; document.body.appendChild(ring); setTimeout(() => ring.remove(), 900);
      const b = $('.brand-t b'); if (b) b.animate([{ transform: 'scale(1)', textShadow: '0 0 0 rgba(212,245,60,0)' }, { transform: 'scale(1.06)', textShadow: '0 0 24px rgba(212,245,60,.9)', offset: .35 }, { transform: 'scale(1)', textShadow: '0 0 0 rgba(212,245,60,0)' }], { duration: 900, easing: 'ease-out' });
      burst({ x: tx, y: ty + size * 0.4, n: 34 });
    };
    const anim = ball.animate(kf, { duration: D, easing: 'linear', fill: 'forwards' });
    anim.onfinish = done;
    try { sessionStorage.setItem('hegemon.intro', '1'); } catch (e) { /* */ }
    // la web sigue siendo usable: tocar cualquier sitio salta la animación
    veil.style.pointerEvents = 'auto'; veil.addEventListener('click', () => { anim.finish(); }, { once: true });
  }

  // ---------- arranque ----------
  const hash = location.hash.match(/j=([0-9a-f-]{36})/);
  if ('serviceWorker' in navigator && !window.TENIS_DEMO && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js?v=4').catch(() => {});
  if (!me) idb.get('me').then((v) => { if (v && v.id && v.pin && !me) { me = v; store.set('hegemon.me', v); refresh(true); } });
  if (me) askPersist();
  window.hegemonIntro = introBall;
  introBall();
  render();
  refresh(true).then(() => { refreshPush().then(syncPush); if (hash && !me && S) { loginSheet(hash[1]); } if (location.hash === '#admin') actions.adminEntry(); });
  setInterval(() => { if (!document.hidden) refresh(); }, CFG.pollMs);
  setInterval(tickCountdowns, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
