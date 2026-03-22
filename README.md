## Use `uBlock Origin` (or any ad blocker)
Ads come from third-party embed players and those iframes do not expose normal `DOM` access.
So ad-blocking is recommended externally (for smoother playback).

---

## Install (Chrome)
1. Download latest release zip.
2. Unzip it.
3. Open `chrome://extensions/`.
4. Turn on `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped folder (the one containing `manifest.json`).

---

## Install (Firefox Android)
1. Download latest `.xpi` from releases.
2. Enable debug menu:
   - `Settings > About Firefox`
   - tap Firefox icon `5` times.
3. Install from file:
   - `Settings > Install extension from file`
   - choose the downloaded `.xpi`.

---

## Update Flow (Manual)
- No auto-update is implemented in addon logic.
- Users can check from popup using `Check Update`.
- If newer release exists, popup shows:
  - `Update Available <tag>`
  - `Take Me to the Latest Release Page` button.
- Then user manually installs latest zip/xpi.

---

## Popup Features
1. Enable/disable scripts toggle.
2. `Check Update` against latest GitHub release.
3. Custom server manager:
   - Add server name + link template (must include `{tmdbId}`).
   - Check connection.
   - Save custom server.
   - Delete custom servers.
4. Default servers are locked (grey style, non-deletable).
5. `Check manual` button opens add-server manual page.
