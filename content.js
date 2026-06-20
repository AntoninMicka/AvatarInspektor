const extensionApi = globalThis.browser ?? globalThis.chrome;
let lastImageContext = null;

document.addEventListener(
  "contextmenu",
  (event) => {
    const image = event.target instanceof Element ? event.target.closest("img") : null;
    if (!image) {
      lastImageContext = null;
      return;
    }

    lastImageContext = buildImageContext(image);
  },
  true
);

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "avatar-inspector:get-last-image-context") {
    sendResponse(lastImageContext);
    return true;
  }

  if (message?.type === "avatar-inspector:get-profile-context") {
    sendResponse(detectProfileContext());
    return true;
  }

  return false;
});

function buildImageContext(image) {
  return {
    src: image.currentSrc || image.src || null,
    alt: image.alt || "",
    title: image.title || "",
    naturalWidth: image.naturalWidth || null,
    naturalHeight: image.naturalHeight || null,
    displayedWidth: image.clientWidth || null,
    displayedHeight: image.clientHeight || null
  };
}

function detectProfileContext() {
  const url = new URL(window.location.href);
  const platform = detectPlatform(url.hostname);
  const pageType = detectPageType(platform, url);
  const profileId = extractProfileId(platform, url);
  const profileName = extractProfileName(platform);
  const profileImage = extractProfilePhoto(platform);
  const socialSignals = extractSocialSignals(platform);

  return {
    platform,
    pageType,
    profileId,
    profileName,
    profileImage,
    pageUrl: url.href,
    socialSignals,
    pageTitle: document.title || ""
  };
}

function detectPlatform(hostname) {
  if (hostname.includes("facebook.com") || hostname.includes("fb.com")) {
    return "facebook";
  }

  if (hostname.includes("instagram.com")) {
    return "instagram";
  }

  if (hostname.includes("discord.com") || hostname.includes("discordapp.com")) {
    return "discord";
  }

  if (hostname.includes("telegram.me") || hostname.includes("t.me") || hostname.includes("telegram.org")) {
    return "telegram";
  }

  if (hostname.includes("reddit.com")) {
    return "reddit";
  }

  return "generic";
}

function detectPageType(platform, url) {
  const pathname = url.pathname;

  if (platform === "facebook") {
    if (pathname === "/profile.php" || pathname.split("/").filter(Boolean).length >= 1) {
      return "profile";
    }
  }

  if (platform === "instagram") {
    const firstSegment = pathname.split("/").filter(Boolean)[0];
    const nonProfileSegments = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct"]);
    return firstSegment && !nonProfileSegments.has(firstSegment) ? "profile" : "other";
  }

  if (platform === "reddit") {
    return pathname.startsWith("/user/") || pathname.startsWith("/u/") ? "profile" : "other";
  }

  if (platform === "telegram") {
    return pathname.split("/").filter(Boolean).length >= 1 ? "profile" : "other";
  }

  if (platform === "discord") {
    return "profile";
  }

  return "other";
}

function extractProfileId(platform, url) {
  const segments = url.pathname.split("/").filter(Boolean);

  if (platform === "facebook") {
    if (url.pathname === "/profile.php") {
      return url.searchParams.get("id");
    }

    return segments[0] || null;
  }

  if (platform === "instagram") {
    const firstSegment = segments[0];
    const blocked = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct"]);
    return firstSegment && !blocked.has(firstSegment) ? firstSegment : null;
  }

  if (platform === "reddit") {
    if (segments[0] === "user" || segments[0] === "u") {
      return segments[1] || null;
    }
  }

  if (platform === "telegram") {
    return segments[0] || null;
  }

  return segments[0] || null;
}

function extractProfileName(platform) {
  const metaSelectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="title"]'
  ];

  for (const selector of metaSelectors) {
    const content = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (content) {
      return cleanupName(content, platform);
    }
  }

  const heading = document.querySelector("h1");
  if (heading?.textContent?.trim()) {
    return cleanupName(heading.textContent.trim(), platform);
  }

  if (document.title) {
    return cleanupName(document.title, platform);
  }

  return null;
}

function cleanupName(value, platform) {
  const separators = {
    facebook: ["|"],
    instagram: ["•", "(", "|"],
    reddit: [" : ", " :"],
    telegram: ["|"]
  };

  const platformSeparators = separators[platform] || ["|", "-"];
  let normalized = value.replace(/\s+/g, " ").trim();

  for (const separator of platformSeparators) {
    if (normalized.includes(separator)) {
      normalized = normalized.split(separator)[0].trim();
    }
  }

  return normalized;
}

function extractProfilePhoto(platform) {
  const selectorsByPlatform = {
    facebook: [
      'meta[property="og:image"]',
      'image[xlink\\:href]',
      'img[alt*="profile picture" i]',
      'img[alt*="profil" i]'
    ],
    instagram: [
      'meta[property="og:image"]',
      'img[alt*="profile picture" i]',
      'header img'
    ],
    reddit: ['meta[property="og:image"]', 'img[alt*="avatar" i]'],
    telegram: ['meta[property="og:image"]'],
    discord: ['img[alt*="avatar" i]', 'img[class*="avatar"]']
  };

  const selectors = selectorsByPlatform[platform] || ['meta[property="og:image"]', "img"];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }

    if (element instanceof HTMLMetaElement) {
      const content = element.getAttribute("content");
      if (content) {
        return content;
      }
      continue;
    }

    if (element instanceof SVGImageElement) {
      const href = element.getAttribute("href") || element.getAttribute("xlink:href");
      if (href) {
        return href;
      }
      continue;
    }

    if (element instanceof HTMLImageElement && (element.currentSrc || element.src)) {
      return element.currentSrc || element.src;
    }
  }

  return null;
}

function extractSocialSignals(platform) {
  const visibleText = document.body?.innerText || "";
  const lines = visibleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const signals = {
    friendsLabel: null,
    followersLabel: null,
    sharedServersLabel: null,
    locationHints: extractLocationHints(lines)
  };

  if (platform === "facebook") {
    signals.friendsLabel = findLine(lines, /\b(friend|friends|přátel|friend requests)\b/i);
  } else if (platform === "instagram") {
    signals.followersLabel = findLine(lines, /\b(follower|followers|sledujících|following)\b/i);
  } else if (platform === "discord") {
    signals.sharedServersLabel = findLine(lines, /\b(shared servers|mutual servers)\b/i);
  }

  return signals;
}

function findLine(lines, pattern) {
  return lines.find((line) => pattern.test(line)) || null;
}

function extractLocationHints(lines) {
  const hints = [];

  for (const line of lines) {
    if (hints.length >= 3) {
      break;
    }

    if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}\- ]+,\s?[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}\- ]+$/u.test(line)) {
      hints.push(line);
      continue;
    }

    if (/\b(Praha|Brno|Ostrava|Plzeň|Olomouc|Pardubice|Hradec Králové)\b/u.test(line)) {
      hints.push(line);
    }
  }

  return hints.slice(0, 3);
}
