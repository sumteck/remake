/**
 * config.js
 * =========
 * Central configuration for the Treasury Bill Reconciliation App.
 *
 * ⚠️  SETUP REQUIRED:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a project → Enable "Google Sheets API" and "Google Drive API"
 * 3. Create OAuth 2.0 Client ID (Web Application)
 * 4. Add your GitHub Pages URL to "Authorised JavaScript origins"
 * 5. Replace the placeholder values below with your real credentials.
 */

const TBR_CONFIG = {
  // --- Google OAuth 2.0 ---
  CLIENT_ID: "1062984053184-8vco89mhmk04q1516obf8i2qvshk2c1t.apps.googleusercontent.com",

  // --- Google API Scopes ---
  SCOPES: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),

  // --- Spreadsheet Settings ---
  // Leave empty on first run; the app will create a sheet and store the ID in localStorage.
  SPREADSHEET_ID_KEY: "tbr_spreadsheet_id",  // localStorage key
  SPREADSHEET_TITLE: "Treasury Bill Reconciliation Data",
  SHEET_NAME: "BillData",

  // --- Sheet Column Layout (A=0 index) ---
  // Row format: [FinYear, Month, BillType, BillNo, DDOCode, Dept, NetAmount, MJH, SMJH, MIH, SBHLH, SHLH, VOH, SOH]
  COLUMNS: {
    FIN_YEAR:   0,   // A
    MONTH:      1,   // B
    BILL_TYPE:  2,   // C  "SPARK" | "BiMS"
    BILL_NO:    3,   // D
    DDO_CODE:   4,   // E
    DEPT:       5,   // F
    NET_AMOUNT: 6,   // G
    MJH:        7,   // H  Major Head
    SMJH:       8,   // I  Sub-Major Head
    MIH:        9,   // J  Minor Head
    SBHLH:      10,  // K  Sub-Head
    SHLH:       11,  // L  Scheme Head
    VOH:        12,  // M  Voted/Charged
    SOH:        13,  // N  Sub-Object Head
  },

  HEADER_ROW: [
    "Fin Year", "Month", "Bill Type", "Bill No", "DDO Code",
    "Department", "Net Amount", "MJH", "SMJH", "MIH", "SBHLH", "SHLH", "VOH", "SOH"
  ],

  // --- Financial Year Months (April → March) ---
  FY_MONTHS: [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March"
  ],
};
