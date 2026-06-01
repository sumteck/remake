/**
 * parser.js  (v3 — New SPARK bill format + full salary breakdown)
 * =========
 * Client-side PDF text extraction and bill data parsing.
 *
 * Handles two treasury bill formats:
 * • SPARK bills  — Pay-slip style, multi-page.
 *                  Detection: "Net Sal" or "Gross Salary" in text.
 * • BiMS bills   — Head-of-Account space-separated.
 *                  Detection: "Net Amount".
 *
 * NEW in v3 (SPARK):
 * ─────────────────
 * • extractPdfPages()  — keeps each page as a *separate* string so we can
 *   target Page 1 for Treasury/DDO and Page 3 for salary totals.
 * • _extractTreasury() — "Name Of Treasury :" from Page 1.
 * • _extractDdoCode()  — "DDO Code :" from Page 1.
 * • _extractSparkCode()— Last 5-digit segment of "Spark Code : XXXXX XXXXX…"
 * • _extractRemarks()  — Month+Year from "…FOR <Month> <Year>" heading.
 * • _extractDeptAndOffice() — Government dept + office name from Page 3.
 * • _extractSalaryBreakdown() — Targets the **Total** row at the bottom of
 *   Page 3's allowance table:
 *     · Pay            ← "Basic Less OA/SA" total
 *     · DA, HRA, CCA, PGA, Rural Allowance  ← direct columns
 *     · Other Allowance ← dynamic sum of all columns after Rural Allowance
 *                         and before Gross Salary
 *     · Gross Salary   ← replaces NetAmount; the Total row's rightmost figure
 *
 * Depends on: pdf.js (loaded via CDN in HTML)
 */

const TbrParser = (() => {

  // ── PDF text extraction — per-page array ─────────────────────────────────

  async function extractPdfPages(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf   = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Keep original item order but normalise whitespace within each item
      const pageStr = content.items
        .map(item => item.str.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s{2,}/g, " ");
      pages.push(pageStr);
    }
    return pages;
  }

  /** Full text of the whole document (all pages joined) */
  async function extractPdfText(file) {
    const pages = await extractPdfPages(file);
    return pages.join("\n");
  }

  // ── Bill-type detection ───────────────────────────────────────────────────

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal") || t.includes("gross salary") || t.includes("spark code")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  // ── Number helpers ────────────────────────────────────────────────────────

  function parseAmount(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/,/g, "").replace(/\s/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  function _extractAmountFromSlice(slice) {
    const pattern = /(?<![0-9\-\/])([1-9][0-9]*(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)(?![0-9\-\/,])/g;
    const allMatches  = [...slice.matchAll(pattern)];
    const validMatches = allMatches.filter(m => parseFloat(m[1].replace(/,/g, "")) > 100);
    if (validMatches.length === 0) return 0;
    return parseFloat(validMatches[validMatches.length - 1][1].replace(/,/g, "")) || 0;
  }

  // ── Head of Account helpers ───────────────────────────────────────────────

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

  // ═══════════════════════════════════════════════════════════════════════════
  // ── NEW SPARK v3 EXTRACTORS ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Treasury name from Page 1.
   * Matches: "Name Of Treasury : MANJERI" or "Name Of Treasury: MANJERI"
   */
  function _extractTreasury(page1) {
    const m = page1.match(/Name\s+Of\s+Treasury\s*[:\-]\s*([A-Z][A-Z\s\.\-&']+?)(?=\s{2,}|DDO|$)/i);
    if (m) return m[1].trim().replace(/\s+/g, " ");

    // Fallback: looser match
    const m2 = page1.match(/Treasury\s*[:\-]\s*([A-Z][A-Z\s]+?)(?=\s{2,}|\b(?:DDO|Bill|Code)\b|$)/i);
    if (m2) return m2[1].trim().replace(/\s+/g, " ");

    return "";
  }

  /**
   * DDO Code from Page 1.
   * Matches: "DDO Code : 0614002" or "DDO Code: ABC123"
   */
  function _extractDdoCode(page1) {
    const m = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m) return m[1].trim();
    const m2 = page1.match(/\bDDO\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m2) return m2[1].trim();
    return "";
  }

  /**
   * Spark Code — extract the LAST 5-digit segment from the grouped code line.
   * Bill heading example: "Spark Code : 99637 95973 95709 35547"
   * → returns "35547"
   *
   * The last segment is the actual Spark employee/bill identifier used for
   * reconciliation matching.
   */
  function _extractSparkCode(text) {
    // "Spark Code : DDDDD DDDDD DDDDD DDDDD"  (groups of 5, variable count)
    const m = text.match(/Spark\s*Code\s*[:\-]\s*((?:\d{4,6}\s*){1,8})/i);
    if (m) {
      const segments = m[1].trim().split(/\s+/).filter(s => /^\d{4,6}$/.test(s));
      if (segments.length > 0) return segments[segments.length - 1];
    }
    return "";
  }

  /**
   * Bill No — existing logic preserved, extended for new format.
   * New SPARK bills have a voucher/token number near "Digitally signed".
   */
  function _extractSparkBillNo(text) {
    // Token number before "Digitally signed"
    let m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();

    // Bill No label
    m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();

    // Fallback: 8-digit standalone number (old format)
    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();

    return "";
  }

  /**
   * Remarks — extract "Month Year" from the bill heading.
   * Matches: "…FOR April 2026" or "…FOR MARCH 2025"
   * from headings like: "PAY AND ALLOWANCE IN RESPECT OF SDO Bill FOR April 2026"
   */
  function _extractRemarks(text) {
    // "FOR <MonthName> <4-digit-year>"
    const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
    const re = new RegExp(`\\bFOR\\s+(${monthNames})\\s+(\\d{4})\\b`, "i");
    const m = text.match(re);
    if (m) return `${_toTitleCase(m[1])} ${m[2]}`;

    // Fallback: plain "Month YYYY" anywhere prominent
    const re2 = new RegExp(`\\b(${monthNames})\\s+(20\\d{2})\\b`, "i");
    const m2 = text.match(re2);
    if (m2) return `${_toTitleCase(m2[1])} ${m2[2]}`;

    return "";
  }

  function _toTitleCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Department and Office from Page 3.
   *
   * Page 3 header structure (typical):
   *   "GOVERNMENT OF KERALA"
   *   "<Department Name>"           ← e.g. "Indian Systems of Medicine"
   *   "<Office Name>"               ← e.g. "GOVT AYURVEDA DISPENSARY ANGADIPPURAM"
   *
   * We locate "GOVERNMENT OF KERALA" then take the next two non-trivial tokens.
   */
  function _extractDeptAndOffice(page3) {
    // Strategy 1: "GOVERNMENT OF KERALA" anchor
    const govIdx = page3.search(/GOVERNMENT\s+OF\s+KERALA/i);
    if (govIdx !== -1) {
      const afterGov = page3.slice(govIdx).replace(/GOVERNMENT\s+OF\s+KERALA/i, "").trim();
      // Split into meaningful chunks (min 4 chars, not just numbers/punctuation)
      const chunks = afterGov
        .split(/\s{2,}|(?<=[a-z])(?=[A-Z])|(?<=\d)(?=[A-Z])/)
        .map(c => c.trim())
        .filter(c => c.length >= 4 && /[A-Za-z]/.test(c))
        // Stop before typical table headers
        .filter(c => !/^(Sl|No|Name|Basic|DA|HRA|CCA|PGA|Rural|Gross|Total|Pay|Bill|For|Head|Voucher)\b/i.test(c));

      const dept   = chunks[0] || "";
      const office = chunks[1] || "";
      return { department: dept, office };
    }

    // Strategy 2: Labelled patterns
    const deptMatch = page3.match(/Department\s*[:\-]\s*([^\n\r]+)/i);
    const offMatch  = page3.match(/(?:Office\s+Name|Name\s+of\s+Office)\s*[:\-]\s*([^\n\r]+)/i);
    return {
      department: deptMatch ? deptMatch[1].trim().replace(/\s+/g, " ") : "",
      office:     offMatch  ? offMatch[1].trim().replace(/\s+/g, " ") : "",
    };
  }

  /**
   * Salary breakdown from the **Total** row of the allowance table on Page 3.
   *
   * Column order in the SPARK table (left → right):
   *   Sl | Name | Basic Less OA/SA | DA | HRA | CCA | PGA | Rural Allowance
   *   | [other allowances…] | Gross Salary
   *
   * The Total row is the last row in the table, identified by the keyword
   * "Total" followed by a sequence of numeric values.
   *
   * Returns: { pay, da, hra, cca, pgAllowance, ruralAllowance, otherAllowance, grossAmount }
   */
  function _extractSalaryBreakdown(page3) {
    const result = {
      pay: 0, da: 0, hra: 0, cca: 0,
      pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0,
    };

    // ── Step 1: Locate the Total row ────────────────────────────────────────
    // Look for "Total" keyword followed by numbers (the summary row)
    // Pattern:  "Total  45,000  12,150  4,500  500  1,200  800  0  64,150"
    const totalRowRe = /\bTotal\b[\s:]*([\d,\s\.]+)/i;
    const totalMatch = page3.match(totalRowRe);

    if (totalMatch) {
      // Extract all numeric values from the Total row segment
      const numStr = totalMatch[1];
      const nums   = [...numStr.matchAll(/(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)]
        .map(m => parseAmount(m[1]))
        .filter(n => n >= 0); // keep zeros too

      // Column mapping (0-indexed from the numbers extracted):
      // [Basic/Pay, DA, HRA, CCA, PGA, Rural, ...others..., Gross]
      if (nums.length >= 2) {
        result.pay           = nums[0] || 0;
        result.da            = nums[1] || 0;
        result.hra           = nums[2] || 0;
        result.cca           = nums[3] || 0;
        result.pgAllowance   = nums[4] || 0;
        result.ruralAllowance = nums[5] || 0;

        // Gross is the LAST number; everything between index 6 and last-1 is "other"
        if (nums.length >= 8) {
          result.grossAmount   = nums[nums.length - 1];
          // Sum everything between Rural Allowance (index 5) and Gross (last)
          const otherNums = nums.slice(6, nums.length - 1);
          result.otherAllowance = otherNums.reduce((s, n) => s + n, 0);
        } else if (nums.length === 7) {
          result.grossAmount    = nums[6];
          result.otherAllowance = 0;
        } else {
          // Minimal case: just use last value as gross
          result.grossAmount = nums[nums.length - 1];
        }
      }
      return result;
    }

    // ── Step 2: Fallback — scan for labelled totals ──────────────────────────
    const tryLabel = (re) => { const m = page3.match(re); return m ? parseAmount(m[1]) : 0; };

    result.pay            = tryLabel(/Basic\s*(?:Less\s*OA\/SA)?\s*[:\-]?\s*Total[^\d]*([\d,]+)/i) ||
                            tryLabel(/Basic[^:\n]*Total[^\d]*([\d,]+)/i);
    result.da             = tryLabel(/DA\s*(?:Total)?[^\d]*([\d,]+)/i);
    result.hra            = tryLabel(/HRA\s*(?:Total)?[^\d]*([\d,]+)/i);
    result.cca            = tryLabel(/CCA\s*(?:Total)?[^\d]*([\d,]+)/i);
    result.pgAllowance    = tryLabel(/PGA?\s*(?:Total)?[^\d]*([\d,]+)/i);
    result.ruralAllowance = tryLabel(/Rural\s*(?:Allowance\s*)?(?:Total)?[^\d]*([\d,]+)/i);
    result.grossAmount    = tryLabel(/Gross\s*Salary\s*[:\-]?\s*([\d,]+)/i) ||
                            tryLabel(/Total\s*A\s*Gross\s*[:\-]?\s*([\d,]+)/i);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN SPARK PARSER ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  async function parseSparkBillFull(file) {
    const pages   = await extractPdfPages(file);
    const fullText = pages.join("\n");

    const page1 = pages[0] || "";
    const page3 = pages[2] || pages[1] || fullText; // Page 3 (index 2); fallback to p2/all

    // ── Extract fields ──────────────────────────────────────────────────────
    const treasury   = _extractTreasury(page1);
    const ddoCode    = _extractDdoCode(page1);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    const { department, office } = _extractDeptAndOffice(page3);
    const salary     = _extractSalaryBreakdown(page3);

    // HoA from any page (hyphenated format)
    const hoaMatch = fullText.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    const hoa     = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;
    const rawHoA  = hoaMatch ? hoaMatch[1] : "";

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      sparkCode,
      department:      office || department, // Office name takes priority for display
      departmentGroup: department,           // The broader department group
      ddoCode,
      remarks,
      pay:             salary.pay,
      da:              salary.da,
      hra:             salary.hra,
      cca:             salary.cca,
      pgAllowance:     salary.pgAllowance,
      ruralAllowance:  salary.ruralAllowance,
      otherAllowance:  salary.otherAllowance,
      consolidatePay:  0,
      dailyWages:      0,
      ms:              0,
      tourTa:          0,
      mr:              0,
      grossAmount:     salary.grossAmount,
      hoa,
      rawHoA,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── BIMS PARSER (unchanged logic, new field shape) ─────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function _extractBimsBillNo(text) {
    let m = text.match(/(\d{15,25})\s*Period\s*of\s*claim/i);
    if (m) return m[1].trim();
    m = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) return m[1].trim();
    m = text.match(/(?:Bill\s*Reference\s*Number|BRN|Voucher\s*No|Bill\s*No)[\s.:]*(\d[\d\/\-]*)/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractBimsNetAmount(text) {
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
    const gross     = _extractBimsNetAmount(text);
    const dept      = _extractDeptBims(text);

    const ddoMatch  = text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
                      text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
                      text.match(/:\s*([0-9]{10})\b/);
    const ddoCode   = ddoMatch ? ddoMatch[1].trim() : "";

    const hoaMatch  = text.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    const parts     = hoaMatch
      ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]]
      : null;
    const hoa       = parts ? parseBimsHoA(parts.join(" ")) : null;

    return {
      billType:      "BiMS",
      billNo:        billNoStr,
      treasury:      "",
      sparkCode:     ddoCode,
      department:    dept,
      ddoCode,
      remarks:       "",
      pay: 0, da: 0, hra: 0, cca: 0,
      pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0,
      consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
      grossAmount:   gross,
      hoa,
      rawHoA:        parts ? parts.join(" ") : "",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN ENTRY POINT ──────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  async function parsePdf(file) {
    // Quick sniff to detect bill type
    const sniffText = await extractPdfText(file);
    const billType  = detectBillType(sniffText);

    if (!billType) {
      throw new Error(
        `Could not determine bill type from "${file.name}". ` +
        `Expected SPARK (Net Sal / Gross Salary) or BiMS (Net Amount) text.`
      );
    }

    let parsed;
    if (billType === "SPARK") {
      parsed = await parseSparkBillFull(file);
    } else {
      parsed = await parseBimsBillFull(file);
    }

    if (!parsed) {
      throw new Error(`Failed to extract required fields from "${file.name}".`);
    }

    // Return as single-row array (multi-HoA not applicable to new salary format)
    return [parsed];
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    parsePdf,
    parseAmount,
    canonicalHoA,
    parseSparkHoA,
    parseBimsHoA,
    detectBillType,
  };
})();
