(function () {
    const PLAY_SVG = `<svg viewBox="0 0 24 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>`;
    const PAUSE_SVG = `<svg viewBox="0 0 24 24"><path d="M14,19H18V5H14M6,19H10V5H6V19Z"/></svg>`;
    const VOL_SVG = `<svg viewBox="0 0 24 24"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18.07,19.86 21,16.28 21,12C21,7.72 18.07,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16.02C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>`;
    const MUTE_SVG = `<svg viewBox="0 0 24 24"><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L4.27,3M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18.07,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.48,12.43 16.5,12.22 16.5,12Z"/></svg>`;
    const FULL_SVG = `<svg viewBox="0 0 24 24"><path d="M7,14H5V19H10V17H7V14M5,10H7V7H10V5H5V10M17,17H14V19H19V14H17V17M14,5V7H17V10H19V5H14Z"/></svg>`;
    const MIN_SVG = `<svg viewBox="0 0 24 24"><path d="M14,14H19V16H16V19H14V14M5,16H10V14H5V16M19,8H14V5H16V8H19V10M10,8H5V10H8V5H10V8Z"/></svg>`;
    const CC_SVG = `<svg viewBox="0 0 24 24"><path d="M19,4H5C3.89,4 3,4.9 3,6v12c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2V6C21,4.9 20.1,4 19,4M11,11H8.5v0.5H7v-3h1.5V9H11V11z M17,11h-2.5v0.5H13v-3h1.5V9H17V11z"/></svg>`;
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
            chrome.storage.local.get({ selectedCacheServer: 'http://localhost:6769' }, (storageRes) => {
                const C_SERVER = storageRes.selectedCacheServer.replace(/\/$/, "");
            
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
                
                fetch(`${C_SERVER}/load`, {
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
                    video.controls = false; // Using custom controls
                    video.crossOrigin = 'anonymous';
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.style.position = 'absolute';
                    video.style.top = '0';
                    video.style.left = '0';
                    playerWrapper.appendChild(video);

                    // --- Custom Controls Construction ---
                    const controls = document.createElement('div');
                    controls.className = 'lbp-controls-container';
                    
                    // 1. Seek Bar
                    const seekContainer = document.createElement('div');
                    seekContainer.className = 'lbp-seek-container';
                    const seekProgress = document.createElement('div');
                    seekProgress.className = 'lbp-seek-progress';
                    const seekHandle = document.createElement('div');
                    seekHandle.className = 'lbp-seek-handle';
                    seekContainer.appendChild(seekProgress);
                    seekContainer.appendChild(seekHandle);
                    controls.appendChild(seekContainer);

                    // 2. Buttons Row
                    const row = document.createElement('div');
                    row.className = 'lbp-controls-row';

                    // Left controls
                    const leftSide = document.createElement('div');
                    leftSide.className = 'lbp-controls-left';
                    
                    const playBtn = document.createElement('button');
                    playBtn.className = 'lbp-control-btn';
                    playBtn.innerHTML = PLAY_SVG;
                    
                    const timeDisp = document.createElement('div');
                    timeDisp.className = 'lbp-time-display';
                    timeDisp.textContent = '0:00 / 0:00';

                    leftSide.appendChild(playBtn);
                    leftSide.appendChild(timeDisp);

                    const statsDisp = document.createElement('div');
                    statsDisp.className = 'lbp-time-display';
                    statsDisp.style.marginLeft = '12px';
                    statsDisp.style.opacity = '0.6';
                    statsDisp.style.fontSize = '12px';
                    statsDisp.innerHTML = `Speed: <span id="lbp-cache-speed">0 KB/s</span> | Cached: <span id="lbp-cache-percent">0%</span>`;
                    leftSide.appendChild(statsDisp);

                    // Right controls
                    const rightSide = document.createElement('div');
                    rightSide.className = 'lbp-controls-right';

                    const volContainer = document.createElement('div');
                    volContainer.className = 'lbp-volume-container';
                    const volBtn = document.createElement('button');
                    volBtn.className = 'lbp-control-btn';
                    volBtn.innerHTML = VOL_SVG;
                    
                    const volSliderWrapper = document.createElement('div');
                    volSliderWrapper.className = 'lbp-volume-slider-wrapper';
                    const volSlider = document.createElement('input');
                    volSlider.type = 'range';
                    volSlider.className = 'lbp-volume-slider';
                    volSlider.min = 0;
                    volSlider.max = 1;
                    volSlider.step = 0.05;
                    volSlider.value = video.volume;
                    volSliderWrapper.appendChild(volSlider);
                    volContainer.appendChild(volSliderWrapper);
                    volContainer.appendChild(volBtn);

                    const ccBtn = document.createElement('button');
                    ccBtn.className = 'lbp-control-btn';
                    ccBtn.innerHTML = CC_SVG;
                    ccBtn.title = 'Subtitles';

                    const fullBtn = document.createElement('button');
                    fullBtn.className = 'lbp-control-btn';
                    fullBtn.innerHTML = FULL_SVG;

                    rightSide.appendChild(ccBtn);
                    rightSide.appendChild(volContainer);
                    rightSide.appendChild(fullBtn);

                    row.appendChild(leftSide);
                    row.appendChild(rightSide);
                    controls.appendChild(row);

                    const subMenu = document.createElement('div');
                    subMenu.className = 'lbp-sub-menu';
                    controls.appendChild(subMenu);
                    playerWrapper.appendChild(controls);

                    const uploadInput = document.createElement('input');
                    uploadInput.type = 'file';
                    uploadInput.accept = '.vtt,.srt';
                    uploadInput.style.display = 'none';
                    streamSection.appendChild(uploadInput);

                    // --- Logic ---
                    const formatTime = (s) => {
                        if (!s || isNaN(s)) return '0:00';
                        const h = Math.floor(s / 3600);
                        const m = Math.floor((s % 3600) / 60);
                        const sec = Math.floor(s % 60);
                        if (h > 0) {
                            return `${h}:${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
                        }
                        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
                    };

                    const updateUI = () => {
                        playBtn.innerHTML = video.paused ? PLAY_SVG : PAUSE_SVG;
                        const p = (video.currentTime / video.duration) * 100 || 0;
                        seekProgress.style.width = p + '%';
                        seekHandle.style.left = p + '%';
                        timeDisp.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
                    };

                    playBtn.onclick = () => video.paused ? video.play() : video.pause();
                    video.onplay = updateUI;
                    video.onpause = updateUI;
                    video.ontimeupdate = updateUI;
                    video.onloadedmetadata = updateUI;

                    seekContainer.onclick = (e) => {
                        const rect = seekContainer.getBoundingClientRect();
                        const pos = (e.clientX - rect.left) / rect.width;
                        video.currentTime = pos * video.duration;
                    };

                    volSlider.oninput = () => {
                        video.volume = volSlider.value;
                        video.muted = false;
                    };

                    volBtn.onclick = () => {
                        video.muted = !video.muted;
                    };

                    video.onvolumechange = () => {
                        volBtn.innerHTML = (video.muted || video.volume === 0) ? MUTE_SVG : VOL_SVG;
                    };

                    fullBtn.onclick = () => {
                        if (!document.fullscreenElement) {
                            // Using timeout to safely enter fullscreen (fixes some browser 'pause' bugs)
                            setTimeout(() => {
                                playerWrapper.requestFullscreen().catch(err => console.error("Fullscreen error:", err));
                            }, 50);
                        } else {
                            document.exitFullscreen().catch(err => console.error("Exit fullscreen error:", err));
                        }
                    };

                    let hideTimeout;
                    const showControls = () => {
                        controls.style.removeProperty('opacity');
                        controls.style.removeProperty('pointer-events');
                        controls.classList.add('active');
                        playerWrapper.style.cursor = 'default';
                        clearTimeout(hideTimeout);
                        hideTimeout = setTimeout(() => {
                            const isFullscreen = !!document.fullscreenElement;
                            if ((!video.paused || isFullscreen) && !subMenu.classList.contains('visible')) {
                                controls.classList.remove('active');
                                playerWrapper.style.cursor = 'none';
                                if (isFullscreen) {
                                    controls.style.setProperty('opacity', '0', 'important');
                                    controls.style.setProperty('pointer-events', 'none', 'important');
                                }
                            }
                        }, 3000);
                    };

                    playerWrapper.addEventListener('mousemove', showControls);
                    playerWrapper.addEventListener('click', showControls);
                    document.addEventListener('mousemove', () => {
                        if (document.fullscreenElement) showControls();
                    });

                    document.addEventListener('fullscreenchange', () => {
                        fullBtn.innerHTML = document.fullscreenElement ? MIN_SVG : FULL_SVG;
                        if (!document.fullscreenElement) {
                           playerWrapper.style.cursor = 'default';
                        }
                    });

                    // Handle clicks on player to play/pause
                    video.onclick = (e) => {
                        if (subMenu.classList.contains('visible')) {
                            subMenu.classList.remove('visible');
                            return;
                        }
                        video.paused ? video.play() : video.pause();
                    };

                    // Keyboard Shortcuts
                    window.addEventListener('keydown', (e) => {
                        if (!document.fullscreenElement && !playerWrapper.contains(document.activeElement)) return;
                        
                        if (e.code === 'Space') {
                            e.preventDefault();
                            video.paused ? video.play() : video.pause();
                        } else if (e.code === 'KeyF') {
                            e.preventDefault();
                            fullBtn.click();
                        }
                    });

                    ccBtn.onclick = (e) => {
                        console.log('CC Button Clicked');
                        e.stopPropagation();
                        subMenu.classList.toggle('visible');
                        if (subMenu.classList.contains('visible')) {
                            controls.classList.add('active');
                        }
                    };

                    subMenu.onclick = (e) => {
                        e.stopPropagation();
                    };

                    document.addEventListener('click', () => {
                        subMenu.classList.remove('visible');
                        controls.classList.remove('active');
                    });

                    // Subtitle menu logic (reuse existing logic but adapt to new menu position)
                    const updateMenu = () => {
                        subMenu.innerHTML = '<div class="lbp-sub-header">Subtitles</div>';
                        
                        const offItem = document.createElement('div');
                        offItem.className = 'lbp-sub-item';
                        offItem.textContent = 'Off';
                        if (Array.from(video.textTracks).every(t => t.mode !== 'showing')) offItem.classList.add('active');
                        offItem.onclick = () => {
                            Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
                            updateMenu();
                        };
                        subMenu.appendChild(offItem);

                        Array.from(video.textTracks).forEach(track => {
                            const item = document.createElement('div');
                            item.className = 'lbp-sub-item';
                            if (track.mode === 'showing') item.classList.add('active');
                            item.textContent = track.label;
                            item.onclick = () => {
                                Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
                                track.mode = 'showing';
                                updateMenu();
                            };
                            subMenu.appendChild(item);
                        });

                        const uploadBtn = document.createElement('div');
                        uploadBtn.className = 'lbp-sub-item';
                        uploadBtn.style.textAlign = 'center';
                        uploadBtn.style.color = '#f4c84d';
                        uploadBtn.textContent = '+ Upload Subtitle';
                        uploadBtn.onclick = () => uploadInput.click();
                        subMenu.appendChild(uploadBtn);
                    };

                    uploadInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const trackEl = document.createElement('track');
                        trackEl.kind = 'subtitles';
                        trackEl.label = file.name;
                        trackEl.src = URL.createObjectURL(file);
                        video.appendChild(trackEl);
                        setTimeout(updateMenu, 500);
                    };

                    // Initial menu and HLS...
                    updateMenu();

                    video.addEventListener('subtitle-added', () => {
                        if (video.textTracks.length > 0 && Array.from(video.textTracks).every(t => t.mode !== 'showing')) {
                            video.textTracks[0].mode = 'showing';
                        }
                        updateMenu();
                    });

                    const hlsUrl = data.streamUrl;
                    if (globalThis.Hls && Hls.isSupported()) {
                        const hls = new Hls({ debug: false });
                        hls.loadSource(hlsUrl);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = hlsUrl;
                        video.play().catch(() => {});
                    }

                    fetch(`${C_SERVER}/subtitle/${tmdbId}`)
                        .then(r => r.json())
                        .then(cachedSubs => {
                            cachedSubs.forEach((sub, idx) => {
                                if (Array.from(video.textTracks).some(t => t.label === sub.label)) return;
                                const trackEl = document.createElement('track');
                                trackEl.kind = 'subtitles';
                                trackEl.label = sub.label;
                                trackEl.src = sub.url;
                                if (idx === 0) trackEl.default = true;
                                video.appendChild(trackEl);
                            });
                            // Auto-enable first track if none active
                            setTimeout(() => {
                                if (video.textTracks.length > 0 && Array.from(video.textTracks).every(t => t.mode !== 'showing')) {
                                    video.textTracks[0].mode = 'showing';
                                }
                                updateMenu();
                            }, 1000);
                        });

                    // Start progress polling
                    const pollInterval = setInterval(() => {
                        if (!document.getElementById('lbp-video')) { clearInterval(pollInterval); return; }
                        fetch(`${C_SERVER}/progress/${tmdbId}`).then(r => r.json()).then(data => {
                            const speedEl = document.getElementById('lbp-cache-speed');
                            const percentEl = document.getElementById('lbp-cache-percent');
                            if (speedEl) {
                                if (data.percent == 100) {
                                    speedEl.textContent = '0.00 KB/s';
                                } else {
                                    speedEl.textContent = data.speed || '0 KB/s';
                                }
                            }
                            if (percentEl) percentEl.textContent = (data.percent || 0) + '%';
                        }).catch(() => {});
                    }, 1000);
                });
            };

            // Capture Listeners
            let syncTimer = null;
            const onCaptureMessage = (message) => {
                if (!message) return;
                if (message.type === 'LETTERBOXD_PLUS_M3U8_DETECTED') {
                    // Favor 1080p -> 720p -> others
                    if (!capturedM3u8 || message.url.includes('1080') || (!capturedM3u8.includes('1080') && message.url.includes('720'))) {
                        capturedM3u8 = message.url;
                    }
                }
                if (message.type === 'LETTERBOXD_PLUS_SUBTITLE_DETECTED') {
                    const firstSub = !capturedSub;
                    capturedSub = message.url;
                    
                    if (syncStarted && firstSub) {
                        fetch(`${C_SERVER}/subtitle`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tmdbId, subtitle_link: capturedSub })
                        }).then(() => fetch(`${C_SERVER}/subtitle/${tmdbId}`))
                          .then(r => r.json())
                          .then(cachedSubs => {
                               const video = document.getElementById('lbp-video');
                               if (video) {
                                   cachedSubs.forEach((sub, idx) => {
                                       if (Array.from(video.textTracks).some(t => t.label === sub.label)) return;
                                       const trackEl = document.createElement('track');
                                       trackEl.kind = 'subtitles';
                                       trackEl.label = sub.label;
                                       trackEl.src = sub.url;
                                       video.appendChild(trackEl);
                                   });
                                   video.dispatchEvent(new Event('subtitle-added'));
                               }
                          }).catch(() => {});
                    }
                }

                if (capturedM3u8) {
                    if (capturedSub && !syncStarted) {
                        if (syncTimer) clearTimeout(syncTimer);
                        startBackendSync();
                    } else if (!syncStarted && !syncTimer) {
                        syncTimer = setTimeout(startBackendSync, 4000);
                    }
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
            }); // End of chrome.storage wrapper
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

        streamSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
})();
