# Background resolution reproduction for RecompLauncher issue 334

These screenshots render the production RecompLauncher UI with synthetic catalog/library data and synthetic artwork in isolated headless Chrome on macOS. They are not native Tauri screenshots or game artwork. All image requests are fulfilled locally; no user profile, accounts or game files are used.

The source image is3840×1240, while the local thumbnail fixture is960×310. Before the fix, both Home and the game page request the960px thumbnail at1280×860/1x,1920×1080/1x and1920×1080/2x. After the fix, all six cases load the3840px original. Both runs report zero JavaScript exceptions and zero unexpected requests.

The JSON width/height fields are the rendered image dimensions; viewport dimensions and scale are in the screenshot filenames and script cases. The two displayed screenshots are1920×1080 at1x.

Run `node check-background.cjs /path/to/RecompLauncher before` or `after` on macOS with Chrome installed, after obtaining browser permission. The script starts a temporary profile and closes it afterward.

Baseline:09ebf893136963d9ef63acbfb0a01da12b6db934. This branch contains evidence only, separate from the code PR.
