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
    // 1. ഫസ്റ്റ് ചോയ്സ്: 'Name Of Treasury' ലേബൽ വെച്ച് നോക്കുന്നു (സ്പേസ് ഒട്ടിപ്പിടിച്ചാലും വർക്ക് ആകും)
    const m = text.match(/Name\s*Of\s*Treasury[\s:\-]*([^\n\r]+)/i);
    if (m) {
      let tName = m[1].split(/(?:Computer|Token|Scroll|Dept|DDO|Date|Form|Vide|Officer|Bill)/i)[0];
      tName = tName.replace(/[_.]{2,}/g, " ").trim();
      if (tName.length > 2) return tName;
    }

    // 2. സെക്കൻഡ് ചോയ്സ് (Fallback): ലേബൽ കിട്ടിയില്ലെങ്കിൽ 'Sub/District Treasury, Name (Code)' പാറ്റേൺ നേരിട്ട് എടുക്കുന്നു
    const mDirect = text.match(/(?:District|Sub)\s*Treasury\s*,\s*[A-Za-z\s]+\s*\(\d+\)/i) || 
                    text.match(/(?:District|Sub)\s*Treasury\s*[A-Za-z\s\(\)0-9,]+/i);
    if (mDirect) {
      let tName = mDirect[0].split(/(?:Computer|Token|Scroll|Dept|DDO|Date|Form|Vide|Officer|Bill)/i)[0];
      tName = tName.replace(/[_.]{2,}/g, " ").trim();
      // അവസാനത്തെ ചിഹ്നങ്ങൾ കളയുന്നു
      tName = tName.replace(/[\-:\s,]+$/, "").trim();
      if (tName.length > 2) return tName;
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

  // =========================================================================
  // STAGE 4 — SMART HYBRID SALARY ENGINE (COLUMN-SHIFT IMMUNE)
  // =========================================================================

  function _extractSalaryBreakdown(fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    // 1. ഗ്രോസ് സാലറി കൃത്യമായി പേജ് 1-ലെ ABSTRACT ൽ നിന്നും എടുക്കുന്നു
    const mGross = fullText.match(/Total\s*A\s*Gross[\s:\-]*([\d,]+(?:\.\d+)?)/i) || 
                   fullText.match(/Gross\s*Salary[\s:\-]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    // 2. അലവൻസുകൾ ടേബിളിലെ സ്ഥാനം നോക്കാതെ ഫിക്സഡ് കോഡുകൾ വഴി നേരിട്ട് എടുക്കുന്നു
    const extractCodeValue = (code) => {
      const regex = new RegExp(`\\b${code}\\b[A-Za-z\\s\\/]+(?:\\(\\d+\\))?[\\s:]*([\\d,]+)`, 'i');
      const m = fullText.match(regex);
      return m ? parseAmount(m[1]) : 0;
    };

    result.da             = extractCodeValue(22);
    result.hra            = extractCodeValue(23);
    result.cca            = extractCodeValue(24);
    result.pgAllowance    = extractCodeValue(64);
    result.ruralAllowance = extractCodeValue(45);

    // 3. Pay (Basic Less OA/SA) കോഡ് 01 വഴി എടുക്കുന്നു. ഇല്ലെങ്കിൽ ബാക്കപ്പായി ടേബിളിൽ നിന്ന് എടുക്കുന്നു.
    result.pay = extractCodeValue('01');
    
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

    // 4. താങ്കൾ പറഞ്ഞ കൃത്യമായ ലോഗിക്: Other Allowance = Gross - (Pay + Allowances)
    const knownSum = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
    
    if (result.grossAmount > knownSum) {
      result.otherAllowance = result.grossAmount - knownSum;
    } else {
      result.otherAllowance = 0;
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