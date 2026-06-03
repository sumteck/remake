/**
 * config.js
 * Configuration settings for the Remake application.
 */

const TBR_CONFIG = {
  CLIENT_ID: "1062984053184-8vco89mhmk04q1516obf8i2qvshk2c1t.apps.googleusercontent.com",
  SPREADSHEET_ID: "1RjN1B-y-E2yvA9j6v2nJ8l4a2L1f9-f7v9A2_b_v3wE",
  SHEET_NAME: "BillData",
  COLUMNS: {
    FIN_YEAR: 0,
    MONTH: 1,
    BILL_TYPE: 2,
    BILL_NO: 3,
    TREASURY: 4,
    HOA: 5,               // Head of Account
    SPARK_CODE: 6,
    DEPARTMENT: 7,
    PAY: 8,
    DA: 9,
    HRA: 10,
    CCA: 11,
    PG_ALLOWANCE: 12,
    RURAL_ALLOWANCE: 13,
    OTHER_ALLOWANCE: 14,
    CONSOLIDATE_PAY: 15,
    DAILY_WAGES: 16,
    MS: 17,
    TOUR_TA: 18,
    MR: 19,
    GROSS_AMOUNT: 20,
    ENCASH_DATE: 21,
    REMARKS: 22
  },
  FY_MONTHS: ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"],
  SCOPES: "https://www.googleapis.com/auth/spreadsheets"
};
