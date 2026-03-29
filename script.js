/* =========================================================
   CONFIGURATION
   ─────────────
   Step 1: Open your Google Sheet
   Step 2: File → Share → Publish to web
   Step 3: Choose your sheet → CSV → Publish
   Step 4: Copy the URL and paste it below
   ========================================================= */
const CONFIG = {
  SHEET_URL:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQFIUbBjF4frO6966ELY0jrNIMpn49GIkjGrxXurFomkOMqEcWYE8wwNAkTRsr5qq9RItkhNcqM1k9V/pub?output=csv",
  COLS: 3, // number of seat columns per room
};

/*
  ── EXPECTED GOOGLE SHEET COLUMNS (Row 1 = Headers) ──────
  A: Name       → Student full name
  B: Roll       → Roll number
  C: Class      → e.g. BBA I, BCOM II, B Pharm III …
  D: Room       → Room number / name  e.g. Room 1, Hall A
  E: Row        → Seat row number (1, 2, 3 …)
  F: Col        → Seat column (1, 2, or 3)
  G: Side       → left  or  right
  ─────────────────────────────────────────────────────────
*/

/* ── CACHE CONFIG ── */
// Fix 3: Declare CACHE_KEY and CACHE_TTL at the top so forceRefresh()
// can safely reference them without hitting the temporal dead zone.
const CACHE_KEY = "examSeats_cache";
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes in ms

/* ── STATE ── */
let STUDENTS    = [];
let studentAt   = {}; // "room-row-col-side" → student  (unique per seat)
let roomsData   = {}; // room → [students]
let lastMatches = []; // kept at module scope (not on window)

/* ═══════════════════════════════════════════════════════
   INIT — entry point
   Fix 1: Only ONE init() declaration (removed the old duplicate).
   Fix 2: init() is called at the very bottom of the file.
   ═══════════════════════════════════════════════════════ */
async function init() {
  showLoading(true);
  try {
    // Try cache first
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        STUDENTS = data; // use cached data — instant load
        buildMaps();
        buildClassroom(null);
        showLoading(false);
        return;
      }
    }
    // Cache expired or missing — fetch fresh from Google Sheets
    STUDENTS = await fetchStudents();
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), data: STUDENTS })
    );
    buildMaps();
    buildClassroom(null);
    showLoading(false);
  } catch (err) {
    showLoading(false);
    showFetchError(err);
  }
}

/* ── FETCH FROM GOOGLE SHEETS ── */
async function fetchStudents() {
  const res = await fetch(CONFIG.SHEET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  return parseCSV(csv);
}

/* ── CSV PARSER (handles quoted fields) ── */
function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  return lines
    .slice(1) // skip header row
    .map((line) => {
      const cols = splitCSVLine(line);
      const name = cols[0]?.trim();
      const row  = parseInt(cols[4]);
      const col  = parseInt(cols[5]);
      const side = cols[6]?.trim().toLowerCase();

      if (!name || isNaN(row) || isNaN(col) || !side) return null;

      return {
        name,
        roll : cols[1]?.trim() || "—",
        class: cols[2]?.trim() || "—",
        room : cols[3]?.trim() || "—",
        row,
        col,
        side,
      };
    })
    .filter(Boolean);
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

  STUDENTS.forEach((s) => {
    const key = `${s.room}-${s.row}-${s.col}-${s.side}`;
    studentAt[key] = s;

    if (!roomsData[s.room]) roomsData[s.room] = [];
    roomsData[s.room].push(s);
  });
}

/* ═══════════════════════════════════════════════════════
   CLASSROOM BUILDER
   ═══════════════════════════════════════════════════════ */
function buildClassroom(roomName) {
  const rowNums   = document.getElementById("rowNums");
  const deskRows  = document.getElementById("deskRows");
  const roomLabel = document.getElementById("roomLabel");

  rowNums.innerHTML  = "";
  deskRows.innerHTML = "";

  const students = roomName ? (roomsData[roomName] || []) : [];
  // Use reduce() — safe with large datasets (Math.max(...array) can crash)
  const maxRow = students.length
    ? students.reduce((max, s) => (s.row > max ? s.row : max), 0)
    : 10;

  roomLabel.textContent = roomName
    ? `Room: ${roomName}`
    : "Classroom — Top-Down View";

  for (let r = 1; r <= maxRow; r++) {
    const rn = document.createElement("div");
    rn.className   = "rnum";
    rn.textContent = `R${r}`;
    rowNums.appendChild(rn);

    const rowDiv = document.createElement("div");
    rowDiv.className = "desk-row";

    for (let c = 1; c <= CONFIG.COLS; c++) {
      const left  = roomName ? (studentAt[`${roomName}-${r}-${c}-left`]  || null) : null;
      const right = roomName ? (studentAt[`${roomName}-${r}-${c}-right`] || null) : null;

      const desk = document.createElement("div");
      desk.className = "desk";
      desk.id        = `desk-${r}-${c}`;
      desk.appendChild(mkSeat(r, c, "left",  left));
      desk.appendChild(mkSeat(r, c, "right", right));
      rowDiv.appendChild(desk);
    }
    deskRows.appendChild(rowDiv);
  }
}

function mkSeat(r, c, side, student) {
  const el = document.createElement("div");
  el.className = `seat seat-${side}`;
  el.id        = `seat-${r}-${c}-${side}`;

  const badge = document.createElement("div");
  badge.className   = "seat-info-badge";
  badge.textContent = `R${r} · C${c}`;

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
const sentinel = document.createElement("div");
sentinel.style.cssText =
  "height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;";
stickyHeader.parentElement.insertBefore(sentinel, stickyHeader);

new IntersectionObserver(
  ([entry]) =>
    stickyHeader.classList.toggle("is-stuck", !entry.isIntersecting),
  { threshold: 1.0 }
).observe(sentinel);

/* ═══════════════════════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════════════════════ */

/* ── HTML SANITIZER — prevents XSS from sheet data or user input ── */
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

  const matches = STUDENTS.filter((stu) => {
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
    resBody.innerHTML    = matches
      .map(
        (m, i) => `
      <div class="multi-result" onclick="selectMatch(${i})">
        <strong>${sanitize(m.name)}</strong>
        <span class="multi-class">${sanitize(m.class)}</span>
        <span class="multi-room">Room: ${sanitize(m.room)} &nbsp;|&nbsp; R${m.row} C${m.col} ${sanitize(cap(m.side))}</span>
      </div>`
      )
      .join("");

    lastMatches = matches;
    matches.forEach((m) => highlightSeat(m));
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

function showResult(m) {
  const resultCard = document.getElementById("resultCard");
  const resTitle   = document.getElementById("resTitle");
  const resBody    = document.getElementById("resBody");

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
      <span>Seat</span><strong>Row ${m.row} · Col ${m.col} · ${sanitize(cap(m.side))}</strong>
    </div>
  `;

  buildClassroom(m.room);
  highlightSeat(m);
}

function highlightSeat(m) {
  const seatEl = document.getElementById(`seat-${m.row}-${m.col}-${m.side}`);
  const deskEl = document.getElementById(`desk-${m.row}-${m.col}`);

  seatEl?.classList.add("lit");
  deskEl?.classList.add("glowing");

  if (seatEl)
    setTimeout(
      () => seatEl.scrollIntoView({ behavior: "smooth", block: "center" }),
      150
    );
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
        <div class="suggestion-roll">${sanitize(m.class)} &nbsp;|&nbsp; ${sanitize(m.room)}</div>
      </div>`
    )
    .join("");
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
    .filter((stu) => normalize(stu.name).includes(query))
    .sort((a, b) => {
      const aStarts = normalize(a.name).startsWith(query) ? 0 : 1;
      const bStarts = normalize(b.name).startsWith(query) ? 0 : 1;
      return aStarts - bStarts;
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

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) suggestionsBox.style.display = "none";
});

/* ── HELPERS ── */
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
  document.querySelectorAll(".seat.lit").forEach((el) => el.classList.remove("lit"));
  document.querySelectorAll(".desk.glowing").forEach((el) => el.classList.remove("glowing"));
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* ── LOADING STATE ── */
function showLoading(visible) {
  document.getElementById("loadingOverlay").style.display = visible ? "flex" : "none";
}

/* ── FETCH ERROR ── */
function showFetchError(err) {
  const resultCard = document.getElementById("resultCard");
  const resTitle   = document.getElementById("resTitle");
  const resBody    = document.getElementById("resBody");

  resultCard.style.display = "block";
  resultCard.className     = "error";
  resTitle.textContent     = "Could Not Load Data";
  resBody.innerHTML        = `
    Please check that the Google Sheet URL is set correctly in <code>script.js</code>
    and the sheet is published to the web.<br><br>
    <small style="opacity:0.6">${sanitize(err.message)}</small>
  `;
}

/* ── INIT ── */
init();
