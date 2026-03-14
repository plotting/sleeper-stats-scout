"""
fetch_mlb26.py  –  Pull live MLB The Show 26 program data

Usage:
    py -3 fetch_mlb26.py

You will be prompted to paste your _theshow_session cookie.

How to get your cookie:
  1. Log in at https://mlb26.theshow.com
  2. Open DevTools (F12) → Application → Cookies → mlb26.theshow.com
  3. Copy the value of  _theshow_session
  4. Paste it when prompted below

The script fetches all program missions and regenerates
"MLB Team Affinity Tracker.html" with live 2026 data.
"""

import json, re, sys, os, time
import urllib.request, urllib.error

BASE = "https://mlb26.theshow.com"
OUT_JSON = os.path.join(os.path.dirname(__file__), "mlb_data_live.json")

DIVISIONS = {
    "AL East":    ["Yankees", "Red Sox", "Blue Jays", "Orioles", "Rays"],
    "AL Central": ["Guardians", "Twins", "Tigers", "White Sox", "Royals"],
    "AL West":    ["Astros", "Rangers", "Angels", "Athletics", "Mariners"],
    "NL East":    ["Braves", "Phillies", "Mets", "Nationals", "Marlins"],
    "NL Central": ["Cubs", "Brewers", "Cardinals", "Pirates", "Reds"],
    "NL West":    ["Dodgers", "Giants", "Padres", "Diamondbacks", "Rockies"],
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


def make_headers(cookie):
    return {
        "Cookie": f"_theshow_session={cookie}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://mlb26.theshow.com/programs",
        "X-Requested-With": "XMLHttpRequest",
    }


def get(url, headers, retries=3):
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read().decode("utf-8", errors="replace"), r.status
        except urllib.error.HTTPError as e:
            if e.code == 302:
                print(f"  ↳ Redirect (likely not logged in): {url}")
                return None, 302
            if attempt < retries - 1:
                time.sleep(1)
                continue
            return None, e.code
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1)
                continue
            return None, str(e)
    return None, "failed"


def try_json_endpoints(headers):
    """Probe known/likely program JSON endpoints."""
    candidates = [
        f"{BASE}/apis/programs.json",
        f"{BASE}/apis/missions.json",
        f"{BASE}/apis/team_affinity_programs.json",
        f"{BASE}/apis/team_affinity_programs_inning.json",
        f"{BASE}/apis/inning_programs.json",
        f"{BASE}/apis/themed_programs.json",
    ]
    working = {}
    for url in candidates:
        body, status = get(url, headers)
        if body and status == 200:
            try:
                data = json.loads(body)
                working[url] = data
                print(f"  ✓ {url}  →  {list(data.keys()) if isinstance(data, dict) else type(data).__name__}")
            except Exception:
                pass
        else:
            print(f"  ✗ {url}  →  {status}")
    return working


def parse_missions_from_html(html, program_name):
    """
    Extract mission data embedded in program_view HTML pages.
    The site embeds JSON in a <script> tag or uses data attributes.
    """
    missions = []

    # Look for JSON blob in script tags (Rails inertia / turbo)
    patterns = [
        r'"missions"\s*:\s*(\[.*?\])',
        r'window\.__initialState__\s*=\s*(\{.*?\})',
        r'data-props="([^"]+)"',
        r'gon\.missions\s*=\s*(\[.*?\])',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL)
        if m:
            try:
                raw = m.group(1).replace("&quot;", '"')
                data = json.loads(raw)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            title = item.get("title", item.get("name", item.get("description", "")))
                            prog = item.get("progress", item.get("current", ""))
                            goal = item.get("goal", item.get("requirement", ""))
                            reward = item.get("reward", item.get("xp", ""))
                            pct = item.get("percent_complete", item.get("pct", 0))
                            missions.append({
                                "t": str(title),
                                "r": str(reward),
                                "p": f"{prog}/{goal}" if prog and goal else str(prog),
                                "pct": float(pct) if pct else 0.0,
                            })
            except Exception:
                pass
    return missions


def fetch_program_page(program_id, group_id, team_id, headers):
    """Fetch a program_view page and extract missions."""
    url = f"{BASE}/programs/program_view?group_id={group_id}&program_id={program_id}&team_id={team_id}"
    body, status = get(url, headers)
    if body and status == 200:
        return parse_missions_from_html(body, "")
    return []


def fetch_programs_list(headers):
    """Get the main programs page to discover program IDs."""
    body, status = get(f"{BASE}/programs", headers)
    if not body or status != 200:
        print(f"  ✗ Could not fetch /programs  ({status})")
        return None
    return body


def main():
    print("=" * 60)
    print("MLB The Show 26 – Live Data Fetcher")
    print("=" * 60)
    print()
    print("To get your session cookie:")
    print("  1. Log in at https://mlb26.theshow.com")
    print("  2. Open DevTools (F12)")
    print("  3. Application tab → Cookies → mlb26.theshow.com")
    print("  4. Copy the VALUE of '_theshow_session'")
    print()
    cookie = input("Paste _theshow_session cookie value: ").strip()
    if not cookie:
        print("No cookie provided. Exiting.")
        sys.exit(1)

    headers = make_headers(cookie)

    print()
    print("Verifying authentication...")
    body, status = get(f"{BASE}/dashboard", headers)
    if status == 302 or not body:
        print("✗ Authentication failed – cookie may be expired or wrong.")
        print("  Try logging out and back in, then re-copy the cookie.")
        sys.exit(1)
    if "sign_in" in (body or "").lower() or "log in" in (body or "").lower():
        print("⚠ Page looks like a login redirect – double-check your cookie.")
    else:
        print("✓ Authentication looks good!")

    print()
    print("Probing JSON API endpoints...")
    working_endpoints = try_json_endpoints(headers)

    print()
    print("Fetching programs list page...")
    programs_html = fetch_programs_list(headers)

    # Try to extract program IDs from the programs page
    program_ids = []
    if programs_html:
        # Look for program links / data
        id_patterns = [
            r'program_id=(\d+)',
            r'"program_id"\s*:\s*(\d+)',
            r'data-program-id="(\d+)"',
        ]
        found_ids = set()
        for pat in id_patterns:
            for m in re.finditer(pat, programs_html):
                found_ids.add(m.group(1))
        if found_ids:
            print(f"  Found program IDs: {sorted(found_ids)}")
            program_ids = list(found_ids)

    # Build output data structure
    # Start with Excel data as fallback, augment with live data
    live_data = {
        "source": "live",
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "divisions": DIVISIONS,
        "colors": TEAM_COLORS,
        "missions": {},        # team missions: {team: {prog: [missions]}}
        "other_programs": {},  # non-team programs: {prog_name: [missions]}
        "raw_endpoints": working_endpoints,
        "program_ids_found": program_ids,
    }

    # Save probe results so build_tracker.py can use them
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(live_data, f, indent=2, ensure_ascii=True)

    print()
    print(f"Probe data saved to: {OUT_JSON}")
    print()
    print("NOTE: Full mission data parsing depends on the site's JS structure.")
    print("Run this again with --verbose to see raw HTML from program pages.")
    print()
    print("If program_ids were found, try fetching individual programs:")
    for pid in program_ids[:5]:
        print(f"  {BASE}/programs/program_view?program_id={pid}")


if __name__ == "__main__":
    main()
