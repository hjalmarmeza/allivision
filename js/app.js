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

// --- Init ---
document.addEventListener('DOMContentLoaded', init);
// ... (init remains same)

// ... (loadView logic remains same)

// --- Rendering Functions ---

// Deprecated: Legacy renderChannelGrid removed. See updated version below.

// ... (renderCountries, renderCategories, renderLanguages, createGrid, createCard, toggleFavorite, showToast logic remains)

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

    // Set Safety Timeout (8 seconds)
    playTimeoutTimer = setTimeout(() => {
        console.warn("Channel load timeout");
        showPlayerError("El canal tarda demasiado en responder.", true, channel.id);
        if (window.currentHls) window.currentHls.destroy();
    }, 8000); // 8s timeout

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
        const hls = new Hls({ enableWorker: false, lowLatencyMode: false });
        hls.loadSource(channel.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            clearTimeout(playTimeoutTimer); // Clear timeout on success
            video.play().catch(e => console.log("Autoplay blocked", e));
        });

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
        <span class="material-icons-round" style="font-size: 48px; color: #ff9f43; margin-bottom: 10px;">warning_amber</span>
        <p style="font-size: 1.2rem; font-weight:bold;">${msg}</p>
        <p style="font-size: 0.9rem; color: #ccc; margin-top: 5px;">Hemos marcado este canal como inestable.</p>
        <button onclick="document.getElementById('close-player').click()" style="margin-top:20px; padding:10px 20px; background:var(--accent-primary); border:none; border-radius:30px; color:#fff; cursor:pointer;">Cerrar y buscar otro</button>
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

    // Check if we are in "Remote Mode" (URL param)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('pair')) {
        const pairId = urlParams.get('pair');
        initRemoteControl(pairId);
    }

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
        if (overlay.classList.contains('hidden')) return;

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
    if (peer) return; // Already init

    // Create a semi-random 4-digit ID for easier entry
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    peer = new Peer(`allivision-tv-${id}`);

    peer.on('open', (peerId) => {
        const simpleId = peerId.split('-').pop();
        document.getElementById('pair-code-display').textContent = simpleId;

        // Generate QR URL
        const remoteUrl = `${window.location.origin}${window.location.pathname}?pair=${simpleId}`;
        const qrContainer = document.getElementById('qrcode');
        qrContainer.innerHTML = ""; // Clear
        new QRCode(qrContainer, {
            text: remoteUrl,
            width: 200,
            height: 200
        });
    });

    peer.on('connection', (connection) => {
        conn = connection;
        document.getElementById('pairing-status').textContent = "¡Mando conectado!";
        document.getElementById('pairing-status').style.color = "#00ff88";

        setTimeout(() => {
            document.getElementById('pairing-modal').classList.add('hidden');
            showToast("Control remoto vinculado exitosamente.");
        }, 1500);

        conn.on('data', (data) => {
            handleRemoteCommand(data);
        });
    });
}

function initRemoteControl(pairId) {
    // UI Switch to Remote Mode
    document.querySelector('.app-container').classList.add('hidden');
    document.getElementById('remote-control-screen').classList.remove('hidden');

    peer = new Peer();
    peer.on('open', () => {
        const connection = peer.connect(`allivision-tv-${pairId}`);
        connection.on('open', () => {
            console.log("Connected to TV");
            // Bind Buttons
            document.querySelectorAll('.remote-btn').forEach(btn => {
                btn.onclick = () => {
                    connection.send(btn.dataset.cmd);
                    // Haptic feedback if available
                    if (navigator.vibrate) navigator.vibrate(50);
                };
            });
        });
    });
}

function handleRemoteCommand(cmd) {
    console.log("Remote Command:", cmd);
    const video = document.getElementById('video');

    switch (cmd) {
        case 'next': zapNext(); break;
        case 'prev': zapPrev(); break;
        case 'vol-up': if (video.volume < 0.9) video.volume += 0.1; break;
        case 'vol-down': if (video.volume > 0.1) video.volume -= 0.1; break;
        case 'mute': video.muted = !video.muted; break;
        case 'close': closePlayer(); break;
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

    channels.forEach(channel => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.style.background = 'var(--bg-panel)';
        card.style.padding = '1rem';
        card.style.borderRadius = '12px';
        card.style.border = '1px solid var(--glass-border)';
        card.style.cursor = 'pointer';
        card.style.transition = 'transform 0.2s';
        card.style.position = 'relative';

        // --- Data URL for Scanner ---
        card.dataset.url = channel.url;
        // ---------------------------

        // --- Smart Logo Logic ---
        let logoSrc = channel.logo;
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=1a1a2e&color=fff&size=128&length=2&font-size=0.5`;

        // Strategy: Use official logo if exists, otherwise generate a text avatar immediately.
        // We avoid the favicon search unless we really have no other choice, to keep console clean.
        let finalLogo = logoSrc || avatarUrl;

        let iconHtml = `<img src="${finalLogo}" 
                             loading="lazy" 
                             referrerpolicy="no-referrer" 
                             alt="${channel.name}" 
                             style="max-width: 100%; max-height: 100%; object-fit: contain; width: auto; height: auto;" 
                             onerror="this.onerror=null; this.src='${avatarUrl}';">`;
        // -------------------------

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

        card.onclick = () => openPlayer(channel, channels, index);
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
