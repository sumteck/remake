/**
 * report.js (Excel Style - Dynamic Headers & Progressive Totals)
 * =====================================
 */

const TbrReport = (() => {

  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

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

  function setLoading(active, msg = "Loading…") {
    const overlay = $("loading-overlay");
    if (overlay) overlay.classList.toggle("hidden", !active);
  }

  function _fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _populatePeriodSelectors() {
    const fySelect = $("report-fin-year");
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
      finYear: ($("report-fin-year")?.value || "").trim(),
      month: ($("report-month")?.value || "").trim(),
    };
  }

  const C = TBR_CONFIG.COLUMNS;
  const _col = (row, colKey) => row[C[colKey]] || "";
  const _colNum = (row, colKey) => parseFloat(row[C[colKey]]) || 0;

  // ── Excel Style Bill Details Table ──
  function _renderBillDetails(rows) {
    const tbody = $("bill-details-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const TOTAL_COLS = 17;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${TOTAL_COLS}" class="text-center py-8 border border-black italic">No bills found for this period.</td></tr>`;
      return;
    }

    const totals = {
      grossAmount: 0, pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0,
      otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0
    };
    
    const colMap = {
      grossAmount: "GROSS_AMOUNT", pay: "PAY", da: "DA", hra: "HRA", cca: "CCA",
      pgAllowance: "PG_ALLOWANCE", ruralAllowance: "RURAL_ALLOWANCE",
      otherAllowance: "OTHER_ALLOWANCE", consolidatePay: "CONSOLIDATE_PAY",
      dailyWages: "DAILY_WAGES", ms: "MS", tourTa: "TOUR_TA", mr: "MR"
    };

    // Render Individual Bill Rows
    rows.forEach((row, i) => {
      Object.keys(totals).forEach(k => { totals[k] += _colNum(row, colMap[k]); });

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="p-1 border border-black text-center">${_col(row, "SPARK_CODE") || "—"}</td>
        <td class="p-1 border border-black text-center">${_col(row, "BILL_NO") || "—"}</td>
        <td class="p-1 border border-black text-center">${_col(row, "ENCASH_DATE") || "—"}</td>
        <td class="p-1 border border-black text-right font-bold text-black">${_fmt(_colNum(row, "GROSS_AMOUNT"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "PAY"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "DA"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "HRA"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "CCA"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "PG_ALLOWANCE"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "RURAL_ALLOWANCE"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "OTHER_ALLOWANCE"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "CONSOLIDATE_PAY"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "DAILY_WAGES"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "MS"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "TOUR_TA"))}</td>
        <td class="p-1 border border-black text-right">${_fmt(_colNum(row, "MR"))}</td>
        <td class="p-1 border border-black text-left">${_col(row, "REMARKS") || "—"}</td>
      `;
      tbody.appendChild(tr);
    });

    const keys = ["grossAmount", "pay", "da", "hra", "cca", "pgAllowance", "ruralAllowance", "otherAllowance", "consolidatePay", "dailyWages", "ms", "tourTa", "mr"];

    // 1. EXPENDITURE DURING THIS MONTH
    const trCurrent = document.createElement("tr");
    trCurrent.className = "font-bold text-black bg-white";
    let htmlCurrent = `<td class="p-1 border border-black text-center uppercase" colspan="3">EXPENDITURE DURING THIS MONTH</td>`;
    keys.forEach(k => { htmlCurrent += `<td class="p-1 border border-black text-right">${_fmt(totals[k])}</td>`; });
    htmlCurrent += `<td class="p-1 border border-black"></td>`;
    trCurrent.innerHTML = htmlCurrent;
    tbody.appendChild(trCurrent);

    // 2. EXPENDITURE UP TO THE PREVIOUS MONTH (Editable)
    const trPrev = document.createElement("tr");
    trPrev.className = "font-bold text-black bg-white";
    let htmlPrev = `<td class="p-1 border border-black text-center uppercase" colspan="3">EXPENDITURE UP TO THE PREVIOUS MONTH</td>`;
    keys.forEach(k => { 
      htmlPrev += `<td class="p-1 border border-black text-right outline-none focus:bg-yellow-100 prev-month-cell" contenteditable="true" data-key="${k}" title="Click to enter previous month amount">0.00</td>`; 
    });
    htmlPrev += `<td class="p-1 border border-black"></td>`;
    trPrev.innerHTML = htmlPrev;
    tbody.appendChild(trPrev);

    // 3. PROGRESSIVE TOTAL (Auto Calculated)
    const trProg = document.createElement("tr");
    trProg.className = "font-bold text-black bg-gray-100";
    let htmlProg = `<td class="p-1 border border-black text-center uppercase" colspan="3">PROGRESSIVE TOTAL</td>`;
    keys.forEach(k => { 
      htmlProg += `<td class="p-1 border border-black text-right" id="prog-${k}">${_fmt(totals[k])}</td>`; 
    });
    htmlProg += `<td class="p-1 border border-black"></td>`;
    trProg.innerHTML = htmlProg;
    tbody.appendChild(trProg);

    // Dynamic Calculation Logic for Progressive Total
    const prevCells = tbody.querySelectorAll('.prev-month-cell');
    prevCells.forEach(cell => {
      cell.addEventListener('focus', () => {
         setTimeout(() => { document.execCommand('selectAll', false, null); }, 0);
      });
      
      cell.addEventListener('input', (e) => {
        const key = e.target.getAttribute('data-key');
        let textVal = e.target.textContent.replace(/[^0-9.-]+/g,"");
        let prevVal = parseFloat(textVal) || 0;
        let currentVal = totals[key] || 0;
        let progTotal = currentVal + prevVal;
        
        const progCell = $("prog-" + key);
        if (progCell) progCell.textContent = _fmt(progTotal);
      });
    });
  }

  // ── പുതിയ റിപ്പോർട്ട് ഹെഡർ അപ്ഡേറ്റ് ചെയ്യുന്ന ഭാഗം ──
  function _renderReportHeader(finYear, month, rows) {
    const headingEl = $("report-period-heading");
    if (headingEl) headingEl.textContent = `Reconciliation Statement — ${month} — FY ${finYear}`;
    
    // മാസം & വർഷം
    const dateEl = $("report-month-year");
    if (dateEl) dateEl.textContent = `${month} ${finYear}`;
    
    if (rows && rows.length > 0) {
      // 1. Treasury
      const trsyEl = $("report-treasury");
      if (trsyEl) trsyEl.textContent = _col(rows[0], "TREASURY") || "—";

      // 2. Head of Account
      const hoaEl = $("report-hoa");
      if (hoaEl) hoaEl.textContent = _col(rows[0], "HOA") || "—";

      // 3. Office & Department (സ്പ്ലിറ്റ് ചെയ്ത് എടുക്കുന്നു)
      const fullDeptName = _col(rows[0], "DEPARTMENT") || "";
      let officeName = "NAME OF OFFICE";
      let departmentName = "NAME OF DEPARTMENT";

      // '-' വെച്ച് മുറിക്കുന്നു (ഉദാ: Indian Systems of Medicine - GOVT AYURVEDA DISPENSARY ANGADIPPURAM)
      if (fullDeptName.includes("-")) {
        const parts = fullDeptName.split("-");
        departmentName = parts[0].trim(); // ആദ്യത്തെ ഭാഗം ഡിപ്പാർട്ട്മെന്റ് 
        officeName = parts[1].trim();     // രണ്ടാമത്തെ ഭാഗം ഓഫീസ് പേര്
      } else if (fullDeptName) {
        officeName = fullDeptName;
        departmentName = "";
      }

      const officeEl = $("report-office-name");
      if (officeEl) officeEl.textContent = officeName;

      const deptEl = $("report-department-name");
      if (deptEl) deptEl.textContent = departmentName;

    } else {
      // ഡാറ്റ ഇല്ലെങ്കിൽ ഹെഡിങ്ങുകൾ കാലിയാക്കുന്നു
      if ($("report-treasury")) $("report-treasury").textContent = "";
      if ($("report-hoa")) $("report-hoa").textContent = "";
      if ($("report-office-name")) $("report-office-name").textContent = "";
      if ($("report-department-name")) $("report-department-name").textContent = "";
    }
  }

  async function _generateReport() {
    if (!TbrAuth.isSignedIn()) {
      toast("Please sign in with Google first.", "error");
      return;
    }
    const { finYear, month } = _getSelectedPeriod();
    if (!finYear || !month) return;

    setLoading(true, "Fetching data from Google Sheets…");
    try {
      const currentRows = await TbrApi.fetchRowsForPeriod(finYear, month);
      
      _renderReportHeader(finYear, month, currentRows);
      _renderBillDetails(currentRows);

      const reportSection = $("report-content");
      if (reportSection) show(reportSection);

      if (currentRows.length > 0) toast(`Report generated successfully!`, "success");
      else toast(`No data found for ${month}.`, "info");
      
    } catch (err) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function init() {
    _populatePeriodSelectors();
    const btn = $("generate-report-btn");
    if (btn) btn.addEventListener("click", _generateReport);
    const printBtn = $("print-report-btn");
    if (printBtn) printBtn.addEventListener("click", () => window.print());

    TbrAuth.onSignIn(() => TbrApi.ensureSpreadsheet());
    TbrAuth.onSignOut(() => { $("report-content")?.classList.add("hidden"); });
    TbrAuth.bindButtons();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrReport.init());
