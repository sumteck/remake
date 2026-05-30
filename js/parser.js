/**
 * parser.js
 * =========
 * Client-side PDF text extraction and bill data parsing.
 * Handles two distinct treasury bill formats:
 *   • SPARK bills  — Head of Account hyphenated (e.g. 2210-02-101-97-00-02-01)
 *                   — Net total labelled "Net Sal" / "Total = A - B"
 *   • BiMS bills   — Head of Account space-separated (e.g. 2210 02 198 50 00 00 00)
 *                   — Net total labelled "Net Amount"
 *
 * Depends on: pdf.js (loaded via CDN in HTML)
 */

const TbrParser = (() => {

  // ── PDF text extraction via pdf.js ────────────────────────────────────────

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const pageTexts = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageStr = content.items
        .map(item => item.str)
        .join(" ")
        .replace(/\s{2,}/g, " ");
      pageTexts.push(pageStr);
    }

    return pageTexts.join("\n");
  }

  // ── Bill type detection ───────────────────────────────────────────────────

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  // ── Head of Account normalisers ───────────────────────────────────────────

  function _mapHoaParts(parts) {
    const p = [...parts];
    while (p.length < 7) p.push("00");
    return {
      MJH:   p[0] || "00",
      SMJH:  p[1] || "00",
      MIH:   p[2] || "00",
      SBHLH: p[3] || "00",
      SHLH:  p[4] || "00",
      VOH:   p[5] || "00",
      SOH:   p[6] || "00",
    };
  }

  function parseSparkHoA(hoaStr) {
    return _mapHoaParts(hoaStr.trim().split("-"));
  }

  function parseBimsHoA(hoaStr) {
    return _mapHoaParts(hoaStr.trim().split(/\s+/));
  }

  function canonicalHoA(hoaObj) {
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH, hoaObj.SBHLH,
            hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-");
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
    const allMatches = [...slice.matchAll(pattern)];
    const validMatches = allMatches.filter(m => {
      const raw = parseFloat(m[1].replace(/,/g, "")) || 0;
      return raw >= 1000;
    });
    if (validMatches.length === 0) return 0;
    const last = validMatches[validMatches.length - 1][1];
    return parseFloat(last.replace(/,/g, "")) || 0;
  }

  // ── SPARK Extractors ──────────────────────────────────────────────────────

  function _extractSparkBillNo(text) {
    let m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();

    m = text.match(/Spark\s*Code\s*:\s*(?:\d{5}\s+){3}\d{5}\s+(\d+)/i);
    if (m) return m[1].trim();

    m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();

    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();

    return "";
  }

  function _extractSparkNetAmount(text) {
    let m = text.match(/Total\s*=\s*A\s*[-–]\s*B\s*:\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);

    m = text.match(/Net\s*Sal\s+([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);

    m = text.match(/Received\s+`\s+([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);

    return 0;
  }

  function parseSparkBill(text) {
    const result = {
      billType:   "SPARK",
      billNo:     "",
      ddoCode:    "",
      department: "",
      netAmount:  0,
      hoa:        null,
    };

    result.billNo = _extractSparkBillNo(text);

    const ddoMatch =
      text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
      text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i);
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();

    result.department = _extractDeptSpark(text);

    const hoaMatch = text.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    if (hoaMatch) {
      result.hoa    = parseSparkHoA(hoaMatch[1]);
      result.rawHoA = hoaMatch[1];
    }

    result.netAmount = _extractSparkNetAmount(text);

    return result.hoa ? result : null;
  }

  function _extractDeptSpark(text) {
    const labelPatterns = [
      /\bDepartment[:\s]+([^\n\r]+)/i,
      /\bName\s+of\s+Office[:\s]+([^\n\r]+)/i,
      /\bOffice\s+Name[:\s]+([^\n\r]+)/i,
      /\bDept[:\s]+([^\n\r]+)/i,
    ];
    for (const pattern of labelPatterns) {
      const m = text.match(pattern);
      if (m) {
        let val = m[1].trim();
        val = val
          .replace(/\s*\b(?:Bill\s*(?:No|Number)|DDO\s*Code|Head\s*of\s*Account|Net\s*Sal|Net\s*Amount|Major\s*Head)\b.*$/i, "")
          .trim();
        if (val) return val;
      }
    }
    return "";
  }

  // ── BiMS Bill No & Net Amount Extractors ──────────────────────────────────

  /**
   * Extract the BiMS Bill Reference Number (BRN)
   */
  function _extractBimsBillNo(text) {
    // Priority 1: BiMS BRNs are usually 20 digits long and appear near "Period of claim"
    let m = text.match(/(\d{15,25})\s*Period\s*of\s*claim/i);
    if (m) return m[1].trim();

    // Priority 2: Standalone 20-digit number
    m = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) return m[1].trim();

    // Fallback: General match if label is adjacent
    m = text.match(/(?:Bill\s*Reference\s*Number|BRN|Voucher\s*No|Bill\s*No)[\s.:]*(\d[\d\/\-]*)/i);
    if (m) return m[1].trim();

    return "";
  }

  /**
   * Extract the BiMS Net Amount
   */
  function _extractBimsNetAmount(text) {
    // Matches: "Net Amount, (A-B) = Rs. 853" or similar variations
    let m = text.match(/Net\s*Amount[\s\S]*?(?:Rs\.?|=|:)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    if (m) return parseAmount(m[1]);
    return 0;
  }

  // ── BiMS parser ───────────────────────────────────────────────────────────

  function parseBimsBill(text) {
    const result = {
      billType:   "BiMS",
      billNo:     "",
      ddoCode:    "",
      department: "",
      netAmount:  0,
      hoa:        null,
    };

    result.billNo = _extractBimsBillNo(text);

    const ddoMatch =
      text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
      text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) ||
      text.match(/:\s*([0-9]{10})\b/); 
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();

    result.department = _extractDeptBims(text);

    const hoaMatch = text.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    if (hoaMatch) {
      const parts = [hoaMatch[1], hoaMatch[2], hoaMatch[3],
                     hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]];
      result.hoa    = parseBimsHoA(parts.join(" "));
      result.rawHoA = parts.join(" ");
    }

    result.netAmount = _extractBimsNetAmount(text);

    return result.hoa ? result : null;
  }

  function _extractDeptBims(text) {
    const labelPatterns = [
      /\bDepartment[:\s]+([^\n\r]+)/i,
      /\bName\s+of\s+Office[:\s]+([^\n\r]+)/i,
      /\bOffice\s+Name[:\s]+([^\n\r]+)/i,
      /\bOffice[:\s]+([^\n\r]+)/i,
      /\bDept[:\s]+([^\n\r]+)/i,
    ];
    for (const pattern of labelPatterns) {
      const m = text.match(pattern);
      if (m) {
        let val = m[1].trim();
        val = val
          .replace(/\s*\b(?:Bill\s*(?:No|Number)|Voucher\s*No|DDO\s*Code|Head\s*of\s*Account|Net\s*Amount|Major\s*Head)\b.*$/i, "")
          .trim();
        if (val) return val;
      }
    }
    return "";
  }

  // ── Multi-HoA support ─────────────────────────────────────────────────────

  function _extractMultipleHoAsFromSpark(text) {
    const results = [];
    const seen = new Set();
    const hoaPattern = /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/g;
    let match;

    while ((match = hoaPattern.exec(text)) !== null) {
      const hoaStr = match[1];
      const hoa    = parseSparkHoA(hoaStr);
      const key    = canonicalHoA(hoa);

      if (seen.has(key)) continue;
      seen.add(key);

      const slice     = text.slice(match.index, match.index + 250);
      const netAmount = _extractAmountFromSlice(slice);

      results.push({ hoa, rawHoA: hoaStr, netAmount });
    }

    return results;
  }

  function _extractMultipleHoAsFromBims(text) {
    const results = [];
    const seen = new Set();
    const hoaPattern = /\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/g;
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

    let parsed;
    let multiHoas;

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
      billType:   parsed.billType,
      billNo:     parsed.billNo,
      ddoCode:    parsed.ddoCode,
      department: parsed.department,
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
  return {
    parsePdf,
    parseAmount,
    canonicalHoA,
    parseSparkHoA,
    parseBimsHoA,
    detectBillType,
  };
})();