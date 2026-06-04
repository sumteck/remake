/**
 * api.js
 * Stable Google Sheets API interactions with Smart Auto-Header
 */
const TbrApi = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  async function _request(url, options = {}, retries = 3) {
    const token = TbrAuth.getToken();
    if (!token) throw new Error("Not authenticated. Please sign in first.");

    const defaults = {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    const headers = { ...defaults.headers, ...(options.headers || {}) };

    for (let attempt = 0; attempt <= retries; attempt++) {
      const resp = await fetch(url, { ...defaults, ...options, headers });
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

  async function fetchAllRows() {
    const id = await ensureSpreadsheet();
    // ഹെഡിങ് ഉള്ളതുകൊണ്ട് രണ്ടാമത്തെ വരി മുതൽ (A2) ഡാറ്റ എടുക്കുന്നു
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A2:Z`);
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
    
    // 1. ഷീറ്റിലെ ഇപ്പോഴത്തെ ഡാറ്റ വായിക്കുന്നു (ഷീറ്റ് കാലിയാണോ എന്ന് നോക്കാൻ)
    const readRange = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:B`);
    const data = await _request(`${BASE}/${id}/values/${readRange}`);
    const rows = (data && data.values) ? data.values : [];
    
    const isSheetEmpty = rows.length === 0;
    
    // 2. ഷീറ്റ് കാലിയല്ലെങ്കിൽ മാത്രം പഴയ ഡാറ്റ ഡിലീറ്റ് ചെയ്യുന്നു
    const toDelete = [];
    if (!isSheetEmpty) {
      for (let i = 1; i < rows.length; i++) {
        if ((rows[i][0] || "").trim() === (finYear || "").trim() && (rows[i][1] || "").trim() === (month || "").trim()) {
          toDelete.push(i);
        }
      }
      if (toDelete.length > 0) {
        toDelete.sort((a, b) => b - a);
        const sheetId = await _getSheetId(id);
        const requests = toDelete.map(rowIdx => ({ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }));
        await _request(`${BASE}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
      }
    }

    if (!dataRows || dataRows.length === 0) return;

    // 3. സേവ് ചെയ്യാനുള്ള ഡാറ്റ തയ്യാറാക്കുന്നു 
    const valuesToAppend = [];
    
    // ഷീറ്റ് കാലിയാണെങ്കിൽ മാത്രം ആദ്യം ഹെഡിങ് ചേർക്കുന്നു (Smart Feature)
    if (isSheetEmpty) {
      valuesToAppend.push(["FIN_YEAR", "MONTH", "BILL_TYPE", "BILL_NO", "TREASURY", "HEAD_OF_ACCOUNT", "SPARK_CODE", "DEPARTMENT", "PAY", "DA", "HRA", "CCA", "PG_ALLOWANCE", "RURAL_ALLOWANCE", "OTHER_ALLOWANCE", "CONSOLIDATE_PAY", "DAILY_WAGES", "MS", "TOUR_TA", "MR", "GROSS_AMOUNT", "ENCASH_DATE", "REMARKS"]);
    }
    
    dataRows.forEach(row => valuesToAppend.push([finYear, month, ...row]));

    // 4. ഒറ്റയടിക്ക് ഡാറ്റ ഷീറ്റിലേക്ക് കയറ്റുന്നു
    const appendRange = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:Z`);
    await _request(`${BASE}/${id}/values/${appendRange}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values: valuesToAppend }),
    });
  }

  async function _getSheetId(spreadsheetId) {
    const meta = await _request(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
    const sheet = (meta && meta.sheets) ? meta.sheets.find(s => s.properties.title === TBR_CONFIG.SHEET_NAME) : null;
    return sheet ? sheet.properties.sheetId : 0;
  }

  return { ensureSpreadsheet, fetchAllRows, fetchRowsForPeriod, savePeriodData };
})();