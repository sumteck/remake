/**
 * report.js
 * =========
 * All logic for the Enhanced Report Preview page.
 *
 * Responsibilities:
 *   1. Populate Financial Year + Month dropdowns
 *   2. Fetch data from Google Sheets for the selected period
 *   3. Render "Bill Details" top table (bills for selected month)
 *   4. Render "Summary by Head of Account" table with:
 *        • Current Month total
 *        • Upto Previous Month cumulative total
 *        • Progressive Total
 *        • Grand Total row
 *   5. Print / Export to PDF button support
 */

const TbrReport = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _currentRows   = [];   // Rows for the selected month
  let _yearRows      = [];   // All rows for the selected financial year

  // ── DOM helpers ────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg, type = "info") {
    const colours = { success: "bg-green-600", error: "bg-red-600", info: "bg-blue-600" };
    const container = $("toast-container");
    if (!container) { console.log(msg); return; }
    const div = document.createElement("div");
    div.className = `${colours[type]} text-white text-sm px-4 py-3 rounded shadow-lg mb-2`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = "0"; setTimeout(() => div.remove(), 300); }, 3500);
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  function setLoading(active, msg = "Loading…") {
    const overlay = $("loading-overlay");
    const msgEl   = $("loading-message");
    if (overlay) overlay.classList.toggle("hidden", !active);
    if (msgEl) msgEl.textContent = msg;
  }

  // ── Formatting helpers ─────────────────────────────────────────────────────
  function _fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Period selectors ───────────────────────────────────────────────────────
  function _populatePeriodSelectors() {
    const fySelect    = $("report-fin-year");
    const monthSelect = $("report-month");
    if (!fySelect || !monthSelect) return;

    const now = new Date();
    const currentFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    fySelect.innerHTML = "";
    for (let y = currentFY + 1; y >= currentFY - 2; y--) {
      const opt = document.createElement("option");
      opt.value = `${y}-${String(y + 1).slice(-2)}`;
      opt.textContent = `${y}-${String(y + 1).slice(-2)}`;
      if (y === currentFY) opt.selected = true;
      fySelect.appendChild(opt);
    }

    monthSelect.innerHTML = "";
    TBR_CONFIG.FY_MONTHS.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });

    const monthIdx = [3,4,5,6,7,8,9,10,11,0,1,2].indexOf(now.getMonth());
    monthSelect.value = TBR_CONFIG.FY_MONTHS[monthIdx] || TBR_CONFIG.FY_MONTHS[0];
  }

  function _getSelectedPeriod() {
    return {
      finYear: ($("report-fin-year")?.value  || "").trim(),
      month:   ($("report-month")?.value     || "").trim(),
    };
  }

  // ── Column accessor ────────────────────────────────────────────────────────
  // Sheet rows come back as plain arrays; use COLUMNS index map.
  const C = TBR_CONFIG.COLUMNS;

  function _col(row, colKey) {
    return row[C[colKey]] || "";
  }
  function _colNum(row, colKey) {
    return TbrParser.parseAmount(row[C[colKey]]);
  }

  /**
   * Build a canonical HoA string from a sheet row array.
   */
  function _rowHoA(row) {
    return [
      String(_col(row, "MJH")).padStart(4, '0'),
      String(_col(row, "SMJH")).padStart(2, '0'),
      String(_col(row, "MIH")).padStart(3, '0'),
      String(_col(row, "SBHLH")).padStart(2, '0'),
      String(_col(row, "SHLH")).padStart(2, '0'),
      String(_col(row, "VOH")).padStart(2, '0'),
      String(_col(row, "SOH")).padStart(2, '0')
    ].join("-");
  }

  // ── "Months before selected" set ──────────────────────────────────────────
  /**
   * Return an array of month names that fall BEFORE the selected month
   * within the same financial year (April = start).
   */
  function _monthsBefore(selectedMonth) {
    const idx = TBR_CONFIG.FY_MONTHS.indexOf(selectedMonth);
    if (idx <= 0) return [];
    return TBR_CONFIG.FY_MONTHS.slice(0, idx);
  }

  // ── Bill Details Table ─────────────────────────────────────────────────────
  function _renderBillDetails(rows) {
    const tbody = $("bill-details-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "text-center py-6 text-gray-400 italic text-sm";
      td.textContent = "No bills found for this period.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    let grandTotal = 0;

    rows.forEach((row, i) => {
      const amount = _colNum(row, "NET_AMOUNT");
      grandTotal += amount;

      const tr = document.createElement("tr");
      tr.className = i % 2 === 0 ? "bg-white" : "bg-gray-50";
      tr.innerHTML = `
        <td class="px-3 py-2 text-sm text-center">${i + 1}</td>
        <td class="px-3 py-2 text-sm">${_col(row, "BILL_TYPE")}</td>
        <td class="px-3 py-2 text-sm">${_col(row, "BILL_NO") || "—"}</td>
        <td class="px-3 py-2 text-sm">${_col(row, "DDO_CODE") || "—"}</td>
        <td class="px-3 py-2 text-sm">${_col(row, "DEPT") || "—"}</td>
        <td class="px-3 py-2 text-sm font-mono">${_rowHoA(row)}</td>
        <td class="px-3 py-2 text-sm text-right font-mono">${_fmt(amount)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Grand total row
    const trTotal = document.createElement("tr");
    trTotal.className = "bg-blue-50 font-bold border-t-2 border-blue-300";
    trTotal.innerHTML = `
      <td colspan="6" class="px-3 py-2 text-sm text-right">Grand Total</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${_fmt(grandTotal)}</td>
    `;
    tbody.appendChild(trTotal);

    // Update summary card
    const totalCard = $("bill-total-amount");
    if (totalCard) totalCard.textContent = _fmt(grandTotal);
    const countCard = $("bill-count");
    if (countCard) countCard.textContent = rows.length;
  }

  // ── Summary / HoA Table ────────────────────────────────────────────────────
  /**
   * Group rows by canonical HoA.
   * Returns a Map: hoaKey → { rows: [...], total: number }
   */
  function _groupByHoA(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = _rowHoA(row);
      if (!map.has(key)) map.set(key, { rows: [], total: 0 });
      const entry = map.get(key);
      const amt = _colNum(row, "NET_AMOUNT");
      entry.rows.push(row);
      entry.total += amt;
    });
    return map;
  }

  function _renderSummaryTable(currentRows, yearRows, selectedMonth) {
    const tbody = $("summary-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const prevMonths = _monthsBefore(selectedMonth);
    const prevMonthSet = new Set(prevMonths);

    // Group current-month rows by HoA
    const currentByHoA = _groupByHoA(currentRows);

    // Group "upto previous" rows by HoA
    const prevRows = yearRows.filter(r => prevMonthSet.has((_col(r, "MONTH") || "").trim()));
    const prevByHoA = _groupByHoA(prevRows);

    // Union of all HoA keys found in either set
    const allHoAs = new Set([...currentByHoA.keys(), ...prevByHoA.keys()]);

    if (allHoAs.size === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 11;
      td.className = "text-center py-6 text-gray-400 italic text-sm";
      td.textContent = "No data available for this financial year.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    let grandCurrent = 0;
    let grandPrev    = 0;
    let rowIndex     = 1;

    // Parse parts from a canonical HoA string
   const parseParts = hoa => {
      const p = hoa.split("-");
      return [
        String(p[0] || "00").padStart(4, '0'),
        String(p[1] || "00").padStart(2, '0'),
        String(p[2] || "00").padStart(3, '0'),
        String(p[3] || "00").padStart(2, '0'),
        String(p[4] || "00").padStart(2, '0'),
        String(p[5] || "00").padStart(2, '0'),
        String(p[6] || "00").padStart(2, '0')
      ];
    };

    allHoAs.forEach(hoaKey => {
      const current = currentByHoA.get(hoaKey)?.total || 0;
      const prev    = prevByHoA.get(hoaKey)?.total    || 0;
      const progressive = current + prev;

      grandCurrent += current;
      grandPrev    += prev;

      const parts = parseParts(hoaKey);

      const tr = document.createElement("tr");
      tr.className = rowIndex % 2 === 0 ? "bg-gray-50" : "bg-white";
      tr.innerHTML = `
        <td class="px-2 py-2 text-sm text-center">${rowIndex}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[0]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[1]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[2]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[3]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[4]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[5]}</td>
        <td class="px-2 py-2 text-sm font-mono">${parts[6]}</td>
        <td class="px-2 py-2 text-sm text-right font-mono ${current  > 0 ? "text-gray-800" : "text-gray-400"}">${_fmt(current)}</td>
        <td class="px-2 py-2 text-sm text-right font-mono ${prev     > 0 ? "text-gray-800" : "text-gray-400"}">${_fmt(prev)}</td>
        <td class="px-2 py-2 text-sm text-right font-mono font-semibold">${_fmt(progressive)}</td>
      `;
      tbody.appendChild(tr);
      rowIndex++;
    });

    // Grand total row
    const grandProgressive = grandCurrent + grandPrev;
    const trGrand = document.createElement("tr");
    trGrand.className = "bg-blue-100 font-bold border-t-2 border-blue-400";
    trGrand.innerHTML = `
      <td colspan="8" class="px-2 py-2 text-sm text-right uppercase tracking-wide">Grand Total</td>
      <td class="px-2 py-2 text-sm text-right font-mono">${_fmt(grandCurrent)}</td>
      <td class="px-2 py-2 text-sm text-right font-mono">${_fmt(grandPrev)}</td>
      <td class="px-2 py-2 text-sm text-right font-mono">${_fmt(grandProgressive)}</td>
    `;
    tbody.appendChild(trGrand);

    // Update summary cards if they exist
    const grandCard = $("summary-grand-total");
    if (grandCard) grandCard.textContent = _fmt(grandProgressive);
  }

  // ── Report Header ──────────────────────────────────────────────────────────
  function _renderReportHeader(finYear, month) {
    const titleEl = $("report-title");
    if (titleEl) titleEl.textContent = `Treasury Bill Reconciliation — ${month} ${finYear}`;

    const subtitleEl = $("report-subtitle");
    if (subtitleEl) subtitleEl.textContent = `Financial Year: ${finYear}`;

    const dateEl = $("report-generated-date");
    if (dateEl) dateEl.textContent = `Generated: ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}`;
  }

  // ── Main "Generate Report" action ─────────────────────────────────────────
  async function _generateReport() {
    if (!TbrAuth.isSignedIn()) {
      toast("Please sign in with Google first.", "error");
      return;
    }

    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) {
      toast("Please select a Financial Year and Month.", "error");
      return;
    }

    setLoading(true, "Fetching report data…");
    try {
      // Fetch current-month rows and full-year rows in parallel
      const [currentRows, yearRows] = await Promise.all([
        TbrApi.fetchRowsForPeriod(finYear, month),
        TbrApi.fetchRowsForYear(finYear),
      ]);

      _currentRows = currentRows;
      _yearRows    = yearRows;

      _renderReportHeader(finYear, month);
      _renderBillDetails(currentRows);
      _renderSummaryTable(currentRows, yearRows, month);

      // Show the report section
      const reportSection = $("report-content");
      if (reportSection) show(reportSection);

      if (currentRows.length === 0) {
        toast(`No bills found for ${month} ${finYear}.`, "info");
      } else {
        toast(`Report generated: ${currentRows.length} bill(s) found.`, "success");
      }
    } catch (err) {
      console.error(err);
      toast(`Failed to load report: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Print / Export ─────────────────────────────────────────────────────────
  function _bindPrintButton() {
    const btn = $("print-report-btn");
    if (!btn) return;
    btn.addEventListener("click", () => window.print());
  }

  // ── Bind "Generate" button ─────────────────────────────────────────────────
  function _bindGenerateButton() {
    const btn = $("generate-report-btn");
    if (!btn) return;
    btn.addEventListener("click", _generateReport);

    // Also regenerate if period selectors change while report is showing
    [$("report-fin-year"), $("report-month")].forEach(sel => {
      sel?.addEventListener("change", () => {
        // Auto-regenerate only if report is already visible
        const reportSection = $("report-content");
        if (reportSection && !reportSection.classList.contains("hidden")) {
          _generateReport();
        }
      });
    });
  }

  // ── Auth callbacks ─────────────────────────────────────────────────────────
  function _onSignIn() {
    TbrApi.ensureSpreadsheet().catch(err =>
      toast(`Spreadsheet connection error: ${err.message}`, "error")
    );
  }

  function _onSignOut() {
    _currentRows = [];
    _yearRows    = [];
    // Hide report
    const reportSection = $("report-content");
    if (reportSection) hide(reportSection);
    toast("Signed out.", "info");
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    _populatePeriodSelectors();
    _bindGenerateButton();
    _bindPrintButton();

    TbrAuth.onSignIn(_onSignIn);
    TbrAuth.onSignOut(_onSignOut);
    TbrAuth.bindButtons();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrReport.init());
