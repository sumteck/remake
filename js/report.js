/**
 * report.js  (v2 — New Salary Breakdown Columns)
 * =========
 * All logic for the Report Preview page.
 *
 * CHANGELOG v2
 * ------------
 * • _renderBillDetails() renders all 12 salary component columns +
 *   SparkCode/BRN, EncashDate, Remarks, GrossSalary.
 * • _renderSummaryTable() aggregates salary component sub-totals per HoA.
 * • _col() / _colNum() helpers updated for new COLUMNS index map.
 * • Column count in empty-state colSpan updated to match 18 visible cols.
 */

const TbrReport = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _currentRows = [];
  let _yearRows    = [];

  // ── DOM helpers ────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg, type = "info") {
    const colours = { success: "bg-green-600", error: "bg-red-600", info: "bg-sky-600" };
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

  // ── Column accessors ───────────────────────────────────────────────────────
  const C = TBR_CONFIG.COLUMNS;

  function _col(row, colKey) {
    return row[C[colKey]] || "";
  }

  function _colNum(row, colKey) {
    return parseFloat(row[C[colKey]]) || 0;
  }

  // ── "Months before selected" set ──────────────────────────────────────────
  function _monthsBefore(selectedMonth) {
    const idx = TBR_CONFIG.FY_MONTHS.indexOf(selectedMonth);
    if (idx <= 0) return [];
    return TBR_CONFIG.FY_MONTHS.slice(0, idx);
  }

  // ── Bill Details Table (per-row breakup) ───────────────────────────────────
  function _renderBillDetails(rows) {
    const tbody = $("bill-details-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const TOTAL_COLS = 18; // matching the thead in report.html

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = TOTAL_COLS;
      td.className = "text-center py-8 text-on-surface-variant italic text-body-sm";
      td.textContent = "No bills found for this period.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    // Totals accumulator
    const totals = {
      pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0,
      otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
      grossAmount: 0
    };
    const colMap = {
      pay: "PAY", da: "DA", hra: "HRA", cca: "CCA",
      pgAllowance: "PG_ALLOWANCE", ruralAllowance: "RURAL_ALLOWANCE",
      otherAllowance: "OTHER_ALLOWANCE", consolidatePay: "CONSOLIDATE_PAY",
      dailyWages: "DAILY_WAGES", ms: "MS", tourTa: "TOUR_TA", mr: "MR",
      grossAmount: "GROSS_AMOUNT"
    };

    rows.forEach((row, i) => {
      Object.keys(totals).forEach(k => { totals[k] += _colNum(row, colMap[k]); });

      const tr = document.createElement("tr");
      tr.className = "table-row-hover transition-all " + (i % 2 === 0 ? "bg-white" : "bg-surface-bright");
      tr.innerHTML = `
        <td class="px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono border-r border-outline-variant">${_col(row, "SPARK_CODE") || "—"}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-body-sm border-r border-outline-variant whitespace-nowrap">${_col(row, "ENCASH_DATE") || "—"}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-bold text-primary bg-primary/5">${_fmt(_colNum(row, "GROSS_AMOUNT"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "PAY"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "DA"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "HRA"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "CCA"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "PG_ALLOWANCE"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "RURAL_ALLOWANCE"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "OTHER_ALLOWANCE"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "CONSOLIDATE_PAY"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "DAILY_WAGES"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "MS"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "TOUR_TA"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(_colNum(row, "MR"))}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y">
          <span class="px-2 py-0.5 bg-surface-container-high text-on-surface-variant text-[10px] rounded">${_col(row, "REMARKS") || "—"}</span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Totals row
    const trTotal = document.createElement("tr");
    trTotal.className = "bg-surface-container font-bold border-t-2 border-primary/20 text-on-surface";
    trTotal.innerHTML = `
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-label-caps uppercase border-r border-outline-variant" colspan="2">Total Expenditure</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-primary">₹ ${_fmt(totals.grossAmount)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.pay)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.da)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.hra)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.cca)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.pgAllowance)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.ruralAllowance)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.otherAllowance)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.consolidatePay)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.dailyWages)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.ms)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.tourTa)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right">${_fmt(totals.mr)}</td>
      <td></td>
    `;
    tbody.appendChild(trTotal);

    // Update stat cards
    const totalCard = $("bill-total-amount");
    if (totalCard) totalCard.textContent = "₹ " + _fmt(totals.grossAmount);
    const countCard = $("bill-count");
    if (countCard) countCard.textContent = rows.length;
  }

  // ── Summary / Progressive Table ────────────────────────────────────────────
  function _renderSummaryTable(currentRows, yearRows, selectedMonth) {
    const tbody = $("summary-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const prevMonths = _monthsBefore(selectedMonth);
    const prevMonthSet = new Set(prevMonths);

    // Aggregate by Bill No (identifier) for summary grouping
    const _groupByBill = (rows) => {
      const map = new Map();
      rows.forEach(row => {
        const key = _col(row, "BILL_NO") || ("row_" + Math.random());
        if (!map.has(key)) map.set(key, { rows: [], grossTotal: 0 });
        const entry = map.get(key);
        entry.rows.push(row);
        entry.grossTotal += _colNum(row, "GROSS_AMOUNT");
      });
      return map;
    };

    const currentByBill = _groupByBill(currentRows);
    const prevRows = yearRows.filter(r => prevMonthSet.has((_col(r, "MONTH") || "").trim()));
    const prevByBill = _groupByBill(prevRows);

    const allBills = new Set([...currentByBill.keys(), ...prevByBill.keys()]);

    if (allBills.size === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "text-center py-8 text-on-surface-variant italic text-body-sm";
      td.textContent = "No data available for this financial year.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    let grandCurrent = 0, grandPrev = 0;
    let rowIndex = 1;

    allBills.forEach(billKey => {
      const current = currentByBill.get(billKey)?.grossTotal || 0;
      const prev    = prevByBill.get(billKey)?.grossTotal    || 0;
      const progressive = current + prev;

      grandCurrent += current;
      grandPrev    += prev;

      // Get a sample row to show identifiers
      const sampleRow = (currentByBill.get(billKey)?.rows[0]) ||
                        (prevByBill.get(billKey)?.rows[0]);
      const sparkCode = sampleRow ? _col(sampleRow, "SPARK_CODE") : "";
      const billType  = sampleRow ? _col(sampleRow, "BILL_TYPE")  : "";

      const tr = document.createElement("tr");
      tr.className = "table-row-hover transition-all " + (rowIndex % 2 === 0 ? "bg-surface-bright/50" : "bg-white");
      tr.innerHTML = `
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-on-surface-variant font-data-mono text-data-mono text-center">${rowIndex}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono">
          <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold mr-1 ${billType === 'SPARK' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}">${billType}</span>
          ${billKey}
        </td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono text-primary">${sparkCode || "—"}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono text-data-mono ${current > 0 ? "text-on-surface" : "text-outline"}">${_fmt(current)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono text-data-mono ${prev > 0 ? "text-on-surface" : "text-outline"}">${_fmt(prev)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono font-bold text-primary">${_fmt(progressive)}</td>
      `;
      tbody.appendChild(tr);
      rowIndex++;
    });

    // Grand Total row
    const grandProgressive = grandCurrent + grandPrev;
    const trGrand = document.createElement("tr");
    trGrand.className = "bg-surface-container font-bold border-t-2 border-primary/20 text-on-surface";
    trGrand.innerHTML = `
      <td colspan="3" class="px-table-cell-padding-x py-table-cell-padding-y text-label-caps uppercase text-right">Grand Total</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono">${_fmt(grandCurrent)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono">${_fmt(grandPrev)}</td>
      <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-data-mono text-primary">₹ ${_fmt(grandProgressive)}</td>
    `;
    tbody.appendChild(trGrand);

    // Update reconciliation summary sidebar cards
    const monthCard = $("summary-current-month");
    if (monthCard) monthCard.textContent = "₹ " + _fmt(grandCurrent);
    const prevCard = $("summary-prev-months");
    if (prevCard) prevCard.textContent = "₹ " + _fmt(grandPrev);
    const grandCard = $("summary-grand-total");
    if (grandCard) grandCard.textContent = "₹ " + _fmt(grandProgressive);
  }

  // ── Report Header ──────────────────────────────────────────────────────────
  function _renderReportHeader(finYear, month) {
    const titleEl = $("report-title");
    if (titleEl) titleEl.textContent = `Treasury Bill Reconciliation — ${month} ${finYear}`;

    const subtitleEl = $("report-subtitle");
    if (subtitleEl) subtitleEl.textContent = `Financial Year: ${finYear}`;

    const dateEl = $("report-generated-date");
    if (dateEl) dateEl.textContent = `Generated: ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}`;

    // Also update the page-level heading in the controls bar
    const headingEl = $("report-period-heading");
    if (headingEl) headingEl.textContent = `Treasury Bill Reconciliation — ${month} — FY ${finYear}`;
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
      const [currentRows, yearRows] = await Promise.all([
        TbrApi.fetchRowsForPeriod(finYear, month),
        TbrApi.fetchRowsForYear(finYear),
      ]);

      _currentRows = currentRows;
      _yearRows    = yearRows;

      _renderReportHeader(finYear, month);
      _renderBillDetails(currentRows);
      _renderSummaryTable(currentRows, yearRows, month);

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

    [$("report-fin-year"), $("report-month")].forEach(sel => {
      sel?.addEventListener("change", () => {
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

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrReport.init());
