// Renders assets/board.svg: a split-flap departures board fed by live GitHub data.
// Usage: GITHUB_TOKEN=... node scripts/board.mjs [--offline data.json]
import { readFileSync, writeFileSync } from 'node:fs';

const OWNER = 'lennix1337';
const FLIGHTS = [
  ['GX18', 'Genexus18MCP', 'GENEXUS MCP'],
  ['OPTC', 'pi-optchat', 'AGENT MEMORY'],
  ['GWAT', 'pi-gitwatch', 'CI WATCHER'],
  ['MACC', 'pi-multi-account', 'QUOTA ROUTER'],
  ['SUBA', 'pi-subagents', 'AGENT CREW'],
  ['GOAL', 'pi-goal-x', 'GOAL PLANNER'],
  ['VALT', 'pi-vault', 'SECRET VAULT'],
];
const DAY = 86_400_000;
const TZ = 'America/Sao_Paulo';

async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function version(full, branch) {
  const release = await gh(`repos/${full}/releases/latest`);
  if (release?.tag_name) return release.tag_name.replace(/^v/, '');
  const pkg = await gh(`repos/${full}/contents/package.json?ref=${branch}`);
  return pkg ? JSON.parse(Buffer.from(pkg.content, 'base64').toString()).version ?? '-' : '-';
}

function status(run) {
  if (!run) return 'SCHEDULED';
  if (run.status !== 'completed') return 'BOARDING';
  return run.conclusion === 'success' ? 'ON TIME' : run.conclusion === 'failure' ? 'DELAYED' : 'HOLD';
}

async function collect(now) {
  const since = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const rows = [];
  for (const [code, name, dest] of FLIGHTS) {
    const full = `${OWNER}/${name}`;
    const repo = await gh(`repos/${full}`);
    if (!repo) continue;
    const branch = repo.default_branch;
    const [runs, merged, ver] = await Promise.all([
      gh(`repos/${full}/actions/runs?branch=${branch}&event=push&per_page=1`),
      gh(`search/issues?q=${encodeURIComponent(`repo:${full} is:pr is:merged merged:>=${since}`)}&per_page=1`),
      version(full, branch),
    ]);
    rows.push({ code, dest, pushed: repo.pushed_at, version: ver, prs: merged?.total_count ?? 0, status: status(runs?.workflow_runs?.[0]) });
  }
  const total = await gh(`search/issues?q=${encodeURIComponent(`author:${OWNER} is:pr is:merged is:public merged:>=${since}`)}&per_page=1`);
  rows.sort((a, b) => b.pushed.localeCompare(a.pushed));
  return { rows, merged30: total?.total_count ?? 0, updated: new Date(now).toISOString() };
}

const fmt = (iso, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso)).toUpperCase().replace(/[\s,]/g, '');
const when = (iso, now) => (now - Date.parse(iso) < DAY ? fmt(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : fmt(iso, { day: '2-digit', month: 'short' }));

// Board geometry, in cells.
const COLS = [['LAST PUSH', 5], ['FLT', 4], ['DESTINATION', 13], ['VERSION', 7], ['PRS/30D', 4], ['STATUS', 9]];
const CW = 17, CH = 26, GX = 2, GY = 8, PAD = 28, FRAMES = 4;
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const width = COLS.reduce((n, [, w]) => n + w, 0) + COLS.length - 1;
const STATUS_CLASS = { 'ON TIME': 'ok', BOARDING: 'go', DELAYED: 'late', HOLD: 'late', SCHEDULED: 'dim' };

let seed = 1337;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const esc = (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c;

export function render({ rows, merged30, updated }, now = Date.parse(updated)) {
  const top = PAD + 64;
  const rowY = (r) => top + 30 + r * (CH + GY);
  const height = rowY(rows.length) + 56;
  const W = PAD * 2 + width * (CW + GX) - GX;
  const out = [];
  const cells = (text, r, startCol, cls) => {
    const y = rowY(r);
    out.push(`<g clip-path="url(#r${r})">`);
    [...text].forEach((ch, i) => {
      if (ch === ' ') return;
      const x = PAD + (startCol + i) * (CW + GX) + CW / 2;
      const delay = (r * 0.22 + (startCol + i) * 0.035).toFixed(2);
      const spins = Array.from({ length: FRAMES }, () => GLYPHS[Math.floor(rand() * GLYPHS.length)]);
      const tspans = [...spins, ch].map((g, k) => `<tspan x="${x}" y="${y + CH * 0.74 + k * CH}">${esc(g)}</tspan>`).join('');
      out.push(`<text class="c ${cls}" style="animation-delay:${delay}s">${tspans}</text>`);
    });
    out.push('</g>');
  };

  out.push(`<rect width="${W}" height="${height}" rx="18" fill="url(#bg)"/>`);
  out.push(`<rect x="1" y="1" width="${W - 2}" height="${height - 2}" rx="17" fill="none" stroke="#7b3ff2" stroke-opacity=".45"/>`);
  out.push(`<text x="${PAD}" y="${PAD + 26}" class="title">DEPARTURES</text>`);
  out.push(`<text x="${W - PAD}" y="${PAD + 12}" class="meta" text-anchor="end">LENNIX1337 · LIVE FROM GITHUB</text>`);
  out.push(`<text x="${W - PAD}" y="${PAD + 30}" class="meta" text-anchor="end">UPDATED ${fmt(updated, { day: '2-digit', month: 'short' })} ${fmt(updated, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} BRT</text>`);
  let col = 0;
  for (const [label, w] of COLS) {
    out.push(`<text x="${PAD + col * (CW + GX)}" y="${top + 14}" class="head">${label}</text>`);
    col += w + 1;
  }
  out.push(`<rect x="${PAD}" y="${top + 20}" width="${W - PAD * 2}" height="1" fill="#7b3ff2" opacity=".5"/>`);
  rows.forEach((row, r) => {
    out.push(`<rect x="${PAD}" y="${rowY(r)}" width="${W - PAD * 2}" height="${CH}" fill="url(#cell)"/>`);
    const fields = [when(row.pushed, now), row.code, row.dest, row.version, String(row.prs), row.status];
    let c = 0;
    fields.forEach((value, f) => {
      const w = COLS[f][1];
      const text = f === 4 ? value.slice(0, w).padStart(w) : value.toUpperCase().slice(0, w).padEnd(w);
      cells(text, r, c, f === 5 ? STATUS_CLASS[row.status] ?? 'dim' : f === 0 || f === 4 ? 'hi' : '');
      c += w + 1;
    });
  });
  out.push(`<text x="${PAD}" y="${height - PAD + 4}" class="foot"><tspan class="num">${merged30}</tspan> pull requests merged in the last 30 days · built and shipped with a crew of AI agents</text>`);

  const clips = rows.map((_, r) => `<clipPath id="r${r}"><rect x="0" y="${rowY(r)}" width="${W}" height="${CH}"/></clipPath>`).join('');
  const style = `
.c{font:700 19px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#ece6ff;text-anchor:middle;animation:flip 16s steps(${FRAMES},end) infinite both}
.hi{fill:#c4a8ff}.ok{fill:#9df0c4}.go{fill:#ffe08a}.late{fill:#ff9b85}.dim{fill:#8a83a3}
.title{font:800 30px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:6px;fill:#f4efff}
.meta{font:600 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:2px;fill:#9b8cc4}
.head{font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:2px;fill:#9b8cc4}
.foot{font:500 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#b9aedb}.num{fill:#c4a8ff;font-weight:800}
@keyframes flip{0%{transform:translateY(0)}4%,100%{transform:translateY(-${FRAMES * CH}px)}}
@media (prefers-reduced-motion:reduce){.c{animation:none;transform:translateY(-${FRAMES * CH}px)}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="Departures board: live status of lennix1337's projects">
<defs><style>${style}</style>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120d1d"/><stop offset="1" stop-color="#07050c"/></linearGradient>
<pattern id="cell" x="${PAD}" y="${rowY(0)}" width="${CW + GX}" height="${CH + GY}" patternUnits="userSpaceOnUse"><rect width="${CW}" height="${CH}" rx="3" fill="#1b1528"/><rect y="${CH / 2}" width="${CW}" height="1" fill="#07050c"/></pattern>
${clips}</defs>
${out.join('\n')}
</svg>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const offline = process.argv.indexOf('--offline');
  const now = Date.now();
  const data = offline > 0 ? JSON.parse(readFileSync(process.argv[offline + 1], 'utf8')) : await collect(now);
  writeFileSync(new URL('../assets/board.svg', import.meta.url), render(data, offline > 0 ? Date.parse(data.updated) : now));
  console.log(JSON.stringify(data));
}
