# Treasury Bill Reconciliation App — Integration Guide

## File Structure

```
your-github-pages-repo/
├── index.html             ← Dashboard (data entry) page
├── report.html            ← Report Preview page
├── js/
│   ├── config.js          ← ⚠️  Edit this first (Client ID goes here)
│   ├── auth.js            ← Google OAuth logic
│   ├── api.js             ← Google Sheets API calls
│   ├── parser.js          ← PDF parsing (SPARK + BiMS)
│   ├── dashboard.js       ← Dashboard page logic
│   └── report.js          ← Report page logic
```

---

## Step 1 — Google Cloud Console Setup

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g. "TBR App")
3. **Enable APIs** → Library → enable both:
   - **Google Sheets API**
   - **Google Drive API** *(needed to create the spreadsheet on first run)*
4. **Create credentials** → OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Name: "TBR App Web Client"
   - Authorised JavaScript origins: add your GitHub Pages URL, e.g.
     `https://yourusername.github.io`
     Also add `http://localhost:5500` for local development (Live Server).
5. Copy the **Client ID** — paste it into `js/config.js` → `CLIENT_ID`
6. **OAuth consent screen** → set to **External**, fill in app name + your email.

---

## Step 2 — Edit config.js

Open `js/config.js` and replace:
```js
CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
```
with your real Client ID.

---

## Step 3 — Required HTML data-attributes

The JS modules look for specific `id` and `data-tbr` attributes in your HTML.
Make sure your existing HTML has these (add where missing):

### Auth elements (both pages)
```html
<!-- Sign-in button (shown when logged out) -->
<button data-tbr="signin-btn">Sign in with Google</button>

<!-- Sign-out button (hidden when logged out) -->
<button data-tbr="signout-btn" class="hidden">Sign Out</button>

<!-- Sections only visible after login -->
<div data-tbr="auth-gated" class="hidden"> … main content … </div>

<!-- Optional: shown after sign-in -->
<div id="auth-status-banner" class="hidden"> … welcome message … </div>

<!-- Error display -->
<p id="auth-error-msg" class="hidden text-red-500"></p>

<!-- Toast container (top-right corner) -->
<div id="toast-container" class="fixed top-4 right-4 z-50"></div>

<!-- Loading overlay -->
<div id="loading-overlay" class="hidden fixed inset-0 bg-black/40 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg px-8 py-6 shadow-xl">
    <p id="loading-message" class="text-gray-700">Loading…</p>
  </div>
</div>
```

### Dashboard-specific IDs (index.html)
```html
<!-- Period selectors -->
<select id="select-fin-year"></select>
<select id="select-month"></select>

<!-- PDF upload -->
<div id="pdf-dropzone" class="border-2 border-dashed border-gray-300 rounded p-8 text-center">
  Drop PDFs here or click Upload
</div>
<input type="file" id="pdf-file-input" accept="application/pdf" multiple class="hidden">
<button id="pdf-upload-btn">Upload PDF</button>

<!-- Preview table -->
<table>
  <thead>…</thead>
  <tbody id="bill-table-body"></tbody>
</table>
<div id="table-empty-state">No rows yet.</div>
<span id="row-count-badge">0 rows</span>

<!-- Manual entry form fields -->
<select id="manual-bill-type">
  <option value="SPARK">SPARK</option>
  <option value="BiMS">BiMS</option>
</select>
<input type="text"   id="manual-bill-no"     placeholder="Bill Number">
<input type="text"   id="manual-ddo-code"    placeholder="DDO Code">
<input type="text"   id="manual-dept"        placeholder="Department">
<input type="text"   id="manual-hoa"         placeholder="Head of Account">
<input type="number" id="manual-net-amount"  placeholder="Net Amount">
<button id="manual-add-btn">Add Row</button>

<!-- Action buttons -->
<button id="save-to-sheet-btn">Save to Sheet</button>
<button id="clear-table-btn">Clear</button>
```

### Report-specific IDs (report.html)
```html
<!-- Period selectors -->
<select id="report-fin-year"></select>
<select id="report-month"></select>

<!-- Generate button -->
<button id="generate-report-btn">Generate Report</button>

<!-- Report header -->
<h1 id="report-title"></h1>
<p  id="report-subtitle"></p>
<p  id="report-generated-date"></p>

<!-- Summary cards (optional) -->
<span id="bill-count"></span>
<span id="bill-total-amount"></span>
<span id="summary-grand-total"></span>

<!-- Bill Details table -->
<table>
  <thead>
    <tr>
      <th>#</th><th>Type</th><th>Bill No</th>
      <th>DDO Code</th><th>Department</th>
      <th>Head of A/C</th><th>Net Amount</th>
    </tr>
  </thead>
  <tbody id="bill-details-tbody"></tbody>
</table>

<!-- Summary / HoA table -->
<table>
  <thead>
    <tr>
      <th>#</th><th>MJH</th><th>SMJH</th><th>MIH</th>
      <th>SBHLH</th><th>SHLH</th><th>VOH</th><th>SOH</th>
      <th>Current Month</th><th>Upto Prev Month</th><th>Progressive Total</th>
    </tr>
  </thead>
  <tbody id="summary-tbody"></tbody>
</table>

<!-- Report content wrapper (hidden until generated) -->
<div id="report-content" class="hidden"> … all tables above … </div>

<!-- Print button -->
<button id="print-report-btn">Print / Export PDF</button>
```

---

## Step 4 — Script Tags

### Dashboard page (index.html) — paste before `</body>`

```html
<!-- 1. pdf.js for client-side PDF text extraction -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
</script>

<!-- 2. Google Identity Services (GIS) -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- 3. App scripts (order matters) -->
<script src="js/config.js"></script>
<script src="js/auth.js"></script>
<script src="js/api.js"></script>
<script src="js/parser.js"></script>
<script src="js/dashboard.js"></script>
```

### Report page (report.html) — paste before `</body>`

```html
<!-- 1. Google Identity Services (GIS) -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- 2. App scripts (order matters) -->
<script src="js/config.js"></script>
<script src="js/auth.js"></script>
<script src="js/api.js"></script>
<script src="js/parser.js"></script>
<script src="js/report.js"></script>
```

> **Note:** `parser.js` is included in both pages because `report.js` uses
> `TbrParser.parseAmount()` for number formatting. If you want to shave bytes,
> you could extract just that utility into a `utils.js` shared module.

---

## Step 5 — Google Sheets Database Structure

The app auto-creates a spreadsheet called **"Treasury Bill Reconciliation Data"**
in the signed-in user's Google Drive on the first save. The `BillData` sheet
has these columns (row 1 = header):

| A         | B      | C         | D       | E        | F           | G          | H   | I    | J   | K     | L    | M   | N   |
|-----------|--------|-----------|---------|----------|-------------|------------|-----|------|-----|-------|------|-----|-----|
| Fin Year  | Month  | Bill Type | Bill No | DDO Code | Department  | Net Amount | MJH | SMJH | MIH | SBHLH | SHLH | VOH | SOH |

- One row per **bill per Head of Account** (a single PDF may produce multiple rows
  if it contains multiple HoAs).
- **Upsert behaviour**: saving for a period deletes all existing rows for that
  `FinYear + Month` combination before inserting the new data, so re-saving
  always produces a clean, authoritative set of rows.

---

## How the Summary Calculations Work

For a selected period (e.g. Financial Year 2024-25, Month = November):

| Column              | Calculation                                      |
|---------------------|--------------------------------------------------|
| Current Month       | Sum of `Net Amount` where `Month = November`     |
| Upto Previous Month | Sum of `Net Amount` where `Month IN (April … October)` |
| Progressive Total   | Current Month + Upto Previous Month              |

Rows are first grouped by their **canonical Head of Account** (MJH-SMJH-MIH-SBHLH-SHLH-VOH-SOH).
All three totals are computed per unique HoA group.

---

## Local Development

1. Install the **Live Server** VS Code extension (or use `npx serve .`)
2. Open `http://localhost:5500` — make sure this origin is in your Google Cloud
   OAuth "Authorised JavaScript origins" list
3. Sign in → the app will create a spreadsheet in your Drive automatically

---

## Print Styles (add to your CSS)

```css
@media print {
  /* Hide everything except the report */
  body > *:not(#report-content) { display: none !important; }
  #report-content { display: block !important; }
  button, [data-tbr] { display: none !important; }
  @page { margin: 1.5cm; }
}
```

---

## Security Notes

- The **Client ID** is safe to expose in public JS — it identifies your app but
  cannot be used without the user's explicit OAuth consent.
- Access tokens are stored **in memory only** (never localStorage/sessionStorage).
- The spreadsheet is created in the **user's own Google Drive** — your app never
  stores or sees the data on any server.
- For production, restrict the OAuth Client ID's allowed origins to only your
  GitHub Pages domain.
