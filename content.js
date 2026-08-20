(() => {
  'use strict';

  if (window.__ghReadmeLightboxInstalled) return;
  window.__ghReadmeLightboxInstalled = true;

  const STYLE_ID = '__gh_readme_lightbox_style';
  const OVERLAY_ID = '__gh_readme_lightbox_overlay';
  const ZOOM_STEP = 0.18;
  const MAX_SCALE = 8;
  const MIN_SCALE_FLOOR = 0.05;
  const MIN_SCALE_RATIO = 0.35;
  const MIN_IMAGE_DIMENSION = 48;
  const MIN_IMAGE_AREA = 80 * 80;
  // A press that travels further than this is a drag/swipe, not a click, so it
  // must never be mistaken for a "click outside the image" close gesture.
  const CLICK_MOVE_TOLERANCE = 6;
  const COPY_BUTTON_LABEL = '复制图片';
  // Vertical strip reserved for the toolbar so it never sits on top of the image.
  const TOOLBAR_GAP = 24;
  const FALLBACK_RESERVE = 72;

  let directOpenLink = false;
  let copyFeedbackTimer = null;
  let prevHtmlOverflow = '';
  let previouslyFocused = null;

  chrome.storage.sync.get({ directOpenLink: false }, (result) => {
    directOpenLink = result.directOpenLink;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.directOpenLink) {
      directOpenLink = changes.directOpenLink.newValue;
    }
  });

  const state = {
    scale: 1,
    fitScale: 1,
    naturalWidth: 0,
    naturalHeight: 0,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastClientX: 0,
    lastClientY: 0,
    pointerId: null,
    previewSrc: '',
    originalLink: '',
    galleryItems: [],
    galleryIndex: 0,
    pointerMode: null,
    pointerStartX: 0,
    pointerStartY: 0,
    pointerMoved: false
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes ghrl-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes ghrl-pop-in {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }

      @keyframes ghrl-rise-in {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      @keyframes ghrl-spin {
        to { transform: rotate(360deg); }
      }

      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(88, 166, 255, 0.10), transparent 60%),
          rgba(8, 11, 17, 0.42);
        backdrop-filter: blur(22px) saturate(1.1);
        -webkit-backdrop-filter: blur(22px) saturate(1.1);
        animation: ghrl-fade-in 0.18s ease-out;
      }

      #${OVERLAY_ID}[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID}:focus {
        outline: none;
      }

      #${OVERLAY_ID} .ghrl-shell {
        position: relative;
        width: min(100%, 1880px);
        height: min(100%, 1280px);
      }

      #${OVERLAY_ID} .ghrl-stage {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: 28px;
        background: transparent;
        border: none;
        box-shadow: none;
        touch-action: none;
        cursor: grab;
        user-select: none;
      }

      #${OVERLAY_ID} .ghrl-stage.is-light {
        background: rgba(255, 255, 255, 0.9);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      }

      #${OVERLAY_ID} .ghrl-stage.is-dragging {
        cursor: grabbing;
      }

      #${OVERLAY_ID} .ghrl-content {
        position: absolute;
        left: 50%;
        top: calc(50% - var(--ghrl-reserve, ${FALLBACK_RESERVE}px) / 2);
        will-change: transform;
      }

      #${OVERLAY_ID} .ghrl-image {
        display: block;
        max-width: none;
        max-height: none;
        transform-origin: center center;
        will-change: transform;
        pointer-events: none;
        user-select: none;
        -webkit-user-drag: none;
        border-radius: 18px;
        /* Only opacity is animated here — transform is owned by the zoom/pan
           state and would fight a keyframed scale. */
        animation: ghrl-fade-in 0.24s ease-out;
        box-shadow:
          0 30px 90px rgba(0, 0, 0, 0.42),
          0 10px 30px rgba(0, 0, 0, 0.24),
          0 0 0 1px rgba(255, 255, 255, 0.08);
      }

      #${OVERLAY_ID} .ghrl-loading,
      #${OVERLAY_ID} .ghrl-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: #f0f6fc;
        font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.02em;
        background: rgba(255, 255, 255, 0.04);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 18px;
        animation: ghrl-fade-in 0.2s ease-out;
      }

      #${OVERLAY_ID} .ghrl-loading::before {
        content: '';
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid rgba(240, 246, 252, 0.25);
        border-top-color: #58a6ff;
        animation: ghrl-spin 0.7s linear infinite;
      }

      #${OVERLAY_ID} .ghrl-error {
        color: #ffb4ab;
      }

      #${OVERLAY_ID} .ghrl-error[hidden],
      #${OVERLAY_ID} .ghrl-loading[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} .ghrl-toolbar {
        position: absolute;
        left: 50%;
        right: auto;
        bottom: 14px;
        transform: translateX(-50%);
        box-sizing: border-box;
        /* max-content opts out of the shrink-to-fit cap that "left: 50%" would
           otherwise impose (available width = half the shell); max-width then
           keeps the bar inside the shell instead of past the viewport edge. */
        width: max-content;
        max-width: calc(100% - 24px);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px 12px;
        color: #f0f6fc;
        font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
        padding: 10px 14px;
        /* 20px is pixel-identical to 999px on the single-row bar (40px tall),
           but degrades sanely when the row wraps on narrow viewports. */
        border-radius: 20px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03)),
          rgba(16, 20, 28, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow:
          0 18px 44px rgba(0, 0, 0, 0.38),
          inset 0 1px 0 rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(18px) saturate(1.2);
        -webkit-backdrop-filter: blur(18px) saturate(1.2);
        animation: ghrl-rise-in 0.24s ease-out;
      }

      #${OVERLAY_ID} .ghrl-meta {
        min-width: 0;
        max-width: min(38vw, 420px);
        flex: 1 1 min(24vw, 320px);
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
      }

      #${OVERLAY_ID} .ghrl-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.96;
      }

      #${OVERLAY_ID} .ghrl-zoom {
        flex: none;
        padding: 2px 9px;
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
        font-size: 12px;
        letter-spacing: 0.02em;
        color: #cbd5e1;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      #${OVERLAY_ID} .ghrl-actions {
        display: flex;
        flex: 0 1 auto;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }

      #${OVERLAY_ID} .ghrl-btn {
        border: 1px solid rgba(240, 246, 252, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #f0f6fc;
        border-radius: 999px;
        padding: 8px 14px;
        text-decoration: none;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        white-space: nowrap;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
      }

      #${OVERLAY_ID} .ghrl-btn:hover {
        background: rgba(255, 255, 255, 0.16);
        border-color: rgba(240, 246, 252, 0.3);
        transform: translateY(-1px);
      }

      #${OVERLAY_ID} .ghrl-btn:active {
        transform: translateY(0);
        background: rgba(255, 255, 255, 0.22);
      }

      #${OVERLAY_ID} .ghrl-btn:focus-visible,
      #${OVERLAY_ID} .ghrl-nav:focus-visible {
        outline: 2px solid #58a6ff;
        outline-offset: 2px;
      }

      #${OVERLAY_ID} .ghrl-close {
        background: rgba(248, 113, 113, 0.16);
        border-color: rgba(248, 113, 113, 0.32);
      }

      #${OVERLAY_ID} .ghrl-close:hover {
        background: rgba(248, 113, 113, 0.28);
        border-color: rgba(248, 113, 113, 0.5);
      }

      #${OVERLAY_ID} .ghrl-btn[hidden] {
        display: none !important;
      }

      /* Vertically aligned with .ghrl-content so the arrows track the image
         centre rather than the stage centre. */
      #${OVERLAY_ID} .ghrl-nav {
        position: absolute;
        top: calc(50% - var(--ghrl-reserve, ${FALLBACK_RESERVE}px) / 2);
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        padding: 0;
        color: #f0f6fc;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03)),
          rgba(16, 20, 28, 0.55);
        box-shadow:
          0 18px 44px rgba(0, 0, 0, 0.38),
          inset 0 1px 0 rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(18px) saturate(1.2);
        -webkit-backdrop-filter: blur(18px) saturate(1.2);
        cursor: pointer;
        transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
      }

      #${OVERLAY_ID} .ghrl-nav[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} .ghrl-nav:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.24);
        /* translateY(-50%) is the centring transform — it must be repeated here
           or the arrow jumps to the stage top on hover. */
        transform: translateY(-50%) scale(1.06);
      }

      #${OVERLAY_ID} .ghrl-nav:active:not(:disabled) {
        transform: translateY(-50%) scale(0.98);
      }

      #${OVERLAY_ID} .ghrl-nav:disabled {
        opacity: 0.3;
        cursor: default;
      }

      #${OVERLAY_ID} .ghrl-nav svg {
        width: 22px;
        height: 22px;
        pointer-events: none;
      }

      #${OVERLAY_ID} .ghrl-prev {
        left: 14px;
      }

      #${OVERLAY_ID} .ghrl-next {
        right: 14px;
      }

      @media (max-width: 1080px) {
        #${OVERLAY_ID} {
          padding: 10px;
          padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        }

        #${OVERLAY_ID} .ghrl-shell {
          width: 100%;
          height: 100%;
        }

        #${OVERLAY_ID} .ghrl-toolbar {
          left: 0;
          right: 0;
          bottom: 0;
          width: auto;
          max-width: 100%;
          transform: none;
          justify-content: space-between;
          padding: 10px;
          border-radius: 22px;
        }

        #${OVERLAY_ID} .ghrl-meta {
          max-width: 100%;
        }

        #${OVERLAY_ID} .ghrl-actions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        #${OVERLAY_ID} .ghrl-btn {
          text-align: center;
        }

        #${OVERLAY_ID} .ghrl-nav {
          width: 38px;
          height: 38px;
        }

        #${OVERLAY_ID} .ghrl-nav svg {
          width: 19px;
          height: 19px;
        }

        #${OVERLAY_ID} .ghrl-prev {
          left: 6px;
        }

        #${OVERLAY_ID} .ghrl-next {
          right: 6px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #${OVERLAY_ID},
        #${OVERLAY_ID} .ghrl-image,
        #${OVERLAY_ID} .ghrl-toolbar,
        #${OVERLAY_ID} .ghrl-loading,
        #${OVERLAY_ID} .ghrl-error {
          animation: none;
        }

        #${OVERLAY_ID} .ghrl-btn,
        #${OVERLAY_ID} .ghrl-nav {
          transition: none;
        }

        #${OVERLAY_ID} .ghrl-loading::before {
          animation-duration: 2s;
        }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function hasImageExtension(pathname) {
    return /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i.test(pathname);
  }

  function normalizeUrl(urlString) {
    try {
      return new URL(urlString, location.href).toString();
    } catch {
      return '';
    }
  }

  function toRawGitHubImage(urlString) {
    try {
      const url = new URL(urlString, location.href);

      if (url.hostname !== 'github.com') return '';
      if (!hasImageExtension(url.pathname)) return '';

      if (url.pathname.includes('/blob/')) {
        url.pathname = url.pathname.replace('/blob/', '/raw/');
      }

      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function resolvePreviewSource(img, link) {
    const candidates = [];
    const pictureSource = img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset');

    if (img.currentSrc) candidates.push(img.currentSrc);
    if (img.src) candidates.push(img.src);

    const canonicalSrc = img.getAttribute('data-canonical-src');
    if (canonicalSrc) candidates.push(canonicalSrc);

    if (pictureSource) {
      const firstSrc = pictureSource.split(',')[0]?.trim().split(/\s+/)[0];
      if (firstSrc) candidates.push(firstSrc);
    }

    if (link?.href) {
      const rawFromLink = toRawGitHubImage(link.href);
      if (rawFromLink) candidates.push(rawFromLink);
    }

    return candidates.map(normalizeUrl).find(Boolean) || '';
  }

  function hasMeaningfulSize(img) {
    const rect = img.getBoundingClientRect();
    const width = rect.width || img.naturalWidth || 0;
    const height = rect.height || img.naturalHeight || 0;
    if (width === 0 || height === 0) return true;
    if (Math.min(width, height) < MIN_IMAGE_DIMENSION) return false;
    if (width * height < MIN_IMAGE_AREA) return false;
    return true;
  }

  function isReadmeImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.closest('article.markdown-body')) return false;
    if (img.closest(`#${OVERLAY_ID}`)) return false;
    if (!hasMeaningfulSize(img)) return false;
    return true;
  }

  function buildGalleryItemsForTarget(targetImg) {
    const images = Array.from(document.querySelectorAll('article.markdown-body img'));
    const items = [];
    let targetIndex = -1;

    images.forEach(img => {
      if (!isReadmeImage(img)) return;

      const link = img.closest('a[href]');
      const previewSrc = resolvePreviewSource(img, link);
      if (!previewSrc) return;

      const originalLink = link?.href || '';
      const label = img.alt || originalLink || previewSrc;
      const nextIndex = items.length;

      if (img === targetImg) {
        targetIndex = nextIndex;
      }

      items.push({
        previewSrc,
        originalLink,
        label
      });
    });

    if (targetIndex < 0) targetIndex = 0;

    return { items, targetIndex };
  }

  function clampGalleryIndex(index) {
    if (!state.galleryItems.length) return 0;
    return Math.min(state.galleryItems.length - 1, Math.max(0, index));
  }

  function openOverlayAtIndex(index) {
    if (!state.galleryItems.length) return;

    const nextIndex = clampGalleryIndex(index);
    const item = state.galleryItems[nextIndex];
    if (!item) return;

    state.galleryIndex = nextIndex;
    openOverlay(item.previewSrc, item.originalLink, item.label);
  }

  // Navigation is non-looping, so a step past either end is a no-op rather than
  // a reload of the image already on screen.
  function stepGallery(delta) {
    if (state.galleryItems.length < 2) return;

    const nextIndex = state.galleryIndex + delta;
    if (nextIndex < 0 || nextIndex >= state.galleryItems.length) return;

    openOverlayAtIndex(nextIndex);
  }

  function updateGalleryNav() {
    const { prev, next } = getElements();
    if (!prev || !next) return;

    const total = state.galleryItems.length;
    const hasGallery = total > 1;

    prev.hidden = !hasGallery;
    next.hidden = !hasGallery;
    prev.disabled = !hasGallery || state.galleryIndex <= 0;
    next.disabled = !hasGallery || state.galleryIndex >= total - 1;
  }

  function navigateFrom(button, delta) {
    stepGallery(delta);

    // Reaching an end disables the button under the cursor, which would drop
    // focus to <body> and take the dialog's keyboard shortcuts with it.
    if (button.disabled || button.hidden) {
      const { overlay } = getElements();
      if (overlay) overlay.focus({ preventScroll: true });
    }
  }

  function getElements() {
    const overlay = document.getElementById(OVERLAY_ID);
    return {
      overlay,
      shell: overlay?.querySelector('.ghrl-shell'),
      stage: overlay?.querySelector('.ghrl-stage'),
      content: overlay?.querySelector('.ghrl-content'),
      image: overlay?.querySelector('.ghrl-image'),
      loading: overlay?.querySelector('.ghrl-loading'),
      error: overlay?.querySelector('.ghrl-error'),
      title: overlay?.querySelector('.ghrl-title'),
      zoom: overlay?.querySelector('.ghrl-zoom'),
      openImage: overlay?.querySelector('.ghrl-open-image'),
      openLink: overlay?.querySelector('.ghrl-open-link'),
      toolbar: overlay?.querySelector('.ghrl-toolbar'),
      copy: overlay?.querySelector('.ghrl-copy'),
      bgToggle: overlay?.querySelector('.ghrl-bg-toggle'),
      prev: overlay?.querySelector('.ghrl-prev'),
      next: overlay?.querySelector('.ghrl-next')
    };
  }

  function getElementsFromOverlay(overlay) {
    return {
      stage: overlay.querySelector('.ghrl-stage'),
      image: overlay.querySelector('.ghrl-image')
    };
  }

  function updateTransform() {
    const { content, image } = getElements();
    if (!content || !image) return;

    content.style.transform = `translate(-50%, -50%) translate(${state.offsetX}px, ${state.offsetY}px)`;
    image.style.transform = `scale(${state.scale})`;
  }

  function getVerticalReserve() {
    const { stage, toolbar } = getElements();
    if (!stage) return FALLBACK_RESERVE;

    const measured = toolbar && toolbar.offsetHeight
      ? toolbar.offsetHeight + TOOLBAR_GAP
      : FALLBACK_RESERVE;

    // Never let the toolbar claim more than 60% of the stage on tiny viewports.
    return Math.min(measured, Math.max(0, stage.clientHeight * 0.6));
  }

  function syncReserveVar() {
    const { overlay } = getElements();
    if (!overlay) return;
    overlay.style.setProperty('--ghrl-reserve', `${getVerticalReserve()}px`);
  }

  function getStageBox() {
    const { stage } = getElements();
    if (!stage) return { width: 0, height: 0 };

    return {
      width: stage.clientWidth,
      height: Math.max(1, stage.clientHeight - getVerticalReserve())
    };
  }

  function getPanBounds() {
    const { stage } = getElements();
    if (!stage || !state.naturalWidth || !state.naturalHeight) {
      return { maxOffsetX: 0, maxOffsetY: 0 };
    }

    const scaledWidth = state.naturalWidth * state.scale;
    const scaledHeight = state.naturalHeight * state.scale;
    const box = getStageBox();

    return {
      maxOffsetX: Math.max(0, (scaledWidth - box.width) / 2),
      maxOffsetY: Math.max(0, (scaledHeight - box.height) / 2)
    };
  }

  function canPan() {
    const { maxOffsetX, maxOffsetY } = getPanBounds();
    return maxOffsetX > 0 || maxOffsetY > 0;
  }

  // The image itself is pointer-events:none (the stage owns pan/zoom input), so
  // hit-testing has to be geometric rather than target-based.
  function isPointInsideImage(clientX, clientY) {
    const { image } = getElements();
    if (!image || !state.naturalWidth || !state.naturalHeight) return false;

    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    return clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
  }

  function isPointInsideNav(clientX, clientY) {
    const { prev, next } = getElements();

    return [prev, next].some(button => {
      if (!button || button.hidden) return false;

      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      return clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
    });
  }

  function clampOffsets() {
    const { maxOffsetX, maxOffsetY } = getPanBounds();

    state.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, state.offsetX));
    state.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, state.offsetY));
  }

  function updateZoomLabel() {
    const { zoom } = getElements();
    if (!zoom) return;
    zoom.textContent = `${Math.round(state.scale * 100)}%`;
  }

  function resetView() {
    state.scale = state.fitScale;
    state.offsetX = 0;
    state.offsetY = 0;
    clampOffsets();
    updateTransform();
    updateZoomLabel();
  }

  function fitImageToStage() {
    const { stage, image } = getElements();
    if (!stage || !image || !state.naturalWidth || !state.naturalHeight) return;

    syncReserveVar();

    const box = getStageBox();
    const fitScale = Math.min(
      box.width / state.naturalWidth,
      box.height / state.naturalHeight,
      1
    );

    state.fitScale = Math.max(MIN_SCALE_FLOOR, fitScale || 1);
    resetView();
  }

  function getMinScale() {
    return Math.max(MIN_SCALE_FLOOR, state.fitScale * MIN_SCALE_RATIO);
  }

  function setScaleAt(clientX, clientY, nextScale) {
    const { stage } = getElements();
    if (!stage || !state.naturalWidth || !state.naturalHeight) return;

    const minScale = getMinScale();
    const clampedScale = Math.min(MAX_SCALE, Math.max(minScale, nextScale));
    const rect = stage.getBoundingClientRect();
    const localX = clientX - rect.left - rect.width / 2;
    const localY = clientY - rect.top - (rect.height - getVerticalReserve()) / 2;

    const ratio = clampedScale / state.scale;
    state.offsetX = localX - (localX - state.offsetX) * ratio;
    state.offsetY = localY - (localY - state.offsetY) * ratio;
    state.scale = clampedScale;

    clampOffsets();
    updateTransform();
    updateZoomLabel();
  }

  function zoomBy(step, clientX, clientY) {
    const factor = step > 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
    setScaleAt(clientX, clientY, state.scale * factor);
  }

  function toggleZoom(clientX, clientY) {
    const targetScale = Math.abs(state.scale - state.fitScale) < 0.01 ? 1 : state.fitScale;
    setScaleAt(clientX, clientY, targetScale);
    if (targetScale === state.fitScale) {
      state.offsetX = 0;
      state.offsetY = 0;
      clampOffsets();
      updateTransform();
      updateZoomLabel();
    }
  }

  function stopDragging() {
    const { stage } = getElements();
    state.dragging = false;
    state.pointerId = null;
    if (stage) stage.classList.remove('is-dragging');
  }

  function setCopyLabel(text, revertAfter) {
    const { overlay, copy } = getElements();
    if (!copy || !overlay || overlay.hidden) return;

    if (copyFeedbackTimer !== null) {
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = null;
    }

    copy.textContent = text;

    if (revertAfter) {
      copyFeedbackTimer = setTimeout(() => {
        const { copy: copyBtn } = getElements();
        if (copyBtn) copyBtn.textContent = COPY_BUTTON_LABEL;
        copyFeedbackTimer = null;
      }, revertAfter);
    }
  }

  function copyImage() {
    if (!state.previewSrc) return;

    fetch(state.previewSrc)
      .then(res => {
        if (!res.ok) throw new Error('fetch failed');
        return res.blob();
      })
      .then(blob => {
        if (blob.type === 'image/png') return blob;

        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(pngBlob => {
              if (pngBlob) resolve(pngBlob);
              else reject(new Error('canvas toBlob failed'));
            }, 'image/png');
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('image decode failed'));
          };
          img.src = URL.createObjectURL(blob);
        });
      })
      .then(pngBlob => navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]))
      .then(() => setCopyLabel('已复制', 1500))
      .catch(() => setCopyLabel('复制失败', 1500));
  }

  function toggleBackground() {
    const { stage, bgToggle } = getElements();
    if (!stage || !bgToggle) return;

    stage.classList.toggle('is-light');
    bgToggle.textContent = stage.classList.contains('is-light') ? '深色背景' : '浅色背景';
  }

  function closeOverlay() {
    const { overlay, image, loading, error, stage, bgToggle, copy } = getElements();
    if (!overlay) return;

    overlay.hidden = true;
    document.documentElement.style.overflow = prevHtmlOverflow;
    prevHtmlOverflow = '';

    if (stage && state.pointerId !== null) {
      try {
        stage.releasePointerCapture(state.pointerId);
      } catch {}
    }

    stopDragging();

    if (stage) stage.classList.remove('is-light');
    if (bgToggle) bgToggle.textContent = '浅色背景';

    if (copyFeedbackTimer !== null) {
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = null;
    }
    if (copy) copy.textContent = COPY_BUTTON_LABEL;

    state.previewSrc = '';
    state.originalLink = '';
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.scale = 1;
    state.fitScale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    state.pointerMode = null;
    state.pointerStartX = 0;
    state.pointerStartY = 0;
    state.pointerMoved = false;
    state.galleryItems = [];
    state.galleryIndex = 0;
    updateGalleryNav();

    if (image) {
      image.removeAttribute('src');
      image.style.width = '0px';
      image.style.height = '0px';
    }

    if (loading) loading.hidden = true;
    if (error) error.hidden = true;

    if (previouslyFocused) {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'README 图片预览');
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="ghrl-shell">
        <div class="ghrl-stage">
          <div class="ghrl-content">
            <img class="ghrl-image" alt="README 预览图" draggable="false">
          </div>
          <div class="ghrl-loading" hidden>图片加载中...</div>
          <div class="ghrl-error" hidden>图片加载失败，可尝试新标签打开。</div>
        </div>
        <button type="button" class="ghrl-nav ghrl-prev" aria-label="上一张" title="上一张 (←)" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>
        </button>
        <button type="button" class="ghrl-nav ghrl-next" aria-label="下一张" title="下一张 (→)" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
        <div class="ghrl-toolbar">
          <div class="ghrl-meta">
            <div class="ghrl-title"></div>
            <div class="ghrl-zoom">100%</div>
          </div>
          <div class="ghrl-actions">
            <a class="ghrl-btn ghrl-open-image" target="_blank" rel="noreferrer noopener">新标签打开图片</a>
            <a class="ghrl-btn ghrl-open-link" target="_blank" rel="noreferrer noopener" hidden>打开原链接</a>
            <button type="button" class="ghrl-btn ghrl-copy">${COPY_BUTTON_LABEL}</button>
            <button type="button" class="ghrl-btn ghrl-bg-toggle">浅色背景</button>
            <button type="button" class="ghrl-btn ghrl-reset">重置</button>
            <button type="button" class="ghrl-btn ghrl-close">关闭</button>
          </div>
        </div>
      </div>
    `;

    // Reset before the stage's own pointerdown so a click that starts on the
    // padding (outside the stage) never inherits a stale drag flag.
    overlay.addEventListener('pointerdown', function () {
      state.pointerMoved = false;
    }, true);

    overlay.addEventListener('click', function (event) {
      const target = event.target;
      const closest = target && typeof target.closest === 'function'
        ? selector => target.closest(selector)
        : () => null;

      if (closest('.ghrl-close')) {
        closeOverlay();
        return;
      }

      // The toolbar is a control surface, not "outside the image".
      if (closest('.ghrl-toolbar')) return;

      // Same for the prev/next arrows, which float over the empty stage area.
      // A disabled arrow may swallow its own click without dispatching one, so
      // the region is excluded geometrically as well.
      if (closest('.ghrl-nav')) return;
      if (isPointInsideNav(event.clientX, event.clientY)) return;

      // Ignore the click that terminates a pan or a swipe.
      if (state.pointerMoved) {
        state.pointerMoved = false;
        return;
      }

      if (isPointInsideImage(event.clientX, event.clientY)) return;

      closeOverlay();
    });

    const { stage, image } = getElementsFromOverlay(overlay);

    stage.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
    }, { passive: false });

    stage.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;

      state.pointerStartX = event.clientX;
      state.pointerStartY = event.clientY;
      state.pointerMoved = false;

      const canSwipe =
        state.naturalWidth > 0 &&
        state.naturalHeight > 0 &&
        !canPan() &&
        state.galleryItems.length > 1;

      state.pointerMode = canSwipe ? 'swipe' : 'pan';

      if (state.pointerMode === 'pan') {
        state.dragging = true;
        state.pointerId = event.pointerId;
        state.lastClientX = event.clientX;
        state.lastClientY = event.clientY;
        stage.classList.add('is-dragging');
        stage.setPointerCapture(event.pointerId);
      } else {
        state.dragging = false;
        state.pointerId = event.pointerId;
        stage.setPointerCapture(event.pointerId);
      }
    });

    stage.addEventListener('pointermove', function (event) {
      if (event.pointerId !== state.pointerId) return;

      if (!state.pointerMoved) {
        const travelX = Math.abs(event.clientX - state.pointerStartX);
        const travelY = Math.abs(event.clientY - state.pointerStartY);
        if (Math.max(travelX, travelY) > CLICK_MOVE_TOLERANCE) {
          state.pointerMoved = true;
        }
      }

      if (state.pointerMode === 'pan') {
        if (!state.dragging) return;

        state.offsetX += event.clientX - state.lastClientX;
        state.offsetY += event.clientY - state.lastClientY;
        state.lastClientX = event.clientX;
        state.lastClientY = event.clientY;

        clampOffsets();
        updateTransform();
      }
    });

    stage.addEventListener('pointerup', function (event) {
      if (event.pointerId !== state.pointerId) return;

      if (state.pointerMode === 'swipe') {
        const dx = event.clientX - state.pointerStartX;
        const dy = event.clientY - state.pointerStartY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDx >= 70 && absDx >= absDy * 1.2) {
          stepGallery(dx < 0 ? 1 : -1);
        }
      }

      state.pointerMode = null;
      stopDragging();
    });

    stage.addEventListener('pointercancel', function () {
      state.pointerMode = null;
      stopDragging();
    });

    stage.addEventListener('lostpointercapture', function () {
      state.pointerMode = null;
      stopDragging();
    });

    stage.addEventListener('dblclick', function (event) {
      event.preventDefault();
      toggleZoom(event.clientX, event.clientY);
    });

    image.addEventListener('load', function () {
      const { loading, error } = getElements();
      state.naturalWidth = image.naturalWidth || 1;
      state.naturalHeight = image.naturalHeight || 1;
      image.style.width = `${state.naturalWidth}px`;
      image.style.height = `${state.naturalHeight}px`;

      if (loading) loading.hidden = true;
      if (error) error.hidden = true;

      fitImageToStage();
    });

    image.addEventListener('error', function () {
      const { loading, error } = getElements();
      if (loading) loading.hidden = true;
      if (error) error.hidden = false;
    });

    overlay.querySelector('.ghrl-reset').addEventListener('click', resetView);
    overlay.querySelector('.ghrl-copy').addEventListener('click', copyImage);
    overlay.querySelector('.ghrl-bg-toggle').addEventListener('click', toggleBackground);

    const prevButton = overlay.querySelector('.ghrl-prev');
    const nextButton = overlay.querySelector('.ghrl-next');
    prevButton.addEventListener('click', function () {
      navigateFrom(prevButton, -1);
    });
    nextButton.addEventListener('click', function () {
      navigateFrom(nextButton, 1);
    });

    document.addEventListener('keydown', function (event) {
      const root = document.getElementById(OVERLAY_ID);
      if (!root || root.hidden) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target && typeof target.closest === 'function' &&
          target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay();
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetView();
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = stage.getBoundingClientRect();
        zoomBy(1, rect.left + rect.width / 2, rect.top + (rect.height - getVerticalReserve()) / 2);
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = stage.getBoundingClientRect();
        zoomBy(-1, rect.left + rect.width / 2, rect.top + (rect.height - getVerticalReserve()) / 2);
        return;
      }

      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        event.stopImmediatePropagation();
        copyImage();
        return;
      }

      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleBackground();
        return;
      }

      if (state.galleryItems.length > 1 && event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepGallery(-1);
        return;
      }

      if (state.galleryItems.length > 1 && event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepGallery(1);
      }
    }, true);

    window.addEventListener('resize', function () {
      const root = document.getElementById(OVERLAY_ID);
      if (!root || root.hidden || !state.naturalWidth || !state.naturalHeight) return;

      const currentScale = state.scale;
      fitImageToStage();

      if (currentScale > state.fitScale) {
        state.scale = currentScale;
        clampOffsets();
        updateTransform();
        updateZoomLabel();
      }
    });

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function openOverlay(previewSrc, originalLink, label) {
    injectStyle();
    ensureOverlay();

    const { overlay, image, loading, error, title, zoom, openImage, openLink } = getElements();
    if (!overlay || !image || !openImage || !openLink || !title || !zoom) return;

    const wasHidden = overlay.hidden;
    if (wasHidden) {
      prevHtmlOverflow = document.documentElement.style.overflow;
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    state.previewSrc = previewSrc;
    state.originalLink = normalizeUrl(originalLink);
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.scale = 1;
    state.fitScale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    state.pointerMode = null;
    state.pointerStartX = 0;
    state.pointerStartY = 0;

    const total = state.galleryItems.length;
    const titleText = label || previewSrc;
    title.textContent = total > 1
      ? `${titleText} (${state.galleryIndex + 1}/${total})`
      : titleText;
    zoom.textContent = '100%';
    openImage.href = previewSrc;
    updateGalleryNav();

    let shouldShowOriginalLink = false;
    if (state.originalLink) {
      try {
        shouldShowOriginalLink =
          state.originalLink !== previewSrc &&
          !toRawGitHubImage(state.originalLink) &&
          !hasImageExtension(new URL(state.originalLink).pathname);
      } catch {
        shouldShowOriginalLink = false;
      }
    }

    if (shouldShowOriginalLink) {
      openLink.hidden = false;
      openLink.href = state.originalLink;
    } else {
      openLink.hidden = true;
      openLink.removeAttribute('href');
    }

    if (loading) loading.hidden = false;
    if (error) error.hidden = true;

    image.removeAttribute('src');
    image.style.width = '0px';
    image.style.height = '0px';
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';

    if (wasHidden) {
      overlay.focus({ preventScroll: true });
    }

    requestAnimationFrame(function () {
      image.src = previewSrc;
    });
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const img = event.target.closest('img');
    if (!isReadmeImage(img)) return;

    const link = img.closest('a[href]');

    if (directOpenLink && link) {
      try {
        const linkUrl = new URL(link.href, location.href);
        if (!hasImageExtension(linkUrl.pathname) && !toRawGitHubImage(link.href)) {
          return;
        }
      } catch {
        return;
      }
    }

    const previewSrc = resolvePreviewSource(img, link);
    if (!previewSrc) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const { items, targetIndex } = buildGalleryItemsForTarget(img);
    state.galleryItems = items;
    state.galleryIndex = targetIndex;

    openOverlayAtIndex(state.galleryIndex);
  }, true);
})();