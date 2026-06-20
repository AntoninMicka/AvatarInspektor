const emptyState = document.getElementById("emptyState");
const report = document.getElementById("report");
const verdict = document.getElementById("verdict");
const analyzedAt = document.getElementById("analyzedAt");
const dimensions = document.getElementById("dimensions");
const score = document.getElementById("score");
const sourceHost = document.getElementById("sourceHost");
const indicators = document.getElementById("indicators");
const warnings = document.getElementById("warnings");

initialize().catch((error) => {
  emptyState.hidden = false;
  emptyState.textContent = `Failed to load analysis: ${error.message}`;
});

async function initialize() {
  const analysis = await chrome.runtime.sendMessage({
    type: "avatar-inspector:get-last-analysis"
  });

  if (!analysis) {
    emptyState.hidden = false;
    report.hidden = true;
    return;
  }

  emptyState.hidden = true;
  report.hidden = false;

  verdict.textContent = analysis.verdict;
  analyzedAt.textContent = formatAnalyzedAt(analysis.analyzedAt);
  dimensions.textContent = formatDimensions(analysis.dimensions);
  score.textContent = `${analysis.score} (${analysis.scoring.positive}+ / ${analysis.scoring.negative}-)`;
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
    item.textContent = "None";
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
    return "Unavailable";
  }

  return `${value.width} x ${value.height}`;
}

function formatSourceHost(srcUrl) {
  try {
    return new URL(srcUrl).hostname;
  } catch (_error) {
    return "Unknown";
  }
}

function formatAnalyzedAt(value) {
  if (!value) {
    return "Analysis time unavailable";
  }

  return `Analyzed ${new Date(value).toLocaleString()}`;
}
