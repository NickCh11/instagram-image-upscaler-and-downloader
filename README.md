# Instagram Image Upscaler and Downloader

<p align="center">
  <img src="public/icons/icon-128.png" width="128" alt="Instagram Image Upscaler and Downloader icon">
</p>

A Firefox extension that adds an on-demand **Upscale** button to Instagram photos. It uses WebSR and WebGPU when available, then lets you inspect and download the result.

> This project is not affiliated with Instagram or Meta.

## Features

- ⚡ Local 2× and 4× image upscaling with WebSR/WebGPU.
- 🖥️ CPU fallback when WebGPU is unavailable.
- 🖼️ Supports Instagram posts and carousel images.
- 🔍 Mouse-wheel zoom centered on the pointer, drag-to-pan, middle-click reset, and full-screen view.
- ⬇️ PNG download of the upscaled canvas.
- ⚙️ Configurable default scale in the extension settings.

## Privacy

Images are processed in the browser. The extension does not upload images to an external AI service and does not collect analytics. When the user presses **Upscale**, the extension reads the selected image from Instagram's CDN to create a browser-safe image source for GPU processing.

## Requirements

- Firefox Desktop 140 or newer.
- Node.js 24.14.0 and npm 11.12.0 for local development.

Firefox for Android is not currently supported by the public listing.

## Development

```sh
npm ci
npm run build
npm run lint
```

The generated extension files are written to `dist/`.

## Try it temporarily in Firefox

Use these steps to try the extension locally without permanently installing it:

1. Download or clone this repository.
2. In the repository folder, run:

   ```sh
   npm ci
   npm run build
   ```

3. In Firefox, open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on…**.
5. Select the generated `dist/manifest.json` file.
6. Open an Instagram post and hover over a large photo to find the **✦ Upscale** button.

Temporary add-ons are removed when Firefox restarts. To reload changes during development, return to `about:debugging`, find the extension, and click **Reload**.

To create a distributable package:

```sh
npm run package
```

The package is written to `outputs/`.

## License

This project is released under the [MIT License](LICENSE). It bundles WebSR 0.0.16, which is also licensed under MIT; its license is copied to `dist/WEBSR-LICENSE` during the build.
