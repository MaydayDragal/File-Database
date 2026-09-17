// Inputs for the Repair Order scan golden (tests/fixtures/golden/ro-scan.json),
// and the raw texts tools/e2e-ro-scan.mjs drives the review with.
//
// INPUTS only — the expected outputs are captured from the code by
// tools/capture-golden.mjs. The texts are verbatim reads of real paperwork;
// see the comments on each.

export const VIN = "W1NKM4GB9SF382775";

// The dealer's printed RO, flattened the way OCR (or a PDF text layer) hands it
// over: labels and values on one row, line descriptions wrapping onto the next.
export const FORM_TEXT = [
  "RBM of Alpharetta",
  "345 McFarland Pkwy",
  "Alpharetta, GA 30004",
  "Options: DLR:17114",
  "Service Advisor: JOHNSON,BRANDON S L",
  "RO No: 935943",
  "Tag No: T7910",
  "RO Open Date: 08-31-26",
  "Mileage In: 15258",
  "Complete by Time: 08-31-26 18:00",
  "Pay Method: CASH",
  "Name: Jill Blue",
  "Address: 612 CASCADE WAY",
  "City-ST-Zip: CANTON, GA 30114",
  "Home Ph:",
  "Bus Ph:",
  "Cell Ph: 678-979-7260",
  "E-mail: jillblue628@gmail.com|HOME",
  "RO # 935943 Cust # 510459 Tag # T7910",
  "Year: 25",
  "Model: MERCEDES BENZ GLC300",
  "VIN: " + VIN,
  "Color: SILVER",
  "Prod Date: UPDATE!! Stock No: SellingDlr: 17114",
  "Warr Exp : Delivery : 01-01-25 In Service : 01-01-25",
  "LINE OP CODE INSTRUCTIONS AND DESCRIPTIONS",
  "# A MPI CC (INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT",
  "INSPECTION WHICH INCLUDES VIDEO",
  "# B CC RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER",
  "RECENT SERVICE; CHECK AND ADVISE",
  "# C CV CC COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -",
  "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT",
  "# D CW CC PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE",
  "$19.95 TO SERVICE DEPARTMENT",
  "TECH COPY MOBILE SHOP COPY",
].join("\n");

// A REAL read of that form, copied verbatim from a 300 dpi scan of the printed
// RO. This is what OCR actually hands over, and every way it differs from the
// tidy version above is a defect the parser has to survive: the two columns of
// the form flattened into each other, "Tag #T7910" read as "Tag #17910", the
// Year and Model labels lost entirely, "Color:" reduced to a "*", a digit
// clipped off the phone number, and the "# B"/"# C"/"# D" cells turned to noise.
export const REAL_SCAN = [
  "RBM",
  "",
  "Options: RO # 935943 éN",
  "es Cust # 510459",
  "",
  "Tag #17910 Mercedes-Benz",
  "",
  "of ALPHARETTA",
  "",
  "345 McFarland Pkwy",
  "Alpharetta, GA 30004",
  "",
  "Service Advisor:",
  "",
  "JOHNSON, BRANDON S L Name: : 25",
  "Jill Blue : MERCEDES BENZ GLC300",
  "",
  "TRONo: 935943 Address: 12 CASCADE WAY * WINKM4GB9SF382775",
  "Tag No: T7910 City-ST-Zip: CANTON, GA 30114 * SILVER",
  "RO Open Date: 08-31-26 Home Ph:",
  "Mileage In: 15258 Bus Ph: Prod Date: ppATE!",
  "Complete by Time: (08-31-26 18:00 Cell Ph: 78 979-7260 Mibanr Exp § Stock No:",
  "",
  "wary 01-05-95 hiiGiDiR",
  "Pay Method: CASH E-mail: jillblue628@gmail.com| HOME Delivery ¢ selinglic {71s",
  "In Service : 01-01-25",
  "",
  "ESTIMATE AND AUTHORIZATION | | INE | OP CODE INSTRUCTIONS AND DESCRIPTIONS",
  "",
  "Original Estimate: # A | MPI (INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT",
  "Client Advised of Completion ~~ INSPECTION WHICH INCLUDES VIDEO",
  "",
  "ph pn Ya RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER",
  "",
  "to be done along with the necessary RECENT SERVICE; CHECK AND ADVISE",
  "",
  "materials. I agree that RBM is not",
  "",
  "responsible for loss or damage to vehicle",
  "",
  "i sat tbc I HE COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -",
  "",
  "¥ ie HERRON 4 200 eS0OTAIR Bray CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT",
  "",
  "loss due to delays in returning my vehicle",
  "",
  "lieing] 0 fadibfaiis Riot, 888 | 0 PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGH",
  "",
  "roadtesting and/or inspection. An express = 19.95 TO SERVICE DEPARTMENT",
  "",
  "repairs of this work order.",
  "MOBILE SHOP COPY",
].join("\n");

// A second real scan, where the "Name:" label itself did not survive — the name
// beside it did. Also: the Year cell read as a bare "2", and the VIN row, the
// mileage and the open date dissolved altogether, so those stay empty.
export const REAL_SCAN_2 = [
  "REM",
  "RO # 934230 EN",
  "Cust # 501550",
  "Tag # T6885 Mercedes-Benz",
  "of ALPHARETTA",
  "345 McFarland Pkwy",
  "Alpharetta, GA 30004",
  "Service Advisor:",
  "COREY,JEFF L",
  "2",
  "Model: MERCEDES BENZ S500 4",
  "SEA DOMINON EXPRESS INC",
  "JUSTIN LEE",
  "oR i re jg sl vi esi",
  "Tag No: T6885 City-ST-Zip: JOHNS CREEK, GA 30022-7125\" in i, WHITE",
  "RO Open Date: Home Ph: / C 9% ne ee",
  "Mileage In: Bus Ph: 13",
  "Stock No:",
  "SellingDIr: 17114",
  "Warr Exp :",
  "Delivery : 01-01-22",
  "01-01-22",
  "INSTRUCTIONS AND DESCRIPTIONS",
  "Cell Ph: 567 455-3843",
  "E-mail: JUSTINWLEE89@GMAIL.COM | HOME",
  "In Service :",
].join("\n");

// The green-screen DISPATCH print-out, with a note stuck under it.
export const DISPATCH_TEXT = [
  "D I S P A T C H",
  "ESTIMATE: 245.00",
  "TAG:T7095 NAME: BURDETT,CARL SA: 5582 MAKE: M STATUS: AVL/VEH. DISABLE",
  "1) LOT LOC: PROMISED:17AUG26 1800 EST COMP:29AUG26 1012 P: 8999",
  "2) SDLR: Y APPT: N WAIT: N SPEC: N RENT: N VEH:26 E53E LIC: MI:1499",
  "3) RO: 934687 REMARKS:",
  "LC SKILL ST DESCRIPTION.. TECH... EST ACT LEFT STATUS.....CHG'D CBK HLD",
  "(A) (BC)(D) (E) (F) AT TME",
  "4) A P110 3R MPI-RBM OF AL 5401 0.2 PREASSIGNE 11:00",
  "5) B P110 3R CUSTOMER STAT 5401 1.0 5.5 -4.5 TECH HOLD 11:00 0.0",
  "6) C S181 7R COMPLIMENTARY 0.8 OPENED 10:42",
  "7) D S19 7M CLIENT DECLIN 0.5 OPENED 10:42",
  "END OF DISPLAY",
  "COMMAND:",
  "MBUX Display Goes Blank at times. Data line fault case?",
].join("\n");

// A worn 150 dpi copy that lost the small labels, so cells run into their
// neighbours' values.
export const BLEED_TEXT = [
  "RO Open Date: 08-31-26 678.979.7260 Color: SILVER",
  "Mileage In: 15258 jilblues28@amail com Stock No: SellingDir: 17114",
].join("\n");

// ---- rows as the OCR engine returns them (x0/x1 at 300 dpi) ----
const row = (text, x0, y0, w, h, conf = 90) => {
  let x = x0;
  const words = text.split(" ").filter(Boolean).map((t) => { const wx = x; x += t.length * 11 + 8; return { text: t, x0: wx, x1: x - 8, conf }; });
  return { text, x0, y0, x1: x0 + w, y1: y0 + h, words };
};
// One row holding the legal column, the LINE/OP cells and the description.
const merged = (legal, lx, mid, mx, desc, dx, y0, h, midConf) => {
  const words = [];
  const run = (s, from, conf) => { let x = from; s.split(" ").filter(Boolean).forEach((t) => { words.push({ text: t, x0: x, x1: x + t.length * 11, conf }); x += t.length * 11 + 8; }); return x; };
  run(legal, lx, 85);
  run(mid, mx, midConf == null ? 92 : midConf);
  const end = run(desc, dx, 90);
  return { text: [legal, mid, desc].filter(Boolean).join(" "), x0: lx, y0, x1: end, y1: y0 + h, words };
};
const wordsRow = (words, y0 = 100, y1 = 118) => ({
  text: words.map((w) => w[0]).join(" "), x0: words[0][1], x1: words[words.length - 1][2], y0, y1,
  words: words.map(([text, x0, x1]) => ({ text, x0, x1, conf: 90 })),
});
const HEADING = { text: "LINE OP CODE INSTRUCTIONS AND DESCRIPTIONS", x0: 630, y0: 529, x1: 1877, y1: 545, words: [
  { text: "LINE", x0: 630, x1: 678, conf: 95 }, { text: "OP", x0: 748, x1: 779, conf: 95 }, { text: "CODE", x0: 787, x1: 847, conf: 95 },
  { text: "INSTRUCTIONS", x0: 1483, x1: 1648, conf: 95 }, { text: "AND", x0: 1656, x1: 1705, conf: 95 }, { text: "DESCRIPTIONS", x0: 1714, x1: 1877, conf: 95 },
] };

// The two-column form, as the engine merges the columns into one row each.
const LAID_ROWS = [
  row("ESTIMATE AND AUTHORIZATION", 80, 500, 300, 18),
  HEADING,
  merged("Original Estimate:", 81, "# A | MPI", 602, "(INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 900, 572, 19),
  merged("Client Advised of Completion ~~", 81, "", 0, "INSPECTION WHICH INCLUDES VIDEO", 900, 600, 16),
  row("I hereby authorize the repair work set forth to be done", 81, 624, 560, 17),
  merged("materials. I agree that RBM is not", 81, "# B", 602, "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER", 900, 644, 19),
  merged("responsible for loss or damage to vehicle", 81, "", 0, "RECENT SERVICE; CHECK AND ADVISE", 900, 672, 16),
  row("or articles in the vehicle due to fire, theft,", 81, 696, 560, 17),
  merged("i sat tbc I HE", 81, "# C | CV", 602, "COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -", 900, 716, 19),
  merged("loss due to delays in returning my vehicle", 81, "", 0, "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT", 900, 744, 16),
  row("to me by the time specified. I authorize", 81, 768, 560, 17),
  merged("lieing] 0 fadibfaiis Riot, 888", 81, "# D | CW", 602, "PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE", 900, 788, 19),
  merged("roadtesting and/or inspection. An express =", 81, "", 0, "$19.95 TO SERVICE DEPARTMENT", 900, 816, 16),
  row("mechanic's lien is hereby acknowledged on this vehicle", 81, 840, 560, 17),
  row("TECH COPY MOBILE SHOP COPY", 80, 1003, 400, 13),
];
// The same table with the LINE / OP CODE cells read as noise.
const NOISY_ROWS = [
  HEADING,
  merged("Original Estimate:", 81, "# A MPI", 602, "(INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 900, 572, 19),
  merged("Client Advised of Completion", 81, "", 0, "INSPECTION WHICH INCLUDES VIDEO", 900, 600, 16),
  merged("ph pn", 81, "Ya", 700, "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER", 900, 644, 19, 46),
  merged("materials. I agree", 81, "", 0, "RECENT SERVICE; CHECK AND ADVISE", 900, 672, 16),
  merged("i sat tbc", 81, "I HE", 690, "COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -", 900, 716, 19, 51),
  merged("loss due to delays", 81, "", 0, "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT", 900, 744, 16),
  merged("lieing] 0", 81, "fadibfaiis Riot, 888", 640, "PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE", 900, 788, 19, 38),
  merged("roadtesting and/or", 81, "", 0, "$19.95 TO SERVICE DEPARTMENT", 900, 816, 16),
];
// A second real form: the heading read alone and centred over its column.
const CENTRED_ROWS = [
  row("INSTRUCTIONS AND DESCRIPTIONS", 1100, 500, 420, 16, 88),
  row("Original Estimate: 0. oo afar dl 7 O00 Tl a HE mer eR CUSTOMER STATES THAT THE BATTERY WARNING", 81, 560, 1800, 18, 88),
  row("Client Advised of Completion ~~~ LIGHT WAS ON 12 VOLT CRITICAL", 81, 586, 1800, 18, 88),
  row("I hereby authorize the repair work set forth", 81, 620, 560, 17, 88),
  row("CUSTOMER STATES THAT THE ENGINE LIGHT WAS ON, OFF", 640, 646, 1200, 18, 88),
  row("NOW", 640, 672, 90, 16, 88),
  row("materials. I agree that RBM is not", 81, 700, 560, 17, 88),
  row("COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 640, 726, 1200, 18, 88),
  row("INSPECTION WHICH INCLUDES VIDEO", 640, 752, 800, 16, 88),
  row("or articles in the vehicle due to fire, theft,", 81, 780, 560, 17, 88),
  row("CHARGH", 1850, 804, 90, 17, 88),
  row("PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH -", 640, 806, 1300, 18, 88),
  row("$19.95 TO SERVICE DEPARTMENT", 640, 832, 700, 16, 88),
];
// Header cells the whole-page read left empty (RO 934230).
const CELL_MILEAGE = wordsRow([["Mileage", 60, 150], ["In:", 155, 185], ["Bus", 520, 565], ["Ph:", 570, 600], ["13", 610, 635]]);
const CELL_OPENED = wordsRow([["RO", 60, 85], ["Open", 90, 140], ["Date:", 145, 195], ["Home", 520, 580], ["Ph:", 585, 615]]);
const CELL_FILLED = wordsRow([["Mileage", 60, 150], ["In:", 155, 185], ["66997", 200, 290], ["Bus", 520, 565], ["Ph:", 570, 600]]);
const CELL_NONE = wordsRow([["Mileage", 60, 150], ["In:", 155, 185], ["Bus", 190, 235], ["Ph:", 240, 270]]);
const MI = { $re: "\\bMileage\\s*(?:In)?\\s*", flags: "i" };
const OD = { $re: "\\b(?:R\\.?\\s?O\\.?\\s*)?Open\\s*Date\\s*", flags: "i" };
// Born-digital PDF text items.
const item = (str, x, y, width) => ({ str, width, transform: [10, 0, 0, 10, x, y] });
const PDF_ITEMS = [
  item("LINE", 630, 500, 40), item("OP", 700, 500, 22), item("CODE", 730, 500, 45),
  item("INSTRUCTIONS AND DESCRIPTIONS", 1000, 500, 300),
  item("A", 640, 480, 10), item("CV", 705, 480, 24), item("REPLACE BRAKE PADS", 800, 480, 190),
];
const sweepRow = (text, x0, x1, y0) => ({ text, x0, x1, y0, y1: y0 + 20, words: [] });

export const RO_CASES = [
  { id: "parse-form", fn: "parseScan", args: [FORM_TEXT] },
  { id: "parse-real-scan", fn: "parseScan", args: [REAL_SCAN] },
  { id: "parse-real-scan-2", fn: "parseScan", args: [REAL_SCAN_2] },
  { id: "parse-dispatch", fn: "parseScan", args: [DISPATCH_TEXT] },
  { id: "parse-bleed", fn: "parseScan", args: [BLEED_TEXT] },
  { id: "parse-empty", fn: "parseScan", args: [""] },
  { id: "parse-note-only", fn: "parseScan", args: ["MBUX display goes blank at times."] },
  { id: "parse-vin-hint-wins", fn: "parseScan", args: ["Tag No: T7910 VIN: W1NKMAGB9SF382775 Color: SILVER", null, { vin: "W1NKM4GB9SF382775" }] },
  { id: "parse-vin-hint-loses", fn: "parseScan", args: ["Tag No: T7910 VIN: W1NKM4GB9SF382775 Color: SILVER", null, { vin: "W1NKMAGB9SF382775" }] },
  { id: "parse-cell-hints-fill", fn: "parseScan", args: ["Mileage In: Bus Ph: 13\nRO Open Date: Home Ph: /", null, { mileage: "66997", opened: "08-12-26" }] },
  { id: "parse-cell-hints-keep", fn: "parseScan", args: ["Mileage In: 66997 Bus Ph:\nRO Open Date: 08-12-26 Home Ph:", null, { mileage: "13", opened: "01-01-22" }] },

  { id: "vincheck-real-1", fn: "vinCheckOk", args: ["W1NKM4GB9SF382775"] },
  { id: "vincheck-real-2", fn: "vinCheckOk", args: ["W1K6G6DB5NA078138"] },
  { id: "vincheck-real-3", fn: "vinCheckOk", args: ["4JGFB4GB9SB387878"] },
  { id: "vincheck-misread-4-as-A", fn: "vinCheckOk", args: ["W1NKMAGB9SF382775"] },
  { id: "vincheck-misread-9-as-0", fn: "vinCheckOk", args: ["W1NKM4GB0SF382775"] },
  { id: "vincheck-misread-both", fn: "vinCheckOk", args: ["W1NKMAGB1SF382775"] },
  { id: "vincheck-short", fn: "vinCheckOk", args: ["W1NKM4GB9SF38277"] },
  { id: "vincheck-lowercase", fn: "vinCheckOk", args: ["w1nkm4gb9sf382775"] },
  { id: "vincheck-empty", fn: "vinCheckOk", args: [""] },

  { id: "cellspan-mileage", fn: "cellSpan", args: [CELL_MILEAGE, MI] },
  { id: "cellspan-opened", fn: "cellSpan", args: [CELL_OPENED, OD] },
  { id: "cellspan-filled", fn: "cellSpan", args: [CELL_FILLED, MI] },
  { id: "cellspan-no-cell", fn: "cellSpan", args: [CELL_NONE, MI] },
  { id: "cellspan-absent-label", fn: "cellSpan", args: [CELL_MILEAGE, OD] },

  { id: "sweep-header-rows", fn: "sweepRows", args: [{ width: 2550, height: 3300 }, [
    sweepRow("oR i re jg sl vi esi", 300, 1400, 600),
    sweepRow("short", 300, 360, 700),
    sweepRow("Tag No: T6885 City-ST-Zip: JOHNS CREEK", 300, 1800, 800),
    sweepRow("INSTRUCTIONS AND DESCRIPTIONS", 300, 1900, 2500),
  ]] },

  { id: "layout-merged-columns", fn: "layoutLines", args: [LAID_ROWS] },
  { id: "layout-noisy-op-cells", fn: "layoutLines", args: [NOISY_ROWS] },
  { id: "layout-centred-heading", fn: "layoutLines", args: [CENTRED_ROWS] },
  { id: "layout-too-few-rows", fn: "layoutLines", args: [[HEADING]] },
  { id: "layout-no-heading", fn: "layoutLines", args: [LAID_ROWS.filter((r) => r !== HEADING)] },

  { id: "itemsToRows-pdf-text-layer", fn: "itemsToRows", args: [PDF_ITEMS] },
  { id: "itemsToRows-empty", fn: "itemsToRows", args: [[]] },
];
