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
 *
 * CHANGELOG (v2 — New Salary Breakdown Columns)
 * -----------------------------------------------
 * Added 9 new salary component columns to support the updated bill entry form:
 *   Pay, DA, HRA, CCA, PG Allowance, Rural Allowance, Other Allowance,
 *   Consolidate Pay, Daily Wages, M&S, Tour TA, MR
 * Also added SparkCode/BRN, EncashDate, and Remarks fields.
 * GrossAmount is now computed (read-only) = sum of all salary components.
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
  SPREADSHEET_ID_KEY: "tbr_spreadsheet_id",
  SPREADSHEET_TITLE: "Treasury Bill Reconciliation Data",
  SHEET_NAME: "BillData",

  // --- Sheet Column Layout (A=0 index) ---
  // Row format: [FinYear, Month, Type, BillNo, SparkCode, Pay, DA, HRA, CCA,
  //              PGAllowance, RuralAllowance, OtherAllowance, ConsolidatePay,
  //              DailyWages, MS, TourTA, MR, GrossAmount, EncashDate, Remarks]
  COLUMNS: {
    FIN_YEAR:          0,   // A
    MONTH:             1,   // B
    BILL_TYPE:         2,   // C  "SPARK" | "BiMS"
    BILL_NO:           3,   // D
    SPARK_CODE:        4,   // E  Spark Code / BRN
    PAY:               5,   // F
    DA:                6,   // G
    HRA:               7,   // H
    CCA:               8,   // I
    PG_ALLOWANCE:      9,   // J
    RURAL_ALLOWANCE:   10,  // K
    OTHER_ALLOWANCE:   11,  // L
    CONSOLIDATE_PAY:   12,  // M
    DAILY_WAGES:       13,  // N
    MS:                14,  // O  M&S
    TOUR_TA:           15,  // P
    MR:                16,  // Q
    GROSS_AMOUNT:      17,  // R  Computed = sum of all salary components
    ENCASH_DATE:       18,  // S
    REMARKS:           19,  // T
  },

  HEADER_ROW: [
    "Fin Year", "Month", "Type", "Bill No", "Spark Code/BRN",
    "Pay", "DA", "HRA", "CCA", "PG Allowance", "Rural Allowance",
    "Other Allowance", "Consolidate Pay", "Daily Wages", "M&S",
    "Tour TA", "MR", "Gross Salary", "Encash Date", "Remarks"
  ],

  // --- Salary component keys (used for auto-sum to GrossAmount) ---
  SALARY_COMPONENT_COLS: [
    "PAY", "DA", "HRA", "CCA", "PG_ALLOWANCE", "RURAL_ALLOWANCE",
    "OTHER_ALLOWANCE", "CONSOLIDATE_PAY", "DAILY_WAGES", "MS", "TOUR_TA", "MR"
  ],

  // --- Financial Year Months (April → March) ---
  FY_MONTHS: [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March"
  ],
};
