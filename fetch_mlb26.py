"""
fetch_mlb26.py  -  MLB The Show 26 live data fetcher

Just run:  py -3 fetch_mlb26.py

The script automatically reads your Chrome session from the browser
(you must already be logged in at mlb26.theshow.com in Chrome).
Fetches all program missions and rebuilds the HTML tracker.
"""

import json, sys, os, re, time, shutil, sqlite3, tempfile, html as html_module
import urllib.request, urllib.error, urllib.parse, ctypes, ctypes.wintypes, base64, subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE       = "https://mlb26.theshow.com"
OUT_JSON   = os.path.join(SCRIPT_DIR, "mlb_data_live.json")

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
PROG_GROUP_COLORS = {
    "xp_path":    "#1e6fb5",
    "assorted":   "#8b5cf6",
    "multiplayer":"#059669",
}

def make_prog_icon(name: str) -> str:
    stop = {"the","a","an","of","and","in","with","program","programs","classic","series"}
    words = [w for w in name.split() if w.lower() not in stop]
    return "".join(w[0] for w in words[:2]).upper()[:2] if words else "PR"
TEAM_NAME_MAP = {
    "arizona":"Diamondbacks","diamondbacks":"Diamondbacks",
    "atlanta":"Braves","braves":"Braves",
    "baltimore":"Orioles","orioles":"Orioles",
    "boston":"Red Sox","red sox":"Red Sox",
    "chicago cubs":"Cubs","cubs":"Cubs",
    "chicago white sox":"White Sox","white sox":"White Sox",
    "cincinnati":"Reds","reds":"Reds",
    "cleveland":"Guardians","guardians":"Guardians",
    "colorado":"Rockies","rockies":"Rockies",
    "detroit":"Tigers","tigers":"Tigers",
    "houston":"Astros","astros":"Astros",
    "kansas city":"Royals","royals":"Royals",
    "los angeles angels":"Angels","angels":"Angels",
    "los angeles dodgers":"Dodgers","dodgers":"Dodgers",
    "miami":"Marlins","marlins":"Marlins",
    "milwaukee":"Brewers","brewers":"Brewers",
    "minnesota":"Twins","twins":"Twins",
    "new york mets":"Mets","mets":"Mets",
    "new york yankees":"Yankees","yankees":"Yankees",
    "oakland":"Athletics","athletics":"Athletics",
    "philadelphia":"Phillies","phillies":"Phillies",
    "pittsburgh":"Pirates","pirates":"Pirates",
    "san diego":"Padres","padres":"Padres",
    "san francisco":"Giants","giants":"Giants",
    "seattle":"Mariners","mariners":"Mariners",
    "st. louis":"Cardinals","cardinals":"Cardinals",
    "tampa bay":"Rays","rays":"Rays",
    "texas":"Rangers","rangers":"Rangers",
    "toronto":"Blue Jays","blue jays":"Blue Jays",
    "washington":"Nationals","nationals":"Nationals",
}


# ── Chrome cookie reading ─────────────────────────────────────────────────────

class _DATABLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char))]

def _dpapi_decrypt(ciphertext: bytes) -> bytes:
    buf = ctypes.create_string_buffer(ciphertext)
    blob_in  = _DATABLOB(len(ciphertext), buf)
    blob_out = _DATABLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out))
    if not ok:
        raise RuntimeError("DPAPI decryption failed")
    result = ctypes.string_at(blob_out.pbData, blob_out.cbData)
    ctypes.windll.kernel32.LocalFree(blob_out.pbData)
    return result

def _get_chrome_aes_key(local_state_path: str) -> bytes | None:
    try:
        with open(local_state_path, encoding="utf-8") as f:
            ls = json.load(f)
        enc_key_b64 = ls["os_crypt"]["encrypted_key"]
        enc_key = base64.b64decode(enc_key_b64)
        # First 5 bytes are "DPAPI" prefix
        return _dpapi_decrypt(enc_key[5:])
    except Exception:
        return None

def _decrypt_cookie_value(value: bytes, aes_key: bytes) -> str:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        # Chrome cookie format: b"v10" + 12-byte nonce + ciphertext
        if value[:3] == b"v10":
            nonce      = value[3:15]
            ciphertext = value[15:]
            aesgcm     = AESGCM(aes_key)
            return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8", errors="replace")
    except ImportError:
        pass
    except Exception:
        pass
    return ""

def _copy_locked_file(src: str, dst: str) -> bool:
    """Copy a file that may be locked by another process using Windows share flags."""
    GENERIC_READ          = 0x80000000
    FILE_SHARE_READ       = 0x00000001
    FILE_SHARE_WRITE      = 0x00000002
    FILE_SHARE_DELETE     = 0x00000004
    OPEN_EXISTING         = 3
    FILE_ATTRIBUTE_NORMAL = 0x80

    kernel32 = ctypes.windll.kernel32
    # Set return type for CreateFileW to handle HANDLE correctly
    kernel32.CreateFileW.restype = ctypes.c_void_p
    handle = kernel32.CreateFileW(
        src,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        None,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        None
    )
    if handle is None or handle == ctypes.c_void_p(-1).value:
        return False
    try:
        # Use GetFileSizeEx for accurate 64-bit size
        size_high = ctypes.wintypes.DWORD(0)
        kernel32.GetFileSize.restype = ctypes.wintypes.DWORD
        size_low = kernel32.GetFileSize(ctypes.c_void_p(handle), ctypes.byref(size_high))
        if size_low == 0xFFFFFFFF and ctypes.GetLastError() != 0:
            return False
        size = (size_high.value << 32) | size_low
        if size == 0 or size > 200 * 1024 * 1024:  # sanity check: max 200MB
            return False
        buf  = (ctypes.c_char * size)()
        read = ctypes.wintypes.DWORD(0)
        kernel32.ReadFile.restype = ctypes.wintypes.BOOL
        ok = kernel32.ReadFile(ctypes.c_void_p(handle), buf, size, ctypes.byref(read), None)
        if not ok:
            return False
        with open(dst, "wb") as f:
            f.write(bytes(buf)[:read.value])
        return True
    finally:
        kernel32.CloseHandle(ctypes.c_void_p(handle))


def read_chrome_cookies(domain: str) -> dict[str, str]:
    """
    Read cookies for `domain` from Chrome's SQLite database.
    Returns {name: value} dict. Handles both AES-GCM (v10) and legacy DPAPI.
    Works even when Chrome is running (uses Windows shared file access).
    """
    import glob
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    profiles = [
        os.path.join(local_appdata, "Google", "Chrome", "User Data"),
        os.path.join(local_appdata, "Microsoft", "Edge",  "User Data"),
        os.path.join(local_appdata, "BraveSoftware", "Brave-Browser", "User Data"),
    ]

    results: dict[str, str] = {}

    for user_data in profiles:
        if not os.path.exists(user_data):
            continue
        local_state_path = os.path.join(user_data, "Local State")
        aes_key = _get_chrome_aes_key(local_state_path) if os.path.exists(local_state_path) else None

        # Find all cookie files across Default and Profile* directories
        cookie_paths = (
            glob.glob(os.path.join(user_data, "Default", "Cookies")) +
            glob.glob(os.path.join(user_data, "Default", "Network", "Cookies")) +
            glob.glob(os.path.join(user_data, "Profile*", "Cookies")) +
            glob.glob(os.path.join(user_data, "Profile*", "Network", "Cookies"))
        )

        for cookie_db in cookie_paths:
            rows = []

            # Strategy 1: Open directly with immutable=1 (bypasses SQLite locking)
            try:
                uri = "file:{}?mode=ro&immutable=1".format(
                    cookie_db.replace("\\", "/").replace(" ", "%20")
                )
                con = sqlite3.connect(uri, uri=True, check_same_thread=False)
                con.row_factory = sqlite3.Row
                rows = con.execute(
                    "SELECT name, value, encrypted_value FROM cookies "
                    "WHERE host_key LIKE ? OR host_key LIKE ?",
                    (f"%{domain}%", f"%.{domain}%")
                ).fetchall()
                con.close()
            except Exception:
                rows = []

            # Strategy 2: Windows share-aware file copy + normal SQLite open
            if not rows:
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
                tmp.close()
                try:
                    copied = _copy_locked_file(cookie_db, tmp.name)
                    if not copied:
                        shutil.copy2(cookie_db, tmp.name)
                    con = sqlite3.connect(tmp.name)
                    con.row_factory = sqlite3.Row
                    rows = con.execute(
                        "SELECT name, value, encrypted_value FROM cookies "
                        "WHERE host_key LIKE ? OR host_key LIKE ?",
                        (f"%{domain}%", f"%.{domain}%")
                    ).fetchall()
                    con.close()
                except Exception:
                    rows = []
                finally:
                    try:
                        os.unlink(tmp.name)
                    except Exception:
                        pass

            for row in rows:
                name  = row["name"]
                val   = row["value"] or ""
                enc   = row["encrypted_value"] or b""
                if not val and enc:
                    if aes_key and enc[:3] == b"v10":
                        val = _decrypt_cookie_value(enc, aes_key)
                    else:
                        try:
                            val = _dpapi_decrypt(enc).decode("utf-8", errors="replace")
                        except Exception:
                            val = ""
                if val:
                    results[name] = val
    return results

def _is_browser_running() -> bool:
    """Check if Chrome or Edge is running."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/NH"],
            capture_output=True, text=True, timeout=5
        ).stdout
        if "chrome.exe" in out.lower():
            return True
        out2 = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq msedge.exe", "/NH"],
            capture_output=True, text=True, timeout=5
        ).stdout
        return "msedge.exe" in out2.lower()
    except Exception:
        return False


def _manual_paste_flow(cookies: dict) -> dict:
    """Ask user to paste their _tsn_session cookie value."""
    print()
    print("  ─────────────────────────────────────────────────────────")
    print("  Manual cookie entry:")
    print("  1. Open Chrome/Edge and go to https://mlb26.theshow.com")
    print("  2. Log in if needed")
    print("  3. Press F12 → Application tab → Cookies → mlb26.theshow.com")
    print("  4. Click the '_tsn_session' row and copy its VALUE")
    print("  ─────────────────────────────────────────────────────────")
    val = input("  Paste _tsn_session value here: ").strip()
    if val:
        cookies["_tsn_session"] = val
        # Check for tsn_token too
        tok = input("  Paste tsn_token value (optional, press Enter to skip): ").strip()
        if tok:
            cookies["tsn_token"] = tok
    else:
        sys.exit("No credentials provided. Exiting.")
    return cookies


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_auth() -> dict[str, str]:
    """
    Returns cookie dict with _tsn_session (and tsn_token if found).
    Priority:
      1. --cookie flag on command line
      2. Auto-read from Chrome/Edge cookie DB
      3. Ask user to close browser + retry
      4. Manual paste
    """
    # Check for --cookie "name=value; name2=value2" on command line
    if "--cookie" in sys.argv:
        idx = sys.argv.index("--cookie")
        if idx + 1 < len(sys.argv):
            raw = sys.argv[idx + 1]
            cookies: dict[str, str] = {}
            for part in raw.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    cookies[k.strip()] = v.strip()
            if cookies.get("_tsn_session") or cookies.get("tsn_token"):
                print(f"  Using cookies from --cookie flag.")
                return cookies

    print("Checking Chrome/Edge for mlb26.theshow.com cookies...")
    cookies = read_chrome_cookies("mlb26.theshow.com")
    session = cookies.get("_tsn_session", "")
    token   = cookies.get("tsn_token", "")

    if session or token:
        print(f"  Found: {', '.join(k for k in cookies if k in ('_tsn_session','tsn_token'))}")
        return cookies

    # Cookie read failed — could be browser running with exclusive lock
    if _is_browser_running():
        print()
        print("  Chrome/Edge is running and has locked the cookie database.")
        print()
        print("  Choose an option:")
        print("  [1] Close Chrome/Edge now, then press Enter to retry (recommended)")
        print("  [2] Paste the cookie value manually")
        choice = input("  Your choice [1/2]: ").strip()
        if choice != "2":
            input("  Close Chrome/Edge, then press Enter here... ")
            cookies = read_chrome_cookies("mlb26.theshow.com")
            session = cookies.get("_tsn_session", "")
            token   = cookies.get("tsn_token", "")
            if session or token:
                print(f"  Found cookies!")
                return cookies
            print("  Still not found. Falling back to manual entry.")
    else:
        print("  Not found in Chrome/Edge.")

    # Open browser and manual paste
    print()
    print("  Opening https://mlb26.theshow.com ...")
    import webbrowser
    webbrowser.open(BASE)
    return _manual_paste_flow({})


def _show_usage():
    print("Usage: py -3 fetch_mlb26.py [options]")
    print()
    print("Options:")
    print("  --cookie 'name=value; name2=value2'  Use specific cookies (skip auto-read)")
    print("  --debug                              Save raw HTML for parser diagnostics")
    print()
    print("The script auto-reads Chrome/Edge cookies. If Chrome is running and locking")
    print("the cookie DB, you'll be prompted to close it briefly or paste manually.")


def make_headers(cookies: dict, inertia: bool = False) -> dict:
    parts = []
    for k in ("_tsn_session", "tsn_token"):
        if k in cookies:
            parts.append(f"{k}={cookies[k]}")
    cookie_str = "; ".join(parts)
    hdrs = {
        "Cookie":           cookie_str,
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":           "text/html,application/xhtml+xml,application/json,*/*;q=0.9",
        "Accept-Language":  "en-US,en;q=0.9",
        "Referer":          BASE + "/programs",
    }
    if "tsn_token" in cookies:
        hdrs["Authorization"] = f"Bearer {cookies['tsn_token']}"
    if inertia:
        hdrs["X-Inertia"] = "true"
        hdrs["X-Requested-With"] = "XMLHttpRequest"
        hdrs["Accept"] = "application/json"
    return hdrs


def try_inertia_programs(cookies: dict) -> list[dict] | None:
    """Try to fetch programs listing via Inertia JSON API."""
    hdrs = make_headers(cookies, inertia=True)
    body, status = get(f"{BASE}/programs", hdrs)
    if status != 200 or not body:
        return None
    try:
        data = json.loads(body)
        # Inertia wraps in {component, props, ...}
        props = data.get("props", data)
        programs = props.get("programs") or props.get("data") or []
        if isinstance(programs, list) and programs:
            return programs
    except Exception:
        pass
    return None


# ── HTTP ──────────────────────────────────────────────────────────────────────

def get(url, headers, timeout=20):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace"), r.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


# ── Program discovery & parsing ───────────────────────────────────────────────

def find_program_links(html_body: str) -> list[str]:
    """Find all program page links from the programs listing page."""
    links = []
    seen = set()

    # Match all mlb26-program-tile-text hrefs (the tile links on /programs)
    for m in re.finditer(r'href=["\']([^"\']*(?:program_view|team_affinity|other_programs)[^"\']*)["\']', html_body):
        raw = html_module.unescape(m.group(1))
        url = BASE + raw if raw.startswith("/") else raw
        if url not in seen:
            seen.add(url); links.append(url)

    # Fallback: any /programs/... link
    if not links:
        for m in re.finditer(r'href=["\']([^"\']*(?:/programs/[^"\']+))["\']', html_body):
            raw = html_module.unescape(m.group(1))
            if raw.startswith("/"):
                url = BASE + raw
            elif "mlb26.theshow.com" in raw:
                url = raw
            else:
                continue
            if url not in seen:
                seen.add(url); links.append(url)

    return links


def expand_program_links(links: list[str], headers: dict) -> list[str]:
    """
    Expand top-level program tiles into individual program_view URLs.

    Hierarchy:
      team_affinity (AL/NL)
        → team_affinity_by_team (one per team)
          → program_view (My Journey, Color Storm)
      other_programs
        → program_view
      program_view  (already direct)
    """
    expanded = []
    seen = set()

    def _add(url):
        if url not in seen:
            seen.add(url); expanded.append(url)

    def _scrape_program_views(body):
        views = []
        for m in re.finditer(r'href=["\']([^"\']*program_view[^"\']*)["\']', body):
            raw = html_module.unescape(m.group(1))
            views.append(BASE + raw if raw.startswith("/") else raw)
        return views

    for url in links:
        path = urllib.parse.urlparse(url).path

        if "team_affinity_by_team" in path:
            # Already a single team page — get program_view links
            body, status = get(url, headers)
            if status == 200 and body:
                for pv in _scrape_program_views(body):
                    _add(pv)
            time.sleep(0.3)

        elif "team_affinity" in path and "team_affinity_by_team" not in path:
            # League listing (AL or NL) — find both AL + NL pages then all team links
            league_pages = [url]
            body, status = get(url, headers)
            if status == 200 and body:
                # Find the other league link on this page
                for m in re.finditer(r'href=["\']([^"\']*team_affinity\?[^"\']*league=[^"\']*)["\']', body):
                    raw = html_module.unescape(m.group(1))
                    other = BASE + raw if raw.startswith("/") else raw
                    if other not in league_pages:
                        league_pages.append(other)
            # Fetch each league page and collect team links
            team_links_all = []
            for league_url in league_pages:
                lbody, lstatus = get(league_url, headers)
                if lstatus == 200 and lbody:
                    for m in re.finditer(r'href=["\']([^"\']*team_affinity_by_team[^"\']*)["\']', lbody):
                        raw = html_module.unescape(m.group(1))
                        turl = BASE + raw if raw.startswith("/") else raw
                        if turl not in team_links_all:
                            team_links_all.append(turl)
                time.sleep(0.3)
            for turl in team_links_all:
                tbody, tstatus = get(turl, headers)
                if tstatus == 200 and tbody:
                    for pv in _scrape_program_views(tbody):
                        _add(pv)
                time.sleep(0.3)

        elif "other_programs" in path:
            # Other programs listing
            body, status = get(url, headers)
            if status == 200 and body:
                for pv in _scrape_program_views(body):
                    _add(pv)
            time.sleep(0.3)

        else:
            # Direct program_view or other direct link
            _add(url)

    return expanded


def parse_url_params(url: str) -> dict:
    return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))


def extract_missions_from_html(html_body: str) -> list[dict]:
    """
    Parse missions from mlb26.theshow.com program pages.

    Page structure (mlb26-program-accordion-sub):
      <div class='accordion title-accordion mlb26-program-accordion-sub'>
        <div class='accordion-block'>
          <div class='accordion-toggle'>
            <span class='accordion-toggle-label mlb26-program-accordion-label'>TITLE</span>
          </div>
          <div class='accordion-content'>
            <p>DESCRIPTION</p>
            <p>N/GOAL STAT<meter max='GOAL' value='CURRENT'></meter></p>
            <p>Reward<div class='reward'><img/>AMOUNT</div></p>
          </div>
        </div>
      </div>
    """
    missions = []

    # Primary strategy: parse mlb26-program-accordion-sub blocks
    blocks = re.findall(
        r'mlb26-program-accordion-sub["\'][^>]*>.*?</div>\s*</div>\s*</div>\s*</div>',
        html_body, re.DOTALL | re.IGNORECASE
    )
    for blk in blocks:
        # Title from accordion-toggle-label
        m_title = re.search(
            r'class=["\'][^"\']*accordion-toggle-label[^"\']*["\'][^>]*>\s*(.*?)\s*</span>',
            blk, re.DOTALL | re.IGNORECASE
        )
        title = html_module.unescape(re.sub(r'<[^>]+>', '', m_title.group(1))).strip() if m_title else ""
        if not title:
            continue

        # Description: <p> text in accordion-content before the meter paragraph
        desc_parts = []
        for para_m in re.finditer(r'<p[^>]*>(.*?)</p>', blk, re.DOTALL | re.IGNORECASE):
            inner = para_m.group(1)
            if '<meter' in inner:
                break
            text = html_module.unescape(re.sub(r'<[^>]+>', ' ', inner)).strip()
            text = re.sub(r'\s+', ' ', text).strip()
            if text and text.lower() not in (title.lower(), 'reward'):
                desc_parts.append(text)
        desc = ' '.join(desc_parts)

        # Progress from <meter max='N' value='M'>
        m_meter = re.search(r'<meter[^>]+max=["\'](\d+)["\'][^>]+value=["\'](\d+)["\']', blk, re.IGNORECASE)
        if not m_meter:
            m_meter = re.search(r'<meter[^>]+value=["\'](\d+)["\'][^>]+max=["\'](\d+)["\']', blk, re.IGNORECASE)
            if m_meter:
                cur_val, max_val = m_meter.group(1), m_meter.group(2)
            else:
                cur_val, max_val = "0", "0"
        else:
            max_val, cur_val = m_meter.group(1), m_meter.group(2)

        # Progress text (e.g. "1/10 HITS")
        m_prog = re.search(r'(\d[\d,]*/\d[\d,]*\s*\w*)', blk)
        prog_str = m_prog.group(1).strip() if m_prog else f"{cur_val}/{max_val}"

        # Percent complete
        try:
            pct = min(100.0, round(int(cur_val) / int(max_val) * 100, 1)) if int(max_val) > 0 else 0.0
        except Exception:
            pct = 0.0

        # Reward: number inside div.reward (after img)
        m_reward = re.search(r"class=['\"]reward['\"][^>]*>(.*?)</div>", blk, re.DOTALL | re.IGNORECASE)
        reward = ""
        if m_reward:
            r_text = html_module.unescape(re.sub(r'<[^>]+>', ' ', m_reward.group(1))).strip()
            # Extract number (could be "2,500" or "2500 XP")
            m_rnum = re.search(r'([\d,]+)', r_text)
            if m_rnum:
                reward = m_rnum.group(1).replace(",", "") + " XP"

        missions.append({"t": title, "r": reward, "p": prog_str, "pct": pct, "d": desc})

    if missions:
        return missions

    # Fallback: any accordion-block with meter tags (broader match)
    for blk in re.findall(r'<div class=["\']accordion-block["\']>(.*?)</div>\s*</div>\s*</div>', html_body, re.DOTALL):
        m_title = re.search(r'accordion-toggle-label[^>]*>\s*(.*?)\s*</span>', blk, re.DOTALL)
        m_meter = re.search(r'<meter[^>]+max=["\'](\d+)["\'][^>]+value=["\'](\d+)["\']', blk)
        if not m_title or not m_meter:
            continue
        title = html_module.unescape(re.sub(r'<[^>]+>', '', m_title.group(1))).strip()
        max_v, cur_v = m_meter.group(1), m_meter.group(2)
        try:
            pct = min(100.0, round(int(cur_v) / int(max_v) * 100, 1)) if int(max_v) > 0 else 0.0
        except Exception:
            pct = 0.0
        m_rnum = re.search(r"class=['\"]reward['\"].*?([\d,]+)", blk, re.DOTALL)
        reward = (m_rnum.group(1).replace(",", "") + " XP") if m_rnum else ""
        if title:
            missions.append({"t": title, "r": reward, "p": f"{cur_v}/{max_v}", "pct": pct, "d": ""})

    return missions


def fetch_inventory(cookies: dict) -> list[str]:
    """
    Fetch the user's MLB player card names from their inventory.
    Tries the Inertia JSON API, then HTML scraping.
    Returns a sorted list of unique player name strings.
    """
    player_names: set[str] = set()

    # Strategy 1: Inertia JSON API
    hdrs = make_headers(cookies, inertia=True)
    body, status = get(f"{BASE}/inventory", hdrs)
    if status == 200 and body:
        try:
            data  = json.loads(body)
            props = data.get("props", data)
            # Different possible keys the API might use
            items = (props.get("items") or props.get("inventory") or
                     props.get("cards") or props.get("collection_items") or [])
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    itype = str(item.get("type") or item.get("item_type") or "").lower()
                    # Skip non-player items (equipment, stadiums, etc.)
                    if itype and "mlb_card" not in itype and "player" not in itype:
                        continue
                    name = (item.get("name") or item.get("player_name") or
                            item.get("display_name") or "")
                    if isinstance(name, str) and 2 < len(name.strip()) < 60:
                        player_names.add(name.strip())
        except Exception:
            pass

    # Strategy 2: HTML scraping of /inventory
    if not player_names:
        hdrs_html = make_headers(cookies)
        body, status = get(f"{BASE}/inventory", hdrs_html)
        if status == 200 and body:
            # Look for JSON data embedded in the page (Inertia page data)
            m_data = re.search(r'data-page=["\']({.*?})["\']', body, re.DOTALL)
            if m_data:
                try:
                    page_data = json.loads(html_module.unescape(m_data.group(1)))
                    props = page_data.get("props", {})
                    items = (props.get("items") or props.get("inventory") or [])
                    for item in (items if isinstance(items, list) else []):
                        name = item.get("name") or item.get("player_name") or ""
                        if isinstance(name, str) and 2 < len(name.strip()) < 60:
                            player_names.add(name.strip())
                except Exception:
                    pass

    # Strategy 3: Try the squad/roster endpoint for active team players
    if not player_names:
        body, status = get(f"{BASE}/squads", make_headers(cookies, inertia=True))
        if status == 200 and body:
            try:
                data  = json.loads(body)
                props = data.get("props", data)
                for key in ("squad", "players", "roster", "lineup"):
                    items = props.get(key) or []
                    if isinstance(items, list) and items:
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            name = item.get("name") or item.get("player_name") or ""
                            if isinstance(name, str) and 2 < len(name.strip()) < 60:
                                player_names.add(name.strip())
                        break
            except Exception:
                pass

    return sorted(player_names)


def normalize_team(text: str) -> str | None:
    t = text.strip().lower()
    if t in TEAM_NAME_MAP: return TEAM_NAME_MAP[t]
    for k, v in TEAM_NAME_MAP.items():
        if k in t: return v
    return None


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        _show_usage()
        return

    debug = "--debug" in sys.argv

    print("=" * 62)
    print("  MLB The Show 26 - Data Fetcher")
    print("=" * 62)
    print()

    # 1. Get auth cookies (auto from Chrome or prompt)
    cookies = get_auth()
    headers = make_headers(cookies)

    # 2. Verify auth
    print()
    print("Verifying authentication...")
    body, status = get(f"{BASE}/dashboard", headers)
    if status != 200 or not body:
        print(f"  HTTP {status}. Try logging out and back in, then run again.")
        sys.exit(1)
    if "sign_in" in body.lower() or 'href="/sessions/new"' in body.lower():
        print("  Session expired. Log in again at mlb26.theshow.com and re-run.")
        sys.exit(1)
    print("  Authenticated!")

    # 3. Fetch programs listing
    print()
    print("Fetching programs page...")

    prog_body, prog_status = get(f"{BASE}/programs", headers)
    if prog_status != 200 or not prog_body:
        print(f"  Failed ({prog_status}). Cannot continue.")
        sys.exit(1)

    if debug:
        dbg_path = os.path.join(SCRIPT_DIR, "debug_programs_page.html")
        with open(dbg_path, "w", encoding="utf-8") as f:
            f.write(prog_body)
        print(f"  [debug] Saved programs listing page → {dbg_path}")

    # Find top-level program links (includes team_affinity + other_programs tiles)
    links = find_program_links(prog_body)

    # Expand team_affinity and other_programs pages into individual program_view links
    print(f"  Found {len(links)} top-level program tiles — expanding...")
    links = expand_program_links(links, headers)

    print(f"  Found {len(links)} program links")
    if debug and links:
        print(f"  [debug] First 5 links:")
        for lnk in links[:5]:
            print(f"    {lnk}")
    print()

    # 4. Fetch and parse each program
    team_missions:  dict[str, dict[str, list]] = {}
    other_prog_raw: dict[str, dict]            = {}   # name → {group, missions}
    total = len(links)

    for i, url in enumerate(links, 1):
        params   = parse_url_params(url)
        prog_id  = params.get("program_id", "?")
        time.sleep(0.35)

        p_body, p_status = get(url, headers)
        if p_status != 200 or not p_body:
            print(f"  [{i:3}/{total}] SKIP ({p_status}) {url[-50:]}")
            continue

        if debug and i == 1:
            dbg2 = os.path.join(SCRIPT_DIR, "debug_program_page.html")
            with open(dbg2, "w", encoding="utf-8") as f:
                f.write(p_body)
            print(f"  [debug] Saved first program page → {dbg2}")
            print(f"  [debug] Page length: {len(p_body)} bytes")
            # Print first 3000 chars of response (no scripts) for quick inspection
            stripped = re.sub(r'<script[^>]*>.*?</script>', '[SCRIPT]', p_body[:5000], flags=re.DOTALL)
            print("  [debug] Page preview (first 3000 chars stripped):")
            print(stripped[:3000])
            print()

        missions = extract_missions_from_html(p_body)
        if debug and i == 1:
            print(f"  [debug] Missions found from first page: {len(missions)}")

        # Identify program name / team from page <h1>
        h1 = ""
        m_h1 = re.search(r'<h1[^>]*>(.*?)</h1>', p_body, re.DOTALL | re.IGNORECASE)
        if m_h1:
            h1 = re.sub(r'<[^>]+>', '', m_h1.group(1)).strip()

        team           = normalize_team(h1)
        h1_lower       = h1.lower()
        is_color_storm = bool(re.search(r'color\s*storm|#1 fan', h1_lower, re.I))
        prog_type      = "Color Storm" if is_color_storm else "My Journey"
        is_xp_path     = bool(re.search(r'xp.*(path|reward)|1st inning', h1_lower, re.I))
        is_multi       = bool(re.search(r'multiplayer|ranked.*season', h1_lower, re.I))

        label = h1[:45] or f"prog {prog_id}"
        print(f"  [{i:3}/{total}] {len(missions):3} missions  {label}")

        if team:
            team_missions.setdefault(team, {}).setdefault(prog_type, []).extend(missions)
        else:
            if is_xp_path:
                group, prog_key = "xp_path",    h1 or "1st Inning XP Path"
            elif is_multi:
                group, prog_key = "multiplayer", h1 or "Multiplayer Program"
            else:
                group, prog_key = "assorted",    h1 or "Assorted Programs"
            if prog_key not in other_prog_raw:
                other_prog_raw[prog_key] = {"group": group, "missions": []}
            other_prog_raw[prog_key]["missions"].extend(missions)

    # 5. Deduplicate and sort
    def dedup_sort(lst):
        seen, out = set(), []
        for m in sorted(lst, key=lambda x: -x["pct"]):
            if m["t"] and m["t"] not in seen:
                seen.add(m["t"]); out.append(m)
        return out

    for team in team_missions:
        for pt in team_missions[team]:
            team_missions[team][pt] = dedup_sort(team_missions[team][pt])
    for k in other_prog_raw:
        other_prog_raw[k]["missions"] = dedup_sort(other_prog_raw[k]["missions"])

    print()
    team_total  = sum(sum(len(v) for v in t.values()) for t in team_missions.values())
    other_total = sum(len(v["missions"]) for v in other_prog_raw.values())
    print(f"Team missions:   {team_total:4d} across {len(team_missions)} teams")
    print(f"Other missions:  {other_total:4d} across {len(other_prog_raw)} programs")

    # 6. Build other_programs structure (one entry per individual program)
    op_for_html = {}
    for prog_name, pdata in other_prog_raw.items():
        group = pdata["group"]
        op_for_html[prog_name] = {
            "color":    PROG_GROUP_COLORS.get(group, "#8b5cf6"),
            "icon":     make_prog_icon(prog_name),
            "group":    group,
            "missions": pdata["missions"],
        }

    # 7. Fetch player inventory
    print("\nFetching player inventory...")
    inventory = fetch_inventory(cookies)
    print(f"  Found {len(inventory)} player cards")

    live_data = {
        "divisions":      DIVISIONS,
        "colors":         TEAM_COLORS,
        "missions":       team_missions,
        "other_programs": op_for_html,
        "inventory":      inventory,
        "data_source":    "live",
        "data_date":      time.strftime("%Y-%m-%d %H:%M"),
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(live_data, f, indent=2, ensure_ascii=True)
    print(f"\nSaved: {OUT_JSON}")

    # 7. Rebuild HTML
    print("Rebuilding tracker HTML...")
    build_script = os.path.join(SCRIPT_DIR, "build_tracker.py")
    if os.path.exists(build_script):
        result = subprocess.run(
            [sys.executable, build_script, "--source", OUT_JSON],
            capture_output=True, text=True, cwd=SCRIPT_DIR
        )
        if result.returncode == 0:
            print("  Done!", result.stdout.strip())
        else:
            print("  build_tracker error:", result.stderr[:300])
    else:
        print("  build_tracker.py not found – run it manually.")

    print()
    html_out = os.path.join(SCRIPT_DIR, "MLB Team Affinity Tracker.html")
    print(f"\nAll done!  Opening tracker...")
    import webbrowser
    webbrowser.open("file:///" + html_out.replace("\\", "/"))


if __name__ == "__main__":
    main()
