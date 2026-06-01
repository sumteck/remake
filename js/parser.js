/**
 * parser.js  (v14 — DDO Code Removed & Hybrid Engine Optimized)
 * =========
 * Client-side PDF text extraction and bill data parsing for the Remake app.
 */

const TbrParser = (() => {

  // =========================================================================
  // STAGE 1 — SAFE PDF TEXT EXTRACTION (Keeps spaces intact)
  // =========================================================================

  function _sanitise(str) {
    if (!str) return "";
    return str
      .replace(/[_.]{2,}/g, " ")   
      .replace(/\s{2,}/g, " ")     
      .trim();
  }

  function _assemblePageItems(items) {
    if (!items || items.length === 0) return "";

    const sortedItems = items.slice().sort((a, b) => {
      const dy = b.transform[5] - a.transform[5];
      if (Math.abs(dy) > 4) return dy > 0 ? 1 : -1;
      return a.transform[4] - b.transform[4];
    });

    let result = "";
    let prev = null;

    for (const item of sortedItems) {
      const str = item.str;
      if (str === undefined || str === null || str === "") continue;

      if (!prev) {
        result = str;
        prev = item;
        continue;
      }

      const prevX = prev.transform[4];
      const prevY = prev.transform[5];
      const prevW = prev.width || 0;
      const curX  = item.transform[4];
      const curY  = item.transform[5];

      const dY = Math.abs(curY - prevY);
      const dX = curX - (prevX + prevW);

      if (dY > 5) {
        result += "\n" + str; 
      } else if (dX <= 2.5 || (/^\d+$/.test(prev.str.trim()) && /^\d+$/.test(str.trim()) && dX < 6)) {
        result += str; 
      } else {
        result += " " + str; 
      }

      prev = item;
    }

    return result;
  }

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let fullText = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += _assemblePageItems(content.items) + "\n";
    }
    return _sanitise(fullText);
  }

  // =========================================================================
  // STAGE 2 — UTILITY HELPERS
  // =========================================================================

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal") || t.includes("gross salary") || t.includes("spark code")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  function parseAmount(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/,/g, "").replace(/\s/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  function _toTitleCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function _mapHoaParts(parts) {
    const p = [...parts];
    while (p.length < 7) p.push("00");
    return {
      MJH: p[0] || "00", SMJH: p[1] || "00", MIH: p[2] || "00",
      SBHLH: p[3] || "00", SHLH: p[4] || "00", VOH: p[5] || "00", SOH: p[6] || "00",
    };
  }

  function parseSparkHoA(hoaStr) { return _mapHoaParts(hoaStr.trim().split("-")); }
  function parseBimsHoA(hoaStr)  { return _mapHoaParts(hoaStr.trim().split(/\s+/)); }

  // =========================================================================
  // STAGE 3 — SPARK FIELD EXTRACTORS
  // =========================================================================

  function _extractTreasury(text) {
    // കൃത്യമായി 'Name Of Treasury:' എന്ന് തുടങ്ങുന്ന വരി മാത്രം ടാർഗെറ്റ് ചെയ്യുന്നു
    const m = text.match(/Name\s*Of\s*Treasury\s*[:\-]?\s*([^\n\r]+)/i);
    
    if (m) {
      // ട്രഷറി പേര് എടുത്തതിന് ശേഷം അനാവശ്യമായി വരാൻ സാധ്യതയുള്ള വാക്കുകൾ കട്ട് ചെയ്യുന്നു
      let treasuryName = m[1].split(/(?:Computer|Token|Scroll|Dept|DDO|Date|Officer)/i)[0];
      return _sanitise(treasuryName);
    }
    return "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) return m[1].trim().replace(/\s+/g, " ");
    return "";
  }

  function _extractSparkBillNo(text) {
    const mLabel = text.match(/Bill\s*(?:No|Number)\s*[:\-]?\s*(\d+)/i);
    if (mLabel) return mLabel[1].trim();
    
    const mStandAlone = text.match(/\b(266\d{5})\b/) || text.match(/\b(26\d{6})\b/);
    if (mStandAlone) return mStandAlone[1].trim();
    return "";
  }

  function _extractRemarks(text) {
    const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
    const re = new RegExp("\\bFOR\\s+(" + MONTHS + ")\\s+(\\d{4})\\b", "i");
    const m = text.match(re);
    return m ? _toTitleCase(m[1]) + " " + m[2] : "";
  }

  // =========================================================================
  // STAGE 4 — SMART SALARY EXTRACTION ENGINE
  // =========================================================================

  function _extractSalaryBreakdown(fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    const mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:\-]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    const getAbs = (pattern) => {
      const m = fullText.match(pattern);
      return m ? parseAmount(m[1]) : null;
    };
    
    const absPay   = getAbs(/\b01\b\s+Pay.*?([\d,]{4,})/i) || getAbs(/\b01\b\s+.*?([\d,]{4,})/i); 
    const absDa    = getAbs(/\b22\b\s+DA.*?([\d,]{3,})/i) || getAbs(/\b22\b\s+.*?([\d,]{3,})/i);
    const absHra   = getAbs(/\b23\b\s+House.*?([\d,]{3,})/i) || getAbs(/\b23\b\s+.*?([\d,]{3,})/i);
    const absCca   = getAbs(/\b24\b\s+CCA.*?([\d,]{3,})/i) || getAbs(/\b24\b\s+.*?([\d,]{3,})/i);
    const absPg    = getAbs(/\b64\b\s+PG\s+Allowance.*?([\d,]{3,})/i) || getAbs(/\b64\b\s+.*?([\d,]{3,})/i);
    const absRural = getAbs(/\b45\b\s+Rural.*?([\d,]{3,})/i) || getAbs(/\b45\b\s+.*?([\d,]{3,})/i);

    let rowPay=0, rowDa=0, rowHra=0, rowCca=0, rowPg=0, rowRural=0;
    const lines = fullText.split('\n');
    for (let line of lines) {
      if (/^Total\s+\d+/i.test(line.trim())) {
        const nums = line.match(/\d+/g).map(Number);
        if (nums.length >= 6) {
          rowPay = nums[1]; rowDa = nums[2]; rowHra = nums[3]; 
          rowCca = nums[4]; rowPg = nums[5]; rowRural = nums[6];
        }
        break;
      }
    }

    result.pay            = absPay || rowPay || 0;
    result.da             = absDa || rowDa || 0;
    result.hra            = absHra || rowHra || 0;
    result.cca            = absCca || rowCca || 0;
    result.pgAllowance    = absPg || rowPg || 0;
    result.ruralAllowance = absRural || rowRural || 0;

    const known = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
    if (result.grossAmount > known) {
      result.otherAllowance = result.grossAmount - known;
    }

    return result;
  }

  // =========================================================================
  // STAGE 5 — MAIN PROCESSORS
  // =========================================================================

  async function parseSparkBillFull(file) {
    const fullText = await extractPdfText(file);

    const treasury   = _extractTreasury(fullText);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    const salary     = _extractSalaryBreakdown(fullText);

    let department = "Indian Systems of Medicine";
    const lines = fullText.split('\n');
    const govIdx = lines.findIndex(l => l.toUpperCase().includes("GOVERNMENT OF KERALA"));
    if (govIdx !== -1 && govIdx + 1 < lines.length) {
      const textLine = lines[govIdx + 1].trim();
      if (/[A-Za-z]/.test(textLine) && !/\d{4,}/.test(textLine)) {
        department = textLine;
      }
    }

    const hoaMatch = fullText.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    const hoa = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      sparkCode,
      department,
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
      rawHoA:          hoaMatch ? hoaMatch[1] : "",
    };
  }

  async function parseBimsBillFull(file) {
    const text = await extractPdfText(file);
    const sanitized = _sanitise(text);

    let mNo = sanitized.match(/(\d{15,25})\s*Period\s*of\s*claim/i) || sanitized.match(/(?<!\d)(\d{20})(?!\d)/);
    const billNoStr = mNo ? mNo[1].trim() : "";
    
    let mGross = sanitized.match(/Total\s*\(A\)\s*([\d,]+(?:\.\d{1,2})?)/i) || sanitized.match(/Gross\s*Bill\s*Amount\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const gross = mGross ? parseAmount(mGross[1]) : 0;

    // BiMS-ൽ സ്പാർക്ക് കോഡ് ഇല്ലാത്തതുകൊണ്ട് DDO Code ആണ് തൽക്കാലം സ്പാർക്ക് കോഡായി കൊടുക്കുന്നത്
    const ddoMatch = sanitized.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) || sanitized.match(/:\s*([0-9]{10})\b/);
    const bimsSparkEquivalent = ddoMatch ? ddoMatch[1].trim() : "";

    const hoaMatch = sanitized.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    const parts = hoaMatch ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]] : null;
    const hoa = parts ? parseBimsHoA(parts.join(" ")) : null;

    return {
      billType:       "BiMS",
      billNo:         billNoStr,
      treasury:       "",
      sparkCode:      bimsSparkEquivalent,
      department:     "BiMS Department",
      remarks:        "",
      pay:            0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0,
      consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
      grossAmount:    gross,
      hoa,
      rawHoA:         parts ? parts.join(" ") : "",
    };
  }

  async function parsePdf(file) {
    const sniffText = await extractPdfText(file);
    const billType  = detectBillType(sniffText);

    if (!billType) {
      throw new Error("Could not determine bill type from \"" + file.name + "\".");
    }

    const parsed = billType === "SPARK" ? await parseSparkBillFull(file) : await parseBimsBillFull(file);
    if (!parsed) throw new Error("Failed to extract required fields from \"" + file.name + "\".");

    return [parsed];
  }

  function canonicalHoA(hoaObj) {
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH, hoaObj.SBHLH, hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-");
  }

  return { parsePdf, parseAmount, canonicalHoA, parseSparkHoA, parseBimsHoA, detectBillType };
})();