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
    originalLabel: ''
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(10, 14, 20, 0.1);
        backdrop-filter: blur(20px) saturate(1.08);
        -webkit-backdrop-filter: blur(20px) saturate(1.08);
      }

      #${OVERLAY_ID}[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} .ghrl-shell {
        position: relative;
        width: min(98vw, 1880px);
        height: min(96vh, 1280px);
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

      #${OVERLAY_ID} .ghrl-stage.is-dragging {
        cursor: grabbing;
      }

      #${OVERLAY_ID} .ghrl-content {
        position: absolute;
        left: 50%;
        top: 50%;
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
        box-shadow:
          0 24px 80px rgba(0, 0, 0, 0.18),
          0 10px 30px rgba(0, 0, 0, 0.1);
      }

      #${OVERLAY_ID} .ghrl-loading,
      #${OVERLAY_ID} .ghrl-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f0f6fc;
        font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.02em;
        background: rgba(255, 255, 255, 0.04);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 18px;
      }

      #${OVERLAY_ID} .ghrl-error[hidden],
      #${OVERLAY_ID} .ghrl-loading[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} .ghrl-toolbar {
        position: absolute;
        left: 50%;
        bottom: 14px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: #f0f6fc;
        font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(18, 22, 30, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow:
          0 12px 34px rgba(0, 0, 0, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(16px) saturate(1.12);
        -webkit-backdrop-filter: blur(16px) saturate(1.12);
      }

      #${OVERLAY_ID} .ghrl-meta {
        min-width: min(24vw, 320px);
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
      }

      #${OVERLAY_ID} .ghrl-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.96;
      }

      #${OVERLAY_ID} .ghrl-zoom {
        flex: none;
        opacity: 0.82;
      }

      #${OVERLAY_ID} .ghrl-actions {
        display: flex;
        gap: 8px;
        flex-wrap: nowrap;
        justify-content: center;
      }

      #${OVERLAY_ID} .ghrl-btn {
        border: 1px solid rgba(240, 246, 252, 0.18);
        background: rgba(255, 255, 255, 0.08);
        color: #f0f6fc;
        border-radius: 999px;
        padding: 8px 13px;
        text-decoration: none;
        cursor: pointer;
        font: inherit;
        white-space: nowrap;
      }

      #${OVERLAY_ID} .ghrl-btn:hover {
        background: rgba(255, 255, 255, 0.14);
      }

      #${OVERLAY_ID} .ghrl-btn[hidden] {
        display: none !important;
      }

      @media (max-width: 768px) {
        #${OVERLAY_ID} {
          padding: 10px;
        }

        #${OVERLAY_ID} .ghrl-shell {
          width: 100vw;
          height: 100vh;
        }

        #${OVERLAY_ID} .ghrl-toolbar {
          left: 10px;
          right: 10px;
          bottom: 10px;
          transform: none;
          justify-content: space-between;
          padding: 10px;
          border-radius: 22px;
        }

        #${OVERLAY_ID} .ghrl-actions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        #${OVERLAY_ID} .ghrl-btn {
          text-align: center;
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

  function isReadmeImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.closest('article.markdown-body')) return false;
    if (img.closest(`#${OVERLAY_ID}`)) return false;
    return true;
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
      openLink: overlay?.querySelector('.ghrl-open-link')
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

  function clampOffsets() {
    const { stage } = getElements();
    if (!stage || !state.naturalWidth || !state.naturalHeight) return;

    const scaledWidth = state.naturalWidth * state.scale;
    const scaledHeight = state.naturalHeight * state.scale;

    const maxOffsetX = Math.max(0, (scaledWidth - stage.clientWidth) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - stage.clientHeight) / 2);

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

    const fitScale = Math.min(
      stage.clientWidth / state.naturalWidth,
      stage.clientHeight / state.naturalHeight,
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
    const localY = clientY - rect.top - rect.height / 2;

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

  function closeOverlay() {
    const { overlay, image, loading, error, stage } = getElements();
    if (!overlay) return;

    overlay.hidden = true;
    document.documentElement.style.overflow = '';

    if (stage && state.pointerId !== null) {
      try {
        stage.releasePointerCapture(state.pointerId);
      } catch {}
    }

    stopDragging();

    state.previewSrc = '';
    state.originalLink = '';
    state.originalLabel = '';
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.scale = 1;
    state.fitScale = 1;
    state.offsetX = 0;
    state.offsetY = 0;

    if (image) {
      image.removeAttribute('src');
      image.style.width = '0px';
      image.style.height = '0px';
    }

    if (loading) loading.hidden = true;
    if (error) error.hidden = true;
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ghrl-shell">
        <div class="ghrl-stage">
          <div class="ghrl-content">
            <img class="ghrl-image" alt="README 预览图" draggable="false">
          </div>
          <div class="ghrl-loading" hidden>图片加载中...</div>
          <div class="ghrl-error" hidden>图片加载失败，可尝试新标签打开。</div>
        </div>
        <div class="ghrl-toolbar">
          <div class="ghrl-meta">
            <div class="ghrl-title"></div>
            <div class="ghrl-zoom">100%</div>
          </div>
          <div class="ghrl-actions">
            <a class="ghrl-btn ghrl-open-image" target="_blank" rel="noreferrer noopener">新标签打开图片</a>
            <a class="ghrl-btn ghrl-open-link" target="_blank" rel="noreferrer noopener" hidden>打开原链接</a>
            <button type="button" class="ghrl-btn ghrl-reset">重置</button>
            <button type="button" class="ghrl-btn ghrl-close">关闭</button>
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.classList.contains('ghrl-close')) {
        closeOverlay();
      }
    });

    const { stage, image } = getElementsFromOverlay(overlay);

    stage.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
    }, { passive: false });

    stage.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;

      state.dragging = true;
      state.pointerId = event.pointerId;
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;
      stage.classList.add('is-dragging');
      stage.setPointerCapture(event.pointerId);
    });

    stage.addEventListener('pointermove', function (event) {
      if (!state.dragging || event.pointerId !== state.pointerId) return;

      state.offsetX += event.clientX - state.lastClientX;
      state.offsetY += event.clientY - state.lastClientY;
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;

      clampOffsets();
      updateTransform();
    });

    stage.addEventListener('pointerup', stopDragging);
    stage.addEventListener('pointercancel', stopDragging);
    stage.addEventListener('lostpointercapture', stopDragging);

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

    document.addEventListener('keydown', function (event) {
      const root = document.getElementById(OVERLAY_ID);
      if (!root || root.hidden) return;

      if (event.key === 'Escape') {
        closeOverlay();
        return;
      }

      if (event.key === '0') {
        resetView();
        return;
      }

      if (event.key === '+' || event.key === '=') {
        const rect = stage.getBoundingClientRect();
        zoomBy(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }

      if (event.key === '-') {
        const rect = stage.getBoundingClientRect();
        zoomBy(-1, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    });

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

    state.previewSrc = previewSrc;
    state.originalLink = normalizeUrl(originalLink);
    state.originalLabel = label;
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.scale = 1;
    state.fitScale = 1;
    state.offsetX = 0;
    state.offsetY = 0;

    title.textContent = label || previewSrc;
    zoom.textContent = '100%';
    openImage.href = previewSrc;

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
    const previewSrc = resolvePreviewSource(img, link);
    if (!previewSrc) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    openOverlay(previewSrc, link?.href || '', img.alt || link?.href || previewSrc);
  }, true);
})();