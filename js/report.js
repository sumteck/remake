/**
 * report.js (Treasury & NON-PLAN only on the first table)
 * =====================================
 */

const TbrReport = (() => {

  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  function toast(msg, type = "info") {
    const colours = { success: "bg-green-600", error: "bg-red-600", info: "bg-sky-600", warning: "bg-orange-500" };
    let container = $("toast-container");
    
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "fixed top-4 right-4 z-[100] w-80 space-y-2 pointer-events-none";
      document.body.appendChild(container);
    }
    
    const div = document.createElement("div");
    div.className = `${colours[type] || colours.info} text-white text-sm px-4 py-3 rounded shadow-lg mb-2`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => { div.style.opacity = "0"; setTimeout(() => div.remove(), 300); }, 3500);
  }

  function setLoading(active, msg = "Loading…") {
    const overlay = $("loading-overlay");
    const msgEl = $("loading-message");
    if (overlay) overlay.classList.toggle("hidden", !active);
    if (msgEl && msg) msgEl.textContent = msg;
  }

  function _fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _getSelectors() {
    return {
      fySelect: $("report-fin-year") || $("select-fin-year") || document.querySelector('select[id*="year"]'),
      monthSelect: $("report-month") || $("select-month") || document.querySelector('select[id*="month"]')
    };
  }

  function _populatePeriodSelectors() {
    const { fySelect, monthSelect } = _getSelectors();
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
    const { fySelect, monthSelect } = _getSelectors();
    return {
      finYear: (fySelect?.value || "").trim(),
      month: (monthSelect?.value || "").trim(),
    };
  }

  const C = TBR_CONFIG.COLUMNS;
  const _col = (row, colKey) => row[C[colKey]] || "";
  const _colNum = (row, colKey) => parseFloat(row[C[colKey]]) || 0;

  function _buildReportBlock(rows, prevTotals, blockIndex) {
    const hoa = _col(rows[0], "HOA") || "—";
    const treasury = _col(rows[0], "TREASURY") || "—"; 

    const totals = { grossAmount: 0, pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0 };
    const colMap = { grossAmount: "GROSS_AMOUNT", pay: "PAY", da: "DA", hra: "HRA", cca: "CCA", pgAllowance: "PG_ALLOWANCE", ruralAllowance: "RURAL_ALLOWANCE", otherAllowance: "OTHER_ALLOWANCE", consolidatePay: "CONSOLIDATE_PAY", dailyWages: "DAILY_WAGES", ms: "MS", tourTa: "TOUR_TA", mr: "MR" };

    let rowsHtml = "";
    rows.forEach(row => {
      Object.keys(totals).forEach(k => { totals[k] += _colNum(row, colMap[k]); });
      rowsHtml += `
        <tr>
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
        </tr>
      `;
    });

    const keys = ["grossAmount", "pay", "da", "hra", "cca", "pgAllowance", "ruralAllowance", "otherAllowance", "consolidatePay", "dailyWages", "ms", "tourTa", "mr"];

    let curHtml = `<td class="p-1 border border-black text-center font-bold uppercase" colspan="3">EXPENDITURE DURING THIS MONTH</td>`;
    keys.forEach(k => { curHtml += `<td class="p-1 border border-black text-right font-bold">${_fmt(totals[k])}</td>`; });
    curHtml += `<td class="p-1 border border-black"></td>`;

    let prevHtml = `<td class="p-1 border border-black text-center font-bold uppercase" colspan="3">EXPENDITURE UP TO THE PREVIOUS MONTH</td>`;
    keys.forEach(k => {
      prevHtml += `<td class="p-1 border border-black text-right font-bold outline-none focus:bg-yellow-100 prev-month-cell" contenteditable="true" data-key="${k}" data-block="${blockIndex}" data-current="${totals[k]}" title="Click to edit">${_fmt(prevTotals[k])}</td>`;
    });
    prevHtml += `<td class="p-1 border border-black"></td>`;

    let progHtml = `<td class="p-1 border border-black text-center font-bold uppercase" colspan="3">PROGRESSIVE TOTAL</td>`;
    keys.forEach(k => {
      progHtml += `<td class="p-1 border border-black text-right font-bold" id="prog-${blockIndex}-${k}">${_fmt(totals[k] + prevTotals[k])}</td>`;
    });
    progHtml += `<td class="p-1 border border-black"></td>`;

    // ആദ്യത്തെ ടേബിളാണെങ്കിൽ മാത്രം (blockIndex === 0) മൂന്നും കൊടുക്കും, അല്ലെങ്കിൽ Head of Account മാത്രം കൊടുക്കും
    let tableHeader = "";
    if (blockIndex === 0) {
      tableHeader = `
        <div class="flex justify-between items-end mb-2">
          <div class="font-bold text-sm flex-1 text-left">Head of Account: <span class="ml-1 border-b border-dotted border-gray-400 inline-block min-w-[200px]">${hoa}</span></div>
          <div class="font-bold text-sm flex-1 text-center uppercase">NON-PLAN</div>
          <div class="font-bold text-sm flex-1 text-right">Treasury: <span class="font-normal text-gray-800">${treasury}</span></div>
        </div>
      `;
    } else {
      tableHeader = `
        <div class="flex justify-between items-end mb-2">
          <div class="font-bold text-sm flex-1 text-left">Head of Account: <span class="ml-1 border-b border-dotted border-gray-400 inline-block min-w-[200px]">${hoa}</span></div>
          <div class="font-bold text-sm flex-1 text-center uppercase"></div>
          <div class="font-bold text-sm flex-1 text-right"></div>
        </div>
      `;
    }

    return `
      <div class="mb-12" style="page-break-inside: avoid;">
        ${tableHeader}
        <hr class="mb-4 border-gray-800 border-t-2">
        <table class="w-full text-[10px] md:text-[11px] border-collapse border border-black bg-white">
          <thead>
            <tr class="bg-gray-100 font-bold text-black uppercase text-center">
              <th class="p-1 border border-black">Spark Code / BRN</th><th class="p-1 border border-black">BILL NO</th><th class="p-1 border border-black">Date of Encashment</th><th class="p-1 border border-black">GROSS AMOUNT</th><th class="p-1 border border-black">PAY</th><th class="p-1 border border-black">D.A</th><th class="p-1 border border-black">H.R.A</th><th class="p-1 border border-black">CCA</th><th class="p-1 border border-black">PG Allw</th><th class="p-1 border border-black">Rural Allw</th><th class="p-1 border border-black">Other Allw</th><th class="p-1 border border-black">Cons. Pay</th><th class="p-1 border border-black">Daily Wages</th><th class="p-1 border border-black">M&S</th><th class="p-1 border border-black">Tour T.A</th><th class="p-1 border border-black">MR</th><th class="p-1 border border-black">REMARKS</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}<tr class="bg-white">${curHtml}</tr><tr class="bg-white">${prevHtml}</tr><tr class="bg-gray-100">${progHtml}</tr>
          </tbody>
        </table>
      </div>
    `;
  }

  async function _generateReport() {
    try {
      if (!TbrAuth.isSignedIn()) {
        toast("Please sign in with Google first.", "error");
        return;
      }
      
      const { finYear, month } = _getSelectedPeriod();
      if (!finYear || !month) {
        toast("Please select both Financial Year and Month to generate report.", "warning");
        return;
      }

      const container = $("dynamic-reports-container");
      if (!container) return;

      setLoading(true, `Fetching data for ${month} ${finYear}…`);

      const allRows = await TbrApi.fetchAllRows();
      if (!allRows) throw new Error("Could not fetch data from Google Sheets.");

      const currentRows = allRows.filter(r => String(r[C.FIN_YEAR]).trim() === finYear && String(r[C.MONTH]).trim() === month);

      if (currentRows.length === 0) {
        container.innerHTML = `<div class="text-center py-10 font-bold text-red-500">No data found in Google Sheets for ${month} ${finYear}.</div>`;
        const reportSection = $("report-content");
        if (reportSection) show(reportSection);
        setLoading(false);
        return;
      }

      const currentGroups = {};
      currentRows.forEach(r => {
         const hoa = _col(r, "HOA") || "UNKNOWN_HOA";
         if(!currentGroups[hoa]) currentGroups[hoa] = [];
         currentGroups[hoa].push(r);
      });

      const monthOrder = TBR_CONFIG.FY_MONTHS;
      const currentMonthIdx = monthOrder.indexOf(month);
      const prevMonths = monthOrder.slice(0, currentMonthIdx);

      const prevRows = allRows.filter(r => String(r[C.FIN_YEAR]).trim() === finYear && prevMonths.includes(String(r[C.MONTH]).trim()));

      const firstRow = currentRows[0];
      const fullDeptName = _col(firstRow, "DEPARTMENT") || "";
      let officeName = "NAME OF OFFICE";
      let departmentName = "NAME OF DEPARTMENT";

      if (fullDeptName.includes("-")) {
        const parts = fullDeptName.split("-");
        departmentName = parts[0].trim();
        officeName = parts[1].trim();
      } else if (fullDeptName) {
        officeName = fullDeptName;
        departmentName = "";
      }

      let finalHtml = `
        <div class="mb-10 relative" style="page-break-after: avoid;">
          <div class="absolute left-0 top-0 font-bold text-sm">File No: <span contenteditable="true" class="outline-none border-b border-dotted border-gray-600 inline-block w-40 font-normal focus:bg-yellow-100 cursor-text"></span></div>
          <div class="text-center flex flex-col items-center">
            <h2 class="text-lg font-bold uppercase">RECONCILIATION STATEMENT OF</h2>
            <h3 class="text-md font-bold uppercase mt-1 text-gray-800">${officeName}</h3>
            <h4 class="text-sm font-bold uppercase text-gray-600">${departmentName}</h4>
            <div class="text-sm font-bold mt-2">for the month of <span class="underline">${month} ${finYear}</span></div>
          </div>
        </div>
      `;

      const colMap = { grossAmount: "GROSS_AMOUNT", pay: "PAY", da: "DA", hra: "HRA", cca: "CCA", pgAllowance: "PG_ALLOWANCE", ruralAllowance: "RURAL_ALLOWANCE", otherAllowance: "OTHER_ALLOWANCE", consolidatePay: "CONSOLIDATE_PAY", dailyWages: "DAILY_WAGES", ms: "MS", tourTa: "TOUR_TA", mr: "MR" };
      let blockIndex = 0;

      const grandTotalsCur = { grossAmount: 0, pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0 };
      const grandTotalsPrev = { grossAmount: 0, pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0 };

      currentRows.forEach(row => { Object.keys(grandTotalsCur).forEach(k => { grandTotalsCur[k] += _colNum(row, colMap[k]); }); });

      for (const hoa of Object.keys(currentGroups)) {
        const rowsForHoa = currentGroups[hoa];
        const prevRowsForHoa = prevRows.filter(r => (_col(r, "HOA") || "UNKNOWN_HOA") === hoa);

        const prevTotals = { grossAmount: 0, pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0 };
        prevRowsForHoa.forEach(row => { Object.keys(prevTotals).forEach(k => { prevTotals[k] += parseFloat(row[C[colMap[k]]]) || 0; }); });

        Object.keys(grandTotalsPrev).forEach(k => { grandTotalsPrev[k] += prevTotals[k]; });

        finalHtml += _buildReportBlock(rowsForHoa, prevTotals, blockIndex);
        blockIndex++;
      }

      const keys = ["grossAmount", "pay", "da", "hra", "cca", "pgAllowance", "ruralAllowance", "otherAllowance", "consolidatePay", "dailyWages", "ms", "tourTa", "mr"];
      
      let gCurHtml = `<td class="p-2 border border-black text-center font-extrabold uppercase" colspan="3">TOTAL EXPENDITURE DURING THIS MONTH</td>`;
      keys.forEach(k => { gCurHtml += `<td class="p-2 border border-black text-right font-extrabold">${_fmt(grandTotalsCur[k])}</td>`; });
      gCurHtml += `<td class="p-2 border border-black"></td>`;

      let gPrevHtml = `<td class="p-2 border border-black text-center font-extrabold uppercase" colspan="3">TOTAL EXPENDITURE UP TO PREVIOUS MONTH</td>`;
      keys.forEach(k => { gPrevHtml += `<td class="p-2 border border-black text-right font-extrabold" id="grand-prev-${k}" data-grand-current="${grandTotalsCur[k]}">${_fmt(grandTotalsPrev[k])}</td>`; });
      gPrevHtml += `<td class="p-2 border border-black"></td>`;

      let gProgHtml = `<td class="p-2 border border-black text-center font-black uppercase text-blue-900" colspan="3">GRAND PROGRESSIVE TOTAL</td>`;
      keys.forEach(k => { gProgHtml += `<td class="p-2 border border-black text-right font-black text-blue-900" id="grand-prog-${k}">${_fmt(grandTotalsCur[k] + grandTotalsPrev[k])}</td>`; });
      gProgHtml += `<td class="p-2 border border-black"></td>`;

      finalHtml += `
        <div class="mt-20 mb-12 pt-8" style="page-break-inside: avoid;">
          <h3 class="text-center font-extrabold text-xl uppercase mb-4 text-black tracking-widest underline decoration-double underline-offset-4">CONSOLIDATED STATEMENT</h3>
          <table class="w-full text-[10px] md:text-[11px] border-collapse border-2 border-black bg-white shadow-sm">
            <thead>
              <tr class="bg-gray-200 font-bold text-black uppercase text-center">
                <th class="p-2 border border-black">Spark Code / BRN</th><th class="p-2 border border-black">BILL NO</th><th class="p-2 border border-black">Date of Encashment</th><th class="p-2 border border-black">GROSS AMOUNT</th><th class="p-2 border border-black">PAY</th><th class="p-2 border border-black">D.A</th><th class="p-2 border border-black">H.R.A</th><th class="p-2 border border-black">CCA</th><th class="p-2 border border-black">PG Allw</th><th class="p-2 border border-black">Rural Allw</th><th class="p-2 border border-black">Other Allw</th><th class="p-2 border border-black">Cons. Pay</th><th class="p-2 border border-black">Daily Wages</th><th class="p-2 border border-black">M&S</th><th class="p-2 border border-black">Tour T.A</th><th class="p-2 border border-black">MR</th><th class="p-2 border border-black">REMARKS</th>
              </tr>
            </thead>
            <tbody><tr class="bg-white">${gCurHtml}</tr><tr class="bg-white">${gPrevHtml}</tr><tr class="bg-blue-50">${gProgHtml}</tr></tbody>
          </table>
        </div>
      `;

      container.innerHTML = finalHtml;
      const reportSection = $("report-content");
      if (reportSection) show(reportSection);
      toast(`Report generated successfully!`, "success");

    } catch (err) {
      console.error(err);
      toast(`Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function init() {
    _populatePeriodSelectors();
    
    const btn = $("generate-report-btn") || document.querySelector('button[id*="generate"]');
    if (btn) btn.addEventListener("click", _generateReport);
    
    const printBtn = $("print-report-btn") || document.querySelector('button[id*="print"]');
    if (printBtn) printBtn.addEventListener("click", () => window.print());

    const container = $("dynamic-reports-container");
    if(container) {
      container.addEventListener("focusin", (e) => {
        if(e.target.classList.contains("prev-month-cell")) { setTimeout(() => { document.execCommand('selectAll', false, null); }, 0); }
      });
      container.addEventListener("input", (e) => {
        if(e.target.classList.contains("prev-month-cell")) {
          const key = e.target.getAttribute("data-key");
          const blockIndex = e.target.getAttribute("data-block");
          const currentVal = parseFloat(e.target.getAttribute("data-current")) || 0;
          let textVal = e.target.textContent.replace(/[^0-9.-]+/g,"");
          let prevVal = parseFloat(textVal) || 0;

          const progCell = $(`prog-${blockIndex}-${key}`);
          if (progCell) progCell.textContent = _fmt(currentVal + prevVal);

          let newGrandPrev = 0;
          container.querySelectorAll(`.prev-month-cell[data-key="${key}"]`).forEach(cell => {
            newGrandPrev += parseFloat(cell.textContent.replace(/[^0-9.-]+/g,"")) || 0;
          });

          const grandPrevCell = $(`grand-prev-${key}`);
          if (grandPrevCell) {
            grandPrevCell.textContent = _fmt(newGrandPrev);
            const grandCurVal = parseFloat(grandPrevCell.getAttribute("data-grand-current")) || 0;
            const grandProgCell = $(`grand-prog-${key}`);
            if (grandProgCell) grandProgCell.textContent = _fmt(grandCurVal + newGrandPrev);
          }
        }
      });
    }

    TbrAuth.onSignIn(() => TbrApi.ensureSpreadsheet());
    TbrAuth.onSignOut(() => { $("report-content")?.classList.add("hidden"); });
    TbrAuth.bindButtons();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => TbrReport.init());
