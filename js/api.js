/**
 * api.js
 * Google Sheets API interactions
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
    await _deleteRowsForPeriod(id, finYear, month);
    if (!dataRows || dataRows.length === 0) return;

    const values = dataRows.map(row => [finYear, month, ...row]);
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:Z`);
    await _request(`${BASE}/${id}/values/${range}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values }),
    });
  }

  async function _deleteRowsForPeriod(spreadsheetId, finYear, month) {
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:B`);
    const data = await _request(`${BASE}/${spreadsheetId}/values/${range}`);
    const rows = (data && data.values) ? data.values : [];
    const toDelete = [];
    
    // ഇവിടെയാണ് താങ്കൾ മാറ്റാൻ വിട്ടുപോയത് (i = 0 ആക്കിയിട്ടുണ്ട്)
    for (let i = 0; i < rows.length; i++) {
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