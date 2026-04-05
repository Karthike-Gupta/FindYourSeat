/* Runs immediately (before DOM) to apply the saved theme and prevent any flash */
(function () {
  const STORAGE_KEY = "examSeats_theme";
  const root = document.documentElement;

  function getInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");

    const bbText = document.querySelector(".bb-text");
    if (bbText) {
      bbText.textContent =
        theme === "light"
          ? "✦ Whiteboard — Front of Class ✦"
          : "✦ Blackboard — Front of Class ✦";
    }
  }

  function toggleTheme() {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  applyTheme(getInitialTheme());

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

    // Sync board label after DOM loads (applyTheme ran before elements existed)
    const bbText = document.querySelector(".bb-text");
    if (bbText) {
      const isLight = root.getAttribute("data-theme") === "light";
      bbText.textContent = isLight
        ? "✦ Whiteboard — Front of Class ✦"
        : "✦ Blackboard — Front of Class ✦";
    }

    // Delegated click for multi-match result rows
    document.getElementById("resBody")?.addEventListener("click", (e) => {
      const row = e.target.closest(".multi-result[data-index]");
      if (row) selectMatch(+row.dataset.index);
    });
  });

  // Follow OS theme changes only if the user hasn't manually set one
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    if (!localStorage.getItem(STORAGE_KEY)) applyTheme(e.matches ? "light" : "dark");
  });
})();

/* ── CONFIG ── */
const CONFIG = {
  APPS_SCRIPT_URL:
    "https://script.google.com/macros/s/AKfycbx8DbF6VRnie9hDGBTBvhaTbqxwudo69z7iYrlqkDhxqYGSBtt5DzENnt7ShOCWDYBg/exec",
  POLL_INTERVAL: 25 * 1000,
};

/* ── STATE ── */
let STUDENTS = [];
let ROOM_CONFIG = {};
let studentAt = {};
let roomsData = {};
let lastMatches = [];
let _studentsFingerprint = "";
let _roomsFingerprint = "";
let _pollTimer = null;
let _loadingTimers = [];
let _currentRoom = null;

let ACCESS_STATUS = "ON";
let _litSeatObserver = null;
let _litSeatEl = null;
let _findBtn = null;
let _cachedHeaderInner = null;
let _scrollRafId = null;

/* ── LOADING OVERLAY ──
   Pass immediate=true to skip the pre-delay (used when data is ready from cache). */
function showLoading(visible, immediate = false) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  if (visible) {
    overlay.style.display = "flex";
    overlay.style.opacity = "1";

    const bar = document.getElementById("loadingBar");
    const msg = document.getElementById("loadingMsg");

    // Each step sets the bar scale (0–1) and updates the status message
    const steps = [
      { scale: 0.15, text: "Connecting to seating data…", delay: 0    },
      { scale: 0.40, text: "Fetching student records…",   delay: 1000  },
      { scale: 0.65, text: "Loading room configuration…", delay: 2200  },
      { scale: 0.85, text: "Building classroom map…",     delay: 3600  },
      { scale: 0.95, text: "Almost ready…",               delay: 4500  },
    ];

    if (bar) bar.style.transform = "scaleX(0)";
    _loadingTimers = steps.map(({ scale, text, delay }) =>
      setTimeout(() => {
        if (bar) bar.style.transform = `scaleX(${scale})`;
        if (msg) msg.textContent = text;
      }, delay)
    );
  } else {
    _loadingTimers.forEach(clearTimeout);
    _loadingTimers = [];

    const bar = document.getElementById("loadingBar");
    if (bar) bar.style.transform = "scaleX(1)";

    const hide = () => {
      overlay.style.opacity = "0";
      setTimeout(() => { overlay.style.display = "none"; }, 500);
    };

    // FIX: no artificial pre-delay when data was already cached
    immediate ? hide() : setTimeout(hide, 300);
  }
}

/* ── CACHE ── */
const CACHE_KEY = "examSeats_v3";

function saveCache(students, rooms, access) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ students, rooms, access }));
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

/* ── INIT ──
   Stale-while-revalidate: returning visitors see cached data instantly
   while fresh data loads in the background. */
async function init() {
  const cached = loadCache();

  if (cached) {
    STUDENTS = cached.students;
    ROOM_CONFIG = cached.rooms;
    ACCESS_STATUS = cached.access ?? "ON";
    _studentsFingerprint = JSON.stringify(STUDENTS);
    _roomsFingerprint = JSON.stringify(ROOM_CONFIG);
    buildMaps();
    if (ACCESS_STATUS !== "ON") {
      showAccessOff();
    } else {
      buildClassroom(null);
    }
    showLoading(false, true); // immediate — data was ready instantly from cache
    startPolling();
  } else {
    showLoading(true);
    try {
      const { students, rooms, access } = await fetchAllData();
      STUDENTS = students;
      ROOM_CONFIG = rooms;
      ACCESS_STATUS = access;
      _studentsFingerprint = JSON.stringify(STUDENTS);
      _roomsFingerprint = JSON.stringify(ROOM_CONFIG);
      saveCache(STUDENTS, ROOM_CONFIG, ACCESS_STATUS);
      buildMaps();
      if (ACCESS_STATUS !== "ON") {
        showAccessOff();
      } else {
        buildClassroom(null);
      }
      showLoading(false);
      startPolling();
    } catch (err) {
      showLoading(false);
      showFetchError(err);
    }
  }
}

/* ── POLLING ── */
function startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(silentRefresh, CONFIG.POLL_INTERVAL);
}

async function silentRefresh() {
  try {
    const { students, rooms, access } = await fetchAllData();
    const newSF = JSON.stringify(students);
    const newRF = JSON.stringify(rooms);
    const accessChanged = access !== ACCESS_STATUS;

    // Skip update if nothing changed
    if (newSF === _studentsFingerprint && newRF === _roomsFingerprint && !accessChanged) return;

    STUDENTS = students;
    ROOM_CONFIG = rooms;
    ACCESS_STATUS = access;
    _studentsFingerprint = newSF;
    _roomsFingerprint = newRF;
    saveCache(STUDENTS, ROOM_CONFIG, ACCESS_STATUS);
    buildMaps();

    if (ACCESS_STATUS !== "ON") {
      showAccessOff();
      return;
    }

    restoreAccessUI();

    const currentQuery = DOM.searchInput.value.trim();
    if (currentQuery) doSearch(currentQuery);
    else buildClassroom(_currentRoom);
  } catch {
    // Polling errors are silent — never disrupt the user
  }
}

/* ── RESIZE: debounced grid rebuild on orientation change or keyboard open/close ── */
let _resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const query = DOM.searchInput.value.trim();
    if (query) doSearch(query);
    else buildClassroom(_currentRoom);
  }, 250);
});

/* ── FETCH ── */
async function fetchAllData() {
  const url = `${CONFIG.APPS_SCRIPT_URL}?_cb=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — Apps Script fetch failed`);
  const data = JSON.parse(await res.text());

  const access =
    data.access != null
      ? String(data.access).trim().toUpperCase()
      : extractAccess(data.students);

  return {
    students: parseStudentsRows(data.students),
    rooms: parseRoomsRows(data.rooms),
    access,
  };
}

/* Scans the first 4 rows right-to-left for an ON/OFF access switch */
function extractAccess(rows) {
  if (!rows || !rows.length) return "ON";
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const row = rows[i] || [];
    for (let j = row.length - 1; j >= 0; j--) {
      const v = String(row[j] ?? "").trim().toUpperCase();
      if (v === "ON" || v === "OFF") return v;
    }
  }
  return "ON";
}

/* ── PARSERS ── */
function normalizeRoomName(name) {
  return (name || "").trim().toLowerCase();
}

/* Sheet columns: A=S.No, B=Name, C=Roll No, D=Class, E=Room, F=Col, G=Row */
function parseStudentsRows(rows) {
  if (!rows || rows.length < 2) return [];
  return rows
    .slice(1)
    .map((cols) => {
      const name = String(cols[1] ?? "").trim();
      const row = parseInt(cols[6]);
      const col = parseInt(cols[5]);
      if (!name || isNaN(row) || isNaN(col)) return null;
      return {
        name,
        roll:    String(cols[2] ?? "").trim() || "—",
        class:   String(cols[3] ?? "").trim() || "—",
        room:    String(cols[4] ?? "").trim() || "—",
        roomKey: normalizeRoomName(cols[4]),
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
    const room     = String(cols[0] ?? "").trim();
    const numRows  = parseInt(cols[1]);
    const physCols = parseInt(cols[2]);
    const type     = String(cols[3] ?? "").trim().toLowerCase() || "single";
    const address  = String(cols[4] ?? "").trim() || "Not Found";
    if (!room || isNaN(numRows) || isNaN(physCols)) return;
    config[normalizeRoomName(room)] = { rows: numRows, cols: physCols, type, displayName: room, address };
  });
  return config;
}

/* ── LOOKUP MAPS ── */
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

/* ── CLASSROOM BUILDER ── */
let _rowScrollRAF = null;

function buildClassroom(roomName) {
  _currentRoom = roomName;

  const scrollAreaEl   = document.getElementById("scrollArea");
  const gridInnerEl    = document.getElementById("gridInner");
  const colHeaderRowEl = document.getElementById("colHeaderRow");
  const roomLabel      = document.getElementById("roomLabel");

  if (_rowScrollRAF !== null) {
    cancelAnimationFrame(_rowScrollRAF);
    _rowScrollRAF = null;
  }

  // Clear previous grid
  gridInnerEl.innerHTML = "";
  scrollAreaEl.style.maxHeight = "";
  scrollAreaEl.style.overflowY = "";
  gridInnerEl.style.minWidth = "";
  gridInnerEl.style.gridTemplateColumns = "";
  gridInnerEl.style.removeProperty("--desk-h");
  gridInnerEl.classList.remove("fixed-mobile", "fixed-desktop");
  if (colHeaderRowEl) colHeaderRowEl.innerHTML = "";

  const roomKey = roomName ? normalizeRoomName(roomName) : null;
  const cfg     = roomKey ? ROOM_CONFIG[roomKey] || null : null;

  if (roomKey && !cfg) console.warn(`[ExamSeats] Room "${roomName}" not found in Room Config tab.`);

  const isJoined = cfg ? cfg.type === "joined" : true;
  const physCols = cfg ? (isJoined ? Math.ceil(cfg.cols / 2) : cfg.cols) : 3;
  const maxRow   = cfg ? cfg.rows : getMaxRow(roomKey);

  roomLabel.textContent = roomName
    ? "Room: " + (cfg?.displayName || roomName)
    : "Classroom — Top-Down View";

  // Responsive interpolation: t=0 at ≤480px, t=1 at ≥1200px
  const iW       = window.innerWidth;
  const isMobile = iW <= 480;
  const t        = Math.max(0, Math.min(1, (iW - 480) / (1200 - 480)));

  const BASE_MAX_SEATS = Math.round(6 + 4 * t);
  const MAX_VIS_COLS   = isJoined ? Math.floor(BASE_MAX_SEATS / 2) : BASE_MAX_SEATS;
  const MAX_VIS_ROWS   = 15;
  const needsHScroll   = physCols > MAX_VIS_COLS;

  const gapPx = Math.min(Math.max(3.2, iW * 0.008), 6.4);

  const FIXED_SEAT_W = 45.52 + (115   - 45.52) * t;
  const FIXED_DESK_H = 64    + (96    - 64)    * t;
  const FIXED_DESK_W = isJoined ? FIXED_SEAT_W * 2 : FIXED_SEAT_W;

  const MIN_SEAT_W = 45.52;
  const MIN_DESK_W = isJoined ? MIN_SEAT_W * 2 : MIN_SEAT_W;
  const deskMinW   = physCols * FIXED_DESK_W + (physCols - 1) * gapPx;

  if (needsHScroll) {
    gridInnerEl.style.gridTemplateColumns = `var(--rnum-w) repeat(${physCols}, ${FIXED_DESK_W}px)`;
    gridInnerEl.style.minWidth = `calc(var(--rnum-w) + ${gapPx}px + ${deskMinW}px)`;
    gridInnerEl.style.setProperty("--desk-h", `${FIXED_DESK_H}px`);
    gridInnerEl.classList.add(isMobile ? "fixed-mobile" : "fixed-desktop");
  } else {
    gridInnerEl.style.gridTemplateColumns = `var(--rnum-w) repeat(${physCols}, minmax(${MIN_DESK_W}px, 1fr))`;
  }

  // Build column headers
  if (colHeaderRowEl) {
    const inner = document.createElement("div");
    inner.className = "col-header-inner";
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
    _cachedHeaderInner = inner;
  }

  // Build desk rows
  for (let r = 1; r <= maxRow; r++) {
    const rn = document.createElement("div");
    rn.className = "rnum";
    rn.textContent = `R${r}`;
    gridInnerEl.appendChild(rn);

    for (let c = 1; c <= physCols; c++) {
      let deskEl;
      if (isJoined) {
        const leftCol        = 2 * c - 1;
        const rightCol       = 2 * c;
        const isPhantomRight = cfg && cfg.cols % 2 !== 0 && c === physCols;
        const leftStu        = roomKey ? studentAt[`${roomKey}-${r}-${leftCol}`]  || null : null;
        const rightStu       = !isPhantomRight && roomKey
          ? studentAt[`${roomKey}-${r}-${rightCol}`] || null
          : null;
        deskEl = mkJoinedDesk(r, c, leftStu, rightStu, leftCol, rightCol, isPhantomRight);
      } else {
        const student = roomKey ? studentAt[`${roomKey}-${r}-${c}`] || null : null;
        deskEl = mkSingleDesk(r, c, student);
      }
      gridInnerEl.appendChild(deskEl);
    }
  }

  // Cap visible height when rows exceed MAX_VIS_ROWS
  if (maxRow > MAX_VIS_ROWS) {
    if (needsHScroll) {
      const capH = MAX_VIS_ROWS * (FIXED_DESK_H + gapPx);
      scrollAreaEl.style.maxHeight = `${capH}px`;
      scrollAreaEl.style.overflowY = "auto";
    } else {
      // Fluid mode: desk height is CSS-driven, so measure it after paint
      _rowScrollRAF = requestAnimationFrame(() => {
        _rowScrollRAF = null;
        const firstDesk = gridInnerEl.querySelector(".desk");
        if (!firstDesk) return;
        const capH = MAX_VIS_ROWS * (firstDesk.offsetHeight + gapPx);
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

/* ── DESK BUILDERS ── */
function mkJoinedDesk(r, physCol, leftStu, rightStu, leftCol, rightCol, isPhantomRight = false) {
  const desk = document.createElement("div");
  desk.className = "desk desk--joined";
  desk.id = `desk-${r}-${physCol}`;
  desk.appendChild(mkSeat(r, leftCol,  "left",  leftStu));
  desk.appendChild(mkSeat(r, rightCol, "right", rightStu, isPhantomRight));
  return desk;
}

function mkSingleDesk(r, col, student) {
  const desk = document.createElement("div");
  desk.className = "desk desk--single";
  desk.id = `desk-${r}-${col}`;
  desk.appendChild(mkSeat(r, col, "single", student));
  return desk;
}

function mkSeat(r, col, side, student, isPhantom = false) {
  const el = document.createElement("div");
  el.id = `seat-${r}-${col}`;
  el.className = side === "single"
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
  el.dataset.tip = `R${r} · C${col}`;
  return el;
}

/* ── STICKY BLACKBOARD: adds shadow when it sticks to the top of the viewport ── */
const stickyHeader  = document.getElementById("stickyHeader");
const stickyWrapper = stickyHeader?.closest(".sticky-wrapper");
const sentinel = document.createElement("div");
sentinel.style.cssText = "height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;";
(stickyWrapper || stickyHeader)?.parentElement.insertBefore(sentinel, stickyWrapper || stickyHeader);
new IntersectionObserver(
  ([entry]) => stickyWrapper?.classList.toggle("is-stuck", !entry.isIntersecting),
  { threshold: 1.0, rootMargin: "-2px 0px 0px 0px" }
).observe(sentinel);

/* ── COLUMN HEADER SCROLL SYNC: mirrors scrollLeft via rAF (GPU-composited) ── */
document.getElementById("scrollArea").addEventListener(
  "scroll",
  function () {
    _hideTip();
    if (_scrollRafId) return;
    const sl = this.scrollLeft;
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = null;
      if (_cachedHeaderInner) _cachedHeaderInner.style.transform = `translateX(-${sl}px)`;
    });
  },
  { passive: true }
);

window.addEventListener("scroll", _hideTip, { passive: true });

/* ── GLOBAL SEAT TOOLTIP ── */
const TOOLTIP_TAP_MS = 1500;

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

/*
  FIX: Cache tooltip widths by label text so we only force a layout reflow
  once per unique label, not on every tap.
*/
const _tipWidthCache = new Map();

function _showTip(anchorEl, text) {
  if (anchorEl.classList.contains("lit")) return;
  if (_gTipHideTimer) { clearTimeout(_gTipHideTimer); _gTipHideTimer = null; }

  _gTip.textContent = text;

  // Measure width only the first time we see this label
  if (!_tipWidthCache.has(text)) {
    _gTip.style.cssText = "display:flex;visibility:hidden;left:-9999px;top:-9999px;";
    _tipWidthCache.set(text, _gTip.offsetWidth);
  }

  const tipW = _tipWidthCache.get(text);
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipW - 4));

  _gTip.style.cssText = `display:flex;top:${rect.top}px;left:${left}px;`;
}

function _hideTip() {
  _gTip.style.display = "none";
}

/* Delegated tooltip listeners — single handler instead of per-seat closures */
const _scrollAreaEl = document.getElementById("scrollArea");

_scrollAreaEl.addEventListener("click", (e) => {
  const seat = e.target.closest(".seat:not(.seat--phantom)");
  if (!seat || !seat.dataset.tip) return;
  _showTip(seat, seat.dataset.tip);
  if (_gTipHideTimer) clearTimeout(_gTipHideTimer);
  _gTipHideTimer = setTimeout(_hideTip, TOOLTIP_TAP_MS);
});

// Record touch start position to distinguish taps from scrolls
_scrollAreaEl.addEventListener("touchstart", (e) => {
  const seat = e.target.closest(".seat:not(.seat--phantom)");
  if (!seat) return;
  const t = e.changedTouches[0];
  seat.dataset.tx = t.clientX;
  seat.dataset.ty = t.clientY;
}, { passive: true });

_scrollAreaEl.addEventListener("touchend", (e) => {
  const seat = e.target.closest(".seat:not(.seat--phantom)");
  if (!seat || !seat.dataset.tip) return;
  const t  = e.changedTouches[0];
  const dx = Math.abs(t.clientX - +(seat.dataset.tx || 0));
  const dy = Math.abs(t.clientY - +(seat.dataset.ty || 0));
  if (dx > 8 || dy > 8) return; // not a tap — let scroll proceed normally
  e.preventDefault();
  _showTip(seat, seat.dataset.tip);
  if (_gTipHideTimer) clearTimeout(_gTipHideTimer);
  _gTipHideTimer = setTimeout(_hideTip, TOOLTIP_TAP_MS);
}, { passive: false });

/* ── SEARCH ── */

/* DOM references cached once at startup */
const DOM = {
  searchInput: document.getElementById("searchInput"),
  resultCard:  document.getElementById("resultCard"),
  resTitle:    document.getElementById("resTitle"),
  resBody:     document.getElementById("resBody"),
  btnClear:    document.getElementById("btnClear"),
};

let lastShownRoll     = null;  // prevents re-rendering the same student card
let lastSearchedQuery = "";    // prevents re-running the same search on resize
let isEditingSearch   = false; // true while the user has focus in the search bar

/* Single-pass HTML sanitizer */
const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function sanitize(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, "");
}

const RC_STATES = ["success", "error", "multi"];

function setResultState(card, state) {
  card.classList.remove(...RC_STATES);
  if (state) card.classList.add(state);
}

function doSearch(forceName) {
  const raw = forceName ?? DOM.searchInput.value.trim();
  const q   = normalize(raw);

  // Skip if the same query is already displayed (prevents spurious re-renders on resize)
  if (q === lastSearchedQuery && !forceName) return;
  lastSearchedQuery = q;

  lastShownRoll = null;
  clearHighlights();

  DOM.btnClear.style.display   = raw ? "block" : "none";
  suggestionsBox.style.display = "none";

  if (!q) {
    DOM.resultCard.style.display = "none";
    lastSearchedQuery = "";
    return;
  }

  const matches = STUDENTS.filter((s) => s._normalized.includes(q));

  DOM.resultCard.style.display = "block";
  setResultState(DOM.resultCard, null);

  if (!matches.length) {
    setResultState(DOM.resultCard, "error");
    DOM.resTitle.textContent = "Not Found";
    DOM.resBody.innerHTML    = `No match for "<strong>${sanitize(raw)}</strong>". Check spelling and try again.`;
    buildClassroom(null);
    return;
  }

  if (matches.length > 1) {
    setResultState(DOM.resultCard, "multi");
    DOM.resTitle.textContent = `${matches.length} students found`;
    DOM.resBody.innerHTML    = matches
      .map(
        (m, i) => `
      <div class="multi-result" data-index="${i}">
        <strong>${sanitize(m.name)}</strong>
        <span class="multi-class">${sanitize(m.class)}</span>
        <span class="multi-room">Room: ${sanitize(m.room)} &nbsp;|&nbsp; ${getSeatDetail(m)}</span>
      </div>`
      )
      .join("");
    lastMatches   = matches;
    lastShownRoll = null;
    buildClassroom(matches[0].room);
    matches.forEach(highlightSeat);
    return;
  }

  showResult(matches[0]);
}

function selectMatch(idx) {
  const m = lastMatches[idx];
  if (m) showResult(m);
}

/* Returns a human-readable seat label.
   verbose=true  → "Row 2 · Bench 3 · Left Seat"
   verbose=false → "R2 · Bench 3 · Left" */
function getSeatDetail(m, verbose = false) {
  const cfg = ROOM_CONFIG[m.roomKey];
  if (cfg?.type === "joined") {
    const bench = Math.ceil(m.col / 2);
    const side  = m.col % 2 !== 0 ? "Left" : "Right";
    return verbose
      ? `Row ${m.row} · Bench ${bench} · ${side} Seat`
      : `R${m.row} · Bench ${bench} · ${side}`;
  }
  return verbose ? `Row ${m.row} · Col ${m.col}` : `R${m.row} · Col ${m.col}`;
}

function getSeatLabel(m) { return getSeatDetail(m, false); }

function showResult(m) {
  if (m.roll === lastShownRoll) return;
  lastShownRoll = m.roll;

  const cfg     = ROOM_CONFIG[m.roomKey];
  const address = cfg?.address || "Not Found";

  setResultState(DOM.resultCard, "success");

  DOM.resTitle.innerHTML = `
    <div class="res-name-class-header">
      <span class="res-name">${sanitize(m.name)}</span>
      <span class="res-class-tag">${sanitize(m.class)}</span>
    </div>`;

  DOM.resBody.innerHTML = `
    <div class="res-detail"><span>Roll No.</span><strong>${sanitize(m.roll)}</strong></div>
    <div class="res-detail"><span>Seat</span><strong>${getSeatDetail(m, true)}</strong></div>
    <div class="res-detail"><span>Room</span><strong>${sanitize(m.room)}</strong></div>
    <div class="res-detail"><span>Address</span><strong>${sanitize(address)}</strong></div>
  `;

  buildClassroom(m.room);
  highlightSeat(m);
}

function highlightSeat(m) {
  const cfg      = ROOM_CONFIG[m.roomKey];
  const isJoined = cfg?.type === "joined";

  const seatEl = document.getElementById(`seat-${m.row}-${m.col}`);
  const deskId = isJoined ? `desk-${m.row}-${Math.ceil(m.col / 2)}` : `desk-${m.row}-${m.col}`;
  const deskEl = document.getElementById(deskId);

  seatEl?.classList.add("lit");
  deskEl?.classList.add("glowing");

  if (seatEl) {
    // Guard: don't scroll while the user is typing — the mobile keyboard
    // triggers a resize which would yank the page away from the input.
    if (!isEditingSearch) {
      setTimeout(
        () => seatEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }),
        150
      );
    }
    setupSeatObserver(seatEl);
  }
}

/* ── FLOAT BUTTON ("📍 My Seat") ── */
function _initFindBtn() {
  if (_findBtn) return;
  _findBtn = document.getElementById("findMySeat");
  if (!_findBtn) return;
  _findBtn.addEventListener("click", () => {
    _litSeatEl?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  });
}

/* Shows the float button when the highlighted seat scrolls out of view */
function setupSeatObserver(seatEl) {
  _initFindBtn();
  if (_litSeatObserver) { _litSeatObserver.disconnect(); _litSeatObserver = null; }
  if (!seatEl || !_findBtn) return;
  _litSeatEl = seatEl;
  _litSeatObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        if (_findBtn.classList.contains("visible")) {
          _findBtn.classList.add("hiding");
          _findBtn.classList.remove("visible");
          _findBtn.addEventListener("animationend", () => _findBtn.classList.remove("hiding"), { once: true });
        }
      } else {
        _findBtn.classList.remove("hiding");
        _findBtn.classList.add("visible");
      }
    },
    { threshold: 0.5 }
  );
  _litSeatObserver.observe(seatEl);
}

function hideFindBtn() {
  _initFindBtn();
  if (_litSeatObserver) { _litSeatObserver.disconnect(); _litSeatObserver = null; }
  _litSeatEl = null;
  if (_findBtn) _findBtn.classList.remove("visible");
}

/* ── AUTOCOMPLETE ── */
const suggestionsBox = document.getElementById("suggestions");
let activeIndex    = 0;
let currentMatches = [];

function renderSuggestions() {
  suggestionsBox.innerHTML = currentMatches
    .map(
      (m, i) => `
    <div class="suggestion-item${i === activeIndex ? " active" : ""}" data-index="${i}">
      ${sanitize(m.name)}
      <div class="suggestion-roll">${sanitize(m.class)}</div>
    </div>`
    )
    .join("");
  suggestionsBox.style.display = currentMatches.length ? "block" : "none";
}

DOM.searchInput.addEventListener("input", function () {
  const query = normalize(this.value);

  DOM.btnClear.style.display = this.value ? "block" : "none";
  if (!this.value) lastSearchedQuery = "";

  if (!query) {
    suggestionsBox.style.display = "none";
    currentMatches = [];
    activeIndex    = 0;
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
  DOM.searchInput.value = currentMatches[idx].name;
  suggestionsBox.style.display = "none";
  doSearch(currentMatches[idx].name);
}

DOM.searchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    this.blur(); // blur before doSearch so isEditingSearch=false when scroll runs
    currentMatches.length ? selectSuggestion(activeIndex) : doSearch();
    return;
  }
  if (e.key === "Escape") { clearSearch(); return; }
  if (!currentMatches.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % currentMatches.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
  }
  renderSuggestions();
});

DOM.searchInput.addEventListener("focus", () => { isEditingSearch = true; });
DOM.searchInput.addEventListener("blur",  () => { isEditingSearch = false; });

// Close suggestions when clicking anywhere outside the search area
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) suggestionsBox.style.display = "none";
});

/* ── HELPERS ── */
function clearSearch() {
  DOM.searchInput.value            = "";
  DOM.btnClear.style.display       = "none";
  DOM.resultCard.style.display     = "none";
  suggestionsBox.style.display     = "none";
  currentMatches    = [];
  activeIndex       = 0;
  lastSearchedQuery = "";
  lastShownRoll     = null;
  clearHighlights();
  buildClassroom(null);
}

DOM.btnClear.addEventListener("click", clearSearch);

function clearHighlights() {
  document.querySelectorAll(".seat.lit").forEach((el) => el.classList.remove("lit"));
  document.querySelectorAll(".desk.glowing").forEach((el) => el.classList.remove("glowing"));
  hideFindBtn();
}

function showFetchError(err) {
  DOM.resultCard.style.display = "block";
  setResultState(DOM.resultCard, "error");
  DOM.resTitle.textContent = "Connection Error";
  DOM.resBody.innerHTML = `Could not load seating data. Please check your connection and refresh.<br>
    <small style="opacity:0.6">${sanitize(String(err))}</small>`;
}

function showAccessOff() {
  DOM.searchInput.disabled     = true;
  DOM.searchInput.placeholder  = "Seating is currently unavailable…";
  DOM.btnClear.style.display   = "none";

  DOM.resultCard.style.display = "block";
  setResultState(DOM.resultCard, "error");
  DOM.resTitle.innerHTML = "🔒 Access Unavailable";
  DOM.resBody.innerHTML  = `
    The institution has not yet released the seating data for this session.<br>
    <small style="opacity:0.65">Please check back later or contact your exam coordinator.</small>
  `;

  const cc = document.querySelector(".classroom-card");
  if (cc) cc.style.display = "none";

  const sb = document.getElementById("suggestions");
  if (sb) sb.style.display = "none";
}

function restoreAccessUI() {
  DOM.searchInput.disabled    = false;
  DOM.searchInput.placeholder = "Enter your name…";

  const cc = document.querySelector(".classroom-card");
  if (cc) cc.style.display = "";

  DOM.resultCard.style.display = "none";
  setResultState(DOM.resultCard, null);

  buildClassroom(null);
}

/* ── START ── */
init();
