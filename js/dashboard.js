/**
 * dashboard.js
 * ============
 */

const TbrDashboard = (() => {
  let _tableRows = []; 
  let _currentSearchQuery = ""; // സെർച്ച് ചെയ്യാനുള്ള വാല്യൂ സൂക്ഷിക്കാൻ

  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

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

  function setLoading(active, msg = "Processing…") {
    const overlay = $("loading-overlay");
    const msgEl   = $("loading-message");
    if (overlay) overlay.classList.toggle("hidden", !active);
    if (msgEl && msg) msgEl.textContent = msg;
  }

  function _showConfirmModal(title, message, yesText = "Yes", noText = "No", cancelText = "Cancel") {
    return new Promise((resolve) => {
      const modal = $("custom-modal");
      if (!modal) return resolve("YES"); 
      $("modal-title").textContent = title; $("modal-message").textContent = message;
      $("modal-yes").textContent = yesText; $("modal-no").textContent = noText; $("modal-cancel").textContent = cancelText;
      show(modal);
      const cleanup = () => {
        hide(modal); const y = $("modal-yes"), n = $("modal-no"), c = $("modal-cancel");
        y.replaceWith(y.cloneNode(true)); n.replaceWith(n.cloneNode(true)); c.replaceWith(c.cloneNode(true));
      };
      $("modal-yes").addEventListener("click", () => { cleanup(); resolve("YES"); });
      $("modal-no").addEventListener("click", () => { cleanup(); resolve("NO"); });
      $("modal-cancel").addEventListener("click", () => { cleanup(); resolve("CANCEL"); });
    });
  }

  function _populatePeriodSelectors() {
    const fySelect = $("select-fin-year"), monthSelect = $("select-month");
    if (!fySelect || !monthSelect) return;
    const now = new Date(); const currentFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    fySelect.innerHTML = "";
    for (let y = currentFY + 1; y >= currentFY - 2; y--) {
      const opt = document.createElement("option"); opt.value = `${y}-${String(y + 1).slice(-2)}`; opt.textContent = `${y}-${String(y + 1).slice(-2)}`;
      if (y === currentFY) opt.selected = true; fySelect.appendChild(opt);
    }
    monthSelect.innerHTML = "";
    TBR_CONFIG.FY_MONTHS.forEach(m => { const opt = document.createElement("option"); opt.value = m; opt.textContent = m; monthSelect.appendChild(opt); });
    const monthIdx = [3,4,5,6,7,8,9,10,11,0,1,2].indexOf(now.getMonth());
    monthSelect.value = TBR_CONFIG.FY_MONTHS[monthIdx] || TBR_CONFIG.FY_MONTHS[0];
  }

  function _getSelectedPeriod() { return { finYear: ($("select-fin-year")?.value || "").trim(), month: ($("select-month")?.value || "").trim() }; }

  function _bindPeriodSelectors() {
    $("select-fin-year")?.addEventListener("change", _loadPeriodData);
    $("select-month")?.addEventListener("change", _loadPeriodData);
  }

  // ── Universal Search Listener ──
  function _bindSearch() {
    const searchInput = $("universal-search");
    if (!searchInput) return;
    searchInput.addEventListener("input", (e) => {
      _currentSearchQuery = e.target.value.trim().toLowerCase();
      _renderTable(); // ടൈപ്പ് ചെയ്യുന്നതിനനുസരിച്ച് ലൈവ് ആയി ടേബിൾ മാറും
    });
  }

  async function _loadPeriodData() {
    if (!TbrAuth.isSignedIn()) return;
    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) return;
    setLoading(true, `Loading existing bills for ${month}…`);
    try {
      const sheetRows = await TbrApi.fetchRowsForPeriod(finYear, month);
      const C = TBR_CONFIG.COLUMNS;
      _tableRows = sheetRows.map(row => ({
        billType: row[C.BILL_TYPE] || "SPARK", billNo: row[C.BILL_NO] || "", 
        sparkCode: row[C.SPARK_CODE] || "", treasury: row[C.TREASURY] || "", 
        ddoCode: row[C.DDO_CODE] || "", department: row[C.DEPT] || "", officeName: row[C.OFFICE_NAME] || "",
        basicLess: parseFloat(row[C.BASIC]) || 0, da: parseFloat(row[C.DA]) || 0, 
        hra: parseFloat(row[C.HRA]) || 0, cca: parseFloat(row[C.CCA]) || 0,
        otherAllowances: parseFloat(row[C.OTHER_ALLOWANCES]) || 0, 
        netAmount: parseFloat(row[C.NET_AMOUNT]) || 0,
        encashmentDate: row[C.ENCASHMENT_DATE] || "",
        remarks: row[C.REMARKS] || "",
        MJH: row[C.MJH] || "00", SMJH: row[C.SMJH] || "00", MIH: row[C.MIH] || "00",
        SBHLH: row[C.SBHLH] || "00", SHLH: row[C.SHLH] || "00", VOH: row[C.VOH] || "00", SOH: row[C.SOH] || "00",
        canonicalHoA: [row[C.MJH]||"00", row[C.SMJH]||"00", row[C.MIH]||"00", row[C.SBHLH]||"00", row[C.SHLH]||"00", row[C.VOH]||"00", row[C.SOH]||"00"].join("-")
      }));
      _renderTable();
      if (_tableRows.length > 0) toast(`Loaded ${_tableRows.length} existing bill(s) for ${month}.`, "info");
    } catch (err) { toast(`Failed to load existing data.`, "error"); } finally { setLoading(false); }
  }

  const COL_DEFS = [
    { key: "billType",    label: "Type" },
    { key: "billNo",      label: "Bill No" }, 
    { key: "sparkCode",   label: "Spark Code" },
    { key: "basicLess",   label: "Pay" },
    { key: "da",          label: "DA" },
    { key: "hra",         label: "HRA" },
    { key: "cca",         label: "CCA" },
    { key: "otherAllowances", label: "Other Allow." },
    { key: "netAmount",   label: "Gross" },
    { key: "encashmentDate", label: "Encashment" },
    { key: "remarks",     label: "Remarks" },
  ];

  function _renderTable() {
    const tbody = $("bill-table-body"); const emptyState = $("table-empty-state");
    if (!tbody) return; tbody.innerHTML = "";

    // Search Filtering Logic
    const filteredRows = _tableRows.filter(row => {
      if (!_currentSearchQuery) return true;
      // Object ൽ ഉള്ള ഏതെങ്കിലും വാല്യൂയിൽ സെർച്ച് ചെയ്യുന്ന വാക്കുണ്ടോ എന്ന് പരിശോധിക്കുന്നു
      return Object.values(row).some(val => 
        String(val).toLowerCase().includes(_currentSearchQuery)
      );
    });

    if (filteredRows.length === 0) { 
      if (emptyState) show(emptyState); 
      const badge = $("row-count-badge"); if (badge) badge.textContent = `0 rows`;
      return; 
    }
    if (emptyState) hide(emptyState);

    filteredRows.forEach((row) => {
      const tr = document.createElement("tr"); tr.className = "border-b border-gray-200 hover:bg-sky-50"; 
      
      COL_DEFS.forEach(col => {
        const td = document.createElement("td"); td.className = "px-2 py-2 whitespace-nowrap text-gray-700";
        
        if (col.key === "billNo") {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "border border-sky-300 rounded px-2 py-1 text-xs w-[110px] outline-none focus:ring-2 focus:ring-sky-500 bg-white font-semibold";
          inp.value = row[col.key] || "";
          inp.addEventListener("input", (e) => { row[col.key] = e.target.value; });
          td.appendChild(inp);
        } else if (col.key === "encashmentDate") {
          const inp = document.createElement("input");
          inp.type = "date";
          inp.className = "border border-sky-300 rounded px-1 py-1 text-xs w-[110px] outline-none focus:ring-2 focus:ring-sky-500 bg-white cursor-pointer";
          inp.value = row[col.key] || "";
          inp.addEventListener("change", (e) => { row[col.key] = e.target.value; });
          td.appendChild(inp);
        } else if (col.key === "remarks") {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "border border-sky-300 rounded px-2 py-1 text-xs w-[180px] outline-none focus:ring-2 focus:ring-sky-500 bg-white";
          inp.value = row[col.key] || "";
          inp.addEventListener("input", (e) => { row[col.key] = e.target.value; });
          td.appendChild(inp);
        } else if (["netAmount", "basicLess", "da", "hra", "cca", "otherAllowances"].includes(col.key)) {
          td.className += " text-right font-mono font-semibold";
          if (col.key === "netAmount") td.className += " text-sky-700";
          if (col.key === "otherAllowances" && row[col.key] > 0) td.className += " text-indigo-600";
          td.textContent = _formatCurrency(row[col.key]);
        } else {
          td.className += " truncate max-w-[120px]"; td.title = row[col.key] || ""; td.textContent = row[col.key] || "—";
        }
        tr.appendChild(td);
      });

      const tdDel = document.createElement("td"); tdDel.className = "px-2 py-2 text-center";
      const btn = document.createElement("button"); btn.className = "text-red-500 hover:text-red-700 text-sm font-bold bg-red-50 px-2 py-1 rounded transition";
      btn.textContent = "✕"; 
      btn.addEventListener("click", () => _deleteRow(row)); // ഒറിജിനൽ row വെച്ച് ഡിലീറ്റ് ചെയ്യുന്നു
      tdDel.appendChild(btn); tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
    const badge = $("row-count-badge"); if (badge) badge.textContent = `${filteredRows.length} row${filteredRows.length !== 1 ? "s" : ""}`;
  }

  function _deleteRow(rowRef) { 
    const idx = _tableRows.indexOf(rowRef);
    if(idx !== -1) {
      _tableRows.splice(idx, 1); 
      _renderTable(); 
    }
  }

  function _addRows(rows) { rows.forEach(r => { if (!r.canonicalHoA && r.MJH) r.canonicalHoA = TbrParser.canonicalHoA(r); _tableRows.push(r); }); _renderTable(); }
  function _formatCurrency(val) { const n = parseFloat(val) || 0; return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function _bindPdfUpload() {
    const input = $("pdf-file-input"), dropzone = $("pdf-dropzone"), uploadBtn = $("pdf-upload-btn");
    if (uploadBtn && input) uploadBtn.addEventListener("click", () => input.click());
    if (input) input.addEventListener("change", (e) => _handleFiles(e.target.files));
    if (dropzone) {
      dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("border-sky-500", "bg-sky-50"); });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("border-sky-500", "bg-sky-50"));
      dropzone.addEventListener("drop", e => { e.preventDefault(); dropzone.classList.remove("border-sky-500", "bg-sky-50"); _handleFiles(e.dataTransfer.files); });
    }
  }

  async function _handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (files.length === 0) { toast("Please select PDF files only.", "error"); return; }
    setLoading(true, `Parsing ${files.length} PDF file(s)…`); let successCount = 0;
    for (const file of files) {
      try { const rows = await TbrParser.parsePdf(file); _addRows(rows); successCount++; } catch (err) { toast(`${file.name}: ${err.message}`, "error"); }
    }
    setLoading(false);
    if (successCount > 0) toast(`Successfully parsed ${successCount} PDF(s).`, "success");
    if ($("pdf-file-input")) $("pdf-file-input").value = "";
  }

  function _bindManualEntryForm() {
    const addBtn = $("manual-add-btn"); if (!addBtn) return;

    const inputs = ["manual-basic-less", "manual-da", "manual-hra", "manual-cca", "manual-other-allow"];
    inputs.forEach(id => {
      $(id)?.addEventListener("input", () => {
        let total = 0;
        inputs.forEach(inputId => total += TbrParser.parseAmount($(inputId)?.value || "0"));
        $("manual-net-amount").value = total > 0 ? total.toFixed(2) : "";
      });
    });

    addBtn.addEventListener("click", async () => {
      const billType   = ($("manual-bill-type")?.value || "SPARK").trim();
      const billNo     = ($("manual-bill-no")?.value   || "").trim();
      const sparkCode  = ($("manual-spark-code")?.value|| "").trim();
      const treasury   = ($("manual-treasury")?.value  || "").trim();
      const ddoCode    = ($("manual-ddo-code")?.value  || "").trim();
      const department = ($("manual-dept")?.value      || "").trim();
      const officeName = ""; 
      const basicLess  = TbrParser.parseAmount($("manual-basic-less")?.value || "0");
      const da         = TbrParser.parseAmount($("manual-da")?.value || "0");
      const hra        = TbrParser.parseAmount($("manual-hra")?.value || "0");
      const cca        = TbrParser.parseAmount($("manual-cca")?.value || "0");
      const otherAllowances = TbrParser.parseAmount($("manual-other-allow")?.value || "0");
      const netAmount  = TbrParser.parseAmount($("manual-net-amount")?.value || "0");
      const hoaStr     = ($("manual-hoa")?.value       || "").trim();
      const encashmentDate = ($("manual-encash-date")?.value || "").trim();
      const remarks        = ($("manual-remarks")?.value || "").trim();

      if (!billNo) { toast("Bill No is required.", "error"); return; }
      if (!hoaStr) { toast("Head of Account is required.", "error"); return; }
      if (netAmount <= 0) { toast("Gross Salary must be greater than 0.", "error"); return; }

      let hoa; try { hoa = billType === "SPARK" ? TbrParser.parseSparkHoA(hoaStr) : TbrParser.parseBimsHoA(hoaStr); } catch (e) { toast("Invalid Head of Account format.", "error"); return; }

      const row = { billType, billNo, sparkCode, treasury, ddoCode, department, officeName, basicLess, da, hra, cca, otherAllowances, netAmount, encashmentDate, remarks, rawHoA: hoaStr, canonicalHoA: TbrParser.canonicalHoA(hoa), ...hoa };

      const existingIdx = _tableRows.findIndex(r => r.billNo === billNo);
      if (existingIdx !== -1) {
        const choice = await _showConfirmModal("Duplicate Bill", `Bill No "${billNo}" already exists in the table. Do you want to replace it?`, "Yes, Replace", "No, Add Duplicate", "Cancel");
        if (choice === "YES") { _tableRows[existingIdx] = row; _renderTable(); _clearManualForm(); toast("Row replaced.", "success"); } 
        else if (choice === "NO") { _addRows([row]); _clearManualForm(); toast("Row added.", "success"); }
        return; 
      }
      _addRows([row]); _clearManualForm(); toast("Row added.", "success");
    });
  }

  function _clearManualForm() {
    ["manual-bill-no", "manual-spark-code", "manual-treasury", "manual-ddo-code", "manual-dept", "manual-hoa", "manual-basic-less", "manual-da", "manual-hra", "manual-cca", "manual-other-allow", "manual-net-amount", "manual-encash-date", "manual-remarks"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
  }

  function _bindSaveButton() {
    const btn = $("save-to-sheet-btn"); if (!btn) return;
    btn.addEventListener("click", async () => {
      if (!TbrAuth.isSignedIn()) { toast("Please sign in with Google first.", "error"); return; }
      if (_tableRows.length === 0) { toast("No data to save. Add rows first.", "error"); return; }
      const { finYear, month } = _getSelectedPeriod(); if (!finYear || !month) return;
      const choice = await _showConfirmModal("Save to Google Sheet", `This will save the current ${_tableRows.length} row(s) to the sheet for ${month} ${finYear}. Continue?`, "Yes, Save", "No, Don't Save", "Cancel");
      if (choice !== "YES") return; 

      setLoading(true, "Saving to Google Sheets…");
      try {
        const C = TBR_CONFIG.COLUMNS;
        const sheetRows = _tableRows.map(r => {
          const row = new Array(TBR_CONFIG.HEADER_ROW.length - 2).fill("");
          row[C.FIN_YEAR   - 2] = finYear;      row[C.MONTH      - 2] = month;
          row[C.BILL_TYPE  - 2] = r.billType    || ""; row[C.BILL_NO    - 2] = r.billNo      || "";
          row[C.SPARK_CODE - 2] = r.sparkCode   || ""; row[C.TREASURY   - 2] = r.treasury    || "";
          row[C.DDO_CODE   - 2] = r.ddoCode     || ""; row[C.DEPT       - 2] = r.department  || "";
          row[C.OFFICE_NAME- 2] = r.officeName  || "";
          row[C.MJH        - 2] = r.MJH ? `'${r.MJH}` : "'00"; row[C.SMJH       - 2] = r.SMJH ? `'${r.SMJH}` : "'00";
          row[C.MIH        - 2] = r.MIH ? `'${r.MIH}` : "'00"; row[C.SBHLH      - 2] = r.SBHLH ? `'${r.SBHLH}` : "'00";
          row[C.SHLH       - 2] = r.SHLH ? `'${r.SHLH}` : "'00"; row[C.VOH        - 2] = r.VOH ? `'${r.VOH}` : "'00";
          row[C.SOH        - 2] = r.SOH ? `'${r.SOH}` : "'00";
          row[C.BASIC      - 2] = r.basicLess   || 0;  row[C.DA         - 2] = r.da          || 0;
          row[C.HRA        - 2] = r.hra         || 0;  row[C.CCA        - 2] = r.cca         || 0;
          row[C.OTHER_ALLOWANCES - 2] = r.otherAllowances || 0;
          row[C.NET_AMOUNT - 2] = r.netAmount   || 0;
          row[C.ENCASHMENT_DATE - 2] = r.encashmentDate || "";
          row[C.REMARKS    - 2] = r.remarks     || "";
          return row;
        });
        await TbrApi.savePeriodData(finYear, month, sheetRows);
        toast(`Saved ${_tableRows.length} row(s) for ${month} ${finYear}.`, "success");
      } catch (err) { toast(`Save failed: ${err.message}`, "error"); } finally { setLoading(false); }
    });
  }

  function _bindClearButton() {
    const btn = $("clear-table-btn"); if (!btn) return;
    btn.addEventListener("click", () => {
      if (_tableRows.length === 0) return;
      if (confirm("Clear all rows from the preview table?")) { 
        _tableRows = []; 
        const searchInput = $("universal-search");
        if(searchInput) searchInput.value = "";
        _currentSearchQuery = "";
        _renderTable(); 
        toast("Table cleared.", "info"); 
      }
    });
  }

  function _onSignIn() { TbrApi.ensureSpreadsheet().then(() => _loadPeriodData()).catch(err => toast(`Could not connect to spreadsheet: ${err.message}`, "error")); }
  function _onSignOut() { 
    _tableRows = []; 
    _currentSearchQuery = "";
    const searchInput = $("universal-search");
    if(searchInput) searchInput.value = "";
    _renderTable(); 
    toast("Signed out.", "info"); 
  }

  function init() {
    _populatePeriodSelectors(); _bindPeriodSelectors(); _bindPdfUpload(); _bindManualEntryForm(); _bindSaveButton(); _bindClearButton(); _bindSearch(); _renderTable();
    TbrAuth.onSignIn(_onSignIn); TbrAuth.onSignOut(_onSignOut); TbrAuth.bindButtons();
  }
  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrDashboard.init());