const api = globalThis.browser ?? globalThis.chrome;

function isInstagramCdnHost(hostname) {
  const host = hostname.toLowerCase();
  // Instagram serves post media from both its own CDN domain and Facebook's
  // CDN. The latter is common for the full post view.
  return host === 'cdninstagram.com'
    || host.endsWith('.cdninstagram.com')
    || host === 'fbcdn.net'
    || host.endsWith('.fbcdn.net');
}

api.runtime.onInstalled.addListener(async () => {
  const { scale } = await api.storage.local.get({ scale: 2 });
  if (![2, 4].includes(Number(scale))) {
    await api.storage.local.set({ scale: 2 });
  }
});

api.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== 'fetch-instagram-image') return undefined;
  const url = new URL(message.url);
  if (url.protocol !== 'https:' || !isInstagramCdnHost(url.hostname)) {
    throw new Error('Unsupported image host.');
  }
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') || 'image/jpeg'
  };
});
