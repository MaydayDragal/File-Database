/* Toolbox — feature entry (REWRITE-PLAN.md Phase 4 / §3.1). */
import { mountInto, featureStyle } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";
import * as zip from "./tools/zip.js";
import * as media from "./tools/media.js";
import * as ocr from "./tools/ocr.js";
import * as convert from "./tools/convert.js";
import * as elec from "./tools/elec.js";
import * as text from "./tools/text.js";
import * as calc from "./tools/calc.js";
import * as csv from "./tools/csv.js";
import * as img from "./tools/img.js";
import * as pdf from "./tools/pdf.js";

// One folder per tool (D5); the order is the tab order.
const TOOLS = [zip, media, ocr, convert, elec, text, calc, csv, img, pdf];

export const route = { key: "toolbox", title: "Toolbox" };

export async function mount(host, shell) {
  const root = await mountInto(host, markup + TOOLS.map((t) => t.markup).join("\n"), featureStyle("toolbox"));
  TOOLS.forEach((t) => t.init(root));
  return start(root, host, shell);
}
