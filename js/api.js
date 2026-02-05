// Real API Connection to IPTV-org

const API_STREAMS = "https://iptv-org.github.io/api/streams.json";
let CACHE_CHANNELS = null;
let COUNTRY_TRANSLATOR = null;
try {
    COUNTRY_TRANSLATOR = new Intl.DisplayNames(['es'], { type: 'region' });
} catch (e) { console.warn("Intl not supported"); }

let LANG_TRANSLATOR = null;
try {
    LANG_TRANSLATOR = new Intl.DisplayNames(['es'], { type: 'language' });
} catch (e) { }

async function fetchSafeList() {
    if (CACHE_CHANNELS) return CACHE_CHANNELS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        console.log("Fetching channel data...");
        const [cRes, sRes] = await Promise.all([
            fetch('https://iptv-org.github.io/api/channels.json', { signal: controller.signal }),
            fetch('https://iptv-org.github.io/api/streams.json', { signal: controller.signal })
        ]);
        clearTimeout(timeoutId);

        if (!cRes.ok || !sRes.ok) throw new Error("Failed to fetch from IPTV-org");

        const [cData, sData] = await Promise.all([
            cRes.json(),
            sRes.json()
        ]);

        const urlMap = {};
        sData.forEach(s => { urlMap[s.channel] = s.url; });

        const final = [];
        let count = 0;

        for (const c of cData) {
            if (urlMap[c.id] && c.country && !c.is_nsfw && !c.closed) {

                // Normalize Code for Flags (UK -> GB)
                let cCode = c.country;
                if (cCode === 'UK') cCode = 'GB';

                let niceCountryName = c.country;
                if (c.country.length === 2 && COUNTRY_TRANSLATOR) {
                    try { niceCountryName = COUNTRY_TRANSLATOR.of(cCode.toUpperCase()); } catch (e) { }
                }

                // LANGUAGE LOGIC FIX V2
                let niceLang = "Varios";
                let langCode = "mul";

                if (c.languages && c.languages.length > 0) {
                    langCode = c.languages[0];

                    if (LANG_TRANSLATOR) {
                        try {
                            niceLang = LANG_TRANSLATOR.of(langCode);
                        } catch (e) {
                            niceLang = langCode;
                        }
                    } else {
                        niceLang = langCode;
                    }

                    if (niceLang && niceLang.length > 1) niceLang = niceLang.charAt(0).toUpperCase() + niceLang.slice(1);
                } else {
                    // Expanded Inference Map
                    const langMap = {
                        'ES': 'Español', 'AR': 'Español', 'MX': 'Español', 'CO': 'Español', 'PE': 'Español', 'CL': 'Español', 'VE': 'Español', 'EC': 'Español', 'GT': 'Español', 'CU': 'Español', 'BO': 'Español', 'DO': 'Español', 'HN': 'Español', 'PY': 'Español', 'SV': 'Español', 'NI': 'Español', 'CR': 'Español', 'PA': 'Español', 'UY': 'Español',
                        'US': 'Inglés', 'GB': 'Inglés', 'CA': 'Inglés', 'AU': 'Inglés', 'NZ': 'Inglés', 'IE': 'Inglés',
                        'FR': 'Francés',
                        'DE': 'Alemán', 'AT': 'Alemán', 'CH': 'Alemán',
                        'IT': 'Italiano',
                        'BR': 'Portugués', 'PT': 'Portugués', 'AO': 'Portugués', 'MZ': 'Portugués',
                        'RU': 'Ruso',
                        'CN': 'Chino',
                        'JP': 'Japonés'
                    };

                    // Special Case: US Channels that are actually Spanish
                    const spanishUSChannels = [
                        'Univision', 'Telemundo', 'Cinecanal', 'Cine Adrenalina', 'Cine Premiere', 'Cine Hispano', 'Galavisión', 'Unimás', 'Estrella TV', 'Azteca America', 'CNN en Español', 'Discovery en Español', 'ESPN Deportes', 'Fox Deportes', 'TUDN'
                    ];

                    // Check by Country Code
                    if (langMap[cCode]) {
                        niceLang = langMap[cCode];
                        langCode = 'inferred';

                        // Override for known US Spanish Channels
                        if (cCode === 'US') {
                            if (spanishUSChannels.some(name => c.name.includes(name))) {
                                niceLang = 'Español';
                            }
                        }
                    }
                }

                // Capitalize Category
                let cat = c.categories && c.categories.length > 0 ? c.categories[0] : 'General';
                if (cat) cat = cat.charAt(0).toUpperCase() + cat.slice(1);

                final.push({
                    id: c.id,
                    name: c.name,
                    url: urlMap[c.id],
                    logo: c.logo,
                    website: c.website, // ADDED
                    category: cat,
                    country: niceCountryName,
                    country_code: cCode,
                    language: niceLang,
                    language_code: langCode
                });
                count++;
                if (count > 4000) break;
            }
        }

        CACHE_CHANNELS = final;
        console.log(`Loaded ${final.length} channels.`);
        return final;
    } catch (e) {
        console.error("API Error", e);
        return [];
    }
}

export async function getFeaturedChannels() {
    const all = await fetchSafeList();
    if (all.length > 50) {
        const start = Math.floor(Math.random() * (all.length - 50));
        return all.slice(start, start + 50);
    }
    return all;
}

export async function getCountries() {
    const all = await fetchSafeList();
    const map = new Map();
    all.forEach(c => {
        if (c.country_code && !map.has(c.country_code)) {
            map.set(c.country_code, {
                code: c.country_code,
                name: c.country
            });
        }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCategories() {
    const all = await fetchSafeList();
    const map = new Map();
    all.forEach(c => {
        if (c.category && !map.has(c.category)) {
            map.set(c.category, { name: c.category, count: 1 });
        } else if (c.category) {
            map.get(c.category).count++;
        }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export async function getLanguages() {
    const all = await fetchSafeList();
    const map = new Map();
    all.forEach(c => {
        if (c.language && !map.has(c.language)) {
            map.set(c.language, { name: c.language, code: c.language_code, count: 1 });
        } else if (c.language) {
            map.get(c.language).count++;
        }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ... (existing imports and code)

// Helper to get unique values from a specific subset of channels
export async function getUniqueValuesFromSubset(channels, key) {
    const map = new Map();
    channels.forEach(c => {
        let val = c[key]; // e.g. c.language or c.category
        if (val && !map.has(val)) {
            map.set(val, { name: val, count: 1 });
        } else if (val) {
            map.get(val).count++;
        }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export async function getChannelsByFilter(type, value, secondaryType = null, secondaryValue = null) {
    const all = await fetchSafeList();
    let filtered = [];

    // Primary Filter
    if (type === 'country') filtered = all.filter(c => c.country_code === value);
    else if (type === 'category') filtered = all.filter(c => c.category === value);
    else if (type === 'language') filtered = all.filter(c => c.language === value);
    else if (type === 'id_list') filtered = all.filter(c => value.includes(c.id));
    else filtered = all;

    // Secondary Filter (AND logic)
    if (secondaryType && secondaryValue && secondaryValue !== 'all') {
        if (secondaryType === 'language') {
            filtered = filtered.filter(c => c.language === secondaryValue);
        } else if (secondaryType === 'category') {
            filtered = filtered.filter(c => c.category === secondaryValue);
        }
    }

    return filtered;
}

// ... (existing searchGlobal)

export async function searchGlobal(query) {
    if (!query || query.length < 2) return { channels: [], countries: [] };
    const all = await fetchSafeList();
    const q = query.toLowerCase();

    const channels = all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 20);
    const rawCountries = await getCountries();
    const countries = rawCountries.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);

    return { channels, countries };
}
