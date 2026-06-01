/**
 * config.js  (v3 — Treasury + Department added; column order stabilised)
 * =========
 * Central configuration for the Treasury Bill Reconciliation App ("Remake").
 *
 * CHANGELOG v3
 * ------------
 * • Added TREASURY column (col 4, index 4) — shifts all subsequent columns +1.
 * • SPARK_CODE moved to index 5.
 * • DEPARTMENT added at index 6.
 * • GROSS_AMOUNT is now the directly-extracted PDF value, not a computed sum.
 *   (Gross Salary is the Total row value from Page 3 of the SPARK bill.)
 * • OTHER_ALLOWANCE stores the *dynamic sum* of everything between
 *   Rural Allowance and Gross Salary — computed in parser.js, stored here.
 * • HEADER_ROW updated to match new 22-column layout.
 * • SALARY_COMPONENT_COLS updated to exclude Treasury/Department/meta cols.
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
  SPREADSHEET_TITLE:  "Treasury Bill Reconciliation Data",
  SHEET_NAME:         "BillData",

  // ─── Sheet Column Layout (0-indexed; A=0) ────────────────────────────────
  //
  // Full row: [FinYear, Month, Type, BillNo, Treasury, SparkCode, Department,
  //            Pay, DA, HRA, CCA, PGAllowance, RuralAllowance, OtherAllowance,
  //            ConsolidatePay, DailyWages, MS, TourTA, MR,
  //            GrossAmount, EncashDate, Remarks]
  //
  COLUMNS: {
    FIN_YEAR:          0,   // A
    MONTH:             1,   // B
    BILL_TYPE:         2,   // C  "SPARK" | "BiMS"
    BILL_NO:           3,   // D
    TREASURY:          4,   // E  Name of Treasury
    SPARK_CODE:        5,   // F  Spark Code / BRN (last segment)
    DEPARTMENT:        6,   // G  Department / Office name
    PAY:               7,   // H  Basic Less OA/SA → Pay
    DA:                8,   // I
    HRA:               9,   // J
    CCA:               10,  // K
    PG_ALLOWANCE:      11,  // L  PGA
    RURAL_ALLOWANCE:   12,  // M
    OTHER_ALLOWANCE:   13,  // N  Dynamic sum of remaining allowances
    CONSOLIDATE_PAY:   14,  // O
    DAILY_WAGES:       15,  // P
    MS:                16,  // Q  M&S
    TOUR_TA:           17,  // R
    MR:                18,  // S
    GROSS_AMOUNT:      19,  // T  Gross Salary (extracted directly from PDF Total row)
    ENCASH_DATE:       20,  // U
    REMARKS:           21,  // V  Month/Year extracted from bill heading
  },

  HEADER_ROW: [
    "Fin Year", "Month", "Type", "Bill No", "Treasury", "Spark Code/BRN",
    "Department", "Pay", "DA", "HRA", "CCA", "PG Allowance", "Rural Allowance",
    "Other Allowance", "Consolidate Pay", "Daily Wages", "M&S",
    "Tour TA", "MR", "Gross Salary", "Encash Date", "Remarks"
  ],

  // --- Salary component keys used for live Gross preview in the manual form ---
  // (Gross from PDF is direct; this list is for the manual-entry calculator only)
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
