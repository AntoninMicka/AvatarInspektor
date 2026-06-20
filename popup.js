const extensionApi = globalThis.browser ?? globalThis.chrome;
const emptyState = document.getElementById("emptyState");
const report = document.getElementById("report");
const verdict = document.getElementById("verdict");
const analyzedAt = document.getElementById("analyzedAt");
const summary = document.getElementById("summary");
const dimensions = document.getElementById("dimensions");
const score = document.getElementById("score");
const sourceHost = document.getElementById("sourceHost");
const indicators = document.getElementById("indicators");
const warnings = document.getElementById("warnings");

initialize().catch((error) => {
  emptyState.hidden = false;
  emptyState.textContent = `Nepodarilo se nacist analyzu: ${error.message}`;
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.lastAnalysis?.newValue) {
    return;
  }

  renderAnalysis(changes.lastAnalysis.newValue);
});

async function initialize() {
  const analysis = await extensionApi.runtime.sendMessage({
    type: "avatar-inspector:get-last-analysis"
  });

  if (!analysis) {
    emptyState.hidden = false;
    report.hidden = true;
    return;
  }

  renderAnalysis(analysis);
}

function renderAnalysis(analysis) {
  emptyState.hidden = true;
  report.hidden = false;

  verdict.textContent = analysis.verdict;
  analyzedAt.textContent = formatAnalyzedAt(analysis.analyzedAt);
  summary.textContent = analysis.summary || "";
  dimensions.textContent = formatDimensions(analysis.dimensions);
  score.textContent =
    `${formatScore(analysis.score)} ` +
    `(${formatScore(analysis.scoring.positiveWeight)}+ / ${formatScore(analysis.scoring.negativeWeight)}-)`;
  sourceHost.textContent = formatSourceHost(analysis.srcUrl);

  renderList(
    indicators,
    analysis.indicators,
    (indicator) => `${indicator.label}: ${indicator.reason}`
  );

  renderList(warnings, analysis.warnings, (warning) => warning);
}

function renderList(container, items, formatItem) {
  container.replaceChildren();

  if (!items || items.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Zadne";
    container.appendChild(item);
    return;
  }

  for (const entry of items) {
    const item = document.createElement("li");
    item.textContent = formatItem(entry);
    container.appendChild(item);
  }
}

function formatDimensions(value) {
  if (!value) {
    return "Nedostupne";
  }

  return `${value.width} x ${value.height}`;
}

function formatSourceHost(srcUrl) {
  try {
    return new URL(srcUrl).hostname;
  } catch (_error) {
    return "Neznamy";
  }
}

function formatAnalyzedAt(value) {
  if (!value) {
    return "Cas analyzy neni k dispozici";
  }

  return `Analyzovano ${new Date(value).toLocaleString("cs-CZ")}`;
}

function formatScore(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1);
}
