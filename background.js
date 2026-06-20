const extensionApi = globalThis.browser ?? globalThis.chrome;
const MENU_ID = "avatar-inspector-analyze-image";
const STORAGE_KEY = "lastAnalysis";

let cachedRules = null;

extensionApi.runtime.onInstalled.addListener(async () => {
  await ensureContextMenu();
  await extensionApi.action.setBadgeText({ text: "" });
});

extensionApi.runtime.onStartup.addListener(async () => {
  await ensureContextMenu();
});

async function ensureContextMenu() {
  await extensionApi.contextMenus.removeAll();
  extensionApi.contextMenus.create({
    id: MENU_ID,
    title: "Analyze Image",
    contexts: ["image"]
  });
}

extensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) {
    return;
  }

  const domContext = tab?.id ? await getImageContextFromTab(tab.id) : null;
  const analysis = await analyzeImage(info.srcUrl, domContext);

  await extensionApi.storage.local.set({
    [STORAGE_KEY]: {
      ...analysis,
      analyzedAt: new Date().toISOString(),
      pageUrl: info.pageUrl || tab?.url || null
    }
  });

  await updateBadge(analysis.verdict);
  await openResultsView();
});

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "avatar-inspector:get-last-analysis") {
    extensionApi.storage.local.get(STORAGE_KEY).then((result) => {
      sendResponse(result[STORAGE_KEY] || null);
    });
    return true;
  }

  return false;
});

async function getImageContextFromTab(tabId) {
  try {
    return await extensionApi.tabs.sendMessage(tabId, {
      type: "avatar-inspector:get-last-image-context"
    });
  } catch (_error) {
    return null;
  }
}

async function analyzeImage(srcUrl, domContext) {
  const rules = await loadRules();
  const indicators = [];
  const warnings = [];

  let url;
  try {
    url = new URL(srcUrl);
  } catch (_error) {
    return buildAnalysis({
      srcUrl,
      indicators: [],
      warnings: ["Image URL could not be parsed."],
      dimensions: null,
      metadata: {
        domContext: domContext || null
      }
    });
  }

  const imageInfo = await inspectImage(srcUrl);
  const sourceMatches = matchSourceRules(url, rules.sources);
  indicators.push(...sourceMatches);

  if (imageInfo.dimensions) {
    const { width, height } = imageInfo.dimensions;

    if (Math.min(width, height) <= rules.thresholds.lowResolution.maxShortEdge) {
      indicators.push({
        key: "low_resolution",
        label: "Low resolution",
        severity: "negative",
        weight: 1,
        reason: `Short edge is ${Math.min(width, height)} px.`
      });
    }

    if (Math.abs(width - height) <= rules.thresholds.squareTolerance) {
      indicators.push({
        key: "square_avatar",
        label: "Square avatar-like crop",
        severity: "neutral",
        weight: 0,
        reason: `Dimensions ${width}x${height} resemble a profile image crop.`
      });
    }
  } else if (imageInfo.error) {
    warnings.push(imageInfo.error);
  }

  if (domContext?.alt) {
    indicators.push({
      key: "dom_alt_text",
      label: "DOM context captured",
      severity: "positive",
      "weight": 0.5,
      reason: `Found alt text: "${truncate(domContext.alt, 80)}".`
    });
  }

  if (domContext?.title) {
    indicators.push({
      key: "dom_title_text",
      label: "Image title captured",
      severity: "neutral",
      "weight": 0,
      reason: `Found title attribute: "${truncate(domContext.title, 80)}".`
    });
  }

  if (!imageInfo.metadataAvailable) {
    warnings.push("EXIF/IPTC/XMP parsing is not wired in yet.");
  }

  return buildAnalysis({
    srcUrl,
    indicators,
    warnings,
    dimensions: imageInfo.dimensions,
    metadata: {
      contentType: imageInfo.contentType,
      fileSize: imageInfo.fileSize,
      domContext: domContext || null
    }
  });
}

async function inspectImage(srcUrl) {
  try {
    const response = await fetch(srcUrl, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    return {
      dimensions: {
        width: bitmap.width,
        height: bitmap.height
      },
      contentType: blob.type || response.headers.get("content-type") || "unknown",
      fileSize: blob.size,
      metadataAvailable: false
    };
  } catch (error) {
    return {
      dimensions: null,
      contentType: null,
      fileSize: null,
      metadataAvailable: false,
      error: `Image fetch failed: ${error.message}`
    };
  }
}

function matchSourceRules(url, sourceRules) {
  const matches = [];

  for (const sourceRule of sourceRules) {
    const hostMatch = sourceRule.hosts.some((host) => url.hostname.includes(host));
    const pathMatch = sourceRule.pathFragments.some((fragment) => url.pathname.includes(fragment));

    if (hostMatch || pathMatch) {
      matches.push({
        key: sourceRule.key,
        label: sourceRule.label,
        severity: sourceRule.severity,
        weight: sourceRule.weight ?? getDefaultWeight(sourceRule.severity),
        reason: sourceRule.reason
      });
    }
  }

  return matches;
}

function buildAnalysis({ srcUrl, indicators, warnings, dimensions, metadata }) {
  const scoring = indicators.reduce(
    (accumulator, indicator) => {
      const weight = indicator.weight ?? getDefaultWeight(indicator.severity);

      if (indicator.severity === "negative") {
        accumulator.negative += 1;
        accumulator.negativeWeight += weight;
      } else if (indicator.severity === "positive") {
        accumulator.positive += 1;
        accumulator.positiveWeight += weight;
      } else {
        accumulator.neutral += 1;
      }
      return accumulator;
    },
    { positive: 0, negative: 0, neutral: 0, positiveWeight: 0, negativeWeight: 0 }
  );

  let verdict = "Likely original photo";
  const finalScore = scoring.positiveWeight - scoring.negativeWeight;

  if (scoring.negativeWeight >= 3) {
    verdict = "Likely reused or republished photo";
  } else if (scoring.negativeWeight >= 1) {
    verdict = "Mixed signals";
  }

  return {
    srcUrl,
    verdict,
    score: finalScore,
    scoring,
    dimensions,
    indicators,
    warnings,
    metadata,
    summary: buildSummary(indicators, warnings)
  };
}

function buildSummary(indicators, warnings) {
  if (indicators.length === 0 && warnings.length === 0) {
    return "No strong signs were found yet.";
  }

  const topIndicator = indicators[0];
  if (topIndicator) {
    return `${topIndicator.label}: ${topIndicator.reason}`;
  }

  return warnings[0];
}

function getDefaultWeight(severity) {
  if (severity === "positive" || severity === "negative") {
    return 1;
  }

  return 0;
}

async function loadRules() {
  if (cachedRules) {
    return cachedRules;
  }

  const response = await fetch(extensionApi.runtime.getURL("rules.json"));
  cachedRules = await response.json();
  return cachedRules;
}

async function updateBadge(verdict) {
  let text = "OK";
  let color = "#2f855a";

  if (verdict === "Likely reused or republished photo") {
    text = "WARN";
    color = "#c05621";
  } else if (verdict === "Mixed signals") {
    text = "MIX";
    color = "#b7791f";
  }

  await extensionApi.action.setBadgeText({ text });
  await extensionApi.action.setBadgeBackgroundColor({ color });
}

async function openResultsView() {
  if (typeof extensionApi.action.openPopup === "function") {
    try {
      await extensionApi.action.openPopup();
      return;
    } catch (_error) {
      // Firefox may refuse popup opening in some extension contexts.
    }
  }

  await extensionApi.tabs.create({
    url: extensionApi.runtime.getURL("popup.html")
  });
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
