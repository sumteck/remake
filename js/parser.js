/**
 * parser.js  (v4 — Production-hardened: template sanitisation + micro-gap merge)
 * =========
 * Client-side PDF text extraction and bill data parsing for the Remake app.
 *
 * Handles two treasury bill formats:
 * • SPARK bills  — Pay-slip style, multi-page.
 *                  Detection: "Net Sal" | "Gross Salary" | "Spark Code"
 * • BiMS  bills  — Head-of-Account space-separated.
 *                  Detection: "Net Amount"
 *
 * ── ARCHITECTURAL FIXES IN v4 ────────────────────────────────────────────────
 *
 * FIX 1 — TEMPLATE SANITISATION (glued-text bug)
 *   Bill templates contain long runs of underscores (______) or dots (.....).
 *   pdf.js extracts text items in DOM order, so words immediately adjacent to
 *   these fill-lines get concatenated without any separator, e.g.:
 *     "GAD SASTHAMKOTTABill No:Head of Account"
 *   Solution: after assembling each page string, replace every run of 2+
 *   underscores or dots with a single space BEFORE any regex is applied.
 *   Regex: /[_.]{2,}/g  → " "
 *
 * FIX 2 — MICRO-GAP DIGIT/CHARACTER MERGE (kerning-split numbers bug)
 *   pdf.js sometimes splits one rendered glyph cluster into two consecutive
 *   items.  For large numbers this causes '736' + '00' instead of '73600',
 *   which then shifts every column index by one.
 *   Solution: during text-content assembly, compare each adjacent item pair
 *   using their transform[4] (x) and transform[5] (y) coordinates.
 *   If dY <= 5 px  AND  dX <= 2.5 px  → merge without inserting a space.
 *   Otherwise insert a normal space as before.
 *
 * FIX 3 — ACCURATE FIELD EXTRACTORS
 *   • Treasury  : full multi-word name including parenthetical code.
 *   • DDO Code  : 3-part hyphenated format  (e.g. "1503-320-105").
 *   • Spark Code: COMPLETE digit sequence, all groups, normalised spaces.
 *                 NO slicing — the full "99637 95973 95709 35547" is returned.
 *   • Bill No   : standalone 8-digit token.
 *   • Remarks   : "SDO Bill FOR <Month> <Year>" heading → "April 2026".
 *   • Dept/Office: anchor on "GOVERNMENT OF KERALA"; next non-trivial line =
 *                  Department, line after that = Office Name (primary display).
 *
 * FIX 4 — SALARY BREAKDOWN (skip B Pay/L.Sal; derive otherAllowance by math)
 *   Total-row number array after sanitisation:
 *     [0] B Pay/L.Sal  ← SKIP (sentinel column, not a real component)
 *     [1] Basic Less OA/SA  → pay
 *     [2] DA  [3] HRA  [4] CCA  [5] PGA  [6] Rural Allowance
 *     ...middle columns (variable count)...
 *     [last] Gross Salary
 *   otherAllowance = max(0, grossAmount - (pay+da+hra+cca+pgAllowance+ruralAllowance))
 *   netAmount / Net Salary references fully replaced by grossAmount.
 *
 * Depends on: pdf.js (loaded via CDN in HTML)
 */

const TbrParser = (() => {

  // =========================================================================
  // STAGE 1 — PDF TEXT EXTRACTION WITH MICRO-GAP MERGE
  // =========================================================================

  /**
   * _sanitise(str)
   * Replaces every run of 2+ consecutive underscores or dots with one space,
   * then collapses multiple spaces to one.  This is the first defence against
   * the glued-text artefact produced by fill-line decorations in the template.
   */
  function _sanitise(str) {
    return str
      .replace(/[_.]{2,}/g, " ")   // FIX 1 — template fill-lines
      .replace(/\s{2,}/g, " ")     // collapse residual multi-spaces
      .trim();
  }

  /**
   * _assemblePageItems(items)
   * Iterates the raw pdf.js TextItem array for one page and builds the page
   * string using coordinate-aware merging (FIX 2).
   *
   * Each item carries a `transform` array: [scaleX, skewY, skewX, scaleY, x, y]
   * We use transform[4]=x (horizontal) and transform[5]=y (vertical).
   *
   * Rule:
   *   dY = |prevY - curY|  <= 5  AND  dX = curX - (prevX + prevWidth)  <= 2.5
   *   merging directly (no space) reattaches kerning-split glyph clusters.
   *   Otherwise insert a normal space between items.
   *
   * After assembly the result is passed through _sanitise().
   */
  function _assemblePageItems(items) {
    if (!items || items.length === 0) return "";

    let result    = "";
    let prevX     = 0;
    let prevY     = 0;
    let prevWidth = 0;
    let first     = true;

    for (const item of items) {
      const str = item.str;
      if (str === undefined || str === null || str === "") continue;

      const x = item.transform ? item.transform[4] : 0;
      const y = item.transform ? item.transform[5] : 0;
      const w = item.width  || 0;

      if (first) {
        result    = str;
        prevX     = x;
        prevY     = y;
        prevWidth = w;
        first     = false;
        continue;
      }

      const dY = Math.abs(y - prevY);
      const dX = x - (prevX + prevWidth);

      if (dY <= 5 && dX <= 2.5) {
        // FIX 2 — micro-gap: merge without any separator
        result += str;
      } else {
        result += " " + str;
      }

      prevX     = x;
      prevY     = y;
      prevWidth = w;
    }

    return _sanitise(result);
  }

  /**
   * extractPdfPages(file)
   * Returns an array of sanitised, gap-merged page strings.
   * Page index 0 = Page 1, index 2 = Page 3, etc.
   */
  async function extractPdfPages(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf   = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(_assemblePageItems(content.items));
    }
    return pages;
  }

  /** Full document text — all pages joined with newline separators. */
  async function extractPdfText(file) {
    const pages = await extractPdfPages(file);
    return pages.join("\n");
  }

  // =========================================================================
  // STAGE 2 — BILL TYPE DETECTION
  // =========================================================================

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal") || t.includes("gross salary") || t.includes("spark code")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  // =========================================================================
  // STAGE 3 — UTILITY HELPERS
  // =========================================================================

  /** Strip commas/spaces and parse to float. Returns 0 for invalid input. */
  function parseAmount(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/,/g, "").replace(/\s/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  function _toTitleCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // Head of Account helpers

  function _mapHoaParts(parts) {
    const p = [...parts];
    while (p.length < 7) p.push("00");
    return {
      MJH:   p[0] || "00", SMJH:  p[1] || "00", MIH:   p[2] || "00",
      SBHLH: p[3] || "00", SHLH:  p[4] || "00", VOH:   p[5] || "00", SOH: p[6] || "00",
    };
  }

  function parseSparkHoA(hoaStr) { return _mapHoaParts(hoaStr.trim().split("-")); }
  function parseBimsHoA(hoaStr)  { return _mapHoaParts(hoaStr.trim().split(/\s+/)); }

  function canonicalHoA(hoaObj) {
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH,
            hoaObj.SBHLH, hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-");
  }

  // =========================================================================
  // STAGE 4 — SPARK FIELD EXTRACTORS (v4 accurate versions)
  // =========================================================================

  /**
   * _extractTreasury(page1)
   * Captures the full treasury name including sub-office and parenthetical code.
   * Expected format after sanitisation:
   *   "Name Of Treasury : Sub Treasury, Perinthalmanna (1503)"
   * or short form:
   *   "Name Of Treasury : MANJERI"
   *
   * The capture runs until the next label-like boundary.
   */
  function _extractTreasury(page1) {
    // Primary: labelled "Name Of Treasury"
    const m = page1.match(
      /Name\s+Of\s+Treasury\s*[:\-]\s*(.+?)(?=\s{2,}|\b(?:DDO|Bill\s*No|Head\s*of)\b|$)/i
    );
    if (m) return m[1].trim().replace(/\s+/g, " ");

    // Fallback: bare "Treasury :" label
    const m2 = page1.match(
      /\bTreasury\s*[:\-]\s*(.+?)(?=\s{2,}|\b(?:DDO|Bill\s*No|Head\s*of)\b|$)/i
    );
    if (m2) return m2[1].trim().replace(/\s+/g, " ");

    return "";
  }

  /**
   * _extractDdoCode(page1)
   * Captures the 3-part hyphenated DDO Code: e.g. "1503-320-105".
   */
  function _extractDdoCode(page1) {
    // Strict: numeric groups separated by hyphens
    const m = page1.match(/DDO\s*Code\s*[:\-]\s*(\d{1,6}-\d{1,6}-\d{1,6})/i);
    if (m) return m[1].trim();

    // Broader: any alphanumeric after "DDO Code"
    const m2 = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m2) return m2[1].trim();

    // Bare "DDO" label
    const m3 = page1.match(/\bDDO\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m3) return m3[1].trim();

    return "";
  }

  /**
   * _extractSparkCode(text)
   * Returns the COMPLETE Spark Code digit sequence — ALL groups joined with
   * single spaces.  e.g. "99637 95973 95709 35547".
   *
   * The full sequence is required for reconciliation.  Internal multi-spaces
   * (possible artefact of gap-merging) are normalised to a single space.
   * Nothing is sliced or discarded.
   */
  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]\s*((?:\d{4,6}\s*){1,10})/i);
    if (m) {
      const segments = m[1].trim().split(/\s+/).filter(s => /^\d{4,6}$/.test(s));
      if (segments.length > 0) return segments.join(" ");
    }
    return "";
  }

  /**
   * _extractSparkBillNo(text)
   * Extracts the standalone 8-digit Bill Number.
   */
  function _extractSparkBillNo(text) {
    // Number before "Digitally signed"
    let m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();

    // Explicit "Bill No" label
    m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();

    // Standalone 8-digit number
    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();

    return "";
  }

  /**
   * _extractRemarks(text)
   * Locates "SDO Bill FOR <Month> <Year>" and returns e.g. "April 2026".
   */
  function _extractRemarks(text) {
    const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

    // Primary: exact heading "SDO Bill FOR <Month> <Year>"
    const rePrimary = new RegExp(
      "\\bSDO\\s+Bill\\s+FOR\\s+(" + MONTHS + ")\\s+(\\d{4})\\b", "i"
    );
    const m = text.match(rePrimary);
    if (m) return _toTitleCase(m[1]) + " " + m[2];

    // Secondary: any "FOR <Month> <Year>"
    const reSecondary = new RegExp("\\bFOR\\s+(" + MONTHS + ")\\s+(\\d{4})\\b", "i");
    const m2 = text.match(reSecondary);
    if (m2) return _toTitleCase(m2[1]) + " " + m2[2];

    // Fallback: bare "Month YYYY"
    const reFallback = new RegExp("\\b(" + MONTHS + ")\\s+(20\\d{2})\\b", "i");
    const m3 = text.match(reFallback);
    if (m3) return _toTitleCase(m3[1]) + " " + m3[2];

    return "";
  }

  /**
   * _extractDeptAndOffice(page3)
   * Anchors on "GOVERNMENT OF KERALA".
   * Structure in the SPARK template (each field separated by 2+ spaces):
   *   GOVERNMENT OF KERALA
   *   <Department>    e.g. "Indian Systems of Medicine"
   *   <Office Name>   e.g. "GOVT AYURVEDA DISPENSARY ANGADIPPURAM"
   *
   * chunks[0] = Department (broader group)
   * chunks[1] = Office Name (primary display value)
   *
   * Returns { department: string, office: string }
   */
  function _extractDeptAndOffice(page3) {
    const TABLE_HEADER_RE = /^(Sl|No\.?|Name|Basic|DA|HRA|CCA|PGA|Rural|Gross|Total|Pay|Bill|For|Head|Voucher|Amount|B\s*Pay)\b/i;

    const govIdx = page3.search(/GOVERNMENT\s+OF\s+KERALA/i);
    if (govIdx !== -1) {
      const afterGov = page3
        .slice(govIdx)
        .replace(/GOVERNMENT\s+OF\s+KERALA/i, "")
        .trim();

      const chunks = afterGov
        .split(/\s{2,}/)
        .map(c => c.trim())
        .filter(c => c.length >= 4 && /[A-Za-z]/.test(c))
        .filter(c => !TABLE_HEADER_RE.test(c));

      const department = chunks[0] || "";
      const office     = chunks[1] || "";
      return { department, office };
    }

    // Fallback: labelled patterns
    const deptMatch = page3.match(/Department\s*[:\-]\s*([^\n\r]+)/i);
    const offMatch  = page3.match(/(?:Office\s+Name|Name\s+of\s+Office)\s*[:\-]\s*([^\n\r]+)/i);
    return {
      department: deptMatch ? deptMatch[1].trim().replace(/\s+/g, " ") : "",
      office:     offMatch  ? offMatch[1].trim().replace(/\s+/g, " ")  : "",
    };
  }

  // =========================================================================
  // STAGE 5 — SMART HYBRID SALARY ENGINE (COLUMN-SHIFT IMMUNE)
  // =========================================================================

  /**
   * _extractSalaryBreakdown(fullText)
   *
   * A two-layer extraction engine that is immune to missing columns (PGA,
   * Rural Allowance absent in some months), arrear bills (pay = 0 is valid),
   * and PDF kerning artefacts that split numbers across items.
   *
   * ── LAYER A — ABSTRACT SECTION / STATUTORY CODES (Primary) ──────────────
   * The "ABSTRACT OF THE BILL" section lists every allowance component with
   * its government-assigned statutory code number.  These codes are fixed by
   * GO and never change regardless of which columns appear in the pay table:
   *
   *   Code 01  → Pay / Basic Less OA/SA  (also: Wages, TP, SP)
   *   Code 22  → DA / ADA
   *   Code 23  → HRA
   *   Code 24  → CCA
   *   Code 64  → PG Allowance
   *   Code 45  → Rural Allowance
   *
   * Statutory-code extraction is inherently column-position-independent.
   * A component is zero only if its code line is genuinely absent, not because
   * a column shifted.
   *
   * ── LAYER B — TABLE ROW FALLBACK (Pay only) ──────────────────────────────
   * When Code 01 yields nothing (rare arrear/special bill format), we flatten
   * the text and search for a number sequence that contains the known gross
   * amount.  The 2nd value in that sequence (index 1, after skipping the
   * B Pay/L.Sal sentinel at index 0) is taken as Pay.
   *
   * ── LAYER C — GROSS AMOUNT ───────────────────────────────────────────────
   * Gross is always read from the labelled "Total A Gross" or "Gross Salary"
   * anchor — never derived by summing components — because the abstract section
   * is the authoritative total regardless of how many middle columns exist.
   *
   * ── LAYER D — OTHER ALLOWANCE (Mathematical cross-check) ─────────────────
   * otherAllowance = Gross − (Pay + DA + HRA + CCA + PGA + Rural)
   * This absorbs every unlisted allowance (Special Pay, Ex-Gratia, etc.)
   * without needing to know their codes.  Floored at 0 to handle rounding.
   *
   * @param  {string} fullText  Sanitised, gap-merged full document text.
   * @returns {{ pay, da, hra, cca, pgAllowance, ruralAllowance,
   *             otherAllowance, grossAmount }}
   */
// =========================================================================
  // STAGE 4 — ULTIMATE HYBRID SALARY ENGINE (REPEATED CODE BYPASS FIX)
  // =========================================================================

  function _extractSalaryBreakdown(fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    // 1. Gross Salary കൃത്യമായി എടുക്കുന്നു
    const mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:\-]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    // 2. ABSTRACT OF THE BILL സെക്ഷൻ മാത്രം മുറിച്ചെടുക്കുന്നു
    let abstractText = fullText;
    const absMatch = fullText.match(/ABSTRACT\s*OF\s*THE\s*BILL([\s\S]*?)(?:Total\s*A\s*Gross|Gross\s*Salary|Commonly\s*used)/i);
    if (absMatch) {
      abstractText = absMatch[1];
    } else {
      abstractText = fullText.split(/Commonly\s*used\s*Dues/i)[0];
    }

    // 3. Smart Code Scanner: ബ്രാക്കറ്റിലെ കോഡുകളെ (ഉദാ: 64) തുകയായി തെറ്റിദ്ധരിക്കില്ല!
    const extractCodeValue = (codeStr) => {
      const regex = new RegExp(`(?<!\\d)${codeStr}(?![\\d])`, 'i');
      const match = abstractText.match(regex);
      if (!match) return 0;

      // കോഡിന് ശേഷമുള്ള അക്കങ്ങൾ മാത്രം സ്കാൻ ചെയ്യുന്നു
      const afterText = abstractText.substring(match.index + match[0].length);
      const chunk = afterText.substring(0, 100); 
      
      const nums = [];
      const numRegex = /[\d,]+/g;
      let m;
      while ((m = numRegex.exec(chunk)) !== null) {
        nums.push(parseAmount(m[0]));
      }

      if (nums.length === 0) return 0;
      
      // കിട്ടിയ ആദ്യത്തെ നമ്പർ അലവൻസ് കോഡ് തന്നെയാണെങ്കിൽ, അത് സ്കിപ്പ് ചെയ്ത് രണ്ടാമത്തെ നമ്പർ എടുക്കുന്നു
      if (nums[0] === parseInt(codeStr, 10) && nums.length > 1) {
        return nums[1];
      }
      
      return nums[0];
    };

    result.da             = extractCodeValue('22');
    result.hra            = extractCodeValue('23');
    result.cca            = extractCodeValue('24');
    result.pgAllowance    = extractCodeValue('64');
    result.ruralAllowance = extractCodeValue('45');

    // 4. Pay (Code 01 വഴി എടുക്കുന്നു)
    result.pay = extractCodeValue('01');
    
    // അഥവാ കിട്ടിയില്ലെങ്കിൽ Page 2-ലെ ടേബിൾ വരിയിൽ നിന്നും എടുക്കുന്നു (ബാക്കപ്പ്)
    if (result.pay === 0) {
      const flatText = fullText.replace(/\n/g, " ");
      const tableRegex = /\bTotal\b\s+((?:\d+\s+){5,}\d+)/ig;
      let match;
      while ((match = tableRegex.exec(flatText)) !== null) {
        const nums = match[1].trim().split(/\s+/).map(Number);
        if (result.grossAmount > 0 && nums.includes(result.grossAmount)) {
          result.pay = nums[1] || 0; 
          break; 
        }
      }
    }

    // 5. Other Allowance Math
    const knownSum = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
    
    if (result.grossAmount > knownSum) {
      result.otherAllowance = result.grossAmount - knownSum;
    } else {
      result.otherAllowance = 0;
    }

    return result;
  }

  // =========================================================================
  // STAGE 6 — MAIN SPARK PARSER
  // =========================================================================

  /**
   * parseSparkBillFull(file)
   * Orchestrates per-page extraction for SPARK bills.
   * All page strings are already sanitised and gap-merged by extractPdfPages()
   * before any extractor sees them.
   */
  async function parseSparkBillFull(file) {
    const pages    = await extractPdfPages(file);
    const fullText = pages.join("\n");

    const page1 = pages[0] || "";
    const page3 = pages[2] || pages[1] || fullText;

    const treasury               = _extractTreasury(page1);
    const ddoCode                = _extractDdoCode(page1);
    const sparkCode              = _extractSparkCode(fullText);  // FULL sequence
    const billNo                 = _extractSparkBillNo(fullText);
    const remarks                = _extractRemarks(fullText);
    const { department, office } = _extractDeptAndOffice(page3);
    const salary                 = _extractSalaryBreakdown(fullText);  // needs full doc for Abstract section

    // Head of Account — hyphenated 7-part format
    const hoaMatch = fullText.match(
      /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/
    );
    const hoa    = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;
    const rawHoA = hoaMatch ? hoaMatch[1] : "";

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      sparkCode,                            // COMPLETE sequence e.g. "99637 95973 95709 35547"
      department:      office || department, // Office Name is the primary display field
      departmentGroup: department,           // Broader department group
      ddoCode,
      remarks,                              // e.g. "April 2026"
      pay:             salary.pay,
      da:              salary.da,
      hra:             salary.hra,
      cca:             salary.cca,
      pgAllowance:     salary.pgAllowance,
      ruralAllowance:  salary.ruralAllowance,
      otherAllowance:  salary.otherAllowance,  // Math-derived residual
      consolidatePay:  0,
      dailyWages:      0,
      ms:              0,
      tourTa:          0,
      mr:              0,
      grossAmount:     salary.grossAmount,     // Primary financial total (no netAmount)
      hoa,
      rawHoA,
    };
  }

  // =========================================================================
  // STAGE 7 — BIMS PARSER
  // =========================================================================
  //
  // BiMS bills do not use the multi-column salary table.  Gross amount is read
  // from a single labelled field.  Sanitisation and gap-merging still run via
  // extractPdfText() (FIX 1 + FIX 2 applied automatically).

  function _extractBimsBillNo(text) {
    let m = text.match(/(\d{15,25})\s*Period\s*of\s*claim/i);
    if (m) return m[1].trim();

    m = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) return m[1].trim();

    m = text.match(/(?:Bill\s*Reference\s*Number|BRN|Voucher\s*No|Bill\s*No)[\s.:]*(\d[\d\/\-]*)/i);
    if (m) return m[1].trim();

    return "";
  }

  function _extractBimsGrossAmount(text) {
    let m = text.match(/Total\s*\(A\)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (m) return parseAmount(m[1]);

    m = text.match(/Gross\s*Bill\s*Amount\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (m) return parseAmount(m[1]);

    return 0;
  }

  function _extractDeptBims(text) {
    const patterns = [
      /\bDepartment[:\s]+([^\n\r]+)/i,
      /\bName\s+of\s+Office[:\s]+([^\n\r]+)/i,
      /\bOffice[:\s]+([^\n\r]+)/i,
      /\bDept[:\s]+([^\n\r]+)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const val = m[1].trim()
          .replace(/\s*\b(?:Bill\s*(?:No|Number)|Voucher\s*No|DDO\s*Code|Net\s*Amount|Major\s*Head)\b.*$/i, "")
          .trim();
        if (val) return val;
      }
    }
    return "";
  }

  async function parseBimsBillFull(file) {
    const text = await extractPdfText(file);

    const billNoStr = _extractBimsBillNo(text);
    const gross     = _extractBimsGrossAmount(text);
    const dept      = _extractDeptBims(text);

    const ddoMatch = text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i)
                  || text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i)
                  || text.match(/:\s*([0-9]{10})\b/);
    const ddoCode  = ddoMatch ? ddoMatch[1].trim() : "";

    const hoaMatch = text.match(
      /\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/
    );
    const parts = hoaMatch
      ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4],
         hoaMatch[5], hoaMatch[6], hoaMatch[7]]
      : null;
    const hoa = parts ? parseBimsHoA(parts.join(" ")) : null;

    return {
      billType:       "BiMS",
      billNo:         billNoStr,
      treasury:       "",
      sparkCode:      ddoCode,
      department:     dept,
      ddoCode,
      remarks:        "",
      pay:            0, da: 0, hra: 0, cca: 0,
      pgAllowance:    0, ruralAllowance: 0, otherAllowance: 0,
      consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
      grossAmount:    gross,        // replaces netAmount
      hoa,
      rawHoA:         parts ? parts.join(" ") : "",
    };
  }

  // =========================================================================
  // STAGE 8 — MAIN ENTRY POINT
  // =========================================================================

  /**
   * parsePdf(file)
   * Public entry point called from dashboard.js.
   * Returns a Promise<Array> — always an array of one or more parsed objects.
   * Every object carries grossAmount as the primary financial total.
   * netAmount does not appear anywhere in the returned data.
   */
  async function parsePdf(file) {
    const sniffText = await extractPdfText(file);
    const billType  = detectBillType(sniffText);

    if (!billType) {
      throw new Error(
        "Could not determine bill type from \"" + file.name + "\". " +
        "Expected SPARK (Gross Salary / Spark Code) or BiMS (Net Amount) text."
      );
    }

    const parsed = billType === "SPARK"
      ? await parseSparkBillFull(file)
      : await parseBimsBillFull(file);

    if (!parsed) {
      throw new Error("Failed to extract required fields from \"" + file.name + "\".");
    }

    return [parsed];
  }

  // Public API
  return {
    parsePdf,
    parseAmount,
    canonicalHoA,
    parseSparkHoA,
    parseBimsHoA,
    detectBillType,
  };

})();
