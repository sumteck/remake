/**
 * dashboard.js  (v3 — Inline editing, arrow-key navigation, blank num inputs)
 * ============
 * All logic for the Dashboard (data-entry) page.
 *
 * CHANGELOG v3
 * ────────────
 * • Added TREASURY + DEPARTMENT columns to match config.js v3 (22 cols).
 * • _handleFiles() now maps parser.js v3 rich output (treasury, sparkCode,
 *   department, all salary components, grossAmount, remarks) directly.
 * • _renderTable(): Bill No, Encash Date, and Remarks cells are now
 *   inline-editable via contenteditable — changes sync to _tableRows[].
 * • _bindArrowKeyNav(): Left/Right arrow keys navigate between numeric
 *   amount inputs in the manual entry form. Mouse click focus preserved.
 * • Number inputs in the manual form default to "" (blank) instead of "0".
 * • _clearManualForm() resets numeric fields to "" (blank).
 * • _bindGrossCalculator() handles blank/empty values gracefully.
 * • savePeriodData() writes all 22 columns via updated TBR_CONFIG.COLUMNS.
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
    div.className = `${colours[type] || colours.info} text-white text-sm px-4 py-3 rounded shadow-lg mb-2 transition-all duration-300 pointer-events-auto`;
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

      $("modal-title").textContent    = title;
      $("modal-message").textContent  = message;
      $("modal-yes").textContent      = yesText;
      $("modal-no").textContent       = noText;
      $("modal-cancel").textContent   = cancelText;

      show(modal);

      const cleanup = () => {
        hide(modal);
        ["modal-yes", "modal-no", "modal-cancel"].forEach(id => {
          const el = $(id);
          if (el) el.replaceWith(el.cloneNode(true));
        });
      };

      $("modal-yes").addEventListener("click",    () => { cleanup(); resolve("YES"); });
      $("modal-no").addEventListener("click",     () => { cleanup(); resolve("NO"); });
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
      opt.value = m; opt.textContent = m;
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
    $("select-month")?.addEventListener("change",   _loadPeriodData);
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
        billType:        row[C.BILL_TYPE]          || "SPARK",
        billNo:          row[C.BILL_NO]            || "",
        treasury:        row[C.TREASURY]           || "",
        sparkCode:       row[C.SPARK_CODE]         || "",
        department:      row[C.DEPARTMENT]         || "",
        pay:             parseFloat(row[C.PAY])             || 0,
        da:              parseFloat(row[C.DA])              || 0,
        hra:             parseFloat(row[C.HRA])             || 0,
        cca:             parseFloat(row[C.CCA])             || 0,
        pgAllowance:     parseFloat(row[C.PG_ALLOWANCE])    || 0,
        ruralAllowance:  parseFloat(row[C.RURAL_ALLOWANCE]) || 0,
        otherAllowance:  parseFloat(row[C.OTHER_ALLOWANCE]) || 0,
        consolidatePay:  parseFloat(row[C.CONSOLIDATE_PAY]) || 0,
        dailyWages:      parseFloat(row[C.DAILY_WAGES])     || 0,
        ms:              parseFloat(row[C.MS])              || 0,
        tourTa:          parseFloat(row[C.TOUR_TA])         || 0,
        mr:              parseFloat(row[C.MR])              || 0,
        grossAmount:     parseFloat(row[C.GROSS_AMOUNT])    || 0,
        encashDate:      row[C.ENCASH_DATE]                 || "",
        remarks:         row[C.REMARKS]                     || "",
      }));

      _renderTable();
      if (_tableRows.length > 0) {
        toast(`Loaded ${_tableRows.length} existing bill(s) for ${month}.`, "info");
      }
    } catch (err) {
      console.error(err);
      toast("Failed to load existing data.", "error");
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

  // ── Preview Table column definitions ──────────────────────────────────────
  const COL_DEFS = [
    { key: "billType",       label: "Type"             },
    { key: "billNo",         label: "Bill No",         editable: true  },
    { key: "treasury",       label: "Treasury"         },
    { key: "sparkCode",      label: "Spark Code/BRN"   },
    { key: "department",     label: "Department"       },
    { key: "pay",            label: "Pay",             num: true },
    { key: "da",             label: "DA",              num: true },
    { key: "hra",            label: "HRA",             num: true },
    { key: "cca",            label: "CCA",             num: true },
    { key: "pgAllowance",    label: "PG Allw.",        num: true },
    { key: "ruralAllowance", label: "Rural Allw.",     num: true },
    { key: "otherAllowance", label: "Other Allw.",     num: true },
    { key: "consolidatePay", label: "Cons. Pay",       num: true },
    { key: "dailyWages",     label: "Daily Wages",     num: true },
    { key: "ms",             label: "M&S",             num: true },
    { key: "tourTa",         label: "Tour TA",         num: true },
    { key: "mr",             label: "MR",              num: true },
    { key: "grossAmount",    label: "Gross Salary",    num: true, bold: true },
    { key: "encashDate",     label: "Encash Date",     editable: true  },
    { key: "remarks",        label: "Remarks",         editable: true  },
  ];

  // ── Format helpers ─────────────────────────────────────────────────────────
  function _formatCurrency(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Build an inline-editable cell ─────────────────────────────────────────
  /**
   * Creates a <td> whose content is directly editable.
   * On `blur` the value is written back to _tableRows[rowIdx][fieldKey].
   * `encashDate` uses a real <input type="date"> for the date-picker;
   * other editable fields use `contenteditable`.
   */
  function _makeEditableCell(value, rowIdx, fieldKey, extraClass = "") {
    const td = document.createElement("td");
    td.className = `px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono ${extraClass}`;

    if (fieldKey === "encashDate") {
      // Date input for proper date picker
      const inp = document.createElement("input");
      inp.type  = "date";
      inp.value = value || "";
      inp.className = "bg-transparent border-b border-dashed border-outline-variant focus:border-primary outline-none w-full text-data-mono font-data-mono cursor-pointer";
      inp.addEventListener("change", () => {
        _tableRows[rowIdx][fieldKey] = inp.value;
      });
      td.appendChild(inp);
    } else {
      // contenteditable span for text fields
      const span = document.createElement("span");
      span.contentEditable = "true";
      span.spellcheck      = false;
      span.textContent     = value || "";
      span.className       = "outline-none min-w-[60px] inline-block rounded px-1 " +
                             "focus:bg-sky-50 focus:ring-1 focus:ring-primary/30 cursor-text " +
                             (fieldKey === "remarks" ? "italic text-on-surface-variant" : "");

      // Sync on blur
      span.addEventListener("blur", () => {
        _tableRows[rowIdx][fieldKey] = span.textContent.trim();
      });

      // Prevent newlines (Enter = blur)
      span.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); span.blur(); }
      });

      td.appendChild(span);

      // Visual hint: dashed underline on hover
      td.title = "Click to edit";
      td.style.cursor = "text";
    }

    return td;
  }

  // ── Render preview table ───────────────────────────────────────────────────
  function _renderTable() {
    const tbody      = $("bill-table-body");
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
      tr.className = "table-row-hover transition-colors group " +
                     (idx % 2 === 0 ? "bg-white" : "bg-surface");
      tr.dataset.idx = idx;

      // ── Row number cell ──
      const tdN = document.createElement("td");
      tdN.className = "px-table-cell-padding-x py-table-cell-padding-y text-on-surface-variant font-data-mono text-data-mono select-none";
      tdN.textContent = idx + 1;
      tr.appendChild(tdN);

      // ── Data cells ──
      COL_DEFS.forEach(col => {
        if (col.editable) {
          const extraClass = col.key === "remarks" ? "italic text-on-surface-variant" :
                             col.key === "encashDate" ? "" : "";
          tr.appendChild(_makeEditableCell(row[col.key], idx, col.key, extraClass));
          return;
        }

        const td = document.createElement("td");
        td.className = "px-table-cell-padding-x py-table-cell-padding-y font-data-mono text-data-mono";

        if (col.num) {
          td.className += " text-right" + (col.bold ? " font-bold text-primary" : "");
          td.textContent = _formatCurrency(row[col.key]);
        } else if (col.key === "sparkCode") {
          td.className += " text-primary";
          td.textContent = row[col.key] || "—";
        } else if (col.key === "treasury") {
          td.className += " text-secondary text-xs";
          td.textContent = row[col.key] || "—";
        } else if (col.key === "department") {
          td.className += " text-on-surface-variant text-xs max-w-[140px] truncate";
          td.title       = row[col.key] || "";
          td.textContent = row[col.key] || "—";
        } else {
          td.textContent = row[col.key] || "—";
        }

        tr.appendChild(td);
      });

      // ── Delete button ──
      const tdDel = document.createElement("td");
      tdDel.className = "px-table-cell-padding-x py-table-cell-padding-y text-center";
      const btn = document.createElement("button");
      btn.className = "text-error hover:scale-110 transition-transform";
      btn.title     = "Delete row";
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
      // Only recompute gross if it wasn't already set by the parser
      if (!r.grossAmount || r.grossAmount === 0) {
        r.grossAmount = _computeGross(r);
      }
      _tableRows.push(r);
    });
    _renderTable();
  }

  // ── PDF Upload Handler ─────────────────────────────────────────────────────
  function _bindPdfUpload() {
    const input     = $("pdf-file-input");
    const dropzone  = $("pdf-dropzone");
    const uploadBtn = $("pdf-upload-btn");

    if (uploadBtn && input) uploadBtn.addEventListener("click", () => input.click());
    if (input) input.addEventListener("change", e => _handleFiles(e.target.files));

    if (dropzone) {
      const addHover    = () => { dropzone.classList.add("border-primary", "bg-surface-container-high"); };
      const removeHover = () => { dropzone.classList.remove("border-primary", "bg-surface-container-high"); };
      dropzone.addEventListener("dragover",  e => { e.preventDefault(); addHover(); });
      dropzone.addEventListener("dragleave", removeHover);
      dropzone.addEventListener("drop", e => { e.preventDefault(); removeHover(); _handleFiles(e.dataTransfer.files); });
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
        const parsed = await TbrParser.parsePdf(file);

        // parser.js v3 returns full structured objects — map directly
        const mapped = parsed.map(r => ({
          billType:        r.billType        || "SPARK",
          billNo:          r.billNo          || "",
          treasury:        r.treasury        || "",
          sparkCode:       r.sparkCode       || r.ddoCode || "",
          department:      r.department      || "",
          pay:             r.pay             || 0,
          da:              r.da              || 0,
          hra:             r.hra             || 0,
          cca:             r.cca             || 0,
          pgAllowance:     r.pgAllowance     || 0,
          ruralAllowance:  r.ruralAllowance  || 0,
          otherAllowance:  r.otherAllowance  || 0,
          consolidatePay:  r.consolidatePay  || 0,
          dailyWages:      r.dailyWages      || 0,
          ms:              r.ms              || 0,
          tourTa:          r.tourTa          || 0,
          mr:              r.mr              || 0,
          grossAmount:     r.grossAmount     || 0,
          encashDate:      r.encashDate      || "",
          remarks:         r.remarks         || "",
        }));

        _addRows(mapped);
        successCount++;
      } catch (err) {
        toast(`${file.name}: ${err.message}`, "error");
      }
    }

    setLoading(false);
    if (successCount > 0) {
      toast(`Parsed ${successCount} PDF(s) — verify salary fields and save.`, "success");
    }
    if ($("pdf-file-input")) $("pdf-file-input").value = "";
  }

  // ── Arrow-key navigation between amount inputs ─────────────────────────────
  /**
   * Within the manual entry numeric row, Left/Right arrow keys move focus
   * between adjacent amount inputs.  Mouse click focus is fully unaffected.
   */
  function _bindArrowKeyNav() {
    const numericIds = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr",
    ];

    numericIds.forEach((id, i) => {
      const el = $(id);
      if (!el) return;

      el.addEventListener("keydown", e => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault(); // prevent cursor movement inside the input
          const targetIdx = e.key === "ArrowRight" ? i + 1 : i - 1;
          if (targetIdx >= 0 && targetIdx < numericIds.length) {
            const targetEl = $(numericIds[targetIdx]);
            if (targetEl) {
              targetEl.focus();
              targetEl.select(); // select all for quick replacement
            }
          }
        }
      });
    });
  }

  // ── Live Gross Salary calculator ───────────────────────────────────────────
  function _bindGrossCalculator() {
    const numericIds = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr",
    ];
    const grossEl = $("manual-gross-amount");
    if (!grossEl) return;

    const recalc = () => {
      const total = numericIds.reduce((sum, id) => {
        const val = $(id)?.value;
        return sum + (val && val.trim() !== "" ? parseFloat(val) || 0 : 0);
      }, 0);
      grossEl.value = "₹ " + total.toLocaleString("en-IN", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    };

    numericIds.forEach(id => $(id)?.addEventListener("input", recalc));
    recalc();
  }

  // ── Manual Entry Form ──────────────────────────────────────────────────────
  function _bindManualEntryForm() {
    const form   = $("manual-entry-form");
    const addBtn = $("manual-add-btn");
    if (!form || !addBtn) return;

    addBtn.addEventListener("click", async () => {
      const v = id => ($(id)?.value || "").trim();
      const n = id => { const val = $(id)?.value; return (val && val.trim() !== "") ? parseFloat(val) || 0 : 0; };

      const billType       = v("manual-bill-type") || "SPARK";
      const billNo         = v("manual-bill-no");
      const treasury       = v("manual-treasury");
      const sparkCode      = v("manual-spark-code");
      const department     = v("manual-department");
      const pay            = n("manual-pay");
      const da             = n("manual-da");
      const hra            = n("manual-hra");
      const cca            = n("manual-cca");
      const pgAllowance    = n("manual-pg-allowance");
      const ruralAllowance = n("manual-rural-allowance");
      const otherAllowance = n("manual-other-allowance");
      const consolidatePay = n("manual-consolidate-pay");
      const dailyWages     = n("manual-daily-wages");
      const ms             = n("manual-ms");
      const tourTa         = n("manual-tour-ta");
      const mr             = n("manual-mr");
      const encashDate     = v("manual-encash-date");
      const remarks        = v("manual-remarks");

      if (!billNo) { toast("Bill No is required.", "error"); return; }

      const grossAmount = pay + da + hra + cca + pgAllowance + ruralAllowance +
                          otherAllowance + consolidatePay + dailyWages + ms + tourTa + mr;

      if (grossAmount <= 0) {
        toast("At least one salary component must be greater than 0.", "error");
        return;
      }

      const row = {
        billType, billNo, treasury, sparkCode, department,
        pay, da, hra, cca, pgAllowance, ruralAllowance, otherAllowance,
        consolidatePay, dailyWages, ms, tourTa, mr,
        grossAmount, encashDate, remarks,
      };

      const existingIdx = _tableRows.findIndex(r => r.billNo === billNo);
      if (existingIdx !== -1) {
        const choice = await _showConfirmModal(
          "Duplicate Bill",
          `Bill No "${billNo}" already exists. Replace it?`,
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
    const textIds = [
      "manual-bill-no", "manual-treasury", "manual-spark-code",
      "manual-department", "manual-encash-date", "manual-remarks",
    ];
    const numIds = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr",
    ];

    textIds.forEach(id => { const el = $(id); if (el) el.value = ""; });
    // Blank — not "0" — as per spec
    numIds.forEach(id => { const el = $(id); if (el) el.value = ""; });

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
        `Save ${_tableRows.length} row(s) for ${month} ${finYear}?`,
        "Yes, Save", "No, Don't Save", "Cancel"
      );
      if (choice !== "YES") return;

      setLoading(true, "Saving to Google Sheets…");
      try {
        const C        = TBR_CONFIG.COLUMNS;
        const colCount = TBR_CONFIG.HEADER_ROW.length - 2; // minus FinYear + Month

        const sheetRows = _tableRows.map(r => {
          const row = new Array(colCount).fill("");
          row[C.BILL_TYPE        - 2] = r.billType        || "";
          row[C.BILL_NO          - 2] = r.billNo          || "";
          row[C.TREASURY         - 2] = r.treasury        || "";
          row[C.SPARK_CODE       - 2] = r.sparkCode       || "";
          row[C.DEPARTMENT       - 2] = r.department      || "";
          row[C.PAY              - 2] = r.pay             || 0;
          row[C.DA               - 2] = r.da              || 0;
          row[C.HRA              - 2] = r.hra             || 0;
          row[C.CCA              - 2] = r.cca             || 0;
          row[C.PG_ALLOWANCE     - 2] = r.pgAllowance     || 0;
          row[C.RURAL_ALLOWANCE  - 2] = r.ruralAllowance  || 0;
          row[C.OTHER_ALLOWANCE  - 2] = r.otherAllowance  || 0;
          row[C.CONSOLIDATE_PAY  - 2] = r.consolidatePay  || 0;
          row[C.DAILY_WAGES      - 2] = r.dailyWages      || 0;
          row[C.MS               - 2] = r.ms              || 0;
          row[C.TOUR_TA          - 2] = r.tourTa          || 0;
          row[C.MR               - 2] = r.mr              || 0;
          row[C.GROSS_AMOUNT     - 2] = r.grossAmount      || 0;
          row[C.ENCASH_DATE      - 2] = r.encashDate      || "";
          row[C.REMARKS          - 2] = r.remarks         || "";
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

  // ── Clear Table ────────────────────────────────────────────────────────────
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
    _bindArrowKeyNav();
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
