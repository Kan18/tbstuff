/* app.js — routing + rendering. Depends on window.TBC from compute.js. */
'use strict';
(function () {
  const TBC = window.TBC;
  const $view = document.getElementById('view');
  const SITE_ROOT = new URL('.', document.currentScript.src).pathname;

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
  function playerHref(uid) {
    const route = TBC.players.get(uid)?.route || String(uid);
    return SITE_ROOT + 'p/' + encodeURIComponent(route) + '/';
  }
  function tournamentHref(t) {
    return SITE_ROOT + 't/' + encodeURIComponent(t.slug) + '/';
  }
  function decodeRouteValue(value) {
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return null;
    }
  }
  function playerIdFromRoute(value) {
    const decoded = decodeRouteValue(value);
    if (decoded == null) return null;
    if (/^\d+$/.test(decoded)) return Number(decoded);
    if (TBC.playersByRoute.has(decoded)) return TBC.playersByRoute.get(decoded).id;
    return TBC.players.has(decoded) ? decoded : null;
  }
  function playerLink(uid) {
    return '<a href="' + playerHref(uid) + '" translate="no">' + esc(playerName(uid)) + '</a>';
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

  let ratingHistoryPromise = null;
  let simulatorSkillHistoryPromise = null;
  let ratingRows = null;
  let peakRatingRows = null;
  let peakRatingSnapshotRows = null;
  function prepareRatingHistory(data) {
    if (ratingRows) return data;
    ratingRows = new Map();
    peakRatingRows = new Map();
    peakRatingSnapshotRows = new Map();
    for (const row of data.players) {
      for (let i = 3; i < row.length; i++) row[i] += row[i - 1];
      ratingRows.set(row[0], row);
      const peaks = row.slice();
      const peakSnapshots = [row[0], row[1], row[1]];
      for (let i = 3; i < peaks.length; i++) {
        if (peaks[i] > peaks[i - 1]) {
          peakSnapshots[i] = row[1] + i - 2;
        } else {
          peaks[i] = peaks[i - 1];
          peakSnapshots[i] = peakSnapshots[i - 1];
        }
      }
      peakRatingRows.set(row[0], peaks);
      peakRatingSnapshotRows.set(row[0], peakSnapshots);
    }
    return data;
  }
  function loadRatingHistory() {
    if (window.TBC_RATING_HISTORY) return Promise.resolve(prepareRatingHistory(window.TBC_RATING_HISTORY));
    if (ratingHistoryPromise) return ratingHistoryPromise;
    ratingHistoryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SITE_ROOT + 'ratings.js';
      script.onload = () => resolve(prepareRatingHistory(window.TBC_RATING_HISTORY));
      script.onerror = () => {
        script.remove();
        ratingHistoryPromise = null;
        reject(new Error('Could not load rating history'));
      };
      document.head.appendChild(script);
    });
    return ratingHistoryPromise;
  }
  function loadSimulatorSkillHistory() {
    if (window.TBC_SIMULATOR_SKILL_HISTORY) return Promise.resolve(window.TBC_SIMULATOR_SKILL_HISTORY);
    if (simulatorSkillHistoryPromise) return simulatorSkillHistoryPromise;
    simulatorSkillHistoryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SITE_ROOT + 'simulator-snapshots.js';
      script.onload = () => resolve(window.TBC_SIMULATOR_SKILL_HISTORY);
      script.onerror = () => {
        script.remove();
        simulatorSkillHistoryPromise = null;
        reject(new Error('Could not load simulator skill history'));
      };
      document.head.appendChild(script);
    });
    return simulatorSkillHistoryPromise;
  }
  function playerWithAvatar(uid) {
    return '<span class="player-ident">' + avatarHtml(uid) + playerLink(uid) + '</span>';
  }
  function memberHtml(m) {
    if (TBC.players.has(m)) return playerLink(m);
    return '<span class="unres" title="Could not be resolved to a Roblox account">' + esc(m) + '</span>';
  }
  function entryHtml(part) {
    const content = part.members.length
      ? part.members.map(memberHtml).join(' <span class="mut">&amp;</span> ')
      : esc(part.name);
    return '<span translate="no">' + content + '</span>';
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
        ? '<a href="' + playerHref(next.member.uid) + '">' + esc(label) + '</a>'
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
      '<span class="entry-text" translate="no">' + originalEntryHtml(part) + '</span></span>';
  }
  function tournamentLink(t, label) {
    return '<a href="' + tournamentHref(t) + '">' + esc(label || t.title) + '</a>';
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

  function matchRoundName(t, m) {
    return m.isGroup
      ? (m.groupName ? m.groupName + ' · ' : '') + 'Round ' + m.round
      : TBC.roundName(t, m.round);
  }

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

  function videosForSide(m, side) {
    return m.videos?.[side] || [];
  }

  function videoButtonHtml(t, m, side, pageButton) {
    const videos = videosForSide(m, side);
    const pi = side === 0 ? m.p1 : m.p2;
    if (!videos.length || pi < 0) return '';
    const participant = t.parts[pi].name;
    const label = 'Watch match video for ' + participant +
      (videos.length > 1 ? ' (' + videos.length + ' parts)' : '');
    return '<button class="' + (pageButton ? 'video-watch' : 'video-open') + '" type="button" ' +
      'data-video-open data-video-tournament="' + esc(t.slug) + '" data-video-match="' + m.key + '" ' +
      'data-video-side="' + side + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<span aria-hidden="true">▶</span>' +
      (pageButton ? '<span>Watch video' + (videos.length > 1 ? ' · ' + videos.length + ' parts' : '') + '</span>' : '') +
      '</button>';
  }

  function cardWidth(t) {
    return t.teamSize === '2v2' || t.teamSize === '3v3' ? TEAM_CARD_W : SOLO_CARD_W;
  }

  function matchPrediction(t, m) {
    const value = MATCH_PREDICTIONS[t.slug]?.[m.key];
    return Number.isFinite(value) ? [value, 10000 - value] : null;
  }

  function roundedProbabilities(prediction) {
    const exact = prediction.map((value) => value / 100);
    const rounded = exact.map(Math.floor);
    let remaining = 100 - rounded[0] - rounded[1];
    const order = [0, 1].sort((a, b) =>
      (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || exact[b] - exact[a]);
    for (let i = 0; i < remaining; i++) rounded[order[i]] += 1;
    return rounded;
  }

  function probabilityAttrs(value, rounded) {
    const exact = (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return ' data-prob="' + rounded + '%" data-prob-exact="' + exact + '%"' +
      (value > 5000 ? ' data-favored="true"' : '');
  }

  function matchRowsHtml(t, m) {
    const junk = junkPair(m.s1, m.s2);
    const prediction = matchPrediction(t, m);
    const rounded = prediction ? roundedProbabilities(prediction) : null;
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
        (pi < 0 ? '' : prediction ? probabilityAttrs(prediction[side], rounded[side]) : ' data-prob="—" data-prob-unavailable="true"') + '>' +
        nameHtml + videoButtonHtml(t, m, side, false) +
        '<span class="mscore">' + scHtml + '</span></div>';
    }).join('');
  }

  function matchCard(t, m, x, y, width) {
    return '<span class="mnum" style="left:' + (x - 31) + 'px;top:' + (y + CARD_H / 2 - 9) + 'px">' +
      (m.ident == null ? '' : m.ident) + '</span>' +
      '<div class="match" style="left:' + x + 'px;top:' + y + 'px;width:' + width + 'px" title="' +
      esc(matchRoundName(t, m)) + '">' + matchRowsHtml(t, m) + '</div>';
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
    const wb = t.matches.filter((m) => !m.isGroup && m.round > 0);
    const lb = t.matches.filter((m) => !m.isGroup && m.round < 0);
    let s = bracketSection(t, wb, lb.length ? 'Winners bracket' : '');
    if (lb.length) {
      s += bracketSection(t, lb, 'Losers bracket');
      s += '<p class="small mut">Teams knocked out of the winners bracket drop into the losers bracket for a second chance.</p>';
    }
    return s;
  }

  function groupStageHtml(t) {
    const names = [...new Set(t.matches.filter((m) => m.isGroup).map((m) => m.groupName || 'Group stage'))];
    if (!names.length) return '';
    const sections = names.map((name) => {
      const matches = t.matches.filter((m) => m.isGroup && (m.groupName || 'Group stage') === name);
      const participantIds = [...new Set(matches.flatMap((m) => [m.p1, m.p2]).filter((pi) => pi >= 0))];
      const stats = new Map(participantIds.map((pi) => [pi, { pi, w: 0, l: 0 }]));
      for (const m of matches) {
        if (m.st !== 0) continue;
        const p1 = stats.get(m.p1), p2 = stats.get(m.p2);
        if (m.w === m.p1) { p1.w += 1; p2.l += 1; }
        else if (m.w === m.p2) { p2.w += 1; p1.l += 1; }
      }
      const order = [...stats.values()].sort((a, b) =>
        b.w - a.w || a.l - b.l || t.parts[a.pi].name.localeCompare(t.parts[b.pi].name));
      let rank = 0;
      let previous = null;
      const rows = order.map((stat, index) => {
        const signature = [stat.w, stat.l].join('|');
        if (signature !== previous) rank = index + 1;
        previous = signature;
        const advanced = t.finalists.has(stat.pi);
        return '<tr><td class="rank">' + rank + '</td><td>' + entryWithAvatars(t.parts[stat.pi], false) + '</td>' +
          '<td class="num">' + stat.w + '</td><td class="num">' + stat.l + '</td>' +
          '<td>' + (advanced ? '<span class="badge b-2">Advanced</span>' : '<span class="badge">Group stage</span>') + '</td></tr>';
      }).join('');
      const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
      const schedule = rounds.map((round) => {
        const roundMatches = matches.filter((m) => m.round === round).sort((a, b) => a.key - b.key);
        return '<section class="rr-round"><h3>Round ' + round + '</h3><div class="rr-match-grid">' +
          roundMatches.map((m) => '<div class="rr-match-wrap"><span class="rr-match-num">' +
            (m.ident == null ? '' : m.ident) + '</span><div class="match rr-match">' +
            matchRowsHtml(t, m) + '</div></div>').join('') + '</div></section>';
      }).join('');
      return '<section class="group-stage-section"><h2>' + esc(name) + '</h2>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="rank">#</th><th>Entry</th>' +
        '<th class="num">W</th><th class="num">L</th><th>Result</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="rr-schedule">' + schedule + '</div></section>';
    }).join('');
    return '<div class="card section group-stage"><h2>Group stage</h2>' + sections + '</div>';
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
    document.title = (title ? title + ' — ' : '') + 'Tower Battles Tournament Archive';
    const currentUrl = location.origin + location.pathname;
    const canonical = document.querySelector('link[rel="canonical"]');
    const openGraphUrl = document.querySelector('meta[property="og:url"]');
    if (canonical) canonical.href = currentUrl;
    if (openGraphUrl) openGraphUrl.content = currentUrl;
    closeVideoModal();
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

  /* ---------- video modal ---------- */

  const $videoModal = document.getElementById('video-modal');
  const $videoModalTitle = document.getElementById('video-modal-title');
  const $videoModalKicker = document.getElementById('video-modal-kicker');
  const $videoParts = document.getElementById('video-parts');
  const $videoEmbed = document.getElementById('video-embed');
  const $videoNote = document.getElementById('video-modal-note');
  const $videoExternal = document.getElementById('video-external');
  let activeModalVideos = [];
  let activeModalParticipant = '';

  function youtubeVideoSource(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') {
        id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        id = parsed.searchParams.get('v') || '';
        if (!id) {
          const path = parsed.pathname.split('/').filter(Boolean);
          if (['embed', 'shorts', 'live'].includes(path[0])) id = path[1] || '';
        }
      }
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const rawStart = parsed.searchParams.get('start') ||
        parsed.searchParams.get('t') || hashParams.get('t') || '';
      let start = 0;
      if (/^\d+$/.test(rawStart)) {
        start = Number(rawStart);
      } else {
        const time = rawStart.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        if (time && rawStart) {
          start = Number(time[1] || 0) * 3600 + Number(time[2] || 0) * 60 + Number(time[3] || 0);
        }
      }
      if (!Number.isSafeInteger(start) || start < 0) start = 0;
      return { id, start };
    } catch (e) {
      return null;
    }
  }

  function clearVideoModal() {
    $videoEmbed.replaceChildren();
    $videoParts.replaceChildren();
    $videoNote.textContent = '';
    $videoNote.hidden = true;
    $videoExternal.removeAttribute('href');
    activeModalVideos = [];
    activeModalParticipant = '';
  }

  function closeVideoModal() {
    if ($videoModal.open) $videoModal.close();
    else clearVideoModal();
  }

  function loadVideoPart(index) {
    const video = activeModalVideos[index];
    if (!video) return;
    const [url, note] = video;
    const source = youtubeVideoSource(url);
    $videoEmbed.replaceChildren();
    if (source) {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(source.id) +
        '?autoplay=1&rel=0' + (source.start ? '&start=' + source.start : '');
      iframe.title = activeModalParticipant + ' match video' +
        (activeModalVideos.length > 1 ? ', part ' + (index + 1) : '');
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      $videoEmbed.appendChild(iframe);
    } else {
      const message = document.createElement('p');
      message.className = 'video-load-error';
      message.textContent = 'This video cannot be embedded. Open it on YouTube instead.';
      $videoEmbed.appendChild(message);
    }
    $videoExternal.href = url;
    $videoNote.textContent = note || '';
    $videoNote.hidden = !note;
    $videoParts.querySelectorAll('button').forEach((button, buttonIndex) => {
      button.setAttribute('aria-pressed', String(buttonIndex === index));
    });
  }

  function openVideoModal(button) {
    const t = TBC.bySlug.get(button.dataset.videoTournament);
    const matchKey = Number(button.dataset.videoMatch);
    const side = Number(button.dataset.videoSide);
    const m = t?.matches.find((item) => item.key === matchKey);
    const pi = m && (side === 0 ? m.p1 : m.p2);
    const videos = m ? videosForSide(m, side) : [];
    if (!t || !m || pi == null || pi < 0 || !videos.length) return;

    activeModalVideos = videos;
    activeModalParticipant = t.parts[pi].name;
    $videoModalTitle.textContent = activeModalParticipant + ' video';
    $videoModalKicker.textContent = t.title + ' · ' + matchRoundName(t, m) + ' · Match ' + m.ident;
    $videoParts.hidden = videos.length < 2;
    if (videos.length > 1) {
      videos.forEach((video, index) => {
        const partButton = document.createElement('button');
        partButton.type = 'button';
        partButton.textContent = 'Part ' + (index + 1);
        partButton.setAttribute('aria-pressed', String(index === 0));
        partButton.addEventListener('click', () => loadVideoPart(index));
        $videoParts.appendChild(partButton);
      });
    }
    if (typeof $videoModal.showModal === 'function') $videoModal.showModal();
    else $videoModal.setAttribute('open', '');
    loadVideoPart(0);
  }

  document.getElementById('video-modal-close').addEventListener('click', closeVideoModal);
  $videoModal.addEventListener('close', clearVideoModal);
  $videoModal.addEventListener('click', (e) => {
    if (e.target === $videoModal) closeVideoModal();
  });
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-video-open]');
    if (button) openVideoModal(button);
  });

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
      statTile('Players', num(TBC.players.size), 'player records') +
      statTile('Matches', num(TBC.totalMatches)) +
      statTile('Team entries', num(TBC.totalEntries)) +
      '</div>';

    let champs = '<div class="card"><h2>Most tournament wins</h2><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th class="rank">#</th><th>Player</th><th class="num">Wins</th><th class="num">Match record</th></tr></thead><tbody>';
    topChamps.forEach((a, i) => {
      champs += '<tr><td class="rank">' + (i + 1) + '</td><td>' + playerWithAvatar(a.uid) + '</td>' +
        '<td class="num">' + a.wins.length + '</td><td class="num">' + wlHtml(a.mw, a.ml) + '</td></tr>';
    });
    champs += '</tbody></table></div><p class="small" style="margin-bottom:0"><a href="' + SITE_ROOT + 'players/">All player records →</a></p></div>';

    let latest = '<div class="card"><h2>Latest events</h2>';
    for (const g of recent) {
      latest += '<div class="event-row"><div class="e-date">' + esc(fmtSpan(g.span)) + '</div>' +
        '<div class="e-title">' + esc(g.title) + '</div><div class="chips">' +
        g.tournaments.map((t) => '<a class="chip accent" href="' + tournamentHref(t) + '">' + esc(bracketChipLabel(t)) + '</a>').join('') +
        '</div></div>';
    }
    latest += '<p class="small" style="margin-bottom:0"><a href="' + SITE_ROOT + 'events/">All events →</a></p></div>';

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
              '<a class="chip accent" href="' + tournamentHref(t) + '">' + esc(bracketChipLabel(t)) + '</a>').join('') + '</div>' +
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

  function overrideEntriesForDisplay(t) {
    if (!t.override) return [];
    const entries = t.override.entries.filter(([kind]) => OVERRIDE_KINDS[kind]);
    const winnerSet = [...new Set(t.winners)].sort((a, b) => a - b);
    const duplicatesChampions = (kind) => {
      const matching = entries.filter(([entryKind]) => entryKind === kind);
      if (!matching.length || matching.some((entry) => entry[3] < 0)) return false;
      const entrySet = [...new Set(matching.map((entry) => entry[3]))].sort((a, b) => a - b);
      return entrySet.length === winnerSet.length &&
        entrySet.every((participant, index) => participant === winnerSet[index]);
    };
    const redundantKinds = new Set(
      ['actual_winner', 'credited_winner'].filter(duplicatesChampions)
    );
    return entries.filter(([kind]) => !redundantKinds.has(kind));
  }

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
    const ms = t.matches.slice().sort((a, b) =>
      Number(a.isGroup) - Number(b.isGroup) ||
      (a.groupName || '').localeCompare(b.groupName || '') ||
      a.round - b.round || a.key - b.key);
    const rows = ms.map((m) => {
      const nameOf = (pi, side) => pi >= 0
        ? '<span class="match-entry-with-video">' + entryWithAvatars(t.parts[pi], true) +
          videoButtonHtml(t, m, side, false) + '</span>'
        : '<span class="mut">' + (m.st === 0 ? '—' : 'TBD') + '</span>';
      const b1 = m.w >= 0 && m.w === m.p1, b2 = m.w >= 0 && m.w === m.p2;
      const scoreCell = m.st !== 0
        ? '<span class="mut">' + esc(m.st === 1 ? 'open' : 'pending') + '</span>'
        : junkPair(m.s1, m.s2) ? '<span class="mut">—</span>'
        : scoreTxt(m.s1) + '–' + scoreTxt(m.s2);
      return '<tr><td class="mut small nowrap">' + esc(matchRoundName(t, m)) + '</td>' +
        '<td' + (b1 ? ' style="font-weight:600"' : '') + '>' + nameOf(m.p1, 0) + '</td>' +
        '<td class="num nowrap">' + scoreCell + '</td>' +
        '<td' + (b2 ? ' style="font-weight:600"' : '') + '>' + nameOf(m.p2, 1) + '</td></tr>';
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

    let html = '<div class="crumb"><a href="' + SITE_ROOT + 'events/">Events</a> / ' + esc(g.title) + '</div>' +
      '<h1>' + esc(t.title) + '</h1>';

    const chips = ['<span class="chip">📅 ' + esc(fmtDate(t.date)) + '</span>',
      '<span class="chip">' + VERSION_LABEL[t.version] + '</span>'];
    if (t.session !== 'unknown') chips.push('<span class="chip">Session ' + t.session + '</span>');
    if (t.bracketKind === 'hunts-bracket') chips.push('<span class="chip">Huntsman bracket</span>');
    if (t.teamSize !== 'unknown') chips.push('<span class="chip">' + t.teamSize + '</span>');
    chips.push('<span class="chip">' +
      esc(t.hasGroups ? 'Groups → ' + (TBC.TYPE_NAMES[t.type] || t.type) : (TBC.TYPE_NAMES[t.type] || t.type)) +
      '</span>');
    chips.push('<span class="chip">' + t.parts.length + ' entries</span>');
    for (const [index, url] of g.documents.entries()) {
      const label = g.documents.length > 1 ? 'Tournament doc ' + (index + 1) + ' ↗' : 'Tournament doc ↗';
      chips.push('<a class="chip" href="' + esc(url) + '" target="_blank" rel="noopener">' + label + '</a>');
    }
    chips.push('<a class="chip" href="' + esc(t.url) + '" target="_blank" rel="noopener">Challonge ↗</a>');
    html += '<div class="chips">' + chips.join('') + '</div>';

    if (g.tournaments.length > 1) {
      html += '<div class="chips" style="margin-top:10px">' + g.tournaments.map((s) =>
        '<a class="chip' + (s === t ? ' cur' : '') + '" href="' + tournamentHref(s) + '">' +
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

    if (t.override || t.noOfficialFinal) {
      const overrideTitle = t.noOfficialFinal ? '⚠️ No official final'
        : t.unplayedFinal ? '⚠️ Final not played'
        : '⚠️ Result adjusted manually';
      html += '<div class="callout"><div class="co-title">' + overrideTitle + '</div>' +
        '<div>' + esc(t.override?.reason || 'No official final or finalists were recorded.') + '</div>';
      const entries = overrideEntriesForDisplay(t);
      if (entries.length) {
        html += '<ul style="margin:6px 0 0;padding-left:20px">' + entries.map(([kind, entry, record]) =>
          '<li><strong>' + OVERRIDE_KINDS[kind] + ':</strong> ' + esc(entry || '') +
          (record ? ' <span class="mut">(' + esc(record) + ')</span>' : '') + '</li>').join('') + '</ul>';
      }
      html += '</div>';
    }

    const predictedMatches = t.matches.filter((m) => Number.isFinite(MATCH_PREDICTIONS[t.slug]?.[m.key])).length;
    if (predictedMatches) {
      html += '<div class="bracket-options"><label class="prediction-toggle" ' +
        'title="Recommended model probabilities">' +
        '<input id="prediction-toggle" type="checkbox"> Predicted win chances</label></div>';
    }

    if (t.type === 'RR') {
      html += rrStandingsHtml(t);
    } else {
      html += groupStageHtml(t);
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
    const entry = (pi, side) => pi >= 0
      ? '<span class="match-entry-with-video">' + entryWithAvatars(t.parts[pi], true) +
        videoButtonHtml(t, m, side, false) + '</span>'
      : '<span class="mut">' + (m.st === 0 ? '—' : 'TBD') + '</span>';
    const score = m.st !== 0
      ? '<span class="mut">' + esc(m.st === 1 ? 'open' : 'pending') + '</span>'
      : junkPair(m.s1, m.s2) ? '<span class="mut">—</span>'
      : scoreTxt(m.s1) + '–' + scoreTxt(m.s2);
    let result = '<span class="badge">—</span>';
    if (m.st === 0 && m.w === playerPi) result = '<span class="badge b-win">W</span>';
    else if (m.st === 0 && m.l === playerPi) result = '<span class="badge b-loss">L</span>';
    return '<div class="player-match-row"><span class="match-round">' + esc(matchRoundName(t, m)) + '</span>' +
      '<span class="match-entry' + (m.w === m.p1 ? ' won' : '') + '">' + entry(m.p1, 0) + '</span>' +
      '<span class="match-score">' + score + '</span>' +
      '<span class="match-entry' + (m.w === m.p2 ? ' won' : '') + '">' + entry(m.p2, 1) + '</span>' +
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
        const key = t.ti + '|' + m.key;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ t, m, playerPi: e.pi });
      }
    }
    return found.sort((a, b) => b.t.date.localeCompare(a.t.date) || a.m.key - b.m.key);
  }

  function rivalMatchesHtml(entries, opponentUid) {
    const matches = matchesAgainstPlayer(entries, opponentUid);
    return matches.map(({ t, m, playerPi }) =>
      '<div class="rival-match-item"><div class="rival-match-event"><span>' + esc(fmtDate(t.date)) + '</span>' +
      tournamentLink(t) + '<small>' + esc(bracketChipLabel(t)) + '</small></div>' +
      playerMatchHtml(t, m, playerPi) + '</div>'
    ).join('') || '<div class="no-matches">No matches recorded.</div>';
  }

  function playerRatingChartHtml(data, uid) {
    const row = ratingRows?.get(uid);
    const heading = '<div class="rating-chart-head"><h2>Estimated rating</h2>';
    if (!row || row.length < 3) {
      return heading + '</div><p class="mut small">No estimated rating history available.</p>';
    }

    const start = row[1];
    const values = row.slice(2);
    const groupsById = new Map(TBC.groups.map((group) => [group.id, group]));
    const playedGroups = TBC.agg.get(uid)?.groupsSet || new Set();
    const snapshots = values.map((value, index) => ({
      value,
      snapshot: data.snapshots[start + index],
    })).filter((point) => point.snapshot).map((point) => {
      const group = groupsById.get(point.snapshot[0]);
      return {
        ...point,
        group,
        time: Date.parse(point.snapshot[1] + 'T00:00:00Z'),
        played: group ? playedGroups.has(group.idx) : false,
      };
    });
    if (!snapshots.length) {
      return heading + '</div><p class="mut small">No estimated rating history available.</p>';
    }

    const width = 900, height = 270;
    const left = 54, right = 18, top = 18, bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const valuesOnly = snapshots.map((point) => point.value);
    const current = valuesOnly[valuesOnly.length - 1];
    const peak = Math.max(...valuesOnly);
    const peakIndex = valuesOnly.indexOf(peak);
    const padding = Math.max(25, (peak - Math.min(...valuesOnly)) * 0.12);
    let yMin = Math.floor((Math.min(...valuesOnly) - padding) / 50) * 50;
    let yMax = Math.ceil((peak + padding) / 50) * 50;
    if (yMin === yMax) { yMin -= 50; yMax += 50; }
    const timeMin = snapshots[0].time;
    const timeMax = snapshots[snapshots.length - 1].time;
    const xForTime = (time) => left + (timeMin === timeMax ? plotWidth / 2
      : (time - timeMin) * plotWidth / (timeMax - timeMin));
    const x = (index) => xForTime(snapshots[index].time);
    const y = (value) => top + (yMax - value) * plotHeight / (yMax - yMin);

    let grid = '';
    for (let index = 0; index <= 4; index++) {
      const yy = top + index * plotHeight / 4;
      const value = Math.round(yMax - index * (yMax - yMin) / 4);
      grid += '<line class="rating-grid-line" x1="' + left + '" y1="' + yy +
        '" x2="' + (width - right) + '" y2="' + yy + '"></line>' +
        '<text class="rating-axis-label" x="' + (left - 9) + '" y="' + (yy + 4) +
        '" text-anchor="end">' + value + '</text>';
    }

    const firstYear = new Date(timeMin).getUTCFullYear();
    const lastYear = new Date(timeMax).getUTCFullYear();
    const yearTicks = [{ year: firstYear, time: timeMin }];
    for (let year = firstYear + 1; year <= lastYear; year++) {
      const time = Date.parse(year + '-01-01T00:00:00Z');
      if (time <= timeMax) yearTicks.push({ year, time });
    }
    for (const tick of yearTicks) {
      const xx = xForTime(tick.time);
      grid += '<line class="rating-grid-line vertical" x1="' + xx + '" y1="' + top +
        '" x2="' + xx + '" y2="' + (height - bottom) + '"></line>' +
        '<text class="rating-axis-label" x="' + xx + '" y="' + (height - 13) +
        '" text-anchor="middle">' + tick.year + '</text>';
    }

    const line = snapshots.map((point, index) =>
      (index ? 'L' : 'M') + x(index).toFixed(2) + ' ' + y(point.value).toFixed(2)
    ).join(' ');
    const area = line + ' L' + x(snapshots.length - 1).toFixed(2) + ' ' +
      (height - bottom) + ' L' + x(0).toFixed(2) + ' ' + (height - bottom) + ' Z';
    const currentDate = snapshots[snapshots.length - 1].snapshot[1];
    const peakDate = snapshots[peakIndex].snapshot[1];
    const summary = '<span class="rating-chart-summary">Current <strong>' + current +
      '</strong><span>·</span> Peak <strong>' + peak + '</strong> on ' +
      esc(fmtDate(peakDate)) + '</span></div>';
    const points = snapshots.map((point, index) => {
      const groupLabel = 'Group ' + point.snapshot[0] +
        (point.group ? ' · ' + point.group.title : '');
      return '<circle class="rating-point ' + (point.played ? 'played' : 'not-played') +
        '" data-rating-point data-x="' + x(index) + '" data-y="' + y(point.value) +
        '" data-rating="' + point.value +
        '" data-group="' + esc(groupLabel) + '" data-date="' +
        esc(fmtDate(point.snapshot[1])) + '" data-played="' + point.played +
        '" cx="' + x(index) + '" cy="' + y(point.value) + '" r="2.5"></circle>';
    }).join('');
    const svg = '<div class="rating-chart-scroll"><div class="rating-chart-stage">' +
      '<svg class="rating-chart" viewBox="0 0 ' + width + ' ' + height +
      '" role="img" aria-label="Estimated rating history for ' +
      esc(playerName(uid)) + '"><title>Estimated rating history for ' +
      esc(playerName(uid)) + '</title>' + grid +
      '<path class="rating-area" d="' + area + '"></path>' +
      '<path class="rating-line" d="' + line + '"></path>' +
      points +
      '<circle class="rating-peak" cx="' + x(peakIndex) + '" cy="' + y(peak) +
      '" r="4"><title>Peak ' + peak + ' · ' + esc(fmtDate(peakDate)) + '</title></circle>' +
      '<circle class="rating-current" cx="' + x(snapshots.length - 1) + '" cy="' + y(current) +
      '" r="4"><title>Current ' + current + ' · ' + esc(fmtDate(currentDate)) + '</title></circle>' +
      '<rect class="rating-hit-area" data-rating-hit x="' + left + '" y="' + top +
      '" width="' + plotWidth + '" height="' + plotHeight + '"></rect></svg>' +
      '<div class="rating-tooltip" data-rating-tooltip hidden>' +
      '<strong></strong><span></span><small></small></div></div></div>';
    return heading + summary + svg +
      '<p class="rating-chart-note">Estimated Elo after each tournament group · all team sizes. ' +
      'Hover over the chart to inspect events; filled points indicate participation.</p>';
  }

  function wirePlayerRatingChart(container) {
    const svg = container.querySelector('.rating-chart');
    const hitArea = container.querySelector('[data-rating-hit]');
    const tooltip = container.querySelector('[data-rating-tooltip]');
    const points = [...container.querySelectorAll('[data-rating-point]')];
    if (!svg || !hitArea || !tooltip || !points.length) return;
    let activePoint = null;

    function clearActivePoint() {
      if (activePoint) {
        activePoint.classList.remove('active');
        activePoint.setAttribute('r', '2.5');
        activePoint = null;
      }
    }

    hitArea.addEventListener('pointerenter', () => {
      container.classList.add('chart-hovering');
    });
    hitArea.addEventListener('pointermove', (event) => {
      const bounds = svg.getBoundingClientRect();
      const viewX = (event.clientX - bounds.left) * 900 / bounds.width;
      const viewY = (event.clientY - bounds.top) * 270 / bounds.height;
      let nearest = points[0];
      let distance = Math.hypot(
        Number(nearest.dataset.x) - viewX,
        Number(nearest.dataset.y) - viewY
      );
      for (let index = 1; index < points.length; index++) {
        const candidateDistance = Math.hypot(
          Number(points[index].dataset.x) - viewX,
          Number(points[index].dataset.y) - viewY
        );
        if (candidateDistance < distance) {
          nearest = points[index];
          distance = candidateDistance;
        }
      }
      if (nearest !== activePoint) {
        clearActivePoint();
        activePoint = nearest;
        activePoint.classList.add('active');
        activePoint.setAttribute('r', '5');
      }

      tooltip.querySelector('strong').textContent = 'Rating ' + nearest.dataset.rating;
      tooltip.querySelector('span').textContent = nearest.dataset.group;
      tooltip.querySelector('small').textContent = nearest.dataset.date + ' · ' +
        (nearest.dataset.played === 'true' ? 'Played' : 'Did not play');
      const pointBounds = nearest.getBoundingClientRect();
      const pointCenter = pointBounds.left + pointBounds.width / 2;
      tooltip.style.left = Math.max(120, Math.min(window.innerWidth - 120, pointCenter)) + 'px';
      tooltip.style.top = Math.max(12, pointBounds.top - 8) + 'px';
      tooltip.hidden = false;
    });
    hitArea.addEventListener('pointerleave', () => {
      container.classList.remove('chart-hovering');
      tooltip.hidden = true;
      clearActivePoint();
    });
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
      ? 'active ' + esc(fmtDate(a.first)) + (a.first === a.last ? '' : ' – ' + esc(fmtDate(a.last)))
      : 'no appearances in this selection';
    const profileText = typeof uid === 'number'
      ? ' · <a href="https://www.roblox.com/users/' + uid + '/profile" target="_blank" rel="noopener">Roblox profile ↗</a>'
      : ' · Roblox account unresolved';
    let html = '<div class="crumb"><a href="' + SITE_ROOT + 'players/">Players</a></div>' +
      '<div class="player-head">' +
      avatarHtml(uid, 'large') +
      '<div><h1 translate="no">' + esc(pl.username) + '</h1><div class="p-sub">' +
      (showDisplay ? 'display name: <span translate="no">' + esc(pl.display) + '</span> · ' : '') +
      activeText +
      profileText +
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
        rivals.map((r) => { const rivalKey = encodeURIComponent(String(r.v)); return '<tr><td>' + playerWithAvatar(r.v) + '</td><td class="num">' + r.n + '</td>' +
          '<td class="num">' + wlHtml(r.w, r.l) + '</td><td class="num">' + pct(r.w / r.n) + '</td>' +
          '<td class="num"><button class="btn btn-small" type="button" data-rival-toggle="' + rivalKey + '" aria-expanded="false">Show matches</button></td></tr>' +
          '<tr class="rival-detail" data-rival-detail="' + rivalKey + '" hidden><td colspan="5"><div class="rival-match-content" data-opponent="' + rivalKey + '"></div></td></tr>'; }).join('') +
        '</tbody></table></div>';
    } else {
      rivalsHtml += '<p class="mut small">No completed matches on record.</p>';
    }
    rivalsHtml += '</div>';

    html += '<div class="grid-2 section">' + matesHtml + rivalsHtml + '</div>';
    html += '<div class="card section rating-chart-card" id="player-rating-chart">' +
      '<div class="rating-chart-head"><h2>Estimated rating</h2>' +
      '<span class="mut small">Loading rating history…</span></div></div>';

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
              replaceAvatarHtml(content, rivalMatchesHtml(a.entries, playerIdFromRoute(rival)));
            }
          }
          detail.toggleAttribute('hidden', !opening);
          button.setAttribute('aria-expanded', String(opening));
          button.textContent = opening ? 'Hide matches' : 'Show matches';
        });
      });
      if (showPlayerMatches && list) renderPlayerMatchesBatched(list);
      const ratingChart = root.querySelector('#player-rating-chart');
      loadRatingHistory().then((data) => {
        if (ratingChart.isConnected) {
          ratingChart.innerHTML = playerRatingChartHtml(data, uid);
          wirePlayerRatingChart(ratingChart);
        }
      }).catch(() => {
        if (ratingChart.isConnected) {
          ratingChart.innerHTML = '<div class="rating-chart-head"><h2>Estimated rating</h2></div>' +
            '<p class="mut small">Rating history could not be loaded.</p>';
        }
      });
    });
  }

  /* ---------- players index ---------- */

  const playersState = {
    q: '', sort: 'wins', dir: -1, shown: 100, v: 'all', ts: 'all',
    visible: new Set(['wins', 'finals', 'finalwins', 'finallosses', 'matchwins', 'winrate', 'activity']),
    streakPeriod: 'historical', streakType: 'wins', streakContinuous: false,
    ratingSnapshot: null,
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

  function ratingSeriesValue(rows, uid) {
    if (!rows || playersState.ratingSnapshot == null) return null;
    const row = rows.get(uid);
    if (!row) return null;
    const offset = playersState.ratingSnapshot - row[1];
    return offset < 0 || offset >= row.length - 2 ? null : row[offset + 2];
  }

  function ratingValue(uid) {
    return ratingSeriesValue(ratingRows, uid);
  }

  function peakRatingValue(uid) {
    return ratingSeriesValue(peakRatingRows, uid);
  }

  function peakRatingSnapshot(uid) {
    return ratingSeriesValue(peakRatingSnapshotRows, uid);
  }

  function peakRatingHtml(uid) {
    const value = peakRatingValue(uid);
    const snapshotIndex = peakRatingSnapshot(uid);
    if (value == null || snapshotIndex == null) return '<span class="mut">–</span>';
    const snapshot = window.TBC_RATING_HISTORY?.snapshots[snapshotIndex];
    return String(value) + (snapshot
      ? '<span class="metric-sub">' + esc(fmtDate(snapshot[1])) + '</span>'
      : '');
  }

  function ratingColumnsVisible() {
    return playersState.visible.has('rating') || playersState.visible.has('peakrating');
  }

  function ratingsAvailableForScope() {
    return playersState.v !== 'tbc2' && playersState.ts === 'all';
  }

  function selectedRatingGroupIdx() {
    if (!window.TBC_RATING_HISTORY || playersState.ratingSnapshot == null) return null;
    const snapshot = window.TBC_RATING_HISTORY.snapshots[playersState.ratingSnapshot];
    const group = snapshot && TBC.groups.find((item) => item.id === snapshot[0]);
    return group ? group.idx : null;
  }

  function compareRatioDesc(xNumerator, xDenominator, yNumerator, yDenominator) {
    if (!xDenominator && !yDenominator) return 0;
    if (!xDenominator) return 1;
    if (!yDenominator) return -1;
    return yNumerator * xDenominator - xNumerator * yDenominator;
  }

  function defaultPlayerCompare(x, y, oneVOneAggregates) {
    let difference = y.wins.length - x.wins.length;
    if (difference) return difference;

    if (x.wins.length) {
      difference = y.mw - x.mw;
      if (difference) return difference;
      difference = compareRatioDesc(
        x.wins.length, x.entries.length, y.wins.length, y.entries.length);
      if (difference) return difference;
      difference = y.finals - x.finals;
      if (difference) return difference;
      difference = compareRatioDesc(x.finalWins, x.finals, y.finalWins, y.finals);
      if (difference) return difference;
      difference = y.topFour - x.topFour;
      if (difference) return difference;
      difference = compareRatioDesc(x.topFour, x.entries.length, y.topFour, y.entries.length);
      if (difference) return difference;
      const x1v1 = oneVOneAggregates.get(x.uid);
      const y1v1 = oneVOneAggregates.get(y.uid);
      difference = compareRatioDesc(
        x1v1?.mw || 0, x1v1?.matches || 0, y1v1?.mw || 0, y1v1?.matches || 0);
      if (difference) return difference;
      difference = x.entries.length - y.entries.length;
      if (difference) return difference;
    } else {
      difference = x.bestPlacement - y.bestPlacement;
      if (difference) return difference;
      difference = y.mw - x.mw;
      if (difference) return difference;
      difference = y.finals - x.finals;
      if (difference) return difference;
      difference = y.topFour - x.topFour;
      if (difference) return difference;
      difference = compareRatioDesc(x.mw, x.matches, y.mw, y.matches);
      if (difference) return difference;
      difference = x.entries.length - y.entries.length;
      if (difference) return difference;
    }

    return playerName(x.uid).localeCompare(playerName(y.uid), undefined, { sensitivity: 'base' });
  }

  const PLAYER_COLS = [
    { key: 'name', label: 'Player', get: (a) => playerName(a.uid).toLowerCase(), html: (a) => playerWithAvatar(a.uid), fixed: true },
    { key: 'wins', label: 'Wins', num: true, get: (a) => a.wins.length, html: (a) => (a.wins.length ? '🏆 ' + a.wins.length : '<span class="mut">–</span>'), title: 'Default descending sort uses the full tournament ranking hierarchy' },
    { key: 'streak', label: 'Best streak', num: true, get: streakValue, html: (a) => num(streakValue(a)), title: 'Configured with the streak settings above the table' },
    { key: 'finals', label: 'Finals', num: true, get: (a) => a.finals, html: (a) => num(a.finals), title: 'Actual elimination finals played' },
    { key: 'finalwins', label: 'Final W', num: true, get: (a) => a.finalWins, html: (a) => num(a.finalWins), title: 'Actual elimination finals won' },
    { key: 'finallosses', label: 'Final L', num: true, get: (a) => a.finalLosses, html: (a) => num(a.finalLosses), title: 'Actual elimination finals lost' },
    { key: 'conversion', label: 'Final win %', num: true, get: (a) => a.finals ? a.finalWins / a.finals : -1, html: (a) => a.finals ? pct(a.finalWins / a.finals) : '<span class="mut">–</span>' },
    { key: 'matchwins', label: 'Match W', num: true, get: (a) => a.mw, html: (a) => num(a.mw) },
    { key: 'matchlosses', label: 'Match L', num: true, get: (a) => a.ml, html: (a) => num(a.ml) },
    { key: 'winrate', label: 'Match win %', num: true, get: (a) => a.matches >= 20 ? a.winRate + a.matches / 1e6 : -1, html: (a) => a.matches ? pct(a.winRate) : '<span class="mut">–</span>', title: 'Sorting places players with fewer than 20 matches after qualified players' },
    { key: 'activity', label: 'Entries', num: true, get: (a) => a.entries.length + a.events / 1e4, html: (a) => num(a.entries.length) + (a.entries.length !== a.events ? '<span class="metric-sub">' + num(a.events) + ' events</span>' : ''), title: 'Bracket entries; distinct events shown when the totals differ' },
    { key: 'rating', label: 'Estimated rating', num: true, get: (a) => ratingValue(a.uid) ?? -Infinity, html: (a) => { const value = ratingValue(a.uid); return value == null ? '<span class="mut">–</span>' : String(value); }, title: 'Estimated Elo rating after the selected tournament group' },
    { key: 'peakrating', label: 'Peak rating', num: true, get: (a) => peakRatingValue(a.uid) ?? -Infinity, html: (a) => peakRatingHtml(a.uid), title: 'Highest estimated Elo rating through the selected tournament group; date first reached shown below' },
    { key: 'last', label: 'Last seen', num: true, get: (a) => a.last, html: (a) => '<span class="mut small nowrap">' + esc(fmtDate(a.last)) + '</span>' },
  ];

  function viewPlayers() {
    if (!ratingsAvailableForScope() && ratingColumnsVisible()) {
      playersState.visible.delete('rating');
      playersState.visible.delete('peakrating');
      if (playersState.sort === 'rating' || playersState.sort === 'peakrating') {
        playersState.sort = 'wins'; playersState.dir = -1;
      }
    }
    const html = '<h1>Players</h1>' +
      '<div class="filters"><input type="search" id="pl-q" placeholder="Search players…" value="' + esc(playersState.q) + '">' +
      scopeFilterHtml(playersState) +
      '<span class="count" id="pl-count"></span></div>' +
      '<div class="metric-picker"><span>Columns</span>' + PLAYER_COLS.filter((c) => !c.fixed).map((c) =>
        '<button type="button" data-column="' + c.key + '" aria-pressed="' + playersState.visible.has(c.key) + '"' +
        ((c.key === 'rating' || c.key === 'peakrating') && !ratingsAvailableForScope() ? ' disabled title="Ratings are only available for all team sizes and are unavailable for TBC2-only statistics"' : '') + '>' + c.label + '</button>'
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
      '<div class="rating-config" id="rating-config"' + (ratingColumnsVisible() ? '' : ' hidden') + '>' +
      '<div class="rating-config-head"><span>Statistics snapshot</span><output id="rating-snapshot-label">Loading rating history…</output></div>' +
      '<input id="rating-snapshot" type="range" min="0" max="0" value="0" disabled aria-label="Statistics tournament group"></div>' +
      '<p class="small mut">Finals only count actual elimination final matches; round-robin second place is excluded. Match win % sorting requires 20 completed matches.</p>' +
      '<div class="card"><div class="tbl-wrap" id="pl-table"></div>' +
      '<div class="player-list-actions"><button class="btn" id="pl-more">Show more</button>' +
      '<button class="btn" id="pl-all">Show all</button></div></div>';

    render('players', 'Players', html, (root) => {
      const $t = root.querySelector('#pl-table');
      const $count = root.querySelector('#pl-count');
      const $more = root.querySelector('#pl-more');
      const $all = root.querySelector('#pl-all');
      const $streakConfig = root.querySelector('#streak-config');
      const $streakContinuousWrap = root.querySelector('#streak-continuous-wrap');
      const $ratingConfig = root.querySelector('#rating-config');
      const $ratingSlider = root.querySelector('#rating-snapshot');
      const $ratingLabel = root.querySelector('#rating-snapshot-label');
      let ratingDrawTimer = 0;

      function updateRatingLabel(data) {
        const snapshot = data.snapshots[playersState.ratingSnapshot];
        if (!snapshot) return;
        const group = TBC.groups.find((item) => item.id === snapshot[0]);
        $ratingLabel.textContent = fmtDate(snapshot[1]) + ' · Group ' + snapshot[0] +
          (group ? ' · ' + group.title : '');
      }

      function enableRatings() {
        $ratingSlider.disabled = true;
        $ratingLabel.textContent = 'Loading rating history…';
        loadRatingHistory().then((data) => {
          if (!$ratingConfig.isConnected) return;
          if (playersState.ratingSnapshot == null || playersState.ratingSnapshot >= data.snapshots.length) {
            playersState.ratingSnapshot = data.snapshots.length - 1;
          }
          $ratingSlider.max = String(data.snapshots.length - 1);
          $ratingSlider.value = String(playersState.ratingSnapshot);
          $ratingSlider.disabled = false;
          updateRatingLabel(data);
          draw();
        }).catch(() => {
          if ($ratingConfig.isConnected) $ratingLabel.textContent = 'Rating history could not be loaded.';
        });
      }

      function draw() {
        const cutoff = ratingColumnsVisible() && ratingsAvailableForScope()
          ? selectedRatingGroupIdx() : null;
        const all = [...TBC.aggregatesFor(playersState.v, playersState.ts, cutoff).values()];
        const oneVOneAggregates = TBC.aggregatesFor(playersState.v, '1v1', cutoff);
        const q = playersState.q.trim().toLowerCase();
        let rows = all;
        if (q) {
          rows = rows.filter((a) => playerSearchText(a.uid).includes(q));
        }
        const visibleCols = PLAYER_COLS.filter((c) => c.fixed || playersState.visible.has(c.key));
        const col = PLAYER_COLS.find((c) => c.key === playersState.sort) || PLAYER_COLS[1];
        rows = rows.slice().sort((x, y) => {
          if (playersState.sort === 'wins' && playersState.dir < 0) {
            return defaultPlayerCompare(x, y, oneVOneAggregates);
          }
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
        const hasMore = rows.length > playersState.shown;
        $more.style.display = hasMore ? '' : 'none';
        $all.style.display = hasMore ? '' : 'none';
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
      wireScopeFilter(root, playersState, () => {
        if (!ratingsAvailableForScope() && ratingColumnsVisible()) {
          playersState.visible.delete('rating');
          playersState.visible.delete('peakrating');
          if (playersState.sort === 'rating' || playersState.sort === 'peakrating') {
            playersState.sort = 'wins'; playersState.dir = -1;
          }
        }
        playersState.shown = 100;
        viewPlayers();
      });
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
      $ratingSlider.addEventListener('input', (e) => {
        playersState.ratingSnapshot = Number(e.target.value);
        if (window.TBC_RATING_HISTORY) updateRatingLabel(window.TBC_RATING_HISTORY);
        clearTimeout(ratingDrawTimer);
        ratingDrawTimer = setTimeout(draw, 35);
      });
      $ratingSlider.addEventListener('change', () => {
        clearTimeout(ratingDrawTimer);
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
          if (key === 'rating' || key === 'peakrating') {
            $ratingConfig.hidden = !ratingColumnsVisible();
            if (ratingColumnsVisible()) enableRatings();
          }
          draw();
        });
      });
      $more.addEventListener('click', () => { playersState.shown += 200; draw(); });
      $all.addEventListener('click', () => { playersState.shown = Number.MAX_SAFE_INTEGER; draw(); });
      draw();
      if (ratingColumnsVisible()) enableRatings();
    });
  }

  /* ---------- bracket simulator ---------- */

  const simulatorState = {
    mode: '1v1',
    bracket: 'main',
    trials: 10000,
    entries: { '1v1': [], '2v2': [] },
    drawMode: { '1v1': 'random', '2v2': 'random' },
    originalBrackets: { '1v1': null, '2v2': null },
    useOriginalBracket: { '1v1': false, '2v2': false },
    skillSnapshot: null,
  };
  let simulatorModels = null;
  let currentSimulatorModels = null;

  function simulatorPlayerMatches(query, excluded) {
    const value = query.trim().toLowerCase();
    if (value.length < 2) return [];
    const score = (text) => text.startsWith(value) ? 0 : text.includes(' ' + value) ? 1 : text.includes(value) ? 2 : -1;
    return [...TBC.players.values()].map((player) => ({
      player,
      score: score(playerSearchText(player.id)),
    })).filter((item) => item.score >= 0 && !excluded.has(item.player.id))
      .sort((left, right) => left.score - right.score ||
        left.player.username.length - right.player.username.length ||
        left.player.username.localeCompare(right.player.username))
      .slice(0, 8)
      .map((item) => item.player);
  }

  function simulatorPickerHtml(id, label) {
    return '<label class="simulator-picker"><span class="simulator-label">' + esc(label) + '</span>' +
      '<input id="' + id + '" type="search" placeholder="Search players…" autocomplete="off" spellcheck="false" ' +
      'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-results">' +
      '<div class="simulator-picker-results" id="' + id + '-results" role="listbox"></div></label>';
  }

  function wireSimulatorPicker(root, id, excludedPlayers, onSelect, onEdit) {
    const input = root.querySelector('#' + id);
    const results = root.querySelector('#' + id + '-results');
    let matches = [];
    let selectedIndex = -1;

    function close() {
      results.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      selectedIndex = -1;
    }

    function choose(index) {
      const player = matches[index];
      if (!player) return;
      input.value = player.username;
      close();
      onSelect(player.id);
    }

    function draw() {
      matches = simulatorPlayerMatches(input.value, excludedPlayers());
      selectedIndex = -1;
      if (input.value.trim().length < 2) {
        close();
        return;
      }
      const query = input.value.trim().toLowerCase();
      const html = matches.map((player, index) => {
        const alias = player.display.toLowerCase() !== player.username.toLowerCase() ? player.display : '';
        const currentNames = (player.username + ' ' + player.display).toLowerCase();
        const entryMatch = !currentNames.includes(query) ? matchingEntryName(player.id, query) : null;
        const detail = entryMatch
          ? 'entered as <span translate="no">' + esc(entryMatch) + '</span>'
          : alias ? '<span translate="no">' + esc(alias) + '</span>' : '';
        return '<button type="button" data-picker-index="' + index + '" role="option" id="' + id + '-option-' + index + '" ' +
          'aria-selected="false">' + avatarHtml(player.id) + '<span><strong translate="no">' + esc(player.username) +
          '</strong>' + (detail ? '<span class="sr-sub">' + detail + '</span>' : '') + '</span></button>';
      }).join('');
      replaceAvatarHtml(results, html || '<div class="sr-empty">No available players.</div>');
      results.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', () => {
      if (onEdit) onEdit();
      draw();
    });
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(close));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { close(); input.blur(); return; }
      if (!matches.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = event.key === 'ArrowDown'
          ? (selectedIndex + 1) % matches.length
          : (selectedIndex - 1 + matches.length) % matches.length;
        results.querySelectorAll('[role="option"]').forEach((option, index) => {
          const selected = index === selectedIndex;
          option.classList.toggle('sel', selected);
          option.setAttribute('aria-selected', String(selected));
        });
        input.setAttribute('aria-activedescendant', id + '-option-' + selectedIndex);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(selectedIndex >= 0 ? selectedIndex : 0);
      }
    });
    results.addEventListener('mousedown', (event) => event.preventDefault());
    results.addEventListener('click', (event) => {
      const button = event.target.closest('[data-picker-index]');
      if (button) choose(Number(button.dataset.pickerIndex));
    });
    return {
      clear() { input.value = ''; close(); input.focus(); },
    };
  }

  function simulatorTournamentMatches(query) {
    const value = query.trim().toLowerCase();
    if (value.length < 2) return [];
    const score = (text) => text.startsWith(value) ? 0 : text.includes(' ' + value) ? 1 : text.includes(value) ? 2 : -1;
    return TBC.tournaments.map((tournament) => ({
      tournament,
      score: score((tournament.title + ' ' + tournament.slug).toLowerCase()),
    })).filter((item) => item.score >= 0 && item.tournament.teamSize === simulatorState.mode &&
      item.tournament.parts.some((part) => part.members.length === Number(simulatorState.mode[0])))
      .sort((left, right) => left.score - right.score ||
        right.tournament.date.localeCompare(left.tournament.date) ||
        left.tournament.title.localeCompare(right.tournament.title))
      .slice(0, 8)
      .map((item) => item.tournament);
  }

  function simulatorTournamentPickerHtml() {
    return '<label class="simulator-picker simulator-import-picker"><span class="simulator-label">Import previous session</span>' +
      '<input id="simulator-import-search" type="search" placeholder="Search past tournaments…" autocomplete="off" ' +
      'spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" ' +
      'aria-controls="simulator-import-results"><div class="simulator-picker-results" id="simulator-import-results" ' +
      'role="listbox"></div></label>';
  }

  function wireSimulatorTournamentPicker(root, onSelect) {
    const input = root.querySelector('#simulator-import-search');
    const results = root.querySelector('#simulator-import-results');
    let matches = [];
    let selectedIndex = -1;

    function close() {
      results.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      selectedIndex = -1;
    }

    function choose(index) {
      const tournament = matches[index];
      if (!tournament) return;
      input.value = tournament.title;
      close();
      onSelect(tournament);
    }

    function draw() {
      matches = simulatorTournamentMatches(input.value);
      selectedIndex = -1;
      if (input.value.trim().length < 2) {
        close();
        return;
      }
      results.innerHTML = matches.map((tournament, index) =>
        '<button type="button" class="simulator-tournament-option" data-tournament-index="' + index + '" role="option" ' +
        'id="simulator-import-option-' + index + '" aria-selected="false"><span><strong>' + esc(tournament.title) +
        '</strong><span class="sr-sub">' + esc(fmtDate(tournament.date)) + ' · ' +
        esc(bracketChipLabel(tournament)) + ' · ' + tournament.parts.length + ' entries</span></span></button>'
      ).join('') || '<div class="sr-empty">No matching ' + simulatorState.mode + ' brackets.</div>';
      results.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', () => { onSelect(null); draw(); });
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(close));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { close(); input.blur(); return; }
      if (!matches.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = event.key === 'ArrowDown'
          ? (selectedIndex + 1) % matches.length
          : (selectedIndex - 1 + matches.length) % matches.length;
        results.querySelectorAll('[role="option"]').forEach((option, index) => {
          const selected = index === selectedIndex;
          option.classList.toggle('sel', selected);
          option.setAttribute('aria-selected', String(selected));
        });
        input.setAttribute('aria-activedescendant', 'simulator-import-option-' + selectedIndex);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(selectedIndex >= 0 ? selectedIndex : 0);
      }
    });
    results.addEventListener('mousedown', (event) => event.preventDefault());
    results.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tournament-index]');
      if (button) choose(Number(button.dataset.tournamentIndex));
    });
  }

  function simulatorEntryName(entry) {
    return entry.members.map(playerName).join(' + ');
  }

  function simulatorEntryId(members) {
    return members.map(String).join('|');
  }

  function simulatorEntryHtml(entry, compact) {
    return '<span class="entry-ident' + (compact ? ' compact' : '') + '">' +
      '<span class="avatar-stack">' + entry.members.map((uid) => avatarHtml(uid, compact ? 'tiny' : 'small')).join('') + '</span>' +
      '<span class="entry-text" translate="no">' + entry.members.map(playerLink).join(' <span class="mut">+</span> ') + '</span></span>';
  }

  function simulatorEntries() {
    return simulatorState.entries[simulatorState.mode].map((members, index) => ({
      id: simulatorEntryId(members), members, pi: index,
    }));
  }

  function clearSimulatorOriginalBracket() {
    simulatorState.originalBrackets[simulatorState.mode] = null;
    simulatorState.useOriginalBracket[simulatorState.mode] = false;
  }

  function simulatorImportData(tournament) {
    const expectedSize = Number(simulatorState.mode[0]);
    const entries = [];
    const entryIdsByParticipant = new Map();
    const usedPlayers = new Set();
    let complete = tournament.parts.length >= 2 && tournament.parts.length <= 64;
    for (const part of tournament.parts) {
      const members = part.members.filter((uid) => TBC.players.has(uid));
      if (members.length !== expectedSize || members.some((uid) => usedPlayers.has(uid))) {
        complete = false;
        continue;
      }
      const copy = members.slice();
      entries.push(copy);
      entryIdsByParticipant.set(part.pi, simulatorEntryId(copy));
      copy.forEach((uid) => usedPlayers.add(uid));
    }
    return { entries, entryIdsByParticipant, complete: complete && entries.length === tournament.parts.length };
  }

  function originalBracketDefinition(tournament, entryIdsByParticipant) {
    if (tournament.type !== 'SE') return null;
    const sourceMatches = tournament.matches.filter((match) => !match.isGroup && match.round > 0);
    if (sourceMatches.length !== entryIdsByParticipant.size - 1) return null;
    const sourceByIdentifier = new Map();
    for (const match of sourceMatches) {
      if (sourceByIdentifier.has(match.ident)) return null;
      sourceByIdentifier.set(match.ident, match);
    }
    const referenced = new Set();
    const side = (match, prerequisite, participant) => {
      if (prerequisite != null) {
        if (!sourceByIdentifier.has(prerequisite)) return null;
        referenced.add(prerequisite);
        return { type: 'match', id: prerequisite };
      }
      const entryId = entryIdsByParticipant.get(participant);
      return entryId == null ? null : { type: 'entry', id: entryId };
    };
    const matches = [];
    for (const match of sourceMatches) {
      const first = side(match, match.pr1, match.p1);
      const second = side(match, match.pr2, match.p2);
      if (!first || !second) return null;
      matches.push({ identifier: match.ident, round: match.round, first, second });
    }
    const roots = matches.filter((match) => !referenced.has(match.identifier));
    if (roots.length !== 1) return null;

    const definitionById = new Map(matches.map((match) => [match.identifier, match]));
    const visited = new Set();
    const visiting = new Set();
    const leaves = [];
    const visitSide = (child) => child.type === 'entry' ? leaves.push(child.id) : visit(child.id);
    const visit = (identifier) => {
      if (visiting.has(identifier)) throw new Error('Bracket cycle');
      if (visited.has(identifier)) return;
      const match = definitionById.get(identifier);
      if (!match) throw new Error('Missing bracket match');
      visiting.add(identifier);
      visitSide(match.first);
      visitSide(match.second);
      visiting.delete(identifier);
      visited.add(identifier);
    };
    try {
      visit(roots[0].identifier);
    } catch (_error) {
      return null;
    }
    const expectedLeaves = [...entryIdsByParticipant.values()].sort();
    if (visited.size !== matches.length || leaves.sort().join('\n') !== expectedLeaves.join('\n')) return null;
    return {
      title: tournament.title,
      slug: tournament.slug,
      matches,
      rootIdentifier: roots[0].identifier,
      maxRound: Math.max(...matches.map((match) => match.round)),
    };
  }

  function simulatorModel() {
    return simulatorModels?.[simulatorState.mode === '2v2' ? '2v2' : simulatorState.bracket];
  }

  function simulatorSkill(model, uid) {
    return model.skills.get(uid) || { mean: 0, variance: 1, matches: 0 };
  }

  function simulatorPairSkill(model, members) {
    if (!model.pairs || members.length !== 2) return null;
    return model.pairs.get(members.slice().sort((a, b) => String(a).localeCompare(String(b))).join('|')) || null;
  }

  function simulatorFeatureScore(entry, model) {
    if (model.historical) return 0;
    const weights = model.featureWeights;
    if (!weights) return 0;
    const featureRows = entry.members.map((uid) =>
      model.playerFeatures.get(uid) || { attendanceFast: 0, slow1v1: 0, slow2v2: 0, opponentForm: 0 });
    const average = (key) => featureRows.reduce((sum, row) => sum + row[key], 0) / featureRows.length;
    let score = weights.attendanceFast * average('attendanceFast') +
      weights.attendanceSlow * average(entry.members.length === 2 ? 'slow2v2' : 'slow1v1') +
      weights.opponentForm * average('opponentForm');
    if (weights.roster && entry.members.length === 2) {
      const key = entry.members.slice().sort((a, b) => String(a).localeCompare(String(b))).join('|');
      score += weights.roster * (model.rosterFeatures.get(key) || 0);
    }
    return score;
  }

  function logistic(value) {
    if (value >= 0) return 1 / (1 + Math.exp(-value));
    const exponent = Math.exp(value);
    return exponent / (1 + exponent);
  }

  function logit(value) {
    const bounded = Math.max(1e-12, Math.min(1 - 1e-12, value));
    return Math.log(bounded / (1 - bounded));
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function rosterKey(entry) {
    return entry.members.slice().sort((a, b) => String(a).localeCompare(String(b))).join('|');
  }

  function gaussianEntryStats(entry, skills) {
    const values = entry.members.map((uid) => skills.get(uid) || { mean: 0, variance: 1 });
    return {
      mean: values.reduce((sum, value) => sum + value.mean, 0),
      variance: values.reduce((sum, value) => sum + value.variance, 0),
      means: values.map((value) => value.mean),
    };
  }

  function simulatorBranchProbability(first, second, model) {
    let difference = 0;
    let variance = model.beta * model.beta * (first.members.length + second.members.length);
    for (const entry of [first, second]) {
      const sign = entry === first ? 1 : -1;
      for (const uid of entry.members) {
        const skill = simulatorSkill(model, uid);
        difference += sign * skill.mean;
        variance += skill.variance;
      }
      const pair = simulatorPairSkill(model, entry.members);
      if (pair) {
        difference += sign * pair.mean;
        variance += pair.variance;
      } else if (model.pairPriorVariance && entry.members.length === 2) {
        variance += model.pairPriorVariance;
      }
    }
    let probability = logistic(difference / Math.sqrt(variance) / model.scale);
    probability = Math.max(model.cap, Math.min(1 - model.cap, probability));
    const adjustment = simulatorFeatureScore(first, model) - simulatorFeatureScore(second, model);
    if (adjustment) {
      probability = logistic(logit(probability) + adjustment);
      probability = Math.max(model.cap, Math.min(1 - model.cap, probability));
    }
    if (model.tail) {
      const value = logit(probability);
      const magnitude = Math.abs(value);
      const adjusted = model.tail.temperature * Math.sign(value) *
        (Math.min(magnitude, model.tail.threshold) +
          model.tail.tailTemperature * Math.max(magnitude - model.tail.threshold, 0));
      probability = logistic(adjusted);
    }
    return probability;
  }

  function alternativeProbability(first, second, alternative) {
    let margin = 0;
    if (alternative.family === 'gaussian') {
      const firstStats = gaussianEntryStats(first, alternative.skills);
      const secondStats = gaussianEntryStats(second, alternative.skills);
      const variance = firstStats.variance + secondStats.variance +
        alternative.beta * alternative.beta * (first.members.length + second.members.length);
      margin = (firstStats.mean - secondStats.mean) / Math.sqrt(variance);
    } else if (alternative.family === 'adaptive_elo') {
      const rating = (entry) => average(entry.members.map((uid) => alternative.skills.get(uid) || 0));
      margin = rating(first) - rating(second);
    } else if (alternative.family === 'glicko') {
      const values = (entry) => entry.members.map((uid) =>
        alternative.skills.get(uid) || { rating: 1500, deviation: 150 });
      const firstValues = values(first);
      const secondValues = values(second);
      const firstRating = average(firstValues.map((value) => value.rating));
      const secondRating = average(secondValues.map((value) => value.rating));
      const uncertainty = firstValues.reduce((sum, value) =>
        sum + value.deviation * value.deviation / (first.members.length * first.members.length), 0) +
        secondValues.reduce((sum, value) =>
          sum + value.deviation * value.deviation / (second.members.length * second.members.length), 0);
      const q = Math.log(10) / 400;
      const attenuation = Math.sqrt(1 + 3 * q * q * uncertainty / (Math.PI * Math.PI));
      margin = q * (firstRating - secondRating) / attenuation;
    }
    return clamp(logistic(margin / alternative.scale), alternative.cap, 1 - alternative.cap);
  }

  function softTeam(values, q) {
    const center = average(values);
    const offsets = values.map((value) => q * (value - center));
    const maximum = Math.max(...offsets);
    return center + (maximum + Math.log(average(offsets.map((value) => Math.exp(value - maximum))))) / q;
  }

  function residualValue(entry, state) {
    const values = entry.members.map((uid) => {
      const value = state.players.get(uid) || { rating: 0, games: 0 };
      return value.rating * value.games / (value.games + state.prior);
    });
    return average(values);
  }

  function rosterResidualValue(entry, state) {
    const value = state.values.get(rosterKey(entry)) || { rating: 0, games: 0 };
    return value.rating * value.games / (value.games + state.prior);
  }

  function twoVTwoProbability(first, second, base, production) {
    const config = production.twoVTwo;
    const overallFirst = gaussianEntryStats(first, config.overall);
    const overallSecond = gaussianEntryStats(second, config.overall);
    const denominator = Math.sqrt(
      overallFirst.variance + overallSecond.variance + first.members.length + second.members.length
    );
    const additive = (overallFirst.mean - overallSecond.mean) / denominator;
    const formatFirst = gaussianEntryStats(first, config.format);
    const formatSecond = gaussianEntryStats(second, config.format);
    const formatDenominator = Math.sqrt(
      formatFirst.variance + formatSecond.variance + first.members.length + second.members.length
    );
    const soloFirst = gaussianEntryStats(first, config.solo);
    const soloSecond = gaussianEntryStats(second, config.solo);
    const soloDenominator = Math.sqrt(
      soloFirst.variance + soloSecond.variance + first.members.length + second.members.length
    );
    const signals = {
      format_star_vote: Math.sign(Math.max(...formatFirst.means) - Math.max(...formatSecond.means)),
      gaussian_star_vote: Math.sign(Math.max(...overallFirst.means) - Math.max(...overallSecond.means)),
      softmax_q05: 2 * (
        softTeam(overallFirst.means, 0.5) - softTeam(overallSecond.means, 0.5)
      ) / denominator - additive,
      solo_gaussian_delta: (soloFirst.mean - soloSecond.mean) / soloDenominator - additive,
      [config.pairResidual.name]: rosterResidualValue(first, config.pairResidual) -
        rosterResidualValue(second, config.pairResidual),
      [config.playerResidual.name]: residualValue(first, config.playerResidual) -
        residualValue(second, config.playerResidual),
    };
    const adjustment = config.aggregation.coefficients.reduce(
      (sum, [name, coefficient]) => sum + coefficient * signals[name], 0);
    let probability = clamp(
      logistic(config.aggregation.base_scale * logit(base) + adjustment),
      config.aggregation.cap_floor,
      1 - config.aggregation.cap_floor
    );
    const glicko = alternativeProbability(first, second, config.glicko);
    if ((probability > 0.5) !== (glicko > 0.5)) {
      const parameters = config.glickoDissent;
      const move = clamp(parameters.strength * (logit(probability) - logit(glicko)),
        -parameters.cap, parameters.cap);
      probability = logistic(logit(probability) + move);
    }
    return probability;
  }

  function reliabilityForPlayer(state, uid, teamSize) {
    const values = state.players.get(uid) || state.defaults;
    return values[teamSize === '2v2' ? 1 : 0];
  }

  function playerResidualMultiplier(first, second, production) {
    const state = production.playerResidualVolatility;
    const signal = average([...first.members, ...second.members].map((uid) =>
      reliabilityForPlayer(state, uid, first.members.length === 2 ? '2v2' : '1v1')));
    const parameters = state.parameters;
    const standardized = clamp(
      (signal - parameters.center) / parameters.scale,
      -parameters.standardized_cap,
      parameters.standardized_cap
    );
    return clamp(Math.exp(parameters.strength * standardized),
      parameters.multiplier_floor, parameters.multiplier_ceiling);
  }

  function quantile(values, q) {
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
  }

  function eventFieldMultiplier(entries, model) {
    const production = model.production;
    const route = production.eventFieldVolatility.parameters.routes.find((item) =>
      item.route === (model.name === 'huntsman' ? 'tbc2_huntsman_1v1' :
        model.name === '2v2' ? 'tbc2_2v2' : 'tbc2_main_1v1'));
    if (!route) return 1;
    const teamSize = model.name === '2v2' ? '2v2' : '1v1';
    const playerIds = [...new Set(entries.flatMap((entry) => entry.members))];
    const values = playerIds.map((uid) =>
      reliabilityForPlayer(production.eventFieldVolatility, uid, teamSize));
    let signal;
    if (route.statistic === 'range') signal = Math.max(...values) - Math.min(...values);
    else if (route.statistic === 'interquartile_range') signal = quantile(values, 0.75) - quantile(values, 0.25);
    else if (route.statistic === 'standard_deviation') {
      const center = average(values);
      signal = Math.sqrt(average(values.map((value) => (value - center) ** 2)));
    } else signal = average(values);
    const standardized = clamp((signal - route.center) / route.scale,
      -route.standardized_cap, route.standardized_cap);
    return clamp(Math.exp(route.strength * standardized),
      route.multiplier_floor, route.multiplier_ceiling);
  }

  function simulatorMatchup(first, second, model, context) {
    const key = first.id + '>' + second.id;
    let matchup = context.matchups.get(key);
    if (matchup) return matchup;
    const production = model.production;
    const branchProbability = simulatorBranchProbability(first, second, model);
    const preEventProbability = model.name === '2v2' && !model.historical
      ? twoVTwoProbability(first, second, branchProbability, production)
      : branchProbability;
    if (model.historical) {
      matchup = { branchLogit: logit(branchProbability), preEventProbability };
      context.matchups.set(key, matchup);
      return matchup;
    }
    const alternatives = production.alternatives.map((alternative) =>
      alternativeProbability(first, second, alternative));
    const uncertainty = production.uncertaintySkills;
    const averageUncertainty = average([...first.members, ...second.members].map((uid) =>
      Math.sqrt((uncertainty.get(uid) || { variance: 1 }).variance)));
    const minimumEventCount = Math.min(...[...first.members, ...second.members].map((uid) =>
      production.eventCounts.get(uid) || 0));
    matchup = {
      branchLogit: logit(branchProbability),
      preEventProbability,
      alternatives,
      alternativeLogits: alternatives.map(logit),
      averageUncertainty,
      minimumEventCount,
      residualMultiplier: playerResidualMultiplier(first, second, production),
    };
    context.matchups.set(key, matchup);
    return matchup;
  }

  function commonCalibrations(probability, matchup, model, context) {
    if (model.historical) return probability;
    const production = model.production;
    probability = logistic(logit(probability) * matchup.residualMultiplier);

    const confidence = production.ratingConfidence;
    const medianConfidence = [...matchup.alternativeLogits]
      .map(Math.abs).sort((a, b) => a - b)[1];
    if (medianConfidence >= confidence.minimum_median_abs_logit &&
        (confidence.maximum_median_abs_logit == null ||
          medianConfidence < confidence.maximum_median_abs_logit)) {
      probability = logistic(logit(probability) * Math.exp(confidence.logit_strength));
    }

    const dispersion = production.ratingDispersion;
    const route = dispersion.routes.find((item) =>
      item.target_team_size === (model.name === '2v2' ? '2v2' : '1v1') &&
      !(item.excluded_bracket_kind === 'hunts-bracket' && model.name === 'huntsman'));
    if (route) {
      const range = Math.max(...matchup.alternativeLogits) - Math.min(...matchup.alternativeLogits);
      const direction = Math.sign(logit(probability));
      const supporters = matchup.alternativeLogits.filter((value) => Math.sign(value) * direction > 0).length;
      if (range >= route.minimum_dispersion && supporters >= dispersion.minimum_supporting_families) {
        probability = logistic(logit(probability) * Math.exp(dispersion.logit_strength));
      }
    }

    probability = logistic(logit(probability) * context.fieldMultiplier);

    if (model.name === 'main') {
      const parameters = production.contextualRatingMixture;
      const sorted = [...matchup.alternativeLogits].sort((a, b) => a - b);
      const productionLogit = logit(probability);
      const disagreement = sorted[1] - productionLogit;
      const gates = {
        dispersion: sorted[2] - sorted[0],
        uncertainty: matchup.averageUncertainty,
        experience: Math.log1p(matchup.minimumEventCount),
        confidence: Math.abs(productionLogit),
      };
      let adjustment = parameters.coefficients[0] * disagreement;
      for (let index = 1; index < parameters.features.length; index++) {
        const name = parameters.features[index];
        const normalization = parameters.normalization[name];
        const standardized = clamp(
          (gates[name] - normalization.center) / normalization.scale, -3, 3);
        adjustment += parameters.coefficients[index] * disagreement * standardized;
      }
      probability = logistic(productionLogit + clamp(
        adjustment, -parameters.adjustment_cap, parameters.adjustment_cap));
    }
    return probability;
  }

  function simulatorPrediction(first, second, model, context, live, eventTemperature) {
    const matchup = simulatorMatchup(first, second, model, context);
    let probability = matchup.preEventProbability;
    let liveLogit = matchup.branchLogit;
    if (model.name === 'huntsman') {
      const form = (entry) => average(entry.members.map((uid) => live.huntsman.get(uid) || 0));
      liveLogit += form(first) - form(second);
      probability = logistic(liveLogit);
    } else if (model.name === '2v2') {
      const parameters = model.production.twoVTwo.dependencyLive;
      const shrunk = (entry) => {
        const key = rosterKey(entry);
        const rating = live.twoVTwoRatings.get(key) || 0;
        const games = live.twoVTwoGames.get(key) || 0;
        return rating * games / (games + parameters.prior_waves);
      };
      probability = logistic(logit(probability) + parameters.strength * (shrunk(first) - shrunk(second)));
      probability = logistic(eventTemperature * logit(probability));
    }
    return {
      probability: commonCalibrations(probability, matchup, model, context),
      liveLogit,
      preEventProbability: matchup.preEventProbability,
    };
  }

  function simulatorContext(entries, model) {
    return {
      matchups: new Map(),
      fieldMultiplier: model.historical ? 1 : eventFieldMultiplier(entries, model),
    };
  }

  function twoVTwoEventTemperature(matchNodes, model, context) {
    if (model.name !== '2v2') return 1;
    const logits = matchNodes.filter((node) => node.depth === 0).map((node) => {
      const first = node.first.entry;
      const second = node.second.entry;
      return Math.abs(logit(simulatorMatchup(first, second, model, context).preEventProbability));
    });
    const parameters = model.production.twoVTwo.eventVolatility;
    if (!logits.length) return parameters.base_temperature;
    return clamp(
      parameters.base_temperature + parameters.confidence_slope *
        (average(logits) - parameters.confidence_center),
      parameters.base_temperature - parameters.temperature_deviation_cap,
      parameters.base_temperature + parameters.temperature_deviation_cap
    );
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let mixed = value;
      mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
      return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffled(values, random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function challongeSeedOrder(bracketSize) {
    let seeds = [1, 2];
    for (let size = 4; size <= bracketSize; size *= 2) {
      seeds = seeds.flatMap((seed) => [seed, size + 1 - seed]);
    }
    return seeds;
  }

  function simulatorDrawSeed(baseSeed, index) {
    return (baseSeed + Math.imul(index, 0x9E3779B1)) >>> 0;
  }

  function generatedSimulatorBracket(entries, random, ordered) {
    const bracketSize = 2 ** Math.ceil(Math.log2(entries.length));
    const placed = ordered ? entries : shuffled(entries, random);
    const bySeed = new Map(placed.map((entry, index) => [index + 1, entry]));
    const seedOrder = challongeSeedOrder(bracketSize);
    const pairSlots = [];
    for (let index = 0; index < seedOrder.length; index += 2) {
      pairSlots.push([bySeed.get(seedOrder[index]), bySeed.get(seedOrder[index + 1])].filter(Boolean));
    }

    const matchNodes = [];
    let identifier = 1;
    const leaf = (entry) => ({ entry, depth: -1, identifier: null });
    const matchNode = (first, second, round) => {
      const node = {
        first,
        second,
        round,
        depth: Math.max(first.depth, second.depth) + 1,
        identifier: identifier++,
        winner: null,
      };
      matchNodes.push(node);
      return node;
    };
    let roots = pairSlots.map((pair) => pair.length === 1
      ? leaf(pair[0])
      : matchNode(leaf(pair[0]), leaf(pair[1]), 1));
    for (let round = 2; roots.length > 1; round++) {
      const next = [];
      for (let index = 0; index < roots.length; index += 2) {
        next.push(matchNode(roots[index], roots[index + 1], round));
      }
      roots = next;
    }
    return { root: roots[0], matchNodes, totalRounds: Math.log2(bracketSize) };
  }

  function importedSimulatorBracket(entries, definition) {
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const nodes = new Map(definition.matches.map((match) => [match.identifier, {
      identifier: match.identifier,
      round: match.round,
      first: null,
      second: null,
      depth: null,
      winner: null,
    }]));
    const leaf = (entry) => ({ entry, depth: -1, identifier: null });
    const childNode = (child) => child.type === 'match'
      ? nodes.get(child.id)
      : leaf(entriesById.get(child.id));
    for (const match of definition.matches) {
      const node = nodes.get(match.identifier);
      node.first = childNode(match.first);
      node.second = childNode(match.second);
      if (!node.first || !node.second || (node.first.entry == null && node.first.identifier == null) ||
          (node.second.entry == null && node.second.identifier == null)) return null;
    }
    const depth = (node) => {
      if (node.depth != null) return node.depth;
      node.depth = Math.max(depth(node.first), depth(node.second)) + 1;
      return node.depth;
    };
    const root = nodes.get(definition.rootIdentifier);
    if (!root) return null;
    depth(root);
    return { root, matchNodes: [...nodes.values()], totalRounds: definition.maxRound };
  }

  function simulatorDrawSettings() {
    if (simulatorState.useOriginalBracket[simulatorState.mode] &&
        simulatorState.originalBrackets[simulatorState.mode]) {
      return { mode: 'original', original: simulatorState.originalBrackets[simulatorState.mode] };
    }
    return { mode: simulatorState.drawMode[simulatorState.mode] };
  }

  function simulateBracket(entries, model, stats, seed, capture, sharedContext, drawSettings) {
    const random = seededRandom(seed);
    const settings = drawSettings || { mode: 'random' };
    const bracket = settings.mode === 'original'
      ? importedSimulatorBracket(entries, settings.original)
      : generatedSimulatorBracket(entries, random, settings.mode === 'ordered');
    if (!bracket) return null;
    const { root, matchNodes, totalRounds } = bracket;

    const context = sharedContext || simulatorContext(entries, model);
    const eventTemperature = twoVTwoEventTemperature(matchNodes, model, context);
    const live = {
      huntsman: new Map(),
      twoVTwoRatings: new Map(),
      twoVTwoGames: new Map(),
    };
    const matches = [];
    const wave = (node) => model.name === '2v2' ? node.depth : node.round;
    const waves = new Map();
    for (const node of matchNodes) {
      const key = wave(node);
      if (!waves.has(key)) waves.set(key, []);
      waves.get(key).push(node);
    }
    for (const waveNumber of [...waves.keys()].sort((a, b) => a - b)) {
      const nodes = waves.get(waveNumber);
      const huntsmanDeltas = new Map();
      const rosterDeltas = new Map();
      const rosterAppearances = new Map();
      for (const node of nodes) {
        const first = node.first.entry || node.first.winner;
        const second = node.second.entry || node.second.winner;
        if (stats && node.round === totalRounds) {
          stats.get(first.id).finals++;
          stats.get(second.id).finals++;
        }
        const prediction = simulatorPrediction(
          first, second, model, context, live, eventTemperature);
        const winner = random() < prediction.probability ? first : second;
        const loser = winner === first ? second : first;
        if (model.name === 'huntsman') {
          const winnerLogit = winner === first ? prediction.liveLogit : -prediction.liveLogit;
          const parameters = model.live;
          const update = parameters.learningRate *
            (1 - logistic(parameters.surpriseTemperature * winnerLogit));
          for (const uid of winner.members) huntsmanDeltas.set(uid, (huntsmanDeltas.get(uid) || 0) + update);
          for (const uid of loser.members) huntsmanDeltas.set(uid, (huntsmanDeltas.get(uid) || 0) - update);
        } else if (model.name === '2v2') {
          const winnerProbability = winner === first
            ? prediction.preEventProbability : 1 - prediction.preEventProbability;
          const residual = 1 - winnerProbability;
          for (const [entry, sign] of [[winner, 1], [loser, -1]]) {
            const key = rosterKey(entry);
            rosterDeltas.set(key, (rosterDeltas.get(key) || 0) + sign * residual);
            rosterAppearances.set(key, (rosterAppearances.get(key) || 0) + 1);
          }
        }
        node.winner = winner;
        if (capture) matches.push({
          key: node.identifier, ident: node.identifier, round: node.round,
          p1: first.pi, p2: second.pi, w: winner.pi, l: loser.pi,
          s1: winner === first ? 1 : 0, s2: winner === second ? 1 : 0,
          st: 0, isGroup: false,
          pr1: node.first.identifier, pr2: node.second.identifier,
          videos: [[], []],
        });
      }
      if (model.name === 'huntsman') {
        const parameters = model.live;
        const playerIds = new Set([...live.huntsman.keys(), ...huntsmanDeltas.keys()]);
        for (const uid of playerIds) {
          live.huntsman.set(uid, clamp(
            parameters.retention * (live.huntsman.get(uid) || 0) +
              (huntsmanDeltas.get(uid) || 0),
            -0.45,
            0.45
          ));
        }
      } else if (model.name === '2v2') {
        for (const [key, delta] of rosterDeltas) {
          live.twoVTwoRatings.set(key,
            (live.twoVTwoRatings.get(key) || 0) + delta / rosterAppearances.get(key));
          live.twoVTwoGames.set(key, (live.twoVTwoGames.get(key) || 0) + 1);
        }
      }
    }
    const champion = root.winner;
    if (stats) stats.get(champion.id).wins++;
    if (!capture) return null;
    matches.sort((left, right) => left.key - right.key);
    const parts = entries.map((entry) => ({
      pi: entry.pi,
      name: entry.members.map(playerName).join(' & '),
      members: entry.members,
      uids: entry.members,
      rawMembers: entry.members.map((uid) => [playerName(uid), uid]),
    }));
    return {
      slug: '__simulator_draw__', title: settings.mode === 'random' ? 'Randomized draw' : 'Simulated bracket', type: 'SE',
      teamSize: simulatorState.mode, maxRound: totalRounds, minRound: 0,
      parts, matches,
    };
  }

  function simulatorResultsHtml(entries, stats, trials, drawSettings) {
    const ranked = entries.slice().sort((left, right) =>
      stats.get(right.id).wins - stats.get(left.id).wins ||
      simulatorEntryName(left).localeCompare(simulatorEntryName(right)));
    const favorite = ranked[0];
    const favoriteChance = stats.get(favorite.id).wins / trials;
    const percentage = (value) => {
      const percent = value * 100;
      return (percent < 1 && percent > 0 ? percent.toFixed(2) : percent.toFixed(1)) + '%';
    };
    const rows = ranked.map((entry, index) => {
      const result = stats.get(entry.id);
      const winChance = result.wins / trials;
      const finalChance = result.finals / trials;
      return '<tr><td class="rank">' + (index + 1) + '</td><td>' + simulatorEntryHtml(entry, false) + '</td>' +
        '<td class="num">' + percentage(finalChance) + '</td>' +
        '<td class="simulator-chance"><div><strong>' + percentage(winChance) + '</strong>' +
        '<span class="chance-track"><span style="width:' + Math.max(winChance * 100, winChance ? 0.5 : 0) + '%"></span></span></div></td></tr>';
    }).join('');
    const summary = drawSettings.mode === 'random'
      ? num(trials) + ' independently randomized single-elimination brackets'
      : num(trials) + (drawSettings.mode === 'original'
        ? ' simulations of the imported tournament bracket'
        : ' simulations using the participant order shown above');
    const sampleHeading = drawSettings.mode === 'random' ? 'Randomized draws' : 'Simulated outcomes';
    const sampleLabel = drawSettings.mode === 'random' ? 'Draw' : 'Outcome';
    return '<section class="card simulator-favorite"><div class="simulator-favorite-avatar">' +
      favorite.members.map((uid) => avatarHtml(uid, 'large')).join('') + '</div><div><div class="t-label">Most likely champion</div>' +
      '<h2>' + simulatorEntryHtml(favorite, false) + '</h2><div class="simulator-favorite-chance">' +
      percentage(favoriteChance) + ' chance to win</div></div></section>' +
      '<section class="card"><div class="simulator-results-head"><div><h2>Predicted finish</h2>' +
      '<p class="small mut">' + summary + '</p></div>' +
      '<span class="chip accent">' + entries.length + ' entries</span></div>' +
      '<div class="tbl-wrap"><table class="tbl simulator-table"><thead><tr><th class="rank">#</th><th>Entry</th>' +
      '<th class="num">Reach final</th><th>Win chance</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="card simulator-sample"><div class="simulator-results-head"><div><h2>' + sampleHeading + '</h2></div>' +
      '<output id="simulator-draw-label">' + sampleLabel + ' 1 of ' + num(trials) + '</output></div>' +
      '<input id="simulator-draw-slider" type="range" min="1" max="' + trials + '" value="1" aria-label="' + sampleLabel + '">' +
      '<div id="simulator-draw-bracket"></div></section>';
  }

  function simulatorEntryListHtml(entries, orderLocked) {
    if (!entries.length) return '<div class="simulator-entry-empty">No entries added yet.</div>';
    return '<div class="simulator-entry-list">' + entries.map((entry, index) =>
      '<div class="simulator-entry-row">' + simulatorEntryHtml(entry, false) +
      '<span class="simulator-entry-actions"><button type="button" class="simulator-entry-move" data-simulator-move="' +
      index + '" data-direction="-1"' + (index && !orderLocked ? '' : ' disabled') + ' aria-label="Move ' +
      esc(simulatorEntryName(entry)) + ' up" title="Move up">↑</button>' +
      '<button type="button" class="simulator-entry-move" data-simulator-move="' + index + '" data-direction="1"' +
      (index === entries.length - 1 || orderLocked ? ' disabled' : '') + ' aria-label="Move ' + esc(simulatorEntryName(entry)) +
      ' down" title="Move down">↓</button><button type="button" class="simulator-entry-remove" data-simulator-remove="' +
      index + '" aria-label="Remove ' + esc(simulatorEntryName(entry)) + '">Remove</button></span></div>').join('') + '</div>';
  }

  function simulatorSkillSnapshot(data, snapshotIndex) {
    if (snapshotIndex == null) return null;
    const eventKey = data.snapshots[snapshotIndex]?.[2];
    return window.TBC_SIMULATOR_SKILL_HISTORY?.snapshots.find((snapshot) => snapshot[0] === eventKey) || null;
  }

  function simulatorModelsAtSnapshot(models, snapshot) {
    if (!snapshot) return models;
    const output = {};
    for (const [name, model] of Object.entries(models)) {
      const skills = name === 'main' ? snapshot[1] : name === 'huntsman' ? snapshot[2] : snapshot[3];
      const pairs = name === '2v2' ? snapshot[4] : [];
      output[name] = {
        ...model,
        historical: true,
        skills: new Map(skills.map(([uid, mean, variance]) => [uid, { mean, variance }])),
        pairs: new Map(pairs.map(([first, second, mean, variance]) =>
          [[first, second].sort((a, b) => String(a).localeCompare(String(b))).join('|'), { mean, variance }])),
      };
    }
    return output;
  }

  function prepareSimulatorModels(data, snapshotIndex) {
    const historicalSnapshot = simulatorSkillSnapshot(data, snapshotIndex);
    if (currentSimulatorModels) return simulatorModelsAtSnapshot(currentSimulatorModels, historicalSnapshot);
    const playerFeatures = new Map(data.predictor.features.players.map(
      ([uid, attendanceFast, slow1v1, slow2v2, opponentForm]) => [uid, {
        attendanceFast, slow1v1, slow2v2, opponentForm,
      }]));
    const rosterFeatures = new Map(data.predictor.features.rosters.map(([first, second, value]) =>
      [[first, second].sort((a, b) => String(a).localeCompare(String(b))).join('|'), value]));
    const productionRaw = data.predictor.production;
    const dynamicSkills = (rows) => new Map(rows.map(([uid, mean, variance]) =>
      [uid, { mean, variance }]));
    const reliability = (raw) => ({
      parameters: raw.parameters,
      defaults: raw.defaults,
      players: new Map(raw.players.map(([uid, oneVOne, twoVTwo]) => [uid, [oneVOne, twoVTwo]])),
    });
    const alternatives = productionRaw.alternatives.map((raw) => {
      let skills;
      if (raw.family === 'gaussian') {
        skills = dynamicSkills(raw.skills);
      } else if (raw.family === 'adaptive_elo') {
        skills = new Map(raw.skills.map(([uid, rating]) => [uid, rating]));
      } else {
        skills = new Map(raw.skills.map(([uid, rating, deviation]) =>
          [uid, { rating, deviation }]));
      }
      return { ...raw, skills };
    });
    const twoVTwoRaw = productionRaw.twoVTwo;
    const production = {
      alternatives,
      uncertaintySkills: dynamicSkills(productionRaw.uncertaintySkills),
      eventCounts: new Map(productionRaw.eventCounts),
      playerResidualVolatility: reliability(productionRaw.playerResidualVolatility),
      eventFieldVolatility: reliability(productionRaw.eventFieldVolatility),
      ratingConfidence: productionRaw.ratingConfidence,
      ratingDispersion: {
        ...productionRaw.ratingDispersion,
        routes: Object.values(productionRaw.ratingDispersion.routes),
      },
      contextualRatingMixture: productionRaw.contextualRatingMixture,
      twoVTwo: {
        aggregation: twoVTwoRaw.aggregation,
        glickoDissent: twoVTwoRaw.glickoDissent,
        dependencyLive: twoVTwoRaw.dependencyLive,
        eventVolatility: twoVTwoRaw.eventVolatility,
        glicko: {
          ...twoVTwoRaw.glicko,
          family: 'glicko',
          skills: new Map(twoVTwoRaw.glicko.skills.map(([uid, rating, deviation]) =>
            [uid, { rating, deviation }])),
        },
        overall: dynamicSkills(twoVTwoRaw.signals.overall),
        format: dynamicSkills(twoVTwoRaw.signals.format),
        solo: dynamicSkills(twoVTwoRaw.signals.solo),
        pairResidual: {
          name: twoVTwoRaw.signals.pairResidual.name,
          prior: twoVTwoRaw.signals.pairResidual.prior,
          values: new Map(twoVTwoRaw.signals.pairResidual.values.map(
            ([first, second, rating, games]) =>
              [[first, second].sort((a, b) => String(a).localeCompare(String(b))).join('|'), { rating, games }]
          )),
        },
        playerResidual: {
          name: twoVTwoRaw.signals.playerResidual.name,
          prior: twoVTwoRaw.signals.playerResidual.prior,
          players: new Map(twoVTwoRaw.signals.playerResidual.values.map(
            ([uid, rating, games]) => [uid, { rating, games }]
          )),
        },
      },
    };
    const output = {};
    for (const [name, raw] of Object.entries(data.predictor.models)) {
      output[name] = {
        ...raw,
        name,
        historical: false,
        production,
        playerFeatures,
        rosterFeatures,
        skills: new Map(raw.skills.map(([uid, mean, variance, matches]) =>
          [uid, { mean, variance, matches }])),
        pairs: new Map((raw.pairs || []).map(([first, second, mean, variance]) =>
          [[first, second].sort((a, b) => String(a).localeCompare(String(b))).join('|'), { mean, variance }])),
      };
    }
    currentSimulatorModels = output;
    return simulatorModelsAtSnapshot(output, historicalSnapshot);
  }

  function viewSimulator() {
    const entries = simulatorEntries();
    const playerCount = new Set(entries.flatMap((entry) => entry.members)).size;
    const originalBracket = simulatorState.originalBrackets[simulatorState.mode];
    const useOriginalBracket = Boolean(originalBracket && simulatorState.useOriginalBracket[simulatorState.mode]);
    const modelChoices = simulatorState.mode === '1v1'
      ? '<div class="simulator-field"><span class="simulator-label">Bracket model</span>' +
        '<div class="simulator-modes" role="group" aria-label="1v1 bracket model">' +
        [['main', 'Main bracket'], ['huntsman', 'Huntsman bracket']].map(([value, label]) =>
          '<button type="button" data-simulator-bracket="' + value + '" aria-pressed="' +
          (simulatorState.bracket === value) + '">' + label + '</button>').join('') + '</div></div>'
      : '';
    const picker = simulatorState.mode === '1v1'
      ? simulatorPickerHtml('simulator-player', 'Add player')
      : '<div class="simulator-picker-grid">' + simulatorPickerHtml('simulator-player-1', 'Teammate 1') +
        simulatorPickerHtml('simulator-player-2', 'Teammate 2') + '</div>' +
        '<button class="btn" type="button" id="simulator-add-team" disabled>Add team</button>';
    const html = '<h1>Bracket predictor</h1>' +
      '<p class="lede">Build a field, randomize the bracket thousands of times, and estimate who is most likely to win.</p>' +
      '<div class="simulator-layout"><section class="card simulator-config"><div class="simulator-field">' +
      '<span class="simulator-label">Format</span><div class="simulator-modes" role="group" aria-label="Tournament format">' +
      ['1v1', '2v2'].map((mode) => '<button type="button" data-simulator-mode="' + mode + '" aria-pressed="' +
        (simulatorState.mode === mode) + '">' + mode + '</button>').join('') + '</div></div>' + modelChoices +
      '<div class="rating-config simulator-snapshot"><div class="rating-config-head"><span>Skill snapshot</span>' +
      '<output id="simulator-snapshot-label">Loading skill history…</output></div>' +
      '<input id="simulator-snapshot" type="range" min="0" max="0" value="0" disabled aria-label="TBC2 skill snapshot">' +
      '<p class="small mut">Historical snapshots use the TBC2 skills known after that tournament group. Group 092 is the pre-TBC2 baseline; “Today” uses every available result.</p></div>' +
      '<div class="simulator-field"><span class="simulator-label">Participant order</span>' +
      '<div class="simulator-modes" role="group" aria-label="Participant order">' +
      [['random', 'Randomize'], ['ordered', 'Use list order']].map(([value, label]) =>
        '<button type="button" data-simulator-draw-mode="' + value + '" aria-pressed="' +
        (simulatorState.drawMode[simulatorState.mode] === value) + '"' + (useOriginalBracket ? ' disabled' : '') +
        '>' + label + '</button>').join('') + '</div>' +
      '<label class="simulator-original-bracket"><input id="simulator-use-original" type="checkbox"' +
      (useOriginalBracket ? ' checked' : '') + (originalBracket ? '' : ' disabled') + '> ' +
      (originalBracket ? 'Use exact bracket from ' + esc(originalBracket.title) : 'Use exact bracket from imported tournament') +
      '</label></div>' +
      '<div class="simulator-field"><div class="simulator-entry-heading"><span class="simulator-label">Entries</span>' +
      '<span class="small mut">' + entries.length + ' / 64</span></div>' + simulatorEntryListHtml(entries, useOriginalBracket) + '</div>' +
      '<div class="simulator-field">' + picker + '</div>' +
      '<div class="simulator-import-row">' + simulatorTournamentPickerHtml() +
      '<button class="btn" type="button" id="simulator-import" disabled>Add all ' +
      (simulatorState.mode === '2v2' ? 'teams' : 'entries') + '</button></div>' +
      '<p class="small mut simulator-import-note">Imported entries use the selected skill snapshot. Choose a snapshot before the tournament to avoid including its results.</p>' +
      '<div class="simulator-actions"><button class="btn" type="button" id="simulator-clear"' +
      (entries.length ? '' : ' disabled') + '>Clear field</button>' +
      '<label><span class="simulator-label">Simulations</span><select id="simulator-trials">' +
      [1000, 10000, 50000].map((value) => '<option value="' + value + '"' +
        (simulatorState.trials === value ? ' selected' : '') + '>' + num(value) + '</option>').join('') +
      '</select></label><button class="btn simulator-run" type="button" id="simulator-run" disabled>Loading model…</button></div>' +
      '<div class="simulator-errors" id="simulator-errors" role="alert" hidden></div></section>' +
      '<aside class="card simulator-about"><h2>How it works</h2><p>The simulator assigns byes using Challonge’s bracket layout, then plays out each match using the TBC2 skill model for the selected bracket.</p>' +
      '<p>Later Huntsman and 2v2 rounds incorporate the earlier simulated results using the predictor’s live adjustments.</p>' +
      '</aside></div>' +
      '<div class="simulator-results section" id="simulator-results"><div class="card simulator-empty"><strong>Your forecast will appear here.</strong>' +
      '<span>Add at least two entries, then run the simulator.</span></div></div>';

    render('simulator', 'Bracket Predictor', html, (root) => {
      const trials = root.querySelector('#simulator-trials');
      const run = root.querySelector('#simulator-run');
      const clear = root.querySelector('#simulator-clear');
      const importButton = root.querySelector('#simulator-import');
      const snapshotSlider = root.querySelector('#simulator-snapshot');
      const snapshotLabel = root.querySelector('#simulator-snapshot-label');
      const errors = root.querySelector('#simulator-errors');
      const results = root.querySelector('#simulator-results');
      const excluded = () => new Set(simulatorState.entries[simulatorState.mode].flat());

      const updateSnapshotLabel = (data) => {
        if (simulatorState.skillSnapshot == null) {
          snapshotLabel.textContent = 'Today · ' + fmtDate(data.predictor.generated);
          return;
        }
        const snapshot = data.snapshots[simulatorState.skillSnapshot];
        const group = snapshot && TBC.groups.find((item) => item.id === snapshot[0]);
        snapshotLabel.textContent = snapshot
          ? fmtDate(snapshot[1]) + ' · Group ' + snapshot[0] + (group ? ' · ' + group.title : '')
          : 'Snapshot unavailable';
      };

      const enableSnapshotSlider = (data) => {
        const availableEvents = new Set(window.TBC_SIMULATOR_SKILL_HISTORY.snapshots.map((snapshot) => snapshot[0]));
        const firstSnapshot = data.snapshots.findIndex((snapshot) => availableEvents.has(snapshot[2]));
        if (simulatorState.skillSnapshot != null && simulatorState.skillSnapshot < firstSnapshot) {
          simulatorState.skillSnapshot = firstSnapshot;
          simulatorModels = prepareSimulatorModels(data, simulatorState.skillSnapshot);
        }
        snapshotSlider.min = String(firstSnapshot);
        snapshotSlider.max = String(data.snapshots.length);
        snapshotSlider.value = String(simulatorState.skillSnapshot == null
          ? data.snapshots.length : simulatorState.skillSnapshot);
        snapshotSlider.disabled = false;
        updateSnapshotLabel(data);
      };

      root.querySelectorAll('[data-simulator-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          simulatorState.mode = button.dataset.simulatorMode;
          viewSimulator();
        });
      });
      root.querySelectorAll('[data-simulator-bracket]').forEach((button) => {
        button.addEventListener('click', () => {
          simulatorState.bracket = button.dataset.simulatorBracket;
          viewSimulator();
        });
      });
      root.querySelectorAll('[data-simulator-draw-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          simulatorState.drawMode[simulatorState.mode] = button.dataset.simulatorDrawMode;
          simulatorState.useOriginalBracket[simulatorState.mode] = false;
          viewSimulator();
        });
      });
      root.querySelector('#simulator-use-original').addEventListener('change', (event) => {
        simulatorState.useOriginalBracket[simulatorState.mode] = event.target.checked;
        viewSimulator();
      });
      root.querySelectorAll('[data-simulator-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          simulatorState.entries[simulatorState.mode].splice(Number(button.dataset.simulatorRemove), 1);
          clearSimulatorOriginalBracket();
          viewSimulator();
        });
      });
      root.querySelectorAll('[data-simulator-move]').forEach((button) => {
        button.addEventListener('click', () => {
          const entriesForMode = simulatorState.entries[simulatorState.mode];
          const index = Number(button.dataset.simulatorMove);
          const next = index + Number(button.dataset.direction);
          [entriesForMode[index], entriesForMode[next]] = [entriesForMode[next], entriesForMode[index]];
          viewSimulator();
        });
      });
      trials.addEventListener('change', () => { simulatorState.trials = Number(trials.value); });
      snapshotSlider.addEventListener('input', () => {
        const data = window.TBC_RATING_HISTORY;
        if (!data) return;
        const value = Number(snapshotSlider.value);
        simulatorState.skillSnapshot = value === data.snapshots.length ? null : value;
        simulatorModels = prepareSimulatorModels(data, simulatorState.skillSnapshot);
        updateSnapshotLabel(data);
        results.innerHTML = '<div class="card simulator-empty"><strong>Skill snapshot changed.</strong>' +
          '<span>Run the simulator again to update the forecast.</span></div>';
      });
      clear.addEventListener('click', () => {
        simulatorState.entries[simulatorState.mode] = [];
        clearSimulatorOriginalBracket();
        viewSimulator();
      });

      let importTournament = null;
      wireSimulatorTournamentPicker(root, (tournament) => {
        importTournament = tournament;
        importButton.disabled = !tournament;
      });
      importButton.addEventListener('click', () => {
        if (!importTournament) return;
        const imported = simulatorImportData(importTournament);
        const added = simulatorState.entries[simulatorState.mode];
        const usedPlayers = new Set(added.flat());
        const canUseExactBracket = added.length === 0 && imported.complete;
        for (const members of imported.entries) {
          if (members.some((uid) => usedPlayers.has(uid)) || added.length >= 64) {
            continue;
          }
          added.push(members.slice());
          members.forEach((uid) => usedPlayers.add(uid));
        }
        const definition = canUseExactBracket
          ? originalBracketDefinition(importTournament, imported.entryIdsByParticipant)
          : null;
        simulatorState.originalBrackets[simulatorState.mode] = definition;
        simulatorState.useOriginalBracket[simulatorState.mode] = false;
        viewSimulator();
      });

      if (simulatorState.mode === '1v1') {
        wireSimulatorPicker(root, 'simulator-player', excluded, (uid) => {
          if (simulatorState.entries['1v1'].length < 64) simulatorState.entries['1v1'].push([uid]);
          clearSimulatorOriginalBracket();
          viewSimulator();
        });
      } else {
        const draft = [null, null];
        const addTeam = root.querySelector('#simulator-add-team');
        const updateAddTeam = () => { addTeam.disabled = !draft[0] || !draft[1] || entries.length >= 64; };
        const first = wireSimulatorPicker(root, 'simulator-player-1', () => {
          const values = excluded();
          if (draft[1] != null) values.add(draft[1]);
          return values;
        }, (uid) => { draft[0] = uid; updateAddTeam(); },
        () => { draft[0] = null; updateAddTeam(); });
        const second = wireSimulatorPicker(root, 'simulator-player-2', () => {
          const values = excluded();
          if (draft[0] != null) values.add(draft[0]);
          return values;
        }, (uid) => { draft[1] = uid; updateAddTeam(); },
        () => { draft[1] = null; updateAddTeam(); });
        addTeam.addEventListener('click', () => {
          if (!draft[0] || !draft[1] || simulatorState.entries['2v2'].length >= 64) return;
          simulatorState.entries['2v2'].push(draft.slice());
          clearSimulatorOriginalBracket();
          first.clear();
          second.clear();
          viewSimulator();
        });
      }

      run.addEventListener('click', () => {
        const currentEntries = simulatorEntries();
        const model = simulatorModel();
        if (currentEntries.length < 2 || !model) return;
        errors.hidden = true;
        run.disabled = true;
        run.textContent = 'Simulating…';
        requestAnimationFrame(() => {
          const stats = new Map(currentEntries.map((entry) => [entry.id, { wins: 0, finals: 0 }]));
          const context = simulatorContext(currentEntries, model);
          const drawSettings = simulatorDrawSettings();
          const randomSeed = new Uint32Array(1);
          if (window.crypto?.getRandomValues) window.crypto.getRandomValues(randomSeed);
          else randomSeed[0] = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
          for (let index = 0; index < simulatorState.trials; index++) {
            simulateBracket(currentEntries, model, stats,
              simulatorDrawSeed(randomSeed[0], index), false, context, drawSettings);
          }
          replaceAvatarHtml(results, simulatorResultsHtml(
            currentEntries, stats, simulatorState.trials, drawSettings));
          const slider = results.querySelector('#simulator-draw-slider');
          const label = results.querySelector('#simulator-draw-label');
          const bracket = results.querySelector('#simulator-draw-bracket');
          const draw = () => {
            const index = Number(slider.value) - 1;
            label.textContent = (drawSettings.mode === 'random' ? 'Draw ' : 'Outcome ') +
              num(index + 1) + ' of ' + num(simulatorState.trials);
            const tournament = simulateBracket(
              currentEntries, model, null, simulatorDrawSeed(randomSeed[0], index), true, context, drawSettings);
            replaceAvatarHtml(bracket, bracketHtml(tournament));
          };
          slider.addEventListener('input', draw);
          draw();
          run.disabled = false;
          run.textContent = 'Run simulation';
        });
      });

      const enable = () => {
        const ready = Boolean(simulatorModel());
        run.disabled = !ready || entries.length < 2 || playerCount < entries.length * Number(simulatorState.mode[0]);
        run.textContent = ready ? 'Run simulation' : 'Model unavailable';
      };
      if (simulatorModels && window.TBC_RATING_HISTORY && window.TBC_SIMULATOR_SKILL_HISTORY) {
        enableSnapshotSlider(window.TBC_RATING_HISTORY);
        enable();
      }
      else Promise.all([loadRatingHistory(), loadSimulatorSkillHistory()]).then(([data]) => {
        if (!run.isConnected) return;
        simulatorModels = prepareSimulatorModels(data, simulatorState.skillSnapshot);
        enableSnapshotSlider(data);
        enable();
      }).catch(() => {
        if (!run.isConnected) return;
        run.textContent = 'Model unavailable';
        errors.textContent = 'The current prediction model could not be loaded. Please try again.';
        errors.hidden = false;
      });
    });
  }

  /* ---------- videos ---------- */

  const videosState = { q: '' };

  function availableVideoMatches() {
    const result = [];
    for (const t of TBC.tournaments) {
      for (const m of t.matches) {
        const count = videosForSide(m, 0).length + videosForSide(m, 1).length;
        if (count) result.push({ t, m, count });
      }
    }
    return result.sort((a, b) =>
      b.t.date.localeCompare(a.t.date) || b.t.ti - a.t.ti || b.m.key - a.m.key);
  }

  function videoCardHtml(t, m, count) {
    const availableSides = [0, 1].filter((side) => videosForSide(m, side).length);
    const matchup = [m.p1, m.p2].map((pi) =>
      pi >= 0 ? entryWithAvatars(t.parts[pi], false) : '<span class="mut">TBD</span>');
    return '<article class="video-card">' +
      '<div class="video-card-meta">' + esc(fmtDate(t.date)) + ' · ' + esc(bracketChipLabel(t)) +
      ' · ' + esc(matchRoundName(t, m)) + ' · Match ' + m.ident + '</div>' +
      '<h2>' + tournamentLink(t) + '</h2>' +
      '<div class="video-matchup">' + matchup[0] + '<span class="mut">vs.</span>' + matchup[1] + '</div>' +
      '<div class="video-list">' + availableSides.map((side) => {
        const pi = side === 0 ? m.p1 : m.p2;
        return '<div class="video-row"><span>' + entryWithAvatars(t.parts[pi], true) + '</span>' +
          videoButtonHtml(t, m, side, true) + '</div>';
      }).join('') + '</div>' +
      '<div class="video-card-count">' + count + ' video' + (count === 1 ? '' : 's') + '</div>' +
      '</article>';
  }

  function viewVideos() {
    const all = availableVideoMatches();
    const html = '<h1>Match videos</h1>' +
      '<div class="filters"><input type="search" id="video-q" placeholder="Filter by player or tournament…" value="' +
      esc(videosState.q) + '"><span class="count" id="video-count"></span></div>' +
      '<div class="video-grid" id="video-list"></div>';

    render('videos', 'Videos', html, (root) => {
      const $list = root.querySelector('#video-list');
      const $count = root.querySelector('#video-count');
      function apply() {
        const q = videosState.q.trim().toLowerCase();
        const rows = q ? all.filter(({ t, m }) => {
          const playerTerms = [m.p1, m.p2]
            .filter((pi) => pi >= 0)
            .flatMap((pi) => {
              const part = t.parts[pi];
              return [part.name, ...part.uids.map(playerSearchText)];
            })
            .join(' ');
          return (t.title + ' ' + t.slug + ' ' + playerTerms).toLowerCase().includes(q);
        }) : all;
        $count.textContent = rows.length + ' of ' + all.length + ' matches';
        replaceAvatarHtml($list, rows.map(({ t, m, count }) => videoCardHtml(t, m, count)).join('') ||
          '<div class="card"><p class="mut">No videos match that filter.</p></div>');
      }
      root.querySelector('#video-q').addEventListener('input', (e) => {
        videosState.q = e.target.value;
        apply();
      });
      apply();
    });
  }

  /* ---------- 404 ---------- */

  function viewNotFound() {
    render('', 'Not found', '<h1>Page not found</h1><p class="lede">That page doesn\'t exist. Try the <a href="' + SITE_ROOT + '">home page</a> or the search box above.</p>');
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
    $search.removeAttribute('aria-activedescendant');
    if (q.length < 2) { closeSearch(); return; }
    const score = (s) => (s.startsWith(q) ? 0 : s.includes(' ' + q) ? 1 : s.includes(q) ? 2 : -1);
    const ps = searchIdx.players.map((e) => ({ e, sc: score(e.s) })).filter((x) => x.sc >= 0)
      .sort((a, b) => a.sc - b.sc || a.e.s.length - b.e.s.length).slice(0, 6);
    const ts = searchIdx.tournaments.map((e) => ({ e, sc: score(e.s) })).filter((x) => x.sc >= 0)
      .sort((a, b) => a.sc - b.sc || (a.e.t.date < b.e.t.date ? 1 : -1)).slice(0, 5);
    let s = '';
    if (ps.length) {
      s += '<div class="sr-head">Players</div>' + ps.map(({ e }) => {
        const a = TBC.agg.get(e.p.id);
        const alias = e.p.display.toLowerCase() !== e.p.username.toLowerCase() ? e.p.display : '';
        const currentNames = (e.p.username + ' ' + e.p.display).toLowerCase();
        const entryMatch = !currentNames.includes(q) ? matchingEntryName(e.p.id, q) : null;
        return '<a class="search-player" href="' + playerHref(e.p.id) + '">' + avatarHtml(e.p.id) +
          '<span><strong translate="no">' + esc(e.p.username) + '</strong><span class="sr-sub">' +
          (entryMatch ? 'entered as <span translate="no">' + esc(entryMatch) + '</span> · ' : '') +
          (alias ? '<span translate="no">' + esc(alias) + '</span> · ' : '') +
          (a ? a.entries.length + ' entries' + (a.wins.length ? ' · 🏆 ' + a.wins.length : '') : '') + '</span></span></a>';
      }).join('');
    }
    if (ts.length) {
      s += '<div class="sr-head">Tournaments</div>' + ts.map(({ e }) =>
        '<a href="' + tournamentHref(e.t) + '">' + esc(e.t.title) +
        ' <span class="sr-sub">' + esc(fmtDate(e.t.date)) + '</span></a>').join('');
    }
    replaceAvatarHtml($results, s || '<div class="sr-empty">No matches.</div>');
    $results.querySelectorAll('a').forEach((link, index) => {
      link.id = 'search-option-' + index;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', 'false');
    });
    $results.classList.add('open');
    $search.setAttribute('aria-expanded', 'true');
  }

  function closeSearch() {
    $results.classList.remove('open');
    $search.setAttribute('aria-expanded', 'false');
    $search.removeAttribute('aria-activedescendant');
    $results.querySelectorAll('[aria-selected="true"]').forEach((option) => {
      option.setAttribute('aria-selected', 'false');
    });
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
      links.forEach((l, i) => {
        const selected = i === searchSel;
        l.classList.toggle('sel', selected);
        l.setAttribute('aria-selected', String(selected));
      });
      $search.setAttribute('aria-activedescendant', links[searchSel].id);
      links[searchSel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = links[searchSel >= 0 ? searchSel : 0];
      if (target) { navigate(target.href); closeSearch(); $search.value = ''; }
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

  function navigate(href, replace) {
    const url = new URL(href, location.href);
    history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
    route();
  }

  function requestedRoute() {
    const legacyHash = location.hash.startsWith('#/');
    const value = legacyHash
      ? location.hash.slice(1)
      : location.pathname.startsWith(SITE_ROOT)
        ? location.pathname.slice(SITE_ROOT.length)
        : '';
    return { legacyHash, seg: value.split('/').filter(Boolean) };
  }

  function replaceLegacyHash(legacyHash, href) {
    if (!legacyHash) return;
    const url = new URL(href, location.href);
    history.replaceState({}, '', url.pathname + url.search);
  }

  function route() {
    const { legacyHash, seg } = requestedRoute();
    if (seg.length === 0) {
      replaceLegacyHash(legacyHash, SITE_ROOT);
      return viewHome();
    }
    if (seg[0] === 'events') {
      replaceLegacyHash(legacyHash, SITE_ROOT + 'events/');
      return viewEvents();
    }
    if (seg[0] === 't' && seg[1]) {
      const slug = decodeRouteValue(seg[1]);
      const tournament = slug == null ? null : TBC.bySlug.get(slug);
      if (!tournament) return viewNotFound();
      replaceLegacyHash(legacyHash, tournamentHref(tournament));
      return viewTournament(tournament.slug);
    }
    if (seg[0] === 'p' && seg[1]) {
      const uid = playerIdFromRoute(seg[1]);
      if (uid == null || !TBC.players.has(uid)) return viewNotFound();
      replaceLegacyHash(legacyHash, playerHref(uid));
      return viewPlayer(uid);
    }
    if (seg[0] === 'players' || seg[0] === 'leaderboards') {
      replaceLegacyHash(legacyHash, SITE_ROOT + 'players/');
      return viewPlayers();
    }
    if (seg[0] === 'simulator' || seg[0] === 'predictor') {
      replaceLegacyHash(legacyHash, SITE_ROOT + 'simulator/');
      return viewSimulator();
    }
    if (seg[0] === 'videos') {
      replaceLegacyHash(legacyHash, SITE_ROOT + 'videos/');
      return viewVideos();
    }
    return viewNotFound();
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(SITE_ROOT)) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

  route();
})();
