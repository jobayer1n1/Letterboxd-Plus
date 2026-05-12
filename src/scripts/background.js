// Global error tracking
self.addEventListener('error', (event) => console.error('SW Error:', event.error));
self.addEventListener('unhandledrejection', (event) => console.error('SW Unhandled Rejection:', event.reason));

const processedUrls = new Map();
const CACHE_TIME = 60000; // 1 minute cache
const SUBTITLE_EXTENSIONS = [".vtt", ".srt", ".webvtt", ".ass", ".ssa", ".ttml", ".dfxp"];

function hasSubtitleLikeExtension(rawUrl) {
    try {
        const u = new URL(rawUrl);
        const path = (u.pathname || "").toLowerCase();
        return SUBTITLE_EXTENSIONS.some((ext) => path.endsWith(ext));
    } catch (_) {
        const lower = String(rawUrl || "").toLowerCase();
        return SUBTITLE_EXTENSIONS.some((ext) => lower.includes(ext));
    }
}

async function getTabId(tabId) {
    if (tabId >= 0) return tabId;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
    } catch (e) {
        return undefined;
    }
}

async function getTargetTabIds(tabId) {
    const ids = new Set();

    if (tabId >= 0) {
        ids.add(tabId);
        return [...ids];
    }

    const activeId = await getTabId(tabId);
    if (typeof activeId === 'number') ids.add(activeId);

    try {
        const tabs = await chrome.tabs.query({ url: ["*://*.letterboxd.com/film/*"] });
        for (const t of tabs) {
            if (typeof t.id === 'number') ids.add(t.id);
        }
    } catch (_) {}

    return [...ids];
}

chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        const url = details.url;
        const lowerUrl = String(url || "").toLowerCase();
        const isM3U8 = lowerUrl.includes('.m3u8');
        const isSub = hasSubtitleLikeExtension(url);
        if (!isM3U8 && !isSub) return;

        const targetTabIds = await getTargetTabIds(details.tabId);
        if (!targetTabIds.length) return;

        const now = Date.now();
        if (processedUrls.has(url) && (now - processedUrls.get(url)) < CACHE_TIME) {
            return;
        }
        processedUrls.set(url, now);

        if (isM3U8) {
            analyzePlaylist(url, targetTabIds);
        } else {
            notifySubtitle(targetTabIds, url, "External File");
        }

        // Cleanup cache if it grows too large
        if (processedUrls.size > 200) {
            for (let [u, t] of processedUrls.entries()) {
                if (now - t > CACHE_TIME) processedUrls.delete(u);
            }
        }
    },
    { urls: ["<all_urls>"] }
);

// Fallback: Aggressively intercept headers to discover stealth subtitles that don't end in .vtt/.srt
chrome.webRequest.onHeadersReceived.addListener(
    async (details) => {
        if (details.method === 'OPTIONS') return;
        const cTypeHeader = (details.responseHeaders || []).find(h => h.name.toLowerCase() === 'content-type');
        if (!cTypeHeader) return;

        const cType = cTypeHeader.value.toLowerCase();
        if (
            cType.includes('text/vtt') ||
            cType.includes('application/vtt') ||
            cType.includes('text/srt') ||
            cType.includes('application/x-subrip') ||
            cType.includes('application/ttml+xml') ||
            cType.includes('application/xml+ttml')
        ) {
            const url = details.url;

            const targetTabIds = await getTargetTabIds(details.tabId);
            if (!targetTabIds.length) return;

            const now = Date.now();
            if (processedUrls.has(url) && (now - processedUrls.get(url)) < CACHE_TIME) {
                return;
            }
            processedUrls.set(url, now);

            notifySubtitle(targetTabIds, url, "Detected Subtitle");
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

async function analyzePlaylist(url, tabIds) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) return;
        const text = await response.text();

        // 1. Detect Resolutions (Master Playlist)
        const resolutions = [];
        const resRegex = /#EXT-X-STREAM-INF.*RESOLUTION=(\d+x\d+)/g;
        let resMatch;
        while ((resMatch = resRegex.exec(text)) !== null) {
            resolutions.push(resMatch[1]);
        }

        if (resolutions.length > 0) {
            const uniqueResolutions = [...new Set(resolutions)];
            console.log(`Letterboxd+: M3U8 Master Found: ${url} [${uniqueResolutions.join(', ')}]`);
            for (const tabId of tabIds) {
                chrome.tabs.sendMessage(tabId, {
                    type: 'LETTERBOXD_PLUS_M3U8_DETECTED',
                    isMaster: true,
                    url: url,
                    resolutions: uniqueResolutions
                }).catch(() => {});
            }
        } else {
            console.log(`Letterboxd+: M3U8 Variant/Stream Found: ${url}`);
            for (const tabId of tabIds) {
                chrome.tabs.sendMessage(tabId, {
                    type: 'LETTERBOXD_PLUS_M3U8_DETECTED',
                    isMaster: false,
                    url: url
                }).catch(() => {});
            }
        }

        // 2. Detect Subtitles (Master Playlist)
        const parseAttrList = (line) => {
            const out = {};
            const payload = line.includes(":") ? line.split(":").slice(1).join(":") : "";
            const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
            let m;
            while ((m = re.exec(payload)) !== null) {
                const key = String(m[1] || "").toUpperCase();
                let value = String(m[2] || "").trim();
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                out[key] = value;
            }
            return out;
        };

        const subtitleGroups = new Set();
        for (const line of text.split(/\r?\n/)) {
            if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
            const attrs = parseAttrList(line);
            if (attrs.SUBTITLES) subtitleGroups.add(attrs.SUBTITLES);
        }

        const foundFromMaster = [];
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (!line.startsWith('#EXT-X-MEDIA')) continue;
            if (!/TYPE=SUBTITLES/i.test(line)) continue;

            const attrs = parseAttrList(line);
            if (!attrs.URI) continue;
            // If groups are declared by stream variants, prefer matching those groups.
            if (subtitleGroups.size > 0 && attrs["GROUP-ID"] && !subtitleGroups.has(attrs["GROUP-ID"])) {
                continue;
            }

            const name = attrs.NAME || attrs.LANGUAGE || attrs["GROUP-ID"] || 'Playlist Subtitle';
            let subUrl = attrs.URI;
            if (!subUrl.startsWith('http')) {
                subUrl = new URL(subUrl, url).href;
            }
            foundFromMaster.push({ name, subUrl });
            notifySubtitle(tabIds, subUrl, name);
        }
        if (foundFromMaster.length > 0) {
            console.log(`Letterboxd+: Master playlist subtitle tracks found: ${foundFromMaster.length}`);
        }
    } catch (e) {
        console.log(`Letterboxd+: Failed to analyze playlist for subtitles: ${url} (${e && e.message ? e.message : e})`);
    }
}

function notifySubtitle(tabIds, url, label) {
    console.log(`Letterboxd+: Subtitle Detected: ${label} -> ${url}`);
    for (const tabId of tabIds) {
        chrome.tabs.sendMessage(tabId, {
            type: 'LETTERBOXD_PLUS_SUBTITLE_DETECTED',
            url: url,
            label: label
        }).catch(() => {});
    }
}

async function checkServerHealth() {
    chrome.storage.local.get({ selectedCacheServer: 'http://localhost:6769' }, async (resStorage) => {
        try {
            const url = `${resStorage.selectedCacheServer.replace(/\/$/, '')}/status`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(url, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data && data.safeword === 6769) {
                    chrome.storage.local.set({ cacheServerOnline: true });
                    return;
                }
            }
            chrome.storage.local.set({ cacheServerOnline: false });
        } catch (e) {
            chrome.storage.local.set({ cacheServerOnline: false });
        }
    });
}

// Initial check and periodic monitoring using MV3 Alarms
checkServerHealth();

chrome.alarms.create('serverHealthCheck', { periodInMinutes: 0.5 }); // Every 30 seconds
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'serverHealthCheck') {
        checkServerHealth();
    }
});

setInterval(checkServerHealth, 5000);

chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'FORCE_HEALTH_CHECK') {
        checkServerHealth();
    }
});
