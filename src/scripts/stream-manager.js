(function () {
    globalThis.LBPlus = globalThis.LBPlus || {};

    globalThis.LBPlus.createStreamSection = function (tmdbId, mode = 'no-cache') {
        const existing = document.getElementById('letterboxd-plus-stream-section');
        if (existing) existing.remove(); // Re-inject if mode changed

        const streamSection = document.createElement('section');
        streamSection.id = 'letterboxd-plus-stream-section';
        streamSection.className = 'letterboxd-plus-container section -clear';
        
        const serverSelector = document.createElement('section');
        serverSelector.className = 'letterboxd-plus-servers';
        const span = document.createElement('span');
        span.textContent = 'Select Server: ';
        serverSelector.appendChild(span);

        const playerWrapper = document.createElement('div');
        playerWrapper.id = 'lbp-player-wrapper';
        playerWrapper.className = 'letterboxd-plus-iframe-wrapper'; // Reuse wrapper style for aspect ratio

        if (mode === 'no-cache') {
            const iframe = document.createElement('iframe');
            iframe.id = 'lbp-iframe';
            iframe.src = '';
            iframe.frameBorder = "0";
            iframe.allowFullscreen = true;
            playerWrapper.appendChild(iframe);
            streamSection.appendChild(serverSelector);
            streamSection.appendChild(playerWrapper);
        } else {
            // ----- Automated Capture Phase -----
            
            // 1. Loading UI
            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'lbp-loading-overlay';
            loadingOverlay.innerHTML = `
                <div class="lbp-spinner"></div>
                <div class="lbp-loading-text" id="lbp-load-status">Capturing stream links...</div>
            `;
            playerWrapper.appendChild(loadingOverlay);
            streamSection.appendChild(playerWrapper);

            // 2. Hidden Capture Iframe
            const captureIframe = document.createElement('iframe');
            captureIframe.style.display = 'none';
            // Use Vidfast with sub=en as requested
            captureIframe.src = `https://vidfast.pro/movie/${tmdbId}?autoPlay=true&sub=en`;
            streamSection.appendChild(captureIframe);

            let capturedM3u8 = null;
            let capturedSub = null;
            let syncStarted = false;
            let messageListenerAdded = false; // Flag to ensure listener is added only once

            const startBackendSync = () => {
                if (syncStarted || !capturedM3u8) return;
                syncStarted = true;
                
                document.getElementById('lbp-load-status').textContent = "Caching stream on local server...";

                const loadPayload = { 
                    tmdbId, 
                    m3u8Url: capturedM3u8,
                    subtitle_link: capturedSub, // Unified subtitle sync
                    headers: {
                        "Referer": "https://vidfast.pro/",
                        "Origin": "https://vidfast.pro"
                    }
                };
                
                fetch('http://localhost:6769/load', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(loadPayload)
                })
                .then(r => r.json())
                .then(data => {
                    // 3. Initialize Player
                    loadingOverlay.remove();
                    captureIframe.remove();
                    
                    const video = document.createElement('video');
                    video.id = 'lbp-video';
                    video.controls = true;
                    video.crossOrigin = 'anonymous'; // Support cross-origin tracks
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.style.position = 'absolute';
                    video.style.top = '0';
                    video.style.left = '0';
                    playerWrapper.appendChild(video);

                    const hlsUrl = data.streamUrl;
                    if (globalThis.Hls && Hls.isSupported()) {
                        const hls = new Hls({ debug: true });
                        hls.loadSource(hlsUrl);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = hlsUrl;
                        video.play().catch(() => {});
                    }

                    // Add Stats Header
                    const statsHeader = document.createElement('div');
                    statsHeader.className = 'lbp-stats-header';
                    statsHeader.innerHTML = `
                        <div class="lbp-stat-item">Speed: <span id="lbp-cache-speed">0 KB/s</span></div>
                        <div class="lbp-stat-item">Cached: <span id="lbp-cache-percent">0%</span></div>
                    `;
                    streamSection.insertBefore(statsHeader, playerWrapper);

                    // Add Subtitle Footer
                    const controlsFooter = document.createElement('div');
                    controlsFooter.className = 'lbp-controls-footer';
                    const subBtn = document.createElement('button');
                    subBtn.textContent = 'Subtitles';
                    subBtn.className = 'server-btn';
                    const subMenu = document.createElement('div');
                    subMenu.className = 'lbp-sub-menu';
                    subMenu.style.display = 'none';

                    const uploadInput = document.createElement('input');
                    uploadInput.type = 'file';
                    uploadInput.accept = '.vtt,.srt';
                    uploadInput.style.display = 'none';
                    streamSection.appendChild(uploadInput);

                    const uploadBtn = document.createElement('div');
                    uploadBtn.className = 'lbp-sub-item';
                    uploadBtn.textContent = '+ Upload Subtitle';
                    uploadBtn.onclick = () => uploadInput.click();
                    subMenu.appendChild(uploadBtn);

                    subBtn.onclick = () => { subMenu.style.display = subMenu.style.display === 'none' ? 'block' : 'none'; };
                    const subContainer = document.createElement('div');
                    subContainer.style.position = 'relative';
                    subContainer.appendChild(subBtn);
                    subContainer.appendChild(subMenu);
                    controlsFooter.appendChild(subContainer);
                    streamSection.appendChild(controlsFooter);

                    // Manual Upload logic
                    uploadInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const track = document.createElement('track');
                        track.kind = 'subtitles';
                        track.label = file.name;
                        track.srclang = 'en';
                        track.src = URL.createObjectURL(file);
                        track.default = true;
                        video.appendChild(track);
                        subMenu.style.display = 'none';
                        
                        const item = document.createElement('div');
                        item.className = 'lbp-sub-item';
                        item.textContent = file.name;
                        item.onclick = () => {
                            Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
                            track.track.mode = 'showing';
                            subMenu.style.display = 'none';
                            subMenu.querySelectorAll('.lbp-sub-item').forEach(i => i.classList.remove('active'));
                            item.classList.add('active');
                        };
                        subMenu.insertBefore(item, uploadBtn);
                    };

                    // Re-fetch cached subtitles (including the one just synced)
                    fetch(`http://localhost:6769/subtitle/${tmdbId}`)
                        .then(r => r.json())
                        .then(cachedSubs => {
                            cachedSubs.forEach(sub => {
                                if (Array.from(subMenu.querySelectorAll('.lbp-sub-item')).some(item => item.textContent === sub.label)) return;
                                const item = document.createElement('div');
                                item.className = 'lbp-sub-item';
                                item.textContent = sub.label;
                                const track = document.createElement('track');
                                track.kind = 'subtitles';
                                track.label = sub.label;
                                track.src = sub.url;
                                track.srclang = 'en';
                                video.appendChild(track);
                                item.onclick = () => {
                                    Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
                                    track.track.mode = 'showing';
                                    subMenu.style.display = 'none';
                                    subMenu.querySelectorAll('.lbp-sub-item').forEach(i => i.classList.remove('active'));
                                    item.classList.add('active');
                                };
                                subMenu.insertBefore(item, uploadBtn);
                            });
                        });

                    // Start progress polling
                    const pollInterval = setInterval(() => {
                        if (!document.getElementById('lbp-video')) { clearInterval(pollInterval); return; }
                        fetch(`http://localhost:6769/progress/${tmdbId}`).then(r => r.json()).then(data => {
                            const speedEl = document.getElementById('lbp-cache-speed');
                            const percentEl = document.getElementById('lbp-cache-percent');
                            if (speedEl) speedEl.textContent = data.speed || '0 KB/s';
                            if (percentEl) percentEl.textContent = (data.percent || 0) + '%';
                        }).catch(() => {});
                    }, 1000);
                });
            };

            // Capture Listeners
            const onCaptureMessage = (message) => {
                if (!message) return;
                if (message.type === 'LETTERBOXD_PLUS_M3U8_DETECTED') {
                    // Favor 1080p -> 720p -> others
                    if (!capturedM3u8 || message.url.includes('1080') || (!capturedM3u8.includes('1080') && message.url.includes('720'))) {
                        capturedM3u8 = message.url;
                    }
                }
                if (message.type === 'LETTERBOXD_PLUS_SUBTITLE_DETECTED') {
                    capturedSub = message.url;
                }

                if (capturedM3u8) {
                    // Wait a bit to see if subtitles show up, then sync
                    setTimeout(startBackendSync, 2000);
                }
            };

            chrome.runtime.onMessage.addListener(onCaptureMessage);
            
            // Safety timeout: if nothing captured in 15s, try syncing anyway or show error
            setTimeout(() => {
                if (!syncStarted && capturedM3u8) startBackendSync();
                else if (!syncStarted) {
                    document.getElementById('lbp-load-status').textContent = "Capture timed out. Retrying with default...";
                    // Fallback or retry logic could go here
                }
            }, 15000);

            // Cleanup listener on section removal
            const observer = new MutationObserver((mutations) => {
                if (!document.getElementById('letterboxd-plus-stream-section')) {
                    chrome.runtime.onMessage.removeListener(onCaptureMessage);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        let targetPrevSection = document.querySelector('.activity-from-friends');
        if (!targetPrevSection) {
            targetPrevSection = document.querySelector('.film-recent-reviews') || document.querySelector('#popular-reviews') || document.querySelector('.text-sluglist');
        }

        if (targetPrevSection && targetPrevSection.parentNode) {
            targetPrevSection.parentNode.insertBefore(streamSection, targetPrevSection);
        } else {
            const contentContainer = document.querySelector('.cols-3') || document.querySelector('.col-main');
            if (contentContainer) contentContainer.appendChild(streamSection);
        }

        // The server selector and loadServer logic is only for 'no-cache' mode now
        if (mode === 'no-cache') {
            const DEFAULT_SERVERS = globalThis.LETTERBOXD_PLUS_DEFAULT_SERVERS || [];
            globalThis.LBPlus.loadServerDefinitions(tmdbId, DEFAULT_SERVERS, (servers) => {
                servers.forEach((server, index) => {
                    const btn = document.createElement('button');
                    btn.className = 'server-btn' + (index === 0 ? ' active' : '');
                    btn.setAttribute('data-src', server.src);
                    btn.textContent = server.name;
                    serverSelector.appendChild(btn);
                });

                const loadServer = (server) => {
                    document.getElementById('lbp-iframe').src = server.src;
                };

                if (servers.length > 0) loadServer(servers[0]);

                const buttons = serverSelector.querySelectorAll('.server-btn');
                buttons.forEach((b) => {
                    b.addEventListener('click', () => {
                        buttons.forEach(btn => btn.classList.remove('active'));
                        b.classList.add('active');
                        const server = { name: b.textContent, src: b.getAttribute('data-src') };
                        loadServer(server);
                    });
                });
            });
        }

        // This general subtitle detection listener should now only handle cases not covered by the automated capture,
        // or be removed if the automated capture handles all subtitle needs for 'cache' mode.
        // Given the new 'cache' mode logic, this listener is redundant for 'cache' mode's initial subtitle detection.
        // It might still be useful for 'no-cache' mode if subtitles are detected there.
        // For now, let's keep it as is, but it will only trigger if the 'lbp-sub-menu' and 'lbp-video' exist,
        // which they will only after the player is initialized in 'cache' mode.
        // The new 'cache' mode logic already handles adding detected subtitles to the UI.
        // This listener will effectively only add subtitles if they are detected *after* the player is loaded
        // and not through the initial capture iframe.
        chrome.runtime.onMessage.addListener((message) => {
            if (!message || message.type !== 'LETTERBOXD_PLUS_SUBTITLE_DETECTED') return;

            const subMenu = document.querySelector('.lbp-sub-menu');
            const video = document.getElementById('lbp-video');
            const uploadBtn = document.querySelector('.lbp-sub-item:last-child'); // The upload button

            if (subMenu && video && uploadBtn) {
                // 1. Tell Server to cache it
                fetch('http://localhost:6769/subtitle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tmdbId, subtitle_link: message.url })
                }).catch(() => {});

                // 2. Add to UI (using original URL for now, or wait for server back - let's use original for immediate feedback)
                if (Array.from(subMenu.querySelectorAll('.lbp-sub-item')).some(item => item.textContent === message.label)) return;

                const item = document.createElement('div');
                item.className = 'lbp-sub-item';
                item.textContent = message.label;
                
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = message.label;
                track.src = message.url;
                track.srclang = 'en';
                video.appendChild(track);

                item.onclick = () => {
                    Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
                    track.track.mode = 'showing';
                    subMenu.style.display = 'none';
                    subMenu.querySelectorAll('.lbp-sub-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                };

                subMenu.insertBefore(item, uploadBtn);
            }
        });

        streamSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
})();
