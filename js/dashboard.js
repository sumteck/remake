/**
 * dashboard.js
 * ============
 * All logic for the Dashboard (data-entry) page.
 */

const TbrDashboard = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _tableRows = [];   // Array of row data objects currently in the preview table

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
      if (!modal) return resolve("YES"); // Fallback

      $("modal-title").textContent = title;
      $("modal-message").textContent = message;
      $("modal-yes").textContent = yesText;
      $("modal-no").textContent = noText;
      $("modal-cancel").textContent = cancelText;

      show(modal);

      const cleanup = () => {
        hide(modal);
        // Replace nodes to clear event listeners
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
        billType:   row[C.BILL_TYPE]  || "SPARK",
        billNo:     row[C.BILL_NO]    || "",
        ddoCode:    row[C.DDO_CODE]   || "",
        department: row[C.DEPT]       || "",
        netAmount:  parseFloat(row[C.NET_AMOUNT]) || 0,
        MJH:        row[C.MJH]        || "00",
        SMJH:       row[C.SMJH]       || "00",
        MIH:        row[C.MIH]        || "00",
        SBHLH:      row[C.SBHLH]      || "00",
        SHLH:       row[C.SHLH]       || "00",
        VOH:        row[C.VOH]        || "00",
        SOH:        row[C.SOH]        || "00",
        canonicalHoA: [
          row[C.MJH] || "00", row[C.SMJH] || "00", row[C.MIH] || "00",
          row[C.SBHLH] || "00", row[C.SHLH] || "00", row[C.VOH] || "00", row[C.SOH] || "00"
        ].join("-")
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

  // ── Preview Table ──────────────────────────────────────────────────────────
  const COL_DEFS = [
    { key: "billType",    label: "Type"        },
    { key: "billNo",      label: "Bill No"      },
    { key: "ddoCode",     label: "DDO Code"     },
    { key: "department",  label: "Department"   },
    { key: "canonicalHoA",label: "Head of A/C"  },
    { key: "netAmount",   label: "Net Amount"   },
  ];

  function _renderTable() {
    const tbody = $("bill-table-body");
    const emptyState = $("table-empty-state");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (_tableRows.length === 0) {
      if (emptyState) show(emptyState);
      return;
    }
    if (emptyState) hide(emptyState);

    _tableRows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-gray-200 hover:bg-sky-50 text-sm";
      tr.dataset.idx = idx;

      COL_DEFS.forEach(col => {
        const td = document.createElement("td");
        td.className = "px-3 py-2 whitespace-nowrap";
        if (col.key === "netAmount") {
          td.className += " text-right font-mono";
          td.textContent = _formatCurrency(row[col.key]);
        } else {
          td.textContent = row[col.key] || "—";
        }
        tr.appendChild(td);
      });

      const tdDel = document.createElement("td");
      tdDel.className = "px-3 py-2 text-center";
      const btn = document.createElement("button");
      btn.className = "text-red-500 hover:text-red-700 text-xs font-semibold";
      btn.textContent = "✕";
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
      if (!r.canonicalHoA && r.MJH) r.canonicalHoA = TbrParser.canonicalHoA(r);
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
      dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("border-sky-500"); });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("border-sky-500"));
      dropzone.addEventListener("drop", e => {
        e.preventDefault(); dropzone.classList.remove("border-sky-500");
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
        _addRows(rows);
        successCount++;
      } catch (err) { toast(`${file.name}: ${err.message}`, "error"); }
    }
    setLoading(false);
    if (successCount > 0) toast(`Successfully parsed ${successCount} PDF(s).`, "success");
    if ($("pdf-file-input")) $("pdf-file-input").value = "";
  }

  // ── Manual Entry Form ──────────────────────────────────────────────────────
  function _bindManualEntryForm() {
    const form = $("manual-entry-form"), addBtn = $("manual-add-btn");
    if (!form || !addBtn) return;

    addBtn.addEventListener("click", async () => {
      const billType   = ($("manual-bill-type")?.value || "SPARK").trim();
      const billNo     = ($("manual-bill-no")?.value   || "").trim();
      const ddoCode    = ($("manual-ddo-code")?.value  || "").trim();
      const department = ($("manual-dept")?.value      || "").trim();
      const netAmount  = TbrParser.parseAmount($("manual-net-amount")?.value || "0");
      const hoaStr     = ($("manual-hoa")?.value       || "").trim();

      if (!billNo) { toast("Bill No is required.", "error"); return; }
      if (!hoaStr) { toast("Head of Account is required.", "error"); return; }
      if (netAmount <= 0) { toast("Net Amount must be greater than 0.", "error"); return; }

      let hoa;
      try { hoa = billType === "SPARK" ? TbrParser.parseSparkHoA(hoaStr) : TbrParser.parseBimsHoA(hoaStr); } 
      catch (e) { toast("Invalid Head of Account format.", "error"); return; }

      const row = {
        billType, billNo, ddoCode, department, netAmount, rawHoA: hoaStr,
        canonicalHoA: TbrParser.canonicalHoA(hoa), ...hoa,
      };

      // കസ്റ്റം പോപ്പ്അപ്പ് ചെക്കിംഗ് (For Manual Duplicate Bills)
      const existingIdx = _tableRows.findIndex(r => r.billNo === billNo);
      if (existingIdx !== -1) {
        const choice = await _showConfirmModal(
          "Duplicate Bill",
          `Bill No "${billNo}" already exists in the table. Do you want to replace it?`,
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
        return; // 'CANCEL' കൊടുക്കുമ്പോൾ ഒന്നും സംഭവിക്കില്ല
      }

      _addRows([row]);
      _clearManualForm();
      toast("Row added.", "success");
    });
  }

  function _clearManualForm() {
    ["manual-bill-no", "manual-ddo-code", "manual-dept", "manual-net-amount", "manual-hoa"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
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

      // കസ്റ്റം പോപ്പ്അപ്പ് ബോക്സ് (Save button)
      const choice = await _showConfirmModal(
        "Save to Google Sheet",
        `This will save the current ${_tableRows.length} row(s) to the sheet for ${month} ${finYear}. Continue?`,
        "Yes, Save", "No, Don't Save", "Cancel"
      );

      if (choice !== "YES") return; // No അല്ലെങ്കിൽ Cancel അടിച്ചാൽ സേവ് ആകില്ല

      setLoading(true, "Saving to Google Sheets…");
      try {
        const C = TBR_CONFIG.COLUMNS;
        const sheetRows = _tableRows.map(r => {
          const row = new Array(TBR_CONFIG.HEADER_ROW.length - 2).fill("");
          row[C.BILL_TYPE  - 2] = r.billType    || "";
          row[C.BILL_NO    - 2] = r.billNo      || "";
          row[C.DDO_CODE   - 2] = r.ddoCode     || "";
          row[C.DEPT       - 2] = r.department  || "";
          row[C.NET_AMOUNT - 2] = r.netAmount   || 0;
          row[C.MJH        - 2] = r.MJH         || "";
          row[C.SMJH       - 2] = r.SMJH        || "";
          row[C.MIH        - 2] = r.MIH         || "";
          row[C.SBHLH      - 2] = r.SBHLH       || "";
          row[C.SHLH       - 2] = r.SHLH        || "";
          row[C.VOH        - 2] = r.VOH         || "";
          row[C.SOH        - 2] = r.SOH         || "";
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
    btn.addEventListener("click", () => {
      if (_tableRows.length === 0) return;
      if (confirm("Clear all rows from the preview table?")) {
        _tableRows = [];
        _renderTable();
        toast("Table cleared.", "info");
      }
    });
  }

  // ── Auth callbacks ─────────────────────────────────────────────────────────
  function _onSignIn() {
    TbrApi.ensureSpreadsheet()
      .then(() => _loadPeriodData()) // ലോഗിൻ ചെയ്യുമ്പോൾ തന്നെ ഡാറ്റ ലോഡ് ചെയ്യുന്നു
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