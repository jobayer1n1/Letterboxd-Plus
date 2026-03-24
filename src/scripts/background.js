// Global error tracking
self.addEventListener('error', (event) => console.error('SW Error:', event.error));
self.addEventListener('unhandledrejection', (event) => console.error('SW Unhandled Rejection:', event.reason));

const processedUrls = new Map();
const CACHE_TIME = 60000; // 1 minute cache

async function getTabId(tabId) {
    if (tabId >= 0) return tabId;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
    } catch (e) {
        return undefined;
    }
}

chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        const url = details.url;
        const isM3U8 = url.includes('.m3u8');
        const isSub = url.includes('.vtt') || url.includes('.srt');
        if (!isM3U8 && !isSub) return;

        const now = Date.now();
        if (processedUrls.has(url) && (now - processedUrls.get(url)) < CACHE_TIME) {
            return;
        }
        processedUrls.set(url, now);

        const realTabId = await getTabId(details.tabId);
        if (realTabId === undefined) return;

        if (isM3U8) {
            analyzePlaylist(url, realTabId);
        } else {
            notifySubtitle(realTabId, url, "External File");
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
        if (cType.includes('text/vtt') || cType.includes('text/srt') || cType.includes('application/x-subrip')) {
            const url = details.url;
            
            // If it already had a .vtt/.srt extension, onBeforeRequest probably caught it.
            // But just in case, we will notify here if not historically cached.
            const now = Date.now();
            if (processedUrls.has(url) && (now - processedUrls.get(url)) < CACHE_TIME) {
                return;
            }
            processedUrls.set(url, now);
            
            const realTabId = await getTabId(details.tabId);
            if (realTabId === undefined) return;
            
            notifySubtitle(realTabId, url, "Detected Subtitle");
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

async function analyzePlaylist(url, tabId) {
    try {
        const response = await fetch(url);
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
            chrome.tabs.sendMessage(tabId, {
                type: 'LETTERBOXD_PLUS_M3U8_DETECTED',
                isMaster: true,
                url: url,
                resolutions: uniqueResolutions
            }).catch(() => {});
        } else {
            console.log(`Letterboxd+: M3U8 Variant/Stream Found: ${url}`);
            chrome.tabs.sendMessage(tabId, {
                type: 'LETTERBOXD_PLUS_M3U8_DETECTED',
                isMaster: false,
                url: url
            }).catch(() => {});
        }

        // 2. Detect Subtitles (Master Playlist)
        const subRegex = /#EXT-X-MEDIA:TYPE=SUBTITLES.*?NAME="([^"]+)".*?URI="([^"]+)"/g;
        let subMatch;
        while ((subMatch = subRegex.exec(text)) !== null) {
            const name = subMatch[1];
            let subUrl = subMatch[2];
            if (!subUrl.startsWith('http')) {
                subUrl = new URL(subUrl, url).href;
            }
            notifySubtitle(tabId, subUrl, name);
        }
    } catch (e) {
        // Silent error
    }
}

function notifySubtitle(tabId, url, label) {
    console.log(`Letterboxd+: Subtitle Detected: ${label} -> ${url}`);
    chrome.tabs.sendMessage(tabId, {
        type: 'LETTERBOXD_PLUS_SUBTITLE_DETECTED',
        url: url,
        label: label
    }).catch(() => {});
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

