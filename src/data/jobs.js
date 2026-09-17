/*
 * jobs.js — long work that survives a reload (REWRITE-PLAN.md §4).
 *
 * A job is a row in the `jobs` store: { type, inputIds, meta, state
 * (queued / running / done / failed / cancelled), progress, attempts,
 * error }. Any page enqueues; a page that can do the work registers a
 * handler for the type and runs the queue — under navigator.locks where
 * available, so two tabs never run the same type at once. A handler that
 * rejects requeues the job (up to MAX_ATTEMPTS); a page that dies leaves a
 * running job whose heartbeat goes stale, and the next runner requeues it.
 *
 * Types today: "thumb", "vin-detect", "vin-scan" (the Files app),
 * "li-import" (LI Documents), "toolbox-intake" (the Toolbox).
 *
 * Classic <script> (window.FDData.jobs) and side-effect import from Node.
 * Requires db.js, bus.js and repos.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData;
  var db = data.db, bus = data.bus, repos = data.repos;
  var jobsRepo = repos.jobs;

  var MAX_ATTEMPTS = 5;
  var HEARTBEAT_MS = 10 * 1000;
  var STALE_MS = 90 * 1000;

  var owner = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var handlers = {};   // type -> handler(job, ctl)
  var running = {};    // type -> true while this page's loop for it runs
  var again = {};      // type -> true when a kick arrived mid-loop
  var cancelFlags = {}; // job id -> true
  var kickT = null;
  var now = function () { return Date.now(); };

  function enqueue(type, inputIds, meta) {
    var job = {
      id: repos.uid("j"), type: type, inputIds: (inputIds || []).slice(), meta: meta || {},
      state: "queued", progress: 0, note: "", attempts: 0, error: null, result: null,
      createdAt: now(), updatedAt: now(), startedAt: 0, finishedAt: 0, heartbeat: 0, owner: null,
    };
    return jobsRepo.put(job).then(function () {
      bus.emit("jobs:changed", { ids: [job.id], op: "enqueue", state: "queued", type: type });
      return job;
    });
  }
  function get(id) { return jobsRepo.get(id); }
  function listActive(type) {
    return Promise.all([jobsRepo.byState("queued"), jobsRepo.byState("running")]).then(function (r) {
      var all = r[0].concat(r[1]);
      return type ? all.filter(function (j) { return j.type === type; }) : all;
    });
  }
  function patch(id, fields) {
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").get(id)).then(function (j) {
        if (!j) return null;
        Object.assign(j, fields, { updatedAt: now(), rev: (j.rev || 0) + 1 });
        return api.req(api.store("jobs").put(j)).then(function () { return j; });
      });
    }).then(function (j) { if (j) bus.emit("jobs:changed", { ids: [id], op: "put", state: j.state, type: j.type }); return j; });
  }
  // Take the oldest queued job of a type, atomically.
  function claim(type) {
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").index("state").getAll("queued")).then(function (list) {
        var mine = list.filter(function (j) { return j.type === type; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
        var j = mine[0];
        if (!j) return null;
        j.state = "running"; j.owner = owner; j.attempts = (j.attempts || 0) + 1; j.heartbeat = now(); j.startedAt = now(); j.updatedAt = now(); j.rev = (j.rev || 0) + 1;
        return api.req(api.store("jobs").put(j)).then(function () { return j; });
      });
    }).then(function (j) { if (j) bus.emit("jobs:changed", { ids: [j.id], op: "put", state: "running", type: j.type }); return j; });
  }
  // Keep a running job's heartbeat fresh; reports its current state so a
  // handler can notice a cancel request from another tab.
  function heartbeat(id) {
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").get(id)).then(function (j) {
        if (!j) return null;
        if (j.state === "running") { j.heartbeat = now(); return api.req(api.store("jobs").put(j)).then(function () { return j.state; }); }
        return j.state;
      });
    });
  }
  function cancel(id) {
    cancelFlags[id] = true;
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").get(id)).then(function (j) {
        if (!j) return null;
        if (j.state === "queued") { j.state = "cancelled"; j.finishedAt = now(); }
        else if (j.state === "running") j.state = "cancelling";
        else return j;
        j.updatedAt = now(); j.rev = (j.rev || 0) + 1;
        return api.req(api.store("jobs").put(j)).then(function () { return j; });
      });
    }).then(function (j) { if (j) bus.emit("jobs:changed", { ids: [id], op: "cancel", state: j.state, type: j.type }); return j; });
  }
  // Running jobs nobody has touched for STALE_MS were left by a page that
  // died: put them back in the queue.
  function requeueStale() {
    var ids = [];
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").index("state").getAll("running")).then(function (list) {
        var cutoff = now() - STALE_MS;
        return Promise.all(list.filter(function (j) { return (j.heartbeat || 0) < cutoff; }).map(function (j) {
          j.state = j.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
          if (j.state === "failed") { j.error = j.error || "abandoned"; j.finishedAt = now(); }
          j.owner = null; j.updatedAt = now(); j.rev = (j.rev || 0) + 1;
          ids.push(j.id);
          return api.req(api.store("jobs").put(j));
        }));
      });
    }).then(function () { if (ids.length) bus.emit("jobs:changed", { ids: ids, op: "put" }); return ids.length; });
  }

  function withLock(name, fn) {
    var locks = null;
    try { locks = global.navigator && global.navigator.locks; } catch (e) {}
    if (locks && locks.request) {
      return locks.request(name, { ifAvailable: true }, function (lock) { return lock ? fn() : null; });
    }
    return fn();
  }
  function execute(job) {
    var handler = handlers[job.type];
    var ctl = {
      cancelled: function () { return !!cancelFlags[job.id]; },
      progress: function (p, note) { return patch(job.id, { progress: Math.max(0, Math.min(1, +p || 0)), note: note || "" }).catch(function () {}); },
    };
    var hb = setInterval(function () {
      heartbeat(job.id).then(function (st) { if (st === "cancelling" || st === "cancelled") cancelFlags[job.id] = true; }).catch(function () {});
    }, HEARTBEAT_MS);
    return Promise.resolve().then(function () { return handler(job, ctl); }).then(function (result) {
      clearInterval(hb);
      var cancelled = !!cancelFlags[job.id]; delete cancelFlags[job.id];
      return patch(job.id, { state: cancelled ? "cancelled" : "done", result: result === undefined ? null : result, progress: 1, error: null, owner: null, finishedAt: now() });
    }, function (err) {
      clearInterval(hb);
      var cancelled = !!cancelFlags[job.id]; delete cancelFlags[job.id];
      var msg = (err && err.message) || String(err);
      var retry = !cancelled && !(err && err.noRetry) && job.attempts < MAX_ATTEMPTS;
      return patch(job.id, { state: cancelled ? "cancelled" : (retry ? "queued" : "failed"), error: msg, owner: null, finishedAt: retry ? 0 : now() });
    });
  }
  function runType(type) {
    if (!handlers[type]) return Promise.resolve();
    if (running[type]) { again[type] = true; return Promise.resolve(); }
    running[type] = true;
    function loop() {
      return claim(type).then(function (job) {
        if (!job) return null;
        return execute(job).then(loop, loop);
      });
    }
    return withLock("fdb-job:" + type, loop).catch(function () {}).then(function () {
      running[type] = false;
      if (again[type]) { again[type] = false; return runType(type); }
    });
  }
  // Kicks are coalesced: several registrations or events in the same tick
  // start each named type once (an unnamed kick means every registered type).
  var pendingKick = null; // null = every type; otherwise a set of names
  function kick(types) {
    if (!types) pendingKick = null;
    else if (pendingKick !== null || kickT === null) { pendingKick = pendingKick || {}; types.forEach(function (t) { pendingKick[t] = true; }); }
    if (kickT) return;
    kickT = setTimeout(function () {
      kickT = null;
      var list = pendingKick ? Object.keys(pendingKick) : Object.keys(handlers);
      pendingKick = null;
      list.forEach(function (t) { runType(t); });
    }, 30);
  }
  // Run this page's handler for `types` until the queue drains, and again
  // on every new job, focus and cross-tab change.
  function register(types, handler) {
    types = [].concat(types);
    types.forEach(function (t) { handlers[t] = handler; });
    requeueStale().catch(function () {}).then(function () { kick(types); });
    return function () { types.forEach(function (t) { if (handlers[t] === handler) delete handlers[t]; }); };
  }
  function isTerminal(j) { return j && (j.state === "done" || j.state === "failed" || j.state === "cancelled"); }
  // Resolve with the job once it has finished; reject after timeoutMs.
  function whenDone(id, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var off = null, timer = null, done = false;
      function finish(j) { if (done) return; done = true; if (off) off(); clearTimeout(timer); resolve(j); }
      off = bus.on("jobs:changed", function (d) {
        if (!d.ids || d.ids.indexOf(id) === -1) return;
        get(id).then(function (j) { if (isTerminal(j)) finish(j); });
      });
      get(id).then(function (j) { if (!j) { done = true; off(); reject(new Error("no such job")); return; } if (isTerminal(j)) finish(j); });
      if (timeoutMs > 0) {
        timer = setTimeout(function () { if (done) return; done = true; off(); reject(new Error("timeout")); }, timeoutMs);
        if (timer.unref) timer.unref();
      }
    });
  }
  // Remove finished jobs older than a day so the store stays small.
  function sweep(maxAgeMs) {
    var cutoff = now() - (maxAgeMs || 24 * 60 * 60 * 1000), ids = [];
    return db.run(["jobs"], "readwrite", function (api) {
      return api.req(api.store("jobs").getAll()).then(function (list) {
        return Promise.all(list.filter(function (j) { return isTerminal(j) && (j.finishedAt || j.updatedAt || 0) < cutoff; }).map(function (j) { ids.push(j.id); return api.req(api.store("jobs").delete(j.id)); }));
      });
    }).then(function () { return ids.length; });
  }

  bus.on("jobs:changed", function (d) {
    if (d.op === "cancel" && d.ids) d.ids.forEach(function (id) { cancelFlags[id] = true; });
    if (d.op === "enqueue" || (d.op === "put" && (d.state === "queued" || !d.state))) kick();
  });
  try { global.addEventListener && global.addEventListener("focus", function () { kick(); }); } catch (e) {}

  data.jobs = {
    MAX_ATTEMPTS: MAX_ATTEMPTS, HEARTBEAT_MS: HEARTBEAT_MS, STALE_MS: STALE_MS, owner: owner,
    enqueue: enqueue, get: get, listActive: listActive, cancel: cancel, register: register, kick: kick,
    whenDone: whenDone, requeueStale: requeueStale, sweep: sweep, isTerminal: isTerminal,
  };
})(typeof self !== "undefined" ? self : globalThis);
