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
OTHER_PROGRAMS = {
    "1st Inning XP Path": {"color":"#1e6fb5","icon":"XP"},
    "Assorted Programs":  {"color":"#8b5cf6","icon":"AS"},
    "Multiplayer Program":{"color":"#059669","icon":"MP"},
}
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
    links = []
    seen = set()

    # Pattern 1: explicit program_view links
    for m in re.finditer(r'href=["\']([^"\']*program_view[^"\']*)["\']', html_body):
        raw = html_module.unescape(m.group(1))
        url = BASE + raw if raw.startswith("/") else raw
        if url not in seen:
            seen.add(url); links.append(url)

    # Pattern 2: /programs/NNN or /programs/NNN/anything
    for m in re.finditer(r'href=["\'](/programs/(\d+)[^"\']*)["\']', html_body):
        raw = html_module.unescape(m.group(1))
        url = BASE + raw
        if url not in seen:
            seen.add(url); links.append(url)

    # Pattern 3: JSON embedded data – look for program IDs in JSON blobs
    for m in re.finditer(r'"id"\s*:\s*(\d+).*?"type"\s*:\s*"Program"', html_body, re.DOTALL):
        pid = m.group(1)
        url = f"{BASE}/programs/{pid}"
        if url not in seen:
            seen.add(url); links.append(url)

    return links


def parse_url_params(url: str) -> dict:
    return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))


def extract_missions_from_html(html_body: str) -> list[dict]:
    missions = []

    # Strategy 1 – JSON blob embedded in script tag
    for key in ("missions", "program_missions", "tasks", "objectives"):
        for pat in (
            rf'"{key}"\s*:\s*(\[.*?\])',
            rf"gon\.{key}\s*=\s*(\[.*?\]);",
            rf"window\.{key}\s*=\s*(\[.*?\]);",
        ):
            m = re.search(pat, html_body, re.DOTALL)
            if m:
                try:
                    blob = json.loads(m.group(1))
                    if isinstance(blob, list) and blob:
                        for item in blob:
                            if not isinstance(item, dict):
                                continue
                            title   = item.get("title") or item.get("name") or item.get("description") or ""
                            current = item.get("progress", item.get("current_value", item.get("count", 0)))
                            goal    = item.get("goal", item.get("requirement", item.get("target", 0)))
                            stat    = item.get("stat_type", item.get("stat", ""))
                            reward  = item.get("reward", item.get("xp_reward", item.get("xp", "")))
                            pct     = item.get("percent_complete", item.get("pct", 0))
                            if not pct and goal:
                                try:
                                    pct = min(100.0, round(float(current) / float(goal) * 100, 1))
                                except Exception:
                                    pass
                            prog_str = f"{current}/{goal} {stat}".strip() if goal else str(current)
                            missions.append({"t": str(title).strip(), "r": str(reward), "p": prog_str, "pct": float(pct or 0)})
                        if missions:
                            return missions
                except Exception:
                    pass

    # Strategy 2 – Inertia / data-page JSON
    for m in re.finditer(r'data-page="([^"]+)"', html_body):
        try:
            props = json.loads(html_module.unescape(m.group(1)))
            def find_key(obj, key, depth=0):
                if depth > 6: return None
                if isinstance(obj, dict):
                    if key in obj: return obj[key]
                    for v in obj.values():
                        r = find_key(v, key, depth+1)
                        if r is not None: return r
                return None
            raw = find_key(props, "missions")
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        title = item.get("title", item.get("name", ""))
                        missions.append({
                            "t": str(title),
                            "r": str(item.get("reward", "")),
                            "p": str(item.get("progress", "")),
                            "pct": float(item.get("percent_complete", 0)),
                        })
                if missions: return missions
        except Exception:
            pass

    # Strategy 3 – HTML scraping: look for XP reward + progress patterns in list items
    blocks = re.findall(r'<(?:li|div|tr)[^>]*class="[^"]*mission[^"]*"[^>]*>(.*?)</(?:li|div|tr)>',
                        html_body, re.DOTALL | re.IGNORECASE)
    for blk in blocks:
        text = re.sub(r'<[^>]+>', ' ', blk)
        text = html_module.unescape(re.sub(r'\s+', ' ', text)).strip()
        xp   = re.search(r'([\d,]+)\s*XP', text, re.I)
        prog = re.search(r'(\d[\d,]*/[\d,]+[^\s]*)', text)
        if xp and text:
            missions.append({
                "t": text[:120],
                "r": xp.group(1),
                "p": prog.group(1) if prog else "",
                "pct": 0.0,
            })

    return missions


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

    # Try Inertia JSON API first
    inertia_hdrs = make_headers(cookies, inertia=True)
    inertia_body, inertia_status = get(f"{BASE}/programs", inertia_hdrs)
    if debug and inertia_status == 200 and inertia_body:
        dbg_inertia = os.path.join(SCRIPT_DIR, "debug_inertia_programs.json")
        with open(dbg_inertia, "w", encoding="utf-8") as f:
            f.write(inertia_body)
        print(f"  [debug] Saved Inertia JSON response → {dbg_inertia}")

    prog_body, prog_status = get(f"{BASE}/programs", headers)
    if prog_status != 200 or not prog_body:
        print(f"  Failed ({prog_status}). Cannot continue.")
        sys.exit(1)

    if debug:
        dbg_path = os.path.join(SCRIPT_DIR, "debug_programs_page.html")
        with open(dbg_path, "w", encoding="utf-8") as f:
            f.write(prog_body)
        print(f"  [debug] Saved programs listing page → {dbg_path}")

    # Also look for program links using broader patterns
    links = find_program_links(prog_body)

    # Try extracting program IDs from the Inertia JSON response
    if not links and inertia_status == 200 and inertia_body:
        try:
            jdata = json.loads(inertia_body)
            props = jdata.get("props", jdata)
            # Look for programs array with IDs
            def _find_programs(obj, depth=0):
                if depth > 5: return []
                if isinstance(obj, list) and obj and isinstance(obj[0], dict):
                    if any("id" in item for item in obj[:3]):
                        return obj
                if isinstance(obj, dict):
                    for k in ("programs", "data", "items"):
                        if k in obj and isinstance(obj[k], list):
                            return obj[k]
                    for v in obj.values():
                        r = _find_programs(v, depth+1)
                        if r: return r
                return []
            progs = _find_programs(props)
            for p in progs:
                if isinstance(p, dict):
                    pid = p.get("id") or p.get("program_id")
                    if pid:
                        url = f"{BASE}/programs/{pid}"
                        if url not in links:
                            links.append(url)
        except Exception:
            pass

    # Fallback: look for any /programs/ or /program_view links
    if not links:
        for m in re.finditer(r'href=["\']([^"\']*(?:/programs?/|program_view)[^"\']*)["\']', prog_body):
            raw = html_module.unescape(m.group(1))
            if raw.startswith("/"):
                url = BASE + raw
            elif "mlb26.theshow.com" in raw:
                url = raw
            else:
                continue
            if url not in links:
                links.append(url)

    print(f"  Found {len(links)} program links")
    if debug and links:
        print(f"  [debug] First 5 links:")
        for lnk in links[:5]:
            print(f"    {lnk}")
    print()

    # 4. Fetch and parse each program
    team_missions:  dict[str, dict[str, list]] = {}
    other_missions: dict[str, list]            = {}
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

        # Try Inertia JSON first for mission extraction
        missions = []
        p_inertia, p_ist = get(url, inertia_hdrs)
        if p_ist == 200 and p_inertia:
            try:
                jdata = json.loads(p_inertia)
                props = jdata.get("props", jdata)
                # Search for missions/tasks array anywhere in props
                def _find_missions(obj, depth=0):
                    if depth > 5: return []
                    if isinstance(obj, list):
                        # Check if looks like missions list
                        if obj and isinstance(obj[0], dict) and any(
                            k in obj[0] for k in ("title","name","description","objective")
                        ):
                            return obj
                    if isinstance(obj, dict):
                        for k in ("missions","tasks","objectives","program_missions","activities"):
                            if k in obj and isinstance(obj[k], list):
                                return obj[k]
                        for v in obj.values():
                            r = _find_missions(v, depth+1)
                            if r: return r
                    return []
                raw_ms = _find_missions(props)
                for item in raw_ms:
                    if not isinstance(item, dict): continue
                    title   = item.get("title") or item.get("name") or item.get("description") or item.get("objective") or ""
                    current = item.get("progress", item.get("current_value", item.get("count", 0))) or 0
                    goal    = item.get("goal", item.get("requirement", item.get("target", 0))) or 0
                    stat    = item.get("stat_type", item.get("stat", "")) or ""
                    reward  = item.get("reward", item.get("xp_reward", item.get("xp", ""))) or ""
                    pct     = item.get("percent_complete", item.get("pct", 0)) or 0
                    if not pct and goal:
                        try: pct = min(100.0, round(float(current) / float(goal) * 100, 1))
                        except: pass
                    prog_str = f"{current}/{goal} {stat}".strip() if goal else str(current)
                    missions.append({"t": str(title).strip(), "r": str(reward), "p": prog_str, "pct": float(pct or 0)})
                if debug and i == 1:
                    dbg_j = os.path.join(SCRIPT_DIR, "debug_inertia_program.json")
                    with open(dbg_j, "w", encoding="utf-8") as fj:
                        fj.write(p_inertia[:50000])
                    print(f"  [debug] Inertia JSON for program 1 → {dbg_j}, raw_missions={len(raw_ms)}")
            except Exception as ex:
                if debug and i == 1:
                    print(f"  [debug] Inertia parse error: {ex}")

        if not missions:
            missions = extract_missions_from_html(p_body)
        if debug and i == 1:
            print(f"  [debug] Missions found from first page: {len(missions)}")

        # Identify program name / team from page <h1>
        h1 = ""
        m_h1 = re.search(r'<h1[^>]*>(.*?)</h1>', p_body, re.DOTALL | re.IGNORECASE)
        if m_h1:
            h1 = re.sub(r'<[^>]+>', '', m_h1.group(1)).strip()

        team           = normalize_team(h1)
        is_color_storm = bool(re.search(r'color\s*storm', p_body[:4000], re.I))
        prog_type      = "Color Storm" if is_color_storm else "My Journey"
        is_xp_path     = bool(re.search(r'xp.*path|1st inning', p_body[:4000], re.I))
        is_multi       = bool(re.search(r'multiplayer|ranked.*season', p_body[:4000], re.I))

        label = h1[:45] or f"prog {prog_id}"
        print(f"  [{i:3}/{total}] {len(missions):3} missions  {label}")

        if team:
            team_missions.setdefault(team, {}).setdefault(prog_type, []).extend(missions)
        elif is_xp_path:
            other_missions.setdefault("1st Inning XP Path", []).extend(missions)
        elif is_multi:
            other_missions.setdefault("Multiplayer Program", []).extend(missions)
        else:
            other_missions.setdefault("Assorted Programs", []).extend(missions)

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
    for k in other_missions:
        other_missions[k] = dedup_sort(other_missions[k])

    print()
    team_total  = sum(sum(len(v) for v in t.values()) for t in team_missions.values())
    other_total = sum(len(v) for v in other_missions.values())
    print(f"Team missions:   {team_total:4d} across {len(team_missions)} teams")
    print(f"Other missions:  {other_total:4d} across {len(other_missions)} programs")

    # 6. Build other_programs structure for the HTML
    op_for_html = {}
    for name, meta in OTHER_PROGRAMS.items():
        op_for_html[name] = {
            "color":    meta["color"],
            "icon":     meta["icon"],
            "desc":     "",
            "missions": other_missions.get(name, []),
        }

    live_data = {
        "divisions":      DIVISIONS,
        "colors":         TEAM_COLORS,
        "missions":       team_missions,
        "other_missions": other_missions,
        "other_programs": op_for_html,
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
    print("All done!  Open 'MLB Team Affinity Tracker.html' in your browser.")


if __name__ == "__main__":
    main()
