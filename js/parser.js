/**
 * parser.js  (v7 — Ultra-Robust Standalone Full Spark Code & Salary Parser)
 * =========
 * Client-side PDF text extraction and bill data parsing.
 */

const TbrParser = (() => {

  // ── ക്ലീൻ ആയി PDF ടെക്സ്റ്റ് റീഡ് ചെയ്യാനുള്ള ലോഗിക് ────────────────────────
  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let fullText = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // അക്ഷരങ്ങൾക്കിടയിലെ കൃത്യമായ സ്പേസ് നിലനിർത്തി ജോയിൻ ചെയ്യുന്നു
      const pageStr = content.items.map(item => item.str).join(" ");
      fullText += pageStr + "\n";
    }
    return fullText;
  }

  // ── ബിൽ ടൈപ്പ് തിരിച്ചറിയൽ ───────────────────────────────────────────────────
  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal") || t.includes("gross salary") || t.includes("spark code")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  // ── എമൗണ്ട് കൺവേർഷൻ ഹെൽപ്പർ ────────────────────────────────────────────────
  function parseAmount(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/,/g, "").replace(/\s/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  // ── ഹെഡ് ഓഫ് അക്കൗണ്ട് മാപ്പിംഗ് ──────────────────────────────────────────────
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
    return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH,
            hoaObj.SBHLH, hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SPARK DATA EXTRACTORS ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function _extractTreasury(text) {
    const m = text.match(/Name\s+Of\s+Treasury\s*[:\-]\s*([^\n\r,]+)/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractDdoCode(text) {
    const m = text.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m) return m[1].trim();
    return "";
  }

  // മുഴുവൻ സ്പാർക്ക് കോഡും ഡിജിറ്റുകൾ നഷ്ടപ്പെടാതെ എടുക്കുന്നു
  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) {
      const code = m[1].trim().replace(/\s+/g, ' ');
      if (code.replace(/\s/g, '').length >= 10) return code;
    }
    return "";
  }

  function _extractSparkBillNo(text) {
    let m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)/i);
    if (m) return m[1].trim();
    m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();
    return "";
  }

  // SDO Bill FOR കഴിഞ്ഞുവരുന്ന മാസം/വർഷം എടുക്കുന്നു
  function _extractRemarks(text) {
    const m = text.match(/SDO\s+Bill\s+FOR\s+([A-Za-z]+\s+\d{4})/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractOffice(text) {
    const m = text.match(/Name\s+of\s+Office\s*[:\-]\s*([^\n\r,]+)/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractDepartment(text) {
    const m = text.match(/GOVERNMENT\s+OF\s+KERALA\s+([^\n\r]+)/i);
    if (m) return m[1].replace(/CERTIFICATES.*$/i, '').trim();
    return "";
  }

  // കോളങ്ങൾ ഷിഫ്റ്റ് ആയാലും കൃത്യമായി സാലറി കണ്ടുപിടിക്കുന്ന മാത്തമാറ്റിക്കൽ ലോഗിക്
  function _extractSalaryBreakdown(fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    // 1. ഗ്രോസ് സാലറി നേരിട്ട് കണ്ടുപിടിക്കുന്നു
    let mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) {
      result.grossAmount = parseAmount(mGross[1]);
    }

    // 2. 'Total' വരികളിൽ നിന്നും അലവൻസ് നമ്പറുകൾ കണ്ടെത്തുന്നു
    const matches = [...fullText.matchAll(/\bTotal\b[\s:]*([\d,\s\.]+)/gi)];
    for (const match of matches) {
      const nums = match[1].split(/[\s,]+/)
                           .map(n => n.trim())
                           .filter(n => /^\d+(\.\d+)?$/.test(n))
                           .map(Number);
      
      // അലവൻസ് ടേബിളിലെ ടോട്ടൽ വരിയിൽ കുറഞ്ഞത് 8 നമ്പറുകൾ ഉണ്ടാകും
      if (nums.length >= 8) {
        result.pay            = nums[1] || 0; // ഇൻഡക്സ് 1 ആണ് Basic Less OA/SA (Pay)
        result.da             = nums[2] || 0;
        result.hra            = nums[3] || 0;
        result.cca            = nums[4] || 0;
        result.pgAllowance    = nums[5] || 0;
        result.ruralAllowance = nums[6] || 0;

        if (result.grossAmount === 0 && nums[7]) {
          result.grossAmount = nums[7];
        }

        // Rural Allowance കഴിഞ്ഞുള്ള ബാക്കി അലവൻസുകൾ തനിയെ കൂട്ടി Other Allowance ലേക്ക് മാറ്റുന്നു
        const specificSum = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
        const diff = result.grossAmount - specificSum;
        result.otherAllowance = diff > 0 ? diff : 0;
        
        break;
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN PROCESSORS ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  async function parseSparkBillFull(file) {
    const fullText = await extractPdfText(file);

    const treasury   = _extractTreasury(fullText);
    const ddoCode    = _extractDdoCode(fullText);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    const office     = _extractOffice(fullText);
    const department = _extractDepartment(fullText);
    const salary     = _extractSalaryBreakdown(fullText);

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

  async function parseBimsBillFull(file) {
    const text = await extractPdfText(file);

    let mNo = text.match(/(\d{15,25})\s*Period\s*of\s*claim/i) || text.match(/(?<!\d)(\d{20})(?!\d)/);
    const billNoStr = mNo ? mNo[1].trim() : "";
    
    let mGross = text.match(/Total\s*\(A\)\s*([\d,]+(?:\.\d{1,2})?)/i) || text.match(/Gross\s*Bill\s*Amount\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const gross = mGross ? parseAmount(mGross[1]) : 0;

    const ddoMatch = text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) || text.match(/:\s*([0-9]{10})\b/);
    const ddoCode = ddoMatch ? ddoMatch[1].trim() : "";

    const hoaMatch = text.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    const parts = hoaMatch ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]] : null;
    const hoa = parts ? parseBimsHoA(parts.join(" ")) : null;

    return {
      billType:      "BiMS",
      billNo:        billNoStr,
      treasury:      "",
      sparkCode:     ddoCode,
      department:    "BiMS Department",
      ddoCode,
      remarks:       "",
      pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0,
      consolidatePay: 0, dailyWages: 0, ms: 0, tourTa: 0, mr: 0,
      grossAmount:   gross,
      hoa,
      rawHoA:        parts ? parts.join(" ") : "",
    };
  }

  async function parsePdf(file) {
    const sniffText = await extractPdfText(file);
    const billType  = detectBillType(sniffText);

    if (!billType) {
      throw new Error(`Could not determine bill type from "${file.name}".`);
    }

    let parsed = (billType === "SPARK") ? await parseSparkBillFull(file) : await parseBimsBillFull(file);
    if (!parsed) throw new Error(`Failed to extract required fields from "${file.name}".`);

    return [parsed];
  }

  return { parsePdf, parseAmount, canonicalHoA, parseSparkHoA, parseBimsHoA, detectBillType };
})();