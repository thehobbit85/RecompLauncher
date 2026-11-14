# RecompLauncher #122: local layout reproduction

Before: Beta 47, `b0fffa47f3a9831aa9ec8544697acfdc61b8fa8d`.
After: `d3ff6ebe7f139b98ec3f7c558771bed4dc012d36`.

The real UI HTML, CSS and JavaScript were served locally. The harness supplies synthetic games, artwork, settings and Tauri command responses, and replaces only the normal startup routine. It uses an isolated Chrome profile and denies non-local HTTP requests. No game files, live account or existing browser session is used.

Six viewports: 640x480, 720x576, 640x432 (room for a taskbar), 560x400, 1280x400, and 1280x860. The two 400-pixel-high cases include the extra launcher-update footer button. Each viewport checks Home, Library, Discover, Downloads, Settings and a game page.

Acceptance checks: footer controls remain visible; every sidebar destination is focusable and hit-testable; actual mouse-wheel input reaches the last pin; every game tab is focusable and hit-testable; the page fits its width. All 36 fixed cases pass. The baseline fails 98 repeated checks across those same cases. Both runs finish without UI exceptions or external request attempts.

## Repeat the check

On macOS with Google Chrome installed and Node 22 or later, download the scripts beside this README. Each run opens and closes its own headless browser and writes measurements and screenshots into the scripts' directory.

```sh
node check-layout.cjs /path/to/baseline/RecompLauncher before
node verify-layout.cjs before-measurements.json
node check-layout.cjs /path/to/fixed/RecompLauncher after
node verify-layout.cjs after-measurements.json
```

The first verification is expected to fail. The second must pass.

This validates CSS-pixel viewports with device scale factor 1 in Chrome. Native Tauri window sizing, OS work areas, physical CRT behavior, other webviews and OS/DPI scaling were not exercised. The default initial window size is unchanged; the minimum is reduced to 560x400.
