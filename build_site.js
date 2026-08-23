#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'tournaments');
const OUTPUT = path.resolve(ROOT, process.argv[2] || '_site');
const TOURNAMENT_OUTPUT = path.join(OUTPUT, 'tournaments');
const SITE_ROOT = '/tbstuff/tournaments/';
const SITE_URL = 'https://kan18.github.io' + SITE_ROOT;
const VERIFICATION = 'CNpWqxAAkmswUKkLBD4EyCJyF_xivjd2ne_-my1stWY';

if (OUTPUT === ROOT || !OUTPUT.startsWith(ROOT + path.sep)) {
  throw new Error('The output directory must be a child of the repository root.');
}

global.window = global;
require(path.join(SOURCE, 'data.js'));
require(path.join(SOURCE, 'compute.js'));
const TBC = global.TBC;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function fmtSpan(span) {
  if (!span) return '';
  const [start, end] = span.split('..');
  if (!end || start === end) return fmtDate(start);
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  if (startYear === endYear) {
    return `${MONTHS[startMonth - 1]} ${startDay} – ${MONTHS[endMonth - 1]} ${endDay}, ${startYear}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

const VERSION_LABEL = { tbc1: 'TBC1', tbc2: 'TBC2' };
const BRACKET_SHORT = { 'hunts-bracket': 'HB', 'non-hunts-bracket': '', combined: '' };

function bracketLabel(tournament) {
  const bits = [];
  if (tournament.session !== 'unknown') bits.push(`Session ${tournament.session}`);
  if (BRACKET_SHORT[tournament.bracketKind]) bits.push(BRACKET_SHORT[tournament.bracketKind]);
  if (tournament.teamSize !== 'unknown') bits.push(tournament.teamSize);
  if (tournament.type !== 'SE') bits.push(tournament.type);
  return bits.join(' · ') || tournament.type;
}

function tournamentHref(tournament) {
  return `${SITE_ROOT}t/${encodeURIComponent(tournament.slug)}/`;
}

function playerHref(uid) {
  const player = TBC.players.get(uid);
  return `${SITE_ROOT}p/${encodeURIComponent(player.route)}/`;
}

function playerLink(uid, label) {
  const player = TBC.players.get(uid);
  if (!player) return esc(label || uid);
  return `<a href="${playerHref(uid)}">${esc(label || player.username)}</a>`;
}

function entryHtml(part) {
  if (part.rawMembers?.length) {
    return part.rawMembers.map(([name, uid]) => {
      if (uid != null && TBC.players.has(uid)) return playerLink(uid, name || TBC.players.get(uid).username);
      return `<span class="unres">${esc(name || '?')}</span>`;
    }).join(' <span class="mut">&amp;</span> ');
  }
  return esc(part.name);
}

function wlHtml(wins, losses) {
  return `<span class="wl nowrap"><span class="w">${wins.toLocaleString('en-US')}</span>` +
    `<span class="mut">–</span><span class="l">${losses.toLocaleString('en-US')}</span></span>`;
}

function resultBadge(tournament, part) {
  const label = TBC.placementLabel(tournament, part);
  if (part.isWinner) return '<span class="badge b-win">🏆 Winner</span>';
  if (label === 'Finalist' || label === 'Runner-up') return `<span class="badge b-2">${esc(label)}</span>`;
  return `<span class="badge">${esc(label)}</span>`;
}

function statTile(label, value, note, gold = false) {
  return `<div class="tile${gold ? ' gold' : ''}"><div class="t-label">${esc(label)}</div>` +
    `<div class="t-value">${value}</div>${note ? `<div class="t-note">${note}</div>` : ''}</div>`;
}

function scoreText(value) {
  if (value == null) return '–';
  if (value === -1) return 'FF';
  return Math.abs(value) > 50 ? '–' : String(value);
}

function pageShell({ active = '', title, description, canonicalPath, content }) {
  const fullTitle = title === 'Tower Battles Tournament Archive'
    ? title
    : `${title} — Tower Battles Tournament Archive`;
  const canonical = 'https://kan18.github.io' + canonicalPath;
  const nav = [
    ['home', SITE_ROOT, 'Home'],
    ['events', SITE_ROOT + 'events/', 'Events'],
    ['players', SITE_ROOT + 'players/', 'Players'],
    ['videos', SITE_ROOT + 'videos/', 'Videos'],
  ].map(([key, href, label]) =>
    `<a href="${href}" data-nav="${key}"${active === key ? ' class="active"' : ''}>${label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="${VERIFICATION}">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏆</text></svg>">
<link rel="stylesheet" href="${SITE_ROOT}style.css">
<script>
(function () {
  var theme = null;
  try { theme = localStorage.getItem('tbc-theme'); } catch (error) {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
</script>
<noscript><style>.searchbox,.theme-btn{display:none}</style></noscript>
</head>
<body>
<header class="site-header">
  <div class="bar">
    <a class="brand" href="${SITE_ROOT}">Tower Battles Tournament Archive</a>
    <nav class="site-nav" id="site-nav">${nav}</nav>
    <div class="searchbox">
      <input id="search" type="search" placeholder="Search players &amp; tournaments…" autocomplete="off" spellcheck="false"
        role="combobox" aria-label="Search" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false">
      <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
    </div>
    <button class="theme-btn" id="theme-btn" title="Toggle light/dark theme" aria-label="Toggle theme">◐</button>
  </div>
</header>
<main id="view">${content}</main>
<footer class="site-footer">
  <div class="footer-inner">
    Maintained by Kan181. Thanks to KosHap, Bizkopt, HubHx, TastyAstral,
    Newcomer20062007, fiheron, mathematice, and GPT-5.6 for helping locate brackets and videos.
  </div>
</footer>
<dialog class="video-modal" id="video-modal" aria-labelledby="video-modal-title">
  <div class="video-modal-head">
    <div><div class="video-modal-kicker" id="video-modal-kicker"></div><h2 id="video-modal-title">Match video</h2></div>
    <button class="video-modal-close" id="video-modal-close" type="button" aria-label="Close video">×</button>
  </div>
  <div class="video-parts" id="video-parts" hidden></div>
  <div class="video-embed" id="video-embed"></div>
  <p class="video-modal-note" id="video-modal-note" hidden></p>
  <p class="video-external"><a id="video-external" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></p>
</dialog>
<script src="${SITE_ROOT}data.js"></script>
<script src="${SITE_ROOT}predictions.js"></script>
<script src="${SITE_ROOT}compute.js"></script>
<script src="${SITE_ROOT}app.js"></script>
</body>
</html>
`;
}

function homeContent() {
  const champions = [...TBC.agg.values()]
    .sort((left, right) => right.wins.length - left.wins.length || right.mw - left.mw)
    .slice(0, 14);
  const recentGroups = TBC.groupsByDate.slice(-6).reverse();

  const championRows = champions.map((record, index) =>
    `<tr><td class="rank">${index + 1}</td><td>${playerLink(record.uid)}</td>` +
    `<td class="num">${record.wins.length}</td><td class="num">${wlHtml(record.mw, record.ml)}</td></tr>`
  ).join('');

  const recent = recentGroups.map((group) =>
    `<div class="event-row"><div class="e-date">${esc(fmtSpan(group.span))}</div>` +
    `<div class="e-title">${esc(group.title)}</div><div class="chips">` +
    group.tournaments.map((tournament) =>
      `<a class="chip accent" href="${tournamentHref(tournament)}">${esc(bracketLabel(tournament))}</a>`
    ).join('') + '</div></div>'
  ).join('');

  return `<h1>Tower Battles tournament archive</h1>
<p class="lede">Search Tower Battles tournament results, brackets, champions, player records, match scores, ratings, and videos from 2018 onward.</p>
<div class="kpis">
  ${statTile('Events', TBC.groups.length.toLocaleString('en-US'), 'grouped tournament sessions')}
  ${statTile('Brackets', TBC.tournaments.length.toLocaleString('en-US'))}
  ${statTile('Players', TBC.players.size.toLocaleString('en-US'), 'player records')}
  ${statTile('Matches', TBC.totalMatches.toLocaleString('en-US'))}
  ${statTile('Team entries', TBC.totalEntries.toLocaleString('en-US'))}
</div>
<div class="grid-2 section">
  <div class="card"><h2>Most tournament wins</h2><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th class="rank">#</th><th>Player</th><th class="num">Wins</th><th class="num">Match record</th></tr></thead>
    <tbody>${championRows}</tbody></table></div>
    <p class="small" style="margin-bottom:0"><a href="${SITE_ROOT}players/">All player records →</a></p>
  </div>
  <div class="card"><h2>Latest events</h2>${recent}
    <p class="small" style="margin-bottom:0"><a href="${SITE_ROOT}events/">All events →</a></p>
  </div>
</div>`;
}

function eventsContent() {
  const rows = TBC.groupsByDate.slice().reverse().map((group) => {
    const winners = [];
    for (const tournament of group.tournaments) {
      for (const winnerIndex of tournament.winners) {
        const prefix = group.tournaments.length > 1
          ? `<span class="mut">${esc(bracketLabel(tournament))}:</span> `
          : '';
        winners.push(`<div class="e-champ">🏆 ${prefix}${entryHtml(tournament.parts[winnerIndex])}</div>`);
      }
    }
    return `<div class="event-row"><div class="e-date">${esc(fmtSpan(group.span))} · ${VERSION_LABEL[group.tournaments[0].version]}</div>` +
      `<div class="e-title">${esc(group.title)}</div><div class="chips">` +
      group.tournaments.map((tournament) =>
        `<a class="chip accent" href="${tournamentHref(tournament)}">${esc(bracketLabel(tournament))}</a>`
      ).join('') + `</div>${winners.join('')}</div>`;
  }).join('');

  return `<h1>Events</h1>
<p class="lede">All ${TBC.groups.length.toLocaleString('en-US')} recorded Tower Battles events, newest first.</p>
<div class="card">${rows}</div>`;
}

function tournamentContent(tournament) {
  const group = TBC.groups[tournament.groupIdx];
  const championNames = tournament.winners.map((index) => entryHtml(tournament.parts[index]));
  const chips = [
    `<span class="chip">📅 ${esc(fmtDate(tournament.date))}</span>`,
    `<span class="chip">${VERSION_LABEL[tournament.version]}</span>`,
  ];
  if (tournament.session !== 'unknown') chips.push(`<span class="chip">Session ${esc(tournament.session)}</span>`);
  if (tournament.bracketKind === 'hunts-bracket') chips.push('<span class="chip">Huntsman bracket</span>');
  if (tournament.teamSize !== 'unknown') chips.push(`<span class="chip">${esc(tournament.teamSize)}</span>`);
  chips.push(`<span class="chip">${esc(TBC.TYPE_NAMES[tournament.type] || tournament.type)}</span>`);
  chips.push(`<span class="chip">${tournament.parts.length} entries</span>`);
  for (const [index, url] of group.documents.entries()) {
    const label = group.documents.length > 1 ? `Tournament doc ${index + 1} ↗` : 'Tournament doc ↗';
    chips.push(`<a class="chip" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`);
  }
  chips.push(`<a class="chip" href="${esc(tournament.url)}" target="_blank" rel="noopener">Challonge ↗</a>`);

  const siblingLinks = group.tournaments.length > 1
    ? `<div class="chips" style="margin-top:10px">${group.tournaments.map((sibling) =>
      `<a class="chip${sibling === tournament ? ' cur' : ''}" href="${tournamentHref(sibling)}">${esc(bracketLabel(sibling))}</a>`
    ).join('')}</div>`
    : '';

  const champion = championNames.length
    ? `<div class="champ-card"><div class="cup">🏆</div><div><div class="c-label">Champion${championNames.length > 1 ? 's' : ''}</div>` +
      `<div class="c-names">${championNames.join(' <span class="mut">and</span> ')}</div></div></div>`
    : '';

  const warning = tournament.override
    ? `<div class="callout"><div class="co-title">⚠️ Result note</div><div>${esc(tournament.override.reason || 'The recorded result was adjusted manually.')}</div></div>`
    : '';

  const entries = tournament.parts.slice()
    .sort((left, right) => left.placement - right.placement || (left.seed ?? 9999) - (right.seed ?? 9999))
    .map((part) => `<tr><td class="rank">${part.placement}${part.tied ? '<span class="mut">T</span>' : ''}</td>` +
      `<td>${entryHtml(part)}</td><td class="num">${part.seed == null ? '–' : part.seed}</td>` +
      `<td class="num">${wlHtml(part.w, part.l)}</td><td>${resultBadge(tournament, part)}</td></tr>`)
    .join('');

  const matches = tournament.matches.slice().sort((left, right) =>
    Number(left.isGroup) - Number(right.isGroup) ||
    String(left.groupName || '').localeCompare(String(right.groupName || '')) ||
    left.round - right.round || left.key - right.key
  ).map((match) => {
    const side = (participantIndex, sideIndex) => {
      if (participantIndex < 0) return '<span class="mut">—</span>';
      const links = (match.videos?.[sideIndex] || []).map(([url], index) =>
        `<a class="small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Video${match.videos[sideIndex].length > 1 ? ` ${index + 1}` : ''} ↗</a>`
      ).join(' · ');
      return `${entryHtml(tournament.parts[participantIndex])}${links ? `<div>${links}</div>` : ''}`;
    };
    const score = match.st !== 0 ? '<span class="mut">open</span>' : `${scoreText(match.s1)}–${scoreText(match.s2)}`;
    return `<tr><td class="mut small nowrap">${esc(TBC.roundName(tournament, match.round))}</td>` +
      `<td>${side(match.p1, 0)}</td><td class="num nowrap">${score}</td><td>${side(match.p2, 1)}</td></tr>`;
  }).join('');

  return `<div class="crumb"><a href="${SITE_ROOT}events/">Events</a> / ${esc(group.title)}</div>
<h1>${esc(tournament.title)}</h1>
<p class="lede">Results, entrants, and match history for this ${esc(bracketLabel(tournament))} tournament.</p>
<div class="chips">${chips.join('')}</div>${siblingLinks}${champion}${warning}
<div class="card section"><h2>Entries and results</h2><div class="tbl-wrap"><table class="tbl">
  <thead><tr><th class="rank">#</th><th>Entry</th><th class="num">Seed</th><th class="num">W–L</th><th>Result</th></tr></thead>
  <tbody>${entries}</tbody></table></div></div>
<div class="card section"><h2>All matches</h2><div class="tbl-wrap"><table class="tbl">
  <thead><tr><th>Round</th><th>Entry 1</th><th class="num">Score</th><th>Entry 2</th></tr></thead>
  <tbody>${matches}</tbody></table></div></div>`;
}

function playerContent(player) {
  const record = TBC.agg.get(player.id) || {
    entries: [], wins: [], finals: 0, finalWins: 0, finalLosses: 0,
    mw: 0, ml: 0, matches: 0, events: 0, first: null, last: null,
  };
  const displayName = player.display.toLowerCase() !== player.username.toLowerCase()
    ? `Display name: ${esc(player.display)} · `
    : '';
  const profile = typeof player.id === 'number'
    ? `<a href="https://www.roblox.com/users/${player.id}/profile" target="_blank" rel="noopener">Roblox profile ↗</a>`
    : 'Roblox account unresolved';
  const activity = record.entries.length
    ? `Active ${esc(fmtDate(record.first))}${record.first === record.last ? '' : ` – ${esc(fmtDate(record.last))}`}`
    : 'No recorded tournament appearances';

  const history = record.entries.slice().reverse().map((entry) => {
    const tournament = TBC.tournaments[entry.ti];
    const part = tournament.parts[entry.pi];
    return `<tr><td class="mut small nowrap">${esc(fmtDate(tournament.date))}</td>` +
      `<td><a href="${tournamentHref(tournament)}">${esc(tournament.title)}</a><span class="metric-sub">${esc(bracketLabel(tournament))}</span></td>` +
      `<td>${entryHtml(part)}</td><td class="num">${wlHtml(part.w, part.l)}</td><td>${resultBadge(tournament, part)}</td></tr>`;
  }).join('');

  return `<div class="crumb"><a href="${SITE_ROOT}players/">Players</a></div>
<div class="player-head"><div><h1>${esc(player.username)}</h1><div class="p-sub">${displayName}${activity} · ${profile}</div></div></div>
<div class="kpis">
  ${statTile('Wins', record.wins.length.toLocaleString('en-US'), 'tournament brackets won', record.wins.length > 0)}
  ${statTile('Finals record', wlHtml(record.finalWins, record.finalLosses), `${record.finals.toLocaleString('en-US')} actual finals`)}
  ${statTile('Match record', wlHtml(record.mw, record.ml), record.matches ? `${((record.mw / record.matches) * 100).toFixed(1)}% win rate` : '')}
  ${statTile('Events', record.events.toLocaleString('en-US'), `${record.entries.length.toLocaleString('en-US')} bracket entries`)}
</div>
<div class="card section"><h2>Tournament history</h2><div class="tbl-wrap"><table class="tbl">
  <thead><tr><th>Date</th><th>Tournament</th><th>Entry</th><th class="num">W–L</th><th>Result</th></tr></thead>
  <tbody>${history || '<tr><td colspan="5" class="mut">No tournament history.</td></tr>'}</tbody>
</table></div></div>`;
}

function playersContent() {
  const records = [...TBC.agg.values()].sort((left, right) =>
    right.wins.length - left.wins.length || right.mw - left.mw ||
    left.bestPlacement - right.bestPlacement ||
    TBC.players.get(left.uid).username.localeCompare(TBC.players.get(right.uid).username)
  );
  const rows = records.map((record, index) => {
    const player = TBC.players.get(record.uid);
    return `<tr><td class="rank">${index + 1}</td><td>${playerLink(player.id)}` +
      `${player.display.toLowerCase() !== player.username.toLowerCase() ? `<span class="metric-sub">${esc(player.display)}</span>` : ''}</td>` +
      `<td class="num">${record.wins.length || '–'}</td><td class="num">${wlHtml(record.mw, record.ml)}</td>` +
      `<td class="num">${record.entries.length}<span class="metric-sub">${record.events} events</span></td>` +
      `<td class="mut small nowrap">${esc(fmtDate(record.last))}</td></tr>`;
  }).join('');

  return `<h1>Players</h1>
<p class="lede">Tournament history and records for ${records.length.toLocaleString('en-US')} Tower Battles players.</p>
<div class="card"><div class="tbl-wrap"><table class="tbl">
  <thead><tr><th class="rank">#</th><th>Player</th><th class="num">Wins</th><th class="num">Match record</th><th class="num">Entries</th><th>Last seen</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div></div>`;
}

function videoMatches() {
  const result = [];
  for (const tournament of TBC.tournaments) {
    for (const match of tournament.matches) {
      const count = (match.videos?.[0]?.length || 0) + (match.videos?.[1]?.length || 0);
      if (count) result.push({ tournament, match, count });
    }
  }
  return result.sort((left, right) =>
    right.tournament.date.localeCompare(left.tournament.date) ||
    right.tournament.ti - left.tournament.ti || right.match.key - left.match.key
  );
}

function videosContent() {
  const matchesWithVideos = videoMatches();
  const cards = matchesWithVideos.map(({ tournament, match, count }) => {
    const matchup = [match.p1, match.p2].map((participantIndex) =>
      participantIndex >= 0 ? entryHtml(tournament.parts[participantIndex]) : '<span class="mut">TBD</span>'
    );
    const rows = [0, 1].flatMap((side) => (match.videos?.[side] || []).map(([url, note], index) => {
      const participantIndex = side === 0 ? match.p1 : match.p2;
      const label = participantIndex >= 0 ? entryHtml(tournament.parts[participantIndex]) : 'Unknown participant';
      return `<div class="video-row"><span>${label}</span><a class="video-watch" href="${esc(url)}" target="_blank" rel="noopener noreferrer">` +
        `Watch video${(match.videos?.[side]?.length || 0) > 1 ? ` ${index + 1}` : ''} ↗</a>` +
        `${note ? `<span class="mut small">${esc(note)}</span>` : ''}</div>`;
    })).join('');
    return `<article class="video-card"><div class="video-card-meta">${esc(fmtDate(tournament.date))} · ${esc(bracketLabel(tournament))} · ` +
      `${esc(TBC.roundName(tournament, match.round))} · Match ${match.ident}</div>` +
      `<h2><a href="${tournamentHref(tournament)}">${esc(tournament.title)}</a></h2>` +
      `<div class="video-matchup">${matchup[0]}<span class="mut">vs.</span>${matchup[1]}</div>` +
      `<div class="video-list">${rows}</div><div class="video-card-count">${count} video${count === 1 ? '' : 's'}</div></article>`;
  }).join('');

  return `<h1>Match videos</h1>
<p class="lede">Player-perspective recordings for ${matchesWithVideos.length.toLocaleString('en-US')} archived matches.</p>
<div class="video-grid">${cards}</div>`;
}

function safeRoute(value, kind) {
  if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`Unsafe ${kind} route: ${value}`);
  return value;
}

function writePage(segments, html) {
  const directory = path.join(TOURNAMENT_OUTPUT, ...segments);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), html);
}

function copyPublishedSources() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(TOURNAMENT_OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, '.nojekyll'), '');

  for (const directory of ['farmer', 'phaser']) {
    const source = path.join(ROOT, directory);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(OUTPUT, directory), { recursive: true });
  }
  for (const file of ['app.js', 'compute.js', 'data.js', 'predictions.js', 'ratings.js', 'style.css']) {
    fs.copyFileSync(path.join(SOURCE, file), path.join(TOURNAMENT_OUTPUT, file));
  }
}

function build() {
  copyPublishedSources();

  writePage([], pageShell({
    active: 'home',
    title: 'Tower Battles Tournament Archive',
    description: `Search ${TBC.groups.length} Tower Battles events, ${TBC.tournaments.length} brackets, player records, match results, ratings, and tournament videos.`,
    canonicalPath: SITE_ROOT,
    content: homeContent(),
  }));
  writePage(['events'], pageShell({
    active: 'events',
    title: 'Tower Battles Events',
    description: `Browse all ${TBC.groups.length} archived Tower Battles tournament events, brackets, champions, dates, and formats.`,
    canonicalPath: SITE_ROOT + 'events/',
    content: eventsContent(),
  }));
  writePage(['players'], pageShell({
    active: 'players',
    title: 'Tower Battles Player Records',
    description: `Browse tournament histories, wins, match records, and event appearances for ${TBC.agg.size} Tower Battles players.`,
    canonicalPath: SITE_ROOT + 'players/',
    content: playersContent(),
  }));
  writePage(['videos'], pageShell({
    active: 'videos',
    title: 'Tower Battles Match Videos',
    description: 'Watch archived player-perspective videos from Tower Battles tournament matches.',
    canonicalPath: SITE_ROOT + 'videos/',
    content: videosContent(),
  }));

  for (const tournament of TBC.tournaments) {
    const route = safeRoute(tournament.slug, 'tournament');
    const champion = tournament.winners.map((index) => tournament.parts[index].name).join(' and ');
    const description = `Results, entrants, match history, and bracket details for ${tournament.title} on ${fmtDate(tournament.date)}` +
      `${champion ? `. Champion${tournament.winners.length > 1 ? 's' : ''}: ${champion}.` : '.'}`;
    writePage(['t', route], pageShell({
      active: 'events',
      title: tournament.title,
      description,
      canonicalPath: tournamentHref(tournament),
      content: tournamentContent(tournament),
    }));
  }

  for (const player of TBC.players.values()) {
    const route = safeRoute(player.route, 'player');
    const record = TBC.agg.get(player.id);
    const description = record
      ? `${player.username}'s Tower Battles tournament history: ${record.wins.length} bracket ${record.wins.length === 1 ? 'win' : 'wins'}, ${record.entries.length} entries, and a ${record.mw}–${record.ml} match record.`
      : `${player.username}'s Tower Battles tournament profile.`;
    writePage(['p', route], pageShell({
      active: 'players',
      title: `${player.username} Tournament Record`,
      description,
      canonicalPath: playerHref(player.id),
      content: playerContent(player),
    }));
  }

  const urls = [
    SITE_URL,
    SITE_URL + 'events/',
    SITE_URL + 'players/',
    SITE_URL + 'videos/',
    ...TBC.tournaments.map((tournament) => 'https://kan18.github.io' + tournamentHref(tournament)),
    ...[...TBC.players.values()].map((player) => 'https://kan18.github.io' + playerHref(player.id)),
  ];
  const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((url) => `  <url><loc>${esc(url)}</loc><lastmod>${esc(TBC.generated)}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(TOURNAMENT_OUTPUT, 'sitemap.xml'), sitemap);

  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT),
    events: TBC.groups.length,
    tournaments: TBC.tournaments.length,
    players: TBC.players.size,
    sitemapUrls: urls.length,
  }, null, 2));
}

build();
