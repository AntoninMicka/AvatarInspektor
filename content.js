const extensionApi = globalThis.browser ?? globalThis.chrome;
let lastImageContext = null;

document.addEventListener(
  'contextmenu',
  (event) => {
    const image =
      event.target instanceof Element ? event.target.closest('img') : null;
    if (!image) {
      lastImageContext = null;
      return;
    }

    lastImageContext = buildImageContext(image);
  },
  true
);

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'avatar-inspector:get-last-image-context') {
    sendResponse(lastImageContext);
    return true;
  }

  if (message?.type === 'avatar-inspector:get-profile-context') {
    sendResponse(detectProfileContext());
    return true;
  }

  return false;
});

function buildImageContext(image) {
  return {
    src: image.currentSrc || image.src || null,
    alt: image.alt || '',
    title: image.title || '',
    naturalWidth: image.naturalWidth || null,
    naturalHeight: image.naturalHeight || null,
    displayedWidth: image.clientWidth || null,
    displayedHeight: image.clientHeight || null,
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
    pageTitle: document.title || '',
  };
}

function detectPlatform(hostname) {
  if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
    return 'facebook';
  }

  if (hostname.includes('instagram.com')) {
    return 'instagram';
  }

  if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) {
    return 'discord';
  }

  if (
    hostname.includes('telegram.me') ||
    hostname.includes('t.me') ||
    hostname.includes('telegram.org')
  ) {
    return 'telegram';
  }

  if (hostname.includes('reddit.com')) {
    return 'reddit';
  }

  return 'generic';
}

function detectPageType(platform, url) {
  const pathname = url.pathname;

  if (platform === 'facebook') {
    if (
      pathname === '/profile.php' ||
      pathname.split('/').filter(Boolean).length >= 1
    ) {
      return 'profile';
    }
  }

  if (platform === 'instagram') {
    const firstSegment = pathname.split('/').filter(Boolean)[0];
    const nonProfileSegments = new Set([
      'p',
      'reel',
      'reels',
      'stories',
      'explore',
      'accounts',
      'direct',
    ]);
    return firstSegment && !nonProfileSegments.has(firstSegment)
      ? 'profile'
      : 'other';
  }

  if (platform === 'reddit') {
    return pathname.startsWith('/user/') || pathname.startsWith('/u/')
      ? 'profile'
      : 'other';
  }

  if (platform === 'telegram') {
    return pathname.split('/').filter(Boolean).length >= 1
      ? 'profile'
      : 'other';
  }

  if (platform === 'discord') {
    return 'profile';
  }

  return 'other';
}

function extractProfileId(platform, url) {
  const segments = url.pathname.split('/').filter(Boolean);

  if (platform === 'facebook') {
    if (url.pathname === '/profile.php') {
      return url.searchParams.get('id');
    }

    return segments[0] || null;
  }

  if (platform === 'instagram') {
    const firstSegment = segments[0];
    const blocked = new Set([
      'p',
      'reel',
      'reels',
      'stories',
      'explore',
      'accounts',
      'direct',
    ]);
    return firstSegment && !blocked.has(firstSegment) ? firstSegment : null;
  }

  if (platform === 'reddit') {
    if (segments[0] === 'user' || segments[0] === 'u') {
      return segments[1] || null;
    }
  }

  if (platform === 'telegram') {
    return segments[0] || null;
  }

  return segments[0] || null;
}

function extractProfileName(platform) {
  const metaSelectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="title"]',
  ];

  for (const selector of metaSelectors) {
    const content = document
      .querySelector(selector)
      ?.getAttribute('content')
      ?.trim();
    if (content) {
      return cleanupName(content, platform);
    }
  }

  const heading = document.querySelector('h1');
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
    facebook: ['|'],
    instagram: ['•', '(', '|'],
    reddit: [' : ', ' :'],
    telegram: ['|'],
  };

  const platformSeparators = separators[platform] || ['|', '-'];
  let normalized = value.replace(/\s+/g, ' ').trim();

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
      'image[href]',
      'image[xlink\\:href]',
      'a[aria-label*="profile picture" i] img',
      'a[aria-label*="profil" i] img',
      '[role="main"] image[href]',
      '[role="main"] image[xlink\\:href]',
      'img[alt*="profile picture" i]',
      'img[alt*="profil" i]',
      'img[src*="scontent" i]',
      'img[src*="fbcdn" i]',
    ],
    instagram: [
      'meta[property="og:image"]',
      'img[alt*="profile picture" i]',
      'header img',
    ],
    reddit: ['meta[property="og:image"]', 'img[alt*="avatar" i]'],
    telegram: ['meta[property="og:image"]'],
    discord: ['img[alt*="avatar" i]', 'img[class*="avatar"]'],
  };

  const selectors = selectorsByPlatform[platform] || [
    'meta[property="og:image"]',
    'img',
  ];

  if (platform === 'facebook') {
    return extractFacebookProfilePhoto(selectors);
  }

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const source = getElementImageSource(element);
    if (source) {
      return source;
    }
  }

  return null;
}

function extractFacebookProfilePhoto(selectors) {
  const headImage = document
    .querySelector('meta[property="og:image"], meta[name="twitter:image"]')
    ?.getAttribute('content');
  if (headImage && !headImage.startsWith('data:')) {
    return headImage;
  }

  const candidates = [];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const source = getElementImageSource(element);
      if (!source) {
        continue;
      }

      candidates.push({
        source,
        score: scoreFacebookPhotoCandidate(element, source),
      });
    }
  }

  const bestCandidate = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  return bestCandidate?.source || null;
}

function getElementImageSource(element) {
  if (!element) {
    return null;
  }

  if (element instanceof HTMLMetaElement) {
    return element.getAttribute('content') || null;
  }

  if (element instanceof SVGImageElement) {
    return (
      element.getAttribute('href') || element.getAttribute('xlink:href') || null
    );
  }

  if (element instanceof HTMLImageElement) {
    return element.currentSrc || element.src || null;
  }

  return null;
}

function scoreFacebookPhotoCandidate(element, source) {
  let score = 0;
  const sourceText = source.toLowerCase();
  const altText = getElementAltText(element).toLowerCase();
  const ariaLabel = getNearestLabel(element).toLowerCase();
  const rect =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;
  const width =
    element instanceof HTMLImageElement
      ? element.naturalWidth || element.clientWidth || 0
      : rect?.width || 0;
  const height =
    element instanceof HTMLImageElement
      ? element.naturalHeight || element.clientHeight || 0
      : rect?.height || 0;
  const shortEdge = Math.min(width || 0, height || 0);
  const aspectDelta =
    width && height ? Math.abs(width - height) / Math.max(width, height) : 1;

  if (sourceText.includes('fbcdn') || sourceText.includes('scontent')) {
    score += 2;
  }

  if (sourceText.includes('profile') || sourceText.includes('profile_pic')) {
    score += 2;
  }

  if (altText.includes('profile picture') || altText.includes('profil')) {
    score += 4;
  }

  if (ariaLabel.includes('profile picture') || ariaLabel.includes('profil')) {
    score += 3;
  }

  if (shortEdge >= 96) {
    score += 1;
  }

  if (shortEdge >= 160) {
    score += 1;
  }

  if (aspectDelta <= 0.12) {
    score += 1;
  }

  if (element.closest('a[href*="photo"]') || element.closest('[role="main"]')) {
    score += 1;
  }

  if (sourceText.startsWith('data:')) {
    score -= 4;
  }

  if (sourceText.includes('/emoji.php') || sourceText.includes('safe_image')) {
    score -= 5;
  }

  return score;
}

function getElementAltText(element) {
  if (element instanceof HTMLImageElement) {
    return element.alt || '';
  }

  return '';
}

function getNearestLabel(element) {
  return (
    element?.getAttribute?.('aria-label') ||
    element?.closest?.('[aria-label]')?.getAttribute?.('aria-label') ||
    ''
  );
}

function extractSocialSignals(platform) {
  const visibleText = document.body?.innerText || '';
  const lines = visibleText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const signals = {
    friendsLabel: null,
    followersLabel: null,
    sharedServersLabel: null,
    locationHints: extractLocationHints(lines),
  };

  if (platform === 'facebook') {
    signals.friendsLabel = findLine(
      lines,
      /\b(friend|friends|přátel|friend requests)\b/i
    );
  } else if (platform === 'instagram') {
    signals.followersLabel = findLine(
      lines,
      /\b(follower|followers|sledujících|following)\b/i
    );
  } else if (platform === 'discord') {
    signals.sharedServersLabel = findLine(
      lines,
      /\b(shared servers|mutual servers)\b/i
    );
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

    if (
      /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}\- ]+,\s?[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}\- ]+$/u.test(
        line
      )
    ) {
      hints.push(line);
      continue;
    }

    if (
      /\b(Praha|Brno|Ostrava|Plzeň|Olomouc|Pardubice|Hradec Králové)\b/u.test(
        line
      )
    ) {
      hints.push(line);
    }
  }

  return hints.slice(0, 3);
}
