// Main Application Logic

import {
    getFeaturedChannels,
    getCountries,
    getCategories,
    getLanguages,
    getChannelsByFilter,
    getUniqueValuesFromSubset,
    searchGlobal
} from './api.js';

// --- HYPER-PRIORITY: Remote Control Mode ---
const urlParams = new URLSearchParams(window.location.search);
const savedPairId = localStorage.getItem('allivision_remote_id');

if (urlParams.has('pair') || savedPairId) {
    const pairId = urlParams.get('pair') || savedPairId;
    if (urlParams.has('pair')) localStorage.setItem('allivision_remote_id', pairId);
    console.log("Remote Mode Initializing...");
    initRemoteControl(pairId);
} else {
    document.addEventListener('DOMContentLoaded', init);
}

// --- State Management ---
const FAVORITES_KEY = 'allivision_favs';
const BROKEN_KEY = 'allivision_broken';
const RECENT_KEY = 'allivision_recent';
let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
let brokenChannels = JSON.parse(localStorage.getItem(BROKEN_KEY)) || [];
let recentChannels = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];

// --- Remote Control State ---
let currentChannelList = [];
let currentChannelIndex = -1;
let peer = null;
let conn = null;

// --- Performance & Features State ---
let idleTimer = null;
let isAmbientMode = false;
let sleepTimerId = null;

// --- Navigation Focus State ---
let currentFocusScope = 'grid'; // 'sidebar' | 'grid' | 'search'
let currentFocusIndex = 0;

// --- Virtual Cursor State (Trackpad) ---
let cursorEl = null;
let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;

function initCursor() {
    if (cursorEl) return;
    cursorEl = document.createElement('div');
    cursorEl.id = 'tv-cursor';
    cursorEl.style.cssText = `
        position: fixed;
        width: 25px;
        height: 25px;
        background: radial-gradient(circle, var(--accent-primary, #00f2ff) 20%, transparent 80%);
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 20px var(--accent-primary, #00f2ff);
        pointer-events: none;
        z-index: 10000;
        display: none;
        transition: transform 0.05s linear;
        left: 0;
        top: 0;
    `;
    document.body.appendChild(cursorEl);
}

// --- Broken Channel Logic ---
function markAsBroken(id) {
    if (!brokenChannels.includes(id)) {
        brokenChannels.push(id);
        localStorage.setItem(BROKEN_KEY, JSON.stringify(brokenChannels));
    }
}

// Global Scanner Function
window.scanCurrentView = async function () {
    const btn = document.getElementById('scan-btn');
    if (btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round spin">sync</span> Escaneando...';

    // Add spin animation style if missing
    if (!document.getElementById('spin-style')) {
        const s = document.createElement('style');
        s.id = 'spin-style';
        s.textContent = '@keyframes spin { 100% { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }';
        document.head.appendChild(s);
    }

    const cards = Array.from(document.querySelectorAll('.channel-card'));
    let activeCount = 0;

    // Batch processing
    const BATCH_SIZE = 5;
    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const batch = cards.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (card) => {
            if (card.dataset.broken === 'true') return;

            const url = card.dataset.url;
            const indicator = card.querySelector('.status-indicator');

            try {
                // Short timeout ping
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 2500);

                const response = await fetch(url, { method: 'HEAD', signal: controller.signal }).catch(e => {
                    return { ok: false, type: 'opaque' };
                });
                clearTimeout(id);

                if (response.ok) {
                    indicator.style.background = '#2ecc71'; // Green
                    indicator.style.boxShadow = '0 0 8px #2ecc71';
                    activeCount++;
                } else if (response.type === 'opaque') {
                    indicator.style.background = '#f1c40f'; // Yellow
                } else {
                    card.style.opacity = '0.3';
                    card.style.filter = 'grayscale(1)';
                    indicator.style.background = '#e74c3c'; // Red
                }
            } catch (e) {
                card.style.opacity = '0.3';
                card.style.filter = 'grayscale(1)';
                indicator.style.background = '#e74c3c';
            }
        }));
    }

    btn.disabled = false;
    btn.innerHTML = `<span class="material-icons-round">radar</span> Escaneo Completo (${activeCount} Activos)`;
    setTimeout(() => {
        btn.innerHTML = '<span class="material-icons-round">radar</span> Escanear Señales';
    }, 3000);
}


// ... (handleSearch remains)
async function handleSearch(query) {
    if (!query) {
        loadView('home');
        return;
    }

    const container = document.getElementById('view-container');
    container.innerHTML = '<h2>Resultados de búsqueda...</h2>';

    const { channels, countries } = await searchGlobal(query);

    if (channels.length === 0 && countries.length === 0) {
        container.innerHTML = `<h2>Sin resultados para "${query}"</h2>`;
        return;
    }

    if (countries.length > 0) {
        const h3 = document.createElement('h3');
        h3.textContent = "Países encontrados";
        container.appendChild(h3);
        const grid = createGrid();
        countries.forEach(country => {
            const card = createCard();
            card.innerHTML = `
                <img src="https://flagcdn.com/h80/${country.code.toLowerCase()}.png" alt="${country.name}" style="height: 50px; margin-bottom: 1rem; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" onerror="this.onerror=null; this.src='https://via.placeholder.com/80x50?text=${country.code}';">
                <h3>${country.name}</h3>
            `;
            card.onclick = async () => {
                const channels = await getChannelsByFilter('country', country.code);
                renderChannelGrid(channels, `Canales de ${country.name}`);
            };
            grid.appendChild(card);
        });
        container.appendChild(grid);
    }

    if (channels.length > 0) {
        renderChannelGrid(channels, "Canales encontrados", false);
    }
}

// --- Player Logic ---

let playTimeoutTimer;

function openPlayer(channel, list = [], index = -1) {
    const overlay = document.getElementById('player-overlay');
    const title = document.getElementById('player-title');
    const video = document.getElementById('video');
    const header = document.querySelector('.player-header');

    // Update Internal State for Zapping
    if (list.length > 0) {
        currentChannelList = list;
        currentChannelIndex = index;
    }

    // Reset Timeout
    clearTimeout(playTimeoutTimer);

    // Update Remotes
    const nextChan = currentChannelList[currentChannelIndex + 1] || currentChannelList[0];
    const prevChan = currentChannelList[currentChannelIndex - 1] || currentChannelList[currentChannelList.length - 1];

    if (conn && conn.open) {
        conn.send({
            type: 'playing',
            name: channel.name,
            logo: channel.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=1a1a2e&color=fff&size=128`,
            next: nextChan ? nextChan.name : '',
            prev: prevChan ? prevChan.name : ''
        });
    }

    // Save to Recent
    if (!recentChannels.some(c => c.id === channel.id)) {
        recentChannels.unshift(channel);
        if (recentChannels.length > 20) recentChannels.pop();
        localStorage.setItem(RECENT_KEY, JSON.stringify(recentChannels));
    }

    // EPG Player Logic
    const epgMocks = ['Noticias en Vivo', 'Película de Acción', 'Música Global', 'Entrevista Especial', 'Clima y Satélite', 'Cine de Culto'];
    const currentShow = epgMocks[Math.floor(Math.random() * epgMocks.length)];
    const epgEl = document.getElementById('player-epg');
    const showEl = document.getElementById('player-current-show');
    if (epgEl && showEl) {
        epgEl.style.display = 'block';
        showEl.textContent = currentShow;
    }

    // Clear error
    let errorMsg = document.getElementById('player-error-msg');
    if (errorMsg) errorMsg.remove();

    // Remove dynamic buttons
    const existingPip = document.getElementById('pip-btn');
    if (existingPip) existingPip.remove();
    const existingCC = document.getElementById('cc-btn');
    if (existingCC) existingCC.remove();
    const existingAudio = document.getElementById('audio-btn');
    if (existingAudio) existingAudio.remove();

    title.textContent = channel.name;
    overlay.classList.remove('hidden');

    // Intentar Pantalla Completa (Requiere que el usuario haya interactuado con la página previamente)
    try {
        if (!document.fullscreenElement) {
            overlay.requestFullscreen().catch(e => console.warn("Fullscreen bloqueado por el navegador. Requiere interacción previa en la TV."));
        }
    } catch (e) { }

    // Set Safety Timeout (15 seconds)
    playTimeoutTimer = setTimeout(() => {
        console.warn("Channel load timeout triggered");
        // We check if video is ALREADY playing before showing error
        if (video.paused || video.ended || video.readyState < 2) {
            showPlayerError("Sintonización lenta...", false, channel.id);
        }
    }, 15000); // Increased to 15s

    // ... (PiP Button logic)
    if (document.pictureInPictureEnabled) {
        const pipBtn = document.createElement('button');
        pipBtn.id = 'pip-btn';
        pipBtn.className = 'pip-btn';
        pipBtn.innerHTML = '<span class="material-icons-round">picture_in_picture_alt</span>';
        pipBtn.onclick = async () => { try { document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture(); } catch (e) { } };
        header.insertBefore(pipBtn, document.getElementById('close-player'));
    }

    const ccBtn = document.createElement('button');
    ccBtn.id = 'cc-btn';
    ccBtn.className = 'pip-btn';
    ccBtn.style.display = 'none';
    ccBtn.innerHTML = '<span class="material-icons-round">closed_caption</span>';
    header.insertBefore(ccBtn, document.getElementById('close-player'));

    const audioBtn = document.createElement('button');
    audioBtn.id = 'audio-btn';
    audioBtn.className = 'pip-btn';
    audioBtn.style.display = 'none';
    audioBtn.innerHTML = '<span class="material-icons-round">language</span>';
    header.insertBefore(audioBtn, document.getElementById('close-player'));

    if (Hls.isSupported()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 60
        });
        hls.loadSource(channel.url);
        hls.attachMedia(video);

        // Force playsinline for mobile
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');

        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            console.log("HLS Manifest Parsed - Video starting...");
            clearTimeout(playTimeoutTimer);

            // Force play attempt
            const attemptPlay = () => {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        // Success! Hide any play prompt
                        const prompt = document.getElementById('play-prompt-overlay');
                        if (prompt) prompt.remove();
                    }).catch(error => {
                        console.log("Autoplay blocked, trying muted...");
                        video.muted = true;
                        video.play().catch(e => {
                            console.error("Playback still blocked", e);
                            showManualPlayPrompt();
                        });
                    });
                }
            };

            attemptPlay();

            // Second attempt after a short delay just in case
            setTimeout(attemptPlay, 1000);
        });

        // AUTO-HIDE ERROR: If video actually starts playing, remove any error overlay
        video.onplaying = () => {
            clearTimeout(playTimeoutTimer);
            const errorMsg = document.getElementById('player-error-msg');
            if (errorMsg) errorMsg.remove();
        };

        // Aggressive check for actual pixel movement/data
        video.onplay = () => {
            const check = setInterval(() => {
                if (video.currentTime > 0) {
                    const errorMsg = document.getElementById('player-error-msg');
                    if (errorMsg) errorMsg.remove();
                    clearInterval(check);
                }
            }, 500);
            setTimeout(() => clearInterval(check), 5000);
        };

        // ... (CC Logic)
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (e, data) => {
            if (data.subtitleTracks && data.subtitleTracks.length > 0) {
                ccBtn.style.display = 'inline-block';
                ccBtn.onclick = () => {
                    let next = hls.subtitleTrack + 1;
                    if (next >= hls.subtitleTracks.length) next = -1;
                    hls.subtitleTrack = next;
                    const label = next === -1 ? "Desactivados" : (hls.subtitleTracks[next].name || `Pista ${next + 1}`);
                    showToast(`Subtítulos: ${label}`);
                    ccBtn.style.color = next === -1 ? '#fff' : 'var(--accent-secondary)';
                };
            }
        });

        // AUDIO TRACK LOGIC
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (e, data) => {
            if (data.audioTracks && data.audioTracks.length > 1) {
                audioBtn.style.display = 'inline-block';
                audioBtn.onclick = () => {
                    let next = hls.audioTrack + 1;
                    if (next >= hls.audioTracks.length) next = 0;
                    hls.audioTrack = next;
                    const label = hls.audioTracks[next].name || hls.audioTracks[next].lang || `Idioma ${next + 1}`;
                    showToast(`Audio: ${label}`);
                    audioBtn.style.color = 'var(--accent-primary)';
                };
            }
        });

        hls.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                clearTimeout(playTimeoutTimer);
                console.log("HLS Fatal Error", data);
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else {
                    hls.destroy();
                    showPlayerError("Señal no disponible o geobloqueada.", true, channel.id);
                }
            }
        });
        window.currentHls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = channel.url;
        video.addEventListener('loadedmetadata', function () {
            clearTimeout(playTimeoutTimer);

            const attemptPlay = () => {
                video.play().catch(e => {
                    video.muted = true;
                    video.play().catch(err => {
                        showToast("Pulsa OK para reproducir");
                    });
                });
            };

            video.onplaying = () => {
                clearTimeout(playTimeoutTimer);
                const errorMsg = document.getElementById('player-error-msg');
                if (errorMsg) errorMsg.remove();
            };

            video.ontimeupdate = () => {
                if (video.currentTime > 0) {
                    clearTimeout(playTimeoutTimer);
                    const errorMsg = document.getElementById('player-error-msg');
                    if (errorMsg) errorMsg.remove();
                }
            };

            attemptPlay();
            setTimeout(attemptPlay, 1000);
        });
        video.addEventListener('error', function () {
            clearTimeout(playTimeoutTimer);
            showPlayerError("Error al cargar la señal (Nativo).", true, channel.id);
        });
    }
}

// Helper for manual play blocked by browser
function showManualPlayPrompt() {
    if (document.getElementById('play-prompt-overlay')) return;
    const container = document.querySelector('.video-wrapper');
    const div = document.createElement('div');
    div.id = 'play-prompt-overlay';
    div.style.cssText = `
        position: absolute; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.6); display:flex; flex-direction:column;
        align-items:center; justify-content:center; z-index: 100;
        cursor: pointer; backdrop-filter: blur(5px);
    `;
    div.innerHTML = `
        <div style="background:var(--accent-primary); width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow: 0 0 30px var(--accent-primary);">
            <span class="material-icons-round" style="font-size: 50px; color: var(--bg-dark); margin-left: 5px;">play_arrow</span>
        </div>
        <p style="margin-top: 20px; font-weight: bold; font-size: 1.2rem; color: #fff;">Presiona OK para reproducir</p>
    `;
    div.onclick = () => {
        const v = document.getElementById('video');
        if (v) v.play().then(() => div.remove());
    };
    container.appendChild(div);
}

function showPlayerError(msg, isFatal = false, channelId = null) {
    if (isFatal && channelId) {
        markAsBroken(channelId);
    }

    const container = document.querySelector('.video-wrapper');
    if (document.getElementById('player-error-msg')) return;

    const div = document.createElement('div');
    div.id = 'player-error-msg';
    div.style.position = 'absolute';
    div.style.top = '0';
    div.style.left = '0';
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.justifyContent = 'center';
    div.style.alignItems = 'center';
    div.style.background = 'rgba(0,0,0,0.85)';
    div.style.zIndex = '10';
    div.style.color = '#fff';
    div.innerHTML = `
        <span class="material-icons-round" style="font-size: 48px; color: #ff9f43; margin-bottom: 10px;">wifi_off</span>
        <p style="font-size: 1.2rem; font-weight:bold;">Señal inestable o lenta</p>
        <p style="font-size: 0.9rem; color: #ccc; margin-top: 5px; max-width: 80%; text-align: center;">${msg}</p>
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button onclick="this.closest('#player-error-msg').remove()" style="padding:10px 20px; background:var(--accent-primary); border:none; border-radius:30px; color:#050510; cursor:pointer; font-weight:bold;">Ignorar y ver</button>
            <button onclick="document.getElementById('close-player').click()" style="padding:10px 20px; background:rgba(255,255,255,0.1); border:1px solid #555; border-radius:30px; color:#fff; cursor:pointer;">Cerrar Player</button>
        </div>
    `;
    container.appendChild(div);
}

function closePlayer() {
    clearTimeout(playTimeoutTimer);
    // ... (rest of closePlayer logic)
    const overlay = document.getElementById('player-overlay');
    let video = document.getElementById('video');

    if (window.currentHls) {
        try {
            window.currentHls.stopLoad();
            window.currentHls.detachMedia();
            window.currentHls.destroy();
        } catch (e) { console.error(e); }
        window.currentHls = null;
    }

    overlay.classList.add('hidden');

    try {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(e => { });
        }
    } catch (e) { }

    video.pause();
    video.removeAttribute('src');
    video.load();

    // Removed cloneNode to preserve user-gesture 'blessing' on the video element

    const header = document.querySelector('.player-header');
    const existingPip = document.getElementById('pip-btn');
    if (existingPip) existingPip.remove();
    const existingCC = document.getElementById('cc-btn');
    if (existingCC) existingCC.remove();
    const existingAudio = document.getElementById('audio-btn');
    if (existingAudio) existingAudio.remove();

    // Reset Remote State
    if (conn && conn.open) {
        conn.send({ type: 'playing', name: null });
    }
}

async function init() {
    if (window.location.protocol === 'file:') {
        alert("¡Atención! Estás abriendo Allivision desde el explorador de archivos (file://). Para que los canales carguen correctamente, debes usar un servidor local (como Live Server) o subir los archivos a un hosting (GitHub Pages, Vercel, etc.).");
    }
    console.log('Allivision System Initializing...');

    // Load initial content (Home)
    loadView('home');

    // Bind Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            // Handle bubbled click
            const target = e.target.closest('.nav-item');
            target.classList.add('active');
            const view = target.dataset.view;
            loadView(view);
        });
    });

    // Bind Search
    const searchInput = document.getElementById('search-input');
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            handleSearch(e.target.value);
        }, 500);
    });

    // Close Player
    document.getElementById('close-player').addEventListener('click', closePlayer);

    // Bind Remote Modal Actions
    document.getElementById('open-remote-modal').addEventListener('click', () => {
        document.getElementById('pairing-modal').classList.remove('hidden');
        initTVReceiver();
    });
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('pairing-modal').classList.add('hidden');
    });

    // Bind Zapping Buttons (UI)

    // Bind Zapping Buttons
    document.getElementById('zap-next').addEventListener('click', (e) => {
        e.stopPropagation();
        zapNext();
    });
    document.getElementById('zap-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        zapPrev();
    });

    // Global Keyboard Integration (Remote Control Feel)
    document.addEventListener('keydown', (e) => {
        const overlay = document.getElementById('player-overlay');
        const isPlayerOpen = !overlay.classList.contains('hidden');
        const video = document.getElementById('video');

        if (!isPlayerOpen) {
            if (e.key.startsWith('Arrow')) {
                const dir = e.key.replace('Arrow', '').toLowerCase();
                moveFocus(dir);
                e.preventDefault();
            } else if (e.key === 'Enter') {
                const focused = document.querySelector('.focused');
                if (focused) focused.click();
            }
            return;
        }

        // Keys when player is open
        if (e.key === 'ArrowUp') {
            zapNext();
        } else if (e.key === 'ArrowDown') {
            zapPrev();
        } else if (e.key === 'Escape') {
            closePlayer();
        } else if (e.key === 'Enter') {
            video.play();
            showToast("Reproduciendo...");
        } else if (e.key === ' ') {
            e.preventDefault(); // Prevent scroll
            if (video.paused) {
                video.play();
                showToast("Reproduciendo");
            } else {
                video.pause();
                showToast("Pausa");
            }
        }
    });
}

// GLOBAL USER INTERACTION BLESSING (Optimized for TV)
function initBlessing() {
    if (urlParams.has('pair') || savedPairId) return; // Don't show blessing on remote

    const bless = document.createElement('div');
    bless.id = 'bless-overlay';
    bless.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(5, 5, 16, 0.95); z-index: 20000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        cursor: pointer; transition: opacity 0.5s;
    `;
    bless.innerHTML = `
        <div style="text-align:center;">
             <span class="material-icons-round" style="font-size: 5rem; color: var(--accent-primary); margin-bottom: 20px;">touch_app</span>
             <h1 style="color:white; margin-bottom: 15px;">Pulsa en la TV para Activar</h1>
             <p style="color:var(--text-muted); font-size:1.2rem;">Habilitar Pantalla Completa y Sonido Automático</p>
        </div>
    `;

    bless.onclick = () => {
        const v = document.getElementById('video');
        if (v) {
            v.play().then(() => v.pause()).catch(() => { });
            console.log("Video element 'blessed' by TV click.");
        }
        bless.style.opacity = '0';
        setTimeout(() => bless.remove(), 500);

        // Try initial fullscreen on the App
        document.documentElement.requestFullscreen().catch(() => { });
    };

    document.body.appendChild(bless);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!urlParams.has('pair') && !savedPairId) {
        initBlessing();
    }
});

// --- Remote Control System (Peer-to-Peer) ---

function initTVReceiver() {
    if (peer) return;

    // Simplified ID for better discovery
    const simpleId = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = `alli-${simpleId}`; // Even shorter ID

    peer = new Peer(fullId, {
        debug: 1
    });

    peer.on('open', (id) => {
        console.log("TV ID Open:", id);
        document.getElementById('pair-code-display').textContent = simpleId;

        const currentUrl = window.location.href.split('?')[0];
        const remoteUrl = `${currentUrl}?pair=${simpleId}&t=${Date.now()}`;

        const qrContainer = document.getElementById('qrcode');
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
            text: remoteUrl,
            width: 180, height: 180,
            colorDark: "#000000",
            colorLight: "#ffffff"
        });
    });

    peer.on('connection', (connection) => {
        conn = connection;
        console.log("Remote Control Connected!");
        document.getElementById('pairing-status').textContent = "¡Mando conectado!";
        document.getElementById('pairing-status').style.color = "#00ff88";

        // AUTO-LOAD SPANISH CHANNELS FOR ZAPPING
        loadView('spanish_auto');

        setTimeout(() => {
            document.getElementById('pairing-modal').classList.add('hidden');
            showToast("Control remoto vinculado.");
        }, 1500);

        conn.on('data', (data) => {
            handleRemoteCommand(data);
        });
    });

    peer.on('error', (err) => {
        console.error("PeerJS TV Error:", err);
        if (err.type === 'unavailable-id') {
            peer = null;
            initTVReceiver(); // Try again with new ID
        }
    });
}

// Remote Control Initialization
function initRemoteControl(pairId) {
    const style = document.createElement('style');
    style.textContent = `
        body { background: #050510 !important; color: white !important; font-family: 'Inter', sans-serif; overflow: hidden; margin: 0; padding: 0; height: 100vh; width: 100vw; }
        .rem-container { display: flex; flex-direction: column; height: 100dvh; padding: 0; box-sizing: border-box; }
        
        .rem-tabs { display: flex; background: #0f0f1a; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .rem-tab { flex: 1; padding: 15px; text-align: center; color: #8b8b9e; font-size: 0.75rem; font-weight: bold; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; align-items: center; gap: 5px; }
        .rem-tab.active { color: #00f2ff; background: rgba(0, 242, 255, 0.05); box-shadow: inset 0 -3px 0 #00f2ff; }
        .rem-tab .material-icons-round { font-size: 1.5rem; }

        .rem-content { flex: 1; overflow-y: auto; padding: 15px; display: none; }
        .rem-content.active { display: flex; flex-direction: column; gap: 15px; }

        /* Control Tab Styles */
        .now-playing-card { background: linear-gradient(135deg, #1a1a2e, #0f0f1a); border: 1px solid rgba(0, 242, 255, 0.2); border-radius: 16px; padding: 12px; display: flex; align-items: center; gap: 15px; transition: all 0.5s; opacity: 0.3; }
        .now-playing-card.active { opacity: 1; border-radius: 16px; }
        .playing-logo { width: 40px; height: 40px; border-radius: 8px; object-fit: contain; background: #fff; padding: 4px; }
        
        .d-pad-container { position: relative; width: 220px; height: 220px; margin: 10px auto; background: #0f0f1a; border-radius: 50%; border: 4px solid #1a1a2e; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
        .d-btn { position: absolute; background: #1a1a2e; border: 1px solid #2a2a4e; color: white; border-radius: 12px; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; }
        .d-btn:active { background: #00f2ff; color: #050510; }
        .d-btn.up { top: 5px; } .d-btn.down { bottom: 5px; } .d-btn.left { left: 5px; } .d-btn.right { right: 5px; }
        .d-ok { background: #7000ff; width: 70px; height: 70px; border-radius: 50%; border: none; font-weight: bold; box-shadow: 0 0 20px rgba(112,0,255,0.4); }

        /* Trackpad Tab Styles */
        .large-pad { flex: 1; background: #050510; border: 2px dashed #1a1a2e; border-radius: 24px; position: relative; touch-action: none; display: flex; align-items: center; justify-content: center; margin: 10px 0; overflow: hidden; }
        .large-pad::after { content: 'TRACKPAD'; color: #1a1a2e; font-weight: 900; letter-spacing: 10px; font-size: 2rem; pointer-events: none; }

        /* Extras Tab Styles */
        .extras-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .extra-btn { background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 16px; padding: 20px; color: white; display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .extra-btn:active { transform: scale(0.95); background: #2a2a4e; }
        .extra-btn .material-icons-round { font-size: 2rem; color: #00f2ff; }

        /* Common Elements */
        .rem-search-container { position: relative; width: 100%; margin-top: 10px; }
        .rem-search-input { width: 100%; background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 30px; padding: 12px 20px 12px 45px; color: white; outline: none; }
        .search-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #8b8b9e; }
        
        .mini-btn { background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 12px; padding: 12px; color: white; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.8rem; font-weight: bold; width: 100%; border-radius: 12px; }
        .exit-btn { border-color: #ff4757; color: #ff4757; }
        
        .rem-select { width: 100%; background: #1a1a2e; border: 1px solid #00f2ff; border-radius: 12px; padding: 10px; color: white; margin-top: 10px; font-family: inherit; font-size: 0.9rem; outline: none; }
    `;
    document.head.appendChild(style);

    const ui = `
        <div class="rem-container">
            <div style="padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; background: #050510;">
                <div style="font-weight: 900; letter-spacing: 2px; color: #00f2ff; font-size:0.7rem;">ALLIVISION</div>
                <div id="rem-status" style="font-size: 0.6rem; color: #ff4757; font-weight: bold;">DESCONECTADO</div>
            </div>

            <div class="rem-tabs">
                <div class="rem-tab active" data-tab="tv"><span class="material-icons-round">tv</span>TV</div>
                <div class="rem-tab" data-tab="mouse"><span class="material-icons-round">mouse</span>MOUSE</div>
                <div class="rem-tab" data-tab="extras"><span class="material-icons-round">settings</span>EXTRAS</div>
            </div>

            <!-- TV Tab -->
            <div id="tab-tv" class="rem-content active">
                <div id="now-playing" class="now-playing-card">
                    <img src="" class="playing-logo" id="playing-logo" onerror="this.src='https://via.placeholder.com/50'">
                    <div class="playing-info">
                        <h4 id="playing-name">Sintonizador...</h4>
                        <div id="zap-preview" style="font-size: 0.6rem; color: #8b8b9e; margin-top: 4px; display: none;">
                            <div style="display:flex; align-items:center; gap:4px;"><span class="material-icons-round" style="font-size:0.8rem;">arrow_upward</span> <span id="next-chan">...</span></div>
                            <div style="display:flex; align-items:center; gap:4px;"><span class="material-icons-round" style="font-size:0.8rem;">arrow_downward</span> <span id="prev-chan">...</span></div>
                        </div>
                    </div>
                    <span class="material-icons-round" style="color:#00f2ff;">sensors</span>
                </div>
                
                <div class="rem-search-container">
                    <span class="material-icons-round search-icon">search</span>
                    <input type="text" class="rem-search-input" id="rem-search" placeholder="Escribir en la TV...">
                </div>

                <div id="rem-cat-container">
                    <select id="rem-category-select" class="rem-select">
                        <option value="">Cargando categorías...</option>
                    </select>
                </div>

                <div class="d-pad-container">
                    <button class="d-btn up" onclick="sendCmd('up')"><span class="material-icons-round">keyboard_arrow_up</span></button>
                    <button class="d-btn down" onclick="sendCmd('down')"><span class="material-icons-round">keyboard_arrow_down</span></button>
                    <button class="d-btn left" onclick="sendCmd('left')"><span class="material-icons-round">keyboard_arrow_left</span></button>
                    <button class="d-btn right" onclick="sendCmd('right')"><span class="material-icons-round">keyboard_arrow_right</span></button>
                    <button class="d-btn d-ok" onclick="sendCmd('enter')">OK</button>
                </div>

                <div class="grid-mini">
                    <button class="mini-btn" onclick="sendCmd('vol-up')"><span class="material-icons-round">volume_up</span> VOL+</button>
                    <button class="mini-btn" onclick="sendCmd('next')"><span class="material-icons-round">skip_next</span> CH+</button>
                    <button class="mini-btn" onclick="sendCmd('vol-down')"><span class="material-icons-round">volume_down</span> VOL-</button>
                    <button class="mini-btn" onclick="sendCmd('prev')"><span class="material-icons-round">skip_previous</span> CH-</button>
                </div>
            </div>

            <!-- Mouse Tab -->
            <div id="tab-mouse" class="rem-content">
                <div style="color: #666; text-align: center; font-size: 0.8rem;">Desliza para mover el cursor • Toca para hacer click</div>
                <div id="large-pad" class="large-pad"></div>
                <div class="grid-mini">
                    <button class="mini-btn" onclick="sendCmd('left')">ATRAS</button>
                    <button class="mini-btn exit-btn" onclick="sendCmd('close')">SALIR</button>
                </div>
            </div>

            <!-- Extras Tab -->
            <div id="tab-extras" class="rem-content">
                <div class="extras-grid">
                    <button class="extra-btn" onclick="sendCmd('spanish-tv')" style="background: linear-gradient(135deg, #7000ff, #00f2ff); color: #050510;">
                        <span class="material-icons-round" style="color: #050510;">tv</span>
                        <b>TV ESPAÑOL</b>
                    </button>
                    <button class="extra-btn" onclick="sendCmd('english-tv')" style="background: linear-gradient(135deg, #00f2ff, #7000ff); color: #050510;">
                        <span class="material-icons-round" style="color: #050510;">language</span>
                        <b>ENGLISH TV</b>
                    </button>
                    <button class="extra-btn" onclick="sendCmd('ambient')"><span class="material-icons-round">landscape</span>Ambiente</button>
                    <button class="extra-btn" onclick="sendCmd('mosaic')"><span class="material-icons-round">grid_view</span>Mosaico</button>
                    <button class="extra-btn" onclick="sendCmd('mute')"><span class="material-icons-round">volume_off</span>Silenciar</button>
                    <button class="extra-btn" onclick="sendCmd({type:'fullscreen'})">
                        <span class="material-icons-round">fullscreen</span>
                        <b>PANTALLA</b>
                    </button>
                    <button id="pwa-install-btn" class="extra-btn" style="display:none; background:rgba(255,255,255,0.1); border:1px solid var(--accent-primary);">
                        <span class="material-icons-round" style="color:var(--accent-primary);">download</span>
                        <b>Instalar App</b>
                    </button>
                </div>
                <button class="mini-btn exit-btn" onclick="location.reload()" style="margin-top:auto;">Reiniciar Mando</button>
            </div>
        </div>
    `;
    document.body.innerHTML = ui;

    // Tab Logic
    document.querySelectorAll('.rem-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.rem-tab, .rem-content').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            if (navigator.vibrate) navigator.vibrate(20);
        };
    });

    // PWA Install Logic for Remote
    const installBtn = document.getElementById('pwa-install-btn');
    if (window.pwaDeferredPrompt) {
        installBtn.style.display = 'flex';
        installBtn.onclick = async () => {
            window.pwaDeferredPrompt.prompt();
            const { outcome } = await window.pwaDeferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none';
            }
            window.pwaDeferredPrompt = null;
        };
    }

    // Listen for the prompt if it hasn't fired yet
    window.addEventListener('beforeinstallprompt', (e) => {
        if (installBtn) {
            installBtn.style.display = 'flex';
            installBtn.onclick = async () => {
                e.prompt();
                const { outcome } = await e.userChoice;
                if (outcome === 'accepted') installBtn.style.display = 'none';
            };
        }
    });

    // Load Categories for Remote
    getCategories().then(cats => {
        const select = document.getElementById('rem-category-select');
        if (select) {
            select.innerHTML = '<option value="">Filtrar Categoría...</option>';
            cats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = `${c.name} (${c.count})`;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                if (e.target.value) {
                    sendCmd({ type: 'load-category', category: e.target.value });
                    showToast(`TV: Cargando ${e.target.value}`);
                }
            };
        }
    });

    const peerObj = new Peer();
    peerObj.on('open', () => {
        const connObj = peerObj.connect(`alli-${pairId}`, { reliable: true });
        window.sendCmd = (c) => { if (connObj.open) { connObj.send(c); if (navigator.vibrate) navigator.vibrate(35); } };

        // Search Handlers
        document.getElementById('rem-search').oninput = (e) => {
            if (connObj.open) connObj.send({ type: 'search', query: e.target.value });
        };

        // Trackpad Handlers
        const pad = document.getElementById('large-pad');
        let startX = 0, startY = 0, lastX = 0, lastY = 0, totalDist = 0;

        pad.addEventListener('touchstart', e => {
            startX = lastX = e.touches[0].clientX;
            startY = lastY = e.touches[0].clientY;
            totalDist = 0;
        });

        pad.addEventListener('touchmove', e => {
            const dx = (e.touches[0].clientX - lastX) * 2.5;
            const dy = (e.touches[0].clientY - lastY) * 2.5;

            totalDist += Math.sqrt(dx * dx + dy * dy);
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;

            if (connObj.open) connObj.send({ type: 'move', dx, dy });
        });

        pad.addEventListener('touchend', () => {
            // If the total movement was very small (less than 10px), count it as a click
            if (totalDist < 10 && connObj.open) {
                connObj.send({ type: 'click' });
                if (navigator.vibrate) navigator.vibrate(50);
            }
        });

        connObj.on('data', data => {
            if (data.type === 'playing') {
                const card = document.getElementById('now-playing');
                document.getElementById('playing-name').textContent = data.name || "En espera...";
                document.getElementById('playing-logo').src = data.logo || "";
                card.classList.toggle('active', !!data.name);

                if (data.next || data.prev) {
                    document.getElementById('zap-preview').style.display = 'block';
                    document.getElementById('next-chan').textContent = data.next || '...';
                    document.getElementById('prev-chan').textContent = data.prev || '...';
                }
            } else if (data.type === 'focus-search') {
                document.getElementById('rem-search').focus();
            }
        });

        connObj.on('open', () => {
            const st = document.getElementById('rem-status');
            st.textContent = "EN LINEA";
            st.classList.add('online');
        });
    });
}

function handleRemoteCommand(cmd) {
    console.log("Remote Command received:", cmd);

    // Exit Ambient Mode on any command except ambient toggle
    if (isAmbientMode && cmd !== 'ambient') {
        toggleAmbientMode();
        return; // Don't process the original command yet, or do we? 
        // User probably wants to exit first. Actually let's just exit and continue.
    }

    // Handle Object-based commands (Trackpad)
    if (typeof cmd === 'object') {
        initCursor();
        cursorEl.style.display = 'block';

        if (cmd.type === 'move') {
            cursorX += cmd.dx * 1.5;
            cursorY += cmd.dy * 1.5;
            cursorX = Math.max(0, Math.min(window.innerWidth, cursorX));
            cursorY = Math.max(0, Math.min(window.innerHeight, cursorY));
            cursorEl.style.transform = `translate(${cursorX - 12}px, ${cursorY - 12}px)`;

            const target = document.elementFromPoint(cursorX, cursorY);
            if (target) {
                const card = target.closest('.channel-card, .nav-item, .category-card, .close-btn, .search-box, .glass-select, .pip-btn, .extra-btn, button, [onclick]');
                document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
                if (card) card.classList.add('focused');
            }
        } else if (cmd.type === 'click') {
            const target = document.elementFromPoint(cursorX, cursorY);
            if (target) {
                console.log("Virtual Click on:", target);
                // Simulate full mouse interaction
                const options = { bubbles: true, cancelable: true, view: window };
                target.dispatchEvent(new MouseEvent('mousedown', options));
                target.dispatchEvent(new MouseEvent('mouseup', options));
                target.click();

                // If it's an input/select, focus it
                if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') {
                    target.focus();
                }
            }
        } else if (cmd.type === 'search') {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = cmd.query;
                handleSearch(cmd.query);
                currentFocusScope = 'search';
                applyFocus();
            }
        } else if (cmd.type === 'load-category') {
            loadView('categories').then(() => {
                getChannelsByFilter('category', cmd.category).then(channels => {
                    renderChannelGrid(channels, `Categoría: ${cmd.category}`, true, { type: 'category', value: cmd.category });
                });
            });
        } else if (cmd.type === 'fullscreen') {
            const overlay = document.getElementById('player-overlay');
            if (!document.fullscreenElement) {
                overlay.requestFullscreen().catch(e => {
                    console.warn("Fullscreen error", e);
                    showToast("Pulsa OK en la TV para autorizar pantalla completa");
                });
            } else {
                document.exitFullscreen().catch(e => { });
            }
        }
        return;
    }

    const video = document.getElementById('video');
    const isPlayerOpen = !document.getElementById('player-overlay').classList.contains('hidden');

    // Hide cursor if using D-Pad
    if (cursorEl) cursorEl.style.display = 'none';

    // Navigation Mapping
    if (!isPlayerOpen) {
        if (['up', 'down', 'left', 'right'].includes(cmd)) {
            moveFocus(cmd);
            return;
        }
        if (cmd === 'enter') {
            const focused = document.querySelector('.focused');
            if (focused) {
                focused.click();
                return;
            }
        }
    }

    switch (cmd) {
        case 'next': zapNext(); break;
        case 'prev': zapPrev(); break;
        case 'vol-up':
            if (video) {
                video.muted = false;
                const oldVol = video.volume;
                video.volume = Math.min(1, video.volume + 0.1);
                const currentVol = Math.round(video.volume * 100);
                showToast(`Volumen TV: ${currentVol}%`);
                if (video.volume === oldVol && oldVol < 1) {
                    console.warn("Volume change blocked by browser");
                    showToast("Control de volumen limitado por el navegador");
                }
            }
            break;
        case 'vol-down':
            if (video) {
                const oldVol = video.volume;
                video.volume = Math.max(0, video.volume - 0.1);
                const currentVol = Math.round(video.volume * 100);
                showToast(`Volumen TV: ${currentVol}%`);
                if (video.volume === oldVol && oldVol > 0) {
                    console.warn("Volume change blocked by browser");
                }
            }
            break;
        case 'mute': video.muted = !video.muted; showToast(video.muted ? "Silenciado" : "Sonido activado"); break;
        case 'close': closePlayer(); break;
        case 'ambient': toggleAmbientMode(); break;
        case 'mosaic': loadView('home'); showToast("Cargando mosaico de canales..."); break;
        case 'spanish-tv': loadView('spanish_auto'); break;
        case 'english-tv': loadView('english_auto'); break;
        case 'sleep-30': setSleepTimer(30); break;
        case 'left': if (isPlayerOpen) { closePlayer(); } else { moveFocus('left'); } break;
        case 'right': if (!isPlayerOpen) moveFocus('right'); break;
        case 'up': if (isPlayerOpen) zapNext(); else moveFocus('up'); break;
        case 'down': if (isPlayerOpen) zapPrev(); else moveFocus('down'); break;
        case 'enter':
            if (isPlayerOpen) {
                video.muted = false; // Attempt to un-mute on OK
                video.play().then(() => {
                    showToast("Reproduciendo...");
                    // Also hide error if it was visible
                    const err = document.getElementById('player-error-msg');
                    if (err) err.remove();
                    const prompt = document.getElementById('play-prompt-overlay');
                    if (prompt) prompt.remove();
                }).catch(e => {
                    console.error("Manual play failed:", e);
                    showToast("Error de reproducción. Intenta de nuevo.");
                });
            } else {
                const f = document.querySelector('.focused');
                if (f) f.click();
            }
            break;
    }
}

function setSleepTimer(minutes) {
    if (sleepTimerId) clearTimeout(sleepTimerId);
    showToast(`Temporizador activado: Allivision se detendrá en ${minutes} min.`);
    sleepTimerId = setTimeout(() => {
        closePlayer();
        showToast("Sleep timer activado. ¡Buenas noches!");
    }, minutes * 60000);
}

function toggleAmbientMode() {
    isAmbientMode = !isAmbientMode;
    let ambient = document.getElementById('ambient-overlay');

    if (isAmbientMode) {
        if (!ambient) {
            ambient = document.createElement('div');
            ambient.id = 'ambient-overlay';
            ambient.style.cssText = `
                position: fixed; top:0; left:0; width:100%; height:100%; 
                background: #000; z-index: 5000; display:flex; 
                flex-direction:column; align-items:center; justify-content:center;
                background-size: cover; background-position: center;
                transition: all 1s ease;
            `;
            ambient.innerHTML = `
                <div id="ambient-clock" style="font-size: 8rem; font-weight: 900; color: #fff; text-shadow: 0 0 30px rgba(0,0,0,0.5); font-family: 'Outfit';">00:00</div>
                <div id="ambient-weather" style="font-size: 1.5rem; color: var(--accent-primary); margin-top: -20px;">Sintonizando paz global...</div>
            `;
            document.body.appendChild(ambient);

            setInterval(() => {
                const now = new Date();
                document.getElementById('ambient-clock').textContent = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
            }, 1000);
        }

        // Random Premium Backgrounds
        const bg = [
            'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1920&q=80',
            'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1920&q=80',
            'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1920&q=80'
        ];
        ambient.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url('${bg[Math.floor(Math.random() * bg.length)]}')`;
        ambient.style.display = 'flex';
        closePlayer();
    } else {
        if (ambient) ambient.style.display = 'none';
        showToast("Modo ambiente desactivado.");
    }
}

function moveFocus(dir) {
    const sidebarItems = Array.from(document.querySelectorAll('.nav-item'));
    const gridItems = Array.from(document.querySelectorAll('.channel-card, .category-card, .language-card, .country-card'));
    const searchInput = document.querySelector('.search-box');

    // Clear current focus
    document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

    if (currentFocusScope === 'search') {
        if (dir === 'down') {
            currentFocusScope = 'grid';
            currentFocusIndex = 0;
        } else if (dir === 'left') {
            currentFocusScope = 'sidebar';
            currentFocusIndex = 0;
        }
    } else if (currentFocusScope === 'sidebar') {
        if (dir === 'up') {
            if (currentFocusIndex === 0) {
                currentFocusScope = 'search';
            } else {
                currentFocusIndex = Math.max(0, currentFocusIndex - 1);
            }
        } else if (dir === 'down') {
            currentFocusIndex = Math.min(sidebarItems.length - 1, currentFocusIndex + 1);
        } else if (dir === 'right' || dir === 'enter') {
            if (gridItems.length > 0) {
                currentFocusScope = 'grid';
                currentFocusIndex = 0;
            }
        }
    } else {
        // Grid Navigation Logic
        const container = document.getElementById('view-container');
        const grid = container.querySelector('.grid-channels, .grid-categories, .grid-languages, .grid-countries') || container;

        // Dynamic Column Calculation
        const firstItem = gridItems[0];
        let cols = 1;
        if (firstItem && gridItems.length > 1) {
            const firstRect = firstItem.getBoundingClientRect();
            const secondItem = gridItems[1];
            const secondRect = secondItem.getBoundingClientRect();

            if (secondRect.top === firstRect.top) {
                // Find how many are in the same row
                cols = 0;
                for (let i = 0; i < gridItems.length; i++) {
                    if (gridItems[i].getBoundingClientRect().top === firstRect.top) cols++;
                    else break;
                }
            }
        }

        if (dir === 'left') {
            if (currentFocusIndex % cols === 0) {
                currentFocusScope = 'sidebar';
                currentFocusIndex = 0;
            } else {
                currentFocusIndex = Math.max(0, currentFocusIndex - 1);
            }
        } else if (dir === 'right') {
            currentFocusIndex = Math.min(gridItems.length - 1, currentFocusIndex + 1);
        } else if (dir === 'up') {
            if (currentFocusIndex < cols) {
                currentFocusScope = 'search';
            } else {
                currentFocusIndex -= cols;
            }
        } else if (dir === 'down') {
            if (currentFocusIndex + cols < gridItems.length) {
                currentFocusIndex += cols;
            } else {
                if (currentFocusIndex < gridItems.length - 1) currentFocusIndex = gridItems.length - 1;
            }
        }
    }

    applyFocus();
}

function applyFocus() {
    // Search Box Focus
    if (currentFocusScope === 'search') {
        const searchBox = document.querySelector('.search-box');
        const input = document.getElementById('search-input');
        if (searchBox) {
            searchBox.classList.add('focused');
            if (input) input.focus();
            searchBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Signal remote to open keyboard if connected
            if (conn && conn.open) {
                conn.send({ type: 'focus-search' });
            }
        }
        return;
    } else {
        // Blur search if not in scope
        const input = document.getElementById('search-input');
        if (input) input.blur();
    }

    const items = currentFocusScope === 'sidebar'
        ? Array.from(document.querySelectorAll('.nav-item'))
        : Array.from(document.querySelectorAll('.channel-card, .category-card, .language-card, .country-card'));

    if (items[currentFocusIndex]) {
        const target = items[currentFocusIndex];
        target.classList.add('focused');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function zapNext() {
    if (currentChannelList.length === 0) return;
    currentChannelIndex++;
    if (currentChannelIndex >= currentChannelList.length) currentChannelIndex = 0; // Wrap around
    openPlayer(currentChannelList[currentChannelIndex]);
    showToast(`Cambiando a: ${currentChannelList[currentChannelIndex].name}`);
}

function zapPrev() {
    if (currentChannelList.length === 0) return;
    currentChannelIndex--;
    if (currentChannelIndex < 0) currentChannelIndex = currentChannelList.length - 1; // Wrap around
    openPlayer(currentChannelList[currentChannelIndex]);
    showToast(`Cambiando a: ${currentChannelList[currentChannelIndex].name}`);
}

// --- Navigation & Views ---

async function loadView(viewName) {
    const container = document.getElementById('view-container');
    container.innerHTML = '<div class="hero-section"><p>Cargando señal del mundo...</p></div>';

    // Reset Navigation Index
    currentFocusIndex = 0;

    try {
        if (viewName === 'home') {
            const channels = await getFeaturedChannels();
            renderChannelGrid(channels, 'Canales Destacados');
        } else if (viewName === 'countries') {
            const countries = await getCountries();
            renderCountries(countries);
        } else if (viewName === 'categories') {
            const categories = await getCategories();
            renderCategories(categories);
        } else if (viewName === 'languages') {
            const languages = await getLanguages();
            renderLanguages(languages);
        } else if (viewName === 'favorites') {
            if (favorites.length === 0) {
                container.innerHTML = `
                    <h2>Favoritos</h2>
                    <div class="hero-section">
                        <span class="material-icons-round" style="font-size: 64px; color: var(--text-muted);">favorite_border</span>
                        <p>Aún no tienes canales favoritos.</p>
                        <p style="font-size: 0.9rem; color: var(--text-muted);">Dale al corazón ❤️ en los canales que te gusten.</p>
                    </div>`;
            } else {
                const favChannels = await getChannelsByFilter('id_list', favorites);
                renderChannelGrid(favChannels, 'Tus Canales Favoritos');
            }
        } else if (viewName === 'recent') {
            if (recentChannels.length === 0) {
                container.innerHTML = `
                    <h2>Recientes</h2>
                    <div class="hero-section">
                        <span class="material-icons-round" style="font-size: 64px; color: var(--text-muted);">history</span>
                        <p>No has visto ningún canal recientemente.</p>
                    </div>`;
            } else {
                renderChannelGrid(recentChannels, 'Vistos Recientemente');
            }
        } else if (viewName === 'spanish_auto') {
            const channels = await getChannelsByFilter('language', 'Español');
            renderChannelGrid(channels, 'Zapping: Canales en Español');

            if (channels.length > 0) {
                currentChannelList = channels;
                currentChannelIndex = 0;
                showToast("Sintonizando TV en Español...");
                // Pass full context to openPlayer
                setTimeout(() => openPlayer(channels[0], channels, 0), 800);
            }
        } else if (viewName === 'english_auto') {
            const channels = await getChannelsByFilter('language', 'Inglés');
            renderChannelGrid(channels, 'Zapping: English TV');

            if (channels.length > 0) {
                currentChannelList = channels;
                currentChannelIndex = 0;
                showToast("Sintonizando TV en Inglés...");
                // Pass full context to openPlayer
                setTimeout(() => openPlayer(channels[0], channels, 0), 800);
            }
        }
    } catch (e) {
        console.error("View Error", e);
        const isTimeout = e.name === 'AbortError';
        container.innerHTML = `
            <div class="hero-section">
                <span class="material-icons-round" style="font-size: 48px; color: #ff4757; margin-bottom: 20px;">cloud_off</span>
                <h2>Conexión interrumpida</h2>
                <p>${isTimeout ? 'La sintonización tardó demasiado. Revisa tu internet.' : 'Hubo un problema al conectar con el satélite global.'}</p>
                <button onclick="location.reload()" style="margin-top:2rem; padding: 12px 24px; background: var(--accent-primary); border:none; border-radius:30px; color:var(--bg-dark); font-weight:bold; cursor:pointer;">
                    Reintentar Conexión
                </button>
            </div>`;
    }
}

// --- Rendering Functions ---

// Updated to support Secondary Filtering
async function renderChannelGrid(channels, title, clear = true, filterContext = null) {
    const container = document.getElementById('view-container');
    if (clear) {
        // Prepare Scanner Button HTML
        const showScanner = channels.length > 0;
        const scannerBtn = showScanner ?
            `<button id="scan-btn" class="scan-button" onclick="scanCurrentView()">
                <span class="material-icons-round">radar</span> Escanear Señales
             </button>` : '';

        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
                <div style="display:flex; align-items:center; gap: 15px;">
                    <h2 style="margin:0;">${title}</h2>
                    ${scannerBtn}
                </div>
            </div>
            <div id="grid-skeleton" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;">
                ${Array(12).fill('<div class="skeleton" style="height: 180px;"></div>').join('')}
            </div>`;
    } else {
        const h = document.createElement('h3');
        h.textContent = title;
        container.appendChild(h);
    }

    // Add Filter Dropdown if Context is provided
    if (filterContext) {
        let secondaryKey = '';
        let label = '';

        if (filterContext.type === 'category') {
            secondaryKey = 'language';
            label = 'Idioma';
        } else if (filterContext.type === 'language' || filterContext.type === 'country') {
            secondaryKey = 'category';
            label = 'Categoría';
        }

        if (secondaryKey) {
            // Get options
            const fullSubset = await getChannelsByFilter(filterContext.type, filterContext.value);
            const options = await getUniqueValuesFromSubset(fullSubset, secondaryKey);

            if (options.length > 1) {
                const dropdownWrap = document.createElement('div');
                dropdownWrap.className = 'custom-dropdown-wrap';
                dropdownWrap.style.cssText = `position:relative; margin-left:auto; z-index:100;`;

                const btn = document.createElement('button');
                btn.className = 'glass-select';
                btn.style.cssText = `
                    padding: 8px 16px; border-radius: 8px; border: 1px solid var(--glass-border);
                    background: var(--bg-panel); color: #fff; cursor: pointer; display: flex; 
                    align-items: center; gap: 8px; font-weight: 500; font-family: inherit;
                `;
                const currentValLabel = filterContext.secondaryValue && filterContext.secondaryValue !== 'all' ? filterContext.secondaryValue : `Todos (${label})`;
                btn.innerHTML = `<span>${currentValLabel}</span> <span class="material-icons-round" style="font-size:1.2rem;">expand_more</span>`;

                const menu = document.createElement('div');
                menu.className = 'custom-dropdown-menu hidden';
                menu.style.cssText = `
                    position: absolute; top: calc(100% + 5px); right: 0; min-width: 180px;
                    background: var(--bg-panel); border: 1px solid var(--glass-border);
                    border-radius: 12px; backdrop-filter: blur(20px); box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    overflow: hidden; padding: 5px;
                `;

                const createOpt = (name, count, isAll = false) => {
                    const opt = document.createElement('div');
                    opt.className = 'dropdown-item';
                    opt.style.cssText = `
                        padding: 10px 15px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;
                        transition: background 0.2s; display: flex; justify-content: space-between;
                    `;
                    opt.innerHTML = `<span>${isAll ? `Todos (${label})` : name}</span> ${isAll ? '' : `<span style="color:var(--text-muted); opacity:0.7">${count}</span>`}`;
                    opt.onclick = async () => {
                        const val = isAll ? 'all' : name;
                        const newChannels = await getChannelsByFilter(filterContext.type, filterContext.value, secondaryKey, val);
                        renderChannelGrid(newChannels, title, true, {
                            ...filterContext,
                            secondaryValue: val
                        });
                    };
                    opt.onmouseenter = () => opt.style.background = 'rgba(255,255,255,0.1)';
                    opt.onmouseleave = () => opt.style.background = 'transparent';
                    return opt;
                };

                menu.appendChild(createOpt('all', 0, true));
                options.forEach(opt => menu.appendChild(createOpt(opt.name, opt.count)));

                btn.onclick = (e) => {
                    e.stopPropagation();
                    const isOpen = !menu.classList.contains('hidden');
                    document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.classList.add('hidden'));
                    if (!isOpen) menu.classList.remove('hidden');
                };

                document.addEventListener('click', () => menu.classList.add('hidden'), { once: false });

                dropdownWrap.appendChild(btn);
                dropdownWrap.appendChild(menu);
                container.firstElementChild.appendChild(dropdownWrap);
            }
        }
    }

    if (clear) {
        document.getElementById('grid-skeleton')?.remove();
    }

    const grid = document.createElement('div');
    grid.className = 'grid-channels';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
    grid.style.gap = '16px';

    if (channels.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#aaa; margin-top:20px;">No se encontraron canales con este filtro.</p>';
    }

    channels.forEach((channel, index) => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.style.background = 'var(--bg-panel)';
        card.style.padding = '1rem';
        card.style.borderRadius = '12px';
        card.style.border = '1px solid var(--glass-border)';
        card.style.cursor = 'pointer';
        card.style.transition = 'transform 0.2s';
        card.style.position = 'relative';

        // ... URL for scanner etc ...
        card.dataset.url = channel.url;

        // --- Smart Logo Logic ---
        let logoSrc = channel.logo;

        // Use official logo OR favicon from website
        if (!logoSrc && channel.website) {
            try {
                const domain = new URL(channel.website).hostname;
                logoSrc = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
            } catch (e) { }
        }

        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=1a1a2e&color=fff&size=128&length=2&font-size=0.5`;
        let finalLogo = logoSrc || avatarUrl;

        let iconHtml = `<img src="${finalLogo}" 
                             loading="lazy" 
                             referrerpolicy="no-referrer" 
                             alt="${channel.name}" 
                             style="max-width: 100%; max-height: 100%; object-fit: contain; width: auto; height: auto;" 
                             onerror="this.onerror=null; this.src='${avatarUrl}';">`;

        const flagUrl = channel.country_code ? `https://flagcdn.com/w20/${channel.country_code.toLowerCase()}.png` : '';
        const isFav = favorites.includes(channel.id);

        // EPG Mock Logic
        const epgMocks = [
            'Noticias en Vivo', 'Película de Acción', 'Deportes Extremos', 'Documental: Planeta Tierra',
            'Serie de Comedia', 'Música Global', 'Entrevista Especial', 'Cocina con Pasión',
            'Resumen de la Jornada', 'Top 10 Semanal', 'Clima y Satélite', 'Cine de Culto'
        ];
        const currentShow = epgMocks[Math.floor(Math.random() * epgMocks.length)];
        const progress = Math.floor(Math.random() * 80) + 10;

        card.innerHTML = `
            <div class="status-indicator"></div>
            <button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${channel.id}', this)">
                <span class="material-icons-round">${isFav ? 'favorite' : 'favorite_border'}</span>
            </button>
            <div style="height: 100px; background: #fff; border-radius: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; padding: 8px; overflow: hidden;">
                ${iconHtml}
            </div>
            <h3 style="font-size: 0.9rem; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${channel.name}</h3>
            <div style="font-size: 0.65rem; color: var(--accent-primary); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span class="material-icons-round" style="font-size: 0.7rem; vertical-align: middle;">play_circle</span> ${currentShow}
            </div>
            <div style="height: 2px; width: 100%; background: rgba(255,255,255,0.1); margin-bottom: 8px;">
                <div style="height: 100%; width: ${progress}%; background: var(--accent-primary);"></div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted);">
                ${flagUrl ? `<img src="${flagUrl}" style="width: 14px; border-radius: 2px;" onerror="this.style.display='none'">` : ''}
                <span>${channel.country}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            currentFocusScope = 'grid';
            currentFocusIndex = index;
            openPlayer(channel, channels, index);
        });
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

function renderCountries(countries) {
    const container = document.getElementById('view-container');
    container.innerHTML = `<h2>Explorar por País</h2><br>`;

    const grid = createGrid();
    countries.forEach(country => {
        const card = createCard();
        card.innerHTML = `
            <img src="https://flagcdn.com/h80/${country.code.toLowerCase()}.png" alt="${country.name}" style="height: 50px; margin-bottom: 1rem; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" onerror="this.onerror=null; this.src='https://via.placeholder.com/80x50?text=${country.code}';">
            <h3>${country.name}</h3>
        `;
        card.onclick = async () => {
            const channels = await getChannelsByFilter('country', country.code);
            renderChannelGrid(channels, `Canales de ${country.name} (${channels.length})`, true, { type: 'country', value: country.code });
        };
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

function renderCategories(categories) {
    const container = document.getElementById('view-container');
    container.innerHTML = `<h2>Explorar por Categoría</h2><br>`;

    const icons = {
        'News': 'newspaper',
        'General': 'grid_view',
        'Music': 'music_note',
        'Entertainment': 'movie_filter',
        'Movies': 'movie',
        'Kids': 'child_care',
        'Documentary': 'menu_book',
        'Sports': 'sports_soccer',
        'Education': 'school',
        'Business': 'business',
        'Culture': 'palette',
        'Science': 'science',
        'Religious': 'church'
    };

    const grid = createGrid();
    categories.forEach(cat => {
        const card = createCard('category-card');
        const icon = icons[cat.name] || 'tv';

        card.innerHTML = `
            <span class="material-icons-round category-icon">${icon}</span>
            <h3>${cat.name}</h3>
            <span style="font-size:0.8rem; color:var(--text-muted);">${cat.count} canales</span>
        `;
        card.onclick = async () => {
            const channels = await getChannelsByFilter('category', cat.name);
            // Pass context for secondary filtering (Allows Language Filtering inside Category)
            renderChannelGrid(channels, `Categoría: ${cat.name}`, true, { type: 'category', value: cat.name });
        };
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

function renderLanguages(languages) {
    const container = document.getElementById('view-container');
    container.innerHTML = `<h2>Explorar por Idioma</h2><br>`;

    const grid = createGrid();
    languages.forEach(lang => {
        const card = createCard('language-card');
        card.innerHTML = `
           <span class="material-icons-round category-icon" style="color: var(--accent-secondary);">translate</span>
            <h3>${lang.name}</h3>
            <span style="font-size:0.8rem; color:var(--text-muted);">${lang.count} canales</span>
        `;
        card.onclick = async () => {
            const channels = await getChannelsByFilter('language', lang.name);
            // Pass context for secondary filtering (Allows Category Filtering inside Language)
            renderChannelGrid(channels, `Idioma: ${lang.name}`, true, { type: 'language', value: lang.name });
        };
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

function createGrid() {
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(140px, 1fr))';
    grid.style.gap = '16px';
    return grid;
}

function createCard(extraClass = '') {
    const card = document.createElement('div');
    card.className = `category-card ${extraClass}`;
    return card;
}

// --- Favorites Logic ---
window.toggleFavorite = function (id, btnElement) {
    const index = favorites.indexOf(id);
    if (index === -1) {
        favorites.push(id);
        btnElement.classList.add('active');
        btnElement.querySelector('span').textContent = 'favorite';
        showToast('Añadido a Favoritos');
    } else {
        favorites.splice(index, 1);
        btnElement.classList.remove('active');
        btnElement.querySelector('span').textContent = 'favorite_border';
        showToast('Eliminado de Favoritos');
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));

    // Reload if needed
    const activeNav = document.querySelector('.nav-item.active');
    if (activeNav && activeNav.dataset.view === 'favorites') {
        loadView('favorites');
    }
}

function showToast(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '50%';
    div.style.transform = 'translateX(-50%)';
    div.style.background = 'rgba(0,0,0,0.8)';
    div.style.color = '#fff';
    div.style.padding = '10px 20px';
    div.style.borderRadius = '50px';
    div.style.zIndex = '2000';
    div.style.animation = 'fadeIn 0.3s';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2000);
}

// --- Search Logic ---

// End of Application Logic
