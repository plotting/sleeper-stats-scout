"""
MLB The Show 26 Tracker — GUI launcher
Double-click to run. No console window.
"""
import tkinter as tk
from tkinter import font as tkfont
import subprocess, sys, os, threading, webbrowser

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
FETCH_SCRIPT = os.path.join(SCRIPT_DIR, "fetch_mlb26.py")
HTML_OUT     = os.path.join(SCRIPT_DIR, "MLB Team Affinity Tracker.html")

BG      = "#080d18"
SURFACE = "#0f1923"
SURFACE2= "#162031"
BORDER  = "#1e3554"
TEXT    = "#e2e8f0"
MUTED   = "#64748b"
BLUE    = "#3b9edd"
GREEN   = "#22c55e"
RED     = "#ef4444"
AMBER   = "#f59e0b"


class App:
    def __init__(self, root: tk.Tk):
        self.root    = root
        self.running = False

        root.title("MLB The Show 26 Tracker")
        root.configure(bg=BG)
        root.geometry("600x480")
        root.minsize(480, 380)
        root.resizable(True, True)

        self._build_ui()

    # ── UI construction ────────────────────────────────────────────────────────

    def _build_ui(self):
        # Header
        hdr = tk.Frame(self.root, bg=BG, height=56)
        hdr.pack(fill="x", side="top")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="MLB The Show 26", bg=BG, fg=BLUE,
                 font=("Segoe UI", 14, "bold")).pack(side="left", padx=16, pady=14)
        tk.Label(hdr, text="Team Affinity Tracker", bg=BG, fg=MUTED,
                 font=("Segoe UI", 10)).pack(side="left", pady=14)

        sep = tk.Frame(self.root, bg=BORDER, height=1)
        sep.pack(fill="x")

        # Button row
        btn_row = tk.Frame(self.root, bg=BG, pady=12)
        btn_row.pack(fill="x", padx=16)

        self.btn = tk.Button(
            btn_row, text="  Refresh Live Data  ",
            bg=BLUE, fg="white", activebackground="#2d85c0", activeforeground="white",
            relief="flat", bd=0, font=("Segoe UI", 11, "bold"),
            padx=18, pady=8, cursor="hand2",
            command=self._start_fetch,
        )
        self.btn.pack(side="left")

        self.open_btn = tk.Button(
            btn_row, text="Open Tracker",
            bg=SURFACE2, fg=TEXT, activebackground=SURFACE, activeforeground=TEXT,
            relief="flat", bd=0, font=("Segoe UI", 10),
            padx=12, pady=8, cursor="hand2",
            command=self._open_html,
            state="normal" if os.path.exists(HTML_OUT) else "disabled",
        )
        self.open_btn.pack(side="left", padx=10)

        # Log area
        log_frame = tk.Frame(self.root, bg=SURFACE, bd=0)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0, 0))

        self.log = tk.Text(
            log_frame, bg=SURFACE, fg=TEXT, insertbackground=TEXT,
            font=("Consolas", 9), relief="flat", bd=0,
            state="disabled", wrap="word",
            selectbackground=SURFACE2, selectforeground=TEXT,
        )
        sb = tk.Scrollbar(log_frame, orient="vertical", command=self.log.yview,
                          bg=SURFACE2, troughcolor=SURFACE, activebackground=BORDER)
        self.log.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True, padx=8, pady=8)

        # Configure text tags for coloring
        self.log.tag_configure("ok",    foreground=GREEN)
        self.log.tag_configure("err",   foreground=RED)
        self.log.tag_configure("warn",  foreground=AMBER)
        self.log.tag_configure("info",  foreground=BLUE)
        self.log.tag_configure("muted", foreground=MUTED)

        # Status bar
        status_sep = tk.Frame(self.root, bg=BORDER, height=1)
        status_sep.pack(fill="x")

        status_bar = tk.Frame(self.root, bg=SURFACE, height=28)
        status_bar.pack(fill="x")
        status_bar.pack_propagate(False)

        self.status_dot = tk.Label(status_bar, text="●", bg=SURFACE, fg=MUTED,
                                   font=("Segoe UI", 9))
        self.status_dot.pack(side="left", padx=(10, 4), pady=4)
        self.status_lbl = tk.Label(status_bar, text="Ready", bg=SURFACE, fg=MUTED,
                                   font=("Segoe UI", 9))
        self.status_lbl.pack(side="left", pady=4)

        self._log("MLB The Show 26 Tracker ready.\n", "muted")

    # ── Logging ───────────────────────────────────────────────────────────────

    def _log(self, text: str, tag: str = ""):
        self.log.configure(state="normal")
        if tag:
            self.log.insert("end", text, tag)
        else:
            self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _log_line(self, line: str):
        """Color-tag a line based on its content."""
        lo = line.lower()
        if any(x in lo for x in ("error", "fail", "traceback", "exception")):
            tag = "err"
        elif any(x in lo for x in ("done!", "saved:", "all done", "complete")):
            tag = "ok"
        elif any(x in lo for x in ("found", "fetching", "checking", "rebuilding", "using cached")):
            tag = "info"
        elif any(x in lo for x in ("skip", "warning", "not found")):
            tag = "warn"
        else:
            tag = ""
        self._log(line + "\n", tag)

    # ── Status bar helpers ────────────────────────────────────────────────────

    def _set_status(self, text: str, color: str):
        self.status_dot.configure(fg=color)
        self.status_lbl.configure(text=text, fg=color)

    # ── Fetch logic ───────────────────────────────────────────────────────────

    def _start_fetch(self):
        if self.running:
            return
        self.running = True
        self.btn.configure(state="disabled", text="  Refreshing...  ", bg="#1a5a82")
        self._set_status("Fetching live data…", AMBER)
        self._log("\n── Starting fetch ──────────────────────\n", "muted")
        t = threading.Thread(target=self._fetch_thread, daemon=True)
        t.start()

    def _fetch_thread(self):
        try:
            proc = subprocess.Popen(
                [sys.executable, FETCH_SCRIPT, "--no-browser"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=SCRIPT_DIR,
                bufsize=1,
            )
            for line in proc.stdout:
                line = line.rstrip("\n\r")
                self.root.after(0, self._log_line, line)
            proc.wait()
            success = proc.returncode == 0
        except Exception as e:
            self.root.after(0, self._log, f"Launch error: {e}\n", "err")
            success = False

        self.root.after(0, self._fetch_done, success)

    def _fetch_done(self, success: bool):
        self.running = False
        self.btn.configure(state="normal", text="  Refresh Live Data  ", bg=BLUE)
        if success:
            self._set_status("Done — tracker updated", GREEN)
            self._log("\n── Fetch complete ──────────────────────\n", "ok")
            self.open_btn.configure(state="normal")
            self._open_html()
        else:
            self._set_status("Fetch failed — see log above", RED)
            self._log("\n── Fetch failed ────────────────────────\n", "err")

    def _open_html(self):
        if os.path.exists(HTML_OUT):
            webbrowser.open("file:///" + HTML_OUT.replace("\\", "/"))
        else:
            self._log("Tracker HTML not found — run a fetch first.\n", "warn")


if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()
