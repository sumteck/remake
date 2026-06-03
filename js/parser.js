/**
 * parser.js  (v4 — Production-hardened: template sanitisation + micro-gap merge)
 */

const TbrParser = (() => {

  // =========================================================================
  // STAGE 1 — PDF TEXT EXTRACTION WITH MICRO-GAP MERGE
  // =========================================================================

  function _sanitise(str) {
    return str
      .replace(/[_.]{2,}/g, " ")   
      .replace(/\s{2,}/g, " ")     
      .trim();
  }

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
  // STAGE 4 — SPARK FIELD EXTRACTORS
  // =========================================================================

  function _extractTreasury(text) {
    const m = text.match(/Name\s*Of\s*Treasury[\s:\-]*([^\n\r]+)/i);
    if (m) {
      let tName = m[1].split(/(?:Computer|Token|Scroll|Dept|DDO|Date|Form|Vide|Officer|Bill)/i)[0];
      tName = tName.replace(/[_.]{2,}/g, " ").trim();
      if (tName.length > 2) return tName;
    }

    const mDirect = text.match(/(?:District|Sub)\s*Treasury\s*,\s*[A-Za-z\s]+\s*\(\d+\)/i) || 
                    text.match(/(?:District|Sub)\s*Treasury\s*[A-Za-z\s\(\)0-9,]+/i);
    if (mDirect) {
      let tName = mDirect[0].split(/(?:Computer|Token|Scroll|Dept|DDO|Date|Form|Vide|Officer|Bill)/i)[0];
      tName = tName.replace(/[_.]{2,}/g, " ").trim();
      tName = tName.replace(/[\-:\s,]+$/, "").trim();
      if (tName.length > 2) return tName;
    }
    
    return "";
  }

  function _extractDdoCode(page1) {
    const m = page1.match(/DDO\s*Code\s*[:\-]\s*(\d{1,6}-\d{1,6}-\d{1,6})/i);
    if (m) return m[1].trim();

    const m2 = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m2) return m2[1].trim();

    const m3 = page1.match(/\bDDO\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m3) return m3[1].trim();

    return "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code[\s:\-]*((?:\d{5}\s*){4})/i) || text.match(/Spark\s*Code[\s:\-]*(\d{20})/i);
    if (m) return m[1].trim().replace(/\s+/g, " ");
    return "";
  }

  function _extractSparkBillNo(text) {
    let m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
    if (m) return m[1].trim();

    m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$)/i);
    if (m) return m[1].trim();

    m = text.match(/(?<!\d)(\d{8})(?!\d)/);
    if (m) return m[1].trim();

    return "";
  }

  function _extractRemarks(text) {
    const flatText = text.replace(/\n/g, " ");
    const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

    const mainRegex = new RegExp(`PAY\\s+AND\\s+ALLOWANCE\\s+IN\\s+RESPECT\\s+OF\\s+(.*?(?:${MONTHS})\\s+\\d{4})`, "i");
    const match = flatText.match(mainRegex);
    if (match) return match[1].trim().replace(/\s+/g, " ");

    const fallbackRegex = new RegExp(`(?:([A-Za-z\\s]+)\\s+)?FOR\\s+(${MONTHS})\\s+(\\d{4})`, "i");
    const m2 = flatText.match(fallbackRegex);
    if (m2) {
      let prefix = m2[1] ? m2[1].trim() + " " : "";
      return prefix + "FOR " + m2[2].charAt(0).toUpperCase() + m2[2].slice(1).toLowerCase() + " " + m2[3];
    }

    return "";
  }

  function _extractDeptAndOffice(page3) {
    const match = page3.match(/GOVERNMENT\s+OF\s+KERALA\s*([\s\S]*?)\s*PAY\s+AND\s+ALLOWANCE/i);
    if (match) {
      let chunk = match[1].replace(/\n/g, " ").trim();
      const splitMatch = chunk.match(/([a-zA-Z\s]+?[a-z])\s+([A-Z][A-Z\s]+)/);
      if (splitMatch) return { department: splitMatch[1].trim(), office: splitMatch[2].trim() };
      return { department: chunk, office: "" };
    }
    return { department: "", office: "" };
  }

  // =========================================================================
  // STAGE 5 — SMART HYBRID SALARY ENGINE
  // =========================================================================

  function _extractSalaryBreakdown(fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    const mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:\-]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    let abstractText = fullText;
    const absMatch = fullText.match(/ABSTRACT\s*OF\s*THE\s*BILL([\s\S]*?)(?:Total\s*A\s*Gross|Gross\s*Salary|Commonly\s*used)/i);
    if (absMatch) {
      abstractText = absMatch[1];
    } else {
      abstractText = fullText.split(/Commonly\s*used\s*Dues/i)[0];
    }

    const extractCodeValue = (codeStr) => {
      const regex = new RegExp(`(?<!\\d)${codeStr}(?![\\d])`, 'i');
      const match = abstractText.match(regex);
      if (!match) return 0;

      const afterText = abstractText.substring(match.index + match[0].length);
      const chunk = afterText.substring(0, 100); 
      
      const nums = [];
      const numRegex = /[\d,]+/g;
      let m;
      while ((m = numRegex.exec(chunk)) !== null) {
        nums.push(parseAmount(m[0]));
      }

      if (nums.length === 0) return 0;
      if (nums[0] === parseInt(codeStr, 10) && nums.length > 1) return nums[1];
      return nums[0];
    };

    result.da             = extractCodeValue('22') || extractCodeValue('141');
    result.hra            = extractCodeValue('23');
    result.cca            = extractCodeValue('24');
    result.pgAllowance    = extractCodeValue('64');
    result.ruralAllowance = extractCodeValue('45');
    result.pay            = extractCodeValue('01') || extractCodeValue('140');
    
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

  async function parseSparkBillFull(file) {
    const pages    = await extractPdfPages(file);
    const fullText = pages.join("\n");

    const page1 = pages[0] || "";
    const page3 = pages[2] || pages[1] || fullText;

    const treasury               = _extractTreasury(page1);
    const ddoCode                = _extractDdoCode(page1);
    const sparkCode              = _extractSparkCode(fullText);  
    const billNo                 = _extractSparkBillNo(fullText);
    const remarks                = _extractRemarks(fullText);
    const { department, office } = _extractDeptAndOffice(page3);
    const salary                 = _extractSalaryBreakdown(fullText);

    const hoaMatch = fullText.match(
      /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/
    );
    const hoa    = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;
    const rawHoA = hoaMatch ? hoaMatch[1] : "";

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      headOfAccount:   rawHoA,
      sparkCode,                            
      department:      department + " - " + office, 
      departmentGroup: department,           
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

  // =========================================================================
  // STAGE 7 — BIMS PARSER 
  // =========================================================================

  function _extractBimsDetails(text) {
    const result = { brn: "", treasury: "", department: "", office: "", ddoCode: "" };

    const brnMatch = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (brnMatch) result.brn = brnMatch[1];

    const flatText = text.replace(/\n/g, " ");

    const treasuryMatch = flatText.match(/Name of Treasury\s*:\s*(.*?)\s*Name of Department/i);
    if (treasuryMatch) result.treasury = treasuryMatch[1].trim();

    const deptMatch = flatText.match(/Name of Department\s*:\s*(.*?)\s*DDO Code/i);
    if (deptMatch) result.department = deptMatch[1].trim();

    const ddoMatch = flatText.match(/DDO Code\s*:\s*(\d{10})/i);
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();

    const officeMatch = flatText.match(/Name of Office\s*:\s*(.*?)\s*TAN\/GIR/i);
    if (officeMatch) {
      result.office = officeMatch[1].trim();
    } else {
      const fallback = flatText.match(/Name of Office\s*:\s*(.*?)\s*Bill Reference/i);
      if (fallback) result.office = fallback[1].trim();
    }

    return result;
  }

  function _extractBimsGrossAmount(text) {
    let m = text.match(/Total\s*\(A\)\s*([\d,]+(?:\.\d{1,2})?)/i) || 
            text.match(/Gross\s*Bill\s*Amount\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    return m ? parseAmount(m[1]) : 0;
  }

  async function parseBimsBillFull(file) {
    const text = await extractPdfText(file);
    
    const bimsData = _extractBimsDetails(text);
    const gross    = _extractBimsGrossAmount(text);

    // FIX: സ്പേസ് ഇല്ലാതെ വന്നാലും കണ്ടുപിടിക്കാൻ പാകത്തിൽ അഡ്ജസ്റ്റ് ചെയ്ത പുതിയ കോഡ്
    const hoaMatch = text.match(/(?<!\d)(\d{4})[\s\-]*(\d{2})[\s\-]*(\d{3})[\s\-]*(\d{2})[\s\-]*(\d{2})[\s\-]*(\d{2})[\s\-]*(\d{2})(?!\d)/);
    const parts = hoaMatch ? [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]] : null;
    const hoa = parts ? parseBimsHoA(parts.join(" ")) : null;

    let dept = bimsData.department ? bimsData.department.trim() : "";
    let off  = bimsData.office ? bimsData.office.trim() : "";
    let finalDepartment = dept !== "" && off !== "" ? (dept + " - " + off) : (dept || off);

    return {
      billType:       "BiMS",
      billNo:         "",                 
      treasury:       bimsData.treasury,  
      headOfAccount:  parts ? parts.join("-") : "",   
      sparkCode:      bimsData.brn,       
      department:     finalDepartment,    
      ddoCode:        bimsData.ddoCode,
      remarks:        "Contingent Payment",
      pay:            0, da: 0, hra: 0, cca: 0,
      pgAllowance:    0, ruralAllowance: 0, otherAllowance: 0,
      consolidatePay: 0, dailyWages: 0, 
      ms:             gross,      
      tourTa:         0, mr: 0,
      grossAmount:    gross,
      hoa,
      rawHoA:         parts ? parts.join(" ") : "",
    };
  }
  
  // =========================================================================
  // STAGE 8 — MAIN ENTRY POINT
  // =========================================================================

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

  return {
    parsePdf,
    parseAmount,
    canonicalHoA,
    parseSparkHoA,
    parseBimsHoA,
    detectBillType,
  };

})();
