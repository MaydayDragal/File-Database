/*
 * bridge.js — shared transfer bus between File Vault and the LI Database.
 *
 * Both apps are served from the same origin, so they can share one small
 * IndexedDB ("vault-bridge") plus a BroadcastChannel. When one app wants to
 * hand a file to the other, it writes an entry to the bridge "outbox"
 * addressed to the target app and broadcasts a nudge. The target drains its
 * items — on load and whenever a nudge arrives — and deletes each once its
 * handler succeeds. Neither app needs to know the other's database schema.
 *
 * API (window.VaultBridge):
 *   send(target, {name, type, blob, meta})   -> Promise<void>
 *   receive(target, handler)                 -> registers handler(item)=>any|Promise
 *   drain(target)                            -> Promise<number>  (manual pump)
 * Targets: "vault" (File Vault) and "li" (LI Database).
 */
(function (global) {
  "use strict";

  var DB_NAME = "vault-bridge";
  var STORE = "outbox";
  var CHAN = "vault-bridge";
  var _db = null;
  var handlers = {};      // target -> handler
  var draining = {};      // target -> bool (guard against overlap)
  var bc = null;

  try { bc = ("BroadcastChannel" in global) ? new BroadcastChannel(CHAN) : null; } catch (e) { bc = null; }

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          os.createIndex("target", "target", { unique: false });
        }
      };
      r.onsuccess = function () { _db = r.result; resolve(_db); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function reqP(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function nowTs() { return (global.Date && Date.now) ? Date.now() : 0; }

  function send(target, payload) {
    if (!target || !payload || !payload.blob) return Promise.reject(new Error("bridge.send: target and blob required"));
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).add({
          target: target,
          name: payload.name || "file",
          type: payload.type || payload.blob.type || "application/octet-stream",
          blob: payload.blob,
          meta: payload.meta || {},
          ts: nowTs(),
        });
        t.oncomplete = function () {
          try { if (bc) bc.postMessage({ kind: "incoming", target: target }); } catch (e) {}
          resolve();
        };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // Drain every queued item for `target` through its registered handler.
  function drain(target) {
    var handler = handlers[target];
    if (!handler) return Promise.resolve(0);
    if (draining[target]) return Promise.resolve(0);
    draining[target] = true;
    return open().then(function (db) {
      // Snapshot the pending items first, then process outside the read tx.
      var idx = db.transaction(STORE, "readonly").objectStore(STORE).index("target");
      return reqP(idx.getAll(IDBKeyRange.only(target)));
    }).then(function (items) {
      var count = 0;
      var chain = Promise.resolve();
      items.forEach(function (item) {
        chain = chain.then(function () {
          return Promise.resolve(handler(item)).then(function () {
            count++;
            return open().then(function (db) {
              return new Promise(function (res) {
                var t = db.transaction(STORE, "readwrite");
                t.objectStore(STORE).delete(item.id);
                t.oncomplete = res; t.onerror = res;
              });
            });
          }, function (err) {
            // Leave the item in the outbox so a later attempt can retry it.
            try { console.warn("bridge: handler failed, keeping item", err); } catch (e) {}
          });
        });
      });
      return chain.then(function () { return count; });
    }).then(function (n) {
      draining[target] = false;
      return n;
    }, function (e) {
      draining[target] = false;
      throw e;
    });
  }

  function receive(target, handler) {
    handlers[target] = handler;
    // Drain anything already waiting, then keep listening for nudges.
    drain(target);
    return function unsubscribe() { if (handlers[target] === handler) delete handlers[target]; };
  }

  if (bc) {
    bc.onmessage = function (e) {
      var d = e.data || {};
      if (d.kind === "incoming" && handlers[d.target]) drain(d.target);
    };
  }
  // Fallback poll for browsers without BroadcastChannel (rare): light and cheap.
  if (!bc) {
    setInterval(function () {
      Object.keys(handlers).forEach(function (tgt) { drain(tgt); });
    }, 2500);
  }
  // Re-drain when a tab regains focus (covers cross-tab handoffs).
  global.addEventListener && global.addEventListener("focus", function () {
    Object.keys(handlers).forEach(function (tgt) { drain(tgt); });
  });

  global.VaultBridge = { send: send, receive: receive, drain: drain };
})(window);
