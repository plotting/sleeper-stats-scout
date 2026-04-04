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
    'team_xp':        live.get('team_xp', {}),
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
  border-radius: 10px; padding: 16px 20px 24px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 16px;
  background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%);
  position: relative; overflow: hidden;
}
.team-banner::after {
  content: ""; position: absolute; right: -20px; top: -20px;
  width: 140px; height: 140px; border-radius: 50%;
  background: rgba(255,255,255,0.05);
}
.xp-fill-wrap {
  position: absolute; bottom: 0; left: 0; right: 0; height: 20px;
}
.xp-fill-track {
  position: absolute; bottom: 0; left: 0; right: 0; height: 7px;
  background: rgba(0,0,0,0.30);
}
.xp-fill {
  position: absolute; bottom: 0; left: 0; height: 7px;
  background: linear-gradient(90deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.95) 100%);
  min-width: 3px; border-radius: 0 4px 4px 0;
  transition: width 0.5s ease;
}
.xp-tick {
  position: absolute; bottom: 0; height: 10px; width: 1px;
  background: rgba(0,0,0,0.45); transform: translateX(-50%);
}
.xp-tick-lbl {
  position: absolute; bottom: 11px; left: 50%; transform: translateX(-50%);
  font-size: 8px; color: rgba(255,255,255,0.6); white-space: nowrap; line-height: 1;
  pointer-events: none;
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
.home-lineup-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 22px; }
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
/* AFFINITY GRID */
.ag-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ag-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.ag-th { padding: 9px 12px; background: var(--surface2); color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; user-select: none; white-space: nowrap; border-bottom: 1px solid var(--border); text-align: left; }
.ag-th:hover { color: var(--text); }
.ag-team-col { min-width: 140px; }
.ag-row:hover td { background: rgba(255,255,255,0.03); }
.ag-row:not(:last-child) td { border-bottom: 1px solid rgba(30,53,84,0.5); }
.ag-td { padding: 7px 12px; vertical-align: middle; min-width: 90px; }
.ag-done { background: rgba(34,197,94,0.06); }
.ag-check { color: #22c55e; font-size: 13px; font-weight: 700; line-height: 1; }
.ag-prog-txt { font-size: 11px; font-weight: 600; line-height: 1.3; margin-bottom: 3px; }
.ag-prog-done { color: rgba(34,197,94,0.45); font-size: 10px; }
.ag-zero .ag-prog-txt { color: var(--muted); }
.ag-empty { color: var(--muted); text-align: center; }
.ag-bar-track { height: 4px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.ag-bar-fill { height: 100%; border-radius: 2px; }
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
// activePlayerMap:  name → [non-Moment missions where 0 < pct < 100]  (USE in lineup)
// donePlayerMap:    name → [missions where pct >= 100]                 (owned player)
// repeatableMap:    name → [active REPEATABLE missions they're eligible for]
const activePlayerMap = new Map();
const donePlayerMap   = new Map();
const repeatableMap   = new Map();

function extractOwnerFromMission(m) {
  const title = m.t || '';
  // 1. "Firstname Lastname - Country" WBC-style title → name before the dash
  const cp = title.match(/^([A-Z][A-Za-z\\u00C0-\\u024F'-]+(?: [A-Z][A-Za-z\\u00C0-\\u024F'-]+)+)\\.?\\s*-\\s*[A-Z][a-z]/);
  if (cp) return cp[1];
  // 2. "with Name" in description (e.g. "Record 10 Ks with Seth Lugo")
  const dp = (m.d || '').match(/\\bwith\\s+([A-Z][A-Za-z\\u00C0-\\u024F'-]+(?: [A-Z][A-Za-z\\u00C0-\\u024F'-]+){1,3})/);
  if (dp) return dp[1];
  // 2b. digit-prefix series ("with 2nd Half Heroes Manny Ramirez" -> "Manny Ramirez")
  const dpDigit = (m.d || '').match(/\\bwith\\s+\\d\\S*\\s+(?:\\S+\\s+)*([A-Z][A-Za-z\\u00C0-\\u024F'-]+\\s+[A-Z][A-Za-z\\u00C0-\\u024F'-]+)(?:\\s*\\.| |$)/);
  if (dpDigit) return dpDigit[1];
  // 3. "w/ Name" at end of title, allowing optional trailing "Jr." / "Sr."
  const tp = title.match(/\\bw\\/\\s*([A-Z][A-Za-z\\u00C0-\\u024F'-]+(?: [A-Z][A-Za-z\\u00C0-\\u024F'-]+)*(?:\\s+[JS]r\\.?)?)\\s*\\.?\\s*$/i);
  if (tp) return tp[1].replace(/\\.\\s*$/, '').trim();
  return null;
}

function _isExcluded(name) {
  const last = name.split(' ').pop().toLowerCase().replace(/\\.$/, '');
  return LINEUP_EXCL.has(last) || LINEUP_EXCL.has(name.toLowerCase());
}

// Returns true for "Firstname Lastname - Country" WBC/Classic Moment titles.
// These are played in Moments mode — they identify ownership but don't need lineup use.
function _isCountryMoment(m) {
  // Allow optional trailing "." (handles "Dante Bichette Jr. - Brazil")
  return /^[A-Z][A-Za-z\\u00C0-\\u024F'-]+(?: [A-Z][A-Za-z\\u00C0-\\u024F'-]+)+\\.?\\s*-\\s*[A-Z][a-z]/.test(m.t || '');
}

// Parse "Eligible players include X, Y, and Z" from REPEATABLE descriptions
function _repeatablePlayers(m) {
  const src = m.d || '';
  const hit = src.match(/eligible players include\\s+(.+?)(?:\\.\\s*Where|\\s*$)/i);
  if (!hit) return [];
  return hit[1].split(/,\\s*(?:and\\s+)?|\\s+and\\s+/).map(function(s){ return s.trim(); })
    .filter(function(s){ return /^[A-Z]/.test(s) && !_isExcluded(s); });
}

function _addTo(map, name, m) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push(m);
}

// ── Flat mission list (all programs) ──────────────────────────────────────
function getAllMissionsFlat() {
  const all = [];
  // Team missions — tag with team name, prog type, and whether the program is complete
  for (const [team, progs] of Object.entries(D.missions)) {
    for (const [progType, arr] of Object.entries(progs)) {
      const nonRep = arr.filter(function(m) { return !m.t.toUpperCase().startsWith('REPEATABLE'); });
      const progDone = nonRep.length > 0 && nonRep.every(function(m) { return m.pct >= 100; });
      for (const m of arr) {
        all.push(Object.assign({}, m, {_team: team, _prog: progType, _progDone: progDone}));
      }
    }
  }
  // Other (themed / XP path) programs
  for (const [pn, pd] of Object.entries(D.other_programs || {})) {
    for (const m of (pd.missions || [])) {
      all.push(Object.assign({}, m, {_prog: pn, _progDone: !!pd.complete}));
    }
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
  repeatableMap.clear();

  // Pass 1: scan all missions with pct > 0; bucket into active vs done.
  // Country Moments ("Name - Country") are played in Moments mode — they prove
  // ownership but must NOT drive "Use in Lineup" recommendations.
  for (const m of allMissionsFlat) {
    if (m.pct <= 0) continue;
    // Country Moments ("Name - Country") are mini-games played with a provided card —
    // completing one does NOT mean you own that player card. Ignore entirely.
    if (_isCountryMoment(m)) continue;
    const name = extractOwnerFromMission(m);
    if (!name || _isExcluded(name)) continue;
    if (m.pct >= 100) _addTo(donePlayerMap, name, m);
    else              _addTo(activePlayerMap, name, m);
  }

  // Pass 1b: REPEATABLE missions — parse eligible player names from descriptions.
  // If a REPEATABLE has any progress, those players contribute XP to it.
  // Skip REPEATABLEs belonging to programs that are already complete.
  for (const m of allMissionsFlat) {
    const isRep = m.t.startsWith('REPEATABLE') || (m.d || '').startsWith('REPEATABLE');
    if (!isRep || m.pct <= 0 || m.pct >= 100 || m._progDone) continue;
    for (const pname of _repeatablePlayers(m)) {
      if (!repeatableMap.has(pname)) repeatableMap.set(pname, []);
      repeatableMap.get(pname).push(m);
    }
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
  // e.g. "Adrian Almeida" done WBC mission + 0% "5 IP w/ Almeida" → should use him.
  // Skip Country Moments — those never require a lineup slot.
  for (const knownName of donePlayerMap.keys()) {
    if (activePlayerMap.has(knownName)) continue;
    for (const m of allMissionsFlat) {
      if (m.pct >= 100) continue;
      if (_isCountryMoment(m)) continue;        // Moments don't need lineup
      const nm = extractOwnerFromMission(m);
      if (!nm) continue;
      if (nm === knownName || (!nm.includes(' ') && knownName.endsWith(' ' + nm))) {
        // Plain match or last-name match — use the known (owned) name as key
        _addTo(activePlayerMap, knownName, m);
      } else if (nm.endsWith(' ' + knownName)) {
        // Series-prefix match: mission says "Jolt Adam Jones", known card is "Adam Jones"
        // Key on nm so _cardInfo checks for the specific series card in invMap
        _addTo(activePlayerMap, nm, m);
      }
    }
  }

  // Pass 5: inventory-driven — for each card in the fetched inventory,
  // if not already tracked, scan ALL missions (including pct=0) for their name.
  // D.inventory entries can be either plain strings or {name,pos,positions} dicts.
  const inventory = D.inventory || [];
  for (const invEntry of inventory) {
    // Normalise: handle both string and {name,...} object formats
    const fullName = (typeof invEntry === 'string'
      ? invEntry
      : (invEntry && invEntry.name) || '').trim();
    if (!fullName || _isExcluded(fullName)) continue;
    const parts = fullName.split(/\s+/);
    if (parts.length < 2) continue;              // skip single-word entries
    const lastName = parts[parts.length - 1];
    if (activePlayerMap.has(fullName)) continue; // already tracked
    for (const m of allMissionsFlat) {
      if (m.pct >= 100) continue;
      if (_isCountryMoment(m)) continue;
      const nm = extractOwnerFromMission(m);
      if (!nm) continue;
      if (nm === fullName || nm === lastName || fullName.endsWith(' ' + nm)) {
        // Plain / last-name match — card name is sufficient, use fullName as key
        _addTo(activePlayerMap, fullName, m); break;
      } else if (nm.endsWith(' ' + fullName)) {
        // Series-prefix match: mission says "Jolt Adam Jones", card is "Adam Jones"
        // Key on nm so _cardInfo checks invMap for the specific "Jolt Adam Jones" entry
        _addTo(activePlayerMap, nm, m); break;
      }
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
  window.scrollTo(0, 0);
}
function selectAffinityGrid() {
  clearActive();
  curTeam = null; curProg = null;
  const gb = document.getElementById('grid-btn');
  if (gb) gb.classList.add('active');
  renderAffinityGrid();
  window.scrollTo(0, 0);
}

// Build a name→card lookup from inventory (supports both old string[] and new {name,pos}[])
// Indexed by: exact name, "Series Name" compound key, and last name (for 2-word names only).
const invMap = new Map();
for (const entry of (D.inventory || [])) {
  if (typeof entry === 'string') {
    invMap.set(entry, {pos: '', positions: [], series: ''});
  } else if (entry && entry.name) {
    invMap.set(entry.name, entry);
    // Index by "Series Name" so missions like "Jolt Adam Jones" resolve to the correct card
    if (entry.series) {
      const skey = entry.series + ' ' + entry.name;
      if (!invMap.has(skey)) invMap.set(skey, entry);
    }
    // Also index by last name for simple "First Last" lookups only
    const last = entry.name.split(' ').pop();
    if (last && !invMap.has(last)) invMap.set(last, entry);
  }
}
function _cardInfo(name) {
  if (invMap.has(name)) return invMap.get(name);
  // Last-name fallback only for simple two-word names ("First Last").
  // Series-prefixed names like "Jolt Adam Jones" must match exactly via the
  // "Series Name" key above — last-name would be too greedy and match any card.
  const parts = name.split(' ');
  if (parts.length <= 2) {
    const last = parts[parts.length - 1];
    if (last && invMap.has(last)) return invMap.get(last);
  }
  return null;
}
function _posBadge(name) {
  const card = _cardInfo(name);
  if (!card || !card.positions || !card.positions.length) return '';
  const primary = card.positions[0];
  const secondary = card.positions.slice(1);
  let html = '<span style="font-size:9px;background:#1e3a5f;color:#7dd3fc;'
    + 'padding:1px 5px;border-radius:3px;font-weight:700;margin-left:4px">'
    + primary + '</span>';
  if (secondary.length) {
    html += '<span style="font-size:9px;color:#475569;margin-left:3px">'
      + secondary.join('/') + '</span>';
  }
  return html;
}

function _buildLineupLists() {
  const hasInventory = invMap.size > 0;

  // All players with active stat missions go into useInLineup.
  // isRepeat=true means they're also eligible for an active REPEATABLE (double value).
  // When inventory is loaded, gate on ownership.
  const useInLineup = [];
  for (const [name, missions] of activePlayerMap) {
    if (hasInventory && !_cardInfo(name)) continue;  // not owned — skip
    const sorted = missions.slice().sort(function(a, b) { return b.pct - a.pct; });
    useInLineup.push({name, best: sorted[0], isRepeat: repeatableMap.has(name)});
  }
  // Sort: double-dippers first (highest combined value), then by mission progress
  useInLineup.sort(function(a, b) {
    if (a.isRepeat !== b.isRepeat) return a.isRepeat ? -1 : 1;
    return b.best.pct - a.best.pct;
  });

  // Safe to remove: all missions done, no active work, no repeatable remaining
  const safeToRemove = [];
  for (const name of donePlayerMap.keys()) {
    if (!activePlayerMap.has(name) && !repeatableMap.has(name)) safeToRemove.push(name);
  }

  // Repeatable-only: eligible for REPEATABLE but no active stat mission.
  // Gate on ownership when inventory is loaded.
  const repeatableOnly = [];
  for (const [name, missions] of repeatableMap) {
    if (activePlayerMap.has(name)) continue;  // already in useInLineup
    if (hasInventory && !_cardInfo(name)) continue;
    const best = missions.slice().sort(function(a, b) { return b.pct - a.pct; })[0];
    repeatableOnly.push({name, best});
  }
  repeatableOnly.sort(function(a, b) { return b.best.pct - a.best.pct; });

  return {useInLineup, safeToRemove, repeatableOnly};
}

function renderHome() {
  const content = document.getElementById('content');
  const {useInLineup, safeToRemove, repeatableOnly} = _buildLineupLists();

  // 10 closest incomplete missions — skip completed programs and REPEATABLEs
  const closest = allMissionsFlat
    .filter(function(m) {
      return m.pct < 100 && m.pct > 0
        && !m._progDone
        && !m.t.toUpperCase().startsWith('REPEATABLE');
    })
    .sort(function(a, b) { return b.pct - a.pct; })
    .slice(0, 10);

  // Recently completed: prefer delta since last refresh; otherwise nothing
  const showRecent = recentlyCompleted.length > 0;
  const recentShow = recentlyCompleted.slice(-10).reverse();

  // Render a lineup player row — shows name, position badge, optional REP badge,
  // mission goal title, and progress bar.
  function lineupRow(name, pct, color, goalTitle, isRepeatAlso) {
    const repBadge = isRepeatAlso
      ? '<span style="font-size:8px;background:#5b21b6;color:#ddd6fe;padding:1px 5px;'
        + 'border-radius:2px;font-weight:700;margin-left:4px;vertical-align:middle">REP</span>'
      : '';
    return '<div class="home-player-row">'
      + '<span class="home-player-name" style="color:#e2e8f0;display:flex;align-items:center;flex-wrap:wrap;gap:2px">'
      +   '&#9733; ' + name + _posBadge(name) + repBadge
      + '</span>'
      + '<div style="flex:1;min-width:60px">'
      +   (goalTitle
            ? '<div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">'
              + goalTitle + '</div>'
            : '')
      +   '<div style="display:flex;align-items:center;gap:4px">'
      +     '<div class="home-player-bar"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:2px"></div></div>'
      +     '<span class="home-player-pct" style="color:' + color + '">' + pct + '%</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  // Lineup card HTML — all owned players with active stat missions
  let useHtml = '';
  if (useInLineup.length) {
    for (const {name, best, isRepeat} of useInLineup) {
      const pct = best.pct;
      const c   = progColor(pct);
      // If the mission title is just "w/ Name" (no stat prefix), enrich it from
      // the description: "Tally 500 Parallel XP with All-Star Keith Foulke" → "500 XP w/ Foulke"
      let goalTitle = best.t || '';
      if (/^\s*w\/\s/i.test(goalTitle)) {
        const xpM = (best.d || '').match(/(\d[\d,]*)\s*(?:Parallel\s+)?XP/i);
        if (xpM) goalTitle = xpM[1].replace(/,/g,'') + ' XP ' + goalTitle.trim();
      }
      useHtml += lineupRow(name, pct, c, goalTitle, isRepeat);
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

  // Helper: render one repeatable-contrib row
  function repRow(name, best) {
    const pct = best.pct;
    const c   = progColor(pct);
    return '<div class="home-player-row">'
      + '<span class="home-player-name" style="color:#e2e8f0;display:flex;align-items:center;flex-wrap:wrap;gap:2px">&#9654; ' + name + _posBadge(name) + '</span>'
      + '<div style="flex:1;min-width:60px">'
      +   '<div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">'
      +     best.t.replace(/^REPEATABLE:\s*/i, '')
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:4px">'
      +     '<div class="home-player-bar"><div style="width:' + pct + '%;height:100%;background:' + c + ';border-radius:2px"></div></div>'
      +     '<span class="home-player-pct" style="color:' + c + '">' + pct + '%</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  let repeatHtml = '';
  if (repeatableOnly.length) {
    for (const {name, best} of repeatableOnly) {
      repeatHtml += repRow(name, best);
    }
  } else {
    repeatHtml = '<div class="home-empty">None detected</div>';
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
    +     '<div class="home-card-title" style="color:#a78bfa">&#9733; Repeatable XP</div>'
    +     repeatHtml
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
const gridBtn = document.createElement('button');
gridBtn.id = 'grid-btn';
gridBtn.className = 'team-btn';
gridBtn.innerHTML = '<span style="font-size:13px;margin-right:6px">&#9776;</span><span style="flex:1">Affinity Grid</span>';
gridBtn.addEventListener('click', selectAffinityGrid);
sidebar.appendChild(gridBtn);
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
    const mlist   = meta.missions || [];
    const mNonRep = mlist.filter(function(m) { return !m.t.toUpperCase().startsWith('REPEATABLE'); });
    const pdone   = mNonRep.filter(function(m) { return m.pct >= 100; }).length;
    // Prefer real XP progress over mission-count ratio when available
    const ppct    = (meta.xp_earned != null && meta.xp_total)
      ? Math.round(meta.xp_earned / meta.xp_total * 100)
      : (mNonRep.length ? Math.round(pdone / mNonRep.length * 100) : 0);
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
let affinitySort = { col: '__overall', dir: 'asc' };

function clearActive() {
  document.querySelectorAll('.team-btn, .other-prog-btn').forEach(b => b.classList.remove('active'));
}

// Returns the bottom fill-bar HTML for a team-banner.
// milestones: array of numeric XP values [5,10,15,...100]; total: max milestone value.
function xpBar(pct, milestones, total) {
  const w = Math.min(Math.max(pct, 0), 100);
  let ticks = '';
  if (Array.isArray(milestones) && milestones.length && total > 0) {
    for (const ms of milestones) {
      const pos = Math.min(ms / total * 100, 100).toFixed(2);
      ticks += '<div class="xp-tick" style="left:' + pos + '%">'
             + '<div class="xp-tick-lbl">' + ms + '</div>'
             + '</div>';
    }
  }
  return '<div class="xp-fill-wrap">'
       + '<div class="xp-fill-track"></div>'
       + '<div class="xp-fill" style="width:' + w + '%"></div>'
       + ticks
       + '</div>';
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
        xpBar(0, [], 0) +
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

  const nonRepeat = missions.filter(function(m) { return !m.t.toUpperCase().startsWith('REPEATABLE'); });
  const done    = nonRepeat.filter(function(m) { return m.pct >= 100; }).length;
  // Prefer scraped XP path data (actual game progress) over mission-count ratio
  const xpEarned = meta.xp_earned != null ? meta.xp_earned : null;
  const xpTotal  = meta.xp_total  != null ? meta.xp_total  : null;
  const pct = xpEarned != null && xpTotal
    ? Math.round(xpEarned / xpTotal * 100)
    : (nonRepeat.length ? Math.round(done / nonRepeat.length * 100) : 0);
  const ringLabel = xpEarned != null
    ? ('<span class="rn">' + xpEarned + '</span><span class="rl">' + (xpTotal ? 'of ' + xpTotal : 'XP') + '</span>')
    : ('<span class="rn">' + pct + '%</span><span class="rl">done</span>');
  const subLabel = xpEarned != null
    ? (done + ' / ' + nonRepeat.length + ' missions \u2022 ' + xpEarned + (xpTotal ? ' / ' + xpTotal : '') + ' XP')
    : (done + ' / ' + nonRepeat.length + ' missions complete');
  const R = 30, circ = Math.round(2 * Math.PI * R);
  const offset  = Math.round(circ * (1 - pct / 100));

  content.innerHTML =
    '<div class="team-banner" style="--c1:' + (meta.color || '#1e3a5f') + ';--c2:#0d1b2e">' +
      '<div class="banner-info"><h1>' + progName + '</h1>' +
      '<p>' + subLabel + '</p></div>' +
      '<div class="ring-wrap">' +
      '<svg width="70" height="70" viewBox="0 0 70 70">' +
      '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="5"/>' +
      '<circle cx="35" cy="35" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="5"' +
      ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/>' +
      '</svg>' +
      '<div class="ring-label">' + ringLabel + '</div>' +
      '</div>' +
      xpBar(pct, meta.xp_milestones || [], xpTotal || 0) +
    '</div>' +
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

  const allMissions    = meta.missions || [];
  const nonRepMissions = allMissions.filter(function(m) { return !m.t.toUpperCase().startsWith('REPEATABLE'); });
  const progDone       = nonRepMissions.filter(function(m) { return m.pct >= 100; }).length;
  const ownedCount  = allMissions.filter(function(m) { return missionHasOwnedPlayer(m.t); }).length;

  if (!list.length) {
    area.innerHTML = '<div class="empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>No missions match your filters</p></div>';
    return;
  }

  let summHtml = '<div class="summary-row">'
    + '<div class="sum-pill">Showing <strong>' + list.length + '</strong> missions</div>'
    + '<div class="sum-pill"><strong>' + progDone + '</strong> / ' + nonRepMissions.length + ' complete</div>';
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
  const xpEl = document.getElementById('team-xp-bar');
  if (xpEl) xpEl.innerHTML = teamXpBar();
  renderMissions();
}

// Returns the xpBar HTML for the current team + prog tab.
function teamXpBar() {
  const txp = (D.team_xp && D.team_xp[curTeam]) ? D.team_xp[curTeam][curProg] : null;
  if (!txp || txp.xp_total == null) return xpBar(0, [], 0);
  const pct = Math.round(txp.xp_earned / txp.xp_total * 100);
  return xpBar(pct, txp.xp_milestones || [], txp.xp_total);
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
    + '</div>'
    + '<div id="team-xp-bar">' + teamXpBar() + '</div>'
    + '</div>'
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
  const isCountryMoment = /^[A-Z][A-Za-z\\u00C0-\\u024F'-]+(?: [A-Z][A-Za-z\\u00C0-\\u024F'-]+)+\\.?\\s*-\\s*[A-Z][a-z]/.test(m.t);
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

// ── Affinity Grid ───────────────────────────────────────────────────────────
const STAT_KEYS = ['Hits','HR','Runs','TB','Win','Ks','IP'];
const STAT_TITLE_MAP = {'hits':'Hits','hr':'HR','runs':'Runs','tb':'TB','win':'Win','ks':'Ks','ip':'IP'};
function statKeyFromTitle(t) {
  const prefix = t.split(' w/ ')[0].trim().toLowerCase();
  return STAT_TITLE_MAP[prefix] || null;
}
function buildAffinityData() {
  const result = {};
  for (const [team, progs] of Object.entries(D.missions)) {
    result[team] = {};
    for (const key of STAT_KEYS) result[team][key] = null;
    for (const m of (progs['My Journey'] || [])) {
      const key = statKeyFromTitle(m.t);
      if (!key) continue;
      const parts = m.p.split('/');
      const cur = parseInt(parts[0], 10);
      const tot = parseInt((parts[1] || '').split(' ')[0], 10);
      result[team][key] = { cur: isNaN(cur) ? 0 : cur, total: isNaN(tot) ? 0 : tot, pct: m.pct };
    }
    const cells = STAT_KEYS.map(function(k) { return result[team][k]; }).filter(Boolean);
    result[team].__overall = cells.length ? cells.reduce(function(s,c){ return s+c.pct; }, 0) / cells.length : 0;
  }
  return result;
}
function affinityCell(cell) {
  if (!cell) return '<td class="ag-td ag-empty"><span class="ag-na">\u2014</span></td>';
  if (cell.pct >= 100) {
    return '<td class="ag-td ag-done">'
      + '<div class="ag-check">&#10003;</div>'
      + '<div class="ag-prog-txt ag-prog-done">' + cell.cur + '/' + cell.total + '</div>'
      + '</td>';
  }
  const color = progColor(cell.pct);
  const isZero = cell.pct === 0;
  return '<td class="ag-td' + (isZero ? ' ag-zero' : '') + '">'
    + '<div class="ag-prog-txt" style="color:' + (isZero ? 'var(--muted)' : color) + '">' + cell.cur + '/' + cell.total + '</div>'
    + '<div class="ag-bar-track"><div class="ag-bar-fill" style="width:' + Math.min(cell.pct,100) + '%;background:' + (isZero ? 'rgba(255,255,255,0.06)' : color) + '"></div></div>'
    + '</td>';
}
function affinityHeaderClick(col) {
  if (affinitySort.col === col) { affinitySort.dir = affinitySort.dir === 'asc' ? 'desc' : 'asc'; }
  else { affinitySort.col = col; affinitySort.dir = 'asc'; }
  renderAffinityGrid();
}
function renderAffinityGrid() {
  const content = document.getElementById('content');
  const data = buildAffinityData();
  let teams = Object.keys(data);
  const col = affinitySort.col, dir = affinitySort.dir;
  teams.sort(function(a, b) {
    const va = col === '__overall' ? data[a].__overall : (data[a][col] ? data[a][col].pct : -1);
    const vb = col === '__overall' ? data[b].__overall : (data[b][col] ? data[b][col].pct : -1);
    return va !== vb ? (dir === 'asc' ? va - vb : vb - va) : a.localeCompare(b);
  });
  function sortInd(c) { return affinitySort.col === c ? (affinitySort.dir === 'asc' ? ' &#9650;' : ' &#9660;') : ''; }
  let thead = '<tr><th class="ag-th ag-team-col" onclick="affinityHeaderClick(&apos;__overall&apos;)">Team' + sortInd('__overall') + '</th>';
  for (const key of STAT_KEYS) thead += '<th class="ag-th" onclick="affinityHeaderClick(&apos;' + key + '&apos;)">' + key + sortInd(key) + '</th>';
  thead += '</tr>';
  let tbody = '';
  for (const team of teams) {
    const c1 = D.colors[team] ? D.colors[team][0] : '#3b9edd';
    tbody += '<tr class="ag-row"><td class="ag-td ag-team-col"><span class="team-dot" style="background:' + c1 + ';display:inline-block;vertical-align:middle;margin-right:6px"></span>' + team + '</td>';
    for (const key of STAT_KEYS) tbody += affinityCell(data[team][key]);
    tbody += '</tr>';
  }
  content.innerHTML = '<div class="home-banner" style="margin-bottom:14px">'
    + '<div><h1>Affinity Grid</h1><p>My Journey stats across all 30 teams &bull; click a column header to sort</p></div></div>'
    + '<div class="ag-wrap"><table class="ag-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>';
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
  const hasAuto = activePlayerMap.size > 0 || donePlayerMap.size > 0 || repeatableMap.size > 0;
  if (hasAuto) {
    const {useInLineup, safeToRemove, repeatableContribs} = _buildLineupLists();

    if (useInLineup.length) {
      html += '<div class="inv-section-hdr" style="color:#22c55e">&#9654; Use in Lineup</div>';
      for (const {name, best} of useInLineup) {
        const pct   = best.pct;
        const color = pct >= 75 ? '#3b9edd' : pct >= 50 ? '#f59e0b' : '#ef4444';
        html += '<div class="inv-player auto-player">'
          + '<span class="inv-player-name" style="color:#e2e8f0;display:flex;align-items:center;flex-wrap:wrap;gap:2px">&#9733; ' + name + _posBadge(name) + '</span>'
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

    if (repeatableContribs.length) {
      html += '<div class="inv-section-hdr" style="color:#a78bfa;margin-top:10px">&#9733; Repeatable XP Contributors</div>';
      for (const {name, best} of repeatableContribs) {
        const pct   = best.pct;
        const color = progColor(pct);
        html += '<div class="inv-player auto-player">'
          + '<span class="inv-player-name" style="color:#e2e8f0;display:flex;align-items:center;flex-wrap:wrap;gap:2px">&#9654; ' + name + _posBadge(name) + '</span>'
          + '<div style="flex:1;min-width:0;overflow:hidden">'
          +   '<div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          +     best.t.replace(/^REPEATABLE:\\s*/i, '')
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

// ── Global search ──────────────────────────────────────────────────────────
function renderSearchResults(q) {
  const content = document.getElementById('content');
  const lq = q.toLowerCase();
  const hits = allMissionsFlat.filter(function(m) {
    return m.t.toLowerCase().includes(lq) || (m.d || '').toLowerCase().includes(lq);
  });
  if (!hits.length) {
    content.innerHTML = '<div style="padding:32px;color:var(--muted)">No missions match &ldquo;' + q + '&rdquo;</div>';
    return;
  }
  // Group by program/team context
  const groups = new Map();
  for (const m of hits) {
    const label = m._team ? m._team + ' — ' + m._prog : (m._prog || 'Other');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(m);
  }
  let html = '<div style="padding:12px 0 4px 2px;font-size:12px;color:var(--muted)">'
           + hits.length + ' result' + (hits.length !== 1 ? 's' : '') + ' for &ldquo;' + q + '&rdquo;</div>';
  for (const [label, missions] of groups) {
    html += '<div style="margin-bottom:6px;padding:6px 10px;background:rgba(255,255,255,0.04);'
          + 'border-radius:6px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">'
          + label + '</div>';
    html += '<div class="mission-grid">' + missions.map(buildCard).join('') + '</div>';
  }
  content.innerHTML = html;
}

// ── Wire controls ──────────────────────────────────────────────────────────
function rerender() {
  const q = document.getElementById('search').value.trim();
  if (q) { renderSearchResults(q); return; }
  if (curTeam) renderMissions();
  else if (curProg) renderOtherMissions(curProg);
  else if (document.getElementById('grid-btn') && document.getElementById('grid-btn').classList.contains('active')) renderAffinityGrid();
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

print('Done! Size:', os.path.getsize(out_path), 'bytes')
