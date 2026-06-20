const extensionApi = globalThis.browser ?? globalThis.chrome;
const actionApi = extensionApi.action ?? extensionApi.browserAction;
const exifrApi = globalThis.exifr;
const MENU_ID = "avatar-inspector-analyze-image";
const PROFILE_STORAGE_KEY = "profiles";
const LAST_PROFILE_KEY = "lastProfileKey";

let cachedRules = null;

const manualCheckDefinitions = [
  { key: "video_call_verified", category: "identity", label: "Videohovor probehl" },
  { key: "voice_call_verified", category: "identity", label: "Hlasovy hovor probehl" },
  { key: "real_life_meeting", category: "identity", label: "Osobni setkani" },
  { key: "identity_verified", category: "identity", label: "Overena identita" },
  { key: "refuses_video_call", category: "behavior", label: "Odmita videohovor" },
  { key: "avoids_specific_answers", category: "behavior", label: "Vyhyba se konkretnim odpovedim" },
  { key: "contradictory_information", category: "behavior", label: "Protichudne informace" },
  { key: "rapid_intimacy", category: "behavior", label: "Rychly prechod k intimite" },
  { key: "requests_photos", category: "behavior", label: "Zadosti o fotografie" },
  { key: "explicit_content_sent", category: "behavior", label: "Explicitni obsah" },
  { key: "financial_requests", category: "behavior", label: "Financni pozadavky" },
  { key: "geo_inconsistency_observed", category: "social", label: "Nizka geograficka konzistence" }
];

extensionApi.runtime.onInstalled.addListener(async () => {
  await ensureContextMenu();
  await actionApi.setBadgeText({ text: "" });
});

extensionApi.runtime.onStartup.addListener(async () => {
  await ensureContextMenu();
});

extensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) {
    return;
  }

  const tabId = tab?.id;
  const profileContext = tabId ? await getProfileContextFromTab(tabId) : null;
  const domContext = tabId ? await getImageContextFromTab(tabId) : null;
  const baseRecord = createProfileRecord(profileContext, info.pageUrl || tab?.url || null);
  const analysis = await analyzeImage(info.srcUrl, domContext);
  const updatedRecord = mergePhotoAnalysis(baseRecord, analysis, info.srcUrl);

  await upsertProfile(updatedRecord);
  await updateBadgeFromProfile(updatedRecord);
  await openResultsView();
});

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "avatar-inspector:get-active-profile") {
    getActiveProfileState()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "avatar-inspector:update-profile") {
    updateProfile(message.profileKey, message.patch)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "avatar-inspector:analyze-current-profile-photo") {
    analyzeCurrentProfilePhoto()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "avatar-inspector:get-last-analysis") {
    getActiveProfileState()
      .then((state) => sendResponse(state?.profile?.photoAnalysis || null))
      .catch(() => sendResponse(null));
    return true;
  }

  return false;
});

async function ensureContextMenu() {
  await extensionApi.contextMenus.removeAll();
  extensionApi.contextMenus.create({
    id: MENU_ID,
    title: "Analyze Image",
    contexts: ["image"]
  });
}

async function getActiveProfileState() {
  const tab = await getActiveTab();
  const profileContext = tab?.id ? await getProfileContextFromTab(tab.id) : null;
  const isSupportedProfile = isSupportedProfileContext(profileContext);
  let profile = null;

  if (isSupportedProfile) {
    profile = await findOrCreateProfile(profileContext, tab?.url || null);
  } else {
    profile = await getLastProfile();
  }

  if (!profile) {
    return {
      profile: null,
      supported: isSupportedProfile,
      profileContext
    };
  }

  return {
    profile,
    supported: isSupportedProfile,
    profileContext
  };
}

async function analyzeCurrentProfilePhoto() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("Aktivni panel se nepodarilo zjistit.");
  }

  const profileContext = await getProfileContextFromTab(tab.id);
  if (!isSupportedProfileContext(profileContext) || !profileContext?.profileImage) {
    throw new Error("Na aktualni strance se nepodarilo najit profilovou fotku.");
  }

  const domContext = await getImageContextFromTab(tab.id);
  const baseRecord = await findOrCreateProfile(profileContext, tab.url || null);
  const analysis = await analyzeImage(profileContext.profileImage, domContext);
  const updatedRecord = mergePhotoAnalysis(baseRecord, analysis, profileContext.profileImage);

  await upsertProfile(updatedRecord);
  await updateBadgeFromProfile(updatedRecord);

  return updatedRecord;
}

async function getActiveTab() {
  const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getImageContextFromTab(tabId) {
  try {
    return await extensionApi.tabs.sendMessage(tabId, {
      type: "avatar-inspector:get-last-image-context"
    });
  } catch (_error) {
    return null;
  }
}

async function getProfileContextFromTab(tabId) {
  try {
    return await extensionApi.tabs.sendMessage(tabId, {
      type: "avatar-inspector:get-profile-context"
    });
  } catch (_error) {
    return null;
  }
}

async function findOrCreateProfile(profileContext, pageUrl) {
  const profileKey = buildProfileKey(profileContext);
  const { profiles = {} } = await extensionApi.storage.local.get([
    PROFILE_STORAGE_KEY,
    LAST_PROFILE_KEY
  ]);

  const existing = profiles[profileKey];
  const merged = enrichProfileRecord(existing || createProfileRecord(profileContext, pageUrl), profileContext, pageUrl);

  await extensionApi.storage.local.set({
    [PROFILE_STORAGE_KEY]: {
      ...profiles,
      [profileKey]: merged
    },
    [LAST_PROFILE_KEY]: profileKey
  });

  return merged;
}

async function getLastProfile() {
  const stored = await extensionApi.storage.local.get([PROFILE_STORAGE_KEY, LAST_PROFILE_KEY]);
  const profiles = stored[PROFILE_STORAGE_KEY] || {};
  const profileKey = stored[LAST_PROFILE_KEY];
  return profileKey ? profiles[profileKey] || null : null;
}

function createProfileRecord(profileContext, pageUrl) {
  const timestamp = new Date().toISOString();
  const key = buildProfileKey(profileContext);
  const automaticChecks = buildAutomaticChecks(profileContext, null);

  return {
    key,
    platform: profileContext?.platform || "generic",
    profileId: profileContext?.profileId || "unknown",
    profileName: profileContext?.profileName || "Neznamy profil",
    pageUrl: pageUrl || profileContext?.pageUrl || null,
    notes: "",
    manualChecks: buildDefaultManualChecks(),
    automaticChecks,
    socialGraph: buildSocialGraph(profileContext?.socialSignals),
    photoAnalysis: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function enrichProfileRecord(record, profileContext, pageUrl) {
  const automaticChecks = buildAutomaticChecks(profileContext, record.photoAnalysis);

  return {
    ...record,
    platform: profileContext?.platform || record.platform,
    profileId: profileContext?.profileId || record.profileId,
    profileName: profileContext?.profileName || record.profileName,
    pageUrl: pageUrl || profileContext?.pageUrl || record.pageUrl,
    automaticChecks: {
      ...record.automaticChecks,
      ...automaticChecks
    },
    socialGraph: buildSocialGraph(profileContext?.socialSignals, record.socialGraph),
    updatedAt: new Date().toISOString()
  };
}

function buildProfileKey(profileContext) {
  const platform = profileContext?.platform || "generic";
  const profileId = profileContext?.profileId || sanitizeId(profileContext?.profileName) || "unknown";
  return `${platform}:${profileId}`;
}

function isSupportedProfileContext(profileContext) {
  return Boolean(
    profileContext &&
      profileContext.platform &&
      profileContext.platform !== "generic" &&
      profileContext.pageType === "profile" &&
      (profileContext.profileId || profileContext.profileName)
  );
}

function sanitizeId(value) {
  return value ? value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : null;
}

function buildDefaultManualChecks() {
  return manualCheckDefinitions.reduce((accumulator, definition) => {
    accumulator[definition.key] = false;
    return accumulator;
  }, {});
}

function buildAutomaticChecks(profileContext, photoAnalysis) {
  const socialSignals = profileContext?.socialSignals || {};
  const indicators = photoAnalysis?.indicators || [];

  return {
    profile_photo_analyzed: Boolean(photoAnalysis),
    photo_low_resolution: indicators.some((indicator) => indicator.key === "low_resolution"),
    photo_external_source: indicators.some((indicator) => indicator.key.endsWith("_cdn") || indicator.key.endsWith("_asset")),
    photo_metadata_present: indicators.some((indicator) => indicator.key === "camera_model_present" || indicator.key === "date_taken_present"),
    profile_name_detected: Boolean(profileContext?.profileName),
    profile_photo_detected: Boolean(profileContext?.profileImage),
    account_history_detected: Boolean(profileContext?.pageType === "profile"),
    social_graph_available: Boolean(socialSignals.friendsLabel || socialSignals.followersLabel || socialSignals.sharedServersLabel),
    location_hints_detected: Array.isArray(socialSignals.locationHints) && socialSignals.locationHints.length > 0
  };
}

function buildSocialGraph(socialSignals, currentGraph = {}) {
  return {
    friendsLabel: socialSignals?.friendsLabel || currentGraph.friendsLabel || null,
    followersLabel: socialSignals?.followersLabel || currentGraph.followersLabel || null,
    sharedServersLabel: socialSignals?.sharedServersLabel || currentGraph.sharedServersLabel || null,
    locationHints: socialSignals?.locationHints || currentGraph.locationHints || []
  };
}

function mergePhotoAnalysis(record, analysis, srcUrl) {
  return {
    ...record,
    photoAnalysis: {
      ...analysis,
      analyzedAt: new Date().toISOString(),
      srcUrl
    },
    automaticChecks: {
      ...record.automaticChecks,
      ...buildAutomaticChecks(
        {
          profileName: record.profileName,
          profileImage: srcUrl,
          pageType: "profile",
          socialSignals: record.socialGraph
        },
        analysis
      )
    },
    updatedAt: new Date().toISOString()
  };
}

async function updateProfile(profileKey, patch) {
  const stored = await extensionApi.storage.local.get(PROFILE_STORAGE_KEY);
  const profiles = stored[PROFILE_STORAGE_KEY] || {};
  const current = profiles[profileKey];

  if (!current) {
    throw new Error("Profil se nepodarilo najit.");
  }

  const updated = {
    ...current,
    notes: typeof patch?.notes === "string" ? patch.notes : current.notes,
    manualChecks: patch?.manualChecks ? { ...current.manualChecks, ...patch.manualChecks } : current.manualChecks,
    updatedAt: new Date().toISOString()
  };

  await upsertProfile(updated);
  return updated;
}

async function upsertProfile(profile) {
  const stored = await extensionApi.storage.local.get(PROFILE_STORAGE_KEY);
  const profiles = stored[PROFILE_STORAGE_KEY] || {};
  await extensionApi.storage.local.set({
    [PROFILE_STORAGE_KEY]: {
      ...profiles,
      [profile.key]: profile
    },
    [LAST_PROFILE_KEY]: profile.key
  });
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
      weight: 0.5,
      reason: `Found alt text: "${truncate(domContext.alt, 80)}".`
    });
  }

  if (domContext?.title) {
    indicators.push({
      key: "dom_title_text",
      label: "Image title captured",
      severity: "neutral",
      weight: 0,
      reason: `Found title attribute: "${truncate(domContext.title, 80)}".`
    });
  }

  if (!exifrApi?.parse) {
    warnings.push("EXIF parser is not available in the current background context.");
  } else if (!imageInfo.metadataAvailable) {
    warnings.push("No EXIF/IPTC/XMP metadata were found in this image.");
  }

  indicators.push(...buildMetadataIndicators(imageInfo.metadata));

  return buildAnalysis({
    srcUrl,
    indicators,
    warnings,
    dimensions: imageInfo.dimensions,
    metadata: {
      contentType: imageInfo.contentType,
      fileSize: imageInfo.fileSize,
      imageMetadata: imageInfo.metadata,
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
    const metadata = await extractMetadata(blob);

    return {
      dimensions: {
        width: bitmap.width,
        height: bitmap.height
      },
      contentType: blob.type || response.headers.get("content-type") || "unknown",
      fileSize: blob.size,
      metadataAvailable: Boolean(metadata),
      metadata
    };
  } catch (error) {
    return {
      dimensions: null,
      contentType: null,
      fileSize: null,
      metadataAvailable: false,
      metadata: null,
      error: `Image fetch failed: ${error.message}`
    };
  }
}

async function extractMetadata(blob) {
  if (!exifrApi?.parse) {
    return null;
  }

  try {
    const parsed = await exifrApi.parse(blob, true);
    if (!parsed || Object.keys(parsed).length === 0) {
      return null;
    }

    return {
      author: parsed.Artist || parsed.Creator || parsed.XPAuthor || null,
      copyright: parsed.Copyright || parsed.Rights || null,
      software: parsed.Software || parsed.ProcessingSoftware || null,
      cameraMake: parsed.Make || null,
      cameraModel: parsed.Model || null,
      lensModel: parsed.LensModel || null,
      dateTaken: normalizeDate(parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate),
      latitude: typeof parsed.latitude === "number" ? parsed.latitude : null,
      longitude: typeof parsed.longitude === "number" ? parsed.longitude : null,
      rawTagCount: Object.keys(parsed).length
    };
  } catch (_error) {
    return null;
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

  const finalScore = scoring.positiveWeight - scoring.negativeWeight;
  let verdict = "Bez zjevnych problemu";

  if (scoring.negativeWeight >= 3) {
    verdict = "Vyrazne nesrovnalosti";
  } else if (scoring.negativeWeight >= 1) {
    verdict = "Vyzaduje pozornost";
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
    return "Zatim nebyly nalezeny vyrazne signaly.";
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

function buildMetadataIndicators(metadata) {
  if (!metadata) {
    return [];
  }

  const indicators = [];

  if (metadata.cameraModel || metadata.cameraMake) {
    indicators.push({
      key: "camera_model_present",
      label: "Camera metadata present",
      severity: "positive",
      weight: 1,
      reason: `${metadata.cameraMake || ""} ${metadata.cameraModel || ""}`.trim()
    });
  }

  if (metadata.dateTaken) {
    indicators.push({
      key: "date_taken_present",
      label: "Capture date present",
      severity: "positive",
      weight: 0.5,
      reason: metadata.dateTaken
    });
  }

  if (metadata.software) {
    indicators.push({
      key: "editing_software_present",
      label: "Software tag present",
      severity: "negative",
      weight: 0.75,
      reason: metadata.software
    });
  }

  if (metadata.copyright) {
    indicators.push({
      key: "copyright_present",
      label: "Copyright metadata present",
      severity: "negative",
      weight: 0.75,
      reason: metadata.copyright
    });
  }

  return indicators;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

async function loadRules() {
  if (cachedRules) {
    return cachedRules;
  }

  const response = await fetch(extensionApi.runtime.getURL("rules.json"));
  cachedRules = await response.json();
  return cachedRules;
}

async function updateBadgeFromProfile(profile) {
  const verdict = profile?.photoAnalysis?.verdict;
  let text = "NOTE";
  let color = "#6b7280";

  if (verdict === "Vyrazne nesrovnalosti") {
    text = "WARN";
    color = "#b91c1c";
  } else if (verdict === "Vyzaduje pozornost") {
    text = "MIX";
    color = "#b45309";
  } else if (verdict === "Bez zjevnych problemu") {
    text = "OK";
    color = "#047857";
  }

  await actionApi.setBadgeText({ text });
  await actionApi.setBadgeBackgroundColor({ color });
}

async function openResultsView() {
  if (typeof actionApi?.openPopup === "function") {
    try {
      await actionApi.openPopup();
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
