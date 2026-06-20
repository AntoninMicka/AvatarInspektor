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

    lastImageContext = {
      src: image.currentSrc || image.src || null,
      alt: image.alt || "",
      title: image.title || "",
      naturalWidth: image.naturalWidth || null,
      naturalHeight: image.naturalHeight || null,
      displayedWidth: image.clientWidth || null,
      displayedHeight: image.clientHeight || null
    };
  },
  true
);

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "avatar-inspector:get-last-image-context") {
    sendResponse(lastImageContext);
    return true;
  }

  return false;
});
