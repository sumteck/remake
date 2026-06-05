/**
 * api.js
 * Bulletproof Google Sheets API with Smart Merge (No Data Loss & Safe Headers)
 */
const TbrApi = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  async function _request(url, options = {}, retries = 3) {
    const token = TbrAuth.getToken();
    if (!token) throw new Error("Not authenticated. Please sign in first.");

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      const resp = await fetch(url, { ...options, headers });
      if (resp.ok) return resp.json();
      if ((resp.status === 429 || resp.status === 503) && attempt < retries) {
        await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 500));
        continue;
      }
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Sheets API error: ${err?.error?.message || resp.statusText}`);
    }
  }

  async function ensureSpreadsheet() {
    return TBR_CONFIG.SPREADSHEET_ID;
  }

  // ഷീറ്റിന്റെ യഥാർത്ഥ പേര് തനിയെ കണ്ടുപിടിക്കാൻ (Bulletproof Feature)
  async function _getActualSheetName(id) {
     const meta = await _request(`${BASE}/${id}?fields=sheets.properties`);
     if (meta && meta.sheets && meta.sheets.length > 0) {
         return meta.sheets[0].properties.title;
     }
     return TBR_CONFIG.SHEET_NAME || "Sheet1";
  }

  async function fetchAllRows() {
    const id = await ensureSpreadsheet();
    const sheetName = await _getActualSheetName(id);
    const range = encodeURIComponent(`${sheetName}!A2:Z`);
    const data = await _request(`${BASE}/${id}/values/${range}`);
    return (data && data.values) ? data.values : [];
  }

  async function fetchRowsForPeriod(finYear, month) {
    const all = await fetchAllRows();
    if (!all || !Array.isArray(all)) return [];
    const C = TBR_CONFIG.COLUMNS;
    return all.filter(row =>
      (row[C.FIN_YEAR] || "").trim() === (finYear || "").trim() &&
      (row[C.MONTH] || "").trim() === (month || "").trim()
    );
  }

  async function savePeriodData(finYear, month, dataRows) {
    const id = await ensureSpreadsheet();
    if (!dataRows || dataRows.length === 0) return;

    const sheetName = await _getActualSheetName(id);

    // 1. നിർബന്ധമായും ആദ്യത്തെ വരിയിൽ ഹെഡിങ് എഴുതിച്ചേർക്കുന്നു (Bulletproof Feature)
    const headerRow = ["FIN_YEAR", "MONTH", "BILL_TYPE", "BILL_NO", "TREASURY", "HEAD_OF_ACCOUNT", "SPARK_CODE", "DEPARTMENT", "PAY", "DA", "HRA", "CCA", "PG_ALLOWANCE", "RURAL_ALLOWANCE", "OTHER_ALLOWANCE", "CONSOLIDATE_PAY", "DAILY_WAGES", "MS", "TOUR_TA", "MR", "GROSS_AMOUNT", "ENCASH_DATE", "REMARKS"];
    const headerRange = encodeURIComponent(`${sheetName}!A1:W1`);
    await _request(`${BASE}/${id}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [headerRow] }),
    });

    // 2. ആ മാസത്തെ പഴയ ഡാറ്റ ഷീറ്റിൽ നിന്നും എടുക്കുന്നു (Smart Merge Feature)
    const existingRows = await fetchRowsForPeriod(finYear, month);
    const newRows = dataRows.map(row => [finYear, month, ...row]);
    const mergedRows = [...existingRows];

    newRows.forEach(newRow => {
      const newBillNo = (newRow[3] || "").trim(); // BILL_NO (Index 3)
      const newGross = (newRow[20] || "").trim(); // GROSS_AMOUNT (Index 20)
      
      const existingIndex = mergedRows.findIndex(oldRow => {
        const oldBillNo = (oldRow[3] || "").trim();
        const oldGross = (oldRow[20] || "").trim();
        if (newBillNo && newBillNo !== "—" && newBillNo === oldBillNo) return true;
        if ((!newBillNo || newBillNo === "—") && newGross && newGross === oldGross) return true;
        return false;
      });

      if (existingIndex >= 0) {
        mergedRows[existingIndex] = newRow; // അപ്ഡേറ്റ്
      } else {
        mergedRows.push(newRow); // പുതിയത് ചേർക്കൽ
      }
    });

    // 3. ആ മാസത്തെ പഴയ ഡാറ്റകൾ ഷീറ്റിൽ ഉണ്ടെങ്കിൽ അത് ഡിലീറ്റ് ചെയ്യുന്നു
    await _deleteRowsForPeriod(id, sheetName, finYear, month);

    // 4. ഒന്നിപ്പിച്ച മുഴുവൻ ഡാറ്റയും രണ്ടാമത്തെ വരി മുതൽ സേവ് ചെയ്യുന്നു
    const appendRange = encodeURIComponent(`${sheetName}!A:Z`);
    await _request(`${BASE}/${id}/values/${appendRange}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values: mergedRows }),
    });
  }

  async function _deleteRowsForPeriod(spreadsheetId, sheetName, finYear, month) {
    const range = encodeURIComponent(`${sheetName}!A:B`);
    const data = await _request(`${BASE}/${spreadsheetId}/values/${range}`);
    const rows = (data && data.values) ? data.values : [];
    const toDelete = [];
    
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || "").trim() === (finYear || "").trim() && (rows[i][1] || "").trim() === (month || "").trim()) {
        toDelete.push(i);
      }
    }
    if (toDelete.length === 0) return;
    
    toDelete.sort((a, b) => b - a);
    
    const meta = await _request(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
    const sheet = meta.sheets.find(s => s.properties.title === sheetName);
    const sheetId = sheet ? sheet.properties.sheetId : 0;

    const requests = toDelete.map(rowIdx => ({ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }));
    await _request(`${BASE}/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  }

  return { ensureSpreadsheet, fetchAllRows, fetchRowsForPeriod, savePeriodData };
})();
