/**
 * config.js
 * =========
 */

const TBR_CONFIG = {
  CLIENT_ID: "1062984053184-8vco89mhmk04q1516obf8i2qvshk2c1t.apps.googleusercontent.com",

  SCOPES: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),

  SPREADSHEET_ID_KEY: "tbr_spreadsheet_id", 
  SPREADSHEET_TITLE: "Treasury Bill Reconciliation Data",
  SHEET_NAME: "BillData",

  COLUMNS: {
    FIN_YEAR:   0,   // A
    MONTH:      1,   // B
    BILL_TYPE:  2,   // C
    BILL_NO:    3,   // D
    SPARK_CODE: 4,   // E
    TREASURY:   5,   // F
    DDO_CODE:   6,   // G
    DEPT:       7,   // H
    MJH:        8,   // I
    SMJH:       9,   // J
    MIH:        10,  // K
    SBHLH:      11,  // L
    SHLH:       12,  // M
    VOH:        13,  // N
    SOH:        14,  // O
    BASIC:      15,  // P
    DA:         16,  // Q
    HRA:        17,  // R
    CCA:        18,  // S
    OTHER_ALLOWANCES: 19, // T
    NET_AMOUNT: 20,  // U (Gross Salary)
    ENCASHMENT_DATE: 21, // V (പുതിയത്)
    REMARKS: 22,         // W (പുതിയത്)
  },

  HEADER_ROW: [
    "Fin Year", "Month", "Bill Type", "Bill No", "Spark Code", "Treasury", "DDO Code", "Department",
    "MJH", "SMJH", "MIH", "SBHLH", "SHLH", "VOH", "SOH",
    "Basic Less OA/SA", "DA", "HRA", "CCA", "Other Allowances", "Gross Salary", "Date of Encashment", "Remarks"
  ],

  FY_MONTHS: [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March"
  ],
};