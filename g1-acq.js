/* Google One combined 2TB / 20TB / 30TB mappings for Shadowrocket. */
"use strict";

(function () {
  var VERSION = "g1-acq-v7.5";
  var SOURCE_PREFIX = "g1.ios.2tb.";
  function buildEftList(size, headTargets) {
    return (headTargets || []).concat([
      "g1." + size + ".ai.18months_eft",
      "g1." + size + ".ai.15months_eft",
      "g1." + size + ".ai.12months_eft",
      "g1.ios." + size + ".ai.12months_eft",
      "g1.play." + size + ".ai.12months_eft",
      "g1.ios." + size + ".ai.eft-12mo",
      "g1.play." + size + ".ai.eft-12mo",
      "g1." + size + ".ai.6months_eft",
      "g1.ios." + size + ".ai.eft-3mo",
      "g1.play." + size + ".ai.eft-3mo"
    ]);
  }
  function makeTier(id, prefix, key, headTargets, legacyTargets) {
    var eftList = buildEftList(id, headTargets);
    return {
      id: id,
      prefix: prefix,
      key: key,
      eftCount: eftList.length,
      candidates: eftList.concat(legacyTargets)
    };
  }
  var TIERS = [
    makeTier("2tb", "g1.ios.2tb.", "g1.2tb.target.index.v1", [], ["g1.2tb.ai.annual"]),
    makeTier("20tb", "g1.ios.20tb.", "g1.20tb.target.index.v1",
      ["g1.ai.ultra.1month_eft.acq"],
      ["g1.20tb.3months_ip_90p.acq", "g1.20tb.3months_ip_75p.acq"]),
    makeTier("30tb", "g1.ios.30tb.", "g1.30tb.target.index.v1",
      ["g1.ai.ultra.1month_eft.acq"],
      ["g1.ai.ultra.3months_ip_90p.acq", "g1.ai.ultra.3months_ip_75p.acq"])
  ];
  TIERS.forEach(function (tier) {
    var idx = 0;
    try {
      if (typeof $persistentStore !== "undefined" && typeof $persistentStore.read === "function") {
        var savedIdx = parseInt($persistentStore.read(tier.key), 10);
        if (isFinite(savedIdx) && savedIdx >= 0 && savedIdx < tier.candidates.length) {
          idx = savedIdx;
        }
      }
    } catch (error) {
      idx = 0;
    }
    tier.selectedIndex = idx;
    tier.target = tier.candidates[idx];
    tier.hits = 0;
  });
  var TEST_KEY = "g1.pro.annual.test.v1";
  var SCAN_KEY = "g1.sku.scan.v1";
  var SCAN_LIMIT = 300;
  var url = typeof $request === "object" && $request ? $request.url : "";

  if (typeof url !== "string" || !/^https:\/\/one\.google\.com\//.test(url) ||
      /^https:\/\/one\.google\.com\/g1-sku-report\/?(?:\?|$)/.test(url)) {
    $done({});
    return;
  }

  var body = typeof $response === "object" && $response ? $response.body : undefined;
  if (typeof body === "string") {
    try {
      collectOriginalSkus(body);
    } catch (error) {
      console.log("[g1-acq] SKU collection unavailable");
    }
  }

  if (!/^https:\/\/one\.google\.com\/ai\?/.test(url)) {
    $done({});
    return;
  }

  var mappings = Object.create(null);
  var hits = 0;
  var annualHits = 0;
  var out = body;

  if (typeof body === "string") {
    // Within the active group (EFT 0..9 vs legacy 10+), pick the highest-priority candidate
    // observed in the original body so legacy .acq tokens in body don't hijack EFT testing,
    // while still preserving 90p -> 75p fallback when a legacy target is selected.
    TIERS.forEach(function (tier) {
      var scanEnd = tier.selectedIndex < tier.eftCount ? tier.eftCount : tier.candidates.length;
      for (var ti = tier.selectedIndex; ti < scanEnd; ti++) {
        if (body.indexOf(tier.candidates[ti]) !== -1) {
          tier.target = tier.candidates[ti];
          break;
        }
      }
    });
    // Match complete tokens before selecting 2TB / 20TB / 30TB prefixes.
    out = body.replace(
      /(^|[^A-Za-z0-9._@%-])(g1\.[A-Za-z0-9._-]+)(?=$|[^A-Za-z0-9._-])/g,
      function (match, before, id) {
        var matchedTier = null;
        for (var i = 0; i < TIERS.length; i++) {
          if (id.indexOf(TIERS[i].prefix) === 0 && id.length > TIERS[i].prefix.length) {
            matchedTier = TIERS[i];
            break;
          }
        }
        if (!matchedTier) {
          return match;
        }
        var to = matchedTier.target;
        var fallback = to !== matchedTier.candidates[0];
        if (!mappings[id]) mappings[id] = { id: id, to: to, count: 0, fallback: fallback };
        mappings[id].count += 1;
        hits += 1;
        matchedTier.hits += 1;
        if (matchedTier.id === "2tb") annualHits += 1;
        return before + to;
      }
    );
  }

  var sources = Object.keys(mappings).sort().map(function (id) {
    return mappings[id];
  });
  var targetsMap = {};
  var tierHitsMap = {};
  TIERS.forEach(function (tier) {
    targetsMap[tier.id] = tier.target;
    tierHitsMap[tier.id] = tier.hits;
  });
  var record = {
    schemaVersion: 1,
    version: VERSION,
    updatedAt: new Date().toISOString(),
    sourcePrefix: SOURCE_PREFIX,
    target: TIERS[0].target,
    targets: targetsMap,
    tierHits: tierHitsMap,
    hitCount: hits,
    annualHitCount: annualHits,
    matchedFrom: sources,
    status: typeof body !== "string" ? "non-text" : hits ? "rewritten" : "no-match"
  };

  try {
    if (typeof $persistentStore !== "undefined" &&
        typeof $persistentStore.write === "function") {
      if (!$persistentStore.write(JSON.stringify(record), TEST_KEY)) {
        console.log("[g1-acq] local record write failed");
      }
    }
  } catch (error) {
    console.log("[g1-acq] local record unavailable");
  }

  console.log("[g1-acq] " + VERSION + " hits=" + hits +
    " 2tb=" + tierHitsMap["2tb"] + " 20tb=" + tierHitsMap["20tb"] + " 30tb=" + tierHitsMap["30tb"]);
  sources.forEach(function (source) {
    console.log("[g1-acq] " + source.id + " -> " + source.to + " x" + source.count +
      (source.fallback ? " fallback=yes" : ""));
  });
  $done(hits ? { body: out } : {});

  function collectOriginalSkus(originalBody) {
    var now = new Date().toISOString();
    var saved = {};
    try {
      if (typeof $persistentStore !== "undefined" && typeof $persistentStore.read === "function") {
        saved = JSON.parse($persistentStore.read(SCAN_KEY) || "{}");
      }
    } catch (error) {
      saved = {};
    }
    if (!saved || saved.schemaVersion !== 1) saved = {};

    var byId = Object.create(null);
    var ids = [];
    var validId = /^(?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]{1,160}$/;
    var oldRows = Array.isArray(saved.skus) ? saved.skus : [];
    oldRows.slice(0, SCAN_LIMIT).forEach(function (row) {
      if (!row || typeof row.id !== "string" || !validId.test(row.id) || byId[row.id]) return;
      var count = Number(row.count);
      byId[row.id] = {
        id: row.id,
        count: isFinite(count) && count > 0 ? Math.floor(count) : 0,
        lastSeen: typeof row.lastSeen === "string" ? row.lastSeen.slice(0, 32) : ""
      };
      ids.push(row.id);
    });

    // Decode escaped dots on a discovery copy before rewriting the original body.
    var text = originalBody.replace(/\\u002e|\\x2e|&#0*46;|&#x0*2e;|&period;/gi, ".");
    var token = /(^|[^A-Za-z0-9._@%-])((?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]+)(?=$|[^A-Za-z0-9._-])/g;
    var match;
    var found = Object.create(null);
    var hitCount = 0;
    var truncated = saved.truncated === true;
    while ((match = token.exec(text)) !== null) {
      var id = match[2];
      if (!validId.test(id)) continue;
      found[id] = (found[id] || 0) + 1;
      hitCount += 1;
      if (!byId[id]) {
        if (ids.length >= SCAN_LIMIT) {
          truncated = true;
          continue;
        }
        byId[id] = { id: id, count: 0, lastSeen: now };
        ids.push(id);
      }
      byId[id].count += 1;
      byId[id].lastSeen = now;
    }

    function priorCount(value) {
      var number = Number(value);
      return isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }
    var state = {
      schemaVersion: 1,
      version: VERSION,
      updatedAt: now,
      scannedResponses: priorCount(saved.scannedResponses) + 1,
      matchedResponses: priorCount(saved.matchedResponses) + (hitCount > 0 ? 1 : 0),
      limit: SCAN_LIMIT,
      truncated: truncated,
      skus: ids.sort().map(function (id) { return byId[id]; })
    };
    var stored = false;
    try {
      if (typeof $persistentStore !== "undefined" && typeof $persistentStore.write === "function") {
        stored = $persistentStore.write(JSON.stringify(state), SCAN_KEY);
      }
    } catch (error) {
      stored = false;
    }

    console.log("[g1-acq] candidates=" + Object.keys(found).length +
      " occurrences=" + hitCount + " saved=" + (stored ? "yes" : "no"));
    Object.keys(found).sort().slice(0, SCAN_LIMIT).forEach(function (id) {
      console.log("[g1-acq] " + id + " x" + found[id]);
    });
  }
})();
