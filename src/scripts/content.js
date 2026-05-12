(function () {
    const STORAGE_KEY = 'scriptsEnabled';
    const STORAGE_SERVERS_KEY = 'serverTemplates';
    let scriptsEnabled = true;
    let cacheVisibilityListenerBound = false;

    function normalizeTemplate(template) {
        return String(template || '').trim().toLowerCase();
    }

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result));
        });
    }

    function sanitizeServers(value) {
        const sanitized = [];
        const seen = new Set();

        (Array.isArray(value) ? value : []).forEach((server) => {
            if (!server || !server.name || !server.template) return;
            const name = String(server.name).trim();
            const template = String(server.template).trim();
            if (!name || !template) return;
            if (!template.includes('{tmdbId}')) return;
            if (!/^https:\/\//i.test(template)) return;

            let testUrl;
            try {
                testUrl = new URL(template.replaceAll('{tmdbId}', '550'));
            } catch (error) {
                return;
            }
            if (!/^https?:$/.test(testUrl.protocol)) return;

            const normalized = normalizeTemplate(template);
            if (!normalized || seen.has(normalized)) return;
            sanitized.push({ name, template, isDefault: Boolean(server.isDefault) });
            seen.add(normalized);
        });

        return sanitized;
    }

    function loadServerDefinitions(tmdbId, callback) {
        storageGet([STORAGE_SERVERS_KEY]).then((result) => {
            const saved = sanitizeServers(result[STORAGE_SERVERS_KEY]);
            const servers = saved
                .map(server => ({
                    name: server.name,
                    src: server.template.replaceAll('{tmdbId}', tmdbId)
                }))
                .filter(server => server.name && server.src);

            callback(servers);
        });
    }

    function removeInjectedUI() {
        const btn = document.getElementById('letterboxd-plus-item');
        if (btn) btn.remove();
        const cacheBtn = document.getElementById('letterboxd-plus-cache-item');
        if (cacheBtn) cacheBtn.remove();

        const streamSection = document.getElementById('letterboxd-plus-stream-section');
        if (streamSection) streamSection.remove();
    }

    function findWatchPanel() {
        return document.querySelector('.watch-panel.js-watch-panel')
            || document.querySelector('.js-watch-panel.watch-panel')
            || document.querySelector('.js-watch-panel')
            || document.querySelector('.watch-panel');
    }

    function init() {
        if (!scriptsEnabled) return;

        const body = document.body;
        const tmdbId = body.getAttribute('data-tmdb-id');

        if (!tmdbId) {
            console.log("Letterboxd+: No TMDB ID found on this page.");
            return;
        }

        const watchPanel = findWatchPanel();
        if (!watchPanel) {
            console.log("Letterboxd+: Watch panel not found. Cannot inject button.");
            return;
        }

        const btnContainer = document.createElement('p');
        btnContainer.id = 'letterboxd-plus-item';
        btnContainer.className = 'service -letterboxd-plus';

        const link = document.createElement('a');
        link.className = 'label';
        link.href = '#';
        link.style.display = 'flex';
        link.style.alignItems = 'center';

        const brandSpan = document.createElement('span');
        brandSpan.className = 'brand';
        const iconImg = document.createElement('img');
        iconImg.src = chrome.runtime.getURL('icon/icon16.png');
        iconImg.width = 24;
        iconImg.height = 24;
        brandSpan.appendChild(iconImg);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'title';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = 'Letterboxd+';
        titleSpan.appendChild(nameSpan);

        link.appendChild(brandSpan);
        link.appendChild(titleSpan);
        btnContainer.appendChild(link);

        const optionsSpan = document.createElement('span');
        optionsSpan.className = 'options js-film-availability-options';
        const extendedLink = document.createElement('a');
        extendedLink.className = 'link';
        extendedLink.href = '#';
        const extendedSpan = document.createElement('span');
        extendedSpan.className = 'extended';
        extendedSpan.textContent = 'NO CACHE';
        extendedLink.appendChild(extendedSpan);
        optionsSpan.appendChild(extendedLink);
        btnContainer.appendChild(optionsSpan);

        const cacheBtnContainer = globalThis.LBPlus.createServiceButton('letterboxd-plus-cache-item', 'Letterboxd+', 'CACHE', tmdbId, true);

        function updateCacheButtonVisibility(online) {
            cacheBtnContainer.style.display = online ? '' : 'none';
        }

        chrome.storage.local.get({ cacheServerOnline: false }, (result) => {
            updateCacheButtonVisibility(result.cacheServerOnline);
        });

        if (!cacheVisibilityListenerBound) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.cacheServerOnline) {
                    const cacheBtn = document.getElementById('letterboxd-plus-cache-item');
                    if (cacheBtn) {
                        cacheBtn.style.display = changes.cacheServerOnline.newValue ? '' : 'none';
                    }
                }
            });
            cacheVisibilityListenerBound = true;
        }

        const emptyNodes = watchPanel.querySelectorAll('.-empty');
        emptyNodes.forEach(node => node.style.display = 'none');

        globalThis.LBPlus.removeNotStreaming(watchPanel);

        const servicesSection = watchPanel.querySelector('.services.-showall') || watchPanel.querySelector('.services');
        const watchContainer = watchPanel.querySelector('#watch');
        const existingMain = document.getElementById('letterboxd-plus-item');
        const existingCache = document.getElementById('letterboxd-plus-cache-item');
        if (existingMain) existingMain.remove();
        if (existingCache) existingCache.remove();

        if (servicesSection) {
            if (servicesSection.firstChild) {
                servicesSection.insertBefore(btnContainer, servicesSection.firstChild);
                servicesSection.insertBefore(cacheBtnContainer, btnContainer.nextSibling);
            } else {
                servicesSection.appendChild(btnContainer);
                servicesSection.appendChild(cacheBtnContainer);
            }
        } else if (watchContainer) {
            const newServices = document.createElement('section');
            newServices.className = 'services';
            newServices.appendChild(btnContainer);
            newServices.appendChild(cacheBtnContainer);
            watchContainer.insertBefore(newServices, watchContainer.firstChild);
        } else {
            watchPanel.appendChild(btnContainer);
            watchPanel.appendChild(cacheBtnContainer);
        }

        function handlePlayClick(e) {
            e.preventDefault();
            createStreamSection(tmdbId);
        }

        link.addEventListener('click', handlePlayClick);
        extendedLink.addEventListener('click', handlePlayClick);

    }

    function createStreamSection(tmdbId) {
        if (!scriptsEnabled) return;
        if (document.getElementById('letterboxd-plus-stream-section')) return;

        const streamSection = document.createElement('section');
        streamSection.id = 'letterboxd-plus-stream-section';
        streamSection.className = 'letterboxd-plus-container section -clear';
        const serverSelector = document.createElement('section');
        serverSelector.className = 'letterboxd-plus-servers';
        const span = document.createElement('span');
        span.textContent = 'Select Server: ';
        serverSelector.appendChild(span);

        // Iframe wrapper for 16:9 aspect ratio
        const iframeWrapper = document.createElement('div');
        iframeWrapper.className = 'letterboxd-plus-iframe-wrapper';

        const iframe = document.createElement('iframe');
        iframe.src = '';
        iframe.frameBorder = "0";
        iframe.allowFullscreen = true;

        iframeWrapper.appendChild(iframe);
        streamSection.appendChild(serverSelector);
        streamSection.appendChild(iframeWrapper);

        // Find injection point for the stream itself (above Activity from friends)
        let targetPrevSection = document.querySelector('.activity-from-friends');
        if (!targetPrevSection) {
            // Fallback to inserting before reviews or popular lists if friends activity is missing
            targetPrevSection = document.querySelector('.film-recent-reviews') || document.querySelector('#popular-reviews') || document.querySelector('.text-sluglist');
        }

        if (targetPrevSection && targetPrevSection.parentNode) {
            targetPrevSection.parentNode.insertBefore(streamSection, targetPrevSection);
        } else {
            // Ultimate fallback: append to the main content container
            const contentContainer = document.querySelector('.cols-3') || document.querySelector('.col-main');
            if (contentContainer) {
                contentContainer.appendChild(streamSection);
            } else {
                console.log("Letterboxd+: Could not find suitable place to insert stream.");
            }
        }

        loadServerDefinitions(tmdbId, (servers) => {
            if (!servers.length) {
                console.log("Letterboxd+: No embed servers configured.");
                return;
            }

            servers.forEach((server, index) => {
                const btn = document.createElement('button');
                btn.className = 'server-btn' + (index === 0 ? ' active' : '');
                btn.setAttribute('data-src', server.src);
                btn.textContent = server.name;
                serverSelector.appendChild(btn);
            });

            iframe.src = servers[0].src;

            // Server button click logic
            const buttons = serverSelector.querySelectorAll('.server-btn');
            buttons.forEach((b) => {
                b.addEventListener('click', () => {
                    buttons.forEach(btn => btn.classList.remove('active'));
                    b.classList.add('active');
                    iframe.src = b.getAttribute('data-src');
                });
            });
        });
        // Scroll smoothly to the loaded iframe
        streamSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function startInjection() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        setTimeout(init, 1000);
        setTimeout(init, 2500);

        const observer = new MutationObserver(() => {
            if (!scriptsEnabled) return;
            const watchPanel = findWatchPanel();
            if (!watchPanel) return;
            const mainBtn = document.getElementById('letterboxd-plus-item');
            if (!mainBtn || !watchPanel.contains(mainBtn)) {
                init();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Avoid periodic runtime messaging from content-script context.
        // Background handles server health checks.
    }

    chrome.storage.local.get({ [STORAGE_KEY]: true }, (result) => {
        scriptsEnabled = Boolean(result[STORAGE_KEY]);
        if (scriptsEnabled) {
            startInjection();
        } else {
            globalThis.LBPlus.removeInjectedUI();
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'LETTERBOXD_PLUS_TOGGLE') return;

        scriptsEnabled = Boolean(message.enabled);
        if (scriptsEnabled) {
            init();
            setTimeout(init, 100);
        } else {
            globalThis.LBPlus.removeInjectedUI();
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'LETTERBOXD_PLUS_SERVERS_UPDATED') return;

        const streamSection = document.getElementById('letterboxd-plus-stream-section');
        if (streamSection) {
            streamSection.remove();
            const tmdbId = document.body.getAttribute('data-tmdb-id');
            if (scriptsEnabled && tmdbId) createStreamSection(tmdbId);
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'LETTERBOXD_PLUS_M3U8_DETECTED') return;
        console.log(`Letterboxd+: M3U8 Detected! URL: ${message.url}, Resolutions: ${message.resolutions.join(', ')}`);
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'LETTERBOXD_PLUS_SUBTITLE_DETECTED') return;
        console.log(`Letterboxd+: Subtitle Detected! Label: ${message.label}, URL: ${message.url}`);
    });
})();

