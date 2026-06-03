/**
 * api.js
 * ======
 * All Google Sheets API interactions with dynamic sheet ID extraction,
 * auto-retry exponential backoff and connection race condition handlers.
 */

const TbrApi = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  // ── Low-level fetch wrapper with auto-retry on 429/503 ─────────────────────

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

      // Retry on API rate-limit (429) or transient server errors (503)
      if ((resp.status === 429 || resp.status === 503) && attempt < retries) {
        const delay = Math.pow(2, attempt) * 500; // 500ms, 1000ms, 2000ms
        console.warn(`[TbrApi] ${resp.status} received. Retrying in ${delay}ms... (Attempt ${attempt + 1})`);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }

      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || resp.statusText;
      throw new Error(`Sheets API error ${resp.status}: ${msg}`);
    }
  }

  // ── Spreadsheet bootstrap with execution lock ─────────────────────────────

  let _ensureSpreadsheetPromise = null;

  async function ensureSpreadsheet() {
    if (_ensureSpreadsheetPromise) return _ensureSpreadsheetPromise;
    _ensureSpreadsheetPromise = _doEnsureSpreadsheet();
    try {
      return await _ensureSpreadsheetPromise;
    } finally {
      _ensureSpreadsheetPromise = null;
    }
  }

  async function _doEnsureSpreadsheet() {
    let id = localStorage.getItem(TBR_CONFIG.SPREADSHEET_ID_KEY);

    if (id) {
      try {
        await _request(`${BASE}/${id}?fields=spreadsheetId`);
        return id;
      } catch (e) {
        console.warn("Stored spreadsheet inaccessible, creating new one.", e);
        localStorage.removeItem(TBR_CONFIG.SPREADSHEET_ID_KEY);
      }
    }

    // Fallback headers if creating a new sheet
    const headerRow = TBR_CONFIG.HEADER_ROW || ["FIN_YEAR", "MONTH", "BILL_TYPE", "BILL_NO", "TREASURY", "HOA", "SPARK_CODE", "DEPARTMENT", "PAY", "DA", "HRA", "CCA", "PG_ALLOWANCE", "RURAL_ALLOWANCE", "OTHER_ALLOWANCE", "CONSOLIDATE_PAY", "DAILY_WAGES", "MS", "TOUR_TA", "MR", "GROSS_AMOUNT", "ENCASH_DATE", "REMARKS"];

    const body = {
      properties: { title: TBR_CONFIG.SPREADSHEET_TITLE || "Treasury Bill Reconciliation Data" },
      sheets: [{
        properties: { title: TBR_CONFIG.SHEET_NAME },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: headerRow.map(v => ({ userEnteredValue: { stringValue: v } }))
          }]
        }]
      }]
    };

    const created = await _request(BASE, {
      method: "POST",
      body: JSON.stringify(body),
    });

    id = created.spreadsheetId;
    localStorage.setItem(TBR_CONFIG.SPREADSHEET_ID_KEY, id);
    console.log("Created new spreadsheet:", id);
    return id;
  }

  // ── Data Retrieval ─────────────────────────────────────────────────────────

  async function fetchAllRows() {
    const id = await ensureSpreadsheet();
    // പുതിയ കോളം വന്നതുകൊണ്ട് A2:V മാറ്റി A2:Z ആക്കി
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A2:Z`);
    const data = await _request(`${BASE}/${id}/values/${range}`);
    return data.values || [];
  }

  async function fetchRowsForPeriod(finYear, month) {
    const all = await fetchAllRows();
    const C = TBR_CONFIG.COLUMNS;
    return all.filter(row =>
      (row[C.FIN_YEAR] || "").trim() === finYear.trim() &&
      (row[C.MONTH] || "").trim() === month.trim()
    );
  }

  async function fetchRowsForYear(finYear) {
    const all = await fetchAllRows();
    const C = TBR_CONFIG.COLUMNS;
    return all.filter(row =>
      (row[C.FIN_YEAR] || "").trim() === finYear.trim()
    );
  }

  // ── Data Writing ───────────────────────────────────────────────────────────

  async function savePeriodData(finYear, month, dataRows) {
    const id = await ensureSpreadsheet();

    await _deleteRowsForPeriod(id, finYear, month);

    if (dataRows.length === 0) return;

    const values = dataRows.map(row => [finYear, month, ...row]);
    // ഇവിടെയും പുതിയ കോളം സേവ് ചെയ്യാൻ A:V മാറ്റി A:Z ആക്കി
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:Z`);

    await _request(
      `${BASE}/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values }),
      }
    );
  }

  async function _deleteRowsForPeriod(spreadsheetId, finYear, month) {
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:B`);
    const data = await _request(`${BASE}/${spreadsheetId}/values/${range}`);
    const rows = data.values || [];

    const toDelete = [];
    for (let i = 1; i < rows.length; i++) {
      if (
        (rows[i][0] || "").trim() === finYear.trim() &&
        (rows[i][1] || "").trim() === month.trim()
      ) {
        toDelete.push(i); 
      }
    }

    if (toDelete.length === 0) return;

    toDelete.sort((a, b) => b - a);

    const sheetId = await _getSheetId(spreadsheetId);

    const requests = toDelete.map(rowIdx => ({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: "ROWS",
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        }
      }
    }));

    await _request(`${BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  // ── Sheet ID helper ────────────────────────────────────────────────────────
  let _sheetIdCache = null;

  async function _getSheetId(spreadsheetId) {
    if (_sheetIdCache !== null) return _sheetIdCache;
    const meta = await _request(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
    const sheet = (meta.sheets || []).find(
      s => s.properties.title === TBR_CONFIG.SHEET_NAME
    );
    _sheetIdCache = sheet ? sheet.properties.sheetId : 0;
    return _sheetIdCache;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    ensureSpreadsheet,
    fetchAllRows,
    fetchRowsForPeriod,
    fetchRowsForYear,
    savePeriodData,
  };
})();
