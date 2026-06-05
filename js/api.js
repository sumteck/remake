/**
 * api.js
 * Google Sheets API interactions with Smart Merge (No Data Loss)
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
      throw new Error(`Sheets API error ${resp.status}: ${err?.error?.message || resp.statusText}`);
    }
  }

  async function ensureSpreadsheet() {
    return TBR_CONFIG.SPREADSHEET_ID;
  }

  async function fetchAllRows() {
    const id = await ensureSpreadsheet();
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:Z`);
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

    // 1. ആ മാസത്തെ പഴയ ഡാറ്റ ഷീറ്റിൽ നിന്നും എടുക്കുന്നു
    const existingRows = await fetchRowsForPeriod(finYear, month);

    // 2. സ്ക്രീനിലുള്ള പുതിയ ഡാറ്റകൾ സെറ്റ് ചെയ്യുന്നു
    const newRows = dataRows.map(row => [finYear, month, ...row]);

    // 3. പഴയ ഡാറ്റയും പുതിയ ഡാറ്റയും കൂട്ടിച്ചേർക്കുന്നു (Smart Merge)
    const mergedRows = [...existingRows];

    newRows.forEach(newRow => {
      const newBillNo = (newRow[3] || "").trim(); // BILL_NO (Index 3)
      const newGross = (newRow[20] || "").trim(); // GROSS_AMOUNT (Index 20)
      
      // പഴയ ഡാറ്റയിൽ ഈ ബില്ല് നേരത്തെ ഉണ്ടോ എന്ന് നോക്കുന്നു
      const existingIndex = mergedRows.findIndex(oldRow => {
        const oldBillNo = (oldRow[3] || "").trim();
        const oldGross = (oldRow[20] || "").trim();
        
        // Bill No ഉണ്ടെങ്കിൽ അത് വെച്ച് ഒത്തുനോക്കുന്നു
        if (newBillNo && newBillNo !== "—" && newBillNo === oldBillNo) return true;
        // Bill No ഇല്ലെങ്കിൽ Gross Amount വെച്ച് ഒത്തുനോക്കുന്നു
        if ((!newBillNo || newBillNo === "—") && newGross && newGross === oldGross) return true;
        
        return false;
      });

      if (existingIndex >= 0) {
        mergedRows[existingIndex] = newRow; // ഉണ്ടെങ്കിൽ അപ്ഡേറ്റ് ചെയ്യുന്നു
      } else {
        mergedRows.push(newRow); // ഇല്ലെങ്കിൽ പുതിയതായി താഴേക്ക് ചേർക്കുന്നു
      }
    });

    // 4. പഴയവ ഡിലീറ്റ് ചെയ്യുന്നു (ഡ്യൂപ്ലിക്കേറ്റ് ഒഴിവാക്കാൻ)
    await _deleteRowsForPeriod(id, finYear, month);

    // 5. ഒന്നിപ്പിച്ച മുഴുവൻ ഡാറ്റയും പുതിയതായി ഷീറ്റിലേക്ക് സേവ് ചെയ്യുന്നു
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:Z`);
    await _request(`${BASE}/${id}/values/${range}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values: mergedRows }),
    });
  }

  async function _deleteRowsForPeriod(spreadsheetId, finYear, month) {
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:B`);
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
    const sheetId = await _getSheetId(spreadsheetId);
    const requests = toDelete.map(rowIdx => ({ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }));
    await _request(`${BASE}/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  }

  async function _getSheetId(spreadsheetId) {
    const meta = await _request(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
    const sheet = (meta && meta.sheets) ? meta.sheets.find(s => s.properties.title === TBR_CONFIG.SHEET_NAME) : null;
    return sheet ? sheet.properties.sheetId : 0;
  }

  return { ensureSpreadsheet, fetchAllRows, fetchRowsForPeriod, savePeriodData };
})();
