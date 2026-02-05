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
// This must run before DOMContentLoaded to prevent loading 11,000 channels on mobile
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('pair')) {
    const pairId = urlParams.get('pair');
    console.log("Remote Mode Initializing...");
    // Force immediate execution to avoid channel list loading
    initRemoteControl(pairId);
} else {
    document.addEventListener('DOMContentLoaded', init);
}

// --- State Management ---
const FAVORITES_KEY = 'allivision_favs';
const BROKEN_KEY = 'allivision_broken';
let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
let brokenChannels = JSON.parse(localStorage.getItem(BROKEN_KEY)) || [];

// --- Remote Control State ---
let currentChannelList = [];
let currentChannelIndex = -1;
let peer = null;
let conn = null;

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

    // Update Remote if connected
    if (conn && conn.open) {
        conn.send({
            type: 'playing',
            name: channel.name,
            logo: channel.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=1a1a2e&color=fff&size=128`
        });
    }

    // Clear error
    let errorMsg = document.getElementById('player-error-msg');
    if (errorMsg) errorMsg.remove();

    // Remove dynamic buttons
    const existingPip = document.getElementById('pip-btn');
    if (existingPip) existingPip.remove();
    const existingCC = document.getElementById('cc-btn');
    if (existingCC) existingCC.remove();

    title.textContent = channel.name;
    overlay.classList.remove('hidden');

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

            // Try playing
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("Autoplay prevented, trying muted...", error);
                    video.muted = true;
                    video.play().catch(e => console.error("Final playback block", e));
                    showToast("Silenciado para iniciar reproducción");
                });
            }
        });

        // AUTO-HIDE ERROR: If video actually starts playing, remove any error overlay
        video.onplaying = () => {
            clearTimeout(playTimeoutTimer);
            const errorMsg = document.getElementById('player-error-msg');
            if (errorMsg) errorMsg.remove();
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
            if (video.textTracks && video.textTracks.length > 0) {
                ccBtn.style.display = 'inline-block';
                ccBtn.onclick = () => { video.controls = true; };
            }
            video.play();
        });
        video.addEventListener('error', function () {
            clearTimeout(playTimeoutTimer);
            showPlayerError("Error al cargar la señal (Nativo).", true, channel.id);
        });
    }
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
        <span class="material-icons-round" style="font-size: 48px; color: #ff9f43; margin-bottom: 10px;">hourglass_empty</span>
        <p style="font-size: 1.2rem; font-weight:bold;">${msg}</p>
        <p style="font-size: 0.9rem; color: #ccc; margin-top: 5px;">Algunas señales tardan un poco más en sincronizar.</p>
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button onclick="this.parentElement.parentElement.remove()" style="padding:10px 20px; background:var(--accent-secondary); border:none; border-radius:30px; color:#fff; cursor:pointer; font-weight:bold;">Esperar más</button>
            <button onclick="document.getElementById('close-player').click()" style="padding:10px 20px; background:rgba(255,255,255,0.1); border:1px solid #555; border-radius:30px; color:#fff; cursor:pointer;">Cerrar</button>
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

    video.pause();
    video.removeAttribute('src');
    video.load();

    const newVideo = video.cloneNode(true);
    video.parentNode.replaceChild(newVideo, video);

    const header = document.querySelector('.player-header');
    const existingPip = document.getElementById('pip-btn');
    if (existingPip) existingPip.remove();
    const existingCC = document.getElementById('cc-btn');
    if (existingCC) existingCC.remove();

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

        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            zapNext();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            zapPrev();
        } else if (e.key === 'Escape') {
            closePlayer();
        }
    });

}

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

function initRemoteControl(pairId) {
    // Create a beautiful, responsive Dark Mode Remote UI
    const style = document.createElement('style');
    style.textContent = `
        body { background: #050510 !important; color: white !important; font-family: 'Inter', sans-serif; overflow: hidden; margin: 0; padding: 0; height: 100vh; width: 100vw; }
        .rem-container { display: flex; flex-direction: column; height: 100dvh; padding: 15px; box-sizing: border-box; justify-content: flex-start; gap: 12px; }
        .rem-header { text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        .rem-status { font-size: 0.7rem; transition: all 0.3s; color: #8b8b9e; }
        .rem-status.online { color: #00f2ff; text-shadow: 0 0 10px rgba(0,242,255,0.5); }
        
        /* Now Playing Card */
        .now-playing-card { background: linear-gradient(135deg, #1a1a2e, #0f0f1a); border: 1px solid rgba(0, 242, 255, 0.2); border-radius: 16px; padding: 12px; display: flex; align-items: center; gap: 15px; margin-bottom: 5px; min-height: 60px; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); opacity: 0; transform: translateY(-10px); }
        .now-playing-card.active { opacity: 1; transform: translateY(0); }
        .playing-logo { width: 45px; height: 45px; border-radius: 8px; object-fit: contain; background: #fff; padding: 4px; }
        .playing-info { flex: 1; }
        .playing-info h4 { margin: 0; font-size: 0.9rem; color: #fff; }
        .playing-info p { margin: 2px 0 0; font-size: 0.7rem; color: var(--accent-primary, #00f2ff); font-weight: bold; }

        /* Search Input */
        .rem-search-container { position: relative; width: 100%; }
        .rem-search-input { width: 100%; background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 30px; padding: 12px 20px 12px 45px; color: white; font-size: 1rem; outline: none; transition: border-color 0.3s; }
        .rem-search-input:focus { border-color: #00f2ff; box-shadow: 0 0 15px rgba(0, 242, 255, 0.2); }
        .search-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #8b8b9e; font-size: 1.2rem; }

        .d-pad-container { position: relative; width: 200px; height: 200px; margin: 5px auto; background: #0f0f1a; border-radius: 50%; border: 2px solid #1a1a2e; box-shadow: 0 10px 40px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
        .pad-container { display: none; width: 100%; height: 200px; background: #0f0f1a; border-radius: 24px; border: 2px dashed #2a2a4e; position: relative; touch-action: none; overflow: hidden; }
        .pad-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #2a2a4e; text-transform: uppercase; letter-spacing: 2px; font-weight: 900; pointer-events: none; }
        
        .d-btn { position: absolute; background: #1a1a2e; border: 1px solid #2a2a4e; color: white; border-radius: 12px; width: 55px; height: 55px; display: flex; align-items: center; justify-content: center; transition: all 0.1s; }
        .d-btn:active { background: #00f2ff; color: #050510; }
        .d-btn.up { top: 5px; } .d-btn.down { bottom: 5px; } .d-btn.left { left: 5px; } .d-btn.right { right: 5px; }
        .d-ok { background: #7000ff; width: 65px; height: 65px; border-radius: 50%; font-weight: bold; border: none; box-shadow: 0 0 20px rgba(112,0,255,0.4); }
        
        .grid-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 1; }
        .ctrl-btn { background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 12px; padding: 12px; color: white; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 0.85rem; -webkit-tap-highlight-color: transparent; }
        .ctrl-btn:active { background: #2a2a4e; transform: scale(0.96); }
        .ctrl-btn .material-icons-round { font-size: 1.3rem; }
        .exit-btn { border-color: #ff4757; color: #ff4757; background: rgba(255,71,87,0.05); }
        .mode-btn { border-color: #00f2ff; color: #00f2ff; grid-column: 1 / -1; height: 45px; }
    `;
    document.head.appendChild(style);

    const ui = `
        <div class="rem-container">
            <div class="rem-header">
                <div style="font-weight: 900; letter-spacing: 2px; color: #00f2ff; font-size:0.8rem;">ALLIVISION</div>
                <div id="rem-status" class="rem-status">CONECTANDO...</div>
            </div>

            <div id="now-playing" class="now-playing-card">
                <img src="" class="playing-logo" id="playing-logo" onerror="this.src='https://via.placeholder.com/50'">
                <div class="playing-info">
                    <h4 id="playing-name">Ninguna señal</h4>
                    <p>EN VIVO</p>
                </div>
                <span class="material-icons-round" style="color:#00f2ff; animation: pulse 2s infinite;">sensors</span>
            </div>

            <div class="rem-search-container">
                <span class="material-icons-round search-icon">search</span>
                <input type="text" class="rem-search-input" id="rem-search" placeholder="Buscar en la TV...">
            </div>

            <div id="dpad-view" class="d-pad-container">
                <button class="d-btn up" onclick="sendCmd('up')"><span class="material-icons-round">keyboard_arrow_up</span></button>
                <button class="d-btn down" onclick="sendCmd('down')"><span class="material-icons-round">keyboard_arrow_down</span></button>
                <button class="d-btn left" onclick="sendCmd('left')"><span class="material-icons-round">keyboard_arrow_left</span></button>
                <button class="d-btn right" onclick="sendCmd('right')"><span class="material-icons-round">keyboard_arrow_right</span></button>
                <button class="d-btn d-ok" onclick="sendCmd('enter')">OK</button>
            </div>

            <div id="pad-view" class="pad-container">
                <div class="pad-label">Trackpad</div>
            </div>

            <div class="grid-controls">
                <button class="ctrl-btn mode-btn" onclick="toggleMode()">
                    <span class="material-icons-round" id="mode-icon">mouse</span> 
                    <span id="mode-text">Usar Trackpad</span>
                </button>
                <button class="ctrl-btn" onclick="sendCmd('vol-up')"><span class="material-icons-round">volume_up</span> VOL+</button>
                <button class="ctrl-btn" onclick="sendCmd('next')"><span class="material-icons-round">skip_next</span> CH+</button>
                <button class="ctrl-btn" onclick="sendCmd('vol-down')"><span class="material-icons-round">volume_down</span> VOL-</button>
                <button class="ctrl-btn" onclick="sendCmd('prev')"><span class="material-icons-round">skip_previous</span> CH-</button>
                <button class="ctrl-btn" onclick="sendCmd('mute')"><span class="material-icons-round">volume_off</span> MUTE</button>
                <button class="ctrl-btn exit-btn" onclick="sendCmd('close')"><span class="material-icons-round">power_settings_new</span> SALIR</button>
            </div>
            
            <div style="text-align:center; padding-top: 5px;">
                <button onclick="location.reload()" style="background:none; border:none; color:gray; font-size:0.6rem; text-decoration:underline;">Reiniciar Mando</button>
            </div>
        </div>
    `;
    document.body.innerHTML = ui;

    let usePad = false;
    window.toggleMode = () => {
        usePad = !usePad;
        document.getElementById('dpad-view').style.display = usePad ? 'none' : 'flex';
        document.getElementById('pad-view').style.display = usePad ? 'block' : 'none';
        document.getElementById('mode-text').textContent = usePad ? 'Usar Cruceta' : 'Usar Trackpad';
        document.getElementById('mode-icon').textContent = usePad ? 'reorder' : 'mouse';
        if (navigator.vibrate) navigator.vibrate(50);
    };

    const peerObj = new Peer();
    peerObj.on('open', () => {
        const connObj = peerObj.connect(`alli-${pairId}`, { reliable: true });

        window.sendCmd = (c) => {
            if (connObj.open) {
                connObj.send(c);
                if (navigator.vibrate) navigator.vibrate(35);
            }
        };

        // Search Input Handling
        const searchInput = document.getElementById('rem-search');
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (connObj.open) {
                    connObj.send({ type: 'search', query: e.target.value });
                }
            }, 500);
        });

        // Trackpad Touch Events
        const pad = document.getElementById('pad-view');
        let lastX = 0; let lastY = 0;
        let moved = false;

        pad.addEventListener('touchstart', (e) => {
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
            moved = false;
        });

        pad.addEventListener('touchmove', (e) => {
            const dx = e.touches[0].clientX - lastX;
            const dy = e.touches[0].clientY - lastY;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
            moved = true;
            if (connObj.open) connObj.send({ type: 'move', dx, dy });
        });

        pad.addEventListener('touchend', (e) => {
            if (!moved && connObj.open) {
                connObj.send({ type: 'click' });
                if (navigator.vibrate) navigator.vibrate(40);
            }
        });

        connObj.on('open', () => {
            const st = document.getElementById('rem-status');
            st.textContent = "CONECTADO";
            st.classList.add('online');
        });

        // Receive data from TV (Now Playing, etc)
        connObj.on('data', (data) => {
            if (data.type === 'playing') {
                const card = document.getElementById('now-playing');
                const name = document.getElementById('playing-name');
                const logo = document.getElementById('playing-logo');

                if (data.name) {
                    name.textContent = data.name;
                    logo.src = data.logo;
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            } else if (data.type === 'focus-search') {
                document.getElementById('rem-search').focus();
                if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
            }
        });
    });
}

function handleRemoteCommand(cmd) {
    console.log("Remote Command received:", cmd);

    // Handle Object-based commands (Trackpad)
    if (typeof cmd === 'object') {
        initCursor();
        cursorEl.style.display = 'block';

        if (cmd.type === 'move') {
            cursorX += cmd.dx * 1.5; // Sensitivity
            cursorY += cmd.dy * 1.5;

            // Constrain to screen
            cursorX = Math.max(0, Math.min(window.innerWidth, cursorX));
            cursorY = Math.max(0, Math.min(window.innerHeight, cursorY));

            cursorEl.style.transform = `translate(${cursorX - 12}px, ${cursorY - 12}px)`;

            // Visual feedback: find element under cursor
            const target = document.elementFromPoint(cursorX, cursorY);
            if (target) {
                const card = target.closest('.channel-card, .nav-item, .category-card, .close-btn, .search-box');
                document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
                if (card) card.classList.add('focused');
            }
        } else if (cmd.type === 'click') {
            const target = document.elementFromPoint(cursorX, cursorY);
            if (target) target.click();
        } else if (cmd.type === 'search') {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = cmd.query;
                handleSearch(cmd.query);
                // Also visually focus the search box
                currentFocusScope = 'search';
                applyFocus();
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
        case 'vol-up': if (video.volume < 0.9) video.volume += 0.1; break;
        case 'vol-down': if (video.volume > 0.1) video.volume -= 0.1; break;
        case 'mute': video.muted = !video.muted; break;
        case 'close': closePlayer(); break;
        case 'left': if (isPlayerOpen) { closePlayer(); } else { moveFocus('left'); } break;
        case 'right': if (!isPlayerOpen) moveFocus('right'); break;
        case 'up': if (isPlayerOpen) zapNext(); else moveFocus('up'); break;
        case 'down': if (isPlayerOpen) zapPrev(); else moveFocus('down'); break;
        case 'enter': if (!isPlayerOpen) { const f = document.querySelector('.focused'); if (f) f.click(); } break;
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
        } else if (viewName === 'spanish_auto') {
            const channels = await getChannelsByFilter('language', 'Español');
            renderChannelGrid(channels, 'Zapping: Canales en Español');
            // We set the list so the remote can zap, but we don't open the player automatically
            // to avoid being intrusive, but it's ready for CH+ / CH- / OK.
            currentChannelList = channels;
            currentChannelIndex = -1;
            showToast("Lista en Español cargada para navegación.");
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
        } else if (filterContext.type === 'language') {
            secondaryKey = 'category';
            label = 'Categoría';
        }

        if (secondaryKey) {
            // Get options
            const fullSubset = await getChannelsByFilter(filterContext.type, filterContext.value);
            const options = await getUniqueValuesFromSubset(fullSubset, secondaryKey);

            if (options.length > 1) {
                const select = document.createElement('select');
                select.className = 'glass-select';
                select.style.padding = '8px 12px';
                select.style.borderRadius = '8px';
                select.style.border = '1px solid var(--glass-border)';
                select.style.background = 'var(--bg-panel)';
                select.style.color = '#fff';
                select.style.outline = 'none';
                select.style.marginLeft = 'auto'; // Force right align

                let defaultOpt = document.createElement('option');
                defaultOpt.value = 'all';
                defaultOpt.textContent = `Todos (${label})`;
                select.appendChild(defaultOpt);

                options.forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.name;
                    o.textContent = `${opt.name} (${opt.count})`;
                    if (filterContext.secondaryValue === opt.name) o.selected = true;
                    select.appendChild(o);
                });

                select.onchange = async (e) => {
                    const val = e.target.value;
                    const newChannels = await getChannelsByFilter(filterContext.type, filterContext.value, secondaryKey, val);
                    renderChannelGrid(newChannels, title, true, {
                        ...filterContext,
                        secondaryValue: val
                    });
                };

                // Insert into the header div
                container.firstElementChild.appendChild(select);
            }
        }
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

        card.innerHTML = `
            <div class="status-indicator"></div>
            <button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${channel.id}', this)">
                <span class="material-icons-round">${isFav ? 'favorite' : 'favorite_border'}</span>
            </button>
            <div style="height: 100px; background: #fff; border-radius: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; padding: 8px; overflow: hidden;">
                ${iconHtml}
            </div>
            <h3 style="font-size: 1rem; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${channel.name}</h3>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-muted);">
                ${flagUrl ? `<img src="${flagUrl}" style="width: 16px; border-radius: 2px;" onerror="this.style.display='none'">` : ''}
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
            renderChannelGrid(channels, `Canales de ${country.name} (${channels.length})`);
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
