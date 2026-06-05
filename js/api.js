/**
 * api.js
 * Bulletproof Google Sheets & Drive API with Auto-Create Spreadsheet Feature
 */
const TbrApi = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
  const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

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
      throw new Error(`API error: ${err?.error?.message || resp.statusText}`);
    }
  }

  // ഡൈനാമിക് ആയി ഗൂഗിൾ ഡ്രൈവിൽ ഷീറ്റ് കണ്ടുപിടിക്കാനും ഉണ്ടാക്കാനും ഉള്ള ഭാഗം
  async function ensureSpreadsheet() {
    // ഷീറ്റ് ഐഡി ഓൾറെഡി കിട്ടിയിട്ടുണ്ടെങ്കിൽ അത് തന്നെ ഉപയോഗിക്കാം
    if (TBR_CONFIG.SPREADSHEET_ID && TBR_CONFIG.SPREADSHEET_ID.length > 20) {
      return TBR_CONFIG.SPREADSHEET_ID;
    }

    try {
      // 1. ലോഗിൻ ചെയ്ത ആളുടെ ഗൂഗിൾ ഡ്രൈവിൽ 'Remake_App_Data' എന്ന ഷീറ്റ് ഉണ്ടോ എന്ന് നോക്കുന്നു
      const query = encodeURIComponent("name='Remake_App_Data' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
      const searchUrl = `${DRIVE_BASE}?q=${query}&fields=files(id,name)`;
      
      const searchData = await _request(searchUrl);
      
      if (searchData && searchData.files && searchData.files.length > 0) {
        // ഷീറ്റ് ഉണ്ടെങ്കിൽ അതിന്റെ ഐഡി ഉപയോഗിക്കുന്നു
        TBR_CONFIG.SPREADSHEET_ID = searchData.files[0].id;
        console.log("Existing sheet found in Drive:", TBR_CONFIG.SPREADSHEET_ID);
        return TBR_CONFIG.SPREADSHEET_ID;
      }

      // 2. ഷീറ്റ് ഇല്ലെങ്കിൽ അവരുടെ ഡ്രൈവിൽ പുതിയതൊന്ന് ഉണ്ടാക്കുന്നു
      console.log("Sheet not found. Creating a new one...");
      const createBody = {
        properties: { title: "Remake_App_Data" }
      };
      
      const createData = await _request(BASE, {
        method: "POST",
        body: JSON.stringify(createBody)
      });
      
      TBR_CONFIG.SPREADSHEET_ID = createData.spreadsheetId;
      console.log("New sheet created in Drive:", TBR_CONFIG.SPREADSHEET_ID);
      return TBR_CONFIG.SPREADSHEET_ID;
      
    } catch (err) {
      console.error("Error creating/finding spreadsheet:", err);
      throw err;
    }
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

  // സ്മാർട്ട് മെർജ് ഡാറ്റ സേവിങ്
  async function savePeriodData(finYear, month, dataRows) {
    const id = await ensureSpreadsheet();
    if (!dataRows || dataRows.length === 0) return;

    const sheetName = await _getActualSheetName(id);

    // ഹെഡിങ്ങുകൾ ഷീറ്റിലേക്ക് കൊടുക്കുന്നു (പുതിയ ഷീറ്റാണെങ്കിൽ ഇത് ഉപകരിക്കും)
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
