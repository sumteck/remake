/**
 * parser.js  (v11 — Hybrid Extraction & Multi-Page Fault Tolerance Engine)
 * =========
 * Client-side PDF text extraction and bill data parsing for the Remake app.
 */

const TbrParser = (() => {

  // =========================================================================
  // STAGE 1 — PDF TEXT EXTRACTION WITH STRICT LINE PRESERVATION
  // =========================================================================

  function _sanitise(str) {
    if (!str) return "";
    return str
      .replace(/[_.]{2,}/g, " ")   // അനാവശ്യ വരകളും കുത്തുകളും മാറ്റുന്നു
      .replace(/\s{2,}/g, " ")     // അധിക സ്പേസുകൾ ഒഴിവാക്കുന്നു
      .trim();
  }

  /**
   * വരികളും അക്കങ്ങളും തെറ്റാതെ പേജ് സ്ട്രിങ്സ് ജനറേറ്റ് ചെയ്യുന്ന ഫംഗ്ഷൻ
   */
  function _assemblePageItems(items) {
    if (!items || items.length === 0) return "";

    // Y കോർഡിനേറ്റ് (മുകളിൽ നിന്ന് താഴേക്ക്), X കോർഡിനേറ്റ് (ഇടത്തുനിന്ന് വലത്തേക്ക്) സോർട്ട് ചെയ്യുന്നു
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
        result += "\n" + str; // പുതിയ വരി
      } else if (dX <= 2.5 || (/^\d+$/.test(prev.str.trim()) && /^\d+$/.test(str.trim()) && dX < 6)) {
        result += str; // നമ്പറുകൾ മുറിയാതെ ഒന്നിപ്പിക്കുന്നു
      } else {
        result += " " + str;
      }

      prev = item;
    }

    return result;
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
  // STAGE 4 — SPARK FIELD EXTRACTORS WITH REGEX LOOKAHEAD
  // =========================================================================

  function _extractTreasury(page1) {
    const m = page1.match(/Name\s+Of\s+Treasury\s*[:\-]\s*([^\n\r]+)/i);
    if (m) {
      // തൊട്ടടുത്ത് വരുന്ന വരികളിലെ ലേബലുകൾ കട്ട് ചെയ്ത് ട്രഷറി പേര് മാത്രം എടുക്കുന്നു
      return _sanitise(m[1].split(/(?:Computer|Token|Scroll|Dept|DDO|Date)/i)[0]);
    }
    return "";
  }

  function _extractDdoCode(page1) {
    const m = page1.match(/\b\d{4}-\d{3}-\d{3}\b/);
    if (m) return m[0].trim();
    const m2 = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9\-]+)/i);
    return m2 ? m2[1].trim() : "";
  }

  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) return m[1].trim().replace(/\s+/g, " ");
    return "";
  }

  function _extractSparkBillNo(page1, fullText) {
    const mLabel = page1.match(/Bill\s*(?:No|Number)\s*[:\-]\s*(\d+)/i);
    if (mLabel) return mLabel[1].trim();
    const mStandAlone = page1.match(/\b(266\d{5})\b/) || fullText.match(/\b(26\d{6})\b/);
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
  // STAGE 5 — HYBRID SALARY BREAKDOWN ENGINE (PAGES 1 & 3 HYBRID)
  // =========================================================================

  function _extractSalaryBreakdown(page1, page3, fullText) {
    const result = {
      pay: 0, da: 0, hra: 0, cca: 0,
      pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0,
    };

    // 1. ഗ്രോസ് സാലറി കണ്ടെത്തുന്നു
    let mGross = fullText.match(/(?:Total\s*A\s*Gross|Gross\s*Salary)[\s:]*([\d,]+(?:\.\d+)?)/i);
    if (mGross) result.grossAmount = parseAmount(mGross[1]);

    // 2. പേജ് 1-ലെ 'ABSTRACT OF THE BILL' കോഡ് ടേബിളിൽ നിന്നും കൃത്യമായി അലവൻസുകൾ എടുക്കുന്നു
    const linesP1 = page1.split('\n');
    linesP1.forEach(line => {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 2) {
        const textBlock = line.toLowerCase();
        // കോഡ് 01 അല്ലെങ്കിൽ Pay/LS/SP വരി കണ്ടെത്തി തുക സെറ്റ് ചെയ്യുന്നു
        if (textBlock.includes("pay/ls/") || (/^01\b/.test(line.trim()))) {
          const amt = line.match(/\b\d{4,8}\b/);
          if (amt) result.pay = parseAmount(amt[0]);
        }
        if (textBlock.includes("da/ada") || (/^22\b/.test(line.trim()))) {
          const amt = line.match(/\b\d{3,8}\b/);
          if (amt) result.da = parseAmount(amt[0]);
        }
        if (textBlock.includes("house rent") || (/^23\b/.test(line.trim()))) {
          const amt = line.match(/\b\d{3,8}\b/);
          if (amt) result.hra = parseAmount(amt[0]);
        }
        if (textBlock.includes("pg allowance") || (/^64\b/.test(line.trim()))) {
          const amt = line.match(/\b\d{2,8}\b/);
          if (amt) result.pgAllowance = parseAmount(amt[0]);
        }
        if (textBlock.includes("rural allowance") || (/^45\b/.test(line.trim()))) {
          const amt = line.match(/\b\d{2,8}\b/);
          if (amt) result.ruralAllowance = parseAmount(amt[0]);
        }
      }
    });

    // 3. പേജ് 3-ലെ ടേബിൾ വഴി ബാക്കപ്പ് പരിശോധന (കോളങ്ങൾ ഷിഫ്റ്റ് ആയാൽ പോലും തുക നഷ്ടപ്പെടില്ല)
    if (result.pay === 0 || result.da === 0) {
      const linesP3 = page3.split('\n');
      for (let line of linesP3) {
        if (/^Total\s+\d+/i.test(line.trim())) {
          const nums = line.match(/\d+/g).map(Number);
          if (nums.length >= 6) {
            // പേജ് 3 ടേബിളിലെ ഓർഡർ അനുസരിച്ച്
            result.pay = result.pay || nums[0] || nums[1]; // B Pay അല്ലെങ്കിൽ Basic Less OA
            result.da  = result.da  || nums[2];
            result.hra = result.hra || nums[3];
            result.cca = result.cca || nums[4];
          }
          break;
        }
      }
    }

    // 4. മറ്റ് അലവൻസുകൾ മാത്തമാറ്റിക്കലായി കണ്ടെത്തുന്നു
    const knownComponents = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
    if (result.grossAmount > knownComponents) {
      result.otherAllowance = result.grossAmount - knownComponents;
    }

    return result;
  }

  // =========================================================================
  // STAGE 6 — MAIN PROCESSORS
  // =========================================================================

  async function parseSparkBillFull(file) {
    const pages    = await extractPdfPages(file);
    const fullText = pages.join("\n");

    const page1 = pages[0] || "";
    const page2 = pages[1] || "";
    const page3 = pages[2] || page2 || fullText;
    const sanitizedFullText = _sanitise(fullText);

    const treasury   = _extractTreasury(page1);
    const ddoCode    = _extractDdoCode(page1);
    const sparkCode  = _extractSparkCode(sanitizedFullText);
    const billNo     = _extractSparkBillNo(page1, sanitizedFullText);
    const remarks    = _extractRemarks(sanitizedFullText);
    
    // പേജ് 1-ഉം പേജ് 3-ഉം ഒത്തുനോക്കി സാലറി കണ്ടെത്തുന്നു
    const salary     = _extractSalaryBreakdown(page1, page3, fullText);

    let department = "";
    const linesP3 = page3.split('\n').map(l => l.trim()).filter(Boolean);
    const govIdx = linesP3.findIndex(l => l.toUpperCase().includes("GOVERNMENT OF KERALA"));
    if (govIdx !== -1 && govIdx + 2 < linesP3.length) {
      department = linesP3[govIdx + 1];
    }

    const hoaMatch = sanitizedFullText.match(/(?<![0-9-])(\d{4}-\d{2}-\d{3}-\d{2}-\d{2}-\d{2}-\d{2})(?![0-9-])/);
    const hoa    = hoaMatch ? parseSparkHoA(hoaMatch[1]) : null;
    const rawHoA = hoaMatch ? hoaMatch[1] : "";

    return {
      billType:        "SPARK",
      billNo,
      treasury,
      sparkCode,
      department:      _sanitise(department) || "Indian Systems of Medicine",
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