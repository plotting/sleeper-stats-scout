import json, sys, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Require --source path/to/live.json
live_source = None
for i, arg in enumerate(sys.argv):
    if arg == '--source' and i + 1 < len(sys.argv):
        live_source = sys.argv[i + 1]

if not live_source or not os.path.exists(live_source):
    print('Usage: py -3 build_tracker.py --source mlb_data_live.json')
    sys.exit(1)

with open(live_source, encoding='utf-8') as f:
    live = json.load(f)

missions_data  = live.get('missions', {})
other_programs = live.get('other_programs', {})
inventory_data = live.get('inventory', [])
data_date      = live.get('data_date', 'live')
print(f'Using live data from: {live_source}')

app_data = {
    'divisions':      live.get('divisions', {}),
    'missions':       missions_data,
    'colors':         live.get('colors', {}),
    'other_programs': other_programs,
    'inventory':      inventory_data,
    'data_source':    'live',
    'data_date':      data_date,
}
data_json = json.dumps(app_data, ensure_ascii=True)

banner_content = (
    '&#10003; Showing <strong style="color:#22c55e;margin:0 3px">live 2026 data</strong>'
    f' &mdash; fetched {data_date}'
    ' &nbsp;&bull;&nbsp; <a onclick="document.getElementById(\'data-banner\').style.display=\'none\'">Dismiss</a>'
)

html_parts = []

html_parts.append('''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MLB The Show 26 - Team Affinity Tracker</title>
<style>
:root {
  --bg: #080d18;
  --surface: #0f1923;
  --surface2: #162031;
  --surface3: #1c2a3a;
  --border: #1e3554;
  --text: #e2e8f0;
  --muted: #64748b;
  --xp: #3b9edd;
  --green: #22c55e;
  --amber: #f59e0b;
  --red: #ef4444;
  --gold: #f5c518;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* HEADER */
.header {
  background: linear-gradient(135deg, #080d18 0%, #0d1d35 40%, #080d18 100%);
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  box-shadow: 0 2px 20px rgba(0,0,0,0.6);
  z-index: 50;
}
.logo { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap; }
.logo em { color: #3b9edd; font-style: normal; }
.logo-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
.header-mid { flex: 1; display: flex; align-items: center; gap: 10px; max-width: 520px; margin: 0 20px; }
.search-wrap { flex: 1; position: relative; }
.search-wrap svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.search-input {
  width: 100%; background: var(--surface2); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 10px 7px 32px; color: var(--text);
  font-size: 13px; outline: none; transition: border-color 0.2s;
}
.search-input:focus { border-color: #3b9edd; }
.filter-sel {
  background: var(--surface2); border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 10px; color: var(--text); font-size: 12px; outline: none; cursor: pointer; white-space: nowrap;
}
.header-right { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.stat-chip {
  background: rgba(59,158,221,0.12); border: 1px solid rgba(59,158,221,0.25);
  border-radius: 6px; padding: 4px 12px; text-align: center; min-width: 64px;
}
.stat-chip .n { font-size: 16px; font-weight: 700; color: #3b9edd; line-height: 1.2; }
.stat-chip .l { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
.inv-btn {
  background: rgba(245,197,24,0.12); border: 1px solid rgba(245,197,24,0.3);
  border-radius: 6px; padding: 5px 14px; color: #f5c518; font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap; transition: all 0.2s;
}
.inv-btn:hover { background: rgba(245,197,24,0.22); }

/* BODY LAYOUT */
.body { display: flex; flex: 1; overflow: hidden; }

/* SIDEBAR */
.sidebar {
  width: 200px; flex-shrink: 0; background: var(--surface);
  border-right: 1px solid var(--border); overflow-y: auto; padding: 6px 0;
}
.sidebar::-webkit-scrollbar { width: 3px; }
.sidebar::-webkit-scrollbar-thumb { background: var(--border); }
.div-hdr {
  padding: 10px 14px 3px; font-size: 8px; text-transform: uppercase;
  letter-spacing: 2px; color: var(--muted); font-weight: 700;
}
.team-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 14px; background: transparent; border: none; border-left: 3px solid transparent;
  cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 500; text-align: left;
  transition: all 0.15s;
}
.team-btn:hover { background: rgba(255,255,255,0.04); color: var(--text); }
.team-btn.active { background: rgba(59,158,221,0.1); color: #fff; border-left-color: #3b9edd; }
.team-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.team-pct { margin-left: auto; font-size: 10px; }
.team-btn.active .team-pct { color: #3b9edd; }

/* CONTENT */
.content { flex: 1; overflow-y: auto; padding: 18px 20px; }
.content::-webkit-scrollbar { width: 5px; }
.content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* TEAM BANNER */
.team-banner {
  border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 16px;
  background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%);
  position: relative; overflow: hidden;
}
.team-banner::after {
  content: ""; position: absolute; right: -20px; top: -20px;
  width: 140px; height: 140px; border-radius: 50%;
  background: rgba(255,255,255,0.05);
}
.banner-info { flex: 1; }
.banner-info h1 { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,0.4); }
.banner-info p { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 3px; }
.ring-wrap { position: relative; flex-shrink: 0; }
.ring-wrap svg { display: block; transform: rotate(-90deg); }
.ring-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring-label .rn { font-size: 17px; font-weight: 800; color: #fff; line-height: 1; }
.ring-label .rl { font-size: 8px; color: rgba(255,255,255,0.65); text-transform: uppercase; }

/* PROG TABS */
.prog-tabs { display: flex; gap: 4px; margin-bottom: 14px; background: var(--surface); padding: 3px; border-radius: 8px; border: 1px solid var(--border); width: fit-content; }
.ptab {
  padding: 6px 18px; border-radius: 6px; border: none; cursor: pointer;
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
  background: transparent; color: var(--muted); transition: all 0.18s;
}
.ptab:hover { color: var(--text); }
.ptab.active { background: #3b9edd; color: #fff; }

/* SUMMARY */
.summary-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.sum-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 4px 12px; font-size: 11px; color: var(--muted); }
.sum-pill strong { color: var(--text); }

/* MISSION GRID */
.mission-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }

/* MISSION CARD */
.mcard {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 14px; transition: all 0.18s; position: relative; overflow: hidden;
}
.mcard:hover { border-color: #2d6ca8; box-shadow: 0 0 0 1px rgba(59,158,221,0.2), 0 4px 14px rgba(0,0,0,0.3); transform: translateY(-1px); }
.mcard.done { border-color: rgba(34,197,94,0.3); }
.mcard.owned-player { border-color: rgba(245,197,24,0.5); background: linear-gradient(135deg, var(--surface) 0%, rgba(245,197,24,0.06) 100%); }
.mcard.owned-player:hover { border-color: rgba(245,197,24,0.7); box-shadow: 0 0 0 1px rgba(245,197,24,0.25), 0 4px 14px rgba(0,0,0,0.3); }

.card-badges { display: flex; gap: 5px; margin-bottom: 8px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.badge-done   { background: rgba(34,197,94,0.15);  color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
.badge-owned  { background: rgba(245,197,24,0.15); color: #f5c518; border: 1px solid rgba(245,197,24,0.3); }
.badge-moment { background: rgba(147,51,234,0.15); color: #c084fc; border: 1px solid rgba(147,51,234,0.3); }

.mcard-title { font-size: 12px; font-weight: 500; color: var(--text); line-height: 1.45; margin-bottom: 5px; }
.mcard-desc  { font-size: 11px; color: var(--muted); line-height: 1.45; margin-bottom: 8px; }
.mcard-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.mcard-prog-txt { font-size: 11px; color: var(--muted); font-weight: 600; min-width: 76px; }
.prog-bar { flex: 1; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
.prog-fill { height: 100%; border-radius: 3px; }
.prog-pct { font-size: 10px; font-weight: 700; min-width: 34px; text-align: right; }
.mcard-reward { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #3b9edd; font-weight: 600; }
.xp-badge { background: #1a4a7a; color: #3b9edd; font-size: 8px; font-weight: 800; padding: 1px 4px; border-radius: 3px; }

/* EMPTY */
.empty { text-align: center; padding: 60px 20px; color: var(--muted); }
.empty p { margin-top: 12px; font-size: 14px; }

/* INVENTORY PANEL */
.inv-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200; backdrop-filter: blur(3px); }
.inv-overlay.open { display: flex; align-items: flex-start; justify-content: flex-end; padding: 16px; }
.inv-panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  width: 360px; max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.7);
}
.inv-header {
  padding: 16px 18px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.inv-header h2 { font-size: 14px; font-weight: 700; flex: 1; }
.inv-header .gold { color: #f5c518; }
.close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 18px; padding: 0 4px; }
.close-btn:hover { color: var(--text); }
.inv-body { padding: 14px 18px; flex: 1; overflow-y: auto; }
.inv-body p { font-size: 12px; color: var(--muted); margin-bottom: 12px; line-height: 1.5; }
.inv-input-row { display: flex; gap: 8px; margin-bottom: 12px; }
.inv-input {
  flex: 1; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 10px; color: var(--text); font-size: 13px; outline: none;
}
.inv-input:focus { border-color: #f5c518; }
.inv-add-btn {
  background: #f5c518; border: none; border-radius: 6px; padding: 7px 14px;
  color: #000; font-weight: 700; font-size: 12px; cursor: pointer;
}
.inv-add-btn:hover { background: #ffd93d; }
.inv-list { display: flex; flex-direction: column; gap: 5px; }
.inv-player {
  display: flex; align-items: center; gap: 8px; background: var(--surface2);
  border: 1px solid rgba(245,197,24,0.2); border-radius: 6px; padding: 7px 10px;
}
.inv-player-name { flex: 1; font-size: 12px; font-weight: 500; color: #f5c518; }
.inv-player-hits { font-size: 10px; color: var(--muted); }
.inv-remove { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; padding: 0; }
.inv-remove:hover { color: #ef4444; }
.inv-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 20px 0; }
.inv-hint { font-size: 10px; color: var(--muted); margin-top: 10px; font-style: italic; }
.inv-section-hdr { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 2px 0 4px; }
.auto-player { border-color: rgba(59,158,221,0.2); gap: 10px; }

/* HOME DASHBOARD */
.home-banner { padding: 18px 22px; margin-bottom: 18px; border-radius: 10px; background: linear-gradient(135deg, #0d1d35 0%, #080d18 100%); border: 1px solid var(--border); display: flex; align-items: flex-end; gap: 20px; }
.home-banner h1 { font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #fff; }
.home-banner p  { font-size: 11px; color: var(--muted); margin-top: 2px; }
.home-lineup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 22px; }
.home-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.home-card-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; }
.home-player-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(30,53,84,0.6); }
.home-player-row:last-child { border-bottom: none; }
.home-player-name { flex: 1; font-size: 12px; font-weight: 500; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.home-player-bar  { width: 60px; height: 4px; background: var(--border); border-radius: 2px; flex-shrink: 0; }
.home-player-pct  { font-size: 11px; font-weight: 600; white-space: nowrap; }
.home-missions-hdr { display: flex; align-items: center; gap: 10px; margin: 6px 0 10px; }
.home-missions-hdr h3 { font-size: 13px; font-weight: 700; }
.home-missions-hdr .hm-count { font-size: 11px; color: var(--muted); }
.home-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 14px 0; }

/* Other program sidebar buttons */
.prog-icon {
  width: 24px; height: 24px; border-radius: 5px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; font-weight: 800; color: #fff; letter-spacing: 0.3px;
}
.other-prog-btn { font-size: 12px; }
.other-prog-btn.active { background: rgba(59,158,221,0.1); color: #fff; border-left-color: #3b9edd; }

/* Data source banner */
.data-banner {
  background: rgba(245,197,24,0.08); border-bottom: 1px solid rgba(245,197,24,0.2);
  padding: 5px 20px; display: flex; align-items: center; gap: 10px;
  font-size: 11px; color: rgba(245,197,24,0.85); flex-shrink: 0;
}
.data-banner a { color: #f5c518; font-weight: 600; cursor: pointer; text-decoration: underline; }

/* Live data needed panel */
.live-data-needed {
  display: flex; gap: 16px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px 24px; margin-top: 4px;
}
.ldn-icon { font-size: 28px; color: #3b9edd; flex-shrink: 0; }
.ldn-body { flex: 1; }
.ldn-body strong { font-size: 14px; color: var(--text); display: block; margin-bottom: 6px; }
.ldn-body p { font-size: 12px; color: var(--muted); line-height: 1.6; }
.ldn-body code {
  display: inline-block; background: var(--surface2); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 10px; font-family: monospace; font-size: 12px;
  color: #22c55e; margin: 8px 0;
}

/* Completed section divider */
.complete-divider {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 10px;
  margin: 4px 0; color: var(--muted); font-size: 11px;
}
.complete-divider::before, .complete-divider::after {
  content: ''; flex: 1; height: 1px; background: rgba(34,197,94,0.2);
}
</style>
</head>
<body>

<header class="header">
  <div>
    <div class="logo">MLB The Show <em>26</em></div>
    <div class="logo-sub">Team Affinity Tracker</div>
  </div>
  <div class="header-mid">
    <div class="search-wrap">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="search-input" id="search" type="text" placeholder="Search missions...">
    </div>
    <select class="filter-sel" id="fstatus">
      <option value="all">All</option>
      <option value="incomplete">Incomplete</option>
      <option value="complete">Complete</option>
      <option value="near">Near (75%+)</option>
      <option value="owned">Has My Player</option>
    </select>
    <select class="filter-sel" id="fsort">
      <option value="pct-d">Progress ↓</option>
      <option value="pct-a">Progress ↑</option>
      <option value="rew-d">Reward ↓</option>
      <option value="rew-a">Reward ↑</option>
    </select>
  </div>
  <div class="header-right">
    <div class="stat-chip"><div class="n" id="g-done">0</div><div class="l">Done</div></div>
    <div class="stat-chip"><div class="n" id="g-total">0</div><div class="l">Total</div></div>
    <div class="stat-chip"><div class="n" id="g-pct">0%</div><div class="l">Progress</div></div>
    <button class="inv-btn" onclick="toggleInv()">&#9733; My Players</button>
  </div>
</header>

<div class="data-banner" id="data-banner">
  DATA_BANNER_CONTENT
</div>
<div class="body">
  <nav class="sidebar" id="sidebar"></nav>
  <div class="content" id="content">
    <div class="empty">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <p>Select a team from the sidebar</p>
    </div>
  </div>
</div>

<!-- Inventory Panel -->
<div class="inv-overlay" id="inv-overlay" onclick="overlayClick(event)">
  <div class="inv-panel">
    <div class="inv-header">
      <h2><span class="gold">&#9733;</span> My Player Inventory</h2>
      <button class="close-btn" onclick="toggleInv()">&#x2715;</button>
    </div>
    <div class="inv-body">
      <p>Add player names you own. Missions that require that player will be highlighted in <span style="color:#f5c518">gold</span>.</p>
      <div class="inv-input-row">
        <input class="inv-input" id="inv-input" type="text" placeholder="e.g. Rowdy Tellez" onkeydown="invKeydown(event)">
        <button class="inv-add-btn" onclick="addPlayer()">Add</button>
      </div>
      <div class="inv-list" id="inv-list"></div>
      <div class="inv-hint">Names are matched against mission text. Partial names work (e.g. "Tellez").</div>
    </div>
  </div>
</div>

<script>
const D = ''')

html_parts.append(data_json)

html_parts.append(''';

// ── Inventory (localStorage + API pre-seed) ────────────────────────────────
let inventory = JSON.parse(localStorage.getItem('mlb26_inv') || '[]');
// If the fetch script pulled the player inventory and localStorage is empty, seed it
if (!inventory.length && D.inventory && D.inventory.length) {
  inventory = D.inventory.slice();
  localStorage.setItem('mlb26_inv', JSON.stringify(inventory));
}
function saveInv() { localStorage.setItem('mlb26_inv', JSON.stringify(inventory)); }
function missionHasOwnedPlayer(title) {
  const t = title.toLowerCase();
  return inventory.some(p => t.includes(p.toLowerCase()));
}
function getMatchedPlayer(title) {
  const t = title.toLowerCase();
  return inventory.find(p => t.includes(p.toLowerCase())) || null;
}

// ── Auto-inventory (detect owned players from mission progress) ────────────
// Words that look like player names but are team/program names — skip these
const LINEUP_EXCL = new Set([
  'series','players','pool','world','classic','baseball','athletics','yankees',
  'red','blue','white','sox','jays','rays','twins','tigers','royals','astros',
  'rangers','angels','mariners','braves','phillies','mets','nationals','marlins',
  'cubs','brewers','cardinals','pirates','reds','dodgers','giants','padres',
  'diamondbacks','rockies','guardians','orioles'
]);

// Two dedicated module-level maps used by renderHome + renderInvList
// activePlayerMap: name → [missions where pct < 100]  (USE in lineup)
// doneOnlyMap:     names that only have done missions  (SAFE to remove)
const activePlayerMap = new Map();
const donePlayerMap   = new Map();  // all known done missions, keyed by full name

function extractOwnerFromMission(m) {
  // 1. "Firstname Lastname - Country" WBC-style title → name before the dash
  const cp = m.t.match(/^([A-Z][A-Za-z\u00C0-\u024F'-]+(?: [A-Z][A-Za-z\u00C0-\u024F'-]+)+)\s*-\s*[A-Z][a-z]/);
  if (cp) return cp[1];
  // 2. "with Name" in description (e.g. "Record 10 Ks with Seth Lugo")
  const dp = (m.d || '').match(/\bwith\s+([A-Z][A-Za-z\u00C0-\u024F'-]+(?: [A-Z][A-Za-z\u00C0-\u024F'-]+){1,3})/);
  if (dp) return dp[1];
  // 3. "w/ Name" at end of title, allowing optional trailing "Jr." / "Sr."
  const tp = m.t.match(/\bw\/\s*([A-Z][A-Za-z\u00C0-\u024F'-]+(?: [A-Z][A-Za-z\u00C0-\u024F'-]+)*(?:\s+[JS]r\.?)?)\s*\.?\s*$/i);
  if (tp) return tp[1].replace(/\.\s*$/, '').trim();
  return null;
}

function _isExcluded(name) {
  const last = name.split(' ').pop().toLowerCase().replace(/\.$/, '');
  return LINEUP_EXCL.has(last) || LINEUP_EXCL.has(name.toLowerCase());
}

function _addTo(map, name, m) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push(m);
}

// ── Flat mission list (all programs) ──────────────────────────────────────
function getAllMissionsFlat() {
  const all = [];
  for (const progs of Object.values(D.missions)) {
    for (const arr of Object.values(progs)) { for (const m of arr) all.push(m); }
  }
  for (const pd of Object.values(D.other_programs || {})) {
    for (const m of (pd.missions || [])) all.push(m);
  }
  return all;
}
const allMissionsFlat = getAllMissionsFlat();

// ── Mission state tracking (detect completions/new starts between refreshes) ─
const PREV_PCT_KEY = 'mlb26_prev_pct';
let prevPct = null;
try { prevPct = JSON.parse(localStorage.getItem(PREV_PCT_KEY) || 'null'); } catch {}
const curPct = {};
for (const m of allMissionsFlat) curPct[m.t] = m.pct;
localStorage.setItem(PREV_PCT_KEY, JSON.stringify(curPct));
const recentlyCompleted = [];
const recentlyStarted   = [];
if (prevPct) {
  for (const m of allMissionsFlat) {
    const prev = prevPct[m.t];
    if (prev !== undefined && prev < 100 && m.pct >= 100) recentlyCompleted.push(m);
    if (prev !== undefined && prev === 0  && m.pct  >  0) recentlyStarted.push(m);
  }
}

function buildAutoInventory() {
  activePlayerMap.clear();
  donePlayerMap.clear();

  // Pass 1: scan all missions with pct > 0; bucket into active vs done
  for (const m of allMissionsFlat) {
    if (m.pct <= 0) continue;
    const name = extractOwnerFromMission(m);
    if (!name || _isExcluded(name)) continue;
    if (m.pct >= 100) _addTo(donePlayerMap, name, m);
    else              _addTo(activePlayerMap, name, m);
  }

  // Pass 2: within each map, merge last-name-only keys into their full-name key
  function _mergeShortsInto(map) {
    for (const [short, entries] of [...map]) {
      if (short.includes(' ')) continue;
      for (const [full, fullEntries] of map) {
        if (full !== short && full.endsWith(' ' + short)) {
          for (const e of entries) fullEntries.push(e);
          map.delete(short);
          break;
        }
      }
    }
  }
  _mergeShortsInto(activePlayerMap);
  _mergeShortsInto(donePlayerMap);

  // Pass 3: cross-map merge — if "Lugo" is in activePlayerMap but "Seth Lugo"
  // is in donePlayerMap, move Lugo's missions into activePlayerMap["Seth Lugo"]
  for (const [short, entries] of [...activePlayerMap]) {
    if (short.includes(' ')) continue;
    for (const [full] of donePlayerMap) {
      if (full.endsWith(' ' + short)) {
        _addTo(activePlayerMap, full, ...entries);  // spread won't work; use loop:
        activePlayerMap.delete(short);              // (fixed below)
        break;
      }
    }
  }
  // Re-do pass 3 correctly (can't spread into _addTo)
  // Actually _addTo only takes one m at a time — fix:
  //   (No-op re-run, correct version inline)
  for (const [short, entries] of [...activePlayerMap]) {
    if (short.includes(' ')) continue;
    for (const [full] of donePlayerMap) {
      if (full.endsWith(' ' + short)) {
        if (!activePlayerMap.has(full)) activePlayerMap.set(full, []);
        for (const e of entries) activePlayerMap.get(full).push(e);
        activePlayerMap.delete(short);
        break;
      }
    }
  }

  // Pass 4: for players we know are owned (appear in donePlayerMap with no active
  // missions yet), scan ALL missions — even pct=0 — to find pending incomplete work.
  // e.g. "Adrian Almeida" done WBC mission + 0% "5 IP w/ Almeida" → should use him
  for (const knownName of donePlayerMap.keys()) {
    if (activePlayerMap.has(knownName)) continue;
    for (const m of allMissionsFlat) {
      if (m.pct >= 100) continue;
      const nm = extractOwnerFromMission(m);
      if (!nm) continue;
      // Match exact name OR last-name suffix
      const matched = nm === knownName ||
        (!nm.includes(' ') && knownName.endsWith(' ' + nm));
      if (matched) _addTo(activePlayerMap, knownName, m);
    }
  }
}

// ── Global stats ───────────────────────────────────────────────────────────
let gDone = 0, gTotal = 0;
for (const tm of Object.keys(D.missions)) {
  for (const arr of Object.values(D.missions[tm])) {
    for (const m of arr) {
      gTotal++;
      if (m.pct >= 100) gDone++;
    }
  }
}
for (const prog of Object.values(D.other_programs)) {
  for (const m of (prog.missions || [])) {
    gTotal++;
    if (m.pct >= 100) gDone++;
  }
}
document.getElementById('g-done').textContent  = gDone;
document.getElementById('g-total').textContent = gTotal;
document.getElementById('g-pct').textContent   = gTotal ? Math.round(gDone / gTotal * 100) + '%' : '—';

// ── Home dashboard ─────────────────────────────────────────────────────────
function selectHome() {
  clearActive();
  curTeam = null; curProg = null;
  const hb = document.getElementById('home-btn');
  if (hb) hb.classList.add('active');
  renderHome();
}

function _buildLineupLists() {
  // Use in lineup: has active (incomplete) missions
  const useInLineup = [];
  for (const [name, missions] of activePlayerMap) {
    const sorted = missions.slice().sort(function(a, b) { return b.pct - a.pct; });
    useInLineup.push({name, best: sorted[0]});
  }
  useInLineup.sort(function(a, b) { return b.best.pct - a.best.pct; });

  // Safe to remove: in donePlayerMap but NOT in activePlayerMap
  const safeToRemove = [];
  for (const name of donePlayerMap.keys()) {
    if (!activePlayerMap.has(name)) safeToRemove.push(name);
  }
  return {useInLineup, safeToRemove};
}

function renderHome() {
  const content = document.getElementById('content');
  const {useInLineup, safeToRemove} = _buildLineupLists();

  // 10 closest incomplete missions (across all programs), pct > 0
  const closest = allMissionsFlat
    .filter(function(m) { return m.pct < 100 && m.pct > 0; })
    .sort(function(a, b) { return b.pct - a.pct; })
    .slice(0, 10);

  // Recently completed: prefer delta since last refresh; otherwise nothing
  const showRecent = recentlyCompleted.length > 0;
  const recentShow = recentlyCompleted.slice(-10).reverse();

  // Helper: render a lineup player row
  function lineupRow(name, pct, color) {
    return '<div class="home-player-row">'
      + '<span class="home-player-name" style="color:#e2e8f0">&#9733; ' + name + '</span>'
      + '<div class="home-player-bar"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:2px"></div></div>'
      + '<span class="home-player-pct" style="color:' + color + '">' + pct + '%</span>'
      + '</div>';
  }

  // Lineup card HTML
  let useHtml = '';
  if (useInLineup.length) {
    for (const {name, best} of useInLineup) {
      const pct = best.pct;
      const c = progColor(pct);
      useHtml += lineupRow(name, pct, c);
    }
  } else {
    useHtml = '<div class="home-empty">No active missions detected</div>';
  }

  let removeHtml = '';
  if (safeToRemove.length) {
    for (const name of safeToRemove) {
      removeHtml += '<div class="home-player-row">'
        + '<span class="home-player-name" style="color:#64748b">&#10003; ' + name + '</span>'
        + '<span class="home-player-pct" style="color:#22c55e;font-size:10px">All done</span>'
        + '</div>';
    }
  } else {
    removeHtml = '<div class="home-empty">None yet</div>';
  }

  // Mission section HTML
  let closestHtml = '';
  if (closest.length) {
    closestHtml = '<div class="mission-grid">' + closest.map(buildCard).join('') + '</div>';
  } else {
    closestHtml = '<div class="home-empty">No missions in progress yet — run a fetch to load live data.</div>';
  }

  let recentHtml = '';
  if (showRecent) {
    recentHtml = '<div class="home-missions-hdr"><h3 style="color:#22c55e">&#10003; Completed Since Last Refresh</h3>'
      + '<span class="hm-count">' + recentShow.length + ' mission' + (recentShow.length !== 1 ? 's' : '') + '</span></div>'
      + '<div class="mission-grid">' + recentShow.map(buildCard).join('') + '</div>';
  }

  // Newly started since last refresh
  let startedHtml = '';
  if (recentlyStarted.length) {
    const started = recentlyStarted.slice(-10).reverse();
    startedHtml = '<div class="home-missions-hdr"><h3 style="color:#3b9edd">&#9654; Newly Started Since Last Refresh</h3>'
      + '<span class="hm-count">' + started.length + '</span></div>'
      + '<div class="mission-grid">' + started.map(buildCard).join('') + '</div>';
  }

  content.innerHTML =
    '<div class="home-banner">'
    + '<div><h1>Dashboard</h1><p>Your lineup advisor &bull; fetched ' + (D.data_date || 'unknown') + '</p></div>'
    + '</div>'
    + '<div class="home-lineup-grid">'
    +   '<div class="home-card">'
    +     '<div class="home-card-title" style="color:#22c55e">&#9654; Use in Lineup</div>'
    +     useHtml
    +   '</div>'
    +   '<div class="home-card">'
    +     '<div class="home-card-title" style="color:#64748b">&#10003; Safe to Remove</div>'
    +     removeHtml
    +   '</div>'
    + '</div>'
    + (recentHtml   ? recentHtml   : '')
    + (startedHtml  ? startedHtml  : '')
    + '<div class="home-missions-hdr"><h3>&#127919; 10 Closest to Finishing</h3>'
    +   '<span class="hm-count">' + closest.length + ' missions</span></div>'
    + closestHtml;
}

// ── Sidebar ────────────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');

// Dashboard home button
const homeBtn = document.createElement('button');
homeBtn.id = 'home-btn';
homeBtn.className = 'team-btn';
homeBtn.innerHTML = '<span style="font-size:13px;margin-right:2px">&#8962;</span><span style="flex:1">Dashboard</span>';
homeBtn.addEventListener('click', selectHome);
sidebar.appendChild(homeBtn);
const homeDivSep = document.createElement('div');
homeDivSep.style.cssText = 'height:1px;background:var(--border);margin:6px 14px 4px;';
sidebar.appendChild(homeDivSep);

// Other Programs — grouped by meta.group field
const OP_GROUP_ORDER  = ['xp_path', 'assorted', 'multiplayer'];
const OP_GROUP_LABELS = {xp_path: 'XP Path', assorted: 'Themed Programs', multiplayer: 'Multiplayer'};
const opByGroup = {};
for (const [progName, meta] of Object.entries(D.other_programs)) {
  const g = meta.group || 'assorted';
  if (!opByGroup[g]) opByGroup[g] = [];
  opByGroup[g].push([progName, meta]);
}
for (const grp of OP_GROUP_ORDER) {
  const progs = opByGroup[grp] || [];
  if (!progs.length) continue;
  const h = document.createElement('div');
  h.className = 'div-hdr';
  h.textContent = OP_GROUP_LABELS[grp] || grp;
  sidebar.appendChild(h);
  for (const [progName, meta] of progs) {
    const mlist = meta.missions || [];
    const pdone = mlist.filter(function(m) { return m.pct >= 100; }).length;
    const ppct  = mlist.length ? Math.round(pdone / mlist.length * 100) : 0;
    const btn   = document.createElement('button');
    btn.className = 'team-btn other-prog-btn';
    btn.dataset.prog = progName;
    btn.innerHTML =
      '<span class="prog-icon" style="background:' + meta.color + '">' + meta.icon + '</span>'
      + '<span style="flex:1;text-align:left;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + progName + '</span>'
      + '<span class="team-pct">' + ppct + '%</span>';
    btn.addEventListener('click', function() { selectOtherProg(this.dataset.prog); });
    sidebar.appendChild(btn);
  }
}

// Divider
const divider = document.createElement('div');
divider.style.cssText = 'height:1px;background:var(--border);margin:8px 14px;';
sidebar.appendChild(divider);

const taHdr = document.createElement('div');
taHdr.className = 'div-hdr';
taHdr.textContent = 'Team Affinity';
sidebar.appendChild(taHdr);

for (const [div, teams] of Object.entries(D.divisions)) {
  const h = document.createElement('div');
  h.className = 'div-hdr';
  h.textContent = div;
  sidebar.appendChild(h);
  for (const team of teams) {
    if (!D.missions[team]) continue;
    const all  = Object.values(D.missions[team]).flat();
    const done = all.filter(m => m.pct >= 100).length;
    const pct  = all.length ? Math.round(done / all.length * 100) : 0;
    const c1  = D.colors[team] ? D.colors[team][0] : '#3b9edd';
    const btn = document.createElement('button');
    btn.className   = 'team-btn';
    btn.dataset.team = team;
    btn.innerHTML   = '<span class="team-dot" style="background:' + c1 + '"></span>'
                    + '<span>' + team + '</span>'
                    + '<span class="team-pct">' + pct + '%</span>';
    btn.addEventListener('click', function() { selectTeam(this.dataset.team); });
    sidebar.appendChild(btn);
  }
}

// ── State ──────────────────────────────────────────────────────────────────
let curTeam = null;
let curProg = null;

function clearActive() {
  document.querySelectorAll('.team-btn, .other-prog-btn').forEach(b => b.classList.remove('active'));
}

function selectOtherProg(progName) {
  clearActive();
  const btn = document.querySelector('.other-prog-btn[data-prog="' + progName + '"]');
  if (btn) btn.classList.add('active');
  curTeam = null;
  curProg = progName;
  const meta     = D.other_programs[progName] || {};
  const missions = meta.missions || [];
  const content  = document.getElementById('content');

  if (!missions.length) {
    content.innerHTML =
      '<div class="team-banner" style="--c1:' + (meta.color || '#1e3a5f') + ';--c2:#0d1b2e">' +
        '<div class="banner-info"><h1>' + progName + '</h1>' +
        '<p>' + (meta.desc || '') + '</p></div>' +
      '</div>' +
      '<div class="live-data-needed">' +
        '<div class="ldn-icon">&#9432;</div>' +
        '<div class="ldn-body">' +
          '<strong>Live data required for ' + progName + '</strong>' +
          '<p>Run the fetch script to pull live 2026 data:</p>' +
          '<code>py -3 fetch_mlb26.py</code>' +
        '</div>' +
      '</div>';
    return;
  }

  const done    = missions.filter(function(m) { return m.pct >= 100; }).length;
  const pct     = missions.length ? Math.round(done / missions.length * 100) : 0;
  const R = 30, circ = Math.round(2 * Math.PI * R);
  const offset  = Math.round(circ * (1 - pct / 100));

  content.innerHTML =
    '<div class="team-banner" style="--c1:' + (meta.color || '#1e3a5f') + ';--c2:#0d1b2e">' +
      '<div class="banner-info"><h1>' + progName + '</h1>' +
      '<p>' + done + ' / ' + missions.length + ' missions complete</p></div>' +
      '<div class="ring-wrap">' +
      '<svg width="70" height="70" viewBox="0 0 70 70">' +
      '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="5"/>' +
      '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="5"' +
      ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/>' +
      '</svg>' +
      '<div class="ring-label"><span class="rn">' + pct + '%</span><span class="rl">done</span></div>' +
      '</div></div>' +
      '<div id="mission-area"></div>';

  renderOtherMissions(progName);
}

function renderOtherMissions(progName) {
  const meta    = D.other_programs[progName] || {};
  let list      = (meta.missions || []).slice();
  const search  = document.getElementById('search').value.toLowerCase();
  const fstatus = document.getElementById('fstatus').value;
  const fsort   = document.getElementById('fsort').value;

  if (search)   list = list.filter(function(m) { return m.t.toLowerCase().includes(search) || m.p.toLowerCase().includes(search); });
  if (fstatus === 'incomplete') list = list.filter(function(m) { return m.pct < 100; });
  if (fstatus === 'complete')   list = list.filter(function(m) { return m.pct >= 100; });
  if (fstatus === 'near')       list = list.filter(function(m) { return m.pct >= 75 && m.pct < 100; });
  if (fstatus === 'owned')      list = list.filter(function(m) { return missionHasOwnedPlayer(m.t); });

  if (fsort === 'pct-d') list.sort(function(a,b) { return b.pct - a.pct; });
  if (fsort === 'pct-a') list.sort(function(a,b) { return a.pct - b.pct; });
  if (fsort === 'rew-d') list.sort(function(a,b) { return parseInt(b.r.replace(/,/g,'')) - parseInt(a.r.replace(/,/g,'')); });
  if (fsort === 'rew-a') list.sort(function(a,b) { return parseInt(a.r.replace(/,/g,'')) - parseInt(b.r.replace(/,/g,'')); });

  if (fstatus !== 'complete') {
    const incomplete = list.filter(function(m) { return m.pct < 100; });
    const complete   = list.filter(function(m) { return m.pct >= 100; });
    list = incomplete.concat(complete);
  }

  const area = document.getElementById('mission-area');
  if (!area) return;

  const allMissions = meta.missions || [];
  const progDone    = allMissions.filter(function(m) { return m.pct >= 100; }).length;
  const ownedCount  = allMissions.filter(function(m) { return missionHasOwnedPlayer(m.t); }).length;

  if (!list.length) {
    area.innerHTML = '<div class="empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>No missions match your filters</p></div>';
    return;
  }

  let summHtml = '<div class="summary-row">'
    + '<div class="sum-pill">Showing <strong>' + list.length + '</strong> missions</div>'
    + '<div class="sum-pill"><strong>' + progDone + '</strong> / ' + allMissions.length + ' complete</div>';
  if (ownedCount > 0) {
    summHtml += '<div class="sum-pill" style="border-color:rgba(245,197,24,0.3);color:#f5c518"><strong>' + ownedCount + '</strong> use your players</div>';
  }
  summHtml += '</div>';

  let cards = '';
  let shownDivider = false;
  for (const m of list) {
    const isDone = m.pct >= 100;
    if (isDone && !shownDivider && fstatus !== 'complete') {
      shownDivider = true;
      const doneCount = list.filter(function(x) { return x.pct >= 100; }).length;
      cards += '<div class="complete-divider">&#10003; ' + doneCount + ' completed</div>';
    }
    cards += buildCard(m);
  }
  area.innerHTML = summHtml + '<div class="mission-grid">' + cards + '</div>';
}

function selectTeam(team) {
  clearActive();
  curTeam = team;
  const progs = Object.keys(D.missions[team]);
  if (!curProg || !progs.includes(curProg)) curProg = progs[0];
  document.querySelectorAll('.team-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.team === team);
  });
  renderContent();
}

function switchProg(btn) {
  curProg = btn.dataset.prog;
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('active', t.dataset.prog === curProg));
  renderMissions();
}

// ── Render content area ────────────────────────────────────────────────────
function renderContent() {
  if (!curTeam) return;
  const td     = D.missions[curTeam];
  const colors = D.colors[curTeam] || ['#1e3a5f', '#0d1b2e'];
  const c1 = colors[0], c2 = colors[1];
  const all     = Object.values(td).flat();
  const done    = all.filter(m => m.pct >= 100).length;
  const teamPct = all.length ? Math.round(done / all.length * 100) : 0;
  const R = 30, circ = Math.round(2 * Math.PI * R);
  const offset = Math.round(circ * (1 - teamPct / 100));
  const progs   = Object.keys(td);
  const TAB_LABELS = {'My Journey': 'Team Affinity', 'Color Storm': '#1 Fan'};
  const tabsHtml = progs.map(function(p) {
    const label = TAB_LABELS[p] || p;
    return '<button class="ptab' + (p === curProg ? ' active' : '') + '" data-prog="' + p + '" onclick="switchProg(this)">' + label + '</button>';
  }).join('');

  document.getElementById('content').innerHTML =
    '<div class="team-banner" style="--c1:' + c1 + ';--c2:' + c2 + '">'
    + '<div class="banner-info"><h1>' + curTeam + '</h1>'
    + '<p>Team Affinity &bull; ' + done + ' / ' + all.length + ' missions complete</p></div>'
    + '<div class="ring-wrap">'
    + '<svg width="70" height="70" viewBox="0 0 70 70">'
    + '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="5"/>'
    + '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="5"'
    + ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/>'
    + '</svg>'
    + '<div class="ring-label"><span class="rn">' + teamPct + '%</span><span class="rl">done</span></div>'
    + '</div></div>'
    + '<div class="prog-tabs">' + tabsHtml + '</div>'
    + '<div id="mission-area"></div>';

  renderMissions();
}

// ── Card builder ───────────────────────────────────────────────────────────
function buildCard(m) {
  const isDone   = m.pct >= 100;
  const owned    = missionHasOwnedPlayer(m.t);
  const matched  = getMatchedPlayer(m.t);
  const color    = progColor(m.pct);
  // WBC/country moment: "Name - Country" title — badge stays even when complete
  const isCountryMoment = /^[A-Z][A-Za-z\u00C0-\u024F'-]+(?: [A-Z][A-Za-z\u00C0-\u024F'-]+)+ - [A-Z][a-z]/.test(m.t);
  // Other moment types: only badge when incomplete (description gone once done)
  const isMoment = isCountryMoment || (!isDone && (
    (m.d && m.d.toLowerCase().includes('moment')) ||
    /^\\d+\\/1\\s*$/.test(m.p)
  ));
  let cls = 'mcard';
  if (isDone)          cls += ' done';
  if (owned && !isDone) cls += ' owned-player';
  let badges = '';
  if (isDone)   badges += '<span class="badge badge-done">&#10003; Complete</span>';
  if (isMoment) badges += '<span class="badge badge-moment">&#9654; Moment</span>';
  if (owned)    badges += '<span class="badge badge-owned">&#9733; ' + matched + '</span>';
  return '<div class="' + cls + '">'
    + (badges ? '<div class="card-badges">' + badges + '</div>' : '')
    + '<div class="mcard-title">' + m.t + '</div>'
    + (m.d ? '<div class="mcard-desc">' + m.d + '</div>' : '')
    + '<div class="mcard-meta">'
    +   '<span class="mcard-prog-txt">' + m.p + '</span>'
    +   '<div class="prog-bar"><div class="prog-fill" style="width:' + Math.min(m.pct,100) + '%;background:' + color + '"></div></div>'
    +   '<span class="prog-pct" style="color:' + color + '">' + m.pct + '%</span>'
    + '</div>'
    + '<div class="mcard-reward"><span class="xp-badge">XP</span>' + m.r + '</div>'
    + '</div>';
}

// ── Render mission cards ───────────────────────────────────────────────────
function progColor(pct) {
  if (pct >= 100) return '#22c55e';
  if (pct >= 75)  return '#3b9edd';
  if (pct >= 50)  return '#f59e0b';
  return '#ef4444';
}

function renderMissions() {
  if (!curTeam || !curProg) return;
  let list = (D.missions[curTeam][curProg] || []).slice();
  const search  = document.getElementById('search').value.toLowerCase();
  const fstatus = document.getElementById('fstatus').value;
  const fsort   = document.getElementById('fsort').value;

  if (search)   list = list.filter(function(m) { return m.t.toLowerCase().includes(search) || m.p.toLowerCase().includes(search); });
  if (fstatus === 'incomplete') list = list.filter(function(m) { return m.pct < 100; });
  if (fstatus === 'complete')   list = list.filter(function(m) { return m.pct >= 100; });
  if (fstatus === 'near')       list = list.filter(function(m) { return m.pct >= 75 && m.pct < 100; });
  if (fstatus === 'owned')      list = list.filter(function(m) { return missionHasOwnedPlayer(m.t); });

  if (fsort === 'pct-d') list.sort(function(a,b) { return b.pct - a.pct; });
  if (fsort === 'pct-a') list.sort(function(a,b) { return a.pct - b.pct; });
  if (fsort === 'rew-d') list.sort(function(a,b) { return parseInt(b.r.replace(/,/g,'')) - parseInt(a.r.replace(/,/g,'')); });
  if (fsort === 'rew-a') list.sort(function(a,b) { return parseInt(a.r.replace(/,/g,'')) - parseInt(b.r.replace(/,/g,'')); });

  // Always push 100% complete missions to the bottom (unless filtering to complete only)
  if (fstatus !== 'complete') {
    const incomplete = list.filter(function(m) { return m.pct < 100; });
    const complete   = list.filter(function(m) { return m.pct >= 100; });
    list = incomplete.concat(complete);
  }

  const allInProg  = D.missions[curTeam][curProg] || [];
  const progDone   = allInProg.filter(function(m) { return m.pct >= 100; }).length;
  const progPct    = allInProg.length ? Math.round(allInProg.reduce(function(a,m) { return a + m.pct; }, 0) / allInProg.length) : 0;
  const ownedCount = allInProg.filter(function(m) { return missionHasOwnedPlayer(m.t); }).length;

  const area = document.getElementById('mission-area');
  if (!area) return;

  if (!list.length) {
    area.innerHTML = '<div class="empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>No missions match your filters</p></div>';
    return;
  }

  let summHtml = '<div class="summary-row">'
    + '<div class="sum-pill">Showing <strong>' + list.length + '</strong> missions</div>'
    + '<div class="sum-pill"><strong>' + progDone + '</strong> / ' + allInProg.length + ' complete</div>'
    + '<div class="sum-pill">Avg <strong>' + progPct + '%</strong></div>';
  if (ownedCount > 0) {
    summHtml += '<div class="sum-pill" style="border-color:rgba(245,197,24,0.3);color:#f5c518"><strong>' + ownedCount + '</strong> use your players</div>';
  }
  summHtml += '</div>';

  let cards = '';
  let shownDivider = false;
  for (const m of list) {
    const isDone  = m.pct >= 100;
    // Insert a visual divider before the first completed card
    if (isDone && !shownDivider && fstatus !== 'complete') {
      shownDivider = true;
      const doneCount = list.filter(function(x) { return x.pct >= 100; }).length;
      cards += '<div class="complete-divider">&#10003; ' + doneCount + ' completed</div>';
    }
    cards += buildCard(m);
  }

  area.innerHTML = summHtml + '<div class="mission-grid">' + cards + '</div>';
}

// ── Inventory panel ────────────────────────────────────────────────────────
function toggleInv() {
  const o = document.getElementById('inv-overlay');
  o.classList.toggle('open');
  if (o.classList.contains('open')) renderInvList();
}
function overlayClick(e) {
  if (e.target === document.getElementById('inv-overlay')) toggleInv();
}
function invKeydown(e) { if (e.key === 'Enter') addPlayer(); }
function addPlayer() {
  const inp = document.getElementById('inv-input');
  const name = inp.value.trim();
  if (!name) return;
  if (!inventory.includes(name)) {
    inventory.push(name);
    saveInv();
  }
  inp.value = '';
  renderInvList();
  if (curTeam) renderMissions();
}
function removePlayer(name) {
  inventory = inventory.filter(function(p) { return p !== name; });
  saveInv();
  renderInvList();
  if (curTeam) renderMissions();
}
function renderInvList() {
  const el = document.getElementById('inv-list');
  let html = '';

  // ── Auto-detected section (uses activePlayerMap / donePlayerMap) ───────
  const hasAuto = activePlayerMap.size > 0 || donePlayerMap.size > 0;
  if (hasAuto) {
    const {useInLineup, safeToRemove} = _buildLineupLists();

    if (useInLineup.length) {
      html += '<div class="inv-section-hdr" style="color:#22c55e">&#9654; Use in Lineup</div>';
      for (const {name, best} of useInLineup) {
        const pct   = best.pct;
        const color = pct >= 75 ? '#3b9edd' : pct >= 50 ? '#f59e0b' : '#ef4444';
        html += '<div class="inv-player auto-player">'
          + '<span class="inv-player-name" style="color:#e2e8f0">&#9733; ' + name + '</span>'
          + '<div style="flex:1;min-width:0;overflow:hidden">'
          +   '<div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          +     best.t
          +   '</div>'
          +   '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">'
          +     '<div style="flex:1;height:4px;background:#1e3554;border-radius:2px">'
          +       '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:2px"></div>'
          +     '</div>'
          +     '<span style="font-size:11px;color:' + color + ';white-space:nowrap">' + pct + '%</span>'
          +   '</div>'
          + '</div>'
          + '</div>';
      }
    }

    if (safeToRemove.length) {
      html += '<div class="inv-section-hdr" style="color:#64748b;margin-top:10px">&#10003; Safe to Remove</div>';
      for (const name of safeToRemove) {
        html += '<div class="inv-player auto-player">'
          + '<span class="inv-player-name" style="color:#64748b">&#10003; ' + name + '</span>'
          + '<span class="inv-player-hits" style="color:#22c55e">All missions done</span>'
          + '</div>';
      }
    }
  }

  // ── Manually added section ─────────────────────────────────────────────
  if (inventory.length) {
    if (hasAuto) {
      html += '<div class="inv-section-hdr" style="color:#64748b;margin-top:10px">Manually Added</div>';
    }
    for (const p of inventory) {
      let hits = 0;
      for (const tm of Object.keys(D.missions)) {
        for (const arr of Object.values(D.missions[tm])) {
          for (const m of arr) {
            if (m.t.toLowerCase().includes(p.toLowerCase())) hits++;
          }
        }
      }
      html += '<div class="inv-player">'
        + '<span class="inv-player-name">&#9733; ' + p + '</span>'
        + '<span class="inv-player-hits">' + hits + ' mission' + (hits !== 1 ? 's' : '') + '</span>'
        + '<button class="inv-remove" onclick="removePlayer(' + JSON.stringify(p) + ')">&#x2715;</button>'
        + '</div>';
    }
  }

  if (!html) {
    el.innerHTML = '<div class="inv-empty">No players detected yet — run a fetch to auto-detect from mission progress, or add names manually above.</div>';
    return;
  }
  el.innerHTML = html;
}

// ── Wire controls ──────────────────────────────────────────────────────────
function rerender() {
  if (curTeam) renderMissions();
  else if (curProg) renderOtherMissions(curProg);
  else renderHome();
}
document.getElementById('search').addEventListener('input', rerender);
document.getElementById('fstatus').addEventListener('change', rerender);
document.getElementById('fsort').addEventListener('change', rerender);

// ── Init ───────────────────────────────────────────────────────────────────
buildAutoInventory();
renderInvList();
selectHome();
</script>
</body>
</html>''')

html = ''.join(html_parts)
html = html.replace('DATA_BANNER_CONTENT', banner_content)

out_path = os.path.join(SCRIPT_DIR, 'MLB Team Affinity Tracker.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

import os
print('Done! Size:', os.path.getsize('C:/Users/jeffr/Claude/MLB Team Affinity Tracker.html'), 'bytes')
