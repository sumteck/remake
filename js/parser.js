/**
 * parser.js  (v4 — Spark Bill Structure Fix)
 * =========
 * Client-side PDF text extraction and bill data parsing.
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
      const pageStr = content.items
        .map(item => item.str.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s{2,}/g, " ");
      pages.push(pageStr);
    }
    return pages;
  }

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
  // ── NEW SPARK EXTRACTORS ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function _extractTreasury(page1) {
    const m = page1.match(/Name\s+Of\s+Treasury\s*[:\-]\s*(.+?)(?=\s{2,}|\bComputer\b|\bDDO\b|$)/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractDdoCode(page1) {
    const m = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m) return m[1].trim();
    const m2 = page1.match(/\bDDO\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m2) return m2[1].trim();
    return "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]\s*((?:\d{4,6}\s*){1,8})/i);
    if (m) {
      const segments = m[1].trim().split(/\s+/).filter(s => /^\d{4,6}$/.test(s));
      if (segments.length > 0) return segments[segments.length - 1];
    }
    return "";
  }

  function _extractSparkBillNo(text) {
    let m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();
    m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();
    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();
    return "";
  }

  function _extractRemarks(text) {
    const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
    const re = new RegExp(`\\bFOR\\s+(${monthNames})\\s+(\\d{4})\\b`, "i");
    const m = text.match(re);
    if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()} ${m[2]}`;
    return "";
  }

  function _extractOffice(page1) {
    const m = page1.match(/Name\s+of\s+Office\s*[:\-]\s*(.+?)(?=\s{2,}|\bBill\s+No\b|$)/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractDeptAndOffice(page1, page3) {
    const office = _extractOffice(page1);
    let department = "";
    if (office) {
      // Escape special characters in office name for regex
      const escapedOffice = office.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const deptRegex = new RegExp(`GOVERNMENT\\s+OF\\s+KERALA\\s+(.+?)\\s+${escapedOffice}`, "i");
      const deptMatch = page3.match(deptRegex);
      if (deptMatch) department = deptMatch[1].trim();
    }
    return { department, office };
  }

  function _extractSalaryBreakdown(page3, fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    // 1. Extract Gross Salary from "Total A Gross"
    let mGross = fullText.match(/Total\s*A\s*Gross\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
    if (!mGross) mGross = page3.match(/Gross\s*Salary\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
    result.grossAmount = mGross ? parseAmount(mGross[1]) : 0;

    // 2. Extract elements from Total row
    const totalRowRe = /\bTotal\b[\s:]*([\d,\s\.]+)/i;
    const totalMatch = page3.match(totalRowRe);

    if (totalMatch) {
      const nums = [...totalMatch[1].matchAll(/(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)]
                    .map(m => parseAmount(m[1]));

      if (nums.length >= 7) {
        // nums[0] is B Pay/L.Sal (We skip this)
        result.pay            = nums[1] || 0; // Basic Less OA/SA
        result.da             = nums[2] || 0;
        result.hra            = nums[3] || 0;
        result.cca            = nums[4] || 0;
        result.pgAllowance    = nums[5] || 0;
        result.ruralAllowance = nums[6] || 0;

        // 3. Dynamically Calculate Other Allowances
        const totalSpecific = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
        const diff = result.grossAmount - totalSpecific;
        result.otherAllowance = diff > 0 ? diff : 0;
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN SPARK PARSER ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  async function parseSparkBillFull(file) {
    const pages   = await extractPdfPages(file);
    const fullText = pages.join("\n");

    const page1 = pages[0] || "";
    const page3 = pages[2] || pages[1] || fullText;

    const treasury   = _extractTreasury(page1);
    const ddoCode    = _extractDdoCode(page1);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    const { department, office } = _extractDeptAndOffice(page1, page3);
    const salary     = _extractSalaryBreakdown(page3, fullText);

    const hoaMatch = fullText.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    const hoa     = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;
    const rawHoA  = hoaMatch ? hoaMatch[1] : "";

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      sparkCode,
      department:      office || department,
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
  // ── BIMS PARSER ────────────────────────────────────────────────────────────
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

    return [parsed];
  }

  return {
    parsePdf,
    parseAmount,
    canonicalHoA,
    parseSparkHoA,
    parseBimsHoA,
    detectBillType,
  };
})();