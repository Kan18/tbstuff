/* compute.js — pure data model + aggregation. No DOM access.
   Reads window.TBC_DATA (from data.js), exposes window.TBC. */
'use strict';
(function () {
  const D = window.TBC_DATA;

  /* ---------- players ---------- */
  const players = new Map();
  for (const [id, username, display, avatar] of D.players) {
    players.set(id, { id, username, display: display || username, avatar });
  }

  /* ---------- groups ---------- */
  const groups = D.groups.map(([id, title, span], idx) => ({
    id, title, span, idx, tournaments: [],
  }));

  /* ---------- tournaments ---------- */
  function computeTournamentStats(t) {
    let maxRound = 0, minRound = 0;
    for (const m of t.matches) {
      if (m.round > maxRound) maxRound = m.round;
      if (m.round < minRound) minRound = m.round;
    }
    t.maxRound = maxRound;
    t.minRound = minRound;

    for (const m of t.matches) {
      if (m.st !== 0 || m.w < 0) continue;
      t.parts[m.w].w += 1;
      if (m.l >= 0) t.parts[m.l].l += 1;
      // game tallies (score components); ignore forfeits (-1) and
      // junk marker scores some hosts entered (999–998 etc.)
      if (typeof m.s1 === 'number' && typeof m.s2 === 'number' &&
          m.s1 >= 0 && m.s2 >= 0 && m.s1 <= 50 && m.s2 <= 50) {
        if (m.p1 >= 0) { t.parts[m.p1].gw += m.s1; t.parts[m.p1].gl += m.s2; }
        if (m.p2 >= 0) { t.parts[m.p2].gw += m.s2; t.parts[m.p2].gl += m.s1; }
      }
    }
    for (const wi of t.winners) t.parts[wi].isWinner = true;

    // A final means participation in the actual final round of an elimination
    // bracket. Round-robin runner-up finishes are deliberately not finals.
    // Reset matches in double elimination share a round, so the Set keeps the
    // appearance to one per bracket.
    t.finalists = new Set();
    t.finalMatchWinner = null;
    t.finalMatchLoser = null;
    if (t.type !== 'RR') {
      const completedFinals = [];
      for (const m of t.matches) {
        if (m.round !== maxRound) continue;
        if (m.p1 >= 0) t.finalists.add(m.p1);
        if (m.p2 >= 0) t.finalists.add(m.p2);
        if (m.st === 0 && m.w >= 0 && m.l >= 0) completedFinals.push(m);
      }
      completedFinals.sort((a, b) => a.ident - b.ident);
      const decidingFinal = completedFinals[completedFinals.length - 1];
      if (decidingFinal) {
        t.finalMatchWinner = decidingFinal.w;
        t.finalMatchLoser = decidingFinal.l;
      }
      // A manually corrected result can identify a finalist that the unfinished
      // Challonge final left as a placeholder.
      for (const wi of t.winners) t.finalists.add(wi);
    }

    const isDE = t.type === 'DE';
    for (const p of t.parts) {
      if (p.isWinner) { p.progress = 1e9; continue; }
      // A no-winner override can disqualify the team that won the played final
      // without awarding the opponent the tournament. Preserve the actual
      // match order while withholding the Winner designation.
      if (!t.winners.length && p.pi === t.finalMatchWinner) {
        p.progress = 1e8;
        continue;
      }
      if (t.type === 'RR') {
        p.progress = p.w + (p.gw - p.gl) / 1e4;
        continue;
      }
      const lossRounds = [];
      for (const m of t.matches) {
        if (m.st === 0 && m.l === p.pi) lossRounds.push(m.round);
      }
      const lb = lossRounds.filter((r) => r < 0);
      const wb = lossRounds.filter((r) => r > 0);
      if (isDE) {
        if (lb.length) p.progress = Math.max(...lb.map((r) => -r));
        else if (wb.includes(maxRound)) p.progress = 1e6; // grand-final loser
        else if (wb.length) p.progress = Math.max(0.5, 2 * (Math.max(...wb) - 1) - 0.5);
        else p.progress = p.w > 0 ? 0.75 : 0;
      } else {
        if (wb.length) p.progress = Math.max(...wb);
        else p.progress = p.w > 0 ? maxRound - 0.5 : 0;
      }
    }
    for (const p of t.parts) {
      let better = 0, same = 0;
      for (const q of t.parts) {
        if (q.progress > p.progress) better += 1;
        else if (q.progress === p.progress) same += 1;
      }
      p.placement = better + 1;
      p.tied = same > 1;
    }
  }

  const tournaments = D.tournaments.map((raw, ti) => {
    const parts = raw.parts.map(([seed, name, members, rawMembers], pi) => ({
      pi, seed, name, members, rawMembers: rawMembers || [],
      uids: members.filter((m) => typeof m === 'number'),
      w: 0, l: 0, gw: 0, gl: 0,
      progress: 0, placement: null, tied: false, isWinner: false,
    }));
    const matches = raw.matches.map(([ident, round, p1, p2, w, s1, s2, pr1, pr2, st]) => ({
      ident, round, p1, p2, w,
      l: w >= 0 ? (w === p1 ? p2 : p1) : -1,
      s1, s2, pr1, pr2, st,
    }));
    const t = {
      ti, slug: raw.slug, url: raw.url, title: raw.title, date: raw.date,
      groupIdx: raw.g, go: raw.go || 0, bracketKind: raw.bk, version: raw.v,
      session: raw.s, teamSize: raw.ts, type: raw.type, winnerSource: raw.ws,
      parts, matches, winners: raw.winners.filter((i) => i >= 0),
      override: raw.override,
      year: +raw.date.slice(0, 4),
      maxRound: 0, minRound: 0,
    };
    computeTournamentStats(t);
    groups[raw.g].tournaments.push(t);
    return t;
  });

  const bySlug = new Map(tournaments.map((t) => [t.slug, t]));

  for (const g of groups) {
    g.tournaments.sort((a, b) => a.go - b.go);
    g.date = g.tournaments.reduce((d, t) => (d && d < t.date ? d : t.date), '');
    g.year = +g.date.slice(0, 4);
  }
  const groupsByDate = groups.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.idx - b.idx);

  /* ---------- player aggregates (over a tournament subset) ---------- */

  function buildAggregates(list) {
    const agg = new Map();
    function getAgg(uid) {
      let a = agg.get(uid);
      if (!a) {
        a = {
          uid, entries: [], wins: [], finals: 0, finalWins: 0, finalLosses: 0,
          mw: 0, ml: 0,
          groupsSet: new Set(),
          mates: new Map(), opp: new Map(),
          bestWinStreak: 0, currentWinStreak: 0, currentEntryStreak: 0, bestPlacement: Infinity,
          first: null, last: null,
        };
        agg.set(uid, a);
      }
      return a;
    }

    // `list` is in date order (tournaments array is date-sorted), so
    // entries/results are appended in chronological order.
    for (const t of list) {
      for (const p of t.parts) {
        const uidSet = new Set(p.uids);
        for (const uid of uidSet) {
          const a = getAgg(uid);
          a.entries.push({ ti: t.ti, pi: p.pi });
          a.groupsSet.add(t.groupIdx);
          if (p.isWinner) a.wins.push(t.ti);
          if (t.finalists.has(p.pi)) {
            a.finals += 1;
            if (p.isWinner || (!t.winners.length && p.pi === t.finalMatchWinner)) a.finalWins += 1;
            else a.finalLosses += 1;
          }
          if (p.placement < a.bestPlacement) a.bestPlacement = p.placement;
          if (a.first === null || t.date < a.first) a.first = t.date;
          if (a.last === null || t.date > a.last) a.last = t.date;
          for (const v of uidSet) {
            if (v === uid) continue;
            let m = a.mates.get(v);
            if (!m) { m = { n: 0, wins: 0, w: 0, l: 0 }; a.mates.set(v, m); }
            m.n += 1;
            if (p.isWinner) m.wins += 1;
            m.w += p.w; m.l += p.l;
          }
        }
      }
      for (const m of t.matches) {
        if (m.st !== 0 || m.w < 0 || m.l < 0) continue;
        const wU = new Set(t.parts[m.w].uids);
        const lU = new Set(t.parts[m.l].uids);
        for (const u of wU) {
          const a = getAgg(u);
          a.mw += 1;
        }
        for (const u of lU) {
          const a = getAgg(u);
          a.ml += 1;
        }
        for (const u of wU) {
          const a = getAgg(u);
          for (const v of lU) {
            let o = a.opp.get(v);
            if (!o) { o = { w: 0, l: 0 }; a.opp.set(v, o); }
            o.w += 1;
          }
        }
        for (const v of lU) {
          const a = getAgg(v);
          for (const u of wU) {
            let o = a.opp.get(u);
            if (!o) { o = { w: 0, l: 0 }; a.opp.set(u, o); }
            o.l += 1;
          }
        }
      }
    }

    const eligibleGroupSet = new Set(list.map((t) => t.groupIdx));
    const eligibleGroups = groupsByDate.filter((g) => eligibleGroupSet.has(g.idx)).map((g) => g.idx);
    for (const a of agg.values()) {
      // consecutive bracket entries won (entries are in date order)
      let trun = 0, tbest = 0;
      for (const e of a.entries) {
        trun = tournaments[e.ti].parts[e.pi].isWinner ? trun + 1 : 0;
        if (trun > tbest) tbest = trun;
      }
      a.bestWinStreak = tbest;
      let currentWins = 0;
      for (let i = a.entries.length - 1; i >= 0; i--) {
        const e = a.entries[i];
        if (!tournaments[e.ti].parts[e.pi].isWinner) break;
        currentWins += 1;
      }
      a.currentWinStreak = currentWins;
      // Consecutive eligible events entered through the latest event in the
      // selected TBC version/team-size scope. Missing the latest event means
      // the player's entry streak is no longer active.
      let continuous = 0;
      for (let i = eligibleGroups.length - 1; i >= 0 && a.groupsSet.has(eligibleGroups[i]); i--) {
        continuous += 1;
      }
      a.currentEntryStreak = continuous;
      a.matches = a.mw + a.ml;
      a.winRate = a.matches ? a.mw / a.matches : 0;
      a.events = a.groupsSet.size;
    }
    return agg;
  }

  const aggCache = new Map();
  function aggregatesFor(version, teamSize) {
    const key = (version || 'all') + '|' + (teamSize || 'all');
    let res = aggCache.get(key);
    if (!res) {
      const list = tournaments.filter((t) =>
        (version === 'all' || t.version === version) &&
        (teamSize === 'all' || t.teamSize === teamSize));
      res = buildAggregates(list);
      aggCache.set(key, res);
    }
    return res;
  }

  const agg = aggregatesFor('all', 'all');

  /* ---------- site-wide series ---------- */
  const years = [];
  {
    const y0 = Math.min(...tournaments.map((t) => t.year));
    const y1 = Math.max(...tournaments.map((t) => t.year));
    for (let y = y0; y <= y1; y++) years.push(y);
  }
  const bracketsPerYear = years.map((y) => tournaments.filter((t) => t.year === y).length);
  const matchesPerYear = years.map((y) =>
    tournaments.filter((t) => t.year === y).reduce((n, t) => n + t.matches.length, 0));

  const totalMatches = tournaments.reduce((n, t) => n + t.matches.length, 0);
  const totalEntries = tournaments.reduce((n, t) => n + t.parts.length, 0);

  /* ---------- label helpers ---------- */
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function placementLabel(t, p) {
    if (p.placement == null) return '';
    if (p.isWinner) return 'Winner';
    if (p.placement === 2 && !p.tied) return t.type === 'RR' ? 'Runner-up' : 'Finalist';
    if (t.type === 'SE' && p.placement > 2 && p.progress === t.maxRound - 1) return 'Semifinalist';
    return (p.tied ? 'T-' : '') + ordinal(p.placement);
  }

  function roundName(t, round) {
    if (t.type === 'RR') return 'Round ' + round;
    if (round < 0) {
      const r = -round;
      return (r === -t.minRound ? 'Losers Final' : 'Losers Round ' + r);
    }
    if (t.type === 'DE') {
      if (round === t.maxRound) return 'Grand Finals';
      if (round === t.maxRound - 1) return 'Winners Final';
      return 'Winners Round ' + round;
    }
    const fromEnd = t.maxRound - round;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return 'Round ' + round;
  }

  const TYPE_NAMES = { SE: 'Single elimination', DE: 'Double elimination', RR: 'Round robin' };

  /* Lay out a bracket from its prerequisite tree rather than packing each
     round independently. A missing prerequisite is a real reserved branch:
     that is where a player entering after a bye would have come from. */
  function bracketTreeLayout(matches) {
    const byId = new Map(matches.map((m) => [m.ident, m]));
    const referenced = new Set();
    for (const m of matches) {
      if (m.pr1 != null && byId.has(m.pr1)) referenced.add(m.pr1);
      if (m.pr2 != null && byId.has(m.pr2)) referenced.add(m.pr2);
    }
    const roots = matches.filter((m) => !referenced.has(m.ident))
      .sort((a, b) => b.round - a.round || a.ident - b.ident);
    const positions = new Map();
    const visiting = new Set();
    let slot = 0;

    function place(m) {
      if (positions.has(m.ident)) return positions.get(m.ident);
      if (visiting.has(m.ident)) return slot++;
      visiting.add(m.ident);
      const children = [m.pr1, m.pr2].map((id) => id != null ? byId.get(id) : null);
      let y;
      if (!children[0] && !children[1]) {
        y = slot++;
      } else {
        const ys = children.map((child) => child ? place(child) : slot++);
        y = (ys[0] + ys[1]) / 2;
      }
      visiting.delete(m.ident);
      positions.set(m.ident, y);
      return y;
    }

    for (const root of roots) {
      place(root);
      slot += 0.5;
    }
    for (const m of matches.slice().sort((a, b) => b.round - a.round || a.ident - b.ident)) {
      if (!positions.has(m.ident)) place(m);
    }
    // Challonge represents some double-elimination reset matches in the same
    // round and points both prerequisites at the preceding final. Keep those
    // cards from occupying the exact same slot.
    for (const round of new Set(matches.map((m) => m.round))) {
      const column = matches.filter((m) => m.round === round)
        .sort((a, b) => positions.get(a.ident) - positions.get(b.ident) || a.ident - b.ident);
      let next = -Infinity;
      for (const m of column) {
        const y = Math.max(positions.get(m.ident), next);
        positions.set(m.ident, y);
        next = y + 1;
      }
    }
    return { positions, slots: Math.max(slot, 1) };
  }

  window.TBC = {
    players, groups, groupsByDate, tournaments, bySlug,
    agg, aggregatesFor,
    years, bracketsPerYear, matchesPerYear,
    totalMatches, totalEntries,
    ordinal, placementLabel, roundName,
    TYPE_NAMES, bracketTreeLayout,
    generated: D.generated,
  };
})();
