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
    OFFICE_NAME: 8,  // I (ഇതാണ് പുതിയതായി ചേർത്തത്)
    MJH:        9,   // J
    SMJH:       10,  // K
    MIH:        11,  // L
    SBHLH:      12,  // M
    SHLH:       13,  // N
    VOH:        14,  // O
    SOH:        15,  // P
    BASIC:      16,  // Q
    DA:         17,  // R
    HRA:        18,  // S
    CCA:        19,  // T
    OTHER_ALLOWANCES: 20, // U
    NET_AMOUNT: 21,  // V (Gross Salary)
    ENCASHMENT_DATE: 22, // W
    REMARKS: 23,         // X
  },

  HEADER_ROW: [
    "Fin Year", "Month", "Bill Type", "Bill No", "Spark Code", "Treasury", "DDO Code", "Department", "Office Name",
    "MJH", "SMJH", "MIH", "SBHLH", "SHLH", "VOH", "SOH",
    "Pay", "DA", "HRA", "CCA", "Other Allowances", "Gross Salary", "Date of Encashment", "Remarks"
  ],

  FY_MONTHS: [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March"
  ],
};