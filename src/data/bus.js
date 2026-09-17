/*
 * bus.js — change events for the data layer: an EventTarget for this page
 * plus a BroadcastChannel("file-database") mirror, so every other tab and
 * every iframe on the origin hears the same "files:changed" a repo emits
 * after its transaction commits. This is all the old bridge's cross-tab
 * machinery was really for once hand-offs are function calls
 * (REWRITE-PLAN.md §3.2).
 *
 * emit(topic, detail)  — dispatch here and to other contexts (detail must
 *                        be structured-cloneable: ids, counts, plain objects)
 * on(topic, fn)        — fn(detail); detail.remote is true when it came from
 *                        another context. Returns the unsubscribe function.
 * Classic <script> (window.FDData.bus) and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var CHANNEL = "file-database";
  var target = new EventTarget();
  var bc = null;
  try { bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null; } catch (e) { bc = null; }
  // In Node the channel is a live handle; unref it so a test process exits.
  if (bc && typeof bc.unref === "function") { try { bc.unref(); } catch (e) {} }

  function dispatch(topic, detail) {
    var ev = new Event(topic);
    ev.detail = detail;
    try { target.dispatchEvent(ev); } catch (e) {}
  }
  function emit(topic, detail, opts) {
    detail = detail || {};
    dispatch(topic, detail);
    if (bc && !(opts && opts.local)) {
      try { bc.postMessage({ topic: topic, detail: detail }); } catch (e) {}
    }
  }
  function on(topic, fn) {
    var h = function (ev) { fn(ev.detail || {}); };
    target.addEventListener(topic, h);
    return function () { target.removeEventListener(topic, h); };
  }
  if (bc) {
    bc.onmessage = function (e) {
      var d = e && e.data;
      if (!d || typeof d.topic !== "string") return;
      dispatch(d.topic, Object.assign({}, d.detail || {}, { remote: true }));
    };
  }
  function close() { if (bc) { try { bc.close(); } catch (e) {} bc = null; } }

  var data = global.FDData = global.FDData || {};
  data.bus = { CHANNEL: CHANNEL, emit: emit, on: on, close: close };
})(typeof self !== "undefined" ? self : globalThis);
