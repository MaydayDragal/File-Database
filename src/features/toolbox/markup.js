/* Toolbox — the panel markup (what used to be the page's <body>; REWRITE-PLAN.md Phase 4). */
export default `
<div class="wrap">
  <div class="brand">
    <h1>🗜️ File Compressor</h1>
    <p>Local, private file tools — nothing is uploaded, everything runs in your browser.</p>
  </div>
  <div class="tabs" role="tablist">
    <button type="button" class="tab active" data-tab="zip">📦 Zip Splitter</button>
    <button type="button" class="tab" data-tab="media">🎬 Media Compressor</button>
    <button type="button" class="tab" data-tab="ocr">🔤 Image to Text (OCR)</button>
    <button type="button" class="tab" data-tab="convert">📐 Unit Converter</button>
    <button type="button" class="tab" data-tab="elec">⚡ Electrical</button>
    <button type="button" class="tab" data-tab="text">📝 Text</button>
    <button type="button" class="tab" data-tab="calc">🧮 Calculators</button>
    <button type="button" class="tab" data-tab="csv">📊 CSV Viewer</button>
    <button type="button" class="tab" data-tab="img">🖼️ Image Tools</button>
    <button type="button" class="tab" data-tab="pdf">📕 PDF Toolkit</button>
  </div>
</div>
`;
