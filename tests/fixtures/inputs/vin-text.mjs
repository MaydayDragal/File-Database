// Inputs for the VIN / FIN classifier golden (tests/fixtures/golden/vin.json).
//
// These are INPUTS only. The expected outputs are captured from the code by
// tools/capture-golden.mjs and committed; nothing here asserts a result. The
// VINs come from the comments in vault/app.js and the existing E2E fixtures.

const REAL = ["4JGFB4GB9SB387878", "W1KLF4HB1RA068698", "W1K2140471A068698", "W1NKM4GB9SF382775",
  "W1K6G6DB5NA078138", "WDD2050091R123456", "WDB2030461A654321", "WDC1660241A555777"];
const JUNK = ["FREEMAPUPDATES50A", "000000000000000ER", "000000000000000FR", "112600009311006RE",
  "W1TH0UTL1M1TAT10N", "DR1VEAPPL1CAT10NS", "1HGCM82633A004352" /* a Honda: not an MB WMI */];

export const VIN_CASES = [
  { id: "wmi-list", fn: "wmi", args: [] },
  ...REAL.map((v) => ({ id: "looks-real-" + v, fn: "looksLikeVin", args: [v] })),
  ...JUNK.map((v) => ({ id: "looks-junk-" + v, fn: "looksLikeVin", args: [v] })),
  { id: "looks-few-digits", fn: "looksLikeVin", args: ["WDBABCDEFGHJKLMNP"] },
  { id: "looks-all-digits-after-wmi", fn: "looksLikeVin", args: ["WDB12345678901234"] },
  { id: "looks-long-letter-run", fn: "looksLikeVin", args: ["WDBABCDEFG1234567"] },

  // Plain text, labelled and unlabelled.
  { id: "labelled-vin", fn: "findVinsDetailed", args: ["VIN: W1KLF4HB1RA068698 Model 214", false] },
  { id: "unlabelled-vin", fn: "findVinsDetailed", args: ["Vehicle W1NKM4GB9SF382775 in for service", false] },
  { id: "lowercase-input", fn: "findVinsDetailed", args: ["vin w1nkm4gb9sf382775", false] },
  { id: "datacard-vin-and-fin", fn: "findVinsDetailed",
    args: ["Datacard W1K2140471A068698\nVIN W1KLF4HB1RA068698\nModel series 214", false] },
  { id: "fin-label-german", fn: "findVinsDetailed", args: ["Fahrgestellnr. W1K2140471A068698", false] },
  { id: "fgstnr-label", fn: "findVinsDetailed", args: ["FgstNr W1K2140471A068698", false] },
  { id: "unlabelled-baumuster-alongside-vin", fn: "findVinsDetailed",
    args: ["W1K2140471A068698 and VIN W1KLF4HB1RA068698", false] },
  { id: "unlabelled-baumuster-alone", fn: "findVinsDetailed", args: ["W1K2140471A068698", false] },
  { id: "vin-label-wins-over-fin-label", fn: "findVinsDetailed",
    args: ["Datacard W1KLF4HB1RA068698 ... VIN W1KLF4HB1RA068698", false] },

  // The text layer splits VINs with spaces, sometimes one character per cell.
  { id: "split-once", fn: "findVinsDetailed", args: ["VIN W1KLF4HB1 RA068698", false] },
  { id: "split-per-char", fn: "findVinsDetailed", args: ["W 1 K L F 4 H B 1 R A 0 6 8 6 9 8", false] },
  { id: "split-too-wide", fn: "findVinsDetailed", args: ["W1KLF4HB1   RA068698", false] },
  { id: "nbsp-split", fn: "findVinsDetailed", args: ["VIN W1KLF4HB1 RA068698", false] },

  // Boundaries: a VIN embedded in a longer code is not a VIN.
  { id: "slice-of-longer-code", fn: "findVinsDetailed", args: ["XW1KLF4HB1RA068698Y", false] },
  { id: "digit-before", fn: "findVinsDetailed", args: ["9W1KLF4HB1RA068698", false] },
  { id: "punctuation-around", fn: "findVinsDetailed", args: ["(W1KLF4HB1RA068698),", false] },
  { id: "filename", fn: "findVinsDetailed", args: ["scco WDD2130461A123456.pdf", false] },

  // Junk that must not become a VIN.
  { id: "engine-number", fn: "findVinsDetailed", args: ["Engine 112600009311006RE", false] },
  { id: "blank-field", fn: "findVinsDetailed", args: ["000000000000000ER", false] },
  { id: "prose-lookalike", fn: "findVinsDetailed", args: ["free map updates 50A: FREEMAPUPDATES50A", false] },
  { id: "honda", fn: "findVinsDetailed", args: ["VIN 1HGCM82633A004352", false] },

  // OCR fuzzy mode: I/O/Q inside a run with >= 2 real digits are repaired; prose is not.
  { id: "fuzzy-off-misread", fn: "findVinsDetailed", args: ["VIN W1KLF4HB1RAO68698", false] },
  { id: "fuzzy-on-misread-O", fn: "findVinsDetailed", args: ["VIN W1KLF4HB1RAO68698", true] },
  { id: "fuzzy-on-misread-I-Q", fn: "findVinsDetailed", args: ["VIN WIKLF4HBIRAQ68698", true] },
  { id: "fuzzy-on-prose", fn: "findVinsDetailed", args: ["WITHOUT LIMITATION DRIVE APPLICATIONS", true] },
  { id: "fuzzy-on-prose-run", fn: "findVinsDetailed", args: ["W1TH0UTL1M1TAT10N", true] },
  { id: "fuzzy-on-real-untouched", fn: "findVinsDetailed", args: ["VIN W1NKM4GB9SF382775", true] },

  // Several vehicles in one file, duplicates, and the per-file cap.
  { id: "two-vehicles", fn: "findVinsDetailed",
    args: ["VIN W1NKM4GB9SF382775\nVIN W1K6G6DB5NA078138\nVIN W1NKM4GB9SF382775", false] },
  { id: "cap-per-file", fn: "findVins",
    args: [Array.from({ length: 40 }, (_, i) => "WDD2050091" + String(1000000 + i).slice(-7)).map((v) => "VIN " + v).join("\n"), false] },
  { id: "cap-per-file-count", fn: "findVins",
    args: [Array.from({ length: 5 }, (_, i) => "WDD2050091" + String(1000000 + i).slice(-7)).map((v) => "VIN " + v).join("\n"), false] },

  { id: "empty", fn: "findVinsDetailed", args: ["", false] },
  { id: "no-text", fn: "findVinsDetailed", args: [null, false] },
];
