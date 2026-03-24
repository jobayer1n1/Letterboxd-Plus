(function () {
    const STORAGE_KEY = 'scriptsEnabled';
    let scriptsEnabled = true;

    function init() {
        if (!scriptsEnabled) return;

        const body = document.body;
        const tmdbId = body.getAttribute('data-tmdb-id');

        if (!tmdbId) {
            console.log("Letterboxd+: No TMDB ID found on this page.");
            return;
        }

        const watchPanel = document.querySelector('.watch-panel');
        if (!watchPanel) {
            console.log("Letterboxd+: Watch panel not found. Cannot inject button.");
            return;
        }

        // Prevent duplicate buttons if script runs twice
        if (document.getElementById('letterboxd-plus-item')) return;

        const btnContainer = globalThis.LBPlus.createServiceButton('letterboxd-plus-item', 'Letterboxd+', 'NO CACHE', tmdbId);
        const cacheBtnContainer = globalThis.LBPlus.createServiceButton('letterboxd-plus-cache-item', 'Letterboxd+', 'CACHE', tmdbId, true);

        function updateCacheButtonVisibility(online) {
            cacheBtnContainer.style.display = online ? '' : 'none';
        }

        chrome.storage.local.get({ cacheServerOnline: false }, (result) => {
            updateCacheButtonVisibility(result.cacheServerOnline);
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.cacheServerOnline) {
                updateCacheButtonVisibility(changes.cacheServerOnline.newValue);
            }
        });

        const emptyNodes = watchPanel.querySelectorAll('.-empty');
        emptyNodes.forEach(node => node.style.display = 'none');

        globalThis.LBPlus.removeNotStreaming(watchPanel);

        const servicesSection = watchPanel.querySelector('.services.-showall') || watchPanel.querySelector('.services');
        const watchContainer = watchPanel.querySelector('#watch');

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
    }

    function startInjection() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        setTimeout(init, 1000);
        
        setInterval(() => {
            chrome.runtime.sendMessage({ type: 'FORCE_HEALTH_CHECK' }).catch(()=>{});
        }, 5000);
        chrome.runtime.sendMessage({ type: 'FORCE_HEALTH_CHECK' }).catch(()=>{});
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
            if (scriptsEnabled && tmdbId) globalThis.LBPlus.createStreamSection(tmdbId);
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

