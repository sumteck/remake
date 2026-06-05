/**
 * api.js
 * Bulletproof Google Sheets API with Smart Merge & Targeted Single Delete
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
      String(row[C.FIN_YEAR] || "").trim() === String(finYear || "").trim() &&
      String(row[C.MONTH] || "").trim() === String(month || "").trim()
    );
  }

  // SMART MERGE: ഡാറ്റ സുരക്ഷിതമായി സേവ് ചെയ്യാൻ 
  async function savePeriodData(finYear, month, dataRows) {
    const id = await ensureSpreadsheet();
    if (!dataRows || dataRows.length === 0) return;

    const sheetName = await _getActualSheetName(id);

    const headerRow = ["FIN_YEAR", "MONTH", "BILL_TYPE", "BILL_NO", "TREASURY", "HEAD_OF_ACCOUNT", "SPARK_CODE", "DEPARTMENT", "PAY", "DA", "HRA", "CCA", "PG_ALLOWANCE", "RURAL_ALLOWANCE", "OTHER_ALLOWANCE", "CONSOLIDATE_PAY", "DAILY_WAGES", "MS", "TOUR_TA", "MR", "GROSS_AMOUNT", "ENCASH_DATE", "REMARKS"];
    const headerRange = encodeURIComponent(`${sheetName}!A1:W1`);
    await _request(`${BASE}/${id}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [headerRow] }),
    });

    const existingRows = await fetchRowsForPeriod(finYear, month);
    const newRows = dataRows.map(row => [finYear, month, ...row]);
    const mergedRows = [...existingRows];

    newRows.forEach(newRow => {
      const newSparkCode = String(newRow[6] || "").trim(); 
      const newGross = String(newRow[20] || "").trim(); 
      
      const existingIndex = mergedRows.findIndex(oldRow => {
        const oldSparkCode = String(oldRow[6] || "").trim();
        const oldGross = String(oldRow[20] || "").trim();
        if (newSparkCode && newSparkCode !== "—" && newSparkCode === oldSparkCode) return true;
        if ((!newSparkCode || newSparkCode === "—") && newGross && newGross === oldGross) return true;
        return false;
      });

      if (existingIndex >= 0) {
        mergedRows[existingIndex] = newRow; 
      } else {
        mergedRows.push(newRow); 
      }
    });

    await _deleteRowsForPeriod(id, sheetName, finYear, month);

    const appendRange = encodeURIComponent(`${sheetName}!A:Z`);
    await _request(`${BASE}/${id}/values/${appendRange}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values: mergedRows }),
    });
  }

  // TARGETED DELETE: സ്ക്രീനിൽ നിന്ന് ഡിലീറ്റ് ചെയ്യുന്ന വരി മാത്രം ഷീറ്റിൽ നിന്നും കളയാൻ
  async function deleteSingleBill(finYear, month, sparkCode, grossAmount) {
    const id = await ensureSpreadsheet();
    const sheetName = await _getActualSheetName(id);
    
    const range = encodeURIComponent(`${sheetName}!A:Z`);
    const data = await _request(`${BASE}/${id}/values/${range}`);
    const rows = (data && data.values) ? data.values : [];
    let rowToDelete = -1;
    
    for (let i = 1; i < rows.length; i++) {
      const rFY = String(rows[i][0] || "").trim();
      const rM = String(rows[i][1] || "").trim();
      const rSpark = String(rows[i][6] || "").trim();
      const rGross = String(rows[i][20] || "").trim();
      
      if (rFY === String(finYear).trim() && rM === String(month).trim()) {
         const matchSpark = (String(sparkCode).trim() && String(sparkCode).trim() !== "—" && rSpark === String(sparkCode).trim());
         const matchGross = ((!String(sparkCode).trim() || String(sparkCode).trim() === "—") && rGross === String(grossAmount).trim());
         
         if (matchSpark || matchGross) {
            rowToDelete = i;
            break;
         }
      }
    }
    
    if (rowToDelete === -1) return;
    
    const meta = await _request(`${BASE}/${id}?fields=sheets.properties`);
    const sheet = meta.sheets.find(s => s.properties.title === sheetName);
    const sheetId = sheet ? sheet.properties.sheetId : 0;

    const requests = [{ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowToDelete, endIndex: rowToDelete + 1 } } }];
    await _request(`${BASE}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  }

  async function _deleteRowsForPeriod(spreadsheetId, sheetName, finYear, month) {
    const range = encodeURIComponent(`${sheetName}!A:B`);
    const data = await _request(`${BASE}/${spreadsheetId}/values/${range}`);
    const rows = (data && data.values) ? data.values : [];
    const toDelete = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || "").trim() === String(finYear || "").trim() && String(rows[i][1] || "").trim() === String(month || "").trim()) {
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

  return { ensureSpreadsheet, fetchAllRows, fetchRowsForPeriod, savePeriodData, deleteSingleBill };
})();