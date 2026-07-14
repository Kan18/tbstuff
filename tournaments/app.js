/* app.js — routing + rendering. Depends on window.TBC from compute.js. */
'use strict';
(function () {
  const TBC = window.TBC;
  const $view = document.getElementById('view');

  /* ================= utilities ================= */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const num = (n) => n.toLocaleString('en-US');
  const pct = (x) => (x * 100).toFixed(1) + '%';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + d + ', ' + y;
  }
  function fmtSpan(span) {
    if (!span) return '';
    const [a, b] = span.split('..');
    if (!b || a === b) return fmtDate(a);
    const [ya, ma, da] = a.split('-').map(Number);
    const [yb, mb, db] = b.split('-').map(Number);
    if (ya === yb) return MONTHS[ma - 1] + ' ' + da + ' – ' + MONTHS[mb - 1] + ' ' + db + ', ' + ya;
    return fmtDate(a) + ' – ' + fmtDate(b);
  }

  const VERSION_LABEL = { tbc1: 'TBC1', tbc2: 'TBC2' };
  const BK_SHORT = { 'hunts-bracket': 'HB', 'non-hunts-bracket': '', combined: '' };

  // Index only the member fragment assigned to each Roblox ID. Indexing the
  // full team entry would make a search for one teammate return every other
  // member of that team as a false hit.
  const entryNamesByPlayer = new Map();
  for (const t of TBC.tournaments) {
    for (const part of t.parts) {
      for (const [rawName, uid] of part.rawMembers || []) {
        if (uid == null || !rawName) continue;
        if (!entryNamesByPlayer.has(uid)) entryNamesByPlayer.set(uid, new Set());
        entryNamesByPlayer.get(uid).add(rawName);
      }
    }
  }
  function playerSearchText(uid) {
    const p = TBC.players.get(uid);
    return [p?.username, p?.display, ...(entryNamesByPlayer.get(uid) || [])]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function matchingEntryName(uid, query) {
    return [...(entryNamesByPlayer.get(uid) || [])]
      .find((name) => name.toLowerCase().includes(query));
  }

  function playerName(uid) {
    const p = TBC.players.get(uid);
    return p ? p.username : '#' + uid;
  }
  function playerLink(uid) {
    return '<a href="#/p/' + uid + '">' + esc(playerName(uid)) + '</a>';
  }
  function avatarHtml(uid, size) {
    const initial = playerName(uid).slice(0, 1).toUpperCase();
    const imageUrl = TBC.players.get(uid)?.avatar;
    const sizeClass = size === 'large' ? ' avatar-large' : size === 'tiny' ? ' avatar-tiny' : ' avatar-small';
    return '<span class="avatar' + sizeClass + '" aria-hidden="true"' +
      (imageUrl ? ' data-avatar-src="' + esc(imageUrl) + '"' : '') + '>' + esc(initial) + '</span>';
  }

  let avatarObserver = null;
  let avatarFrame = 0;
  let playerMatchObserver = null;
  const avatarRoots = new Set();
  function loadAvatar(el) {
    if (!el.dataset.avatarSrc) return;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = el.dataset.avatarSrc;
    el.removeAttribute('data-avatar-src');
    el.appendChild(img);
  }
  function wireAvatars(root, reset) {
    if (reset && avatarObserver) {
      avatarObserver.disconnect();
      avatarObserver = null;
    }
    if (reset) avatarRoots.clear();
    avatarRoots.add(root);
    if (avatarFrame) return;
    avatarFrame = setTimeout(() => {
      avatarFrame = 0;
      const roots = [...avatarRoots];
      avatarRoots.clear();
      if (!('IntersectionObserver' in window)) {
        roots.forEach((item) => item.querySelectorAll('[data-avatar-src]').forEach(loadAvatar));
        return;
      }
      if (!avatarObserver) {
        avatarObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            avatarObserver.unobserve(entry.target);
            loadAvatar(entry.target);
          });
        }, { rootMargin: '240px' });
      }
      roots.forEach((item) => item.querySelectorAll('[data-avatar-src]').forEach((el) => avatarObserver.observe(el)));
    });
  }
  function replaceAvatarHtml(container, html) {
    if (avatarObserver) {
      container.querySelectorAll('[data-avatar-src]').forEach((el) => avatarObserver.unobserve(el));
    }
    container.innerHTML = html;
    wireAvatars(container);
  }
  function playerWithAvatar(uid) {
    return '<span class="player-ident">' + avatarHtml(uid) + playerLink(uid) + '</span>';
  }
  function memberHtml(m) {
    if (typeof m === 'number') return playerLink(m);
    return '<span class="unres" title="Could not be resolved to a Roblox account">' + esc(m) + '</span>';
  }
  function entryHtml(part) {
    return part.members.length
      ? part.members.map(memberHtml).join(' <span class="mut">&amp;</span> ')
      : esc(part.name);
  }
  function originalEntryHtml(part) {
    const text = part.name || '';
    const members = (part.rawMembers || []).map(([raw, uid], index) => ({
      raw: raw || '', uid, index, used: false,
    }));
    let out = '', cursor = 0;
    const lower = text.toLowerCase();
    function findMember(raw, from) {
      const exact = lower.indexOf(raw.toLowerCase(), from);
      if (exact >= 0) return { at: exact, length: raw.length };
      let pattern = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
          while (i + 1 < raw.length && /\s/.test(raw[i + 1])) i++;
          pattern += '\\s+';
        } else if (/[,/&]/.test(ch)) {
          pattern += '\\s*[,/&]\\s*';
        } else {
          pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      }
      const match = text.slice(from).match(new RegExp(pattern, 'i'));
      return match ? { at: from + match.index, length: match[0].length } : null;
    }
    while (cursor < text.length) {
      let next = null;
      for (const member of members) {
        if (member.used || !member.raw) continue;
        const found = findMember(member.raw, cursor);
        if (!found) continue;
        if (!next || found.at < next.at || (found.at === next.at && found.length > next.length)) {
          next = { member, at: found.at, length: found.length };
        }
      }
      if (!next) { out += esc(text.slice(cursor)); break; }
      out += esc(text.slice(cursor, next.at));
      const label = text.slice(next.at, next.at + next.length);
      out += next.member.uid != null
        ? '<a href="#/p/' + next.member.uid + '">' + esc(label) + '</a>'
        : '<span class="unres" title="Could not be resolved to a Roblox account">' + esc(label) + '</span>';
      next.member.used = true;
      cursor = next.at + next.length;
    }
    return out || entryHtml(part);
  }
  function entryWithAvatars(part, compact) {
    const uids = [...new Set(part.uids || [])];
    const avatars = uids.length
      ? '<span class="avatar-stack">' + uids.map((uid) => avatarHtml(uid, compact ? 'tiny' : 'small')).join('') + '</span>'
      : '';
    return '<span class="entry-ident' + (compact ? ' compact' : '') + '">' + avatars +
      '<span class="entry-text">' + originalEntryHtml(part) + '</span></span>';
  }
  function tournamentLink(t, label) {
    return '<a href="#/t/' + encodeURIComponent(t.slug) + '">' + esc(label || t.title) + '</a>';
  }

  function bracketChipLabel(t) {
    const bits = [];
    if (t.session !== 'unknown') bits.push('Ses ' + t.session);
    if (BK_SHORT[t.bracketKind]) bits.push(BK_SHORT[t.bracketKind]);
    if (t.teamSize !== 'unknown') bits.push(t.teamSize);
    if (t.type !== 'SE') bits.push(t.type);
    return bits.join(' · ') || t.type;
  }

  function resultBadge(t, part) {
    const label = TBC.placementLabel(t, part);
    if (part.isWinner) return '<span class="badge b-win">🏆 Winner</span>';
    if (label === 'Finalist' || label === 'Runner-up') return '<span class="badge b-2">' + label + '</span>';
    return '<span class="badge">' + esc(label) + '</span>';
  }

  function wlHtml(w, l) {
    return '<span class="wl nowrap"><span class="w">' + num(w) + '</span><span class="mut">–</span><span class="l">' + num(l) + '</span></span>';
  }

  const scoreTxt = (v) => (v == null ? '–' : v === -1 ? 'FF' : String(v));
  // some hosts recorded marker scores like 999–998 to force a result;
  // treat any |score| > 50 (other than -1 forfeits) as "no meaningful score"
  const isJunkScore = (v) => typeof v === 'number' && v !== -1 && Math.abs(v) > 50;
  const junkPair = (s1, s2) => isJunkScore(s1) || isJunkScore(s2);

  function statTile(label, value, note, gold) {
    return '<div class="tile' + (gold ? ' gold' : '') + '">' +
      '<div class="t-label">' + esc(label) + '</div>' +
      '<div class="t-value">' + value + '</div>' +
      (note ? '<div class="t-note">' + note + '</div>' : '') +
      '</div>';
  }

  /* ================= bracket rendering ================= */

  const SOLO_CARD_W = 224, TEAM_CARD_W = 292;
  const CARD_H = 51, COL_GAP = 50, ROW_GAP = 4, PAD = 38, HEAD_H = 36;
  const MATCH_PREDICTIONS = window.TBC_MATCH_PREDICTIONS?.matches || {};

  function cardWidth(t) {
    return t.teamSize === '2v2' || t.teamSize === '3v3' ? TEAM_CARD_W : SOLO_CARD_W;
  }

  function matchPrediction(t, m) {
    const value = MATCH_PREDICTIONS[t.slug]?.[m.ident];
    return Number.isFinite(value) ? [value, 10000 - value] : null;
  }

  function probabilityAttrs(value) {
    const exact = (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return ' data-prob="' + Math.round(value / 100) + '%" data-prob-exact="' + exact + '%"' +
      (value > 5000 ? ' data-favored="true"' : '');
  }

  function matchRowsHtml(t, m) {
    const junk = junkPair(m.s1, m.s2);
    const prediction = matchPrediction(t, m);
    return [[m.p1, m.s1], [m.p2, m.s2]].map(([pi, sc], side) => {
      const isWin = m.w >= 0 && pi === m.w;
      const scHtml = m.st !== 0 ? '' : junk ? (isWin ? '✓' : '') : scoreTxt(sc);
      let nameHtml;
      if (pi >= 0) {
        const part = t.parts[pi];
        nameHtml = entryWithAvatars(part, true);
        nameHtml = '<span class="mname" title="' + esc(part.name) + '">' + nameHtml + '</span>';
      } else {
        nameHtml = '<span class="mname mut">' + (m.st === 0 ? '—' : 'TBD') + '</span>';
      }
      return '<div class="mrow' + (isWin ? ' mwin' : '') + '"' +
        (pi < 0 ? '' : prediction ? probabilityAttrs(prediction[side]) : ' data-prob="—" data-prob-unavailable="true"') + '>' +
        nameHtml + '<span class="mscore">' + scHtml + '</span></div>';
    }).join('');
  }

  function matchCard(t, m, x, y, width) {
    return '<span class="mnum" style="left:' + (x - 31) + 'px;top:' + (y + CARD_H / 2 - 9) + 'px">' +
      (m.ident == null ? '' : m.ident) + '</span>' +
      '<div class="match" style="left:' + x + 'px;top:' + y + 'px;width:' + width + 'px" title="' +
      esc(TBC.roundName(t, m.round)) + '">' + matchRowsHtml(t, m) + '</div>';
  }

  function bracketSection(t, ms, name) {
    if (!ms.length) return '';
    const widthOfCard = cardWidth(t);
    const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => Math.abs(a) - Math.abs(b));
    const tree = TBC.bracketTreeLayout(ms);
    const pos = new Map();
    const items = [];
    const baseY = PAD + HEAD_H;
    const step = CARD_H + ROW_GAP;
    const columns = rounds.map((r) => ms.filter((m) => m.round === r).sort((a, b) =>
      tree.positions.get(a.ident) - tree.positions.get(b.ident) || a.ident - b.ident));
    let anchor = 0;
    for (let i = 1; i < columns.length; i++) {
      if (columns[i].length > columns[anchor].length) anchor = i;
    }
    const yById = new Map();

    function placeColumn(index, desiredFor) {
      let nextY = baseY;
      for (let i = 0; i < columns[index].length; i++) {
        const m = columns[index][i];
        const desired = desiredFor(m, i);
        const y = Math.max(Math.round(desired), nextY);
        yById.set(m.ident, y);
        nextY = y + step;
      }
    }

    // The densest round defines the compact vertical rhythm.
    placeColumn(anchor, (_, i) => baseY + i * step);

    // Preserve the tree-relative half-slot offset for early play-in matches.
    // Flattening these to the successor card's top edge makes a bottom-slot
    // feeder bend downward instead of following the familiar bracket path.
    for (let i = anchor - 1; i >= 0; i--) {
      placeColumn(i, (m, order) => {
        const successors = ms.filter((candidate) =>
          (candidate.pr1 === m.ident || candidate.pr2 === m.ident) && yById.has(candidate.ident));
        return successors.length
          ? successors.reduce((sum, successor) => sum + yById.get(successor.ident) +
            (tree.positions.get(m.ident) - tree.positions.get(successor.ident)) * step, 0) / successors.length
          : baseY + order * step;
      });
    }

    // Later rounds sit midway between their visible prerequisites. A single
    // prerequisite (the other side is a bye/external drop) stays level.
    for (let i = anchor + 1; i < columns.length; i++) {
      placeColumn(i, (m, order) => {
        const prereqs = [m.pr1, m.pr2].filter((id) => id != null && yById.has(id));
        return prereqs.length
          ? prereqs.reduce((sum, id) => sum + yById.get(id), 0) / prereqs.length
          : baseY + order * step;
      });
    }

    rounds.forEach((r, ci) => {
      const x = PAD + ci * (widthOfCard + COL_GAP);
      for (const m of columns[ci]) {
        const y = yById.get(m.ident);
        pos.set(m.ident, { x, y });
        items.push({ x, y, m });
      }
    });
    const width = PAD * 2 + rounds.length * widthOfCard + (rounds.length - 1) * COL_GAP;
    const height = Math.max(...items.map((it) => it.y)) + CARD_H + PAD;

    let paths = '';
    for (const it of items) {
      for (const [slot, pr] of [it.m.pr1, it.m.pr2].entries()) {
        const p = pr != null ? pos.get(pr) : null;
        if (!p) continue;
        const x1 = p.x + widthOfCard, y1 = p.y + CARD_H / 2;
        const x2 = it.x, y2 = it.y + CARD_H * (slot === 0 ? 0.25 : 0.75);
        const midX = x1 + COL_GAP / 2;
        paths += '<path d="M' + x1 + ' ' + y1 + 'H' + midX + 'V' + y2 + 'H' + x2 + '"></path>';
      }
    }
    let heads = '';
    rounds.forEach((r, ci) => {
      heads += '<div class="round-head" style="left:' + (PAD + ci * (widthOfCard + COL_GAP)) + 'px;width:' + widthOfCard + 'px">' +
        esc(TBC.roundName(t, r)) + '</div>';
    });
    const cards = items.map((it) => matchCard(t, it.m, it.x, it.y, widthOfCard)).join('');
    return '<div class="bracket-sec">' +
      (name ? '<h3>' + esc(name) + '</h3>' : '') +
      '<div class="bracket-scroll"><div class="bracket-canvas" style="width:' + width + 'px;height:' + height + 'px">' +
      '<svg width="' + width + '" height="' + height + '">' + paths + '</svg>' +
      heads + cards +
      '</div></div></div>';
  }

  function bracketHtml(t) {
    const wb = t.matches.filter((m) => m.round > 0);
    const lb = t.matches.filter((m) => m.round < 0);
    let s = bracketSection(t, wb, lb.length ? 'Winners bracket' : '');
    if (lb.length) {
      s += bracketSection(t, lb, 'Losers bracket');
      s += '<p class="small mut">Teams knocked out of the winners bracket drop into the losers bracket for a second chance.</p>';
    }
    return s;
  }

  /* ---- round robin ---- */

  function rrRoundsHtml(t) {
    const rounds = [...new Set(t.matches.map((m) => m.round))].sort((a, b) => a - b);
    return '<div class="rr-schedule">' + rounds.map((round) => {
      const matches = t.matches.filter((m) => m.round === round).sort((a, b) => a.ident - b.ident);
      return '<section class="rr-round"><h2>' + esc(TBC.roundName(t, round)) + '</h2>' +
        '<div class="rr-match-grid">' + matches.map((m) =>
          '<div class="rr-match-wrap"><span class="rr-match-num">' + (m.ident == null ? '' : m.ident) + '</span>' +
          '<div class="match rr-match">' + matchRowsHtml(t, m) + '</div></div>'
        ).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  function rrStandingsHtml(t) {
    const order = t.parts.slice().sort((a, b) => a.placement - b.placement || a.name.localeCompare(b.name));
    let standings = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th class="rank">#</th><th>Entry</th><th class="num">W</th><th class="num">L</th><th class="num">Games</th><th>Result</th>' +
      '</tr></thead><tbody>';
    for (const p of order) {
      standings += '<tr><td class="rank">' + p.placement + '</td><td>' + entryWithAvatars(p, false) + '</td>' +
        '<td class="num">' + p.w + '</td><td class="num">' + p.l + '</td>' +
        '<td class="num">' + p.gw + '–' + p.gl + '</td><td>' + resultBadge(t, p) + '</td></tr>';
    }
    standings += '</tbody></table></div>';

    return rrRoundsHtml(t) +
      '<div class="card section"><h2>Standings</h2>' + standings + '</div>' +
      '<div class="card section"><details class="results-details"><summary>Results grid</summary>' +
      '<div class="lazy-detail-content"></div></details></div>';
  }

  function rrMatrixHtml(t) {
    const order = t.parts.slice().sort((a, b) => a.placement - b.placement || a.name.localeCompare(b.name));
    const cell = new Map(); // "a|b" -> [{s, win}]
    for (const m of t.matches) {
      if (m.st !== 0 || m.p1 < 0 || m.p2 < 0) continue;
      const add = (a, b, sa, sb, won) => {
        const k = a + '|' + b;
        if (!cell.has(k)) cell.set(k, []);
        const txt = junkPair(sa, sb)
          ? (won === 1 ? 'W' : won === 0 ? 'L' : '—')
          : scoreTxt(sa) + '–' + scoreTxt(sb);
        cell.get(k).push({ txt, won });
      };
      add(m.p1, m.p2, m.s1, m.s2, m.w === m.p1 ? 1 : m.w === m.p2 ? 0 : -1);
      add(m.p2, m.p1, m.s2, m.s1, m.w === m.p2 ? 1 : m.w === m.p1 ? 0 : -1);
    }
    let matrix = '<div class="tbl-wrap"><table class="tbl rr-matrix"><thead><tr><th class="rname">Entry</th>';
    order.forEach((_, i) => { matrix += '<th>' + (i + 1) + '</th>'; });
    matrix += '</tr></thead><tbody>';
    order.forEach((p, i) => {
      matrix += '<tr><td class="rname">' + (i + 1) + '. ' + entryWithAvatars(p, true) + '</td>';
      order.forEach((q) => {
        if (p === q) { matrix += '<td class="diag"></td>'; return; }
        const res = cell.get(p.pi + '|' + q.pi);
        if (!res) { matrix += '<td class="mut">·</td>'; return; }
        matrix += '<td>' + res.map((r) =>
          '<span class="' + (r.won === 1 ? 'c-winx' : r.won === 0 ? 'c-lossx' : '') + '">' + r.txt + '</span>'
        ).join('<br>') + '</td>';
      });
      matrix += '</tr>';
    });
    matrix += '</tbody></table></div>';
    // color whole cells via class on td is cleaner; simple post-process:
    matrix = matrix
      .replace(/<td><span class="c-winx">/g, '<td class="c-win"><span>')
      .replace(/<td><span class="c-lossx">/g, '<td class="c-loss"><span>');

    return '<p class="small mut">Scores read row vs. column.</p>' + matrix;
  }

  /* ================= views ================= */

  function setNav(key) {
    document.querySelectorAll('#site-nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-nav') === key);
    });
  }

  function render(key, title, html, wire) {
    setNav(key);
    document.title = (title ? title + ' — ' : '') + 'TBC Stats';
    if (playerMatchObserver) {
      playerMatchObserver.disconnect();
      playerMatchObserver = null;
    }
    $view.classList.remove('show-predictions');
    // Scrolling after a large insertion forces Safari to synchronously lay out
    // the whole new page before it can display the route.
    window.scrollTo(0, 0);
    $view.innerHTML = html;
    if (wire) wire($view);
    wireAvatars($view, true);
  }

  /* ---------- home ---------- */

  function viewHome() {
    const topChamps = [...TBC.agg.values()]
      .sort((a, b) => b.wins.length - a.wins.length || b.mw - a.mw)
      .slice(0, 14);
    const recent = TBC.groupsByDate.slice(-6).reverse();
    let html = '<h1>Tower Battles tournament archive</h1>';

    html += '<div class="kpis">' +
      statTile('Events', num(TBC.groups.length), 'grouped tournament sessions') +
      statTile('Brackets', num(TBC.tournaments.length)) +
      statTile('Players', num(TBC.players.size), 'resolved Roblox accounts') +
      statTile('Matches', num(TBC.totalMatches)) +
      statTile('Team entries', num(TBC.totalEntries)) +
      '</div>';

    let champs = '<div class="card"><h2>Most tournament wins</h2><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th class="rank">#</th><th>Player</th><th class="num">Wins</th><th class="num">Match record</th></tr></thead><tbody>';
    topChamps.forEach((a, i) => {
      champs += '<tr><td class="rank">' + (i + 1) + '</td><td>' + playerWithAvatar(a.uid) + '</td>' +
        '<td class="num">' + a.wins.length + '</td><td class="num">' + wlHtml(a.mw, a.ml) + '</td></tr>';
    });
    champs += '</tbody></table></div><p class="small" style="margin-bottom:0"><a href="#/players">All player records →</a></p></div>';

    let latest = '<div class="card"><h2>Latest events</h2>';
    for (const g of recent) {
      latest += '<div class="event-row"><div class="e-date">' + esc(fmtSpan(g.span)) + '</div>' +
        '<div class="e-title">' + esc(g.title) + '</div><div class="chips">' +
        g.tournaments.map((t) => '<a class="chip accent" href="#/t/' + encodeURIComponent(t.slug) + '">' + esc(bracketChipLabel(t)) + '</a>').join('') +
        '</div></div>';
    }
    latest += '<p class="small" style="margin-bottom:0"><a href="#/events">All events →</a></p></div>';

    html += '<div class="grid-2 section">' + champs + latest + '</div>';

    render('home', '', html);
  }

  /* ---------- events ---------- */

  const eventsState = { q: '', year: '', version: '', ts: '' };

  function viewEvents() {
    const years = [...new Set(TBC.groups.map((g) => g.year))].sort((a, b) => b - a);
    const html = '<h1>Events</h1>' +
      '<div class="filters">' +
      '<input type="search" id="ev-q" placeholder="Filter by title…" value="' + esc(eventsState.q) + '">' +
      '<select id="ev-year"><option value="">All years</option>' +
      years.map((y) => '<option' + (String(y) === eventsState.year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select>' +
      '<select id="ev-version"><option value="">TBC1 + TBC2</option>' +
      ['tbc1', 'tbc2'].map((v) => '<option value="' + v + '"' + (v === eventsState.version ? ' selected' : '') + '>' + VERSION_LABEL[v] + '</option>').join('') + '</select>' +
      '<select id="ev-ts"><option value="">All team sizes</option>' +
      ['1v1', '2v2', '3v3'].map((v) => '<option' + (v === eventsState.ts ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' +
      '<span class="count" id="ev-count"></span>' +
      '</div>' +
      '<div class="card" id="ev-list"></div>';

    render('events', 'Events', html, (root) => {
      const $list = root.querySelector('#ev-list');
      const $count = root.querySelector('#ev-count');
      function apply() {
        const q = eventsState.q.trim().toLowerCase();
        const rows = TBC.groupsByDate.slice().reverse().filter((g) => {
          if (q && !g.title.toLowerCase().includes(q)) return false;
          if (eventsState.year && String(g.year) !== eventsState.year) return false;
          if (eventsState.version && !g.tournaments.some((t) => t.version === eventsState.version)) return false;
          if (eventsState.ts && !g.tournaments.some((t) => t.teamSize === eventsState.ts)) return false;
          return true;
        });
        $count.textContent = rows.length + ' of ' + TBC.groups.length + ' events';
        $list.innerHTML = rows.map((g) => {
          const champs = [];
          for (const t of g.tournaments) {
            for (const wi of t.winners) {
              const label = g.tournaments.length > 1
                ? '<span class="mut">' + esc(bracketChipLabel(t)) + ':</span> ' : '';
              champs.push('<div class="e-champ">🏆 ' + label + entryHtml(t.parts[wi]) + '</div>');
            }
          }
          return '<div class="event-row">' +
            '<div class="e-date">' + esc(fmtSpan(g.span)) + ' · ' + VERSION_LABEL[g.tournaments[0].version] + '</div>' +
            '<div class="e-title">' + esc(g.title) + '</div>' +
            '<div class="chips">' + g.tournaments.map((t) =>
              '<a class="chip accent" href="#/t/' + encodeURIComponent(t.slug) + '">' + esc(bracketChipLabel(t)) + '</a>').join('') + '</div>' +
            champs.join('') +
            '</div>';
        }).join('') || '<p class="mut">No events match those filters.</p>';
      }
      root.querySelector('#ev-q').addEventListener('input', (e) => { eventsState.q = e.target.value; apply(); });
      root.querySelector('#ev-year').addEventListener('change', (e) => { eventsState.year = e.target.value; apply(); });
      root.querySelector('#ev-version').addEventListener('change', (e) => { eventsState.version = e.target.value; apply(); });
      root.querySelector('#ev-ts').addEventListener('change', (e) => { eventsState.ts = e.target.value; apply(); });
      apply();
    });
  }

  /* ---------- tournament ---------- */

  const OVERRIDE_KINDS = { top_tie: 'Tied in standings', credited_winner: 'Credited winner', actual_winner: 'Actual winner' };

  function renderChunkedTable(container, head, rows, tableClass) {
    container.innerHTML = '<div class="tbl-wrap"><table class="tbl' + (tableClass ? ' ' + tableClass : '') + '">' +
      '<thead>' + head + '</thead><tbody></tbody></table></div>';
    const tbody = container.querySelector('tbody');
    let offset = 0;
    function appendChunk() {
      if (!tbody.isConnected) return;
      tbody.insertAdjacentHTML('beforeend', rows.slice(offset, offset + 25).join(''));
      offset += 25;
      if (offset < rows.length) setTimeout(appendChunk, 0);
      else wireAvatars(container);
    }
    appendChunk();
  }

  function renderTournamentEntries(container, t) {
    const order = t.parts.slice().sort((a, b) => a.placement - b.placement || (a.seed || 999) - (b.seed || 999));
    const rows = order.map((p) => '<tr><td class="rank">' + p.placement + (p.tied ? '<span class="mut">T</span>' : '') + '</td>' +
      '<td>' + entryWithAvatars(p, false) + '</td>' +
      '<td class="num">' + (p.seed == null ? '–' : p.seed) + '</td>' +
      '<td class="num">' + wlHtml(p.w, p.l) + '</td>' +
      '<td>' + resultBadge(t, p) + '</td></tr>');
    renderChunkedTable(container, '<tr><th class="rank">#</th><th>Entry</th><th class="num">Seed</th>' +
      '<th class="num">W–L</th><th>Result</th></tr>', rows);
  }

  function renderTournamentMatches(container, t) {
    const ms = t.matches.slice().sort((a, b) => a.ident - b.ident);
    const rows = ms.map((m) => {
      const nameOf = (pi) => pi >= 0 ? entryWithAvatars(t.parts[pi], true)
        : '<span class="mut">' + (m.st === 0 ? '—' : 'TBD') + '</span>';
      const b1 = m.w >= 0 && m.w === m.p1, b2 = m.w >= 0 && m.w === m.p2;
      const scoreCell = m.st !== 0
        ? '<span class="mut">' + esc(m.st === 1 ? 'open' : 'pending') + '</span>'
        : junkPair(m.s1, m.s2) ? '<span class="mut">—</span>'
        : scoreTxt(m.s1) + '–' + scoreTxt(m.s2);
      return '<tr><td class="mut small nowrap">' + esc(TBC.roundName(t, m.round)) + '</td>' +
        '<td' + (b1 ? ' style="font-weight:600"' : '') + '>' + nameOf(m.p1) + '</td>' +
        '<td class="num nowrap">' + scoreCell + '</td>' +
        '<td' + (b2 ? ' style="font-weight:600"' : '') + '>' + nameOf(m.p2) + '</td></tr>';
    });
    renderChunkedTable(container, '<tr><th>Round</th><th>Entry 1</th><th class="num">Score</th>' +
      '<th>Entry 2</th></tr>', rows);
  }

  function wireTournamentDetails(root, t) {
    const predictionToggle = root.querySelector('#prediction-toggle');
    if (predictionToggle) {
      predictionToggle.addEventListener('change', () => {
        root.classList.toggle('show-predictions', predictionToggle.checked);
        root.querySelectorAll('.match .mrow[data-prob-exact]').forEach((row) => {
          if (predictionToggle.checked) row.title = 'Predicted win chance: ' + row.dataset.probExact;
          else row.removeAttribute('title');
        });
      });
    }
    const wire = (selector, build) => {
      const details = root.querySelector(selector);
      if (!details) return;
      details.addEventListener('toggle', () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = 'true';
        const content = details.querySelector('.lazy-detail-content');
        content.innerHTML = '<div class="lazy-loading">Loading…</div>';
        setTimeout(() => {
          if (content.isConnected) build(content);
        }, 0);
      });
    };
    wire('.entries-details', (content) => renderTournamentEntries(content, t));
    wire('.matches-details', (content) => renderTournamentMatches(content, t));
    wire('.results-details', (content) => replaceAvatarHtml(content, rrMatrixHtml(t)));
  }

  function viewTournament(slug) {
    const t = TBC.bySlug.get(slug);
    if (!t) return viewNotFound();
    const g = TBC.groups[t.groupIdx];

    let html = '<div class="crumb"><a href="#/events">Events</a> / ' + esc(g.title) + '</div>' +
      '<h1>' + esc(t.title) + '</h1>';

    const chips = ['<span class="chip">📅 ' + esc(fmtDate(t.date)) + '</span>',
      '<span class="chip">' + VERSION_LABEL[t.version] + '</span>'];
    if (t.session !== 'unknown') chips.push('<span class="chip">Session ' + t.session + '</span>');
    if (t.bracketKind === 'hunts-bracket') chips.push('<span class="chip">Huntsman bracket</span>');
    if (t.teamSize !== 'unknown') chips.push('<span class="chip">' + t.teamSize + '</span>');
    chips.push('<span class="chip">' + esc(TBC.TYPE_NAMES[t.type] || t.type) + '</span>');
    chips.push('<span class="chip">' + t.parts.length + ' entries</span>');
    chips.push('<a class="chip" href="' + esc(t.url) + '" target="_blank" rel="noopener">Challonge ↗</a>');
    html += '<div class="chips">' + chips.join('') + '</div>';

    if (g.tournaments.length > 1) {
      html += '<div class="chips" style="margin-top:10px">' + g.tournaments.map((s) =>
        '<a class="chip' + (s === t ? ' cur' : '') + '" href="#/t/' + encodeURIComponent(s.slug) + '">' +
        esc(bracketChipLabel(s)) + '</a>').join('') + '</div>';
    }

    if (t.winners.length) {
      const names = t.winners.map((wi) => entryWithAvatars(t.parts[wi], false)).join(' <span class="mut">and</span> ');
      const src = { manual_override: 'winner set by manual override', round_robin_standings: 'decided on round-robin standings', final_match: '' }[t.winnerSource] || '';
      html += '<div class="champ-card"><div class="cup">🏆</div><div>' +
        '<div class="c-label">Champion' + (t.winners.length > 1 ? 's' : '') + '</div>' +
        '<div class="c-names">' + names + '</div>' +
        (src ? '<div class="c-sub">' + esc(src) + '</div>' : '') +
        '</div></div>';
    }

    if (t.override) {
      html += '<div class="callout"><div class="co-title">⚠️ Result adjusted manually</div>' +
        '<div>' + esc(t.override.reason || '') + '</div>';
      const entries = t.override.entries.filter(([kind]) => OVERRIDE_KINDS[kind]);
      if (entries.length) {
        html += '<ul style="margin:6px 0 0;padding-left:20px">' + entries.map(([kind, entry, record]) =>
          '<li><strong>' + OVERRIDE_KINDS[kind] + ':</strong> ' + esc(entry || '') +
          (record ? ' <span class="mut">(' + esc(record) + ')</span>' : '') + '</li>').join('') + '</ul>';
      }
      html += '</div>';
    }

    const predictedMatches = t.matches.filter((m) => Number.isFinite(MATCH_PREDICTIONS[t.slug]?.[m.ident])).length;
    if (predictedMatches) {
      html += '<div class="bracket-options"><label class="prediction-toggle" ' +
        'title="Recommended model probabilities">' +
        '<input id="prediction-toggle" type="checkbox"> Predicted win chances</label></div>';
    }

    if (t.type === 'RR') {
      html += rrStandingsHtml(t);
    } else {
      html += bracketHtml(t);
      html += '<div class="card section"><details class="entries-details"><summary>Entries &amp; results (' + t.parts.length + ')</summary>' +
        '<div class="lazy-detail-content"></div></details></div>';
    }

    html += '<div class="card section"><details class="matches-details"><summary>All matches (' + t.matches.length + ')</summary>' +
      '<div class="lazy-detail-content"></div></details></div>';

    render('events', t.title, html, (root) => wireTournamentDetails(root, t));
  }

  /* ---------- player ---------- */

  let showPlayerMatches = false;
  let playerMatchesForUid = null;

  function playerMatchHtml(t, m, playerPi) {
    const entry = (pi) => pi >= 0
      ? entryWithAvatars(t.parts[pi], true)
      : '<span class="mut">' + (m.st === 0 ? '—' : 'TBD') + '</span>';
    const score = m.st !== 0
      ? '<span class="mut">' + esc(m.st === 1 ? 'open' : 'pending') + '</span>'
      : junkPair(m.s1, m.s2) ? '<span class="mut">—</span>'
      : scoreTxt(m.s1) + '–' + scoreTxt(m.s2);
    let result = '<span class="badge">—</span>';
    if (m.st === 0 && m.w === playerPi) result = '<span class="badge b-win">W</span>';
    else if (m.st === 0 && m.l === playerPi) result = '<span class="badge b-loss">L</span>';
    return '<div class="player-match-row"><span class="match-round">' + esc(TBC.roundName(t, m.round)) + '</span>' +
      '<span class="match-entry' + (m.w === m.p1 ? ' won' : '') + '">' + entry(m.p1) + '</span>' +
      '<span class="match-score">' + score + '</span>' +
      '<span class="match-entry' + (m.w === m.p2 ? ' won' : '') + '">' + entry(m.p2) + '</span>' +
      '<span class="match-result">' + result + '</span></div>';
  }

  function renderPlayerTournamentMatches(container) {
    if (container.dataset.loaded) return;
    const t = TBC.tournaments[Number(container.dataset.ti)];
    const playerPi = Number(container.dataset.pi);
    const matches = t.matches.filter((m) => m.p1 === playerPi || m.p2 === playerPi)
      .sort((a, b) => a.ident - b.ident);
    container.dataset.loaded = 'true';
    replaceAvatarHtml(container, '<div class="player-matches-title">Matches in this tournament <span>' + matches.length + '</span></div>' +
      '<div class="player-match-head"><span>Round</span><span>Entry 1</span><span>Score</span><span>Entry 2</span><span>Result</span></div>' +
      (matches.length ? matches.map((m) => playerMatchHtml(t, m, playerPi)).join('') : '<div class="no-matches">No matches recorded.</div>'));
  }

  function renderPlayerMatchesBatched(list) {
    const containers = [...list.querySelectorAll('.player-matches:not([data-loaded])')];
    containers.forEach((container) => { container.innerHTML = '<div class="lazy-loading">Loading matches…</div>'; });
    if ('IntersectionObserver' in window) {
      if (playerMatchObserver) playerMatchObserver.disconnect();
      playerMatchObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          playerMatchObserver.unobserve(entry.target);
          renderPlayerTournamentMatches(entry.target);
        });
      }, { rootMargin: '800px 0px' });
      containers.forEach((container) => playerMatchObserver.observe(container));
      return;
    }
    let offset = 0;
    function nextBatch() {
      if (!list.isConnected) return;
      containers.slice(offset, offset + 10).forEach(renderPlayerTournamentMatches);
      offset += 10;
      if (offset < containers.length) setTimeout(nextBatch, 0);
    }
    setTimeout(nextBatch, 0);
  }

  function matchesAgainstPlayer(entries, opponentUid) {
    const found = [];
    const seen = new Set();
    for (const e of entries) {
      const t = TBC.tournaments[e.ti];
      for (const m of t.matches) {
        if (m.st !== 0 || m.w < 0 || m.l < 0) continue;
        if (m.p1 !== e.pi && m.p2 !== e.pi) continue;
        const otherPi = m.p1 === e.pi ? m.p2 : m.p1;
        if (otherPi < 0 || !t.parts[otherPi].uids.includes(opponentUid)) continue;
        const key = t.ti + '|' + m.ident;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ t, m, playerPi: e.pi });
      }
    }
    return found.sort((a, b) => b.t.date.localeCompare(a.t.date) || a.m.ident - b.m.ident);
  }

  function rivalMatchesHtml(entries, opponentUid) {
    const matches = matchesAgainstPlayer(entries, opponentUid);
    return matches.map(({ t, m, playerPi }) =>
      '<div class="rival-match-item"><div class="rival-match-event"><span>' + esc(fmtDate(t.date)) + '</span>' +
      tournamentLink(t) + '<small>' + esc(bracketChipLabel(t)) + '</small></div>' +
      playerMatchHtml(t, m, playerPi) + '</div>'
    ).join('') || '<div class="no-matches">No matches recorded.</div>';
  }

  function viewPlayer(uid) {
    const lifetime = TBC.agg.get(uid);
    const pl = TBC.players.get(uid);
    if (!lifetime || !pl) return viewNotFound();
    if (playerMatchesForUid !== uid) {
      playerMatchesForUid = uid;
      showPlayerMatches = false;
    }
    const a = TBC.aggregatesFor(playersState.v, playersState.ts).get(uid) || {
      uid, entries: [], wins: [], finals: 0, finalWins: 0, finalLosses: 0,
      mw: 0, ml: 0, matches: 0, winRate: 0, events: 0,
      bestWinStreak: 0, currentWinStreak: 0,
      bestEntryStreak: 0, currentEntryStreak: 0,
      bestContinuousWinStreak: 0, currentContinuousWinStreak: 0,
      mates: new Map(), opp: new Map(), first: null, last: null,
    };

    const showDisplay = pl.display.toLowerCase() !== pl.username.toLowerCase();
    const activeText = a.entries.length
      ? 'active ' + esc(fmtDate(a.first)) + ' – ' + esc(fmtDate(a.last))
      : 'no appearances in this selection';
    let html = '<div class="crumb"><a href="#/players">Players</a></div>' +
      '<div class="player-head">' +
      avatarHtml(uid, 'large') +
      '<div><h1>' + esc(pl.username) + '</h1><div class="p-sub">' +
      (showDisplay ? 'display name: ' + esc(pl.display) + ' · ' : '') +
      activeText +
      ' · <a href="https://www.roblox.com/users/' + uid + '/profile" target="_blank" rel="noopener">Roblox profile ↗</a>' +
      '</div></div></div>';

    html += '<div class="filters player-scope"><span class="scope-label">Statistics</span>' +
      scopeFilterHtml(playersState) + '</div>';

    html += '<div class="kpis">' +
      statTile('Wins', num(a.wins.length), 'tournament brackets won', a.wins.length > 0) +
      statTile('Finals record', wlHtml(a.finalWins, a.finalLosses), num(a.finals) + ' actual finals') +
      statTile('Match record', wlHtml(a.mw, a.ml), a.matches ? pct(a.winRate) + ' win rate' : '') +
      statTile('Best streak', num(a.bestWinStreak), 'consecutive bracket wins') +
      statTile('Events', num(a.events), num(a.entries.length) + ' bracket entries') +
      '</div>';

    // Tournament history cards
    const entries = a.entries.slice().sort((x, y) => {
      const tx = TBC.tournaments[x.ti], ty = TBC.tournaments[y.ti];
      return tx.date < ty.date ? 1 : tx.date > ty.date ? -1 : ty.ti - tx.ti;
    });
    let history = '';
    for (const e of entries) {
      const t = TBC.tournaments[e.ti];
      const p = t.parts[e.pi];
      history += '<article class="history-event"><div class="history-summary">' +
        '<span class="history-date">' + esc(fmtDate(t.date)) + '</span>' +
        '<span class="history-title">' + tournamentLink(t) + '<small>' + esc(bracketChipLabel(t)) + '</small>' +
        '<span class="history-context"><span><span class="meta-label">Entry</span>' + entryWithAvatars(p, true) + '</span>' +
        '</span></span>' +
        '<span class="history-record">' + wlHtml(p.w, p.l) + '</span>' +
        '<span class="history-result">' + resultBadge(t, p) + '</span></div>' +
        '<div class="player-matches" data-ti="' + t.ti + '" data-pi="' + e.pi + '"></div></article>';
    }
    html += '<div class="card section history-card"><div class="history-heading"><h2>Tournament history</h2>' +
      '<button class="btn" id="player-matches-toggle" type="button" aria-pressed="' + showPlayerMatches + '">' +
      (showPlayerMatches ? 'Hide all matches' : 'Show all matches') + '</button></div>' +
      '<div class="history-list' + (showPlayerMatches ? ' show-matches' : '') + '">' +
      (history || '<p class="mut">No tournament entries in this selection.</p>') + '</div></div>';

    // teammates + rivals
    const mates = [...a.mates.entries()].map(([v, m]) => ({ v, ...m }))
      .sort((x, y) => y.n - x.n || y.wins - x.wins).slice(0, 12);
    let matesHtml = '<div class="card"><h2>Teammates</h2>';
    if (mates.length) {
      matesHtml += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th class="num">Entries</th><th class="num">Wins</th><th class="num">Team W–L</th></tr></thead><tbody>' +
        mates.map((m) => '<tr><td>' + playerWithAvatar(m.v) + '</td><td class="num">' + m.n + '</td>' +
          '<td class="num">' + (m.wins ? '🏆 ' + m.wins : '–') + '</td><td class="num">' + wlHtml(m.w, m.l) + '</td></tr>').join('') +
        '</tbody></table></div>';
    } else {
      matesHtml += '<p class="mut small">No team entries — 1v1 only.</p>';
    }
    matesHtml += '</div>';

    const rivals = [...a.opp.entries()].map(([v, o]) => ({ v, ...o, n: o.w + o.l }))
      .sort((x, y) => y.n - x.n || y.w - x.w).slice(0, 12);
    let rivalsHtml = '<div class="card"><h2>Most-played opponents</h2>';
    if (rivals.length) {
      rivalsHtml += '<div class="tbl-wrap"><table class="tbl rivals-table"><thead><tr><th>Opponent</th><th class="num">Played</th><th class="num">Record</th><th class="num">Win %</th><th></th></tr></thead><tbody>' +
        rivals.map((r) => '<tr><td>' + playerWithAvatar(r.v) + '</td><td class="num">' + r.n + '</td>' +
          '<td class="num">' + wlHtml(r.w, r.l) + '</td><td class="num">' + pct(r.w / r.n) + '</td>' +
          '<td class="num"><button class="btn btn-small" type="button" data-rival-toggle="' + r.v + '" aria-expanded="false">Show matches</button></td></tr>' +
          '<tr class="rival-detail" data-rival-detail="' + r.v + '" hidden><td colspan="5"><div class="rival-match-content" data-opponent="' + r.v + '"></div></td></tr>').join('') +
        '</tbody></table></div>';
    } else {
      rivalsHtml += '<p class="mut small">No completed matches on record.</p>';
    }
    rivalsHtml += '</div>';

    html += '<div class="grid-2 section">' + matesHtml + rivalsHtml + '</div>';

    render('players', pl.username, html, (root) => {
      wireScopeFilter(root, playersState, () => viewPlayer(uid));
      const toggle = root.querySelector('#player-matches-toggle');
      const list = root.querySelector('.history-list');
      if (toggle && list) toggle.addEventListener('click', () => {
        showPlayerMatches = !showPlayerMatches;
        list.classList.toggle('show-matches', showPlayerMatches);
        toggle.setAttribute('aria-pressed', String(showPlayerMatches));
        toggle.textContent = showPlayerMatches ? 'Hide all matches' : 'Show all matches';
        if (showPlayerMatches) renderPlayerMatchesBatched(list);
        else if (playerMatchObserver) {
          playerMatchObserver.disconnect();
          playerMatchObserver = null;
        }
      });
      root.querySelectorAll('[data-rival-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
          const rival = button.getAttribute('data-rival-toggle');
          const detail = root.querySelector('[data-rival-detail="' + rival + '"]');
          const opening = detail.hasAttribute('hidden');
          if (opening) {
            const content = detail.querySelector('.rival-match-content');
            if (!content.dataset.loaded) {
              content.dataset.loaded = 'true';
              replaceAvatarHtml(content, rivalMatchesHtml(a.entries, Number(rival)));
            }
          }
          detail.toggleAttribute('hidden', !opening);
          button.setAttribute('aria-expanded', String(opening));
          button.textContent = opening ? 'Hide matches' : 'Show matches';
        });
      });
      if (showPlayerMatches && list) renderPlayerMatchesBatched(list);
    });
  }

  /* ---------- players index ---------- */

  const playersState = {
    q: '', sort: 'wins', dir: -1, shown: 100, v: 'all', ts: 'all',
    visible: new Set(['wins', 'finals', 'finalwins', 'finallosses', 'matchwins', 'winrate', 'activity']),
    streakPeriod: 'historical', streakType: 'wins', streakContinuous: false,
  };

  function scopeFilterHtml(state) {
    return '<select id="fl-v">' +
      '<option value="all"' + (state.v === 'all' ? ' selected' : '') + '>TBC1 + TBC2</option>' +
      '<option value="tbc1"' + (state.v === 'tbc1' ? ' selected' : '') + '>TBC1 only</option>' +
      '<option value="tbc2"' + (state.v === 'tbc2' ? ' selected' : '') + '>TBC2 only</option>' +
      '</select>' +
      '<select id="fl-ts">' +
      '<option value="all"' + (state.ts === 'all' ? ' selected' : '') + '>All team sizes</option>' +
      ['1v1', '2v2', '3v3'].map((v) =>
        '<option value="' + v + '"' + (state.ts === v ? ' selected' : '') + '>' + v + ' only</option>').join('') +
      '</select>';
  }

  function wireScopeFilter(root, state, onChange) {
    root.querySelector('#fl-v').addEventListener('change', (e) => { state.v = e.target.value; onChange(); });
    root.querySelector('#fl-ts').addEventListener('change', (e) => { state.ts = e.target.value; onChange(); });
  }

  function streakValue(a) {
    if (playersState.streakType === 'entries') {
      return playersState.streakPeriod === 'current' ? a.currentEntryStreak : a.bestEntryStreak;
    }
    if (playersState.streakContinuous) {
      return playersState.streakPeriod === 'current'
        ? a.currentContinuousWinStreak : a.bestContinuousWinStreak;
    }
    return playersState.streakPeriod === 'current' ? a.currentWinStreak : a.bestWinStreak;
  }

  const PLAYER_COLS = [
    { key: 'name', label: 'Player', get: (a) => playerName(a.uid).toLowerCase(), html: (a) => playerWithAvatar(a.uid), fixed: true },
    { key: 'wins', label: 'Wins', num: true, get: (a) => a.wins.length, html: (a) => (a.wins.length ? '🏆 ' + a.wins.length : '<span class="mut">–</span>') },
    { key: 'streak', label: 'Best streak', num: true, get: streakValue, html: (a) => num(streakValue(a)), title: 'Configured with the streak settings above the table' },
    { key: 'finals', label: 'Finals', num: true, get: (a) => a.finals, html: (a) => num(a.finals), title: 'Actual elimination finals played' },
    { key: 'finalwins', label: 'Final W', num: true, get: (a) => a.finalWins, html: (a) => num(a.finalWins), title: 'Actual elimination finals won' },
    { key: 'finallosses', label: 'Final L', num: true, get: (a) => a.finalLosses, html: (a) => num(a.finalLosses), title: 'Actual elimination finals lost' },
    { key: 'conversion', label: 'Final win %', num: true, get: (a) => a.finals ? a.finalWins / a.finals : -1, html: (a) => a.finals ? pct(a.finalWins / a.finals) : '<span class="mut">–</span>' },
    { key: 'matchwins', label: 'Match W', num: true, get: (a) => a.mw, html: (a) => num(a.mw) },
    { key: 'matchlosses', label: 'Match L', num: true, get: (a) => a.ml, html: (a) => num(a.ml) },
    { key: 'winrate', label: 'Match win %', num: true, get: (a) => a.matches >= 20 ? a.winRate + a.matches / 1e6 : -1, html: (a) => a.matches ? pct(a.winRate) : '<span class="mut">–</span>', title: 'Sorting places players with fewer than 20 matches after qualified players' },
    { key: 'activity', label: 'Entries', num: true, get: (a) => a.entries.length + a.events / 1e4, html: (a) => num(a.entries.length) + (a.entries.length !== a.events ? '<span class="metric-sub">' + num(a.events) + ' events</span>' : ''), title: 'Bracket entries; distinct events shown when the totals differ' },
    { key: 'last', label: 'Last seen', num: true, get: (a) => a.last, html: (a) => '<span class="mut small nowrap">' + esc(fmtDate(a.last)) + '</span>' },
  ];

  function viewPlayers() {
    const html = '<h1>Players</h1>' +
      '<p class="lede">Player index and all-time records. Choose which metrics to compare, then click any column heading to rank the table.</p>' +
      '<div class="filters"><input type="search" id="pl-q" placeholder="Search players…" value="' + esc(playersState.q) + '">' +
      scopeFilterHtml(playersState) +
      '<span class="count" id="pl-count"></span></div>' +
      '<div class="metric-picker"><span>Columns</span>' + PLAYER_COLS.filter((c) => !c.fixed).map((c) =>
        '<button type="button" data-column="' + c.key + '" aria-pressed="' + playersState.visible.has(c.key) + '">' + c.label + '</button>'
      ).join('') + '</div>' +
      '<div class="streak-config" id="streak-config"' + (playersState.visible.has('streak') ? '' : ' hidden') + '>' +
      '<span>Streak settings</span>' +
      '<select id="streak-period" aria-label="Streak period">' +
      '<option value="historical"' + (playersState.streakPeriod === 'historical' ? ' selected' : '') + '>Historical best</option>' +
      '<option value="current"' + (playersState.streakPeriod === 'current' ? ' selected' : '') + '>Current</option></select>' +
      '<select id="streak-type" aria-label="Streak type">' +
      '<option value="wins"' + (playersState.streakType === 'wins' ? ' selected' : '') + '>Win streak</option>' +
      '<option value="entries"' + (playersState.streakType === 'entries' ? ' selected' : '') + '>Entry streak</option></select>' +
      '<label id="streak-continuous-wrap"' + (playersState.streakType === 'wins' ? '' : ' hidden') + '>' +
      '<input id="streak-continuous" type="checkbox"' + (playersState.streakContinuous ? ' checked' : '') + '> Continuous tournaments</label></div>' +
      '<p class="small mut">Finals only count actual elimination final matches; round-robin second place is excluded. Current streaks must include the latest eligible tournament group. Continuous tournaments requires a win in each consecutive group. Match win % sorting requires 20 completed matches.</p>' +
      '<div class="card"><div class="tbl-wrap" id="pl-table"></div>' +
      '<div style="text-align:center;margin-top:12px"><button class="btn" id="pl-more">Show more</button></div></div>';

    render('players', 'Players', html, (root) => {
      const $t = root.querySelector('#pl-table');
      const $count = root.querySelector('#pl-count');
      const $more = root.querySelector('#pl-more');
      const $streakConfig = root.querySelector('#streak-config');
      const $streakContinuousWrap = root.querySelector('#streak-continuous-wrap');

      function draw() {
        const all = [...TBC.aggregatesFor(playersState.v, playersState.ts).values()];
        const q = playersState.q.trim().toLowerCase();
        let rows = all;
        if (q) {
          rows = rows.filter((a) => playerSearchText(a.uid).includes(q));
        }
        const visibleCols = PLAYER_COLS.filter((c) => c.fixed || playersState.visible.has(c.key));
        const col = PLAYER_COLS.find((c) => c.key === playersState.sort) || PLAYER_COLS[1];
        rows = rows.slice().sort((x, y) => {
          const vx = col.get(x), vy = col.get(y);
          const c = vx < vy ? -1 : vx > vy ? 1 : 0;
          return c * playersState.dir || y.mw - x.mw;
        });
        $count.textContent = num(rows.length) + ' players';
        const shown = rows.slice(0, playersState.shown);
        let s = '<table class="tbl"><thead><tr><th class="rank">#</th>' + visibleCols.map((c) =>
          '<th class="sortable' + (c.num ? ' num' : '') + '"' + (c.title ? ' title="' + esc(c.title) + '"' : '') + '><button type="button" data-k="' + c.key + '">' + c.label +
          (playersState.sort === c.key ? ' <span class="arrow">' + (playersState.dir < 0 ? '▼' : '▲') + '</span>' : '') + '</button></th>').join('') +
          '</tr></thead><tbody>';
        shown.forEach((a, i) => {
          s += '<tr><td class="rank">' + (i + 1) + '</td>' + visibleCols.map((c) =>
            '<td' + (c.num ? ' class="num"' : '') + '>' + c.html(a) + '</td>').join('') + '</tr>';
        });
        s += '</tbody></table>';
        replaceAvatarHtml($t, s);
        $more.style.display = rows.length > playersState.shown ? '' : 'none';
        $t.querySelectorAll('th.sortable button').forEach((button) => {
          button.addEventListener('click', () => {
            const k = button.getAttribute('data-k');
            if (playersState.sort === k) playersState.dir *= -1;
            else { playersState.sort = k; playersState.dir = k === 'name' ? 1 : -1; }
            playersState.shown = 100;
            draw();
          });
        });
      }
      root.querySelector('#pl-q').addEventListener('input', (e) => {
        playersState.q = e.target.value;
        playersState.shown = 100;
        draw();
      });
      wireScopeFilter(root, playersState, () => { playersState.shown = 100; draw(); });
      root.querySelector('#streak-period').addEventListener('change', (e) => {
        playersState.streakPeriod = e.target.value;
        playersState.shown = 100;
        draw();
      });
      root.querySelector('#streak-type').addEventListener('change', (e) => {
        playersState.streakType = e.target.value;
        $streakContinuousWrap.hidden = playersState.streakType !== 'wins';
        playersState.shown = 100;
        draw();
      });
      root.querySelector('#streak-continuous').addEventListener('change', (e) => {
        playersState.streakContinuous = e.target.checked;
        playersState.shown = 100;
        draw();
      });
      root.querySelectorAll('[data-column]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.getAttribute('data-column');
          if (playersState.visible.has(key)) {
            playersState.visible.delete(key);
            if (playersState.sort === key) { playersState.sort = 'wins'; playersState.dir = -1; }
          } else {
            playersState.visible.add(key);
          }
          button.setAttribute('aria-pressed', String(playersState.visible.has(key)));
          if (key === 'streak') $streakConfig.hidden = !playersState.visible.has('streak');
          draw();
        });
      });
      $more.addEventListener('click', () => { playersState.shown += 200; draw(); });
      draw();
    });
  }

  /* ---------- 404 ---------- */

  function viewNotFound() {
    render('', 'Not found', '<h1>Page not found</h1><p class="lede">That page doesn\'t exist. Try the <a href="#/">home page</a> or the search box above.</p>');
  }

  /* ================= search ================= */

  const searchIdx = {
    players: [...TBC.players.values()].map((p) => ({
      s: playerSearchText(p.id), p,
    })),
    tournaments: TBC.tournaments.map((t) => ({
      s: (t.title + ' ' + t.slug).toLowerCase(), t,
    })),
  };

  const $search = document.getElementById('search');
  const $results = document.getElementById('search-results');
  let searchSel = -1;

  function runSearch() {
    const q = $search.value.trim().toLowerCase();
    searchSel = -1;
    if (q.length < 2) { $results.classList.remove('open'); return; }
    const score = (s) => (s.startsWith(q) ? 0 : s.includes(' ' + q) ? 1 : s.includes(q) ? 2 : -1);
    const ps = searchIdx.players.map((e) => ({ e, sc: score(e.s) })).filter((x) => x.sc >= 0)
      .sort((a, b) => a.sc - b.sc || a.e.s.length - b.e.s.length).slice(0, 6);
    const ts = searchIdx.tournaments.map((e) => ({ e, sc: score(e.s) })).filter((x) => x.sc >= 0)
      .sort((a, b) => a.sc - b.sc || (a.e.t.date < b.e.t.date ? 1 : -1)).slice(0, 5);
    let s = '';
    if (ps.length) {
      s += '<div class="sr-head">Players</div>' + ps.map(({ e }) => {
        const a = TBC.agg.get(e.p.id);
        const alias = e.p.display.toLowerCase() !== e.p.username.toLowerCase() ? e.p.display + ' · ' : '';
        const currentNames = (e.p.username + ' ' + e.p.display).toLowerCase();
        const entryMatch = !currentNames.includes(q) ? matchingEntryName(e.p.id, q) : null;
        return '<a class="search-player" href="#/p/' + e.p.id + '">' + avatarHtml(e.p.id) +
          '<span><strong>' + esc(e.p.username) + '</strong><span class="sr-sub">' +
          (entryMatch ? 'entered as ' + esc(entryMatch) + ' · ' : '') + esc(alias) +
          (a ? a.entries.length + ' entries' + (a.wins.length ? ' · 🏆 ' + a.wins.length : '') : '') + '</span></span></a>';
      }).join('');
    }
    if (ts.length) {
      s += '<div class="sr-head">Tournaments</div>' + ts.map(({ e }) =>
        '<a href="#/t/' + encodeURIComponent(e.t.slug) + '">' + esc(e.t.title) +
        ' <span class="sr-sub">' + esc(fmtDate(e.t.date)) + '</span></a>').join('');
    }
    replaceAvatarHtml($results, s || '<div class="sr-empty">No matches.</div>');
    $results.classList.add('open');
  }

  function closeSearch() {
    $results.classList.remove('open');
    searchSel = -1;
  }

  $search.addEventListener('input', runSearch);
  $search.addEventListener('focus', runSearch);
  $search.addEventListener('keydown', (e) => {
    const links = [...$results.querySelectorAll('a')];
    if (e.key === 'Escape') { closeSearch(); $search.blur(); return; }
    if (!links.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchSel = e.key === 'ArrowDown'
        ? (searchSel + 1) % links.length
        : (searchSel - 1 + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('sel', i === searchSel));
      links[searchSel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = links[searchSel >= 0 ? searchSel : 0];
      if (target) { location.hash = target.getAttribute('href').slice(1); closeSearch(); $search.value = ''; }
    }
  });
  $results.addEventListener('click', (e) => {
    if (e.target.closest('a')) { closeSearch(); $search.value = ''; }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbox')) closeSearch();
  });

  /* ================= theme ================= */

  document.getElementById('theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tbc-theme', next); } catch (e) { /* private mode */ }
  });

  /* ================= router ================= */

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const seg = hash.split('/').filter(Boolean);
    if (seg.length === 0) return viewHome();
    if (seg[0] === 'events') return viewEvents();
    if (seg[0] === 't' && seg[1]) return viewTournament(decodeURIComponent(seg[1]));
    if (seg[0] === 'p' && seg[1]) return viewPlayer(parseInt(seg[1], 10));
    if (seg[0] === 'players') return viewPlayers();
    if (seg[0] === 'leaderboards') return viewPlayers();
    return viewNotFound();
  }

  window.addEventListener('hashchange', route);

  route();
})();
