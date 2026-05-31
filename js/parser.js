/**
 * parser.js
 * =========
 * Client-side PDF text extraction and bill data parsing.
 * Handles two distinct treasury bill formats:
 *   • SPARK bills  — Head of Account hyphenated (e.g. 2210-02-101-97-00-01-01)
 *   • BiMS  bills  — Head of Account space-separated (e.g. 2210 02 198 50 00 00 00)
 *
 * =============================================================================
 * _extractSparkAllowances — ROOT CAUSE ANALYSIS & FIX (this session)
 * =============================================================================
 *
 * BUG 1 — MANDATORY DECIMAL POINT IN ALL REGEX PATHS
 *   Every code path in the old function used the pattern \.\d{2} to match
 *   currency values (e.g. "73600.00").  Kerala Treasury SPARK bills emit ALL
 *   salary and allowance figures as WHOLE INTEGERS without decimal points
 *   (e.g. "73600", "25760", "2944").  Because no value in the PDF ever matches
 *   the mandatory decimal, every regex returned null and every field defaulted
 *   to 0.  The Gross Salary also returns 0, making otherAllowances NaN → 0.
 *
 * BUG 2 — UNBOUNDED [\s\S]{1,60}? SPANS GRABBING DATE SUBSTRINGS
 *   The fallback label-based patterns used forms like:
 *     /\bDA\b[\s\S]{1,40}?([0-9]{2,}...)/i
 *   The lazy [\s\S]{1,40}? can freely cross whitespace and span multiple tokens.
 *   When "DA" appears near the legalisation notice "[Vide GO(P) No.391/2015/Fin
 *   dated, 07.09.2015]", the span matches "DA" in "dated" and then finds "07.09"
 *   within 40 characters.  "07" satisfies [0-9]{2,} and ".09" provides \.\d{2},
 *   so the regex incorrectly extracts 7.09 as the DA value.
 *   Observed effect: DA showed as 7.09 instead of 25760.
 *
 * BUG 3 — OBJECT-HEAD CODES (301, 302, 304…) CONTAMINATING RESULTS
 *   The page-1 text interleaves the Deductions Code table (right column) with
 *   the Dues Abstract table (left column).  Codes like 301, 302, 304 appear
 *   immediately adjacent to "House Rent" and "Pay" labels.  The old regex
 *   /\bPay\b[\s\S]{1,40}?.../ matched "Pay Advance" code 001 or "Pay" inside
 *   "Personal Pay" and then grabbed a nearby 3-digit code as the value.
 *
 * SOLUTION — Three-tier extraction strategy
 * ------------------------------------------
 * TIER 1 (primary): Page-2 column-indexed "Net Sal Total …" row
 *   Page 2 of every SPARK bill is the TR-51 summary table.  pdf.js produces a
 *   line of the form:  "Net Sal Total 73600 73600 25760 2944 0 1100 3000 0
 *   106404 8000 12000 5000 1000 7014 1000 9936 687 44637 61767"
 *   Column positions in SPARK TR-51 format are standardised:
 *     [0] B Pay/L.Sal   [1] Basic Less OA/SA   [2] DA   [3] HRA   [4] CCA
 *     [5] PGA           [6] RL_AL               [7] Sp. L.Sal (may be absent)
 *     [8 or 7] Gross Salary       … deductions …   [-1] Net Sal
 *   The Gross column index is identified dynamically as the first column
 *   value larger than the B Pay value (Gross is always ≥ Pay + allowances).
 *   All values are whole integers — no decimal requirement.
 *
 * TIER 2 (fallback): Page-1 Abstract section — exact-label adjacent integers
 *   If Tier 1 fails (e.g. the PDF only has one page), use the page-1 abstract
 *   table which contains labelled rows: "Pay/LS/SP/Wages/TP 73600".
 *   Each pattern matches the SPECIFIC abstract-table label text and then
 *   immediately captures the integer that follows.  No [\s\S] spans are used,
 *   so date substrings and code-table entries cannot contaminate the match.
 *   Gross Salary is read from "Total A Gross : 106404" which is also on page 1.
 *
 * TIER 3 (always): Derived otherAllowances
 *   otherAllowances = grossSalary − (basicLess + da + hra + cca)
 *   Clamped to 0 if the result is negative (floating-point rounding safety).
 */

const TbrParser = (() => {

  // ── PDF text extraction ───────────────────────────────────────────────────

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const pageTexts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageStr = content.items.map(item => item.str).join(" ").replace(/\s{2,}/g, " ");
      pageTexts.push(pageStr);
    }
    return pageTexts.join("\n");
  }

  // ── Bill type detection ───────────────────────────────────────────────────

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal"))    return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  // ── Head of Account helpers ───────────────────────────────────────────────

  function _mapHoaParts(parts) {
    const p = [...parts];
    while (p.length < 7) p.push("00");
    return {
      MJH:   p[0] || "00", SMJH: p[1] || "00", MIH:   p[2] || "00",
      SBHLH: p[3] || "00", SHLH: p[4] || "00", VOH:   p[5] || "00",
      SOH:   p[6] || "00",
    };
  }

  function parseSparkHoA(hoaStr) { return _mapHoaParts(hoaStr.trim().split("-")); }
  function parseBimsHoA(hoaStr)  { return _mapHoaParts(hoaStr.trim().split(/\s+/)); }
  function canonicalHoA(hoaObj)  {
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH, hoaObj.SBHLH,
            hoaObj.SHLH, hoaObj.VOH,  hoaObj.SOH].join("-");
  }

  // ── Number helpers ────────────────────────────────────────────────────────

  function parseAmount(str) {
    if (!str) return 0;
    const val = parseFloat(String(str).replace(/,/g, "").replace(/\s/g, ""));
    return isNaN(val) ? 0 : val;
  }

  /**
   * Extract the most likely currency amount from a forward text slice
   * starting at a Head-of-Account position (used for multi-HoA bills).
   *
   * "/" excluded from lookahead/lookbehind so date components like "2026"
   * in "01/05/2026" are not matched.  Minimum value ≥ 1000 filters out
   * 2–3 digit HoA segment numbers.
   */
  function _extractAmountFromSlice(slice) {
    const pattern = /(?<![0-9\-\/])([1-9][0-9]*(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)(?![0-9\-\/,])/g;
    const allMatches = [...slice.matchAll(pattern)];
    const valid = allMatches.filter(m => (parseFloat(m[1].replace(/,/g, "")) || 0) > 100);
    if (!valid.length) return 0;
    return parseFloat(valid[valid.length - 1][1].replace(/,/g, "")) || 0;
  }

  // ── SPARK field extractors ────────────────────────────────────────────────

  function _extractPeriodRemarks(text) {
    let m = text.match(/PAY\s+AND\s+ALLOWANCE\s+IN\s+RESPECT\s+OF\s+(.+)/i);
    if (m) return m[1].replace(/(20\d{2}).*/, "$1").trim();
    m = text.match(/Received\s*for\s*the\s*Period\s*[:\s]*([0-9\/\-\s]+)/i);
    if (m && m[1].length > 5) return "Salary for " + m[1].trim();
    m = text.match(/Period\s*of\s*claim\s*[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s*-\s*[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
    if (m) return "Salary for " + m[1].trim();
    return "";
  }

  function _extractSparkTreasury(text) {
    const m = text.match(/Name\s*Of\s*Treasury\s*:\s*([^(\n\r]+)/i);
    return m ? m[1].trim() : "";
  }

  function _extractSparkCodeString(text) {
    const m = text.match(/Spark\s*Code\s*:\s*(\d{5}\s+\d{5}\s+\d{5}\s+\d{5})/i);
    return m ? m[1].trim() : "";
  }

  function _extractSparkOfficeAndDept(text) {
    let office = "", dept = "";
    const govMatch = text.match(/GOVERNMENT\s+OF\s+KERALA\s+([^\n\r]+)\s+([^\n\r]+)/i);
    if (govMatch) {
      dept   = govMatch[1].trim();
      office = govMatch[2].replace(/PAY\s+AND\s+ALLOWANCE.*/i, "").trim();
    } else {
      const mOff  = text.match(/Name\s+of\s+Office\s*:\s*([^\n\r]+)/i);
      if (mOff) office = mOff[1].replace(/Bill\s*No.*$/i, "").trim();
      const mDept = text.match(/Name\s+of\s+Department\s*:?\s*(.+?)(?=\s+DDO\s+Code|\s+Office|$)/i);
      if (mDept) dept = mDept[1].trim();
    }
    return { office, dept };
  }

  /**
   * _extractSparkAllowances
   * =======================
   * Extract Pay (basicLess), DA, HRA, CCA, Gross Salary, and derived
   * Other Allowances from a SPARK bill PDF text string.
   *
   * Uses a three-tier strategy; see the module-level change log for the
   * full root-cause analysis explaining why the previous approach failed.
   *
   * @param   {string} text  Full PDF text (all pages joined with "\n").
   * @returns {{ basicLess, da, hra, cca, otherAllowances, grossSalary }}
   */
  function _extractSparkAllowances(text) {
    let basicLess = 0, da = 0, hra = 0, cca = 0, grossSalary = 0;

    // ── TIER 1: Page-2 "Net Sal Total <integers…>" column-indexed row ──────
    //
    // pdf.js joins the page-2 header labels and the Total row into a single
    // text stream.  The Total row always appears immediately after "Net Sal"
    // (the last column header) and contains ONLY integers separated by spaces.
    //
    // SPARK TR-51 column layout (fixed by format spec):
    //   Index:  0          1            2    3    4    5      6       7*       8*
    //   Field:  B Pay/Sal  Basic OA/SA  DA   HRA  CCA  PGA   RL_AL  SpLSal  Gross
    //   (* Sp.L.Sal column may be absent; presence detected by column count)
    //
    // If column count ≥ 9 (19-col form): Sp.L.Sal IS present → Gross at index 8.
    // If column count == 8 (18-col form): Sp.L.Sal absent    → Gross at index 7.
    // In both cases, Gross is also identified as the first column value that
    // exceeds basicLess alone (Gross is always ≥ Pay, so this is unambiguous).

    const tier1 = text.match(
      /\bNet\s*Sal\b[\s\S]{0,50}?\bTotal\b\s+((?:\d+\s+){8,}\d+)/i
    );

    if (tier1) {
      const cols = tier1[1].trim().split(/\s+/).map(Number);

      if (cols.length >= 8) {
        basicLess = cols[0];  // B Pay/L.Sal
        da        = cols[2];  // DA         — fixed at index 2
        hra       = cols[3];  // HRA        — fixed at index 3
        cca       = cols[4];  // CCA        — fixed at index 4

        // Gross Salary: first column ≥ index 7 whose value > basicLess.
        // (Gross is the sum of all allowances so it is always the largest
        //  number in the allowances section and always > any single component.)
        const grossIdx = cols.findIndex((v, i) => i >= 7 && v > basicLess);
        grossSalary = grossIdx !== -1 ? cols[grossIdx] : (cols[8] || cols[7] || 0);
      }
    }

    // ── TIER 2: Page-1 Abstract section — label-adjacent integers ───────────
    //
    // Fallback for PDFs where page 2 is absent or Tier 1 fails to match.
    //
    // The page-1 Abstract of the Bill table contains rows of the form:
    //   "01 Pay/LS/SP/Wages/TP 73600"
    //   "22 DA/ADA 25760"
    //   "23 House Rent Allowance 2944"
    //   "24 CCA 0"           (only if non-zero CCA)
    //   "Total A Gross : 106404"
    //
    // Each pattern anchors on the EXACT label text and captures the integer
    // that IMMEDIATELY follows (one \s+ separator only).  This prevents the
    // old [\s\S]{1,60}? approach from spanning into date strings or the
    // Deductions Code table that appears later in the same page-1 text.
    //
    // These values are WHOLE INTEGERS — no decimal point is required.

    if (!grossSalary) {
      // "Total A Gross : 106404"  — always on page 1, no decimal
      const gm = text.match(/Total\s+A\s+Gross\s*:\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
      if (gm) grossSalary = parseAmount(gm[1]);
    }

    if (!basicLess) {
      // "Pay/LS/SP/Wages/TP 73600"  — the exact abstract-table row label
      const m = text.match(/\bPay\/LS\/SP\/Wages\/TP\s+([0-9,]+)/i);
      if (m) basicLess = parseAmount(m[1]);
    }

    if (!da) {
      // "DA/ADA 25760"
      const m = text.match(/\bDA\/ADA\s+([0-9,]+)/i);
      if (m) da = parseAmount(m[1]);
    }

    if (!hra) {
      // "House Rent Allowance 2944"
      const m = text.match(/\bHouse\s+Rent\s+Allowance\s+([0-9,]+)/i);
      if (m) hra = parseAmount(m[1]);
    }

    if (!cca) {
      // "24 CCA 0"  — only present in bill when non-zero
      // Anchored on code "24" + "CCA" to avoid matching the code-table "CCA"
      const m = text.match(/\b24\s+CCA\s+([0-9,]+)/i);
      if (m) cca = parseAmount(m[1]);
      // cca stays 0 if the row is absent (correctly indicates no CCA claimed)
    }

    // ── TIER 3: Derived Other Allowances ─────────────────────────────────────
    //
    // All allowances not individually broken out (PGA, RL_AL, Special Pay,
    // Interim Relief, etc.) are combined into a single "Other Allowances" value.
    // Formula: Other = Gross − (Pay + DA + HRA + CCA)
    // Clamp to 0 to absorb floating-point rounding errors or missing columns.

    let otherAllowances = grossSalary - (basicLess + da + hra + cca);
    otherAllowances = Math.max(0, Math.round(otherAllowances * 100) / 100);

    return { basicLess, da, hra, cca, otherAllowances, grossSalary };
  }

  function _extractSparkBillNo(text) {
    // Strategy 1: number immediately before "Digitally signed" (most reliable)
    let m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();
    // Strategy 2: after 4 groups of 5-digit employee Spark Codes
    m = text.match(/Spark\s*Code\s*:\s*(\d{5}\s+\d{5}\s+\d{5}\s+\d{5})/i);
    if (m) return m[1].trim();
    // Strategy 3: label-adjacent (when pdf.js keeps label+value together)
    m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();
    // Strategy 4: 8-digit standalone number (SPARK bill numbers are always 8 digits)
    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();
    return "";
  }

  // ── SPARK bill parser ─────────────────────────────────────────────────────

  function parseSparkBill(text) {
    const allowances = _extractSparkAllowances(text);
    const { office, dept } = _extractSparkOfficeAndDept(text);

    const result = {
      billType:       "SPARK",
      billNo:         _extractSparkBillNo(text),
      sparkCode:      _extractSparkCodeString(text),
      treasury:       _extractSparkTreasury(text),
      ddoCode:        "",
      department:     dept,
      officeName:     office,
      basicLess:      allowances.basicLess,
      da:             allowances.da,
      hra:            allowances.hra,
      cca:            allowances.cca,
      otherAllowances:allowances.otherAllowances,
      netAmount:      allowances.grossSalary,
      remarks:        _extractPeriodRemarks(text),
      encashmentDate: "",
      hoa:            null,
    };

    const ddoMatch =
      text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
      text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i);
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();

    const hoaMatch = text.match(
      /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/
    );
    if (hoaMatch) {
      result.hoa    = parseSparkHoA(hoaMatch[1]);
      result.rawHoA = hoaMatch[1];
    }

    return result.hoa ? result : null;
  }

  // ── BiMS field extractors ─────────────────────────────────────────────────

  function _extractBimsBillNo(text) {
    let m = text.match(/(\d{15,25})\s*Period\s*of\s*claim/i);
    if (m) return m[1].trim();
    m = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) return m[1].trim();
    return "";
  }

  function _extractBimsNetAmount(text) {
    let m = text.match(/Total\s*\(A\)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);
    m = text.match(/Gross\s*Bill\s*Amount\s*Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);
    return 0;
  }

  // ── BiMS bill parser ──────────────────────────────────────────────────────

  function parseBimsBill(text) {
    const result = {
      billType:       "BiMS",
      billNo:         _extractBimsBillNo(text),
      sparkCode:      "N/A",
      treasury:       "",
      ddoCode:        "",
      department:     "",
      officeName:     "",
      basicLess:      0, da: 0, hra: 0, cca: 0, otherAllowances: 0,
      netAmount:      _extractBimsNetAmount(text),
      remarks:        _extractPeriodRemarks(text),
      encashmentDate: "",
      hoa:            null,
    };

    const ddoMatch =
      text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
      text.match(/:\s*([0-9]{10})\b/);
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();

    const mTreasury = text.match(/Name\s+of\s+Treasury\s*:\s*([^(\n\r]+)/i);
    if (mTreasury) result.treasury = mTreasury[1].trim();

    const mDept =
      text.match(/Name\s+of\s+Office\s*:\s*([^\n\r]+)/i) ||
      text.match(/\bOffice[:\s]+([^\n\r]+)/i);
    if (mDept) result.officeName = mDept[1].replace(/Bill\s*No.*$/i, "").trim();

    const hoaMatch = text.match(
      /\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/
    );
    if (hoaMatch) {
      const parts = [hoaMatch[1], hoaMatch[2], hoaMatch[3],
                     hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]];
      result.hoa    = parseBimsHoA(parts.join(" "));
      result.rawHoA = parts.join(" ");
    }

    return result.hoa ? result : null;
  }

  // ── Multi-HoA scanners ────────────────────────────────────────────────────

  function _extractMultipleHoAsFromSpark(text) {
    const results = [], seen = new Set();
    const hoaPattern =
      /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/g;
    let match;
    while ((match = hoaPattern.exec(text)) !== null) {
      const hoaStr = match[1];
      const hoa    = parseSparkHoA(hoaStr);
      const key    = canonicalHoA(hoa);
      if (seen.has(key)) continue;   // skip duplicate occurrences across pages
      seen.add(key);
      const slice     = text.slice(match.index, match.index + 250);
      const netAmount = _extractAmountFromSlice(slice);
      results.push({ hoa, rawHoA: hoaStr, netAmount });
    }
    return results;
  }

  function _extractMultipleHoAsFromBims(text) {
    const results = [], seen = new Set();
    const hoaPattern =
      /\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/g;
    let match;
    while ((match = hoaPattern.exec(text)) !== null) {
      const parts  = [match[1], match[2], match[3], match[4], match[5], match[6], match[7]];
      const hoaStr = parts.join(" ");
      const hoa    = parseBimsHoA(hoaStr);
      const key    = canonicalHoA(hoa);
      if (seen.has(key)) continue;
      seen.add(key);
      const slice     = text.slice(match.index, match.index + 250);
      const netAmount = _extractAmountFromSlice(slice);
      results.push({ hoa, rawHoA: hoaStr, netAmount });
    }
    return results;
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  async function parsePdf(file) {
    const text     = await extractPdfText(file);
    const billType = detectBillType(text);
    if (!billType) {
      throw new Error(
        `Could not determine bill type from "${file.name}". ` +
        `Expected "Net Sal" (SPARK) or "Net Amount" (BiMS) in the PDF text.`
      );
    }

    let parsed, multiHoas;
    if (billType === "SPARK") {
      parsed    = parseSparkBill(text);
      multiHoas = _extractMultipleHoAsFromSpark(text);
    } else {
      parsed    = parseBimsBill(text);
      multiHoas = _extractMultipleHoAsFromBims(text);
    }

    if (!parsed) {
      throw new Error(`Failed to extract required fields from "${file.name}".`);
    }

    const baseRow = {
      billType:       parsed.billType,
      billNo:         parsed.billNo,
      sparkCode:      parsed.sparkCode,
      treasury:       parsed.treasury,
      ddoCode:        parsed.ddoCode,
      department:     parsed.department,
      officeName:     parsed.officeName,
      basicLess:      parsed.basicLess,
      da:             parsed.da,
      hra:            parsed.hra,
      cca:            parsed.cca,
      otherAllowances:parsed.otherAllowances,
      encashmentDate: parsed.encashmentDate,
      remarks:        parsed.remarks,
    };

    if (multiHoas.length > 1) {
      return multiHoas.map(h => ({
        ...baseRow,
        netAmount:    h.netAmount,
        rawHoA:       h.rawHoA,
        canonicalHoA: canonicalHoA(h.hoa),
        ...h.hoa,
      }));
    }

    const hoa = parsed.hoa;
    return [{
      ...baseRow,
      netAmount:    parsed.netAmount,
      rawHoA:       parsed.rawHoA,
      canonicalHoA: canonicalHoA(hoa),
      ...hoa,
    }];
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return { parsePdf, parseAmount, canonicalHoA, parseSparkHoA, parseBimsHoA, detectBillType };
})();
