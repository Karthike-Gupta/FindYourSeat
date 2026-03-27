/* =========================================================
     STUDENTS DATA
     ─────────────
     Edit this array to update names / roll numbers.
     Position 0 = S1, position 1 = S2, … position 59 = S60.

     Seating order:
       S1 –S10  → Col 3, RIGHT seat, Row 1–10
       S11–S20  → Col 3, LEFT  seat, Row 1–10
       S21–S30  → Col 2, RIGHT seat, Row 1–10
       S31–S40  → Col 2, LEFT  seat, Row 1–10
       S41–S50  → Col 1, RIGHT seat, Row 1–10
       S51–S60  → Col 1, LEFT  seat, Row 1–10
  ========================================================= */
const STUDENTS = [
  { name: "Abhay Pratap", roll: "123401", class: "BBA" },
  { name: "Aditya Singh", roll: "123402", class: "BBA" },
  { name: "Anshika Singh", roll: "123403", class: "BBA" },
  { name: "Anupriya Pal", roll: "123404", class: "BBA" },
  { name: "Aryan Gautam", roll: "123405", class: "BBA" },
  { name: "Chhavi Singh", roll: "123406", class: "BBA" },
  { name: "Devansh Srivastava", roll: "123407", class: "BBA" },
  { name: "Dhananjay Mishra", roll: "123408", class: "BBA" },
  { name: "Dipika Kumari", roll: "123409", class: "BBA" },
  { name: "Dishika Sachdeva", roll: "123410", class: "BBA" },
  { name: "Divyanshi Pandey", roll: "123411", class: "BBA" },
  { name: "Harshit Mishra", roll: "123412", class: "BBA" },
  { name: "Harshit Tiwari", roll: "123413", class: "BBA" },
  { name: "Karthike Gupta", roll: "123414", class: "BBA" },
  { name: "Km Swati Pratap", roll: "123415", class: "BBA" },
  { name: "Km Smita Singh", roll: "123416", class: "BBA" },
  { name: "Lavlesh Kumar", roll: "123417", class: "BBA" },
  { name: "Mahi Chaubey", roll: "123418", class: "BBA" },
  { name: "Navin Shukla", roll: "123419", class: "BBA" },
  { name: "Nice R. Nirala", roll: "123420", class: "BBA" },
  { name: "Nitin Gautam", roll: "123421", class: "BBA" },
  { name: "Palak Rathour", roll: "123422", class: "BBA" },
  { name: "Pratulya Pandey", roll: "123423", class: "BBA" },
  { name: "Priyanshi Yadav", roll: "123424", class: "BBA" },
  { name: "Rajbeer Kaur", roll: "123425", class: "BBA" },
  { name: "Riddhi Singh", roll: "123426", class: "BBA" },
  { name: "Sakshi Agarwal", roll: "123427", class: "BBA" },
  { name: "Sanchita Dwivedi", roll: "123428", class: "BBA" },
  { name: "Satyajeet Tiwari", roll: "123429", class: "BBA" },
  { name: "Shritika", roll: "123430", class: "BBA" },
  { name: "Simran", roll: "123431", class: "BBA" },
  { name: "Srishti", roll: "123432", class: "BBA" },
  { name: "Surya Pratap", roll: "123433", class: "BBA" },
  { name: "Swechchha Singh", roll: "123434", class: "BBA" },
  { name: "Ujjwal Shukla", roll: "123435", class: "BBA" },
  { name: "Ummey Abiha", roll: "123436", class: "BBA" },
  { name: "Vanshika Shukla", roll: "123437", class: "BBA" },
  { name: "Vanshika Srivastava", roll: "123438", class: "BBA" },
  { name: "Vineet Khakarodiya", roll: "123439", class: "BBA" },
];

/* ── CONFIG ── */
const ROWS = 10,
  COLS = 3;

const GROUPS = [
  { col: 3, side: "right" },
  { col: 3, side: "left" },
  { col: 2, side: "right" },
  { col: 2, side: "left" },
  { col: 1, side: "right" },
  { col: 1, side: "left" },
];

/* ── MAPS ── */
const seatOf = {};
const studentAt = {};

STUDENTS.forEach((student, i) => {
  const g = GROUPS[Math.floor(i / 10)];
  const row = (i % 10) + 1;
  const info = { row, col: g.col, side: g.side, ...student };
  seatOf[student.name.toLowerCase()] = info;
  studentAt[`${row}-${g.col}-${g.side}`] = student;
});

/* ── BUILD CLASSROOM ── */
function buildClassroom() {
  const rowNums = document.getElementById("rowNums");
  const deskRows = document.getElementById("deskRows");

  for (let r = 1; r <= ROWS; r++) {
    const rn = document.createElement("div");
    rn.className = "rnum";
    rn.textContent = `R${r}`;
    rowNums.appendChild(rn);

    const rowDiv = document.createElement("div");
    rowDiv.className = "desk-row";

    for (let c = 1; c <= COLS; c++) {
      const left = studentAt[`${r}-${c}-left`] || null;
      const right = studentAt[`${r}-${c}-right`] || null;

      const desk = document.createElement("div");
      desk.className = "desk";
      desk.id = `desk-${r}-${c}`;
      desk.appendChild(mkSeat(r, c, "left", left));
      desk.appendChild(mkSeat(r, c, "right", right));
      rowDiv.appendChild(desk);
    }
    deskRows.appendChild(rowDiv);
  }
}

function mkSeat(r, c, side, student) {
  const el = document.createElement("div");
  el.className = `seat seat-${side}`;
  el.id = `seat-${r}-${c}-${side}`;

  const badge = document.createElement("div");
  badge.className = "seat-info-badge";
  badge.textContent = `R${r} · C${c}`;

  const nameEl = document.createElement("div");
  nameEl.className = "seat-name";
  nameEl.textContent = student ? student.name : "";

  const classEl = document.createElement("div");
  classEl.className = "seat-class";
  classEl.textContent = student ? student.class : "";

  el.appendChild(badge);
  el.appendChild(nameEl);
  el.appendChild(classEl);
  return el;
}

/* ── STICKY HEADER — is-stuck detection ── */
const stickyHeader = document.getElementById("stickyHeader");

// Tiny 1px sentinel inserted just before the sticky header.
// When it leaves the viewport, the header is "stuck".
const sentinel = document.createElement("div");
sentinel.style.cssText =
  "height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;";
stickyHeader.parentElement.insertBefore(sentinel, stickyHeader);

new IntersectionObserver(
  ([entry]) => stickyHeader.classList.toggle("is-stuck", !entry.isIntersecting),
  { threshold: 1.0 },
).observe(sentinel);

/* ── SEARCH ── */
function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, "");
}

function doSearch() {
  const raw = document.getElementById("searchInput").value.trim();
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

  const matches = Object.values(seatOf).filter((stu) => {
    const name = normalize(stu.name);
    return name.includes(q) || q.includes(name);
  });

  resultCard.style.display = "block";
  resultCard.className = "";

  if (!matches.length) {
    resultCard.className = "error";
    resTitle.textContent = "Not Found";
    resBody.innerHTML = `No match for "<strong>${raw}</strong>"`;
    return;
  }

  const m = matches[0];
  const seatEl = document.getElementById(`seat-${m.row}-${m.col}-${m.side}`);
  const deskEl = document.getElementById(`desk-${m.row}-${m.col}`);

  resultCard.className = "success";
  seatEl?.classList.add("lit");
  deskEl?.classList.add("glowing");

  if (seatEl)
    setTimeout(
      () => seatEl.scrollIntoView({ behavior: "smooth", block: "center" }),
      120,
    );

  resTitle.textContent = m.name;
  resBody.innerHTML = `
      Class: <strong>${m.class}</strong> &nbsp;|&nbsp; Roll: <strong>${m.roll}</strong><br>
      Row&nbsp;${m.row} &nbsp;|&nbsp; Column&nbsp;${m.col} &nbsp;|&nbsp; ${cap(m.side)}&nbsp;Seat
    `;
}

/* ── AUTOCOMPLETE ── */
const suggestionsBox = document.getElementById("suggestions");
let activeIndex = -1;

document.getElementById("searchInput").addEventListener("input", function () {
  const query = normalize(this.value);
  if (!query) {
    suggestionsBox.style.display = "none";
    return;
  }

  const matches = Object.values(seatOf)
    .filter((stu) => normalize(stu.name).includes(query))
    .slice(0, 6);

  if (!matches.length) {
    suggestionsBox.style.display = "none";
    return;
  }

  suggestionsBox.innerHTML = matches
    .map(
      (m, i) => `
      <div class="suggestion-item" data-index="${i}">
        ${m.name}
        <div class="suggestion-roll">Class: ${m.class}</div>
      </div>`,
    )
    .join("");
  suggestionsBox.style.display = "block";
  activeIndex = -1;
});

suggestionsBox.addEventListener("click", function (e) {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  const idx = +item.dataset.index;
  const q = normalize(document.getElementById("searchInput").value);
  const matches = Object.values(seatOf).filter((stu) =>
    normalize(stu.name).includes(q),
  );
  document.getElementById("searchInput").value = matches[idx].name;
  suggestionsBox.style.display = "none";
  doSearch();
});

document
  .getElementById("searchInput")
  .addEventListener("keydown", function (e) {
    const items = document.querySelectorAll(".suggestion-item");
    if (e.key === "Enter") {
      if (activeIndex >= 0 && items.length) items[activeIndex].click();
      else if (items.length) items[0].click();
      else doSearch();
      return;
    }
    if (e.key === "Escape") {
      clearSearch();
      return;
    }
    if (!items.length) return;
    if (e.key === "ArrowDown") activeIndex = (activeIndex + 1) % items.length;
    else if (e.key === "ArrowUp")
      activeIndex = (activeIndex - 1 + items.length) % items.length;
    else return;
    items.forEach((i) => i.classList.remove("active"));
    items[activeIndex].classList.add("active");
    e.preventDefault();
  });

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) suggestionsBox.style.display = "none";
});

/* ── HELPERS ── */
function clearSearch() {
  document.getElementById("searchInput").value = "";
  document.getElementById("btnClear").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  suggestionsBox.style.display = "none";
  clearHighlights();
}

function clearHighlights() {
  document
    .querySelectorAll(".seat.lit")
    .forEach((el) => el.classList.remove("lit"));
  document
    .querySelectorAll(".desk.glowing")
    .forEach((el) => el.classList.remove("glowing"));
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── INIT ── */
buildClassroom();
