import WebSR from '@websr/websr/src/main.ts';
import weights from '@websr/websr/weights/anime4k/cnn-2x-m-rl.json';

const api = globalThis.browser ?? globalThis.chrome;
const IMAGE_SELECTOR = 'article img[src], img[src*="cdninstagram"]';
const MIN_RENDERED_IMAGE_SIZE = 180;
const SAFE_MAX_CANVAS_DIMENSION = 8192;
// Keep the previous supported output ceiling. GPU work is tiled and is now
// cancellable, so this must not unnecessarily remove valid Instagram images.
const SAFE_MAX_OUTPUT_PIXELS = 64_000_000;
const GPU_TILE_SIZE = 512;
const GPU_TILE_OVERLAP = 12;
const processed = new WeakSet();
const visibleButtonObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const button = entry.target.querySelector(':scope > .ig-ai-upscale-button');
    if (button) button.classList.toggle('ig-ai-visible', entry.isIntersecting && entry.intersectionRatio >= 0.5);
  }
}, { threshold: [0, 0.5] });
const imageSizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const image = entry.target;
    if (image instanceof HTMLImageElement && image.matches(IMAGE_SELECTOR)) addButton(image);
  }
});

function sourceIsUsable(image) {
  return image.complete && image.naturalWidth >= 96 && image.naturalHeight >= 96;
}

function isSmallRenderedImage(image) {
  const { width, height } = image.getBoundingClientRect();
  return width > 0 && height > 0 && (width < MIN_RENDERED_IMAGE_SIZE || height < MIN_RENDERED_IMAGE_SIZE);
}

function removeButton(image) {
  const anchor = image.parentElement;
  const button = anchor?.querySelector(':scope > .ig-ai-upscale-button');
  if (!button) return;
  visibleButtonObserver.unobserve(anchor);
  button.remove();
  processed.delete(image);
}

function getImageSourceCandidates(image) {
  const candidates = new Map();
  const addCandidate = (value, width = 0, source = 'visible image') => {
    if (!value) return;
    try {
      const url = new URL(value, document.baseURI).href;
      const existing = candidates.get(url);
      if (!existing || width >= existing.width) candidates.set(url, { url, width, source });
    } catch {
      // Ignore malformed responsive-image candidates and continue with the visible source.
    }
  };
  let filename = '';
  try {
    filename = new URL(image.currentSrc || image.src, document.baseURI).pathname.split('/').at(-1) ?? '';
  } catch {
    // The DOM candidates below remain available when the visible URL is malformed.
  }
  if (filename) {
    const visited = new Set();
    const visit = (value) => {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      const mediaCandidates = value.image_versions2?.candidates;
      if (Array.isArray(mediaCandidates)) {
        mediaCandidates.forEach((candidate, index) => {
          if (typeof candidate?.url === 'string' && candidate.url.includes(filename)) {
            // Instagram orders this list from the original/full media first.
            addCandidate(candidate.url, Number.MAX_SAFE_INTEGER - index, 'full post media');
          }
        });
      }
      for (const nestedValue of Object.values(value)) visit(nestedValue);
    };
    for (const script of document.scripts) {
      const text = script.textContent;
      if (!text?.includes(filename) || !text.includes('image_versions2')) continue;
      try {
        visit(JSON.parse(text));
      } catch {
        // Instagram also uses non-JSON scripts; the DOM candidates remain available.
      }
    }
  }
  for (const item of image.srcset.split(',')) {
    const parts = item.trim().split(/\s+/);
    const descriptor = parts.at(-1) ?? '';
    const hasWidthDescriptor = /^\d+w$/.test(descriptor);
    addCandidate(hasWidthDescriptor ? parts.slice(0, -1).join(' ') : item.trim(), hasWidthDescriptor ? Number.parseInt(descriptor, 10) : 0, 'responsive image');
  }
  addCandidate(image.currentSrc, image.naturalWidth, 'visible image');
  addCandidate(image.src, image.naturalWidth, 'visible image');
  return [...candidates.values()].sort((first, second) => second.width - first.width);
}

async function loadPageImageBitmap(url) {
  const pageImage = new Image();
  pageImage.crossOrigin = 'anonymous';
  pageImage.src = url;
  await pageImage.decode();
  if (pageImage.naturalWidth < 1 || pageImage.naturalHeight < 1) {
    throw new Error('The page could not load the source image.');
  }
  return createImageBitmap(pageImage);
}

async function getCleanImageBitmap(image) {
  let lastError = new Error('The extension could not retrieve the source image.');
  for (const candidate of getImageSourceCandidates(image)) {
    try {
      return {
        bitmap: await loadPageImageBitmap(candidate.url),
        source: `${candidate.source} via page`
      };
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
    try {
      const response = await api.runtime.sendMessage({
        type: 'fetch-instagram-image',
        url: candidate.url
      });
      if (!response?.bytes) throw lastError;
      return {
        bitmap: await createImageBitmap(new Blob([response.bytes], { type: response.contentType })),
        source: `${candidate.source} via extension`
      };
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

function getAnchor(image) {
  const parent = image.parentElement;
  if (!parent) return null;
  const style = getComputedStyle(parent);
  if (style.position === 'static') parent.style.position = 'relative';
  return parent;
}

function addButton(image) {
  imageSizeObserver.observe(image);
  if (!sourceIsUsable(image)) return;
  if (isSmallRenderedImage(image)) {
    removeButton(image);
    return;
  }
  if (processed.has(image)) return;
  const anchor = getAnchor(image);
  if (!anchor || anchor.querySelector(':scope > .ig-ai-upscale-button')) return;
  processed.add(image);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ig-ai-upscale-button';
  button.textContent = '✦ Upscale';
  button.title = 'Upscale this image locally';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!sourceIsUsable(image)) return;
    const { scale } = await api.storage.local.get({ scale: 2 });
    await showUpscaleModal(image, [2, 4].includes(Number(scale)) ? Number(scale) : 2);
  }, true);
  anchor.append(button);
  visibleButtonObserver.observe(anchor);
}

function scan(root = document) {
  root.querySelectorAll?.(IMAGE_SELECTOR).forEach(addButton);
}

function closeModal(modal) {
  document.removeEventListener('keydown', modal._onKeydown, true);
  modal._cancelUpscale?.();
  modal._releaseResources?.();
  modal.remove();
}

function createModal(scale) {
  const modal = document.createElement('div');
  modal.className = 'ig-ai-modal';
  const panel = document.createElement('section');
  panel.className = 'ig-ai-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Upscaled image');
  const toolbar = document.createElement('header');
  toolbar.className = 'ig-ai-toolbar';
  const title = document.createElement('span');
  title.className = 'ig-ai-title';
  title.textContent = `AI Upscale · ${scale}×`;
  toolbar.append(title);
  const targetScale = document.createElement('select');
  targetScale.dataset.action = 'target-scale';
  targetScale.setAttribute('aria-label', 'Target upscale amount');
  targetScale.disabled = true;
  const applyScale = document.createElement('button');
  applyScale.type = 'button';
  applyScale.dataset.action = 'apply-scale';
  applyScale.textContent = 'Apply';
  applyScale.disabled = true;
  toolbar.append(targetScale, applyScale);
  for (const [action, label, symbol] of [['zoom-out', 'Zoom out', '−'], ['zoom-in', 'Zoom in', '+'], ['download', 'Download PNG', '⇩'], ['fullscreen', 'Full screen', '⛶'], ['close', 'Close', '×']]) {
    const control = document.createElement('button');
    control.type = 'button';
    control.dataset.action = action;
    control.setAttribute('aria-label', label);
    control.textContent = symbol;
    if (action === 'download') control.disabled = true;
    toolbar.append(control);
  }
  const stage = document.createElement('div');
  stage.className = 'ig-ai-stage';
  const progress = document.createElement('span');
  progress.className = 'ig-ai-progress';
  progress.textContent = 'Preparing local AI upscaling…';
  const help = document.createElement('span');
  help.className = 'ig-ai-help';
  help.textContent = 'Wheel: zoom · drag: move · middle click: reset';
  stage.append(progress, help);
  panel.append(toolbar, stage);
  modal.append(panel);
  const onKeydown = (event) => {
    if (event.key === 'Escape') closeModal(modal);
  };
  modal._onKeydown = onKeydown;
  document.addEventListener('keydown', onKeydown, true);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-action="close"]')) closeModal(modal);
  });
  document.body.append(modal);
  return modal;
}

function attachZoom(stage, canvas) {
  const controller = new AbortController();
  const eventOptions = { signal: controller.signal };
  const fitZoom = () => Math.min(1, stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
  let zoom = fitZoom();
  let x = 0;
  let y = 0;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  const apply = () => { canvas.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${zoom})`; };
  const changeZoom = (delta, clientX, clientY) => {
    const nextZoom = Math.min(5, Math.max(Math.min(.25, fitZoom()), zoom + delta));
    if (nextZoom === zoom) return;
    const bounds = stage.getBoundingClientRect();
    const focalX = clientX ?? bounds.left + bounds.width / 2;
    const focalY = clientY ?? bounds.top + bounds.height / 2;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const imageX = (focalX - centerX - x) / zoom + canvas.width / 2;
    const imageY = (focalY - centerY - y) / zoom + canvas.height / 2;
    zoom = nextZoom;
    x = focalX - centerX - zoom * (imageX - canvas.width / 2);
    y = focalY - centerY - zoom * (imageY - canvas.height / 2);
    apply();
  };
  stage.closest('.ig-ai-panel').querySelector('[data-action="zoom-in"]').onclick = () => changeZoom(.25);
  stage.closest('.ig-ai-panel').querySelector('[data-action="zoom-out"]').onclick = () => changeZoom(-.25);
  const fullscreenButton = stage.closest('.ig-ai-panel').querySelector('[data-action="fullscreen"]');
  fullscreenButton.onclick = async () => {
    if (document.fullscreenElement === stage) await document.exitFullscreen();
    else await stage.requestFullscreen();
  };
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.setAttribute('aria-label', document.fullscreenElement === stage ? 'Exit full screen' : 'Full screen');
  }, eventOptions);
  stage.addEventListener('wheel', (event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? .15 : -.15, event.clientX, event.clientY); }, { passive: false, signal: controller.signal });
  stage.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      zoom = fitZoom();
      x = 0;
      y = 0;
      apply();
      return;
    }
    if (event.button !== 0) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    stage.setPointerCapture(event.pointerId);
  }, eventOptions);
  stage.addEventListener('pointermove', (event) => { if (!dragging) return; x += event.clientX - pointerX; y += event.clientY - pointerY; pointerX = event.clientX; pointerY = event.clientY; apply(); }, eventOptions);
  stage.addEventListener('pointerup', () => { dragging = false; }, eventOptions);
  const help = document.createElement('span');
  help.className = 'ig-ai-help';
  help.textContent = 'Wheel: zoom · drag: move · middle click: reset';
  stage.append(help);
  requestAnimationFrame(() => {
    zoom = fitZoom();
    x = 0;
    y = 0;
    apply();
  });
  return () => controller.abort();
}

function upscaleWithCpu(image, scale) {
  const output = document.createElement('canvas');
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  output.width = width * scale;
  output.height = height * scale;
  const context = output.getContext('2d');
  if (!context) throw new Error('Your browser could not create a CPU canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, output.width, output.height);
  return output;
}

function getMediaDimensions(source) {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

function getUpscaleLimit(source, scale, device) {
  const { width, height } = getMediaDimensions(source);
  const deviceMaximum = Number(device?.limits?.maxTextureDimension2D);
  const maximum = Number.isFinite(deviceMaximum)
    ? Math.min(SAFE_MAX_CANVAS_DIMENSION, deviceMaximum)
    : SAFE_MAX_CANVAS_DIMENSION;
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  if (outputWidth > maximum || outputHeight > maximum || outputWidth * outputHeight > SAFE_MAX_OUTPUT_PIXELS) {
    return `Not available: ${outputWidth}×${outputHeight} exceeds this browser's supported canvas limit.`;
  }
  return null;
}

function getAvailableScales(source, device) {
  return [2, 4].filter((scale) => !getUpscaleLimit(source, scale, device));
}

function showLimitNotice(stage, message) {
  stage.querySelector('.ig-ai-limit')?.remove();
  const notice = document.createElement('p');
  notice.className = 'ig-ai-limit';
  notice.textContent = message;
  stage.append(notice);
  setTimeout(() => notice.remove(), 4200);
}

async function downloadCanvas(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not export this image as PNG.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `instagram-upscaled-${canvas.width}x${canvas.height}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function copyGpuCanvas(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d');
  if (!context) throw new Error('The browser could not copy the GPU result.');
  context.drawImage(canvas, 0, 0);
  return copy;
}

function releaseGpuEngine(engine) {
  // WebSR owns buffers for one render, but its public destroy() method also
  // destroys the shared GPU device. Release only per-engine resources so the
  // next tile can use the same device without retaining every prior tile.
  const context = engine.context;
  if (!context) return;
  for (const buffer of Object.values(context.buffers)) buffer.destroy();
  for (const [name, texture] of Object.entries(context.textures)) {
    if (name !== 'output') texture.destroy();
  }
  context.context.unconfigure();
  engine.context = undefined;
  engine.renderer = undefined;
  engine.network = undefined;
}

async function upscaleWithGpu(source, scale, device) {
  let input = source;
  for (let pass = 0; pass < Math.log2(scale); pass += 1) {
    if (input instanceof HTMLCanvasElement) input = await createImageBitmap(input);
    const tileInput = input;
    const gpuCanvas = document.createElement('canvas');
    const engine = new WebSR({ network_name: 'anime4k/cnn-2x-m', weights, gpu: device, canvas: gpuCanvas });
    try {
      await engine.render(input);
      await device.queue.onSubmittedWorkDone();
      input = copyGpuCanvas(gpuCanvas);
    } finally {
      if (tileInput instanceof ImageBitmap) tileInput.close();
      releaseGpuEngine(engine);
    }
  }
  return input;
}

async function upscaleWithTiledGpu(source, scale, device, onProgress) {
  const { width, height } = getMediaDimensions(source);
  const output = document.createElement('canvas');
  output.width = width * scale;
  output.height = height * scale;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('The browser could not create the output canvas.');
  const columns = Math.ceil(width / GPU_TILE_SIZE);
  const rows = Math.ceil(height / GPU_TILE_SIZE);
  let completed = 0;

  for (let y = 0; y < height; y += GPU_TILE_SIZE) {
    for (let x = 0; x < width; x += GPU_TILE_SIZE) {
      const coreWidth = Math.min(GPU_TILE_SIZE, width - x);
      const coreHeight = Math.min(GPU_TILE_SIZE, height - y);
      const sourceX = Math.max(0, x - GPU_TILE_OVERLAP);
      const sourceY = Math.max(0, y - GPU_TILE_OVERLAP);
      const sourceRight = Math.min(width, x + coreWidth + GPU_TILE_OVERLAP);
      const sourceBottom = Math.min(height, y + coreHeight + GPU_TILE_OVERLAP);
      const tileWidth = sourceRight - sourceX;
      const tileHeight = sourceBottom - sourceY;
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileWidth;
      tileCanvas.height = tileHeight;
      const tileContext = tileCanvas.getContext('2d');
      if (!tileContext) throw new Error('The browser could not create a GPU tile.');
      tileContext.drawImage(source, sourceX, sourceY, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
      const tileSource = await createImageBitmap(tileCanvas);
      const upscaledTile = await upscaleWithGpu(tileSource, scale, device);
      const cropX = (x - sourceX) * scale;
      const cropY = (y - sourceY) * scale;
      outputContext.drawImage(upscaledTile, cropX, cropY, coreWidth * scale, coreHeight * scale, x * scale, y * scale, coreWidth * scale, coreHeight * scale);
      completed += 1;
      onProgress?.(completed, columns * rows);
    }
  }
  return output;
}

async function showUpscaleModal(image, scale) {
  const modal = createModal(scale);
  const stage = modal.querySelector('.ig-ai-stage');
  const title = modal.querySelector('.ig-ai-title');
  const targetScale = modal.querySelector('[data-action="target-scale"]');
  const applyScale = modal.querySelector('[data-action="apply-scale"]');
  const downloadButton = modal.querySelector('[data-action="download"]');
  let clearZoom = () => {};
  let output;
  let original;
  let selectedScale = scale;
  let usingGpu = false;
  let sourceLabel = 'visible image';
  let device = false;
  let cpuFallbackReason = 'GPU unavailable';
  let renderController;
  let cleanupPending = false;
  const releaseResources = () => {
    clearZoom();
    if (original instanceof ImageBitmap) original.close();
    original = undefined;
    if (output) {
      output.width = 0;
      output.height = 0;
      output = undefined;
    }
  };
  modal._cancelUpscale = () => renderController?.abort();
  modal._releaseResources = () => {
    if (renderController) cleanupPending = true;
    else releaseResources();
  };
  const showProgress = (message) => {
    let progress = stage.querySelector('.ig-ai-progress');
    if (!progress) {
      progress = document.createElement('span');
      progress.className = 'ig-ai-progress';
      stage.append(progress);
    }
    progress.textContent = message;
    return progress;
  };
  const showOutput = (nextOutput) => {
    const previousOutput = output;
    clearZoom();
    output = nextOutput;
    stage.replaceChildren(output);
    if (previousOutput && previousOutput !== output) {
      previousOutput.width = 0;
      previousOutput.height = 0;
    }
    clearZoom = attachZoom(stage, output);
    const { width, height } = getMediaDimensions(original);
    const result = `${width}×${height} → ${output.width}×${output.height}`;
    title.textContent = usingGpu
      ? `WebSR v0.0.16 · WebGPU · CNN-M · ${sourceLabel} · ${selectedScale}× · ${result}`
      : `CPU fallback (${cpuFallbackReason}) · ${selectedScale}× · ${result}`;
    title.title = title.textContent;
    applyScale.disabled = false;
    downloadButton.disabled = false;
  };
  const renderSelectedScale = async () => {
    selectedScale = Number(targetScale.value);
    const limit = getUpscaleLimit(original, selectedScale, usingGpu ? device : false);
    if (limit) {
      showLimitNotice(stage, limit);
      return;
    }
    applyScale.disabled = true;
    downloadButton.disabled = true;
    const progress = showProgress(usingGpu ? `Preparing ${selectedScale}× tiled GPU upscale…` : `Preparing ${selectedScale}× CPU upscale…`);
    try {
      const nextOutput = usingGpu
        ? await upscaleWithTiledGpu(original, selectedScale, device, (completed, total) => {
          progress.textContent = `GPU upscale ${selectedScale}× · tile ${completed}/${total}`;
        })
        : upscaleWithCpu(original, selectedScale);
      showOutput(nextOutput);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The image could not be upscaled.';
      progress.remove();
      if (output) {
        showLimitNotice(stage, message);
        downloadButton.disabled = false;
      }
      else {
        const errorText = document.createElement('p');
        errorText.className = 'ig-ai-error';
        errorText.textContent = message;
        stage.replaceChildren(errorText);
      }
      applyScale.disabled = false;
    } finally {
      if (cleanupPending || !modal.isConnected) releaseResources();
    }
  };
  try {
    await image.decode();
    original = image;
    try {
      const cleanImage = await getCleanImageBitmap(image);
      if (!modal.isConnected) {
        cleanImage.bitmap.close();
        return;
      }
      original = cleanImage.bitmap;
      sourceLabel = cleanImage.source;
    } catch {
      cpuFallbackReason = 'image access blocked';
    }
    if (!modal.isConnected) return;
    device = original instanceof ImageBitmap ? await WebSR.initWebGPU().catch(() => false) : false;
    if (!modal.isConnected) return;
    usingGpu = Boolean(device);
    const availableScales = getAvailableScales(original, device);
    if (!availableScales.length) throw new Error('This image is too large for the available browser canvas limits.');
    for (const availableScale of availableScales) {
      const option = document.createElement('option');
      option.value = String(availableScale);
      option.textContent = `${availableScale}×`;
      targetScale.append(option);
    }
    selectedScale = availableScales.includes(scale) ? scale : availableScales[availableScales.length - 1];
    targetScale.value = String(selectedScale);
    targetScale.disabled = false;
    applyScale.disabled = false;
    applyScale.addEventListener('click', renderSelectedScale);
    await renderSelectedScale();
    downloadButton.addEventListener('click', async () => {
      downloadButton.disabled = true;
      try {
        await downloadCanvas(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The image could not be downloaded.';
        showLimitNotice(stage, `Download unavailable: ${message}`);
      } finally {
        downloadButton.disabled = false;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The image could not be upscaled.';
    const errorText = document.createElement('p');
    errorText.className = 'ig-ai-error';
    errorText.textContent = message;
    stage.replaceChildren(errorText);
  }
}

scan();
document.addEventListener('load', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches(IMAGE_SELECTOR)) addButton(image);
}, true);

new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
      addButton(record.target);
    }
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches?.(IMAGE_SELECTOR)) addButton(node);
        scan(node);
      }
    }
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset']
});
