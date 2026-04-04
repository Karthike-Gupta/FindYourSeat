/* ════════════════════════════════════════════════════════
   THEME — runs before any render to prevent flash
   ════════════════════════════════════════════════════════ */
(function () {
  const STORAGE_KEY = "examSeats_theme";
  const root = document.documentElement;

  function getInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
  }

  function toggleTheme() {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  applyTheme(getInitialTheme());

  document.addEventListener("DOMContentLoaded", () => {
    document
      .getElementById("themeToggle")
      ?.addEventListener("click", toggleTheme);
  });

  window
    .matchMedia?.("(prefers-color-scheme: light)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem(STORAGE_KEY))
        applyTheme(e.matches ? "light" : "dark");
    });
})();

/* ════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════ */
const CONFIG = {
  APPS_SCRIPT_URL:
    "https://script.google.com/macros/s/AKfycbx8DbF6VRnie9hDGBTBvhaTbqxwudo69z7iYrlqkDhxqYGSBtt5DzENnt7ShOCWDYBg/exec",
  POLL_INTERVAL: 30 * 1000,
};

/* ════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════ */
let STUDENTS = [];
let ROOM_CONFIG = {};
let studentAt = {};
let roomsData = {};
let lastMatches = [];
let _studentsFingerprint = "";
let _roomsFingerprint = "";
let _pollTimer = null;
let _loadingTimers = [];
let _currentRoom = null; // tracked for resize rebuilds

/* ════════════════════════════════════════════════════════
   LOADING OVERLAY
   ════════════════════════════════════════════════════════ */
function showLoading(visible) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  if (visible) {
    overlay.style.display = "flex";
    overlay.style.opacity = "1";

    const bar = document.getElementById("loadingBar");
    const msg = document.getElementById("loadingMsg");
    const steps = [
      { pct: 15, text: "Connecting to seating data…", delay: 0 },
      { pct: 40, text: "Fetching student records…", delay: 1000 },
      { pct: 65, text: "Loading room configuration…", delay: 2200 },
      { pct: 85, text: "Building classroom map…", delay: 3600 },
      { pct: 95, text: "Almost ready…", delay: 4500 },
    ];

    if (bar) bar.style.width = "0%";
    _loadingTimers = steps.map(({ pct, text, delay }) =>
      setTimeout(() => {
        if (bar) bar.style.width = `${pct}%`;
        if (msg) msg.textContent = text;
      }, delay),
    );
  } else {
    _loadingTimers.forEach(clearTimeout);
    _loadingTimers = [];
    const bar = document.getElementById("loadingBar");
    if (bar) bar.style.width = "100%";
    setTimeout(() => {
      overlay.style.opacity = "0";
      setTimeout(() => {
        overlay.style.display = "none";
      }, 500);
    }, 300);
  }
}

/* ════════════════════════════════════════════════════════
   CACHE HELPERS
   ════════════════════════════════════════════════════════ */
const CACHE_KEY = "examSeats_v3";

function saveCache(students, rooms) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ students, rooms }));
  } catch {}
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════
   INIT — stale-while-revalidate
   ════════════════════════════════════════════════════════ */
async function init() {
  const cached = loadCache();

  if (cached) {
    STUDENTS = cached.students;
    ROOM_CONFIG = cached.rooms;
    _studentsFingerprint = JSON.stringify(STUDENTS);
    _roomsFingerprint = JSON.stringify(ROOM_CONFIG);
    buildMaps();
    buildClassroom(null);
    setLastUpdated();
    showLoading(false);
    startPolling();
  } else {
    showLoading(true);
    try {
      const { students, rooms } = await fetchAllData();
      STUDENTS = students;
      ROOM_CONFIG = rooms;
      _studentsFingerprint = JSON.stringify(STUDENTS);
      _roomsFingerprint = JSON.stringify(ROOM_CONFIG);
      saveCache(STUDENTS, ROOM_CONFIG);
      buildMaps();
      buildClassroom(null);
      setLastUpdated();
      showLoading(false);
      startPolling();
    } catch (err) {
      showLoading(false);
      showFetchError(err);
    }
  }
}

/* ════════════════════════════════════════════════════════
   POLLING
   ════════════════════════════════════════════════════════ */
function startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(silentRefresh, CONFIG.POLL_INTERVAL);
}

async function silentRefresh(forceTimestamp = false) {
  try {
    const { students, rooms } = await fetchAllData();
    const newSF = JSON.stringify(students);
    const newRF = JSON.stringify(rooms);

    if (newSF === _studentsFingerprint && newRF === _roomsFingerprint) {
      if (forceTimestamp) setLastUpdated(false);
      return;
    }

    STUDENTS = students;
    ROOM_CONFIG = rooms;
    _studentsFingerprint = newSF;
    _roomsFingerprint = newRF;
    saveCache(STUDENTS, ROOM_CONFIG);
    buildMaps();
    setLastUpdated(true);

    const currentQuery = document.getElementById("searchInput").value.trim();
    if (currentQuery) doSearch(currentQuery);
    else buildClassroom(_currentRoom);
  } catch {
    /* silent */
  }
}

function forceRefresh() {
  silentRefresh(true);
}

/* ════════════════════════════════════════════════════════
   RESIZE HANDLER
   Rebuilds grid when viewport changes (rotation, resize).
   Debounced to 250ms to avoid thrashing on drag.
   ════════════════════════════════════════════════════════ */
let _resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const query = document.getElementById("searchInput").value.trim();
    if (query) {
      // Re-run search so highlights survive the rebuild.
      doSearch(query);
    } else {
      buildClassroom(_currentRoom);
    }
  }, 250);
});

/* ════════════════════════════════════════════════════════
   LIVE SYNC INDICATOR
   ════════════════════════════════════════════════════════ */
function setLastUpdated(pulse = false) {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  el.textContent = `● Live · last synced ${time}`;
  if (pulse) flashIndicator();
}

function flashIndicator() {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

/* ════════════════════════════════════════════════════════
   FETCH
   ════════════════════════════════════════════════════════ */
async function fetchAllData() {
  const url = `${CONFIG.APPS_SCRIPT_URL}?_cb=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — Apps Script fetch failed`);
  const { students, rooms } = JSON.parse(await res.text());
  return {
    students: parseStudentsRows(students),
    rooms: parseRoomsRows(rooms),
  };
}

/* ════════════════════════════════════════════════════════
   PARSERS
   ════════════════════════════════════════════════════════ */
function normalizeRoomName(name) {
  return (name || "").trim().toLowerCase();
}

function parseStudentsRows(rows) {
  if (!rows || rows.length < 2) return [];
  return rows
    .slice(1)
    .map((cols) => {
      const name = String(cols[0] ?? "").trim();
      const row = parseInt(cols[4]);
      const col = parseInt(cols[5]);
      if (!name || isNaN(row) || isNaN(col)) return null;
      return {
        name,
        roll: String(cols[1] ?? "").trim() || "—",
        class: String(cols[2] ?? "").trim() || "—",
        room: String(cols[3] ?? "").trim() || "—",
        roomKey: normalizeRoomName(cols[3]),
        row,
        col,
      };
    })
    .filter(Boolean);
}

function parseRoomsRows(rows) {
  if (!rows || rows.length < 2) return {};
  const config = {};
  rows.slice(1).forEach((cols) => {
    const room = String(cols[0] ?? "").trim();
    const numRows = parseInt(cols[1]);
    const physCols = parseInt(cols[2]);
    const type =
      String(cols[3] ?? "")
        .trim()
        .toLowerCase() || "single";
    if (!room || isNaN(numRows) || isNaN(physCols)) return;
    const key = normalizeRoomName(room);
    config[key] = { rows: numRows, cols: physCols, type, displayName: room };
  });
  return config;
}

/* ════════════════════════════════════════════════════════
   BUILD LOOKUP MAPS
   ════════════════════════════════════════════════════════ */
function buildMaps() {
  studentAt = {};
  roomsData = {};
  STUDENTS.forEach((s) => {
    s._normalized = normalize(s.name);
    studentAt[`${s.roomKey}-${s.row}-${s.col}`] = s;
    if (!roomsData[s.roomKey]) roomsData[s.roomKey] = [];
    roomsData[s.roomKey].push(s);
  });
}

/* ════════════════════════════════════════════════════════
   CLASSROOM BUILDER
   ════════════════════════════════════════════════════════ */
let _rowScrollRAF = null;

function buildClassroom(roomName) {
  // Track current room for resize rebuilds.
  _currentRoom = roomName;

  const scrollAreaEl = document.getElementById("scrollArea");
  const gridInnerEl = document.getElementById("gridInner");
  const colHeaderRowEl = document.getElementById("colHeaderRow");
  const roomLabel = document.getElementById("roomLabel");

  if (_rowScrollRAF !== null) {
    cancelAnimationFrame(_rowScrollRAF);
    _rowScrollRAF = null;
  }

  // Reset grid
  gridInnerEl.innerHTML = "";
  scrollAreaEl.style.maxHeight = "";
  scrollAreaEl.style.overflowY = "";
  gridInnerEl.style.minWidth = "";
  gridInnerEl.style.gridTemplateColumns = "";
  gridInnerEl.style.removeProperty("--desk-h");
  gridInnerEl.classList.remove("fixed-mobile", "fixed-desktop");

  // Reset col-header-row (inner wrapper rebuilt each time in the col-head section below)
  if (colHeaderRowEl) {
    colHeaderRowEl.innerHTML = "";
  }

  const roomKey = roomName ? normalizeRoomName(roomName) : null;
  const cfg = roomKey ? ROOM_CONFIG[roomKey] || null : null;

  if (roomKey && !cfg)
    console.warn(
      `[ExamSeats] Room "${roomName}" not found in Room Config tab.`,
    );

  const isJoined = cfg ? cfg.type === "joined" : true;
  const physCols = cfg ? (isJoined ? Math.ceil(cfg.cols / 2) : cfg.cols) : 3;
  const maxRow = cfg ? cfg.rows : getMaxRow(roomKey);

  roomLabel.textContent = roomName
    ? "Room: " + (cfg?.displayName || roomName)
    : "Classroom — Top-Down View";

  /* ─────────────────────────────────────────────────────
     RESPONSIVE GRID RULES
     All fixed dimensions and the scroll threshold scale smoothly between
     their compact (≤480px) and full-desktop (≥1200px) values via a linear
     interpolation factor t — no abrupt jump as the viewport grows.
     ─ Rows > 15 → vertical scroll regardless of col count.
  ───────────────────────────────────────────────────── */
  const iW = window.innerWidth;
  const isMobile = iW <= 480; // retained only for fixed-mobile/fixed-desktop CSS class

  /* ── Smooth interpolation factor ──────────────────────────────────────────
     t = 0  at ≤480px  (compact mobile values)
     t = 1  at ≥1200px (full desktop values)
     Everything between scales linearly — no sudden dimension jump.         */
  const t = Math.max(0, Math.min(1, (iW - 480) / (1200 - 480)));

  /* ── Scroll threshold scales 6→10 seats (single) or 3→5 benches (joined) */
  const BASE_MAX_SEATS = Math.round(6 + 4 * t); // 6 at ≤480px → 10 at ≥1200px
  const MAX_VIS_COLS = isJoined
    ? Math.floor(BASE_MAX_SEATS / 2)
    : BASE_MAX_SEATS;
  const MAX_VIS_ROWS = 15;
  const needsHScroll = physCols > MAX_VIS_COLS;

  // Gap mirrors CSS clamp(0.2rem, 0.8vw, 0.4rem)
  const gapPx = Math.min(Math.max(3.2, iW * 0.008), 6.4);

  /* ── Fixed desk dimensions — interpolated smoothly with t ─────────────────
     At t=0 (≤480px): seat = 45.52 × 47.42px, compact border & no padding.
     At t=1 (≥1200px): seat = 115 × 67.62px, no border, generous padding.
     Values between scale linearly so there's no jump at any breakpoint.   */
  const FIXED_SEAT_W = 45.52 + (115 - 45.52) * t; // 45.52px → 115px
  const FIXED_DESK_H = 47.42 + (67.62 - 47.42) * t; // 47.42px → 67.62px
  const FIXED_DESK_W = isJoined ? FIXED_SEAT_W * 2 : FIXED_SEAT_W;

  // Minimum fluid desk width — per-seat baseline of 45.52px.
  // A joined bench contains two seats, so its minimum is 45.52 × 2 = 91.04px,
  // giving each seat inside the bench the same breathing room as a single desk.
  const MIN_SEAT_W = 45.52;
  const MIN_DESK_W = isJoined ? MIN_SEAT_W * 2 : MIN_SEAT_W;

  // deskMinW is needed in both the grid setup and the col-header inner below.
  const deskMinW = physCols * FIXED_DESK_W + (physCols - 1) * gapPx;

  if (needsHScroll) {
    // Fixed-size mode: lock column widths and desk height.
    gridInnerEl.style.gridTemplateColumns = `var(--rnum-w) repeat(${physCols}, ${FIXED_DESK_W}px)`;
    gridInnerEl.style.minWidth = `calc(var(--rnum-w) + ${gapPx}px + ${deskMinW}px)`;
    gridInnerEl.style.setProperty("--desk-h", `${FIXED_DESK_H}px`);
    gridInnerEl.classList.add(isMobile ? "fixed-mobile" : "fixed-desktop");
  } else {
    // Fluid mode: desks grow from MIN_DESK_W upward with available space.
    gridInnerEl.style.gridTemplateColumns = `var(--rnum-w) repeat(${physCols}, minmax(${MIN_DESK_W}px, 1fr))`;
  }

  /* ── Build col-head labels into a translateX-able inner wrapper ──
     The wrapper (.col-header-inner) is GPU-composited and translated by
     the scrollArea's scrollLeft on every scroll event, giving pixel-perfect
     alignment with the desk columns below across all browsers.              */
  if (colHeaderRowEl) {
    const inner = document.createElement("div");
    inner.className = "col-header-inner";

    // Mirror the same column widths used by the grid so headers stay aligned.
    inner.style.gridTemplateColumns = needsHScroll
      ? `repeat(${physCols}, ${FIXED_DESK_W}px)`
      : `repeat(${physCols}, minmax(${MIN_DESK_W}px, 1fr))`;
    if (needsHScroll) inner.style.minWidth = `${deskMinW}px`;

    for (let c = 1; c <= physCols; c++) {
      const head = document.createElement("div");
      head.className = "col-head";
      head.innerHTML = isJoined
        ? `<span class="ch-bench-label">Bench ${c}</span>`
        : `Col ${c}`;
      inner.appendChild(head);
    }

    colHeaderRowEl.appendChild(inner);
  }

  /* ── Desk rows ── */
  for (let r = 1; r <= maxRow; r++) {
    const rn = document.createElement("div");
    rn.className = "rnum";
    rn.textContent = `R${r}`;
    gridInnerEl.appendChild(rn);

    for (let c = 1; c <= physCols; c++) {
      let deskEl;
      if (isJoined) {
        const leftCol = 2 * c - 1;
        const rightCol = 2 * c;
        const isPhantomRight = cfg && cfg.cols % 2 !== 0 && c === physCols;
        const leftStu = roomKey
          ? studentAt[`${roomKey}-${r}-${leftCol}`] || null
          : null;
        const rightStu =
          !isPhantomRight && roomKey
            ? studentAt[`${roomKey}-${r}-${rightCol}`] || null
            : null;
        deskEl = mkJoinedDesk(
          r,
          c,
          leftStu,
          rightStu,
          leftCol,
          rightCol,
          isPhantomRight,
        );
      } else {
        const student = roomKey
          ? studentAt[`${roomKey}-${r}-${c}`] || null
          : null;
        deskEl = mkSingleDesk(r, c, student);
      }
      gridInnerEl.appendChild(deskEl);
    }
  }

  /* ─────────────────────────────────────────────────────
     VERTICAL SCROLL CAP (rows > MAX_VIS_ROWS)
     Col headers are now outside the scroll area, so we
     no longer need to add headerH to the cap.
  ───────────────────────────────────────────────────── */
  if (maxRow > MAX_VIS_ROWS) {
    if (needsHScroll) {
      // Fixed mode: height is known — compute synchronously.
      const capH = MAX_VIS_ROWS * (FIXED_DESK_H + gapPx);
      scrollAreaEl.style.maxHeight = `${capH}px`;
      scrollAreaEl.style.overflowY = "auto";
    } else {
      // Fluid mode: desk height is CSS-driven — measure via RAF.
      _rowScrollRAF = requestAnimationFrame(() => {
        _rowScrollRAF = null;
        const firstDesk = gridInnerEl.querySelector(".desk");
        if (!firstDesk) return;
        const deskH = firstDesk.offsetHeight;
        const capH = MAX_VIS_ROWS * (deskH + gapPx);
        scrollAreaEl.style.maxHeight = `${capH}px`;
        scrollAreaEl.style.overflowY = "auto";
      });
    }
  }
}

function getMaxRow(roomKey) {
  const students = roomKey ? roomsData[roomKey] || [] : [];
  return students.length
    ? students.reduce((max, s) => (s.row > max ? s.row : max), 0)
    : 8;
}

/* ── JOINED DESK ── */
function mkJoinedDesk(
  r,
  physCol,
  leftStu,
  rightStu,
  leftCol,
  rightCol,
  isPhantomRight = false,
) {
  const desk = document.createElement("div");
  desk.className = "desk desk--joined";
  desk.id = `desk-${r}-${physCol}`;
  desk.appendChild(mkSeat(r, leftCol, "left", leftStu));
  desk.appendChild(mkSeat(r, rightCol, "right", rightStu, isPhantomRight));
  return desk;
}

/* ── SINGLE DESK ── */
function mkSingleDesk(r, col, student) {
  const desk = document.createElement("div");
  desk.className = "desk desk--single";
  desk.id = `desk-${r}-${col}`;
  desk.appendChild(mkSeat(r, col, "single", student));
  return desk;
}

/* ════════════════════════════════════════════════════════
   GLOBAL SEAT TOOLTIP
   ════════════════════════════════════════════════════════ */
const _gTip = (() => {
  const t = document.createElement("div");
  t.id = "_gSeatTip";
  t.className = "g-seat-tip";
  t.setAttribute("aria-hidden", "true");
  t.style.display = "none";
  document.body.appendChild(t);
  return t;
})();

let _gTipHideTimer = null;

function _showTip(anchorEl, text) {
  if (_gTipHideTimer) {
    clearTimeout(_gTipHideTimer);
    _gTipHideTimer = null;
  }

  _gTip.textContent = text;
  _gTip.style.cssText =
    "display:block;visibility:hidden;left:-9999px;top:-9999px;";

  const tipW = _gTip.offsetWidth;
  const tipH = _gTip.offsetHeight;
  const rect = anchorEl.getBoundingClientRect();
  const margin = 6;
  let top = rect.top - tipH - margin;
  let left = rect.left + rect.width / 2 - tipW / 2;

  if (top < 4) top = rect.bottom + margin;
  left = Math.max(4, Math.min(left, window.innerWidth - tipW - 4));

  _gTip.style.cssText = `display:block;top:${top}px;left:${left}px;`;
}

function _hideTip() {
  _gTip.style.display = "none";
}

/* ── UNIFIED SEAT BUILDER ── */
function mkSeat(r, col, side, student, isPhantom = false) {
  const el = document.createElement("div");
  el.id = `seat-${r}-${col}`;
  el.className =
    side === "single"
      ? "seat seat--single"
      : `seat seat-${side}${isPhantom ? " seat--phantom" : ""}`;

  if (isPhantom) return el;

  const badge = document.createElement("div");
  badge.className = "seat-info-badge";
  badge.textContent = `R${r} · C${col}`;

  const nameEl = document.createElement("div");
  nameEl.className = "seat-name";
  nameEl.textContent = student?.name || "";

  const classEl = document.createElement("div");
  classEl.className = "seat-class";
  classEl.textContent = student?.class || "";

  el.append(badge, nameEl, classEl);

  const tipText = `R${r} · C${col}`;

  el.addEventListener("mouseenter", () => _showTip(el, tipText));
  el.addEventListener("mouseleave", _hideTip);

  let _tapTimer = null;
  el.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      el._tx = t.clientX;
      el._ty = t.clientY;
    },
    { passive: true },
  );

  el.addEventListener(
    "touchend",
    (e) => {
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - (el._tx || 0));
      const dy = Math.abs(t.clientY - (el._ty || 0));
      if (dx > 8 || dy > 8) return;
      e.preventDefault();
      if (_tapTimer) clearTimeout(_tapTimer);
      _showTip(el, tipText);
      _tapTimer = setTimeout(_hideTip, 2000);
    },
    { passive: false },
  );

  return el;
}

/* ── STICKY BLACKBOARD ── */
const stickyHeader = document.getElementById("stickyHeader");
const stickyWrapper = stickyHeader?.closest(".sticky-wrapper");
const sentinel = document.createElement("div");
sentinel.style.cssText =
  "height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;";
(stickyWrapper || stickyHeader)?.parentElement.insertBefore(
  sentinel,
  stickyWrapper || stickyHeader,
);
new IntersectionObserver(
  ([entry]) =>
    stickyWrapper?.classList.toggle("is-stuck", !entry.isIntersecting),
  { threshold: 1.0 },
).observe(sentinel);

/* ── COLUMN HEADER HORIZONTAL SCROLL SYNC ── */
document.getElementById("scrollArea").addEventListener(
  "scroll",
  function () {
    // Use translateX on the inner wrapper — works on all browsers regardless of
    // the parent's overflow:hidden, and is GPU-composited (no layout reflow).
    const inner = document.querySelector(".col-header-inner");
    if (inner) inner.style.transform = `translateX(-${this.scrollLeft}px)`;
  },
  { passive: true },
);

/* ════════════════════════════════════════════════════════
   SEARCH
   ════════════════════════════════════════════════════════ */
function sanitize(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, "");
}

const RC_STATES = ["success", "error", "multi"];

function setResultState(card, state) {
  RC_STATES.forEach((s) => card.classList.remove(s));
  if (state) card.classList.add(state);
}

function doSearch(forceName) {
  const raw = forceName ?? document.getElementById("searchInput").value.trim();
  const q = normalize(raw);
  clearHighlights();

  const resultCard = document.getElementById("resultCard");
  const resTitle = document.getElementById("resTitle");
  const resBody = document.getElementById("resBody");

  document.getElementById("btnClear").style.display = raw ? "block" : "none";
  suggestionsBox.style.display = "none";

  if (!q) {
    resultCard.style.display = "none";
    return;
  }

  const matches = STUDENTS.filter((s) => {
    const n = s._normalized;
    return n.includes(q) || q.includes(n);
  });

  resultCard.style.display = "block";
  setResultState(resultCard, null);

  if (!matches.length) {
    setResultState(resultCard, "error");
    resTitle.textContent = "Not Found";
    resBody.innerHTML = `No match for "<strong>${sanitize(raw)}</strong>". Check spelling and try again.`;
    buildClassroom(null);
    return;
  }

  if (matches.length > 1) {
    setResultState(resultCard, "multi");
    resTitle.textContent = `${matches.length} students found`;
    resBody.innerHTML = matches
      .map(
        (m, i) => `
      <div class="multi-result" onclick="selectMatch(${i})">
        <strong>${sanitize(m.name)}</strong>
        <span class="multi-class">${sanitize(m.class)}</span>
        <span class="multi-room">Room: ${sanitize(m.room)} &nbsp;|&nbsp; ${getSeatLabel(m)}</span>
      </div>`,
      )
      .join("");
    lastMatches = matches;
    buildClassroom(matches[0].room);
    matches.forEach(highlightSeat);
    return;
  }

  showResult(matches[0]);
}

function selectMatch(idx) {
  const m = lastMatches[idx];
  if (!m) return;
  // showResult already calls buildClassroom(m.room) + highlightSeat(m),
  // so we must not call buildClassroom here first (it would wipe highlights).
  showResult(m);
}

function getSeatLabel(m) {
  const cfg = ROOM_CONFIG[m.roomKey];
  if (cfg?.type === "joined") {
    const bench = Math.ceil(m.col / 2);
    const side = m.col % 2 !== 0 ? "Left" : "Right";
    return `R${m.row} · Bench ${bench} · ${side}`;
  }
  return `R${m.row} · Col ${m.col}`;
}

function showResult(m) {
  const resultCard = document.getElementById("resultCard");
  const resTitle = document.getElementById("resTitle");
  const resBody = document.getElementById("resBody");

  const cfg = ROOM_CONFIG[m.roomKey];
  const isJoined = cfg?.type === "joined";

  let seatDetail;
  if (isJoined) {
    const bench = Math.ceil(m.col / 2);
    const side = m.col % 2 !== 0 ? "Left" : "Right";
    seatDetail = `Row ${m.row} · Bench ${bench} · ${side} Seat`;
  } else {
    seatDetail = `Row ${m.row} · Col ${m.col}`;
  }

  setResultState(resultCard, "success");
  resTitle.textContent = m.name;
  resBody.innerHTML = `
    <div class="res-detail"><span>Class</span><strong>${sanitize(m.class)}</strong></div>
    <div class="res-detail"><span>Roll No.</span><strong>${sanitize(m.roll)}</strong></div>
    <div class="res-detail"><span>Room</span><strong>${sanitize(m.room)}</strong></div>
    <div class="res-detail"><span>Seat</span><strong>${seatDetail}</strong></div>
  `;

  buildClassroom(m.room);
  highlightSeat(m);
}

function highlightSeat(m) {
  const cfg = ROOM_CONFIG[m.roomKey];
  const isJoined = cfg?.type === "joined";

  const seatEl = document.getElementById(`seat-${m.row}-${m.col}`);
  const deskId = isJoined
    ? `desk-${m.row}-${Math.ceil(m.col / 2)}`
    : `desk-${m.row}-${m.col}`;
  const deskEl = document.getElementById(deskId);

  seatEl?.classList.add("lit");
  deskEl?.classList.add("glowing");

  if (seatEl)
    setTimeout(
      () =>
        seatEl.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        }),
      150,
    );
}

/* ════════════════════════════════════════════════════════
   AUTOCOMPLETE
   ════════════════════════════════════════════════════════ */
const suggestionsBox = document.getElementById("suggestions");
let activeIndex = 0;
let currentMatches = [];

function renderSuggestions() {
  suggestionsBox.innerHTML = currentMatches
    .map(
      (m, i) => `
    <div class="suggestion-item${i === activeIndex ? " active" : ""}" data-index="${i}">
      ${sanitize(m.name)}
      <div class="suggestion-roll">${sanitize(m.class)} &nbsp;|&nbsp; ${sanitize(m.room)}</div>
    </div>`,
    )
    .join("");
  suggestionsBox.style.display = currentMatches.length ? "block" : "none";
}

document.getElementById("searchInput").addEventListener("input", function () {
  const query = normalize(this.value);
  if (!query) {
    suggestionsBox.style.display = "none";
    currentMatches = [];
    activeIndex = 0;
    return;
  }
  currentMatches = STUDENTS.filter((s) => s._normalized.includes(query))
    .sort((a, b) => {
      const aS = a._normalized.startsWith(query) ? 0 : 1;
      const bS = b._normalized.startsWith(query) ? 0 : 1;
      return aS - bS;
    })
    .slice(0, 6);
  activeIndex = 0;
  renderSuggestions();
});

suggestionsBox.addEventListener("click", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (item) selectSuggestion(+item.dataset.index);
});

function selectSuggestion(idx) {
  if (!currentMatches[idx]) return;
  document.getElementById("searchInput").value = currentMatches[idx].name;
  suggestionsBox.style.display = "none";
  doSearch(currentMatches[idx].name);
}

document
  .getElementById("searchInput")
  .addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      currentMatches.length ? selectSuggestion(activeIndex) : doSearch();
      return;
    }
    if (e.key === "Escape") {
      clearSearch();
      return;
    }
    if (!currentMatches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentMatches.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex =
        (activeIndex - 1 + currentMatches.length) % currentMatches.length;
    }
    renderSuggestions();
  });

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) suggestionsBox.style.display = "none";
});

/* ════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════ */
function clearSearch() {
  document.getElementById("searchInput").value = "";
  document.getElementById("btnClear").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  suggestionsBox.style.display = "none";
  currentMatches = [];
  activeIndex = 0;
  clearHighlights();
  buildClassroom(null);
}

function clearHighlights() {
  document
    .querySelectorAll(".seat.lit")
    .forEach((el) => el.classList.remove("lit"));
  document
    .querySelectorAll(".desk.glowing")
    .forEach((el) => el.classList.remove("glowing"));
}

function showFetchError(err) {
  const resultCard = document.getElementById("resultCard");
  const resTitle = document.getElementById("resTitle");
  const resBody = document.getElementById("resBody");
  resultCard.style.display = "block";
  setResultState(resultCard, "error");
  resTitle.textContent = "Could Not Load Data";
  resBody.innerHTML = `
    Could not reach the Apps Script Web App. Check that the deployment is
    active and set to "Anyone" access.<br><br>
    <small style="opacity:0.6">${sanitize(err.message)}</small>
  `;
}

/* ── START ── */
init();
