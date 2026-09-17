/*
 * src/data/index.js — the data layer as an ES module (see core/index.js).
 * Everything is window.FDData underneath; features import from here.
 */
const data = globalThis.FDData;
export const db = data.db;
export const bus = data.bus;
export const repos = data.repos;
export const jobs = data.jobs;
export const intake = data.intake;
export const backup = data.backup;
export const migrate = data.migrate;
export const boot = (opts) => data.boot(opts);
export default data;
