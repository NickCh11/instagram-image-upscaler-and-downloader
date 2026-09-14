# Changelog

## 1.0.9

- Prefer and open the image element's original `src` URL before its responsive `currentSrc` variant.
- Load the chosen full-resolution Instagram URL through the page before processing, with extension retrieval as a fallback.
- Show whether the rendered image used the full post media record or a fallback source.
- Read Instagram's `image_versions2` media record to select the full signed image URL on post-detail pages.
- Release the temporary WebGPU resources after every tile, preventing stale or unchanged results on high-resolution posts.
- Use WebSR's stronger CNN-M real-life model for clearer photographic detail enhancement.
- Allow Instagram post media served from Facebook's CDN, so it can use WebGPU rather than the CPU fallback.
- Prefer the highest-resolution Instagram `srcset` image for WebSR processing.
- Retry lower-resolution Instagram image sources if the preferred source is unavailable.

## 1.0.0

- First public release.
- WebSR/WebGPU-powered 2× and 4× Instagram image upscaling.
- Zoom, pan, full-screen viewing, and PNG download.
- Support for carousel images and dynamic Instagram content.
- Add the extension icon and GitHub README feature icons.
