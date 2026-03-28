(function () {
    const STORAGE_KEY = 'scriptsEnabled';
    const STORAGE_SERVERS_KEY = 'serverTemplates';
    let scriptsEnabled = true;
    const embedServersJsonRawUrl = 'https://raw.githubusercontent.com/jobayer1n1/Letterboxd-Plus/main/embed_servers.json';
    const embedServersJsonBlobUrl = 'https://github.com/jobayer1n1/Letterboxd-Plus/blob/main/embed_servers.json?raw=1';

    function normalizeTemplate(template) {
        return String(template || '').trim().toLowerCase();
    }

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result));
        });
    }

    function storageSet(value) {
        return new Promise((resolve) => {
            chrome.storage.local.set(value, () => resolve());
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

    function parseJsonLenient(text) {
        const cleaned = String(text || '')
            .replace(/^\uFEFF/, '')
            .trim()
            .replace(/,\s*([}\]])/g, '$1');

        return JSON.parse(cleaned);
    }

    async function fetchDefaultServers() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        try {
            const candidates = [embedServersJsonRawUrl, embedServersJsonBlobUrl];
            let payloadText = null;

            for (const url of candidates) {
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        cache: 'no-store',
                        signal: controller.signal,
                        headers: { Accept: 'application/json' }
                    });
                    if (!response.ok) continue;
                    payloadText = await response.text();
                    break;
                } catch (error) {
                    // ignore and try next
                }
            }

            if (!payloadText) return [];
            const trimmed = payloadText.trim();
            if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return [];

            const payload = parseJsonLenient(payloadText);
            const list = Array.isArray(payload) ? payload : [];
            return sanitizeServers(list.map((s) => ({ ...s, isDefault: true }))).map((s) => ({ ...s, isDefault: true }));
        } catch (error) {
            return [];
        } finally {
            clearTimeout(timer);
        }
    }

    async function ensureServersInitialized() {
        const result = await storageGet([STORAGE_SERVERS_KEY]);
        const existing = sanitizeServers(result[STORAGE_SERVERS_KEY]);
        if (existing.length > 0) return existing;

        const defaults = await fetchDefaultServers();
        if (!defaults.length) return [];

        await storageSet({ [STORAGE_SERVERS_KEY]: defaults });
        return defaults;
    }

    function loadServerDefinitions(tmdbId, callback) {
        ensureServersInitialized().then((saved) => {
            const servers = sanitizeServers(saved)
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

        const streamSection = document.getElementById('letterboxd-plus-stream-section');
        if (streamSection) streamSection.remove();
    }

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
        extendedSpan.textContent = 'Free';
        extendedLink.appendChild(extendedSpan);
        optionsSpan.appendChild(extendedLink);
        btnContainer.appendChild(optionsSpan);

        // Robustly hide or remove "Not streaming" message regardless of DOM structure
        const emptyNodes = watchPanel.querySelectorAll('.-empty');
        emptyNodes.forEach(node => node.style.display = 'none');

        function removeNotStreaming(element) {
            for (let node of element.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node.nodeValue.toLowerCase().includes('not streaming')) {
                        node.nodeValue = node.nodeValue.replace(/not streaming\.?/ig, '');
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.children.length === 0 && node.textContent.toLowerCase().includes('not streaming')) {
                        node.style.display = 'none';
                    } else {
                        removeNotStreaming(node);
                    }
                }
            }
        }
        removeNotStreaming(watchPanel);

        const servicesSection = watchPanel.querySelector('.services.-showall') || watchPanel.querySelector('.services');
        const watchContainer = watchPanel.querySelector('#watch');

        if (servicesSection) {
            // Normal injection at the top of existing services
            if (servicesSection.firstChild) {
                servicesSection.insertBefore(btnContainer, servicesSection.firstChild);
            } else {
                servicesSection.appendChild(btnContainer);
            }
        } else if (watchContainer) {
            // Create the wrapper if there's no native services list
            const newServices = document.createElement('section');
            newServices.className = 'services';
            newServices.appendChild(btnContainer);
            watchContainer.insertBefore(newServices, watchContainer.firstChild);
        } else {
            // Fallback just append to `.watch-panel`
            watchPanel.appendChild(btnContainer);
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
        // Attempt to inject on standard load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

        // Since Letterboxd might dynamically swap page content or load heavily cached HTML dynamically,
        // setting a small timeout helps catch dynamically appearing `.services` boxes.
        setTimeout(init, 1000);
    }

    chrome.storage.local.get({ [STORAGE_KEY]: true }, (result) => {
        scriptsEnabled = Boolean(result[STORAGE_KEY]);
        if (scriptsEnabled) {
            startInjection();
        } else {
            removeInjectedUI();
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'LETTERBOXD_PLUS_TOGGLE') return;

        scriptsEnabled = Boolean(message.enabled);
        if (scriptsEnabled) {
            init();
            setTimeout(init, 100);
        } else {
            removeInjectedUI();
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

})();
