/**
 * parser.js  (v8 — Production-Grade Resilient Coordinate-Line Parser)
 * =========
 * Client-side PDF text extraction and bill data parsing with line reassembly.
 */

const TbrParser = (() => {

  // ── പിഡിഎഫിലെ വരികളും അക്കങ്ങളും മുറിയാതെ കൃത്യമായി റീഡ് ചെയ്യാനുള്ള ലോഗിക് ────────────────
  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let fullText = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      
      // വരികളെ വൈ-അച്ചുതണ്ട് (Y-Coordinate) അടിസ്ഥാനമാക്കി ഗ്രൂപ്പ് ചെയ്യുന്നു (4px threshold)
      const linesMap = {};
      for (const item of content.items) {
        if (!item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        
        let foundY = Object.keys(linesMap).find(existingY => Math.abs(existingY - y) <= 4);
        if (!foundY) {
          foundY = y;
          linesMap[foundY] = [];
        }
        linesMap[foundY].push(item);
      }

      // മുകളിൽ നിന്നും താഴേക്ക് വരികൾ സോർട്ട് ചെയ്യുന്നു
      const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a);
      let pageText = "";

      for (const y of sortedY) {
        // ഇടത്തുനിന്നും വലത്തേക്ക് വരിയിലെ അക്ഷരങ്ങൾ സോർട്ട് ചെയ്യുന്നു (X-Coordinate)
        const lineItems = linesMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
        let lineStr = "";
        let prevItem = null;

        for (const item of lineItems) {
          if (prevItem) {
            const prevX = prevItem.transform[4];
            const prevWidth = prevItem.width || 0;
            const currX = item.transform[4];
            const gap = currX - (prevX + prevWidth);

            // ഗ്യാപ്പ് 3 പിക്സലിൽ കൂടുതൽ ഉണ്ടെങ്കിൽ മാത്രം സ്പേസ് നൽകുന്നു (വാക്കുകൾ ഒട്ടിപ്പോകാതിരിക്കാൻ)
            if (gap > 3) {
              lineStr += " ";
            }
          }
          lineStr += item.str;
          prevItem = item;
        }
        if (lineStr.trim()) {
          pageText += lineStr + "\n";
        }
      }
      fullText += pageText + "\n";
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
    // Standalone അല്ലെങ്കിൽ ലേബൽ ഉള്ള 3-പാർട്ട് ഡി.ഡി.ഓ കോഡ് കണ്ടെത്തുന്നു (eg: 1503-320-105)
    const m = text.match(/\b\d{4}-\d{3}-\d{3}\b/);
    if (m) return m[0].trim();
    const m2 = text.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9\-]+)/i);
    if (m2) return m2[1].trim();
    return "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) {
      const code = m[1].trim().replace(/\s+/g, ' ');
      if (code.replace(/\s/g, '').length >= 10) return code;
    }
    return "";
  }

  function _extractSparkBillNo(text) {
    const m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d+)/i);
    if (m) return m[1].trim();
    const m2 = text.match(/(\d+)\s+Digitally\s+signed/i);
    if (m2) return m2[1].trim();
    return "";
  }

  function _extractRemarks(text) {
    const m = text.match(/(?:SDO\s+Bill\s+)?FOR\s+([A-Za-z]+\s+\d{4})/i);
    if (m) return m[1].trim();
    return "";
  }

  function _extractSalaryBreakdown(lines, grossAmount) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: grossAmount };

    // കറക്റ്റ് അലവൻസ് നമ്പറുകൾ ഉള്ള പ്രധാന 'Total' വരി കണ്ടെത്തുന്നു
    const totalLine = lines.find(l => l.match(/^Total\s+\d+/i));
    if (totalLine) {
      const nums = totalLine.match(/\d+/g).map(Number);
      
      if (nums.length >= 8) {
        result.pay            = nums[1] || 0; // Basic Less OA/SA ലേക്ക് കൃത്യമായി മാപ്പ് ചെയ്യുന്നു
        result.da             = nums[2] || 0;
        result.hra            = nums[3] || 0;
        result.cca            = nums[4] || 0;
        result.pgAllowance    = nums[5] || 0;
        result.ruralAllowance = nums[6] || 0;

        if (result.grossAmount === 0 && nums[7]) {
          result.grossAmount = nums[7];
        }

        // ബാക്കി വരുന്ന എല്ലാ തുകയും Other Allowance ലേക്ക് ഓട്ടോ കാൽക്കുലേറ്റ് ചെയ്യുന്നു
        const specificSum = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
        const diff = result.grossAmount - specificSum;
        result.otherAllowance = diff > 0 ? diff : 0;
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN PROCESSORS ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  async function parseSparkBillFull(file) {
    const fullText = await extractPdfText(file);
    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

    const treasury   = _extractTreasury(fullText);
    const ddoCode    = _extractDdoCode(fullText);
    const sparkCode  = _extractSparkCode(fullText);
    const billNo     = _extractSparkBillNo(fullText);
    const remarks    = _extractRemarks(fullText);
    
    // ഡിപ്പാർട്ട്മെന്റ് & ഓഫീസ് വരികൾ കണ്ടെത്തുന്നു
    let department = "";
    let office = "";
    const govIdx = lines.findIndex(l => l.toUpperCase().includes("GOVERNMENT OF KERALA"));
    if (govIdx !== -1 && govIdx + 2 < lines.length) {
      department = lines[govIdx + 1];
      office = lines[govIdx + 2];
    }

    let mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:]*([\d,]+(?:\.\d+)?)/i);
    const grossAmount = mGross ? parseAmount(mGross[1]) : 0;

    const salary = _extractSalaryBreakdown(lines, grossAmount);

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