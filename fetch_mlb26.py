"""
fetch_mlb26.py  -  MLB The Show 26 live data fetcher

Just run:  py -3 fetch_mlb26.py

The script automatically reads your Chrome session from the browser
(you must already be logged in at mlb26.theshow.com in Chrome).
Fetches all program missions and rebuilds the HTML tracker.
"""

from __future__ import annotations
import json, sys, os, re, time, shutil, sqlite3, tempfile, html as html_module, datetime
import urllib.request, urllib.error, urllib.parse, ctypes, ctypes.wintypes, base64, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
BASE          = "https://mlb26.theshow.com"
COOKIE_CACHE  = os.path.join(SCRIPT_DIR, ".mlb26_cookies.json")
CACHE_TTL_HRS = 12
NON_INTERACTIVE = not sys.stdin.isatty() or "--no-browser" in sys.argv
OUT_JSON          = os.path.join(SCRIPT_DIR, "mlb_data_live.json")
MAX_FETCH_WORKERS = 5   # max concurrent HTTP requests (team pages + program pages)

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
    print("  3. Press F12 -> Application tab -> Cookies -> mlb26.theshow.com")
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


# ── Cookie cache ──────────────────────────────────────────────────────────────

def _load_cookie_cache() -> dict | None:
    if not os.path.exists(COOKIE_CACHE):
        return None
    try:
        with open(COOKIE_CACHE, encoding="utf-8") as f:
            data = json.load(f)
        saved = data.get("saved_at", "")
        if saved:
            age = (datetime.datetime.now() - datetime.datetime.fromisoformat(saved)).total_seconds()
            if age < CACHE_TTL_HRS * 3600:
                cookies = {k: data[k] for k in ("_tsn_session", "tsn_token") if data.get(k)}
                if cookies:
                    return cookies
    except Exception:
        pass
    return None

def _load_cookie_cache_any() -> dict | None:
    """Load cached cookies regardless of age (stale fallback for non-interactive mode)."""
    if not os.path.exists(COOKIE_CACHE):
        return None
    try:
        with open(COOKIE_CACHE, encoding="utf-8") as f:
            data = json.load(f)
        cookies = {k: data[k] for k in ("_tsn_session", "tsn_token") if data.get(k)}
        return cookies or None
    except Exception:
        return None

def _save_cookie_cache(cookies: dict) -> None:
    try:
        data = {k: cookies[k] for k in ("_tsn_session", "tsn_token") if cookies.get(k)}
        data["saved_at"] = datetime.datetime.now().isoformat()
        with open(COOKIE_CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_auth() -> dict[str, str]:
    """
    Returns cookie dict with _tsn_session (and tsn_token if found).
    Priority:
      1. --cookie flag on command line
      2. Valid cookie cache (< 12 hours old)
      3. Auto-read from Chrome/Edge cookie DB
      4. Ask user to close browser + retry  (interactive only)
      5. Stale cache fallback              (non-interactive only)
      6. Manual paste                      (interactive only)
    """
    # 1. --cookie flag
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
                print("  Using cookies from --cookie flag.")
                return cookies

    # 2. Fresh cookie cache
    cached = _load_cookie_cache()
    if cached:
        print("  Using cached cookies (fresh).")
        return cached

    # 3. Read from Chrome/Edge
    print("Checking Chrome/Edge for mlb26.theshow.com cookies...")
    cookies = read_chrome_cookies("mlb26.theshow.com")
    session = cookies.get("_tsn_session", "")
    token   = cookies.get("tsn_token", "")

    if session or token:
        print(f"  Found: {', '.join(k for k in cookies if k in ('_tsn_session','tsn_token'))}")
        _save_cookie_cache(cookies)
        return cookies

    # 4/5. Cookie read failed
    if _is_browser_running():
        print()
        print("  Chrome/Edge is running and has locked the cookie database.")
        if NON_INTERACTIVE:
            # Non-interactive: try stale cache before giving up
            stale = _load_cookie_cache_any()
            if stale:
                print("  Using stale cached cookies (Chrome locked, non-interactive).")
                return stale
            sys.exit("ERROR: Cannot read cookies — Chrome is running and no cache available. "
                     "Close Chrome and re-run, or launch the tracker manually once to cache cookies.")
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
                print("  Found cookies!")
                _save_cookie_cache(cookies)
                return cookies
            print("  Still not found. Falling back to manual entry.")
    else:
        print("  Not found in Chrome/Edge.")
        if NON_INTERACTIVE:
            stale = _load_cookie_cache_any()
            if stale:
                print("  Using stale cached cookies (non-interactive fallback).")
                return stale
            sys.exit("ERROR: No cookies found and no cache available. "
                     "Launch the tracker manually once to authenticate.")

    # 6. Manual paste (interactive only)
    print()
    print("  Opening https://mlb26.theshow.com ...")
    import webbrowser
    webbrowser.open(BASE)
    cookies = _manual_paste_flow({})
    _save_cookie_cache(cookies)
    return cookies


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
        programs = (props.get("programs") or props.get("data") or
                    props.get("tiles") or props.get("program_tiles") or [])
        if isinstance(programs, list) and programs:
            return programs
        # Also search for any list of dicts that look like programs
        for key, val in props.items():
            if isinstance(val, list) and val and isinstance(val[0], dict):
                return val
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

    # Strategy 0: Parse embedded Inertia data-page JSON (site is a SPA — links are in JSON not HTML)
    m_data = re.search(r'data-page=["\']({.*?})["\']', html_body, re.DOTALL)
    if m_data:
        try:
            page_data = json.loads(html_module.unescape(m_data.group(1)))
            props = page_data.get("props", page_data)

            def _harvest_urls(obj, depth=0):
                if depth > 8 or not obj:
                    return
                if isinstance(obj, dict):
                    for key in ("url", "href", "path", "link", "route"):
                        val = obj.get(key)
                        if isinstance(val, str) and "/programs" in val and val not in ("/programs",):
                            full = (BASE + val) if val.startswith("/") else val
                            if full not in seen:
                                seen.add(full)
                                links.append(full)
                    for v in obj.values():
                        _harvest_urls(v, depth + 1)
                elif isinstance(obj, list):
                    for item in obj[:300]:
                        _harvest_urls(item, depth + 1)

            _harvest_urls(props)
        except Exception:
            pass

    # Strategy 1: Primary HTML regex (server-side rendered or hybrid pages)
    for m in re.finditer(r'href=["\']([^"\']*(?:program_view|team_affinity|other_programs)[^"\']*)["\']', html_body):
        raw = html_module.unescape(m.group(1))
        url = BASE + raw if raw.startswith("/") else raw
        if url not in seen:
            seen.add(url); links.append(url)

    # Strategy 2: Any /programs/... link in hrefs
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
        -> team_affinity_by_team (one per team)
          -> program_view (My Journey, Color Storm)
      other_programs
        -> program_view
      program_view  (already direct)
    """
    expanded = []
    seen = set()

    def _add(url):
        if url not in seen:
            seen.add(url); expanded.append(url)

    def _extract_links_from_body(body: str, keyword: str) -> list[str]:
        """Find links containing keyword from both HTML hrefs and embedded Inertia JSON."""
        found = []
        seen_f: set[str] = set()

        # HTML href scan
        for m in re.finditer(r'href=["\']([^"\']*' + keyword + r'[^"\']*)["\']', body):
            raw = html_module.unescape(m.group(1))
            url = BASE + raw if raw.startswith("/") else raw
            if url not in seen_f:
                seen_f.add(url); found.append(url)

        # Inertia data-page JSON scan (site is an SPA — real links live in JSON, not hrefs)
        dp = re.search(r'data-page=["\']({.*?})["\']', body, re.DOTALL)
        if dp:
            try:
                page_data = json.loads(html_module.unescape(dp.group(1)))
                def _harvest(obj, depth=0):
                    if depth > 8 or not obj:
                        return
                    if isinstance(obj, dict):
                        for key in ("url", "href", "path", "link", "route"):
                            val = obj.get(key)
                            if isinstance(val, str) and keyword in val:
                                full = BASE + val if val.startswith("/") else val
                                if full not in seen_f:
                                    seen_f.add(full); found.append(full)
                        for v in obj.values():
                            _harvest(v, depth + 1)
                    elif isinstance(obj, list):
                        for item in obj[:300]:
                            _harvest(item, depth + 1)
                _harvest(page_data.get("props", page_data))
            except Exception:
                pass

        return found

    def _scrape_program_views(body: str) -> list[str]:
        return _extract_links_from_body(body, "program_view")

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
            # League tile — must fetch BOTH AL and NL explicitly.
            # The site is an Inertia SPA: the "other league" tab is rendered client-side
            # so we can never find it via HTML href scanning.  Instead we derive both
            # league URLs from the known URL pattern and try each one.
            parsed    = urllib.parse.urlparse(url)
            base_path = parsed.scheme + "://" + parsed.netloc + parsed.path

            # Build explicit AL and NL URLs preserving any existing query params
            # (e.g. group_id=10015 must be kept — without it the server returns
            #  an empty page with no team links).
            existing_qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            league_urls: list[str] = []
            for league in ("al", "nl"):  # server uses lowercase league values
                qs = {k: v[0] for k, v in existing_qs.items()}
                qs["league"] = league
                lurl = base_path + "?" + urllib.parse.urlencode(qs)
                if lurl not in league_urls:
                    league_urls.append(lurl)
            # Also keep the bare URL (with original params) as a fallback
            bare = base_path + ("?" + parsed.query if parsed.query else "")
            if bare not in league_urls:
                league_urls.insert(0, bare)

            # Collect all team links across both leagues
            team_links_all: list[str] = []
            print(f"  Fetching team affinity pages (AL + NL)...")
            for league_url in league_urls:
                lbody, lstatus = get(league_url, headers)
                if lstatus == 200 and lbody:
                    for turl in _extract_links_from_body(lbody, "team_affinity_by_team"):
                        if turl not in team_links_all:
                            team_links_all.append(turl)
                # If HTML yielded nothing (SPA shell with no hrefs), retry with
                # Inertia JSON headers — the server returns JSON containing team URLs.
                if not team_links_all and lstatus == 200:
                    inertia_hdrs = dict(headers)
                    inertia_hdrs.update({
                        "X-Inertia": "true",
                        "X-Requested-With": "XMLHttpRequest",
                        "Accept": "application/json",
                    })
                    ibody, istatus = get(league_url, inertia_hdrs)
                    if istatus == 200 and ibody:
                        try:
                            idata = json.loads(ibody)
                            def _hi_teams(obj: object, depth: int = 0) -> None:
                                if depth > 8 or not obj:
                                    return
                                if isinstance(obj, dict):
                                    for key in ("url", "href", "path", "link", "route"):
                                        val = obj.get(key) or ""
                                        if isinstance(val, str) and "team_affinity_by_team" in val:
                                            full = (BASE + val) if val.startswith("/") else val
                                            if full not in team_links_all:
                                                team_links_all.append(full)
                                    for v in obj.values():
                                        _hi_teams(v, depth + 1)
                                elif isinstance(obj, list):
                                    for item in obj[:300]:
                                        _hi_teams(item, depth + 1)
                            _hi_teams(idata.get("props", idata))
                        except Exception:
                            pass
                time.sleep(0.3)

            _n_teams     = len(team_links_all)
            _team_lock   = threading.Lock()
            print(f"  Found {_n_teams} teams — fetching program links (parallel)...")

            def _fetch_one_team(idx_turl: tuple) -> list[str]:
                idx, turl = idx_turl
                tbody, tstatus = get(turl, headers)
                pvs: list[str] = []
                if tstatus == 200 and tbody:
                    pvs = _scrape_program_views(tbody)
                    if not pvs:
                        _ih = dict(headers)
                        _ih.update({"X-Inertia": "true",
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Accept": "application/json"})
                        tibody, tistatus = get(turl, _ih)
                        if tistatus == 200 and tibody:
                            pvs = _extract_links_from_body(tibody, "program_view")
                team_slug  = urllib.parse.parse_qs(
                    urllib.parse.urlparse(turl).query
                ).get("team_id", [turl[-20:]])[0]
                status_str = f"{len(pvs)} program(s)" if tstatus == 200 else f"SKIP ({tstatus})"
                with _team_lock:
                    print(f"    [{idx:2}/{_n_teams}] {team_slug} -> {status_str}")
                return pvs

            all_team_pvs: list[str] = []
            with ThreadPoolExecutor(max_workers=MAX_FETCH_WORKERS) as _tex:
                for _pvs in _tex.map(_fetch_one_team, enumerate(team_links_all, 1)):
                    all_team_pvs.extend(_pvs)
            for pv in all_team_pvs:
                _add(pv)

        elif "other_programs" in path:
            # Other programs listing
            print(f"  Fetching other programs listing...")
            body, status = get(url, headers)
            if status == 200 and body:
                pvs = _scrape_program_views(body)
                for pv in pvs:
                    _add(pv)
                print(f"  Found {len(pvs)} other program link(s)")
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
        title = re.sub(r'\s{2,}', ' ',
                       html_module.unescape(re.sub(r'<[^>]+>', '', m_title.group(1)))).strip() if m_title else ""
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
        title = re.sub(r'\s{2,}', ' ',
                       html_module.unescape(re.sub(r'<[^>]+>', '', m_title.group(1)))).strip()
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


def extract_program_xp(html_body: str) -> tuple:
    """
    Try to extract (xp_earned, xp_total) from a program page.
    Looks in the Inertia data-page JSON first, then falls back to HTML text.
    Returns (None, None) if not found.
    """
    # Strategy 1: Inertia JSON — recursively find xp-like numeric fields
    m_data = re.search(r'data-page=["\']({.*?})["\']', html_body, re.DOTALL)
    if m_data:
        try:
            page_data = json.loads(html_module.unescape(m_data.group(1)))
            props = page_data.get("props", page_data)
            earned = total = None

            def _scan(obj, depth=0):
                nonlocal earned, total
                if depth > 8 or not obj:
                    return
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        kl = k.lower()
                        if isinstance(v, (int, float)) and v >= 0:
                            # Exact known field names
                            if kl in ("xp_earned", "earned_xp", "user_xp",
                                      "current_xp", "xp_progress", "xp",
                                      "progress", "user_progress", "points",
                                      "earned_points", "current_points"):
                                if earned is None:
                                    earned = int(v)
                            elif kl in ("total_xp", "max_xp", "xp_total",
                                        "xp_max", "total_earned", "goal_xp",
                                        "required_xp", "target_xp", "max_points",
                                        "total_points", "goal", "goal_points"):
                                if total is None:
                                    total = int(v)
                            # Fuzzy: any key containing both "xp"/"point" and "earn"/"current"/"progress"
                            elif "xp" in kl or "point" in kl:
                                if any(w in kl for w in ("earn", "current", "progress", "user")):
                                    if earned is None:
                                        earned = int(v)
                                elif any(w in kl for w in ("total", "max", "goal", "required", "target")):
                                    if total is None:
                                        total = int(v)
                        _scan(v, depth + 1)
                elif isinstance(obj, list):
                    for item in obj[:50]:
                        _scan(item, depth + 1)

            _scan(props)
            if earned is not None:
                return (earned, total, [])
        except Exception:
            pass

    # Strategy 1b: Timeline <li> structure (WBC / XP-path style program pages).
    # A <li class="partial [active]"> marks the current earned position; its label div
    # contains "95 <img...> Earned".  Every <li class="counting"> is a milestone.
    # The server may use single OR double quotes for class attributes, so all
    # sub-patterns use ["'] to handle both styles.
    _QP = r"""["'][^"']*%s[^"']*["']"""   # quote-agnostic class pattern helper
    m_partial_li = re.search(r'<li[^>]+class=' + _QP % 'partial',
                              html_body, re.IGNORECASE)
    if m_partial_li:
        snip = html_body[m_partial_li.start(): m_partial_li.start() + 400]
        m_en = re.search(r'class=' + _QP % 'label' + r'[^>]*>\s*(\d[\d,]*)',
                         snip, re.IGNORECASE)
        if m_en:
            earned_tl = int(m_en.group(1).replace(',', ''))
            milestone_vals = sorted(set(
                int(x.replace(',', ''))
                for x in re.findall(
                    r'<li[^>]+class=' + _QP % 'counting' + r'[^>]*>\s*'
                    r'<div[^>]+class=' + _QP % 'label'   + r'[^>]*>\s*(\d[\d,]*)',
                    html_body, re.IGNORECASE)
            ))
            return (earned_tl, max(milestone_vals) if milestone_vals else None, milestone_vals)

    # Strategy 1c: Programs without a partial <li> — either not started, or earned
    # lands exactly on a milestone boundary (including fully complete).
    # Collect all counting <li>s with class attrs + label values, then:
    #   earned = max label among active lis  (0 if none are active yet)
    #   total  = max of all milestone labels
    # Approach (a) overrides with an explicit "N <img alt='xp'> Earned" header if present.
    _counting_data = re.findall(
        r"""<li([^>]+class=["'][^"']*counting[^"']*["'][^>]*)>\s*"""
        r"""<div[^>]+class=["'][^"']*label[^"']*["'][^>]*>\s*(\d[\d,]*)""",
        html_body, re.IGNORECASE)
    if _counting_data:
        _ms_1c = sorted(set(int(v.replace(',', '')) for _, v in _counting_data))
        if _ms_1c:
            # Approach (a): explicit XP-icon earned header (alt="xp", not stubs)
            _m_xp = re.search(
                r'\b(\d[\d,]*)\s*<img[^>]+alt=["\']xp["\'][^>]*/?\s*>\s*Earned\b',
                html_body, re.IGNORECASE)
            if _m_xp:
                return (int(_m_xp.group(1).replace(',', '')), max(_ms_1c), _ms_1c)
            # Approach (b): infer earned from the highest active milestone boundary.
            # Covers: 0% (no active lis), mid-path at a boundary, and fully complete.
            _active_vals = [int(v.replace(',', '')) for attrs, v in _counting_data
                            if 'active' in attrs]
            _earned_1c = max(_active_vals) if _active_vals else 0
            return (_earned_1c, max(_ms_1c), _ms_1c)

    # Strategy 2: "75 / 100 XP" or "75 of 100 XP" — the format visible on the XP path page
    m_slash = re.search(
        r'\b(\d{1,6})\s*(?:/|of)\s*(\d{1,6})\s*XP\b',
        html_body, re.IGNORECASE)
    if m_slash:
        return (int(m_slash.group(1)), int(m_slash.group(2)), [])

    # Strategy 3: "XP: 75 / 100" variant
    m_xp_colon = re.search(
        r'\bXP[:\s]+(\d{1,6})\s*(?:/|of)\s*(\d{1,6})\b',
        html_body, re.IGNORECASE)
    if m_xp_colon:
        return (int(m_xp_colon.group(1)), int(m_xp_colon.group(2)), [])

    # Strategy 4: meter tag near an "XP" label — <meter value="75" max="100">
    for m_meter in re.finditer(
            r'<meter[^>]+>', html_body, re.IGNORECASE):
        tag = m_meter.group(0)
        mv = re.search(r'\bvalue=["\']?(\d+)', tag)
        mm = re.search(r'\bmax=["\']?(\d+)', tag)
        if mv and mm:
            val, mx = int(mv.group(1)), int(mm.group(1))
            if 0 <= val <= mx <= 100000 and mx > 10:
                start = max(0, m_meter.start() - 150)
                end   = min(len(html_body), m_meter.end() + 150)
                nearby = html_body[start:end]
                if re.search(r'\bXP\b', nearby, re.IGNORECASE):
                    return (val, mx, [])

    # Strategy 5: "50,000 Earned" / "54 Earned" XP reward-path pattern.
    m_earned = re.search(r'\b(\d[\d,]*)\s+(?:XP\s+)?Earned\b', html_body, re.IGNORECASE)
    if m_earned:
        earned = int(m_earned.group(1).replace(',', ''))
        after_section = html_body[m_earned.end(): m_earned.end() + 4000]
        milestones = [int(x.replace(',', ''))
                      for x in re.findall(r'\b(\d[\d,]*)\s*XP\b', after_section)]
        if milestones:
            total = max(milestones)
            if total > 0 and total >= earned:
                return (earned, total, sorted(set(milestones)))
        return (earned, None, [])

    return (None, None, [])


def _parse_positions(item: dict) -> tuple[str, list[str]]:
    """Extract (primary_pos, all_positions) from an inventory item dict."""
    raw_pos = str(item.get("position") or item.get("primary_position") or
                  item.get("display_position") or item.get("pos") or "").strip().upper()
    # Handle slash-separated positions like "1B/DH" or "OF/DH/1B"
    slash_parts = [p.strip() for p in raw_pos.split("/") if p.strip()]
    pos = slash_parts[0] if slash_parts else raw_pos

    # secondary / all positions list from API fields
    # Note: official inventory API uses "display_secondary_positions" (may be comma/slash string)
    sec_raw = (item.get("display_secondary_positions") or
               item.get("secondary_positions") or item.get("positions") or
               item.get("eligible_positions") or [])
    if isinstance(sec_raw, str):
        sec_raw = [s.strip() for s in sec_raw.replace("/", ",").split(",") if s.strip()]
    positions = []
    # start with slash-decoded primary parts, then add explicit secondary fields
    for p in slash_parts + list(sec_raw):
        p = str(p).strip().upper()
        if p and p not in positions:
            positions.append(p)
    if not positions and pos:
        positions = [pos]
    return pos, positions


def fetch_inventory(cookies: dict) -> list[dict]:
    """
    Fetch the user's MLB player card names (and positions) from their inventory.
    Returns a sorted list of dicts: [{name, pos, positions, series}, ...]

    A player can appear multiple times with different series (e.g. "Adam Jones" with
    series "Jolt" AND series "Live Series").  We key on (name, series) so every
    distinct owned card is preserved — this lets the JS invMap build compound keys
    like "Jolt Adam Jones" that series-specific missions can match against exactly.
    """
    player_cards: dict[tuple[str, str], dict] = {}   # (name, series) -> card dict

    def _add_card(item: dict) -> None:
        name = str(item.get("name") or item.get("player_name") or
                   item.get("display_name") or item.get("full_name") or "").strip()
        if not name or not (2 < len(name) < 60):
            return
        parts = name.split()
        if len(parts) < 2 or not parts[0][0].isupper():
            return
        pos, positions = _parse_positions(item)
        series = str(item.get("series") or item.get("card_series") or
                     item.get("series_name") or "").strip()
        key = (name, series)
        if key not in player_cards:
            player_cards[key] = {"name": name, "pos": pos, "positions": positions,
                                 "series": series}
        else:
            # Already have this exact (name, series) combo — update pos if missing
            existing = player_cards[key]
            if not existing.get("pos") and pos:
                existing.update({"pos": pos, "positions": positions})

    def _parse_inv_table(html_body: str) -> None:
        """Parse the HTML inventory table and add owned player cards."""
        # Table columns: Qty(0) | img(1) | Player(2) | Overall(3) | Pos(4) | Team(5) | Series(6) | ...
        for row in re.finditer(r'<tr[^>]*>(.*?)</tr>', html_body, re.DOTALL | re.IGNORECASE):
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row.group(1), re.DOTALL | re.IGNORECASE)
            if len(cells) < 5:
                continue
            # Qty cell — skip cards the user doesn't own (0x)
            qty_text = re.sub(r'<[^>]+>', '', cells[0]).strip()
            m_qty = re.search(r'(\d+)', qty_text)
            if not m_qty or int(m_qty.group(1)) == 0:
                continue
            # Player name is in cells[2] (cells[1] is the thumbnail image cell)
            name = html_module.unescape(re.sub(r'<[^>]+>', ' ', cells[2])).strip()
            name = re.sub(r'\s+', ' ', name).strip()
            # Overall rating cell (cells[3])
            overall = re.sub(r'<[^>]+>', '', cells[3]).strip()
            # Position cell (cells[4], not cells[3] which is Overall rating)
            pos = re.sub(r'<[^>]+>', '', cells[4]).strip().upper()
            # Team cell (cells[5])
            team = re.sub(r'<[^>]+>', '', cells[5]).strip() if len(cells) > 5 else ''
            # Series column (cells[6], not cells[5] which is Team)
            series_raw = re.sub(r'<[^>]+>', '', cells[6]).strip() if len(cells) > 6 else ''
            # Allow standard positions including 1B/2B/3B (start with digit)
            if name and pos and re.match(r'^[A-Z1-9]', pos):
                _add_card({"name": name, "pos": pos, "positions": [pos],
                           "series": series_raw})

    # ── Strategy 1: Official /apis/inventory.json?type=mlb_card ──────────────
    # Paginated JSON API — the canonical source for owned cards.
    # Fetch page 1 first to learn total_pages, then fetch remaining pages in parallel.
    inv_total_pages   = 1
    inv_hdrs          = make_headers(cookies)

    def _fetch_inv_api_page(page: int) -> tuple:
        """Returns (items_list, total_pages). total_pages only reliable from page 1."""
        url = f"{BASE}/apis/inventory.json?type=mlb_card&page={page}"
        body, status = get(url, inv_hdrs)
        if status != 200 or not body:
            return [], 1
        try:
            data = json.loads(body)
            return data.get("inventory") or [], int(data.get("total_pages", 1))
        except Exception:
            return [], 1

    # Page 1: learn total_pages + seed the card dict (single fetch — no double-call)
    _p1_items, inv_total_pages = _fetch_inv_api_page(1)
    for item in _p1_items:
        if isinstance(item, dict) and str(item.get("quantity", "0")) != "0":
            _add_card(item)

    # Pages 2..N in parallel
    if inv_total_pages > 1:
        with ThreadPoolExecutor(max_workers=MAX_FETCH_WORKERS) as _iex:
            for _items, _ in _iex.map(_fetch_inv_api_page, range(2, inv_total_pages + 1)):
                for item in _items:
                    if isinstance(item, dict) and str(item.get("quantity", "0")) != "0":
                        _add_card(item)

    if player_cards:
        print(f"  [inventory] API: {len(player_cards)} owned cards "
              f"({inv_total_pages} pages)")

    # ── Strategy 2: HTML table — run for position enrichment (parallel fetch) ──
    # The /inventory page renders a table with Pos column.  Fetch up to 10 pages
    # in parallel, then process them in order (with early-stop when no new data).
    hdrs_html = make_headers(cookies)

    def _fetch_inv_html(page: int) -> str | None:
        url = f"{BASE}/inventory?type=mlb_card&ownership=my_cards&page={page}"
        body, status = get(url, hdrs_html)
        return body if status == 200 and body else None

    with ThreadPoolExecutor(max_workers=MAX_FETCH_WORKERS) as _hex:
        _html_bodies = list(_hex.map(_fetch_inv_html, range(1, 11)))

    for page, body in enumerate(_html_bodies, 1):
        if not body:
            break
        if page == 1:
            _raw_path = os.path.join(SCRIPT_DIR, "debug_inventory_raw.html")
            with open(_raw_path, "w", encoding="utf-8", errors="replace") as _f:
                _f.write(body[:100000])
        before_len = len(player_cards)
        before_pos = sum(1 for c in player_cards.values() if c.get("pos"))
        _parse_inv_table(body)
        new_names = len(player_cards) - before_len
        new_pos   = sum(1 for c in player_cards.values() if c.get("pos")) - before_pos
        if new_names == 0 and new_pos == 0 and page > 1:
            break

    # ── Strategy 3: Inertia JSON fallback ─────────────────────────────────────
    if not player_cards:
        body, status = get(f"{BASE}/inventory", make_headers(cookies, inertia=True))
        if status == 200 and body:
            try:
                data  = json.loads(body)
                props = data.get("props", data)
                items = (props.get("items") or props.get("inventory") or
                         props.get("cards") or props.get("collection_items") or [])
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            _add_card(item)
            except Exception:
                pass

    # Strategy 4: Squad/roster endpoint as final fallback
    if not player_cards:
        body, status = get(f"{BASE}/squads", make_headers(cookies, inertia=True))
        if status == 200 and body:
            try:
                data  = json.loads(body)
                props = data.get("props", data)
                for key in ("squad", "players", "roster", "lineup"):
                    items = props.get(key) or []
                    if isinstance(items, list) and items:
                        for item in items:
                            if isinstance(item, dict):
                                _add_card(item)
                        if player_cards:
                            break
            except Exception:
                pass

    return sorted(player_cards.values(), key=lambda c: c["name"])


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
        print(f"  [debug] Saved programs listing page -> {dbg_path}")

    # Find top-level program links (includes team_affinity + other_programs tiles)
    links = find_program_links(prog_body)

    # Fallback: try Inertia JSON API if HTML/data-page scraping found nothing
    if not links:
        print("  HTML scraping found no links — trying Inertia JSON API...")
        inertia_body, inertia_status = get(f"{BASE}/programs", make_headers(cookies, inertia=True))
        if inertia_status == 200 and inertia_body:
            try:
                inertia_data = json.loads(inertia_body)
                props = inertia_data.get("props", inertia_data)
                def _harvest_inertia(obj, depth=0):
                    if depth > 8 or not obj:
                        return
                    if isinstance(obj, dict):
                        for key in ("url", "href", "path", "link", "route"):
                            val = obj.get(key)
                            if isinstance(val, str) and "/programs" in val and val not in ("/programs",):
                                full = (BASE + val) if val.startswith("/") else val
                                if full not in links:
                                    links.append(full)
                        for v in obj.values():
                            _harvest_inertia(v, depth + 1)
                    elif isinstance(obj, list):
                        for item in obj[:300]:
                            _harvest_inertia(item, depth + 1)
                _harvest_inertia(props)
            except Exception:
                pass
        if debug and inertia_body:
            dbg_inertia = os.path.join(SCRIPT_DIR, "debug_programs_inertia.json")
            with open(dbg_inertia, "w", encoding="utf-8") as f:
                f.write(inertia_body)
            print(f"  [debug] Saved Inertia JSON -> {dbg_inertia}")

    # Auto-save debug HTML when 0 links found (helps diagnose page structure changes)
    if not links:
        dbg_path = os.path.join(SCRIPT_DIR, "debug_programs_page.html")
        with open(dbg_path, "w", encoding="utf-8") as f:
            f.write(prog_body)
        print(f"  WARNING: Found 0 program links. Saved page HTML -> {dbg_path}")
        print(f"  The site structure may have changed. Please share debug_programs_page.html for diagnosis.")

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
    team_xp:        dict[str, dict[str, dict]] = {}   # team -> prog_type -> {xp_earned,xp_total,xp_milestones}
    other_prog_raw: dict[str, dict]            = {}   # name -> {group, missions}
    total = len(links)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def dedup_sort(lst: list) -> list:
        """Deduplicate by (title, desc[:60]) and sort by pct descending."""
        seen, out = set(), []
        for m in sorted(lst, key=lambda x: -x["pct"]):
            key = (m["t"], (m.get("d") or "")[:60])
            if m["t"] and key not in seen:
                seen.add(key); out.append(m)
        return out

    build_script = os.path.join(SCRIPT_DIR, "build_tracker.py")
    html_out     = os.path.join(SCRIPT_DIR, "MLB Team Affinity Tracker.html")

    def _flush_tracker(inventory_snap: list | None = None, label: str = "") -> None:
        """Write mlb_data_live.json and rebuild the tracker HTML in-place."""
        # Build deduped snapshots for output (don't mutate live dicts)
        team_out = {t: {pt: dedup_sort(list(ms)) for pt, ms in progs.items()}
                    for t, progs in team_missions.items()}
        other_dedup = {k: {**v, "missions": dedup_sort(list(v["missions"]))}
                       for k, v in other_prog_raw.items()}
        op_html: dict = {}
        for pn, pd in other_dedup.items():
            g = pd["group"]
            e: dict = {"color": PROG_GROUP_COLORS.get(g, "#8b5cf6"),
                       "icon": make_prog_icon(pn), "group": g,
                       "missions": pd["missions"]}
            if "xp_earned"     in pd: e["xp_earned"]     = pd["xp_earned"]
            if "xp_total"      in pd: e["xp_total"]      = pd["xp_total"]
            if "xp_milestones" in pd: e["xp_milestones"] = pd["xp_milestones"]
            if "complete"      in pd: e["complete"]       = pd["complete"]
            op_html[pn] = e

        data = {
            "divisions":       DIVISIONS,
            "colors":          TEAM_COLORS,
            "missions":        team_out,
            "team_xp":         team_xp,
            "other_programs":  op_html,
            "inventory":       inventory_snap or [],
            "data_source":     "live",
            "data_date":       time.strftime("%Y-%m-%d %H:%M"),
            "_prog_url_cache": {**prog_cache, **new_prog_cache},
        }
        try:
            with open(OUT_JSON, "w", encoding="utf-8") as _f:
                json.dump(data, _f, indent=2, ensure_ascii=True)
        except Exception:
            return

        if os.path.exists(build_script):
            subprocess.run([sys.executable, build_script, "--source", OUT_JSON],
                           capture_output=True, cwd=SCRIPT_DIR)
        if label:
            print(f"  [update] {label}")

    # ── Load program URL cache ─────────────────────────────────────────────────
    prog_cache: dict = {}
    if os.path.exists(OUT_JSON):
        try:
            with open(OUT_JSON, encoding="utf-8") as _cf:
                _old_data = json.load(_cf)
            prog_cache = _old_data.get("_prog_url_cache", {})
            if prog_cache:
                n_done = sum(1 for v in prog_cache.values() if v.get("complete"))
                print(f"  [cache] {len(prog_cache)} cached programs, "
                      f"{n_done} fully complete (will skip HTTP fetch)")
        except Exception:
            pass

    # ── Start inventory fetch in background ───────────────────────────────────
    # Runs concurrently while programs are fetched so there's no wait at the end.
    _inv_result:  list = [None]
    _inv_done     = threading.Event()

    def _bg_inventory() -> None:
        _inv_result[0] = fetch_inventory(cookies)
        _inv_done.set()
        print(f"\n  [inventory] {len(_inv_result[0])} player cards loaded")

    print("\nFetching player inventory (background)...")
    threading.Thread(target=_bg_inventory, daemon=True).start()

    # ── Parallel program fetch with incremental tracker rebuilds ──────────────
    _prog_print_lock = threading.Lock()
    _xp_dbg_written  = threading.Event()
    new_prog_cache:  dict = {}

    def _fetch_one_program(i_url: tuple) -> tuple:
        i, url = i_url
        cached = prog_cache.get(url)
        if cached and cached.get("complete"):
            # If this is a non-team program and the cache entry predates the
            # xp_milestones feature (key absent entirely), re-fetch once so
            # the milestone data gets stored for the fill bar.
            _h1c = cached.get("h1", "")
            _xp_e = cached.get("xp_earned")
            _xp_t = cached.get("xp_total")
            _xp_incomplete = (
                _xp_e is not None and _xp_t is not None and _xp_e < _xp_t
            )
            # Milestone data is bad if the key is absent or stored as None.
            # Treat both the same: one-time re-fetch for any program type.
            _ms_bad = (
                "xp_milestones" not in cached
                or cached.get("xp_milestones") is None
            )
            _needs_xp_refresh = (
                _ms_bad          # milestones missing/None (any program)
                or _xp_incomplete  # XP still earning — re-fetch regardless of team/non-team
            )
            if not _needs_xp_refresh:
                with _prog_print_lock:
                    print(f"  [{i:3}/{total}] {len(cached['missions']):3} missions  "
                          f"{_h1c[:40]}  [cached]")
                return (i, url, cached)
            # Fall through to re-fetch

        p_body, p_status = get(url, headers)
        if p_status != 200 or not p_body:
            with _prog_print_lock:
                print(f"  [{i:3}/{total}] SKIP ({p_status}) {url[-50:]}")
            return (i, url, None)

        missions                        = extract_missions_from_html(p_body)
        xp_earned, xp_total, xp_milestones = extract_program_xp(p_body)
        h1 = ""
        m_h1 = re.search(r'<h1[^>]*>(.*?)</h1>', p_body, re.DOTALL | re.IGNORECASE)
        if m_h1:
            h1 = re.sub(r'<[^>]+>', '', m_h1.group(1)).strip()
        _non_rep = [m for m in missions if not m.get("t", "").upper().startswith("REPEATABLE")]
        complete = (
            bool(_non_rep) and all(m.get("pct", 0) >= 1.0 for m in _non_rep)
        ) or (
            xp_earned is not None and xp_total is not None and xp_earned >= xp_total
        )

        if xp_earned is None and not normalize_team(h1) and not _xp_dbg_written.is_set():
            _xp_dbg_written.set()
            try:
                with open(os.path.join(SCRIPT_DIR, "debug_prog_xp.html"),
                          "w", encoding="utf-8", errors="replace") as _f:
                    _f.write(p_body[:150000])
                with _prog_print_lock:
                    print(f"  [info] XP not found for '{h1[:40]}' — saved debug_prog_xp.html")
            except Exception:
                pass

        if debug and i == 1:
            try:
                dbg2 = os.path.join(SCRIPT_DIR, "debug_program_page.html")
                with open(dbg2, "w", encoding="utf-8") as f:
                    f.write(p_body)
                with _prog_print_lock:
                    print(f"  [debug] {dbg2} ({len(p_body)}b, {len(missions)} missions, "
                          f"XP {xp_earned}/{xp_total})")
            except Exception:
                pass

        label  = (h1[:40] or f"prog {parse_url_params(url).get('program_id','?')}")
        suffix = "  [DONE]" if complete else ""
        with _prog_print_lock:
            print(f"  [{i:3}/{total}] {len(missions):3} missions  {label}{suffix}")

        return (i, url, {"h1": h1, "missions": missions,
                         "xp_earned": xp_earned, "xp_total": xp_total,
                         "xp_milestones": xp_milestones or [],
                         "complete": complete})

    def _absorb(result: dict) -> None:
        """Merge one program result into team_missions / other_prog_raw."""
        h1        = result.get("h1", "")
        missions  = result.get("missions", [])
        xp_earned = result.get("xp_earned")
        xp_total  = result.get("xp_total")
        team      = normalize_team(h1)
        h1l       = h1.lower()
        is_cs     = bool(re.search(r'color\s*storm|#1 fan', h1l, re.I))
        prog_type = "Color Storm" if is_cs else "My Journey"
        if team:
            team_missions.setdefault(team, {}).setdefault(prog_type, []).extend(missions)
            xp_milestones = result.get("xp_milestones", [])
            txp = team_xp.setdefault(team, {}).setdefault(prog_type, {})
            if xp_earned    is not None: txp["xp_earned"]     = xp_earned
            if xp_total     is not None: txp["xp_total"]      = xp_total
            if xp_milestones:            txp["xp_milestones"] = xp_milestones
        else:
            if   re.search(r'xp.*(path|reward)|1st inning', h1l, re.I):
                group, prog_key = "xp_path",    h1 or "1st Inning XP Path"
            elif re.search(r'multiplayer|ranked.*season',   h1l, re.I):
                group, prog_key = "multiplayer", h1 or "Multiplayer Program"
            else:
                group, prog_key = "assorted",    h1 or "Assorted Programs"
            if prog_key not in other_prog_raw:
                other_prog_raw[prog_key] = {"group": group, "missions": []}
            other_prog_raw[prog_key]["missions"].extend(missions)
            xp_milestones = result.get("xp_milestones", [])
            if xp_earned is not None and "xp_earned" not in other_prog_raw[prog_key]:
                other_prog_raw[prog_key]["xp_earned"] = xp_earned
            if xp_total  is not None and "xp_total"  not in other_prog_raw[prog_key]:
                other_prog_raw[prog_key]["xp_total"]  = xp_total
            if xp_milestones and "xp_milestones" not in other_prog_raw[prog_key]:
                other_prog_raw[prog_key]["xp_milestones"] = xp_milestones
            # Track completion so the dashboard can exclude done programs
            if result.get("complete"):
                other_prog_raw[prog_key]["complete"] = True

    # Submit all programs, process + flush incrementally as results arrive
    FLUSH_SECS     = 8     # rebuild tracker at most this often during the run
    completed      = 0
    last_flush_t   = time.time()
    print(f"\nFetching {total} programs...")

    with ThreadPoolExecutor(max_workers=MAX_FETCH_WORKERS) as _pex:
        _futs = {_pex.submit(_fetch_one_program, (i, url)): i
                 for i, url in enumerate(links, 1)}
        for _fut in as_completed(_futs):
            i, url, result = _fut.result()
            if result:
                new_prog_cache[url] = result
                _absorb(result)
            completed += 1

            # Incremental rebuild: first time after 5 completions, then every FLUSH_SECS
            elapsed = time.time() - last_flush_t
            if completed == 5 or (completed > 5 and elapsed >= FLUSH_SECS):
                pct = int(completed / total * 100)
                # Use current inventory if background thread already finished
                snap = _inv_result[0] if _inv_done.is_set() else None
                _flush_tracker(snap,
                               f"Tracker refreshed ({completed}/{total} programs — {pct}%)")
                last_flush_t = time.time()

    # ── Wait for inventory, then final flush ──────────────────────────────────
    if not _inv_done.is_set():
        print("  Waiting for inventory to finish...")
        _inv_done.wait()
    inventory = _inv_result[0] or []

    print()
    team_total  = sum(sum(len(v) for v in t.values()) for t in team_missions.values())
    other_total = sum(len(v["missions"]) for v in other_prog_raw.values())
    print(f"Team missions:  {team_total:4d} across {len(team_missions)} teams")
    print(f"Other missions: {other_total:4d} across {len(other_prog_raw)} programs")
    print(f"Inventory:      {len(inventory):4d} player cards")

    print("\nFinal rebuild...")
    _flush_tracker(inventory)
    print(f"Saved: {OUT_JSON}")

    # Open browser once — use new=0 so Chrome reuses the existing tab if possible
    import webbrowser
    url_str = "file:///" + html_out.replace("\\", "/")
    if "--no-browser" not in sys.argv:
        print(f"\nAll done!  Opening tracker...")
        webbrowser.open(url_str, new=0)
    else:
        print(f"\nAll done!  Tracker: {html_out}")


if __name__ == "__main__":
    main()
