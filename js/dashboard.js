/**
 * dashboard.js
 * Manages UI interactions, PDF uploads, and Google Sheets integration on the Dashboard.
 */

const TbrApp = (() => {

  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  let parsedBills = [];

  function toast(msg, type = "info") {
    const colours = { success: "bg-green-600", error: "bg-red-600", info: "bg-sky-600" };
    const container = $("toast-container");
    if (!container) return;
    const div = document.createElement("div");
    div.className = `${colours[type]} text-white text-sm px-4 py-3 rounded shadow-lg mb-2`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = "0"; setTimeout(() => div.remove(), 300); }, 3500);
  }

  function setLoading(active, msg = "Processing…") {
    const overlay = $("loading-overlay");
    const msgEl = $("loading-message");
    if (overlay) overlay.classList.toggle("hidden", !active);
    if (msgEl && msg) msgEl.textContent = msg;
  }

  function showConfirmModal(title, msg, onConfirm) {
    const modal = $("custom-modal");
    if (!modal) return;
    $("modal-title").textContent = title;
    $("modal-message").textContent = msg;
    show(modal);

    const close = () => hide(modal);
    $("modal-cancel").onclick = close;
    $("modal-no").onclick = close;
    $("modal-yes").onclick = () => { close(); onConfirm(); };
  }

  function _fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _populatePeriodSelectors() {
    const fySelect = $("select-fin-year");
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
      month: ($("select-month")?.value || "").trim(),
    };
  }

  // Helper function to format data for Google Sheets
  function _formatBillsForSheet(bills) {
    return bills.map(b => [
      b.billType || "",
      b.billNo || "",
      b.treasury || "",
      b.headOfAccount || "",
      b.sparkCode || "",
      b.department || "",
      b.pay || 0,
      b.da || 0,
      b.hra || 0,
      b.cca || 0,
      b.pgAllowance || 0,
      b.ruralAllowance || 0,
      b.otherAllowance || 0,
      b.consolidatePay || 0,
      b.dailyWages || 0,
      b.ms || 0,
      b.tourTa || 0,
      b.mr || 0,
      b.grossAmount || 0,
      b.encashDate || "",
      b.remarks || ""
    ]);
  }

  // ── Render Table ──
  function renderTable() {
    const tbody = $("bill-table-body");
    const emptyState = $("table-empty-state");
    const badge = $("row-count-badge");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (badge) badge.textContent = `${parsedBills.length} rows`;

    if (parsedBills.length === 0) {
      if (emptyState) show(emptyState);
      return;
    }
    if (emptyState) hide(emptyState);

    parsedBills.forEach((b, i) => {
      const tr = document.createElement("tr");
      tr.className = "table-row-hover transition-colors";
      
      const isSpark = b.billType === "SPARK";
      const typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${isSpark ? 'bg-primary-container/20 text-primary-container' : 'bg-secondary-fixed text-on-secondary-fixed'}">${b.billType}</span>`;

      tr.innerHTML = `
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-on-surface-variant font-medium">${i + 1}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y">${typeBadge}</td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y">
          <input type="text" class="w-full bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none text-on-surface font-medium" value="${b.billNo || ''}" onchange="TbrApp.updateField(${i}, 'billNo', this.value)"/>
        </td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-on-surface truncate max-w-[120px]" title="${b.treasury || ''}">${b.treasury || '—'}</td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y">
          <input type="text" class="w-full bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none text-on-surface font-medium text-[11px]" value="${b.headOfAccount || ''}" onchange="TbrApp.updateField(${i}, 'headOfAccount', this.value)"/>
        </td>

        <td class="px-table-cell-padding-x py-table-cell-padding-y text-on-surface truncate max-w-[150px]" title="${b.sparkCode || ''}">${b.sparkCode || '—'}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-on-surface truncate max-w-[200px]" title="${b.department || ''}">${b.department || '—'}</td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.pay)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.da)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.hra)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.cca)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.pgAllowance)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.ruralAllowance)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.otherAllowance)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.consolidatePay)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.dailyWages)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.ms)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.tourTa)}</td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right text-on-surface">${_fmt(b.mr)}</td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-right font-bold text-primary bg-primary/5 rounded-md">${_fmt(b.grossAmount)}</td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y">
          <input type="date" class="bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none text-on-surface" value="${b.encashDate || ''}" onchange="TbrApp.updateField(${i}, 'encashDate', this.value)"/>
        </td>
        <td class="px-table-cell-padding-x py-table-cell-padding-y">
          <input type="text" class="w-full bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none text-on-surface" value="${b.remarks || ''}" onchange="TbrApp.updateField(${i}, 'remarks', this.value)"/>
        </td>
        
        <td class="px-table-cell-padding-x py-table-cell-padding-y text-center">
          <button onclick="TbrApp.removeRow(${i})" class="text-outline-variant hover:text-error transition-colors p-1" title="Remove Row permanently">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function updateField(index, field, value) {
    if (parsedBills[index]) {
      parsedBills[index][field] = value.trim();
    }
  }

  // ── INDIVIDUAL ROW DELETE LOGIC (Fix applied here) ──
  function removeRow(index) {
    showConfirmModal(
      "Delete Bill?", 
      "Are you sure you want to delete this bill? It will be removed from Google Sheets permanently.", 
      async () => {
        parsedBills.splice(index, 1);
        renderTable();
        
        if (TbrAuth.isSignedIn()) {
          const { finYear, month } = _getSelectedPeriod();
          if (finYear && month) {
            setLoading(true, "Updating Google Sheets…");
            try {
              const formattedData = _formatBillsForSheet(parsedBills);
              await TbrApi.savePeriodData(finYear, month, formattedData);
              toast("Row permanently deleted!", "success");
            } catch (err) {
              toast(`Error updating sheet: ${err.message}`, "error");
            } finally {
              setLoading(false);
            }
          }
        } else {
          toast("Row removed from screen", "info");
        }
      }
    );
  }

  // ── Load from Google Sheets ──
  async function loadPeriodData() {
    if (!TbrAuth.isSignedIn()) return;
    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) return;

    setLoading(true, "Loading existing records…");
    try {
      const rows = await TbrApi.fetchRowsForPeriod(finYear, month);
      const C = TBR_CONFIG.COLUMNS;
      parsedBills = rows.map(r => ({
        billType:        r[C.BILL_TYPE] || "MANUAL",
        billNo:          r[C.BILL_NO] || "",
        treasury:        r[C.TREASURY] || "",
        headOfAccount:   r[C.HOA] || "",
        sparkCode:       r[C.SPARK_CODE] || "",
        department:      r[C.DEPARTMENT] || "",
        pay:             parseFloat(r[C.PAY]) || 0,
        da:              parseFloat(r[C.DA]) || 0,
        hra:             parseFloat(r[C.HRA]) || 0,
        cca:             parseFloat(r[C.CCA]) || 0,
        pgAllowance:     parseFloat(r[C.PG_ALLOWANCE]) || 0,
        ruralAllowance:  parseFloat(r[C.RURAL_ALLOWANCE]) || 0,
        otherAllowance:  parseFloat(r[C.OTHER_ALLOWANCE]) || 0,
        consolidatePay:  parseFloat(r[C.CONSOLIDATE_PAY]) || 0,
        dailyWages:      parseFloat(r[C.DAILY_WAGES]) || 0,
        ms:              parseFloat(r[C.MS]) || 0,
        tourTa:          parseFloat(r[C.TOUR_TA]) || 0,
        mr:              parseFloat(r[C.MR]) || 0,
        grossAmount:     parseFloat(r[C.GROSS_AMOUNT]) || 0,
        encashDate:      r[C.ENCASH_DATE] || "",
        remarks:         r[C.REMARKS] || "",
      }));
      renderTable();
      toast(`Loaded ${parsedBills.length} records for ${month}.`, "success");
    } catch (err) {
      toast(`Load Error: ${err.message}`, "error");
      parsedBills = [];
      renderTable();
    } finally {
      setLoading(false);
    }
  }

  // ── PDF Handling ──
  async function handlePdfUpload(files) {
    if (!files || files.length === 0) return;
    setLoading(true, `Parsing ${files.length} PDF(s)…`);
    let successCount = 0;
    
    for (const file of files) {
      if (file.type !== "application/pdf") {
        toast(`Skipped ${file.name} (Not a PDF)`, "error");
        continue;
      }
      try {
        const results = await TbrParser.parsePdf(file);
        results.forEach(res => {
          parsedBills.unshift(res); 
          successCount++;
        });
      } catch (err) {
        toast(`Failed parsing ${file.name}: ${err.message}`, "error");
      }
    }
    
    setLoading(false);
    if (successCount > 0) {
      renderTable();
      toast(`Added ${successCount} bill(s) to preview.`, "success");
    }
  }

  // ── Manual Entry Form ──
  function bindManualEntryLogic() {
    const inputs = [
      "manual-pay", "manual-da", "manual-hra", "manual-cca",
      "manual-pg-allowance", "manual-rural-allowance", "manual-other-allowance",
      "manual-consolidate-pay", "manual-daily-wages", "manual-ms",
      "manual-tour-ta", "manual-mr"
    ];

    const calcGross = () => {
      let gross = 0;
      inputs.forEach(id => { gross += parseFloat($(id)?.value || 0); });
      const display = $("manual-gross-amount");
      if (display) display.value = `₹ ${_fmt(gross)}`;
    };

    inputs.forEach(id => {
      const el = $(id);
      if (el) el.addEventListener("input", calcGross);
    });

    const addBtn = $("manual-add-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        let gross = 0;
        inputs.forEach(id => { gross += parseFloat($(id)?.value || 0); });

        const newBill = {
          billType:        $("manual-bill-type")?.value || "MANUAL",
          billNo:          $("manual-bill-no")?.value.trim() || "",
          treasury:        $("manual-treasury")?.value.trim() || "",
          headOfAccount:   $("manual-head-of-account")?.value.trim() || "",
          sparkCode:       $("manual-spark-code")?.value.trim() || "",
          department:      $("manual-department")?.value.trim() || "",
          encashDate:      $("manual-encash-date")?.value || "",
          remarks:         $("manual-remarks")?.value.trim() || "",
          pay:             parseFloat($("manual-pay")?.value) || 0,
          da:              parseFloat($("manual-da")?.value) || 0,
          hra:             parseFloat($("manual-hra")?.value) || 0,
          cca:             parseFloat($("manual-cca")?.value) || 0,
          pgAllowance:     parseFloat($("manual-pg-allowance")?.value) || 0,
          ruralAllowance:  parseFloat($("manual-rural-allowance")?.value) || 0,
          otherAllowance:  parseFloat($("manual-other-allowance")?.value) || 0,
          consolidatePay:  parseFloat($("manual-consolidate-pay")?.value) || 0,
          dailyWages:      parseFloat($("manual-daily-wages")?.value) || 0,
          ms:              parseFloat($("manual-ms")?.value) || 0,
          tourTa:          parseFloat($("manual-tour-ta")?.value) || 0,
          mr:              parseFloat($("manual-mr")?.value) || 0,
          grossAmount:     gross
        };

        parsedBills.unshift(newBill);
        renderTable();
        toast("Manual entry added", "success");

        inputs.forEach(id => { if ($(id)) $(id).value = ""; });
        calcGross();
      });
    }
  }

  // ── Save / Clear Google Sheet Data (Fix applied here) ──
  async function saveTableToSheet() {
    if (!TbrAuth.isSignedIn()) {
      toast("Please sign in first.", "error");
      return;
    }
    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) return;
    
    if (parsedBills.length === 0) {
      toast("Table is empty. Nothing to save.", "error");
      return;
    }

    setLoading(true, "Saving to Google Sheets…");
    try {
      const formattedData = _formatBillsForSheet(parsedBills);
      await TbrApi.savePeriodData(finYear, month, formattedData);
      toast(`Successfully saved ${parsedBills.length} records!`, "success");
    } catch (err) {
      toast(`Save Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Init ──
  function init() {
    _populatePeriodSelectors();
    bindManualEntryLogic();

    $("select-fin-year")?.addEventListener("change", loadPeriodData);
    $("select-month")?.addEventListener("change", loadPeriodData);

    // ── CLEAR TABLE LOGIC (Clear screen, or Clear all from sheet if empty) ──
    $("clear-table-btn")?.addEventListener("click", () => {
      const { finYear, month } = _getSelectedPeriod();
      if (!finYear || !month) return;

      if (parsedBills.length === 0) {
         showConfirmModal(
          "Clear Data Permanently?", 
          `Table is already empty. Do you want to permanently clear all saved data for ${month} from Google Sheets?`, 
          async () => {
            if (TbrAuth.isSignedIn()) {
              setLoading(true, "Clearing data from Google Sheets…");
              try {
                await TbrApi.savePeriodData(finYear, month, []);
                toast(`Successfully cleared all data for ${month}!`, "success");
              } catch (err) {
                toast(`Clear Error: ${err.message}`, "error");
              } finally {
                setLoading(false);
              }
            }
        });
      } else {
        showConfirmModal(
          "Clear Screen?", 
          "This will clear the preview table from the screen. (Data already saved in Google Sheets will NOT be deleted).", 
          () => {
            parsedBills = [];
            renderTable();
        });
      }
    });

    $("save-to-sheet-btn")?.addEventListener("click", saveTableToSheet);

    const dz = $("pdf-dropzone");
    const fileInput = $("pdf-file-input");
    const btnInput = $("pdf-upload-btn");

    if (dz && fileInput) {
      btnInput.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", (e) => handlePdfUpload(e.target.files));
      
      dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("bg-sky-50", "border-primary"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("bg-sky-50", "border-primary"));
      dz.addEventListener("drop", (e) => {
        e.preventDefault();
        dz.classList.remove("bg-sky-50", "border-primary");
        handlePdfUpload(e.dataTransfer.files);
      });
    }

    TbrAuth.onSignIn(() => {
      TbrApi.ensureSpreadsheet().then(() => loadPeriodData());
    });
    TbrAuth.bindButtons();
  }

  return { init, removeRow, updateField };

})();

document.addEventListener("DOMContentLoaded", () => TbrApp.init());
