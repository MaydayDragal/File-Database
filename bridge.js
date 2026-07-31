/*
 * bridge.js — shared transfer bus between File Vault, LI Database and Toolbox.
 *
 * All apps are served from the same origin, so they share one small IndexedDB
 * ("vault-bridge") plus a BroadcastChannel. When one app hands a file to
 * another it writes an entry to the "outbox" addressed to the target app and
 * broadcasts a nudge. The target drains its items — on load, on a nudge, on
 * focus — running its handler for each.
 *
 * DURABLE DELIVERY (v2): an item is NOT removed when claimed. A claim takes a
 * time-limited LEASE (a unique token + timestamp); the item is deleted only
 * after the handler's returned promise SETTLES successfully. If the handler
 * rejects, or the claiming page dies before it settles (its lease expires),
 * the item returns to "pending" and another drain re-delivers it. While a
 * lease is valid, no other drain re-processes the same item, so two live
 * receivers process an item exactly once. This gives at-least-once delivery
 * with duplicate suppression.
 *
 * API (window.VaultBridge):
 *   send(target, {name, type, blob, meta})   -> Promise<void>
 *   receive(target, handler)                 -> handler(item)=>any|Promise;
 *                                               item acked only after it settles
 *   drain(target)                            -> Promise<number>  (manual pump)
 * Targets: "vault" (File Vault), "li" (LI Database) and "toolbox".
 */
(function (global) {
  "use strict";

  var DB_NAME = "vault-bridge";
  var DB_VERSION = 2;
  var STORE = "outbox";
  var CHAN = "vault-bridge";
  var _db = null;
  var handlers = {};      // target -> handler
  var draining = {};      // target -> bool (guard against overlapping drains)
  var _tok = 0;
  var bc = null;

  try { bc = ("BroadcastChannel" in global) ? new BroadcastChannel(CHAN) : null; } catch (e) { bc = null; }

  function nowTs() { return (global.Date && Date.now) ? Date.now() : 0; }
  // Claim lease length. Overridable (tests use a short lease); defaults 5 min.
  function leaseMs() { var v = global.__BRIDGE_LEASE_MS | 0; return v > 0 ? v : 5 * 60 * 1000; }
  function newToken() { return "c" + nowTs() + "-" + (++_tok) + "-" + Math.floor((global.Math ? Math.random() : 0) * 1e9); }
  // A row is takeable if it's pending, or processing under an expired lease
  // (its claimant died before finishing).
  function claimable(row, now) {
    return row && (row.status === "pending" || row.status === undefined ||
      (row.status === "processing" && (now - (row.claimedAt || 0)) > leaseMs()));
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function (e) {
        var db = r.result, os;
        if (!db.objectStoreNames.contains(STORE)) {
          os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          os.createIndex("target", "target", { unique: false });
        } else {
          os = r.transaction.objectStore(STORE);
        }
        if (!os.indexNames.contains("status")) os.createIndex("status", "status", { unique: false });
        // Backfill delivery fields onto rows written by the v1 schema, without
        // deleting them, so an in-flight migration loses nothing.
        if (e.oldVersion < 2) {
          var cur = os.openCursor();
          cur.onsuccess = function () {
            var c = cur.result; if (!c) return;
            var v = c.value;
            if (v.status === undefined) { v.status = "pending"; v.attempts = v.attempts || 0; v.claimToken = null; v.claimedAt = 0; c.update(v); }
            c.continue();
          };
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
          status: "pending",
          attempts: 0,
          claimToken: null,
          claimedAt: 0,
        });
        t.oncomplete = function () {
          try { if (bc) bc.postMessage({ kind: "incoming", target: target }); } catch (e) {}
          // BroadcastChannel doesn't deliver to the posting page, so if this
          // same page also handles the target (rare, but possible), drain here.
          if (handlers[target]) global.setTimeout(function () { drain(target); }, 0);
          resolve();
        };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // Atomically take a lease on one row. IndexedDB serializes readwrite
  // transactions per store, so racing instances can't both win: the second to
  // run sees status "processing" with a fresh lease and backs off. Returns the
  // claimed row (carrying its claimToken) or null.
  function claim(id) {
    return open().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, "readwrite");
        var os = t.objectStore(STORE);
        var claimed = null;
        var g = os.get(id);
        g.onsuccess = function () {
          var row = g.result, now = nowTs();
          if (claimable(row, now)) {
            row.status = "processing";
            row.claimToken = newToken();
            row.claimedAt = now;
            os.put(row);
            claimed = row;
          }
        };
        t.oncomplete = function () { resolve(claimed); };
        t.onerror = function () { resolve(null); };
        t.onabort = function () { resolve(null); };
      });
    });
  }
  // Delete the row — but only if this lease still owns it.
  function complete(id, tok) {
    return open().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction(STORE, "readwrite");
        var os = t.objectStore(STORE);
        var g = os.get(id);
        g.onsuccess = function () { if (g.result && g.result.claimToken === tok) os.delete(id); };
        t.oncomplete = res; t.onerror = res; t.onabort = res;
      });
    });
  }
  // Return the row to pending for another attempt (lease still owned by us).
  function retry(id, tok) {
    return open().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction(STORE, "readwrite");
        var os = t.objectStore(STORE);
        var g = os.get(id);
        g.onsuccess = function () {
          var row = g.result;
          if (row && row.claimToken === tok) { row.status = "pending"; row.claimToken = null; row.attempts = (row.attempts || 0) + 1; os.put(row); }
        };
        t.oncomplete = res; t.onerror = res; t.onabort = res;
      });
    });
  }
  // Extend our lease while a slow handler is still running.
  function renew(id, tok) {
    return open().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction(STORE, "readwrite");
        var os = t.objectStore(STORE);
        var g = os.get(id);
        var ok = false;
        g.onsuccess = function () { var row = g.result; if (row && row.claimToken === tok) { row.claimedAt = nowTs(); os.put(row); ok = true; } };
        t.oncomplete = function () { res(ok); }; t.onerror = function () { res(false); }; t.onabort = function () { res(false); };
      });
    });
  }

  function pendingIds(target) {
    return open().then(function (db) {
      var idx = db.transaction(STORE, "readonly").objectStore(STORE).index("target");
      return reqP(idx.getAll(IDBKeyRange.only(target)));
    });
  }

  // Drain queued items for `target` through its handler, one at a time.
  function drain(target) {
    var handler = handlers[target];
    if (!handler) return Promise.resolve(0);
    if (draining[target]) return Promise.resolve(0);
    draining[target] = true;
    var attempted = {};    // ids seen in this pass (to detect NEW arrivals after)
    return pendingIds(target).then(function (items) {
      var count = 0;
      var chain = Promise.resolve();
      items.forEach(function (item) {
        chain = chain.then(function () {
          attempted[item.id] = 1;
          return claim(item.id).then(function (row) {
            if (!row) return; // taken by another live instance, or lease active
            var tok = row.claimToken;
            // Keep the lease alive across a slow handler.
            var timer = global.setInterval(function () { renew(item.id, tok); }, Math.max(1000, leaseMs() / 2));
            return Promise.resolve().then(function () { return handler(row); }).then(function () {
              global.clearInterval(timer);
              return complete(item.id, tok).then(function () { count++; });
            }, function (err) {
              global.clearInterval(timer);
              try { console.warn("bridge: handler failed, will retry", err); } catch (e) {}
              return retry(item.id, tok).then(function () { scheduleRetry(target, (row.attempts || 0) + 1); });
            });
          });
        });
      });
      return chain.then(function () { return count; });
    }).then(function (n) {
      draining[target] = false;
      // If NEW work arrived while we were draining (an id not in this pass),
      // start another drain immediately — a busy drain must not strand a later
      // item until the next external nudge.
      return pendingIds(target).then(function (rows) {
        var now = nowTs();
        var fresh = rows.some(function (r) { return !attempted[r.id] && claimable(r, now); });
        if (fresh) global.setTimeout(function () { drain(target); }, 0);
        return n;
      });
    }, function (e) {
      draining[target] = false;
      throw e;
    });
  }

  // A failed item is pending again; re-drain after a backoff so it's eventually
  // delivered even in a single page (a BroadcastChannel nudge isn't delivered
  // to the tab that posted it). Backoff grows with attempts; capped so a poison
  // item can't hot-loop, after which it waits for a focus/nudge/reload.
  function scheduleRetry(target, attempts) {
    if (attempts > 12) return;
    var delay = Math.min(8000, 200 * attempts);
    global.setTimeout(function () { drain(target); }, delay);
  }

  function receive(target, handler) {
    handlers[target] = handler;
    drain(target); // sweep anything already waiting
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
  // Re-drain when a tab regains focus — covers cross-tab handoffs and picking
  // up items whose previous claimant died (expired leases).
  global.addEventListener && global.addEventListener("focus", function () {
    Object.keys(handlers).forEach(function (tgt) { drain(tgt); });
  });

  global.VaultBridge = { send: send, receive: receive, drain: drain };
})(window);
