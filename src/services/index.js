/*
 * src/services/index.js — the shared services as an ES module (see
 * core/index.js). Everything is window.FDServices underneath.
 */
const services = globalThis.FDServices;
export const vendor = services.vendor;
export const pdf = services.pdf;
export const tess = services.tess;
export const ocrPool = services.ocrPool;
export const thumbs = services.thumbs;
export const folderSync = services.folderSync;
export default services;
