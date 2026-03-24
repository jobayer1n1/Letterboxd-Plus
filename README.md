<div align = 'center'>
<h2>Letterboxd+</h2>
<p>Turn your letterboxd into a streaming platform</p>
</div>

---

## Features
- Embedded stream like normal pirated streaming website.
- Caching stream : 
  - It extracts the m3u8 master link and an english subtitle link from the embed player
  - Sends these links to the backend
  - The Backend starts downloading from these link and returns a generated m3u8 link(local) and the subtitle link(local)
  - The player fetches those links and start playing the video
  - It supports seek to play



## Use `uBlock Origin` or `uBlock Origin lite` (or any ad blocker) must.
Ads come from third-party embed players and those iframes do not expose normal `DOM` access.

---
## Install Cache Server (Windows)
1. Download the .exe
2. Run the .exe

## Install Addon(Chrome)
1. Download latest release zip.
2. Unzip it.
3. Open `chrome://extensions/`.
4. Turn on `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped folder (the one containing `manifest.json`).

---

## Install Addon(Firefox Android)
1. Download latest `.xpi` from releases.
2. Enable debug menu:
   - `Settings > About Firefox`
   - tap Firefox icon `5` times.
3. Install from file:
   - `Settings > Install extension from file`
   - choose the downloaded `.xpi`.
4. For caching u need to use your pc's server local address

---

## Settings
1. Enable/disable scripts toggle.
2. `Check Update` against latest GitHub release.
3. Embed server manager:
   - Add server name + link template (must include `{tmdbId}`).
   - Check connection.
   - Save custom server.
   - Delete custom servers.
4. Cache server Manger:
   - Add cache server
   - Manage cache files
4. Default servers are locked (grey style, non-deletable).
5. `Check manual` button opens add-server manual page.
