# Project Rules

- Whenever bumping the extension `"version"` in `manifest.json`, also rebuild `job-autofill.zip` with the distributable extension files (`manifest.json`, `background.js`, `content.js`, `cvtext.js`, `popup.html`, `popup.js`, `options.html`, `options.js`, `log.html`, `log.js`, `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`, `LICENSE`) and verify the version inside the archive matches `manifest.json`.
