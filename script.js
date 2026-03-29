/* ════════════════════════════════════════════════════════
   THEME  —  runs first, before any render, to prevent
   a flash of the wrong theme on page load
   ════════════════════════════════════════════════════════ */
(function () {
  const STORAGE_KEY = "examSeats_theme";
  const root        = document.documentElement;
  const btn         = document.getElementById("themeToggle");

  function getInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else                   root.removeAttribute("data-theme");
  }

  function toggleTheme() {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  applyTheme(getInitialTheme());

  /* Wire up button once DOM is ready */
  if (btn) {
    btn.addEventListener("click", toggleTheme);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
    });
  }

  /* Follow OS changes only when user has no saved preference */
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", e => {
    if (!localStorage.getItem(STORAGE_KEY)) applyTheme(e.matches ? "light" : "dark");
  });
})();

const CONFIG = {
  STUDENTS_URL : "https://docs.google.com/spreadsheets/d/e/2PACX-1vSEmSlLeZ0Nx5OhKUgC7PRU8X8tQTVoy_tJOZWRT9iNThaATGBFLJRJQ5KWMvvIo2PnPv9BhAy4hRVr/pub?gid=0&single=true&output=csv",
  ROOMS_URL    : "https://docs.google.com/spreadsheets/d/e/2PACX-1vSEmSlLeZ0Nx5OhKUgC7PRU8X8tQTVoy_tJOZWRT9iNThaATGBFLJRJQ5KWMvvIo2PnPv9BhAy4hRVr/pub?gid=587289350&single=true&output=csv",
};

/* ── CACHE ── */
const CACHE_KEY_STUDENTS = "examSeats_students_v2";
const CACHE_KEY_ROOMS    = "examSeats_rooms_v2";
const CACHE_TTL          = 2 * 60 * 1000; // ✅ FIX: reduced from 10 min → 2 min

/* ── STATE ── */
let STUDENTS    = [];
let ROOM_CONFIG = {}; // { "Room 1": { rows, cols, type } }
let studentAt   = {}; // "room-row-col" → student object
let roomsData   = {}; // room → [students]
let lastMatches = [];

/* ════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════ */
async function init() {
  showLoading(true);
  try {
    const cachedStudents = tryCache(CACHE_KEY_STUDENTS);
    const cachedRooms    = tryCache(CACHE_KEY_ROOMS);

    if (cachedStudents && cachedRooms) {
      STUDENTS    = cachedStudents;
      ROOM_CONFIG = cachedRooms;
    } else {
      const [students, rooms] = await Promise.all([
        fetchStudents(),
        fetchRoomConfig(),
      ]);
      STUDENTS    = students;
      ROOM_CONFIG = rooms;
      setCache(CACHE_KEY_STUDENTS, STUDENTS);
      setCache(CACHE_KEY_ROOMS,    ROOM_CONFIG);
    }

    buildMaps();
    buildClassroom(null);
    showLoading(false);

/* ✅ NEW: show last-updated timestamp */
  } catch (err) {
    showLoading(false);
    showFetchError(err);
  }
}

/* ── CACHE HELPERS ── */
function tryCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    return Date.now() - timestamp < CACHE_TTL ? data : null;
  } catch { return null; }
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
}

/* Force-refresh: wipes cache and reloads */
function forceRefresh() {
  localStorage.removeItem(CACHE_KEY_STUDENTS);
  localStorage.removeItem(CACHE_KEY_ROOMS);
  location.reload();
}



/* ════════════════════════════════════════════════════════
   FETCH
   ════════════════════════════════════════════════════════ */

/* ✅ FIX: Add cache-busting timestamp to URL + set fetch cache to 'no-store'
   This bypasses BOTH the browser HTTP cache and any CDN cache so edits
   to the Google Sheet always reach the client after the localStorage TTL. */
function bustUrl(url) {
  return `${url}&_cb=${Date.now()}`;
}

async function fetchStudents() {
  const res = await fetch(bustUrl(CONFIG.STUDENTS_URL), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch student data (Tab 1)`);
  return parseStudentsCSV(await res.text());
}

async function fetchRoomConfig() {
  const res = await fetch(bustUrl(CONFIG.ROOMS_URL), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch room config (Tab 2)`);
  return parseRoomsCSV(await res.text());
}

/* ════════════════════════════════════════════════════════
   PARSERS
   ════════════════════════════════════════════════════════ */

/* ✅ FIX: normalizeRoomName — trims whitespace and lowercases for comparison.
   Prevents mismatches when college types "Room 1 " vs "Room 1", or uses
   different capitalisation across the two tabs. */
function normalizeRoomName(name) {
  return (name || "").trim().toLowerCase();
}

function parseStudentsCSV(csv) {
  // ✅ FIX: use /\r?\n/ to handle Windows-style \r\n line endings from Google Sheets
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const name = cols[0]?.trim();
    const row  = parseInt(cols[4]);
    const col  = parseInt(cols[5]);
    if (!name || isNaN(row) || isNaN(col)) return null;
    return {
      name,
      roll      : cols[1]?.trim() || "—",
      class     : cols[2]?.trim() || "—",
      room      : cols[3]?.trim() || "—",        // original casing for display
      roomKey   : normalizeRoomName(cols[3]),     // ✅ normalised key for lookups
      row,
      col,
    };
  }).filter(Boolean);
}

function parseRoomsCSV(csv) {
  // ✅ FIX: use /\r?\n/ to handle Windows-style \r\n line endings
  const lines  = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const config = {};
  lines.slice(1).forEach(line => {
    const cols     = splitCSVLine(line);
    const room     = cols[0]?.trim();
    const rows     = parseInt(cols[1]);
    const physCols = parseInt(cols[2]);
    const type     = cols[3]?.trim().toLowerCase() || "single";
    if (!room || isNaN(rows) || isNaN(physCols)) return;
    // ✅ FIX: store under normalised key so student-room lookups always match
    const key = normalizeRoomName(room);
    config[key] = { rows, cols: physCols, type, displayName: room };
  });
  return config;
}

function splitCSVLine(line) {
  const result = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/* ── BUILD LOOKUP MAPS ── */
function buildMaps() {
  studentAt = {};
  roomsData = {};
  STUDENTS.forEach(s => {
    // ✅ FIX: use normalised roomKey for map keys
    studentAt[`${s.roomKey}-${s.row}-${s.col}`] = s;
    if (!roomsData[s.roomKey]) roomsData[s.roomKey] = [];
    roomsData[s.roomKey].push(s);
  });
}

/* ════════════════════════════════════════════════════════
   CLASSROOM BUILDER
   ════════════════════════════════════════════════════════ */
function buildClassroom(roomName) {
  const rowNumsEl  = document.getElementById("rowNums");
  const deskRowsEl = document.getElementById("deskRows");
  const colHeadsEl = document.getElementById("colHeads");
  const roomLabel  = document.getElementById("roomLabel");

  rowNumsEl.innerHTML  = "";
  deskRowsEl.innerHTML = "";
  colHeadsEl.innerHTML = "";

  /* ✅ FIX: use normalised key for all ROOM_CONFIG lookups */
  const roomKey  = roomName ? normalizeRoomName(roomName) : null;
  const cfg      = roomKey ? (ROOM_CONFIG[roomKey] || null) : null;

  // ✅ FIX: warn in console if room name exists in students but not in ROOM_CONFIG
  if (roomKey && !cfg) {
    console.warn(`[ExamSeats] Room "${roomName}" not found in Room Config tab. ` +
      `Check that Tab 2 contains a row for this room (case-insensitive).`);
  }

  const isJoined = cfg ? cfg.type === "joined" : true;  // default preview: joined
  // ✅ FIX: cfg.cols always means "seat columns" in the sheet.
  //   • single → 1 desk per seat column  → physCols = cfg.cols  (e.g. 4 cols = 4 desks)
  //   • joined → 2 seats share one bench → physCols = cfg.cols / 2  (e.g. 4 cols = 2 benches)
  const physCols = cfg
    ? (isJoined ? Math.ceil(cfg.cols / 2) : cfg.cols)
    : 3;
  const maxRow   = cfg ? cfg.rows : getMaxRow(roomKey);

  // ✅ Use displayName from config, fallback to the passed roomName
  const displayName = cfg?.displayName || roomName;
  roomLabel.textContent = roomName ? `Room: ${displayName}` : "Classroom — Top-Down View";

  /* ── Col headers ── */
  colHeadsEl.style.gridTemplateColumns = `repeat(${physCols}, 1fr)`;
  for (let c = 1; c <= physCols; c++) {
    const head = document.createElement("div");
    head.className = "col-head";
    if (isJoined) {
      head.innerHTML = `<span class="ch-bench-label">Bench ${c}</span>`;
    } else {
      const arrow = c === 1 ? "← " : c === physCols ? "" : "";
      const trailArrow = c === physCols ? " →" : "";
      head.textContent = `${arrow}Col ${c}${trailArrow}`;
    }
    colHeadsEl.appendChild(head);
  }

  /* ── Desk rows ── */
  for (let r = 1; r <= maxRow; r++) {
    /* Row number label */
    const rn = document.createElement("div");
    rn.className   = "rnum";
    rn.textContent = `R${r}`;
    rowNumsEl.appendChild(rn);

    /* Desk row container */
    const rowDiv = document.createElement("div");
    rowDiv.className = "desk-row";
    rowDiv.style.gridTemplateColumns = `repeat(${physCols}, 1fr)`;

    for (let c = 1; c <= physCols; c++) {
      let deskEl;
      if (isJoined) {
        const leftCol  = 2 * c - 1;
        const rightCol = 2 * c;
        // ✅ FIX: if cfg.cols is odd and this is the last bench,
        //   rightCol exceeds the declared seat columns → phantom (empty) seat
        const isPhantomRight = cfg && (cfg.cols % 2 !== 0) && (c === physCols);
        const leftStu  = roomKey ? (studentAt[`${roomKey}-${r}-${leftCol}`]  || null) : null;
        const rightStu = (!isPhantomRight && roomKey)
          ? (studentAt[`${roomKey}-${r}-${rightCol}`] || null)
          : null;
        deskEl = mkJoinedDesk(r, c, leftStu, rightStu, leftCol, rightCol, isPhantomRight);
      } else {
        // ✅ FIX: use normalised roomKey for studentAt lookups
        const student = roomKey ? (studentAt[`${roomKey}-${r}-${c}`] || null) : null;
        deskEl = mkSingleDesk(r, c, student);
      }
      rowDiv.appendChild(deskEl);
    }
    deskRowsEl.appendChild(rowDiv);
  }
}

function getMaxRow(roomKey) {
  // ✅ FIX: parameter is now roomKey (normalised), consistent with buildMaps
  const students = roomKey ? (roomsData[roomKey] || []) : [];
  return students.length
    ? students.reduce((max, s) => s.row > max ? s.row : max, 0)
    : 8;
}

/* ── JOINED DESK — two seats on one bench ── */
function mkJoinedDesk(r, physCol, leftStu, rightStu, leftCol, rightCol, isPhantomRight = false) {
  const desk = document.createElement("div");
  desk.className = "desk desk--joined";
  desk.id        = `desk-${r}-${physCol}`;
  desk.appendChild(mkSeat(r, leftCol,  "left",  leftStu, false));
  // ✅ phantom right seat: renders as a clearly empty/unavailable slot
  desk.appendChild(mkSeat(r, rightCol, "right", rightStu, isPhantomRight));
  return desk;
}

/* ── SINGLE DESK — one standalone seat ── */
function mkSingleDesk(r, col, student) {
  const desk = document.createElement("div");
  desk.className = "desk desk--single";
  desk.id        = `desk-${r}-${col}`;
  desk.appendChild(mkSeatSingle(r, col, student));
  return desk;
}

/* ── SEAT for JOINED desk ── */
function mkSeat(r, col, side, student, isPhantom = false) {
  const el = document.createElement("div");
  // ✅ phantom seat gets its own class so CSS can grey it out
  el.className = `seat seat-${side}${isPhantom ? " seat--phantom" : ""}`;
  el.id        = `seat-${r}-${col}`;

  if (isPhantom) {
    // Fully hidden — CSS visibility:hidden keeps the bench width intact
    return el;
  }

  const badge = document.createElement("div");
  badge.className   = "seat-info-badge";
  badge.textContent = `R${r} · C${col}`;

  const nameEl = document.createElement("div");
  nameEl.className   = "seat-name";
  nameEl.textContent = student ? student.name : "";

  const classEl = document.createElement("div");
  classEl.className   = "seat-class";
  classEl.textContent = student ? student.class : "";

  el.appendChild(badge);
  el.appendChild(nameEl);
  el.appendChild(classEl);
  return el;
}

/* ── SEAT for SINGLE desk ── */
function mkSeatSingle(r, col, student) {
  const el = document.createElement("div");
  el.className = "seat seat--single";
  el.id        = `seat-${r}-${col}`;

  const badge = document.createElement("div");
  badge.className   = "seat-info-badge";
  badge.textContent = `R${r} · C${col}`;

  const nameEl = document.createElement("div");
  nameEl.className   = "seat-name";
  nameEl.textContent = student ? student.name : "";

  const classEl = document.createElement("div");
  classEl.className   = "seat-class";
  classEl.textContent = student ? student.class : "";

  el.appendChild(badge);
  el.appendChild(nameEl);
  el.appendChild(classEl);
  return el;
}

/* ── STICKY HEADER ── */
const stickyHeader = document.getElementById("stickyHeader");
const sentinel     = document.createElement("div");
sentinel.style.cssText = "height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;";
stickyHeader.parentElement.insertBefore(sentinel, stickyHeader);
new IntersectionObserver(
  ([entry]) => stickyHeader.classList.toggle("is-stuck", !entry.isIntersecting),
  { threshold: 1.0 }
).observe(sentinel);

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

function doSearch(forceName) {
  const raw = forceName ?? document.getElementById("searchInput").value.trim();
  const q   = normalize(raw);
  clearHighlights();

  const resultCard = document.getElementById("resultCard");
  const resTitle   = document.getElementById("resTitle");
  const resBody    = document.getElementById("resBody");

  document.getElementById("btnClear").style.display = raw ? "block" : "none";
  suggestionsBox.style.display = "none";

  if (!q) { resultCard.style.display = "none"; return; }

  const matches = STUDENTS.filter(stu => {
    const n = normalize(stu.name);
    return n.includes(q) || q.includes(n);
  });

  resultCard.style.display = "block";
  resultCard.className     = "";

  if (!matches.length) {
    resultCard.className = "error";
    resTitle.textContent = "Not Found";
    resBody.innerHTML    = `No match for "<strong>${sanitize(raw)}</strong>". Check spelling and try again.`;
    return;
  }

  if (matches.length > 1) {
    resultCard.className = "multi";
    resTitle.textContent = `${matches.length} students found`;
    resBody.innerHTML    = matches.map((m, i) => {
      const label = getSeatLabel(m);
      return `
        <div class="multi-result" onclick="selectMatch(${i})">
          <strong>${sanitize(m.name)}</strong>
          <span class="multi-class">${sanitize(m.class)}</span>
          <span class="multi-room">Room: ${sanitize(m.room)} &nbsp;|&nbsp; ${label}</span>
        </div>`;
    }).join("");
    lastMatches = matches;
    matches.forEach(m => highlightSeat(m));
    buildClassroom(matches[0].room);
    return;
  }

  showResult(matches[0]);
}

function selectMatch(idx) {
  const m = lastMatches[idx];
  if (!m) return;
  clearHighlights();
  buildClassroom(m.room);
  showResult(m);
}

/* Human-readable seat label — knows joined vs single */
function getSeatLabel(m) {
  // ✅ FIX: use normalised roomKey for ROOM_CONFIG lookup
  const cfg = ROOM_CONFIG[m.roomKey];
  if (cfg?.type === "joined") {
    const bench = Math.ceil(m.col / 2);
    const side  = m.col % 2 !== 0 ? "Left" : "Right";
    return `R${m.row} · Bench ${bench} · ${side}`;
  }
  return `R${m.row} · Col ${m.col}`;
}

function showResult(m) {
  const resultCard = document.getElementById("resultCard");
  const resTitle   = document.getElementById("resTitle");
  const resBody    = document.getElementById("resBody");

  // ✅ FIX: use normalised roomKey for ROOM_CONFIG lookup
  const cfg      = ROOM_CONFIG[m.roomKey];
  const isJoined = cfg?.type === "joined";

  let seatDetail;
  if (isJoined) {
    const bench = Math.ceil(m.col / 2);
    const side  = m.col % 2 !== 0 ? "Left" : "Right";
    seatDetail = `Row ${m.row} · Bench ${bench} · ${side} Seat`;
  } else {
    seatDetail = `Row ${m.row} · Col ${m.col}`;
  }

  resultCard.className = "success";
  resTitle.textContent = m.name;
  resBody.innerHTML    = `
    <div class="res-detail">
      <span>Class</span><strong>${sanitize(m.class)}</strong>
    </div>
    <div class="res-detail">
      <span>Roll No.</span><strong>${sanitize(m.roll)}</strong>
    </div>
    <div class="res-detail">
      <span>Room</span><strong>${sanitize(m.room)}</strong>
    </div>
    <div class="res-detail">
      <span>Seat</span><strong>${seatDetail}</strong>
    </div>
  `;

  buildClassroom(m.room);
  highlightSeat(m);
}

function highlightSeat(m) {
  // ✅ FIX: use normalised roomKey for ROOM_CONFIG lookup
  const cfg      = ROOM_CONFIG[m.roomKey];
  const isJoined = cfg?.type === "joined";

  /* Seat element is always keyed by actual column number */
  const seatEl = document.getElementById(`seat-${m.row}-${m.col}`);

  /* Desk element: joined → physical bench index, single → col */
  const deskId = isJoined
    ? `desk-${m.row}-${Math.ceil(m.col / 2)}`
    : `desk-${m.row}-${m.col}`;
  const deskEl = document.getElementById(deskId);

  seatEl?.classList.add("lit");
  deskEl?.classList.add("glowing");

  if (seatEl)
    setTimeout(() => seatEl.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
}

/* ════════════════════════════════════════════════════════
   AUTOCOMPLETE
   ════════════════════════════════════════════════════════ */
const suggestionsBox = document.getElementById("suggestions");
let activeIndex    = 0;
let currentMatches = [];

function renderSuggestions() {
  suggestionsBox.innerHTML = currentMatches.map((m, i) => `
    <div class="suggestion-item${i === activeIndex ? " active" : ""}" data-index="${i}">
      ${sanitize(m.name)}
      <div class="suggestion-roll">${sanitize(m.class)} &nbsp;|&nbsp; ${sanitize(m.room)}</div>
    </div>`
  ).join("");
  suggestionsBox.style.display = currentMatches.length ? "block" : "none";
}

document.getElementById("searchInput").addEventListener("input", function () {
  const query = normalize(this.value);
  if (!query) {
    suggestionsBox.style.display = "none";
    currentMatches = [];
    activeIndex    = 0;
    return;
  }
  currentMatches = STUDENTS
    .filter(stu => normalize(stu.name).includes(query))
    .sort((a, b) => {
      const aS = normalize(a.name).startsWith(query) ? 0 : 1;
      const bS = normalize(b.name).startsWith(query) ? 0 : 1;
      return aS - bS;
    })
    .slice(0, 6);
  activeIndex = 0;
  renderSuggestions();
});

suggestionsBox.addEventListener("click", function (e) {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  selectSuggestion(+item.dataset.index);
});

function selectSuggestion(idx) {
  if (!currentMatches[idx]) return;
  document.getElementById("searchInput").value = currentMatches[idx].name;
  suggestionsBox.style.display = "none";
  doSearch(currentMatches[idx].name);
}

document.getElementById("searchInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
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

document.addEventListener("click", e => {
  if (!e.target.closest(".search-wrap")) suggestionsBox.style.display = "none";
});

/* ════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════ */
function clearSearch() {
  document.getElementById("searchInput").value = "";
  document.getElementById("btnClear").style.display   = "none";
  document.getElementById("resultCard").style.display = "none";
  suggestionsBox.style.display = "none";
  currentMatches = [];
  activeIndex    = 0;
  clearHighlights();
  buildClassroom(null);
}

function clearHighlights() {
  document.querySelectorAll(".seat.lit").forEach(el => el.classList.remove("lit"));
  document.querySelectorAll(".desk.glowing").forEach(el => el.classList.remove("glowing"));
}

function showLoading(visible) {
  document.getElementById("loadingOverlay").style.display = visible ? "flex" : "none";
}

function showFetchError(err) {
  const resultCard = document.getElementById("resultCard");
  const resTitle   = document.getElementById("resTitle");
  const resBody    = document.getElementById("resBody");
  resultCard.style.display = "block";
  resultCard.className     = "error";
  resTitle.textContent     = "Could Not Load Data";
  resBody.innerHTML        = `
    Please ensure both Google Sheet tabs are published as CSV and URLs are
    set correctly in <code>script.js</code>.<br><br>
    <small style="opacity:0.6">${sanitize(err.message)}</small>
  `;
}

/* ── INIT ── */
init();
