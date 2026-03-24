(function () {
    const STORAGE_SERVERS_KEY = 'serverTemplates';

    globalThis.LBPlus = globalThis.LBPlus || {};

    globalThis.LBPlus.normalizeTemplate = function (template) {
        return String(template || '').trim().toLowerCase();
    };

    globalThis.LBPlus.loadServerDefinitions = function (tmdbId, DEFAULT_SERVERS, callback) {
        chrome.storage.local.get({ [STORAGE_SERVERS_KEY]: DEFAULT_SERVERS }, (result) => {
            const saved = Array.isArray(result[STORAGE_SERVERS_KEY]) ? result[STORAGE_SERVERS_KEY] : [];
            const merged = [];
            const seen = new Set();
            const pushUnique = (server) => {
                if (!server || !server.name || !server.template) return;
                const normalized = globalThis.LBPlus.normalizeTemplate(server.template);
                if (!normalized || seen.has(normalized)) return;
                merged.push({ name: String(server.name).trim(), template: String(server.template).trim() });
                seen.add(normalized);
            };

            DEFAULT_SERVERS.forEach(pushUnique);
            saved.forEach(pushUnique);

            const servers = merged
                .map(server => ({
                    name: server.name,
                    src: server.template.replaceAll('{tmdbId}', tmdbId)
                }))
                .filter(server => server.name && server.src);

            callback(servers);
        });
    };

    globalThis.LBPlus.removeInjectedUI = function () {
        const btn = document.getElementById('letterboxd-plus-item');
        if (btn) btn.remove();

        const cacheBtn = document.getElementById('letterboxd-plus-cache-item');
        if (cacheBtn) cacheBtn.remove();

        const streamSection = document.getElementById('letterboxd-plus-stream-section');
        if (streamSection) streamSection.remove();
    };

    globalThis.LBPlus.removeNotStreaming = function (element) {
        for (let node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.nodeValue.toLowerCase().includes('not streaming')) {
                    node.nodeValue = node.nodeValue.replace(/not streaming\.?/ig, '');
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.children.length === 0 && node.textContent.toLowerCase().includes('not streaming')) {
                    node.style.display = 'none';
                } else {
                    globalThis.LBPlus.removeNotStreaming(node);
                }
            }
        }
    };
})();
