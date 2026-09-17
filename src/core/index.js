/*
 * src/core/index.js — the shared core as an ES module.
 *
 * The core modules are classic scripts on window.FDCore (every page loads
 * them first; the unit tests import them for their side effect). Features are
 * ES modules and import from here instead of reaching for the global.
 */
const core = globalThis.FDCore;
export const text = core.text;
export const ids = core.ids;
export const li = core.li;
export const vin = core.vin;
export const ro = core.ro;
export const hash = core.hash;
export const formats = core.formats;
export default core;
