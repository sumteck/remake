/**
 * parser.js  (v12 — Bulletproof Regex & Anti-Shift Architecture)
 * =========
 * Client-side PDF text extraction and bill data parsing for the Remake app.
 */

const TbrParser = (() => {

  // =========================================================================
  // STAGE 1 — ROBUST PDF TEXT EXTRACTION (FIXES KERNING & SPACING)
  // =========================================================================

  function _sanitise(str) {
    if (!str) return "";
    return str.replace(/[_.]{2,}/g, " ").trim();
  }

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let fullText = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // വരികളെ ഒന്നിപ്പിക്കാൻ Y-കോർഡിനേറ്റ് 5px ബാൻഡുകളായി തിരിക്കുന്നു
      const linesMap = {};
      for (const item of content.items) {
        if (!item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 5) * 5; 
        if (!linesMap[y]) linesMap[y] = [];
        linesMap[y].push(item);
      }

      const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a);
      for (const y of sortedY) {
        const lineItems = linesMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
        let lineStr = "";
        let prevRight = -1;

        for (const item of lineItems) {
          const curLeft = item.transform[4];
          // നമ്പറുകൾക്കിടയിലെ ഗ്യാപ്പ് ചെറുതാണെങ്കിൽ ഒന്നിപ്പിക്കുന്നു (eg: 736 00 -> 73600)
          if (prevRight !== -1 && (curLeft - prevRight) < 5) {
            lineStr += item.str;
          } else {
            lineStr += " " + item.str;
          }
          prevRight = curLeft + (item.width || 0);
        }
        fullText += lineStr.trim() + "\n";
      }
    }
    // കോൺഫിൻ കണ്ടന്റ് ക്ലീൻ ചെയ്യുന്നു
    return fullText.replace(/[_.]{2,}/g, " "); 
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

  function canonicalHoA(hoaObj) {
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH, hoaObj.SBHLH, hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-");
  }

  // =========================================================================
  // STAGE 3 — SPARK FIELD EXTRACTORS
  // =========================================================================

  function _extractTreasury(text) {
    const m = text.match(/(?:Name\s+Of\s+Treasury|Treasury)\s*[:\-]?\s*(.+?)(?=\bComputer\b|\bToken\b|\bDDO\b|\bDept\b|\bDate\b|$)/i);
    return m ? _sanitise(m[1]) : "";
  }

  function _extractDdoCode(text) {
    const m = text.match(/\b\d{4}-\d{3}-\d{3}\b/);
    if (m) return m[0].trim();
    const m2 = text.match(/DDO\s*Code\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    return m2 ? m2[1].trim() : "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) return m[1].trim().replace(/\s+/g, " ");
    return "";
  }

  function _extractSparkBillNo(text) {
    const mLabel = text.match(/Bill\s*(?:No|Number)\s*[:\-]?\s*(\d+)/i);
    if (mLabel) return mLabel[1].trim();
    const mStandAlone = text.match(/\b(26\d{6})\b/);
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

    // 1. ഗ്രോസ് സാലറി കണ്ടെത്തുന്നു
    const mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:\-]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    // 2. ABSTRACT OF THE BILL കോഡുകൾ ഉപയോഗിച്ച് ഡാറ്റ കണ്ടെത്തുന്നു (ഏറ്റവും സുരക്ഷിതമായ മാർഗ്ഗം)
    const getAbs = (pattern) => {
      const m = fullText.match(pattern);
      return m ? parseAmount(m[1]) : null;
    };
    
    // ടേബിൾ ലൈനുകൾ മാറിയാലും ഈ കോഡുകൾ (01, 22, 23) വെച്ച് ഡാറ്റ കൃത്യമായി കിട്ടും
    const absPay   = getAbs(/\b01\b\s+Pay.*?([\d,]{4,})/i); 
    const absDa    = getAbs(/\b22\b\s+DA.*?([\d,]{3,})/i);
    const absHra   = getAbs(/\b23\b\s+House.*?([\d,]{3,})/i);
    const absCca   = getAbs(/\b24\b\s+CCA.*?([\d,]{3,})/i);
    const absPg    = getAbs(/\b64\b\s+PG\s+Allowance.*?([\d,]{3,})/i);
    const absRural = getAbs(/\b45\b\s+Rural.*?([\d,]{3,})/i);

    // 3. പേജ് 3 ലെ മെയിൻ ടേബിളിൽ നിന്നുള്ള ബാക്കപ്പ് 
    let rowPay=0, rowDa=0, rowHra=0, rowCca=0, rowPg=0, rowRural=0;
    const mTotal = fullText.match(/\bTotal\b\s+((?:[\d,]+\s+){5,}[\d,]+)/i);
    if (mTotal) {
      const nums = mTotal[1].trim().split(/\s+/).map(parseAmount);
      if (nums.length >= 6) {
        rowPay = nums[1]; rowDa = nums[2]; rowHra = nums[3]; 
        rowCca = nums[4]; rowPg = nums[5]; rowRural = nums[6];
      }
    }

    // കൃത്യമായ ഡാറ്റ ഉറപ്പുവരുത്തുന്നു
    result.pay            = absPay || rowPay || 0;
    result.da             = absDa || rowDa || 0;
    result.hra            = absHra || rowHra || 0;
    result.cca            = absCca || rowCca || 0;
    result.pgAllowance    = absPg || rowPg || 0;
    result.ruralAllowance = absRural || rowRural || 0;

    // മറ്റ് അലവൻസുകൾ സ്വയം കണക്കാക്കുന്നു
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
    const ddoCode    = _extractDdoCode(fullText);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    const salary     = _extractSalaryBreakdown(fullText);

    // ഡിപ്പാർട്ട്മെന്റിൽ നമ്പറുകൾ (11001100) വരുന്നത് തടയാനുള്ള പ്രത്യേക ലോഗിക്
    let department = "Indian Systems of Medicine";
    const lines = fullText.split('\n');
    const govIdx = lines.findIndex(l => l.toUpperCase().includes("GOVERNMENT OF KERALA"));
    if (govIdx !== -1 && govIdx + 1 < lines.length) {
      const textLine = lines[govIdx + 1].trim();
      // വരിയിൽ അക്ഷരങ്ങൾ ഉണ്ടായിരിക്കണം, വലിയ നമ്പറുകൾ ഉണ്ടാകാൻ പാടില്ല
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

    const ddoMatch = sanitized.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) || sanitized.match(/:\s*([0-9]{10})\b/);
    const ddoCode  = ddoMatch ? ddoMatch[1].trim() : "";

    const hoaMatch = sanitized.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    const parts = hoaMatch ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]] : null;
    const hoa = parts ? parseBimsHoA(parts.join(" ")) : null;

    return {
      billType:       "BiMS",
      billNo:         billNoStr,
      treasury:       "",
      sparkCode:      ddoCode,
      department:     "BiMS Department",
      ddoCode,
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

  return { parsePdf, parseAmount, canonicalHoA, parseSparkHoA, parseBimsHoA, detectBillType };
})();