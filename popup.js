const extensionApi = globalThis.browser ?? globalThis.chrome;

const emptyState = document.getElementById("emptyState");
const profileView = document.getElementById("profileView");
const unsupportedState = document.getElementById("unsupportedState");
const platformBadge = document.getElementById("platformBadge");
const resultBadge = document.getElementById("resultBadge");
const resultSummary = document.getElementById("resultSummary");
const resultScore = document.getElementById("resultScore");
const resultNegatives = document.getElementById("resultNegatives");
const resultUpdated = document.getElementById("resultUpdated");
const profileName = document.getElementById("profileName");
const profileId = document.getElementById("profileId");
const profileSummary = document.getElementById("profileSummary");
const profileUrl = document.getElementById("profileUrl");
const noteField = document.getElementById("noteField");
const saveNoteButton = document.getElementById("saveNoteButton");
const analyzePhotoButton = document.getElementById("analyzePhotoButton");
const photoStatus = document.getElementById("photoStatus");
const identityChecks = document.getElementById("identityChecks");
const photoChecks = document.getElementById("photoChecks");
const socialChecks = document.getElementById("socialChecks");
const behaviorChecks = document.getElementById("behaviorChecks");
const socialSignals = document.getElementById("socialSignals");
const locationHints = document.getElementById("locationHints");
const indicators = document.getElementById("indicators");
const warnings = document.getElementById("warnings");
const analyzedAt = document.getElementById("analyzedAt");

const sections = {
  identity: [
    { key: "video_call_verified", label: "Videohovor probehl", source: "manual" },
    { key: "voice_call_verified", label: "Hlasovy hovor probehl", source: "manual" },
    { key: "real_life_meeting", label: "Osobni setkani", source: "manual" },
    { key: "identity_verified", label: "Overena identita", source: "manual" },
    { key: "profile_name_detected", label: "Jmeno profilu rozpoznano", source: "automatic" },
    { key: "profile_photo_detected", label: "Profilova fotka nalezena", source: "automatic" },
    { key: "account_history_detected", label: "Historie profilu zachycena", source: "automatic" }
  ],
  photos: [
    { key: "profile_photo_analyzed", label: "Profilova fotka analyzovana", source: "automatic" },
    { key: "photo_low_resolution", label: "Nizke rozliseni", source: "automatic", negative: true },
    { key: "photo_external_source", label: "Externi nebo komercni zdroj", source: "automatic", negative: true },
    { key: "photo_metadata_present", label: "Metadata pritomna", source: "automatic" }
  ],
  social: [
    { key: "social_graph_available", label: "Socialni vazby zachyceny", source: "automatic" },
    { key: "location_hints_detected", label: "Nalezene geograficke stopy", source: "automatic" },
    { key: "geo_inconsistency_observed", label: "Nizka geograficka konzistence", source: "manual", negative: true }
  ],
  behavior: [
    { key: "refuses_video_call", label: "Odmita videohovor", source: "manual", negative: true },
    { key: "avoids_specific_answers", label: "Vyhyba se konkretnim odpovedim", source: "manual", negative: true },
    { key: "contradictory_information", label: "Protichudne informace", source: "manual", negative: true },
    { key: "rapid_intimacy", label: "Rychly prechod k intimite", source: "manual", negative: true },
    { key: "requests_photos", label: "Zadosti o fotografie", source: "manual", negative: true },
    { key: "explicit_content_sent", label: "Explicitni obsah", source: "manual", negative: true },
    { key: "financial_requests", label: "Financni pozadavky", source: "manual", negative: true }
  ]
};

let currentProfile = null;

initialize().catch((error) => {
  emptyState.hidden = false;
  emptyState.textContent = `Nepodarilo se nacist profil: ${error.message}`;
});

async function initialize() {
  const state = await extensionApi.runtime.sendMessage({
    type: "avatar-inspector:get-active-profile"
  });

  if (state?.error) {
    throw new Error(state.error);
  }

  if (!state?.supported) {
    unsupportedState.hidden = false;
  }

  if (!state?.profile) {
    emptyState.hidden = false;
    profileView.hidden = true;
    return;
  }

  currentProfile = state.profile;
  bindActions();
  renderProfile(currentProfile);
}

function bindActions() {
  saveNoteButton.addEventListener("click", async () => {
    if (!currentProfile) {
      return;
    }

    const updated = await saveProfilePatch({
      notes: noteField.value
    });

    if (updated) {
      renderProfile(updated);
    }
  });

  analyzePhotoButton.addEventListener("click", async () => {
    analyzePhotoButton.disabled = true;
    analyzePhotoButton.textContent = "Analyzuji...";

    try {
      const updated = await extensionApi.runtime.sendMessage({
        type: "avatar-inspector:analyze-current-profile-photo"
      });

      if (updated?.error) {
        throw new Error(updated.error);
      }

      currentProfile = updated;
      renderProfile(currentProfile);
    } catch (error) {
      photoStatus.textContent = error.message;
    } finally {
      analyzePhotoButton.disabled = false;
      analyzePhotoButton.textContent = "Analyzovat profilovou fotku";
    }
  });
}

function renderProfile(profile) {
  currentProfile = profile;
  emptyState.hidden = true;
  profileView.hidden = false;

  platformBadge.textContent = profile.platform;
  renderResultHeader(profile.assessment);
  profileName.textContent = profile.profileName || "Neznamy profil";
  profileId.textContent = profile.profileId || "unknown";
  profileSummary.textContent = buildProfileSummary(profile);
  profileUrl.textContent = formatUrl(profile.pageUrl);
  noteField.value = profile.notes || "";
  photoStatus.textContent = profile.photoAnalysis?.verdict || "Fotka zatim nebyla analyzovana.";
  analyzedAt.textContent = profile.photoAnalysis?.analyzedAt
    ? `Posledni analyza: ${new Date(profile.photoAnalysis.analyzedAt).toLocaleString("cs-CZ")}`
    : "Zatim bez analyzy fotky.";

  renderCheckSection(identityChecks, sections.identity, profile);
  renderCheckSection(photoChecks, sections.photos, profile);
  renderCheckSection(socialChecks, sections.social, profile);
  renderCheckSection(behaviorChecks, sections.behavior, profile);
  renderSocialSignals(profile.socialGraph);
  renderList(indicators, profile.photoAnalysis?.indicators, formatIndicator);
  renderList(warnings, profile.photoAnalysis?.warnings, (warning) => warning);
}

function renderCheckSection(container, definitions, profile) {
  container.replaceChildren();

  for (const definition of definitions) {
    const row = document.createElement("label");
    row.className = `check-row${definition.negative ? " negative" : ""}`;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = getCheckValue(profile, definition);
    input.disabled = definition.source === "automatic";

    if (definition.source === "manual") {
      input.addEventListener("change", async () => {
        const updated = await saveProfilePatch({
          manualChecks: {
            [definition.key]: input.checked
          }
        });

        if (updated) {
          renderProfile(updated);
        }
      });
    }

    const text = document.createElement("span");
    text.textContent = definition.label;

    const source = document.createElement("small");
    source.textContent = definition.source === "manual" ? "manual" : "auto";

    row.append(input, text, source);
    container.appendChild(row);
  }
}

function renderSocialSignals(graph = {}) {
  const signalItems = [
    graph.friendsLabel,
    graph.followersLabel,
    graph.sharedServersLabel
  ].filter(Boolean);

  renderList(socialSignals, signalItems, (value) => value);
  renderList(locationHints, graph.locationHints, (value) => value);
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

function formatIndicator(indicator) {
  const prefix = indicator.severity === "negative" ? "!" : indicator.severity === "positive" ? "+" : "~";
  return `${prefix} ${indicator.label}: ${indicator.reason}`;
}

function getCheckValue(profile, definition) {
  if (definition.source === "manual") {
    return Boolean(profile.manualChecks?.[definition.key]);
  }

  return Boolean(profile.automaticChecks?.[definition.key]);
}

function buildProfileSummary(profile) {
  const manualFlags = Object.values(profile.manualChecks || {}).filter(Boolean).length;
  const automaticFlags = Object.values(profile.automaticChecks || {}).filter(Boolean).length;
  return `${manualFlags} manualnich zaznamu, ${automaticFlags} automatickych indikatoru.`;
}

function renderResultBadge(verdict) {
  const config = getResultBadgeConfig(verdict);
  resultBadge.textContent = config.label;
  resultBadge.dataset.tone = config.tone;
}

function renderResultHeader(assessment) {
  renderResultBadge(assessment?.verdict);
  resultSummary.textContent = assessment?.summary || "Vysledek analyzy se zobrazi po zpracovani profilove fotky.";
  resultScore.textContent = typeof assessment?.score === "number" ? formatScore(assessment.score) : "--";
  resultNegatives.textContent = String(assessment?.scoring?.negative || 0);
  resultUpdated.textContent = currentProfile?.updatedAt
    ? formatShortDate(currentProfile.updatedAt)
    : "Zatim";
}

function getResultBadgeConfig(verdict) {
  if (verdict === "Bez zjevnych problemu") {
    return {
      label: "Vysledek: OK",
      tone: "ok"
    };
  }

  if (verdict === "Vyzaduje pozornost") {
    return {
      label: "Vysledek: Pozor",
      tone: "warn"
    };
  }

  if (verdict === "Vyrazne nesrovnalosti") {
    return {
      label: "Vysledek: Riziko",
      tone: "danger"
    };
  }

  return {
    label: "Bez vysledku",
    tone: "neutral"
  };
}

function formatScore(value) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

function formatShortDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString("cs-CZ", {
    day: "2-digit",
    month: "2-digit"
  });
}

function formatUrl(value) {
  if (!value) {
    return "URL neni k dispozici";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch (_error) {
    return value;
  }
}

async function saveProfilePatch(patch) {
  if (!currentProfile) {
    return null;
  }

  const updated = await extensionApi.runtime.sendMessage({
    type: "avatar-inspector:update-profile",
    profileKey: currentProfile.key,
    patch
  });

  if (updated?.error) {
    throw new Error(updated.error);
  }

  currentProfile = updated;
  return updated;
}
