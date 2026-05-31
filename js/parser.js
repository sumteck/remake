/**
 * parser.js
 * =========
 */

const TbrParser = (() => {

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

  function detectBillType(text) {
    const t = text.toLowerCase();
    if (t.includes("net sal")) return "SPARK";
    if (t.includes("net amount")) return "BiMS";
    return null;
  }

  function _mapHoaParts(parts) {
    const p = [...parts];
    while (p.length < 7) p.push("00");
    return { MJH: p[0]||"00", SMJH: p[1]||"00", MIH: p[2]||"00", SBHLH: p[3]||"00", SHLH: p[4]||"00", VOH: p[5]||"00", SOH: p[6]||"00" };
  }

  function parseSparkHoA(hoaStr) { return _mapHoaParts(hoaStr.trim().split("-")); }
  function parseBimsHoA(hoaStr) { return _mapHoaParts(hoaStr.trim().split(/\s+/)); }
  function canonicalHoA(hoaObj) { return [hoaObj.MJH, hoaObj.SMJH, hoaObj.MIH, hoaObj.SBHLH, hoaObj.SHLH, hoaObj.VOH, hoaObj.SOH].join("-"); }

  function parseAmount(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/,/g, "").replace(/\s/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  function _extractAmountFromSlice(slice) {
    const pattern = /(?<![0-9\-\/])([1-9][0-9]*(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)(?![0-9\-\/,])/g;
    const allMatches = [...slice.matchAll(pattern)];
    const validMatches = allMatches.filter(m => (parseFloat(m[1].replace(/,/g, "")) || 0) > 100);
    if (validMatches.length === 0) return 0;
    return parseFloat(validMatches[validMatches.length - 1][1].replace(/,/g, "")) || 0;
  }

  // ── പുതിയത്: PAY AND ALLOWANCE IN RESPECT OF എന്നതിന് ശേഷമുള്ളത് Remarks ആക്കുന്നു ──
  function _extractPeriodRemarks(text) {
    let m = text.match(/PAY\s+AND\s+ALLOWANCE\s+IN\s+RESPECT\s+OF\s+(.+)/i);
    if (m) {
      // അവസാനമുള്ള വർഷം കഴിഞ്ഞുള്ള വേണ്ടാത്ത ടെക്സ്റ്റ് ഒഴിവാക്കാൻ
      return m[1].replace(/(20\d{2}).*/, '$1').trim();
    }

    // Fallbacks
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
    // കൃത്യമായി 5 അക്കങ്ങളുള്ള 4 ഗ്രൂപ്പുകൾ മാത്രം എടുക്കാൻ
    const m = text.match(/Spark\s*Code\s*:\s*(\d{5}\s+\d{5}\s+\d{5}\s+\d{5})/i);
    return m ? m[1].trim() : "";
  }

  // ── പുതിയത്: GOVERNMENT OF KERALA ക്ക് താഴെ നിന്നും Department ഉം Office Name ഉം ──
  function _extractSparkOfficeAndDept(text) {
    let office = "", dept = "";
    const govMatch = text.match(/GOVERNMENT\s+OF\s+KERALA\s+([^\n\r]+)\s+([^\n\r]+)/i);
    if (govMatch) {
      dept = govMatch[1].trim();
      office = govMatch[2].replace(/PAY\s+AND\s+ALLOWANCE.*/i, '').trim();
    } else {
      const mOff = text.match(/Name\s+of\s+Office\s*:\s*([^\n\r]+)/i);
      if (mOff) office = mOff[1].replace(/Bill\s*No.*$/i, '').trim();
      const mDept = text.match(/Name\s+of\s+Department\s*:?\s*(.+?)(?=\s+DDO\s+Code|\s+Office|$)/i);
      if (mDept) dept = mDept[1].trim();
    }
    return { office, dept };
  }

  function _extractSparkAllowances(text) {
    let basicLess = 0, da = 0, hra = 0, cca = 0, grossSalary = 0;

    // 1. Gross Salary (ഇത് എപ്പോഴും കൃത്യമായി കിട്ടും)
    const grossMatch = text.match(/Total\s*A\s*Gross\s*[:=]?\s*([0-9,]+(?:\.\d{1,2})?)/i) || 
                       text.match(/Gross\s*Salary[\s\S]*?([0-9,]+(?:\.\d{1,2})?)/i);
    if (grossMatch) grossSalary = parseAmount(grossMatch[1]);

    // 2. താങ്കൾ പറഞ്ഞതുപോലെ പേജ് 3-ലെ "Total" വരിയിൽ നിന്ന് നേരിട്ട് എടുക്കുന്നു (ഏറ്റവും സുരക്ഷിതം!)
    const totalRowMatch = text.match(/Total\s+([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{2})?)\s+([\d,]+(?:\.\d{2})?)/i);
    
    if (totalRowMatch) {
      basicLess = parseAmount(totalRowMatch[2]); // Basic Less OA/SA
      da        = parseAmount(totalRowMatch[3]); // DA
      hra       = parseAmount(totalRowMatch[4]); // HRA
      cca       = parseAmount(totalRowMatch[5]); // CCA
    } else {
      // അഥവാ ആ ടേബിൾ കിട്ടിയില്ലെങ്കിൽ മാത്രം പേരുവെച്ച് എടുക്കാനുള്ള Fallback
      const bMatch = text.match(/(?:01|140)\s*[-]?\s*Pay[\s\.:]+([0-9,]+\.\d{2})/i);
      if (bMatch) basicLess = parseAmount(bMatch[1]);
      const dMatch = text.match(/(?:22|141)\s*[-]?\s*DA[\s\.:]+([0-9,]+\.\d{2})/i);
      if (dMatch) da = parseAmount(dMatch[1]);
      const hMatch = text.match(/(?:123)\s*[-]?\s*(?:HRA|House\s*Rent)[\s\.:]+([0-9,]+\.\d{2})/i);
      if (hMatch) hra = parseAmount(hMatch[1]);
      const cMatch = text.match(/(?:24)\s*[-]?\s*CCA[\s\.:]+([0-9,]+\.\d{2})/i);
      if (cMatch) cca = parseAmount(cMatch[1]);
    }

    // 3. ബാക്കിയുള്ളവ Other Allowances ലേക്ക് മാറ്റുന്നു
    let otherAllowances = grossSalary - (basicLess + da + hra + cca);
    otherAllowances = Math.round(otherAllowances * 100) / 100; 
    if (otherAllowances < 0) otherAllowances = 0;
    
    return { basicLess, da, hra, cca, otherAllowances, grossSalary };
  }

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

  function parseSparkBill(text) {
    const allowances = _extractSparkAllowances(text);
    const { office, dept } = _extractSparkOfficeAndDept(text);
    
    const result = {
      billType: "SPARK", billNo: _extractSparkBillNo(text),
      sparkCode: _extractSparkCodeString(text), treasury: _extractSparkTreasury(text),
      ddoCode: "", department: dept, officeName: office,
      basicLess: allowances.basicLess, da: allowances.da, hra: allowances.hra, 
      cca: allowances.cca, otherAllowances: allowances.otherAllowances,
      netAmount: allowances.grossSalary, 
      remarks: _extractPeriodRemarks(text),
      encashmentDate: "",
      hoa: null,
    };
    const ddoMatch = text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) || text.match(/\bDDO[:\s]+([A-Z0-9][A-Z0-9\-]*)/i);
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();
    const hoaMatch = text.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    if (hoaMatch) { result.hoa = parseSparkHoA(hoaMatch[1]); result.rawHoA = hoaMatch[1]; }
    return result.hoa ? result : null;
  }

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

  function parseBimsBill(text) {
    const result = {
      billType: "BiMS", billNo: _extractBimsBillNo(text),
      sparkCode: "N/A", treasury: "", ddoCode: "", department: "", officeName: "",
      basicLess: 0, da: 0, hra: 0, cca: 0, otherAllowances: 0, netAmount: _extractBimsNetAmount(text), 
      remarks: _extractPeriodRemarks(text),
      encashmentDate: "",
      hoa: null,
    };
    const ddoMatch = text.match(/DDO\s*Code[:\s]+([A-Z0-9][A-Z0-9\-]*)/i) || text.match(/:\s*([0-9]{10})\b/); 
    if (ddoMatch) result.ddoCode = ddoMatch[1].trim();
    const mTreasury = text.match(/Name\s+of\s+Treasury\s*:\s*([^(\n\r]+)/i);
    if (mTreasury) result.treasury = mTreasury[1].trim();
    const mDept = text.match(/Name\s+of\s+Office\s*:\s*([^\n\r]+)/i) || text.match(/\bOffice[:\s]+([^\n\r]+)/i);
    if (mDept) result.officeName = mDept[1].replace(/Bill\s*No.*$/i, '').trim();
    const hoaMatch = text.match(/\b(\d{4})\s+(\d{2})\s+(\d{3})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/);
    if (hoaMatch) {
      const parts = [hoaMatch[1], hoaMatch[2], hoaMatch[3], hoaMatch[4], hoaMatch[5], hoaMatch[6], hoaMatch[7]];
      result.hoa = parseBimsHoA(parts.join(" ")); result.rawHoA = parts.join(" ");
    }
    return result.hoa ? result : null;
  }

  function _extractMultipleHoAsFromSpark(text) {
    const results = [];
    const seen = new Set();
    const hoaPattern = /(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/g;
    let match;
    while ((match = hoaPattern.exec(text)) !== null) {
      const hoaStr = match[1]; const hoa = parseSparkHoA(hoaStr); const key = canonicalHoA(hoa);
      if (seen.has(key)) continue;
      seen.add(key);
      const slice = text.slice(match.index, match.index + 250);
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
      const parts = [match[1], match[2], match[3], match[4], match[5], match[6], match[7]];
      const hoaStr = parts.join(" "); const hoa = parseBimsHoA(hoaStr); const key = canonicalHoA(hoa);
      if (seen.has(key)) continue;
      seen.add(key);
      const slice = text.slice(match.index, match.index + 250);
      const netAmount = _extractAmountFromSlice(slice);
      results.push({ hoa, rawHoA: hoaStr, netAmount });
    }
    return results;
  }

  async function parsePdf(file) {
    const text = await extractPdfText(file);
    const billType = detectBillType(text);
    if (!billType) throw new Error(`Could not determine bill type from "${file.name}".`);

    let parsed, multiHoas;
    if (billType === "SPARK") {
      parsed = parseSparkBill(text); multiHoas = _extractMultipleHoAsFromSpark(text);
    } else {
      parsed = parseBimsBill(text); multiHoas = _extractMultipleHoAsFromBims(text);
    }

    if (!parsed) throw new Error(`Failed to extract required fields from "${file.name}".`);

    const baseRow = {
      billType: parsed.billType, billNo: parsed.billNo, sparkCode: parsed.sparkCode, 
      treasury: parsed.treasury, ddoCode: parsed.ddoCode, department: parsed.department, officeName: parsed.officeName,
      basicLess: parsed.basicLess, da: parsed.da, hra: parsed.hra, 
      cca: parsed.cca, otherAllowances: parsed.otherAllowances,
      encashmentDate: parsed.encashmentDate, remarks: parsed.remarks
    };

    if (multiHoas.length > 1) {
      return multiHoas.map(h => ({
        ...baseRow, netAmount: h.netAmount, rawHoA: h.rawHoA, canonicalHoA: canonicalHoA(h.hoa), ...h.hoa,
      }));
    }
    const hoa = parsed.hoa;
    return [{ ...baseRow, netAmount: parsed.netAmount, rawHoA: parsed.rawHoA, canonicalHoA: canonicalHoA(hoa), ...hoa }];
  }

  return { parsePdf, parseAmount, canonicalHoA, parseSparkHoA, parseBimsHoA, detectBillType };
})();