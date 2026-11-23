/* Local-only report served by a Shadowrocket http-request script. */
"use strict";

(function () {
  var ROOT = "https://one.google.com/g1-sku-report";
  var VERSION = "v7.2.0";
  var SCAN_KEY = "g1.sku.scan.v1";
  var TEST_KEY = "g1.pro.annual.test.v1";
  var TARGET_KEY = "g1.2tb.target.index.v1";
  var TARGETS_2TB = [
    "g1.2tb.ai.18months_eft",
    "g1.2tb.ai.15months_eft",
    "g1.2tb.ai.12months_eft",
    "g1.ios.2tb.ai.12months_eft",
    "g1.play.2tb.ai.12months_eft",
    "g1.ios.2tb.ai.eft-12mo",
    "g1.play.2tb.ai.eft-12mo",
    "g1.2tb.ai.6months_eft",
    "g1.ios.2tb.ai.eft-3mo",
    "g1.play.2tb.ai.eft-3mo"
  ];
  var url = typeof $request === "object" && $request ? $request.url : "";
  if (typeof url !== "string" || !/^https:\/\/one\.google\.com\/g1-sku-report\/?(?:\?|$)/.test(url)) {
    $done({});
    return;
  }

  var storageAvailable = typeof $persistentStore !== "undefined" &&
    typeof $persistentStore.read === "function";
  var selectedIndex = 0;
  if (storageAvailable) {
    try {
      var parsedIdx = parseInt($persistentStore.read(TARGET_KEY), 10);
      if (isFinite(parsedIdx) && parsedIdx >= 0 && parsedIdx < TARGETS_2TB.length) {
        selectedIndex = parsedIdx;
      }
    } catch (error) {
      selectedIndex = 0;
    }
  }
  var clearMessage = "";
  var idxMatch = url.match(/(?:\?|&)idx=(\d+)(?:&|$)/);
  if (/(?:\?|&)next=1(?:&|$)/.test(url)) {
    selectedIndex = (selectedIndex + 1) % TARGETS_2TB.length;
    try {
      $persistentStore.write(String(selectedIndex), TARGET_KEY);
      clearMessage = "已切换到第 " + (selectedIndex + 1) + " 个 2TB 候选：" + TARGETS_2TB[selectedIndex] + "（请回 Google App 刷新订阅页）";
    } catch (error) {
      clearMessage = "本地存储接口暂未就绪，无法切换。";
    }
  } else if (idxMatch) {
    var reqIdx = parseInt(idxMatch[1], 10);
    if (isFinite(reqIdx) && reqIdx >= 0 && reqIdx < TARGETS_2TB.length) {
      selectedIndex = reqIdx;
      try {
        $persistentStore.write(String(selectedIndex), TARGET_KEY);
        clearMessage = "已选择第 " + (selectedIndex + 1) + " 个 2TB 候选：" + TARGETS_2TB[selectedIndex] + "（请回 Google App 刷新订阅页）";
      } catch (error) {
        clearMessage = "本地存储接口暂未就绪，无法切换。";
      }
    }
  }
  if (/(?:\?|&)clear=1(?:&|$)/.test(url)) {
    try {
      var scanCleared = $persistentStore.write("{}", SCAN_KEY);
      var testCleared = $persistentStore.write("{}", TEST_KEY);
      clearMessage = scanCleared && testCleared ? "本工具的两份本地记录已清空。" : "本地记录清空未完成。";
    } catch (error) {
      clearMessage = "本地存储接口暂未就绪。";
    }
  }
  var activeTarget = TARGETS_2TB[selectedIndex];

  function load(key) {
    if (!storageAvailable) return {};
    try {
      var value = JSON.parse($persistentStore.read(key) || "{}");
      return value && value.schemaVersion === 1 ? value : {};
    } catch (error) {
      return {};
    }
  }
  function text(value, length) {
    return typeof value === "string" ? value.slice(0, length || 180) : "";
  }
  function count(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }
  function rows(value, withTime) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 300).filter(function (row) {
      return row && typeof row.id === "string" &&
        /^(?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]{1,160}$/.test(row.id);
    }).map(function (row) {
      var out = { id: row.id, count: count(row.count) };
      if (withTime) {
        out.lastSeen = text(row.lastSeen, 32);
      } else {
        out.to = typeof row.to === "string" && /^g1\.[A-Za-z0-9._-]{1,160}$/.test(row.to) ?
          row.to : row.id.indexOf("g1.ios.2tb.") === 0 ? activeTarget : "";
        out.fallback = row.fallback === true;
      }
      return out;
    }).sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  }

  var scanRaw = load(SCAN_KEY);
  var testRaw = load(TEST_KEY);
  var matchedFrom = rows(testRaw.matchedFrom, false);
  var annualHitCount = typeof testRaw.annualHitCount === "number" ? count(testRaw.annualHitCount) :
    matchedFrom.reduce(function (total, row) {
      return total + (row.id.indexOf("g1.ios.2tb.") === 0 ? row.count : 0);
    }, 0);
  var report = {
    schemaVersion: 1,
    reportVersion: VERSION,
    storageAvailable: storageAvailable,
    scan: {
      version: text(scanRaw.version, 32),
      updatedAt: text(scanRaw.updatedAt, 32),
      scannedResponses: count(scanRaw.scannedResponses),
      matchedResponses: count(scanRaw.matchedResponses),
      truncated: scanRaw.truncated === true,
      limit: 300,
      skus: rows(scanRaw.skus, true)
    },
    test: {
      version: text(testRaw.version, 32),
      updatedAt: text(testRaw.updatedAt, 32),
      sourcePrefix: "g1.ios.2tb.",
      target: text(testRaw.target, 180) || activeTarget,
      selectedIndex: selectedIndex,
      selectedTarget: activeTarget,
      candidates: TARGETS_2TB,
      status: text(testRaw.status, 32),
      hitCount: count(testRaw.hitCount),
      annualHitCount: annualHitCount,
      matchedFrom: matchedFrom
    }
  };

  var headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-G1-Report-Version": VERSION,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
  };
  var exportJSON = /(?:\?|&)format=json(?:&|$)/.test(url);
  console.log("[g1-sku-report] " + VERSION + " " + (exportJSON ? "json" : "html") +
    " storage=" + (storageAvailable ? "ready" : "unavailable") + " candidates=" + report.scan.skus.length);
  if (exportJSON) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Disposition"] = 'attachment; filename="g1-sku-report.json"';
    $done({ response: { status: 200, headers: headers, body: JSON.stringify(report, null, 2) } });
    return;
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function table(items, withTime) {
    if (!items.length) return "<p>暂无记录。</p>";
    return "<div class=scroll><table><thead><tr><th>完整商品编号</th><th>次数</th>" +
      (withTime ? "<th>最近发现时间（UTC）</th>" : "<th>实际目标 SKU</th><th>备用档</th>") + "</tr></thead><tbody>" +
      items.map(function (row) {
        return "<tr><td><code>" + escape(row.id) + "</code></td><td>" + row.count + "</td>" +
          (withTime ? "<td>" + escape(row.lastSeen) + "</td>" :
            "<td><code>" + escape(row.to || "未记录") + "</code></td><td>" + (row.fallback ? "75p" : "否") + "</td>") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }
  var statuses = {
    "rewritten": "已执行字符串替换",
    "no-match": "本次响应未命中三档映射中的源商品",
    "non-text": "本次响应没有可处理的文本正文"
  };
  var status = Object.prototype.hasOwnProperty.call(statuses, report.test.status) ?
    statuses[report.test.status] : "暂无测试执行记录";
  if (report.test.version === "pro-annual-test-v1" && report.test.status === "no-match") {
    status = "旧 v1 记录：本次响应未命中 iOS 2TB 前缀";
  }
  var html = [
    "<!doctype html><html lang=zh-CN><meta charset=utf-8>",
    "<meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Google One SKU 本地报告</title>",
    "<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;max-width:960px;margin:24px auto;padding:0 18px;color:#1c2737;background:#f5f7fa}section{background:white;border:1px solid #dde3ec;border-radius:12px;padding:18px;margin:18px 0}h1{font-size:24px;margin-bottom:10px}h2{font-size:20px}code{overflow-wrap:anywhere}a{color:#1259be}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.scroll{overflow:auto}.note{color:#46556b}.badge{display:inline-block;background:#e0f4e8;color:#176238;padding:4px 10px;border-radius:8px}.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:20px 0}.actions form{margin:0}button,.actions a{font:inherit;padding:10px 16px;border:0;border-radius:8px;cursor:pointer;text-decoration:none}.actions a{background:#e4eaf3}.actions button{background:#1259be;color:white}button{background:#e4eaf3;color:#1c2737}</style>",
    "<h1>Google One SKU 本地报告</h1>",
    "<p class=badge>本机脚本已接管 · " + VERSION + "</p>",
    "<nav class=actions aria-label=报告操作><form method=get action=\"" + ROOT + "\"><button type=submit name=format value=json>导出 JSON</button></form><a href=\"" + ROOT + "\">刷新报告</a></nav>",
    "<p class=note>此页由当前设备的 Shadowrocket 生成；地址栏沿用 one.google.com，采集记录保存在当前设备。</p>",
    "<p class=note>保持一个 G1 ACQ 模块开启即可：先采集原始响应中的编号，再执行三档改写。</p>",
    clearMessage ? "<p>" + escape(clearMessage) + "</p>" : "",
    storageAvailable ? "" : "<p>本地存储接口暂未就绪；此页尚未读取到采集记录。</p>",
    "<section><h2>2TB 候选 SKU 顺序测试（当前第 " + (selectedIndex + 1) + " / " + TARGETS_2TB.length + " 档）</h2>",
    "<p>当前生效目标：<code>" + escape(activeTarget) + "</code></p>",
    "<nav class=actions><a href=\"" + ROOT + "?next=1\">不行，切换下一个</a><a href=\"" + ROOT + "?idx=0\">重置回第 1 档</a></nav>",
    "<ol>" + TARGETS_2TB.map(function (sku, i) {
      var label = "<code>" + escape(sku) + "</code>";
      return "<li>" + (i === selectedIndex ? "<strong>[当前] " + label + "</strong>" :
        "<a href=\"" + ROOT + "?idx=" + i + "\">" + label + "</a>") + "</li>";
    }).join("") + "</ol></section>",
    "<section><h2>最近一次三档映射</h2>",
    "<p>版本：" + escape(report.test.version || "暂无") + "<br>状态：" + escape(status) + "；总替换次数：" + report.test.hitCount + "；其中 2TB：" + report.test.annualHitCount + "</p>",
    "<p>2TB 源前缀：<code>g1.ios.2tb.</code><br>最近一次 2TB 实际目标：<code>" + escape(report.test.target) + "</code><br>20TB / 30TB 沿用旧优惠映射与 75p 回退；各档实际目标见下表。<br>执行时间（UTC）：" + escape(report.test.updatedAt || "暂无") + "</p>",
    "<p class=note>这里记录的是脚本执行结果；商品是否被 App Store 识别、价格和周期需查看购买面板。</p>",
    table(report.test.matchedFrom, false), "</section>",
    "<section><h2>浏览页面时采集到的候选 SKU</h2>",
    "<p>扫描文本响应：" + report.scan.scannedResponses + "；含候选 SKU 的响应：" + report.scan.matchedResponses + "；累计编号：" + report.scan.skus.length + "</p>",
    "<p class=note>编号在改写前从原始响应中提取，并非商店的完整商品目录；脚本生成的替换目标不会自动加入这份清单。</p>",
    report.scan.truncated ? "<p>记录已达到 300 个上限；清空后可重新采集目标页面。</p>" : "",
    table(report.scan.skus, true),
    "<p>更新时间（UTC）：" + escape(report.scan.updatedAt || "暂无") + "</p></section>",
    "<form method=get action=\"" + ROOT + "\"><button name=clear value=1>清空本工具的采集与测试记录</button></form>",
    "<p class=note>浏览方案后刷新本页查看记录；独立采集器和历史改写副本保持停用，避免重复记录。</p></html>"
  ].join("");
  $done({ response: { status: 200, headers: headers, body: html } });
})();
