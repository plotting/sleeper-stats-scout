"""
fetch_mlb26.py  -  Pull live MLB The Show 26 program data and rebuild tracker

Usage:
    py -3 fetch_mlb26.py

How to get your cookie:
  1. Log in at https://mlb26.theshow.com
  2. Open DevTools (F12) -> Application tab -> Cookies -> mlb26.theshow.com
  3. Copy the VALUE of '_theshow_session'
  4. Paste it when prompted
"""

import json, re, sys, os, time, html as html_module
import urllib.request, urllib.error, urllib.parse

BASE     = "https://mlb26.theshow.com"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_JSON = os.path.join(SCRIPT_DIR, "mlb_data_live.json")

DIVISIONS = {
    "AL East":    ["Yankees","Red Sox","Blue Jays","Orioles","Rays"],
    "AL Central": ["Guardians","Twins","Tigers","White Sox","Royals"],
    "AL West":    ["Astros","Rangers","Angels","Athletics","Mariners"],
    "NL East":    ["Braves","Phillies","Mets","Nationals","Marlins"],
    "NL Central": ["Cubs","Brewers","Cardinals","Pirates","Reds"],
    "NL West":    ["Dodgers","Giants","Padres","Diamondbacks","Rockies"],
}

TEAM_COLORS = {
    "Angels":["#BA0021","#003263"],"Astros":["#002D62","#EB6E1F"],
    "Athletics":["#003831","#EFB21E"],"Blue Jays":["#134A8E","#1D2D5C"],
    "Braves":["#CE1141","#13274F"],"Brewers":["#12284B","#FFC52F"],
    "Cardinals":["#C41E3A","#0C2340"],"Cubs":["#0E3386","#CC3433"],
    "Diamondbacks":["#A71930","#E3D4AD"],"Dodgers":["#005A9C","#EF3E42"],
    "Giants":["#FD5A1E","#27251F"],"Guardians":["#E31937","#002B5C"],
    "Mariners":["#0C2C56","#005C5C"],"Marlins":["#00A3E0","#EF3340"],
    "Mets":["#002D72","#FF5910"],"Nationals":["#AB0003","#14225A"],
    "Orioles":["#DF4601","#231F20"],"Padres":["#2F241D","#FFC425"],
    "Phillies":["#E81828","#002D72"],"Pirates":["#FDB827","#27251F"],
    "Rangers":["#003278","#C0111F"],"Rays":["#092C5C","#8FBCE6"],
    "Red Sox":["#BD3039","#0D2B56"],"Reds":["#C6011F","#000000"],
    "Rockies":["#33006F","#C4CED4"],"Royals":["#004687","#BD9B60"],
    "Tigers":["#0C2340","#FA4616"],"Twins":["#002B5C","#D31145"],
    "White Sox":["#27251F","#C4CED4"],"Yankees":["#132448","#C4CED4"],
}

OTHER_PROGRAMS = {
    "1st Inning XP Path": {"color": "#1e6fb5", "icon": "XP"},
    "Assorted Programs":  {"color": "#8b5cf6", "icon": "AS"},
    "Multiplayer Program":{"color": "#059669", "icon": "MP"},
}


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def make_headers(cookie):
    return {
        "Cookie": f"_theshow_session={cookie}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://mlb26.theshow.com/programs",
    }


def get(url, headers, timeout=20):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace"), r.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


# ── Program page discovery ────────────────────────────────────────────────────

def find_program_links(html_body):
    """Find program_view links in the programs listing page."""
    links = []
    # Match href="/programs/program_view?..."
    for m in re.finditer(r'href=["\']([^"\']*program_view[^"\']*)["\']', html_body):
        raw = html_module.unescape(m.group(1))
        if raw.startswith("/"):
            raw = BASE + raw
        if raw not in links:
            links.append(raw)
    return links


def parse_url_params(url):
    parsed = urllib.parse.urlparse(url)
    return dict(urllib.parse.parse_qsl(parsed.query))


# ── Mission extraction from program_view HTML ─────────────────────────────────

def extract_json_blob(html_body, key):
    """Try to pull a JSON array/object for 'key' from embedded script tags."""
    patterns = [
        rf'"{key}"\s*:\s*(\[.*?\])',
        rf'"{key}"\s*:\s*(\{{.*?\}})',
        rf"'{key}'\s*:\s*(\[.*?\])",
        rf'var {key}\s*=\s*(\[.*?\]);',
        rf'window\.{key}\s*=\s*(\[.*?\]);',
        rf'gon\.{key}\s*=\s*(\[.*?\]);',
    ]
    for pat in patterns:
        m = re.search(pat, html_body, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                pass
    return None


def parse_missions_from_html(html_body, program_name=""):
    """
    Multi-strategy mission extraction from program_view HTML.
    The Rails app embeds data in several possible formats.
    """
    missions = []

    # Strategy 1: Look for a JSON blob containing missions array
    for key in ("missions", "program_missions", "tasks", "objectives", "items"):
        blob = extract_json_blob(html_body, key)
        if isinstance(blob, list) and blob:
            for item in blob:
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or item.get("name") or
                         item.get("description") or item.get("objective") or "")
                current = item.get("progress", item.get("current_value",
                          item.get("current", item.get("count", 0))))
                goal    = item.get("goal", item.get("requirement",
                          item.get("target", item.get("max_value", 0))))
                stat    = item.get("stat_type", item.get("stat", ""))
                reward  = (item.get("reward", item.get("xp_reward",
                           item.get("xp", item.get("points", "")))))
                pct     = item.get("percent_complete", item.get("pct",
                          item.get("progress_pct", 0)))
                if not pct and goal:
                    try:
                        pct = min(100.0, round(float(current) / float(goal) * 100, 1))
                    except Exception:
                        pct = 0.0
                prog_str = f"{current}/{goal} {stat}".strip() if goal else str(current)
                missions.append({
                    "t": str(title).strip(),
                    "r": str(reward),
                    "p": prog_str,
                    "pct": float(pct),
                })
            if missions:
                return missions

    # Strategy 2: Scrape HTML elements (mission cards / task rows)
    # Look for repeating patterns that contain mission data
    # Pattern: data-title="..." data-progress="..." data-reward="..."
    for m in re.finditer(
        r'data-title="([^"]+)"[^>]*data-progress="([^"]*)"[^>]*data-reward="([^"]*)"',
        html_body
    ):
        missions.append({
            "t": html_module.unescape(m.group(1)),
            "r": m.group(3),
            "p": m.group(2),
            "pct": 0.0,
        })
    if missions:
        return missions

    # Strategy 3: Look for Inertia/Vue/React initial props JSON
    for m in re.finditer(r'data-page="([^"]+)"', html_body):
        try:
            props = json.loads(html_module.unescape(m.group(1)))
            # Recursively search for a "missions" key
            def find_missions(obj, depth=0):
                if depth > 5:
                    return []
                if isinstance(obj, list):
                    results = []
                    for item in obj:
                        results.extend(find_missions(item, depth+1))
                    return results
                if isinstance(obj, dict):
                    if "missions" in obj:
                        return obj["missions"] if isinstance(obj["missions"], list) else []
                    for v in obj.values():
                        r = find_missions(v, depth+1)
                        if r:
                            return r
                return []
            raw_missions = find_missions(props)
            for item in raw_missions:
                if isinstance(item, dict):
                    title = item.get("title", item.get("name", ""))
                    missions.append({
                        "t": str(title),
                        "r": str(item.get("reward", "")),
                        "p": str(item.get("progress", "")),
                        "pct": float(item.get("percent_complete", 0)),
                    })
        except Exception:
            pass
    if missions:
        return missions

    # Strategy 4: HTML table/list scraping as last resort
    # Look for <li> or <tr> elements with XP reward patterns
    rows = re.findall(
        r'<(?:li|tr)[^>]*>(.*?)</(?:li|tr)>',
        html_body, re.DOTALL | re.IGNORECASE
    )
    for row in rows:
        text = re.sub(r'<[^>]+>', ' ', row).strip()
        text = re.sub(r'\s+', ' ', text)
        # Must look like a mission (contains XP and a progress indicator)
        if re.search(r'\d+[,\d]*\s*XP', text, re.I) and re.search(r'\d+/\d+', text):
            xp = re.search(r'([\d,]+)\s*XP', text, re.I)
            prog = re.search(r'(\d+/\d+[^\s]*)', text)
            title_part = text[:80].strip()
            missions.append({
                "t": html_module.unescape(title_part),
                "r": xp.group(1) if xp else "",
                "p": prog.group(1) if prog else "",
                "pct": 0.0,
            })

    return missions


# ── Team name normalization ───────────────────────────────────────────────────

TEAM_NAME_MAP = {
    "arizona": "Diamondbacks", "diamondbacks": "Diamondbacks",
    "atlanta": "Braves", "braves": "Braves",
    "baltimore": "Orioles", "orioles": "Orioles",
    "boston": "Red Sox", "red sox": "Red Sox",
    "chicago cubs": "Cubs", "cubs": "Cubs",
    "chicago white sox": "White Sox", "white sox": "White Sox",
    "cincinnati": "Reds", "reds": "Reds",
    "cleveland": "Guardians", "guardians": "Guardians",
    "colorado": "Rockies", "rockies": "Rockies",
    "detroit": "Tigers", "tigers": "Tigers",
    "houston": "Astros", "astros": "Astros",
    "kansas city": "Royals", "royals": "Royals",
    "los angeles angels": "Angels", "angels": "Angels",
    "los angeles dodgers": "Dodgers", "dodgers": "Dodgers",
    "miami": "Marlins", "marlins": "Marlins",
    "milwaukee": "Brewers", "brewers": "Brewers",
    "minnesota": "Twins", "twins": "Twins",
    "new york mets": "Mets", "mets": "Mets",
    "new york yankees": "Yankees", "yankees": "Yankees",
    "oakland": "Athletics", "athletics": "Athletics",
    "philadelphia": "Phillies", "phillies": "Phillies",
    "pittsburgh": "Pirates", "pirates": "Pirates",
    "san diego": "Padres", "padres": "Padres",
    "san francisco": "Giants", "giants": "Giants",
    "seattle": "Mariners", "mariners": "Mariners",
    "st. louis": "Cardinals", "cardinals": "Cardinals",
    "tampa bay": "Rays", "rays": "Rays",
    "texas": "Rangers", "rangers": "Rangers",
    "toronto": "Blue Jays", "blue jays": "Blue Jays",
    "washington": "Nationals", "nationals": "Nationals",
}


def normalize_team(raw):
    raw = raw.strip().lower()
    if raw in TEAM_NAME_MAP:
        return TEAM_NAME_MAP[raw]
    for key, val in TEAM_NAME_MAP.items():
        if key in raw:
            return val
    return None


# ── Main fetch logic ──────────────────────────────────────────────────────────

def main():
    print("=" * 62)
    print("  MLB The Show 26 - Live Data Fetcher")
    print("=" * 62)
    print()
    print("Steps to get your session cookie:")
    print("  1. Log in at https://mlb26.theshow.com")
    print("  2. Press F12 -> Application -> Cookies -> mlb26.theshow.com")
    print("  3. Find '_theshow_session' and copy its VALUE")
    print()
    cookie = input("Paste _theshow_session value: ").strip()
    if not cookie:
        sys.exit("No cookie provided.")

    headers = make_headers(cookie)
    print()

    # ── Verify auth ───────────────────────────────────────────────────────
    print("Verifying authentication...")
    body, status = get(f"{BASE}/dashboard", headers)
    if status != 200 or not body:
        print(f"  HTTP {status} - cookie may be expired. Log out, log back in, and try again.")
        sys.exit(1)
    if "sign_in" in body.lower() or 'href="/sessions/new"' in body.lower():
        print("  Redirected to login page - cookie is invalid or expired.")
        sys.exit(1)
    print("  Authentication OK!")
    print()

    # ── Fetch programs listing page ───────────────────────────────────────
    print("Fetching programs page...")
    prog_body, prog_status = get(f"{BASE}/programs", headers)
    if prog_status != 200 or not prog_body:
        print(f"  Failed ({prog_status})")
        sys.exit(1)

    links = find_program_links(prog_body)
    print(f"  Found {len(links)} program links")
    for l in links[:8]:
        print(f"    {l}")
    if len(links) > 8:
        print(f"    ... and {len(links)-8} more")
    print()

    # ── Categorize and fetch each program ────────────────────────────────
    team_missions   = {}   # {team_name: {prog_type: [missions]}}
    other_missions  = {}   # {prog_name: [missions]}

    total = len(links)
    for i, url in enumerate(links, 1):
        params = parse_url_params(url)
        prog_id  = params.get("program_id", "?")
        group_id = params.get("group_id", "")
        team_id  = params.get("team_id", "")

        print(f"  [{i:3}/{total}] Fetching program {prog_id} ...", end=" ", flush=True)
        time.sleep(0.4)   # be polite to the server

        p_body, p_status = get(url, headers)
        if p_status != 200 or not p_body:
            print(f"SKIP ({p_status})")
            continue

        missions = parse_missions_from_html(p_body)

        # Try to identify the program name and team from the page
        page_title = ""
        m_title = re.search(r'<h1[^>]*>(.*?)</h1>', p_body, re.DOTALL | re.IGNORECASE)
        if m_title:
            page_title = re.sub(r'<[^>]+>', '', m_title.group(1)).strip()

        # Team affinity detection
        team = normalize_team(page_title)
        if not team and team_id:
            # Try to find team name from page body
            for candidate in TEAM_NAME_MAP:
                if candidate in p_body.lower()[:2000]:
                    team = TEAM_NAME_MAP[candidate]
                    break

        # Detect program sub-type (My Journey vs Color Storm)
        is_color_storm = bool(re.search(r'color\s*storm', p_body[:3000], re.I))
        prog_type = "Color Storm" if is_color_storm else "My Journey"

        # Detect other programs by title/URL
        is_xp_path = bool(re.search(r'xp\s*(reward\s*)?path|inning.*xp|1st inning', p_body[:3000], re.I))
        is_multi   = bool(re.search(r'multiplayer|ranked|battle royale', p_body[:3000], re.I))
        is_assorted= bool(re.search(r'assorted|themed|drop\s+\d', p_body[:3000], re.I))

        print(f"OK ({len(missions)} missions) - {page_title[:40] or '?'}")

        if team:
            if team not in team_missions:
                team_missions[team] = {}
            if prog_type not in team_missions[team]:
                team_missions[team][prog_type] = []
            team_missions[team][prog_type].extend(missions)
        elif is_xp_path:
            key = "1st Inning XP Path"
            other_missions.setdefault(key, []).extend(missions)
        elif is_multi:
            key = "Multiplayer Program"
            other_missions.setdefault(key, []).extend(missions)
        elif is_assorted or missions:
            key = "Assorted Programs"
            other_missions.setdefault(key, []).extend(missions)

    # Deduplicate missions by title within each category
    def dedup(lst):
        seen, out = set(), []
        for m in lst:
            if m["t"] not in seen and m["t"]:
                seen.add(m["t"])
                out.append(m)
        return out

    for team in team_missions:
        for pt in team_missions[team]:
            team_missions[team][pt] = dedup(
                sorted(team_missions[team][pt], key=lambda x: -x["pct"])
            )
    for key in other_missions:
        other_missions[key] = dedup(
            sorted(other_missions[key], key=lambda x: -x["pct"])
        )

    print()
    print(f"Team missions:  {sum(sum(len(v) for v in t.values()) for t in team_missions.values())} across {len(team_missions)} teams")
    print(f"Other missions: {sum(len(v) for v in other_missions.values())} across {len(other_missions)} programs")

    # ── Save JSON ─────────────────────────────────────────────────────────
    live_data = {
        "divisions":       DIVISIONS,
        "colors":          TEAM_COLORS,
        "missions":        team_missions,
        "other_missions":  other_missions,
        "other_programs":  {k: {"color": v["color"], "icon": v["icon"], "desc": "",
                               "missions": other_missions.get(k, [])}
                            for k, v in OTHER_PROGRAMS.items()},
        "data_source":     "live",
        "data_date":       time.strftime("%Y-%m-%d %H:%M"),
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(live_data, f, indent=2, ensure_ascii=True)
    print(f"\nSaved: {OUT_JSON}")

    # ── Rebuild tracker HTML ──────────────────────────────────────────────
    print("Rebuilding tracker HTML...")
    build_script = os.path.join(SCRIPT_DIR, "build_tracker.py")
    if os.path.exists(build_script):
        import subprocess
        result = subprocess.run(
            [sys.executable, build_script, "--source", OUT_JSON],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            print("  Tracker rebuilt successfully!")
            print(result.stdout.strip())
        else:
            print("  build_tracker.py error:", result.stderr[:200])
    else:
        print("  build_tracker.py not found - manually run it to rebuild the HTML.")

    print()
    print("Done! Open 'MLB Team Affinity Tracker.html' in your browser.")


if __name__ == "__main__":
    main()
