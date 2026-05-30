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

  /**
   * Thread-safe gateway wrapper preventing parallel creation requests
   */
  async function ensureSpreadsheet() {
    if (_ensureSpreadsheetPromise) return _ensureSpreadsheetPromise;
    _ensureSpreadsheetPromise = _doEnsureSpreadsheet();
    try {
      return await _ensureSpreadsheetPromise;
    } finally {
      // Reset lock for subsequent independent state evaluations
      _ensureSpreadsheetPromise = null;
    }
  }

  async function _doEnsureSpreadsheet() {
    let id = localStorage.getItem(TBR_CONFIG.SPREADSHEET_ID_KEY);

    if (id) {
      // Verify it still exists / is accessible
      try {
        await _request(`${BASE}/${id}?fields=spreadsheetId`);
        return id;
      } catch (e) {
        console.warn("Stored spreadsheet inaccessible, creating new one.", e);
        localStorage.removeItem(TBR_CONFIG.SPREADSHEET_ID_KEY);
      }
    }

    // Create a fresh spreadsheet
    const body = {
      properties: { title: TBR_CONFIG.SPREADSHEET_TITLE },
      sheets: [{
        properties: { title: TBR_CONFIG.SHEET_NAME },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: TBR_CONFIG.HEADER_ROW.map(v => ({ userEnteredValue: { stringValue: v } }))
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

  /**
   * Fetches ALL rows from the BillData sheet (excluding header).
   */
  async function fetchAllRows() {
    const id = await ensureSpreadsheet();
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A2:N`);
    const data = await _request(`${BASE}/${id}/values/${range}`);
    return data.values || [];
  }

  /**
   * Fetches rows filtered by financial year AND month.
   */
  async function fetchRowsForPeriod(finYear, month) {
    const all = await fetchAllRows();
    const C = TBR_CONFIG.COLUMNS;
    return all.filter(row =>
      (row[C.FIN_YEAR] || "").trim() === finYear.trim() &&
      (row[C.MONTH] || "").trim() === month.trim()
    );
  }

  /**
   * Fetches all rows for a given financial year (all months).
   */
  async function fetchRowsForYear(finYear) {
    const all = await fetchAllRows();
    const C = TBR_CONFIG.COLUMNS;
    return all.filter(row =>
      (row[C.FIN_YEAR] || "").trim() === finYear.trim()
    );
  }

  // ── Data Writing ───────────────────────────────────────────────────────────

  /**
   * Deletes all rows matching finYear + month, then appends fresh rows.
   */
  async function savePeriodData(finYear, month, dataRows) {
    const id = await ensureSpreadsheet();

    // 1. Read current sheet to find rows to delete
    await _deleteRowsForPeriod(id, finYear, month);

    // 2. Append the new rows
    if (dataRows.length === 0) return;

    const values = dataRows.map(row => [finYear, month, ...row]);
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:N`);

    await _request(
      `${BASE}/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values }),
      }
    );
  }

  /**
   * Internal: reads row indices for finYear+month and batch-deletes them.
   * Resolves dynamic tab numeric id instead of hardcoding 0.
   */
  async function _deleteRowsForPeriod(spreadsheetId, finYear, month) {
    const range = encodeURIComponent(`${TBR_CONFIG.SHEET_NAME}!A:B`);
    const data = await _request(`${BASE}/${spreadsheetId}/values/${range}`);
    const rows = data.values || [];

    // Collect 0-based sheet row indices
    const toDelete = [];
    for (let i = 1; i < rows.length; i++) {
      if (
        (rows[i][0] || "").trim() === finYear.trim() &&
        (rows[i][1] || "").trim() === month.trim()
      ) {
        toDelete.push(i); // 0-based index
      }
    }

    if (toDelete.length === 0) return;

    // Build delete requests — must process from bottom to top so indices don't shift
    toDelete.sort((a, b) => b - a);

    const sheetId = await _getSheetId(spreadsheetId); // Dynamic extraction fix applied here

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