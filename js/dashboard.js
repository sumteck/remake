/**
 * dashboard.js  (v2 — New Salary Breakdown Columns)
 * ============
 * All logic for the Dashboard (data-entry) page.
 *
 * CHANGELOG v2
 * ------------
 * • Manual Entry form now captures all 12 salary components +
 *   SparkCode/BRN, EncashDate, Remarks.
 * • GrossAmount is auto-computed (read-only) = sum of all components.
 * • _addRows() / _clearManualForm() updated to handle new fields.
 * • COL_DEFS updated for the wider 20-column preview table.
 * • _loadPeriodData() maps new sheet columns via TBR_CONFIG.COLUMNS.
 * • savePeriodData() writes all new columns in correct order.
 */

const TbrDashboard = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _tableRows = [];

  // ── DOM helpers ────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  // ── Toast notification ─────────────────────────────────────────────────────
  function toast(msg, type = "success") {
    const colours = { success: "bg-green-600", error: "bg-red-600", info: "bg-sky-600" };
    const container = $("toast-container");
    if (!container) return;
    const div = document.createElement("div");
    div.className = `${colours[type] || colours.info} text-white text-sm px-4 py-3 rounded shadow-lg mb-2 transition-all duration-300`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = "0"; setTimeout(() => div.remove(), 300); }, 3500);
  }

  // ── Loading overlay ────────────────────────────────────────────────────────
  function setLoading(active, msg = "Processing…") {
    const overlay = $("loading-overlay");
    const msgEl   = $("loading-message");
    if (overlay) overlay.classList.toggle("hidden", !active);
    if (msgEl && msg) msgEl.textContent = msg;
  }

  // ── Custom Modal (Yes / No / Cancel) ──────────────────────────────────────
  function _showConfirmModal(title, message, yesText = "Yes", noText = "No", cancelText = "Cancel") {
    return new Promise((resolve) => {
      const modal = $("custom-modal");
      if (!modal) return resolve("YES");

      $("modal-title").textContent = title;
      $("modal-message").textContent = message;
      $("modal-yes").textContent = yesText;
      $("modal-no").textContent = noText;
      $("modal-cancel").textContent = cancelText;

      show(modal);

      const cleanup = () => {
        hide(modal);
        const y = $("modal-yes"), n = $("modal-no"), c = $("modal-cancel");
        y.replaceWith(y.cloneNode(true));
        n.replaceWith(n.cloneNode(true));
        c.replaceWith(c.cloneNode(true));
      };

      $("modal-yes").addEventListener("click", () => { cleanup(); resolve("YES"); });
      $("modal-no").addEventListener("click", () => { cleanup(); resolve("NO"); });
      $("modal-cancel").addEventListener("click", () => { cleanup(); resolve("CANCEL"); });
    });
  }

  // ── Financial Year & Month dropdowns ──────────────────────────────────────
  function _populatePeriodSelectors() {
    const fySelect    = $("select-fin-year");
    const monthSelect = $("select-month");
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
      finYear: ($("select-fin-year")?.value || "").trim(),
      month:   ($("select-month")?.value   || "").trim(),
    };
  }

  function _bindPeriodSelectors() {
    $("select-fin-year")?.addEventListener("change", _loadPeriodData);
    $("select-month")?.addEventListener("change", _loadPeriodData);
  }

  // ── Auto Load Existing Data ────────────────────────────────────────────────
  async function _loadPeriodData() {
    if (!TbrAuth.isSignedIn()) return;
    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) return;

    setLoading(true, `Loading existing bills for ${month}…`);
    try {
      const sheetRows = await TbrApi.fetchRowsForPeriod(finYear, month);
      const C = TBR_CONFIG.COLUMNS;

      _tableRows = sheetRows.map(row => ({
        billType:         row[C.BILL_TYPE]          || "SPARK",
        billNo:           row[C.BILL_NO]             || "",
        sparkCode:        row[C.SPARK_CODE]          || "",
        pay:              parseFloat(row[C.PAY])      || 0,
        da:               parseFloat(row[C.DA])       || 0,
        hra:              parseFloat(row[C.HRA])      || 0,
        cca:              parseFloat(row[C.CCA])      || 0,
        pgAllowance:      parseFloat(row[C.PG_ALLOWANCE])    || 0,
        ruralAllowance:   parseFloat(row[C.RURAL_ALLOWANCE]) || 0,
        otherAllowance:   parseFloat(row[C.OTHER_ALLOWANCE]) || 0,
        consolidatePay:   parseFloat(row[C.CONSOLIDATE_PAY]) || 0,
        dailyWages:       parseFloat(row[C.DAILY_WAGES])     || 0,
        ms:               parseFloat(row[C.MS])       || 0,
        tourTa:           parseFloat(row[C.TOUR_TA])  || 0,
        mr:               parseFloat(row[C.MR])       || 0,
        grossAmount:      parseFloat(row[C.GROSS_AMOUNT]) || 0,
        encashDate:       row[C.ENCASH_DATE]          || "",
        remarks:          row[C.REMARKS]              || "",
      }));

      _renderTable();
      if (_tableRows.length > 0) {
        toast(`Loaded ${_tableRows.length} existing bill(s) for ${month}.`, "info");
      }
    } catch (err) {
      console.error(err);
      toast(`Failed to load existing data.`, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Gross amount calculator ────────────────────────────────────────────────
  function _computeGross(row) {
    return (row.pay || 0) + (row.da || 0) + (row.hra || 0) + (row.cca || 0) +
           (row.pgAllowance || 0) + (row.ruralAllowance || 0) + (row.otherAllowance || 0) +
           (row.consolidatePay || 0) + (row.dailyWages || 0) + (row.ms || 0) +
           (row.tourTa || 0) + (row.mr || 0);
  }

  // ── Preview Table ──────────────────────────────────────────────────────────
  const COL_DEFS = [
    { key: "billType",        label: "Type"              },
    { key: "billNo",          label: "Bill No"            },
    { key: "sparkCode",       label: "Spark Code/BRN"     },
    { key: "pay",             label: "Pay",          num: true },
    { key: "da",              label: "DA",           num: true },
    { key: "hra",             label: "HRA",          num: true },
    { key: "cca",             label: "CCA",          num: true },
    { key: "pgAllowance",     label: "PG Allw.",     num: true },
    { key: "ruralAllowance",  label: "Rural Allw.",  num: true },
    { key: "otherAllowance",  label: "Other Allw.",  num: true },
    { key: "consolidatePay",  label: "Cons. Pay",    num: true },
    { key: "dailyWages",      label: "Daily Wages",  num: true },
    { key: "ms",              label: "M&S",          num: true },
    { key: "tourTa",          label: "Tour TA",      num: true },
    { key: "mr",              label: "MR",           num: true },
    { key: "grossAmount",     label: "Gross Salary", num: true, bold: true },
    { key: "encashDate",      label: "Encash Date"           },
    { key: "remarks",         label: "Remarks"               },
  ];

  function _renderTable() {
    const tbody = $("bill-table-body");
    const emptyState = $("table-empty-state");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (_tableRows.length === 0) {
      if (emptyState) show(emptyState);
      const badge = $("row-count-badge");
      if (badge) badge.textContent = "0 rows";
      return;
    }
    if (emptyState) hide(emptyState);

    _tableRows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.className = "table-row-hover transition-colors group " + (idx % 2 === 0 ? "bg-white" : "bg-surface");
      tr.dataset.idx = idx;

      // Row number
      const tdN = document.createElement("td");
      tdN.className = "px-table-cell-padding-x py-table-cell-padding-y text-on-surface-variant font-data-mono text-data-mono";
      tdN.textContent = idx + 1;
      tr.appendChild(tdN);

      COL_DEFS.forEach(col => {
        const td = document.createElement("td");
        td.className = "px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono";
        if (col.num) {
          td.className += " text-right" + (col.bold ? " font-bold text-primary" : "");
          td.textContent = _formatCurrency(row[col.key]);
        } else if (col.key === "sparkCode") {
          td.className += " text-primary";
          td.textContent = row[col.key] || "—";
        } else if (col.key === "remarks") {
          td.className += " italic text-on-surface-variant";
          td.textContent = row[col.key] || "—";
        } else {
          td.textContent = row[col.key] || "—";
        }
        tr.appendChild(td);
      });

      // Delete button
      const tdDel = document.createElement("td");
      tdDel.className = "px-table-cell-padding-x py-table-cell-padding-y text-center";
      const btn = document.createElement("button");
      btn.className = "text-error hover:scale-110 transition-transform";
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">delete</span>`;
      btn.addEventListener("click", () => _deleteRow(idx));
      tdDel.appendChild(btn);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    });

    const badge = $("row-count-badge");
    if (badge) badge.textContent = `${_tableRows.length} row${_tableRows.length !== 1 ? "s" : ""}`;
  }

  function _deleteRow(idx) {
    _tableRows.splice(idx, 1);
    _renderTable();
  }

  function _addRows(rows) {
    rows.forEach(r => {
      r.grossAmount = _computeGross(r);
      _tableRows.push(r);
    });
    _renderTable();
  }

  function _formatCurrency(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── PDF Upload Handler ─────────────────────────────────────────────────────
  function _bindPdfUpload() {
    const input = $("pdf-file-input"), dropzone = $("pdf-dropzone"), uploadBtn = $("pdf-upload-btn");
    if (uploadBtn && input) uploadBtn.addEventListener("click", () => input.click());
    if (input) input.addEventListener("change", (e) => _handleFiles(e.target.files));
    if (dropzone) {
      dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("border-primary"); dropzone.classList.add("bg-surface-container-high"); });
      dropzone.addEventListener("dragleave", () => { dropzone.classList.remove("border-primary"); dropzone.classList.remove("bg-surface-container-high"); });
      dropzone.addEventListener("drop", e => {
        e.preventDefault();
        dropzone.classList.remove("border-primary");
        dropzone.classList.remove("bg-surface-container-high");
        _handleFiles(e.dataTransfer.files);
      });
    }
  }

  async function _handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (files.length === 0) { toast("Please select PDF files only.", "error"); return; }

    setLoading(true, `Parsing ${files.length} PDF file(s)…`);
    let successCount = 0;
    for (const file of files) {
      try {
        const rows = await TbrParser.parsePdf(file);
        // PDF-parsed rows map to new schema (sparkCode = ddoCode from parser)
        const mapped = rows.map(r => ({
          billType:        r.billType || "SPARK",
          billNo:          r.billNo || "",
          sparkCode:       r.ddoCode || "",
          pay:             0, da: 0, hra: 0, cca: 0,
          pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0,
          consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
          grossAmount:     r.netAmount || 0,
          encashDate:      "",
          remarks:         r.department || "",
        }));
        _addRows(mapped);
        successCount++;
      } catch (err) { toast(`${file.name}: ${err.message}`, "error"); }
    }
    setLoading(false);
    if (successCount > 0) toast(`Successfully parsed ${successCount} PDF(s). Please verify and fill salary breakdown fields.`, "success");
    if ($("pdf-file-input")) $("pdf-file-input").value = "";
  }

  // ── Live Gross Salary Calculator in Form ───────────────────────────────────
  function _bindGrossCalculator() {
    const numericIds = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr"
    ];
    const grossEl = $("manual-gross-amount");
    if (!grossEl) return;

    const recalc = () => {
      const total = numericIds.reduce((sum, id) => {
        return sum + (parseFloat($(id)?.value || "0") || 0);
      }, 0);
      grossEl.value = "₹ " + total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    numericIds.forEach(id => {
      $(id)?.addEventListener("input", recalc);
    });
    recalc();
  }

  // ── Manual Entry Form ──────────────────────────────────────────────────────
  function _bindManualEntryForm() {
    const form = $("manual-entry-form"), addBtn = $("manual-add-btn");
    if (!form || !addBtn) return;

    addBtn.addEventListener("click", async () => {
      const billType        = ($("manual-bill-type")?.value        || "SPARK").trim();
      const billNo          = ($("manual-bill-no")?.value          || "").trim();
      const sparkCode       = ($("manual-spark-code")?.value       || "").trim();
      const pay             = parseFloat($("manual-pay")?.value             || "0") || 0;
      const da              = parseFloat($("manual-da")?.value              || "0") || 0;
      const hra             = parseFloat($("manual-hra")?.value             || "0") || 0;
      const cca             = parseFloat($("manual-cca")?.value             || "0") || 0;
      const pgAllowance     = parseFloat($("manual-pg-allowance")?.value    || "0") || 0;
      const ruralAllowance  = parseFloat($("manual-rural-allowance")?.value || "0") || 0;
      const otherAllowance  = parseFloat($("manual-other-allowance")?.value || "0") || 0;
      const consolidatePay  = parseFloat($("manual-consolidate-pay")?.value || "0") || 0;
      const dailyWages      = parseFloat($("manual-daily-wages")?.value     || "0") || 0;
      const ms              = parseFloat($("manual-ms")?.value              || "0") || 0;
      const tourTa          = parseFloat($("manual-tour-ta")?.value         || "0") || 0;
      const mr              = parseFloat($("manual-mr")?.value              || "0") || 0;
      const encashDate      = ($("manual-encash-date")?.value       || "").trim();
      const remarks         = ($("manual-remarks")?.value           || "").trim();

      if (!billNo) { toast("Bill No is required.", "error"); return; }

      const grossAmount = pay + da + hra + cca + pgAllowance + ruralAllowance +
                          otherAllowance + consolidatePay + dailyWages + ms + tourTa + mr;

      if (grossAmount <= 0) { toast("At least one salary component must be greater than 0.", "error"); return; }

      const row = {
        billType, billNo, sparkCode,
        pay, da, hra, cca, pgAllowance, ruralAllowance, otherAllowance,
        consolidatePay, dailyWages, ms, tourTa, mr,
        grossAmount, encashDate, remarks,
      };

      const existingIdx = _tableRows.findIndex(r => r.billNo === billNo);
      if (existingIdx !== -1) {
        const choice = await _showConfirmModal(
          "Duplicate Bill",
          `Bill No "${billNo}" already exists. Do you want to replace it?`,
          "Yes, Replace", "No, Add Duplicate", "Cancel"
        );

        if (choice === "YES") {
          _tableRows[existingIdx] = row;
          _renderTable();
          _clearManualForm();
          toast("Row replaced.", "success");
        } else if (choice === "NO") {
          _addRows([row]);
          _clearManualForm();
          toast("Row added.", "success");
        }
        return;
      }

      _addRows([row]);
      _clearManualForm();
      toast("Row added.", "success");
    });
  }

  function _clearManualForm() {
    const numIds = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr"
    ];
    ["manual-bill-no", "manual-spark-code", "manual-encash-date", "manual-remarks"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    numIds.forEach(id => { const el = $(id); if (el) el.value = "0"; });
    const grossEl = $("manual-gross-amount");
    if (grossEl) grossEl.value = "₹ 0.00";
  }

  // ── Save to Sheet ──────────────────────────────────────────────────────────
  function _bindSaveButton() {
    const btn = $("save-to-sheet-btn");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      if (!TbrAuth.isSignedIn()) { toast("Please sign in with Google first.", "error"); return; }
      if (_tableRows.length === 0) { toast("No data to save. Add rows first.", "error"); return; }

      const { finYear, month } = _getSelectedPeriod();
      if (!finYear || !month) return;

      const choice = await _showConfirmModal(
        "Save to Google Sheet",
        `This will save the current ${_tableRows.length} row(s) to the sheet for ${month} ${finYear}. Continue?`,
        "Yes, Save", "No, Don't Save", "Cancel"
      );

      if (choice !== "YES") return;

      setLoading(true, "Saving to Google Sheets…");
      try {
        const C = TBR_CONFIG.COLUMNS;
        // Total columns after removing FinYear and Month (they are prepended by savePeriodData)
        const colCount = TBR_CONFIG.HEADER_ROW.length - 2;

        const sheetRows = _tableRows.map(r => {
          const row = new Array(colCount).fill("");
          row[C.BILL_TYPE       - 2] = r.billType        || "";
          row[C.BILL_NO         - 2] = r.billNo          || "";
          row[C.SPARK_CODE      - 2] = r.sparkCode       || "";
          row[C.PAY             - 2] = r.pay             || 0;
          row[C.DA              - 2] = r.da              || 0;
          row[C.HRA             - 2] = r.hra             || 0;
          row[C.CCA             - 2] = r.cca             || 0;
          row[C.PG_ALLOWANCE    - 2] = r.pgAllowance     || 0;
          row[C.RURAL_ALLOWANCE - 2] = r.ruralAllowance  || 0;
          row[C.OTHER_ALLOWANCE - 2] = r.otherAllowance  || 0;
          row[C.CONSOLIDATE_PAY - 2] = r.consolidatePay  || 0;
          row[C.DAILY_WAGES     - 2] = r.dailyWages      || 0;
          row[C.MS              - 2] = r.ms              || 0;
          row[C.TOUR_TA         - 2] = r.tourTa          || 0;
          row[C.MR              - 2] = r.mr              || 0;
          row[C.GROSS_AMOUNT    - 2] = r.grossAmount      || 0;
          row[C.ENCASH_DATE     - 2] = r.encashDate      || "";
          row[C.REMARKS         - 2] = r.remarks         || "";
          return row;
        });

        await TbrApi.savePeriodData(finYear, month, sheetRows);
        toast(`Saved ${_tableRows.length} row(s) for ${month} ${finYear}.`, "success");
      } catch (err) {
        toast(`Save failed: ${err.message}`, "error");
      } finally {
        setLoading(false);
      }
    });
  }

  // ── Clear Table Button ─────────────────────────────────────────────────────
  function _bindClearButton() {
    const btn = $("clear-table-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (_tableRows.length === 0) return;
      const choice = await _showConfirmModal(
        "Clear Table",
        "Clear all rows from the preview table? This cannot be undone.",
        "Yes, Clear", "Cancel", "Cancel"
      );
      if (choice === "YES") {
        _tableRows = [];
        _renderTable();
        toast("Table cleared.", "info");
      }
    });
  }

  // ── Auth callbacks ─────────────────────────────────────────────────────────
  function _onSignIn() {
    TbrApi.ensureSpreadsheet()
      .then(() => _loadPeriodData())
      .catch(err => toast(`Could not connect to spreadsheet: ${err.message}`, "error"));
  }

  function _onSignOut() {
    _tableRows = [];
    _renderTable();
    toast("Signed out.", "info");
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    _populatePeriodSelectors();
    _bindPeriodSelectors();
    _bindPdfUpload();
    _bindManualEntryForm();
    _bindGrossCalculator();
    _bindSaveButton();
    _bindClearButton();
    _renderTable();

    TbrAuth.onSignIn(_onSignIn);
    TbrAuth.onSignOut(_onSignOut);
    TbrAuth.bindButtons();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrDashboard.init());
