/**
 * parser.js  (v6 — Full Spark Code Extraction & Coordinate Fix)
 * =========
 * Client-side PDF text extraction and bill data parsing.
 */

const TbrParser = (() => {

  // ── അലൈൻമെന്റ് തെറ്റാതെ PDF ടെക്സ്റ്റ് റീഡ് ചെയ്യാനുള്ള അഡ്വാൻസ്ഡ് ലോഗിൻ ────────────────────────
  async function extractPdfPages(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf   = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();

      // കോർഡിനേറ്റുകൾ അനുസരിച്ച് (Y മുകളിൽ നിന്ന് താഴേക്ക്, X ഇടത്തുനിന്ന് വലത്തേക്ക്) സോർട്ട് ചെയ്യുന്നു
      const items = content.items.slice().sort((a, b) => {
        const dy = b.transform[5] - a.transform[5];
        if (Math.abs(dy) > 4) return dy > 0 ? 1 : -1;
        return a.transform[4] - b.transform[4];
      });

      let pageStr = "";
      let lastItem = null;

      for (const item of items) {
        if (lastItem) {
          const dy = Math.abs(item.transform[5] - lastItem.transform[5]);
          const dx = item.transform[4] - (lastItem.transform[4] + lastItem.width);

          if (dy > 4) {
            pageStr += "\n";
          } else if (dx > 6) { // കോളം തിരിയുന്ന ഭാഗം
            pageStr += "  ";
          } else if (dx > 2) { // സാധാരണ സ്പേസ്
            pageStr += " ";
          }
          // dx <= 2 ആണെങ്കിൽ ബ്രോക്കൺ നമ്പറുകളെ ഇത് നേരിട്ട് കൂട്ടിച്ചേർക്കും (eg: 736 + 00 = 73600)
        }
        pageStr += item.str;
        lastItem = item;
      }
      pages.push(pageStr);
    }
    return pages;
  }

  async function extractPdfText(file) {
    const pages = await extractPdfPages(file);
    return pages.join("\n");
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

  function _extractTreasury(page1) {
    const m = page1.match(/Name\s+Of\s+Treasury\s*[:\-]\s*([^\n]+)/i);
    if (m) return m[1].replace(/\s{2,}.*$/, '').trim();
    return "";
  }

  function _extractDdoCode(page1) {
    const m = page1.match(/DDO\s*Code\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m) return m[1].trim();
    const m2 = page1.match(/\bDDO\s*[:\-]\s*([A-Z0-9][A-Z0-9\-\/]*)/i);
    if (m2) return m2[1].trim();
    return "";
  }

  // ഫുൾ സ്പാർക്ക് കോഡ് അതുപോലെ കൃത്യമായി എടുക്കുന്ന പുതുക്കിയ ലോഗിക്
  function _extractSparkCode(text) {
    const m = text.match(/Spark\s*Code\s*[:\-]?\s*([\d\s]+)/i);
    if (m) {
      return m[1].trim().replace(/\s{2,}/g, ' '); // മുഴുവൻ സ്പാർക്ക് കോഡും സ്പേസ് ക്രമീകരിച്ച് എടുക്കുന്നു
    }
    return "";
  }

  function _extractSparkBillNo(text) {
    let m = text.match(/Bill\s*(?:No|Number)\s*[.:\s]\s*(\d[\d\/\-]*\d|\d)(?=\s|$|\n)/i);
    if (m) return m[1].trim();
    m = text.match(/(\d[\d\-\/]*\d|\d)\s+Digitally\s+signed/i);
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

  function _extractDeptAndOffice(page1, page3) {
    let office = "";
    let department = "";

    const mOff = page1.match(/Name\s+of\s+Office\s*[:\-]\s*([^\n]+)/i);
    if (mOff) office = mOff[1].replace(/\s{2,}.*$/, '').trim();

    if (office) {
      const escapedOffice = office.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const deptRegex = new RegExp(`GOVERNMENT\\s+OF\\s+KERALA\\s*\\n\\s*([^\\n]+)\\s*\\n\\s*${escapedOffice}`, "i");
      const deptMatch = page3.match(deptRegex);
      if (deptMatch) department = deptMatch[1].trim();
    }
    return { department, office };
  }

  function _extractSalaryBreakdown(page3, fullText) {
    const result = { pay: 0, da: 0, hra: 0, cca: 0, pgAllowance: 0, ruralAllowance: 0, otherAllowance: 0, grossAmount: 0 };

    let mGross = fullText.match(/Total\s*A\s*Gross\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
    if (!mGross) mGross = page3.match(/Gross\s*Salary\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
    result.grossAmount = mGross ? parseAmount(mGross[1]) : 0;

    const lines = page3.split('\n');
    const totalLine = lines.find(l => l.match(/\bTotal\b\s+[\d,]+/i));

    if (totalLine) {
      const nums = [...totalLine.matchAll(/(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)]
                    .map(m => parseAmount(m[1]));

      if (nums.length >= 7) {
        // nums[0] ആയ B Pay/L.Sal ഇവിടെ സ്കിപ്പ് ചെയ്യപ്പെടുന്നു
        result.pay            = nums[1] || 0; // Basic Less OA/SA ലേക്ക് മാപ്പ് ചെയ്യുന്നു
        result.da             = nums[2] || 0;
        result.hra            = nums[3] || 0;
        result.cca            = nums[4] || 0;
        result.pgAllowance    = nums[5] || 0;
        result.ruralAllowance = nums[6] || 0;

        // ഗ്രോസ് സാലറിയിൽ നിന്നും ബാക്കി അലവൻസുകൾ കുറച്ച് Other Allowance കണ്ടെത്തുന്നു
        const totalSpecific = result.pay + result.da + result.hra + result.cca + result.pgAllowance + result.ruralAllowance;
        const diff = result.grossAmount - totalSpecific;
        result.otherAllowance = diff > 0 ? diff : 0;
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN SPARK PROCESSOR ──────────────────────────────────────────────────
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
  // ── BIMS PROCESSOR ─────────────────────────────────────────────────────────
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
    const hoa       = parts ? parseBimsHo