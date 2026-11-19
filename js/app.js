/**
 * เทิงแมพ (Thoeng Map) - Main Application Logic
 * รวมการจัดการแผนที่, Firestore, การค้นหา/กรอง, และโหมด Admin/Viewer
 */
(() => {
    // 3. Application State
    let places = [];
    let state = {
        searchQuery: '',
        audience: 'all',        // 'all' | 'tourist' | 'local'
        category: 'all',        // 'all' | 'food' | 'cafe' | 'attraction' | 'shop' | 'stay' | 'service'
        selectedPlaceId: null,
        movingPlaceId: null,
        editingPlaceId: null,
        isAdmin: false,
        isSatellite: false,
        isPickingLocation: false,
        isDesktopCollapsed: false,
        isMobileExpanded: false
    };

    // Map & Markers References
    let map;
    let streetLayer, satelliteLayer;
    let markersMap = new Map(); // id -> L.Marker
    let userLocationMarker = null;
    let tempPickMarker = null;

    // DOM Elements
    const dom = {
        sidebarContainer: document.getElementById('sidebar-container'),
        sidebar: document.getElementById('sidebar'),
        sidebarHeader: document.getElementById('sidebar-header'),
        listView: document.getElementById('list-view'),
        detailView: document.getElementById('detail-view'),
        categoryBar: document.getElementById('category-bar'),
        categoryChipsContainer: document.getElementById('category-chips-container'),
        searchInput: document.getElementById('search-input'),
        btnClearSearch: document.getElementById('btn-clear-search'),
        totalCountBadge: document.getElementById('total-count-badge'),
        btnAdminMode: document.getElementById('btn-admin-mode'),
        adminModeIcon: document.getElementById('admin-mode-icon'),
        btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
        toggleSidebarIcon: document.getElementById('toggle-sidebar-icon'),
        mobileDrawerHandle: document.getElementById('mobile-drawer-handle'),
        mobileDrawerHint: document.getElementById('mobile-drawer-hint'),
        // Controls
        btnLayerSwitch: document.getElementById('btn-layer-switch'),
        layerPreviewBg: document.getElementById('layer-preview-bg'),
        layerPreviewIcon: document.getElementById('layer-preview-icon'),
        layerPreviewLabel: document.getElementById('layer-preview-label'),
        btnMyLocation: document.getElementById('btn-my-location'),
        btnResetThoeng: document.getElementById('btn-reset-thoeng'),
        btnZoomIn: document.getElementById('btn-zoom-in'),
        btnZoomOut: document.getElementById('btn-zoom-out'),
        // Add Pin Flow
        btnAddPin: document.getElementById('btn-add-pin'),
        pickingBanner: document.getElementById('picking-banner'),
        btnUseCenter: document.getElementById('btn-use-center'),
        btnCancelPick: document.getElementById('btn-cancel-pick'),
        addPinModal: document.getElementById('add-pin-modal'),
        btnCloseModal: document.getElementById('btn-close-modal'),
        btnCancelModal: document.getElementById('btn-cancel-modal'),
        btnRepickCoords: document.getElementById('btn-repick-coords'),
        addPinForm: document.getElementById('add-pin-form'),
        formCoordsDisplay: document.getElementById('form-coords-display'),
        inputLat: document.getElementById('input-lat'),
        inputLng: document.getElementById('input-lng'),
        // Toast
        toast: document.getElementById('toast'),
        toastIcon: document.getElementById('toast-icon'),
        toastMessage: document.getElementById('toast-message')
    };

    // =================================================================
    // 4. Data Persistence (Google Sheet + localStorage)
    // =================================================================
    function getGoogleSheetCsvUrl() {
        if (GOOGLE_SHEET_CONFIG.csvUrl && GOOGLE_SHEET_CONFIG.csvUrl.trim()) {
            return GOOGLE_SHEET_CONFIG.csvUrl.trim();
        }
        if (GOOGLE_SHEET_CONFIG.sheetId && GOOGLE_SHEET_CONFIG.sheetId.trim()) {
            const id = encodeURIComponent(GOOGLE_SHEET_CONFIG.sheetId.trim());
            const sheet = encodeURIComponent((GOOGLE_SHEET_CONFIG.sheetName || 'places').trim());
            return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheet}`;
        }
        return '';
    }

    // RFC-4180 CSV Parser (รองรับเครื่องหมายคอมมาและขึ้นบรรทัดใหม่ในฟันหนู)
    function parseCSV(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        const cleanText = text.replace(/^\uFEFF/, '');

        for (let i = 0; i < cleanText.length; i++) {
            const ch = cleanText[i];
            const next = cleanText[i + 1];

            if (inQuotes) {
                if (ch === '"' && next === '"') {
                    field += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    field += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    row.push(field);
                    field = '';
                } else if (ch === '\r' && next === '\n') {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                    i++;
                } else if (ch === '\n' || ch === '\r') {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                } else {
                    field += ch;
                }
            }
        }
        if (field.length > 0 || row.length > 0) {
            row.push(field);
            rows.push(row);
        }
        return rows;
    }

    function splitListField(value) {
        if (!value) return [];
        const separator = value.includes('|') ? '|' : ',';
        return value
            .split(separator)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function mapSheetRowToPlace(headers, values, rowIndex) {
        const record = {};
        headers.forEach((h, idx) => {
            record[h] = (values[idx] || '').trim();
        });

        const lat = parseFloat(record.lat);
        const lng = parseFloat(record.lng);
        if (!record.name || Number.isNaN(lat) || Number.isNaN(lng)) {
            return null;
        }

        const category = CATEGORIES[record.category] ? record.category : 'shop';
        const audience = AUDIENCE_LABELS[record.audience] ? record.audience : 'both';
        const rating = parseFloat(record.rating);
        const reviewCount = parseInt(record.reviewCount, 10);
        const isOpenRaw = (record.isOpen || 'true').toLowerCase();

        return {
            id: record.id || `gs_${rowIndex + 1}`,
            name: record.name,
            category,
            audience,
            lat,
            lng,
            subdistrict: record.subdistrict || 'ต.เวียง',
            address: record.address || 'อ.เทิง จ.เชียงราย',
            rating: Number.isNaN(rating) ? 4.5 : rating,
            reviewCount: Number.isNaN(reviewCount) ? 0 : reviewCount,
            isOpen: !['false', '0', 'no', 'ปิด'].includes(isOpenRaw),
            hours: record.hours || 'ไม่ระบุเวลาเปิด-ปิด',
            phone: record.phone || '-',
            priceRange: record.priceRange || '-',
            shortDesc: record.shortDesc || '',
            highlights: record.highlights || '',
            localTips: record.localTips || '',
            amenities: splitListField(record.amenities),
            tags: splitListField(record.tags)
        };
    }

    function fetchPlacesViaJsonp(sheetId, sheetName) {
        return new Promise((resolve, reject) => {
            const cbName = `__thoengGvizCb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const script = document.createElement('script');
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Google Sheet JSONP timeout'));
            }, 10000);

            function cleanup() {
                clearTimeout(timeout);
                delete window[cbName];
                if (script.parentNode) script.parentNode.removeChild(script);
            }

            window[cbName] = (response) => {
                cleanup();
                if (!response || response.status === 'error' || !response.table) {
                    reject(new Error('Google Sheet returned an error (ตรวจสอบการตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์อ่านได้")'));
                    return;
                }
                const cols = (response.table.cols || []).map(c => (c.label || '').trim());
                const rows = response.table.rows || [];

                // กรณี Google Sheet ไม่แยกแถวหัวตารางให้อัตโนมัติ ให้ใช้แถวแรกเป็นหัวตาราง
                let headers = cols;
                let dataRows = rows;
                if (headers.every(h => !h) && rows.length > 0) {
                    headers = (rows[0].c || []).map(cell => (cell && cell.v != null ? String(cell.v).trim() : ''));
                    dataRows = rows.slice(1);
                }

                const parsed = dataRows
                    .map((r, idx) => {
                        const values = (r.c || []).map(cell => {
                            if (!cell) return '';
                            if (cell.v != null) return String(cell.v);
                            if (cell.f != null) return String(cell.f);
                            return '';
                        });
                        return mapSheetRowToPlace(headers, values, idx);
                    })
                    .filter(Boolean);
                resolve(parsed);
            };

            script.onerror = () => {
                cleanup();
                reject(new Error('ไม่สามารถโหลดสคริปต์จาก Google Sheet ได้'));
            };

            const id = encodeURIComponent(sheetId.trim());
            const sheet = encodeURIComponent((sheetName || 'places').trim());
            script.src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json;responseHandler:${cbName}&sheet=${sheet}&headers=1`;
            document.head.appendChild(script);
        });
    }

    async function postToAppsScript(payload) {
        const url = (GOOGLE_SHEET_CONFIG.appsScriptUrl || '').trim();
        if (!url) return false;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) return false;
            const data = await res.json();
            return Boolean(data && data.ok);
        } catch (err) {
            console.warn('Apps Script POST failed:', err);
            return false;
        }
    }

    async function fetchPlacesFromGoogleSheet() {
        // วิธีหลัก: ดึงผ่าน Google Apps Script Web App (รองรับอ่าน-เขียน 2 ทาง)
        const appsScriptUrl = (GOOGLE_SHEET_CONFIG.appsScriptUrl || '').trim();
        if (appsScriptUrl) {
            const response = await fetch(appsScriptUrl, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || !data.ok || !Array.isArray(data.places)) {
                throw new Error((data && data.error) || 'Invalid Apps Script response');
            }
            return data.places
                .map((record, idx) => {
                    const headers = Object.keys(record);
                    const values = headers.map(k => (record[k] != null ? String(record[k]) : ''));
                    return mapSheetRowToPlace(headers, values, idx);
                })
                .filter(Boolean);
        }

        // วิธีสำรอง: หากตั้งค่า sheetId ใช้ JSONP เพื่อเลี่ยงปัญหา CORS เวลาเปิดไฟล์ตรงๆ (file://)
        if (GOOGLE_SHEET_CONFIG.sheetId && GOOGLE_SHEET_CONFIG.sheetId.trim() && !(GOOGLE_SHEET_CONFIG.csvUrl && GOOGLE_SHEET_CONFIG.csvUrl.trim())) {
            return await fetchPlacesViaJsonp(GOOGLE_SHEET_CONFIG.sheetId, GOOGLE_SHEET_CONFIG.sheetName);
        }

        const url = getGoogleSheetCsvUrl();
        if (!url) return null;

        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const csvText = await response.text();
        const rows = parseCSV(csvText);
        if (rows.length < 2) return [];

        const headers = rows[0].map(h => h.trim());
        return rows
            .slice(1)
            .map((values, idx) => mapSheetRowToPlace(headers, values, idx))
            .filter(Boolean);
    }

    function getCustomPlacesFromStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (err) {
            console.warn('Could not load saved places from localStorage:', err);
        }
        return [];
    }

    function getCoordOverrides() {
        try {
            const saved = localStorage.getItem(COORD_OVERRIDES_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (err) {
            console.warn('Could not load coord overrides:', err);
        }
        return {};
    }

    function saveCoordOverride(placeId, lat, lng) {
        try {
            const overrides = getCoordOverrides();
            overrides[placeId] = { lat, lng };
            localStorage.setItem(COORD_OVERRIDES_KEY, JSON.stringify(overrides));
        } catch (err) {
            console.warn('Could not save coord override:', err);
        }
    }

    function applyCoordOverrides(placeList) {
        const overrides = getCoordOverrides();
        return placeList.map(p => {
            const ov = overrides[p.id];
            if (ov && typeof ov.lat === 'number' && typeof ov.lng === 'number') {
                return { ...p, lat: ov.lat, lng: ov.lng };
            }
            return p;
        });
    }

    function loadInitialPlaces() {
        places = applyCoordOverrides([...getCustomPlacesFromStorage(), ...DEFAULT_PLACES]);
    }

    async function syncPlacesFromGoogleSheet() {
        const sheetUrl = getGoogleSheetCsvUrl();
        if (!sheetUrl) return;

        try {
            const sheetPlaces = await fetchPlacesFromGoogleSheet();
            if (Array.isArray(sheetPlaces) && sheetPlaces.length > 0) {
                places = applyCoordOverrides([...getCustomPlacesFromStorage(), ...sheetPlaces]);
                updateApp();
                showToast(`โหลดข้อมูล ${sheetPlaces.length} แห่งจาก Google Sheet แล้ว`, 'fa-table');
            }
        } catch (err) {
            console.warn('ไม่สามารถดึงข้อมูลจาก Google Sheet ได้ ใช้ข้อมูลสำรองแทน:', err);
            showToast('ดึงข้อมูลจาก Google Sheet ไม่สำเร็จ (ตรวจสอบการแชร์ชีต)', 'fa-triangle-exclamation', true);
        }
    }

    function initFirestore() {
        try {
            if (typeof firebase === 'undefined' || !FIREBASE_CONFIG.projectId) return null;
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            return firebase.firestore();
        } catch (err) {
            console.warn('Firebase init failed:', err);
            return null;
        }
    }

    async function seedDefaultPlacesToFirestore() {
        if (!db) return;
        const batch = db.batch();
        DEFAULT_PLACES.forEach((p, idx) => {
            const ref = db.collection(FIRESTORE_COLLECTION).doc(p.id);
            batch.set(ref, { ...p, order: idx + 1 });
        });
        await batch.commit();
    }

    async function savePlaceToFirestore(place) {
        if (!db) return false;
        try {
            await db.collection(FIRESTORE_COLLECTION).doc(place.id).set(place, { merge: true });
            return true;
        } catch (err) {
            console.warn('Firestore save place failed:', err);
            return false;
        }
    }

    async function updatePlaceCoordsInFirestore(placeId, lat, lng) {
        if (!db) return false;
        try {
            await db.collection(FIRESTORE_COLLECTION).doc(placeId).set({ lat, lng }, { merge: true });
            return true;
        } catch (err) {
            console.warn('Firestore update coords failed:', err);
            return false;
        }
    }

    async function deletePlaceFromFirestore(placeId) {
        if (!db) return false;
        try {
            await db.collection(FIRESTORE_COLLECTION).doc(placeId).delete();
            return true;
        } catch (err) {
            console.warn('Firestore delete failed:', err);
            return false;
        }
    }

    async function syncPlacesWithFirestore() {
        db = initFirestore();
        if (!db) {
            syncPlacesFromGoogleSheet();
            return;
        }

        try {
            const snap = await db.collection(FIRESTORE_COLLECTION).get();
            if (snap.empty) {
                await seedDefaultPlacesToFirestore();
                showToast(`อัปโหลดข้อมูลเริ่มต้น ${DEFAULT_PLACES.length} แห่งขึ้น Firestore แล้ว`, 'fa-cloud-arrow-up');
            }

            // Real-time listener: อัปเดตแผนที่อัตโนมัติเมื่อข้อมูลใน Firestore เปลี่ยน
            let isFirstSnapshot = true;
            db.collection(FIRESTORE_COLLECTION).onSnapshot((snapshot) => {
                const cloudPlaces = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data && data.name && typeof data.lat === 'number' && typeof data.lng === 'number') {
                        cloudPlaces.push({ ...data, id: data.id || doc.id });
                    }
                });
                if (cloudPlaces.length > 0) {
                    cloudPlaces.sort((a, b) => (a.order || 9999) - (b.order || 9999));
                    places = cloudPlaces;
                    updateApp();
                    if (state.selectedPlaceId) {
                        const current = places.find(p => p.id === state.selectedPlaceId);
                        if (current) renderDetailView(current);
                    }
                    if (isFirstSnapshot) {
                        isFirstSnapshot = false;
                        showToast(`เชื่อมต่อ Firestore แล้ว (${cloudPlaces.length} แห่ง)`, 'fa-fire');
                    }
                }
            }, (err) => {
                console.warn('Firestore realtime error:', err);
                showToast('เชื่อมต่อ Firestore ไม่สำเร็จ (ตรวจสอบ Rules ใน Firebase Console)', 'fa-triangle-exclamation', true);
            });
        } catch (err) {
            console.warn('Firestore sync error:', err);
            showToast('เชื่อมต่อ Firestore ไม่สำเร็จ (ตรวจสอบว่าสร้างฐานข้อมูลแล้ว)', 'fa-triangle-exclamation', true);
        }
    }

    function saveCustomPlace(newPlace) {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            const existing = saved ? JSON.parse(saved) : [];
            existing.unshift(newPlace);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        } catch (err) {
            console.warn('Could not save place to localStorage:', err);
        }
        places.unshift(newPlace);
        savePlaceToFirestore(newPlace).then((ok) => {
            if (ok) {
                showToast(`บันทึก "${newPlace.name}" ขึ้น Firestore แล้ว!`, 'fa-cloud-arrow-up');
            }
        });
    }

    // =================================================================
    // 5. Map Initialization
    // =================================================================
    function initMap() {
        map = L.map('map', {
            center: THOENG_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: false, // We use custom styled controls
            attributionControl: true
        });

        // Street Map (Google Maps ภาษาไทย — ไม่ต้องใช้ API Key) พร้อม Fallback ไป OpenStreetMap
        streetLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=th&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps',
            subdomains: ['0', '1', '2', '3'],
            maxZoom: 20
        });

        const osmFallbackLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        });

        let tileErrorCount = 0;
        streetLayer.on('tileerror', () => {
            tileErrorCount++;
            if (tileErrorCount === 3 && map.hasLayer(streetLayer)) {
                map.removeLayer(streetLayer);
                osmFallbackLayer.addTo(map);
                streetLayer = osmFallbackLayer;
            }
        });

        // Satellite Hybrid Map (Google Satellite + ชื่อถนนภาษาไทย)
        satelliteLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=th&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps',
            subdomains: ['0', '1', '2', '3'],
            maxZoom: 20
        });

        streetLayer.addTo(map);
        setTimeout(() => map.invalidateSize(), 300);

        // Map Click Event for "Add New Pin" or "Move Pin" Picking Mode
        map.on('click', (e) => {
            if (state.movingPlaceId) {
                applyMovedCoords(e.latlng.lat, e.latlng.lng);
            } else if (state.isPickingLocation) {
                openAddModalWithCoords(e.latlng.lat, e.latlng.lng);
            }
        });
    }

    // =================================================================
    // 6. Custom Map Markers
    // =================================================================
    function createCustomPinIcon(place, isActive = false) {
        const cat = CATEGORIES[place.category] || CATEGORIES.shop;
        const pulseHtml = isActive
            ? `<div class="map-pin-pulse" style="background-color: ${cat.color};"></div>`
            : '';

        return L.divIcon({
            className: 'custom-pin-wrapper',
            html: `
                <div class="relative">
                    ${pulseHtml}
                    <div class="map-pin ${isActive ? 'active' : ''}" style="background-color: ${cat.color};">
                        <i class="fa-solid ${cat.icon}"></i>
                    </div>
                </div>
            `,
            iconSize: [38, 44],
            iconAnchor: [19, 42],
            tooltipAnchor: [0, -40]
        });
    }

    function renderMapMarkers(filteredPlaces) {
        // Remove existing markers
        markersMap.forEach(marker => map.removeLayer(marker));
        markersMap.clear();

        filteredPlaces.forEach(place => {
            const isActive = place.id === state.selectedPlaceId;
            const marker = L.marker([place.lat, place.lng], {
                icon: createCustomPinIcon(place, isActive),
                zIndexOffset: isActive ? 1000 : 0
            });

            marker.bindTooltip(place.name, {
                direction: 'top',
                className: 'custom-tooltip',
                offset: [0, -4]
            });

            marker.on('click', () => {
                if (state.isPickingLocation) return;
                selectPlace(place.id, true);
            });

            marker.addTo(map);
            markersMap.set(place.id, marker);
        });
    }

    // =================================================================
    // 7. Filtering Logic
    // =================================================================
    function getFilteredPlaces() {
        const q = state.searchQuery.trim().toLowerCase();

        return places.filter(p => {
            // Audience filter
            if (state.audience === 'tourist' && p.audience === 'local') return false;
            if (state.audience === 'local' && p.audience === 'tourist') return false;

            // Category filter
            if (state.category !== 'all' && p.category !== state.category) return false;

            // Search text filter
            if (q) {
                const catLabel = (CATEGORIES[p.category]?.label || '').toLowerCase();
                const haystack = [
                    p.name,
                    p.subdistrict,
                    p.address,
                    p.shortDesc,
                    p.highlights,
                    catLabel,
                    ...(p.tags || []),
                    ...(p.amenities || [])
                ].join(' ').toLowerCase();

                if (!haystack.includes(q)) return false;
            }

            return true;
        });
    }

    // =================================================================
    // 8. UI Rendering (Category Chips, List View, Detail View)
    // =================================================================
    function renderCategoryChips() {
        const items = [
            { id: 'all', label: 'ทั้งหมด', icon: 'fa-layer-group', color: '#059669' },
            ...Object.values(CATEGORIES)
        ];

        dom.categoryChipsContainer.innerHTML = items.map(item => {
            const isActive = state.category === item.id;
            const activeStyle = isActive
                ? `background-color: ${item.color}; color: #ffffff; border-color: ${item.color};`
                : '';
            const baseClasses = isActive
                ? 'shadow-md scale-[1.02]'
                : 'bg-white/95 hover:bg-white text-slate-700 border-slate-200/90 shadow-sm hover:shadow';

            return `
                <button 
                    data-cat="${item.id}" 
                    style="${activeStyle}"
                    class="cat-chip shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-heading font-medium border transition-all backdrop-blur-md ${baseClasses}">
                    <i class="fa-solid ${item.icon}" style="${!isActive ? `color: ${item.color}` : ''}"></i>
                    <span>${item.label}</span>
                </button>
            `;
        }).join('');

        // Attach click listeners
        dom.categoryChipsContainer.querySelectorAll('.cat-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const catId = btn.dataset.cat;
                state.category = (state.category === catId && catId !== 'all') ? 'all' : catId;
                if (state.selectedPlaceId) {
                    closeDetailView();
                }
                updateApp();
            });
        });
    }

    function renderListView(filteredPlaces) {
        dom.totalCountBadge.textContent = `${filteredPlaces.length} แห่ง`;

        if (filteredPlaces.length === 0) {
            dom.listView.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div class="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-map-location text-2xl"></i>
                    </div>
                    <h3 class="font-heading font-semibold text-slate-700 text-sm mb-1">ไม่พบสถานที่ที่ตรงกับการค้นหา</h3>
                    <p class="text-xs text-slate-500 mb-4">ลองเปลี่ยนคำค้นหา หมวดหมู่ หรือช่วยเพิ่มข้อมูลร้านค้าใหม่บนแผนที่ได้เลย</p>
                    <button id="btn-reset-filters" class="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-heading text-xs font-medium rounded-xl transition">
                        ล้างตัวกรองทั้งหมด
                    </button>
                </div>
            `;
            const resetBtn = document.getElementById('btn-reset-filters');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    state.searchQuery = '';
                    state.category = 'all';
                    state.audience = 'all';
                    dom.searchInput.value = '';
                    dom.btnClearSearch.classList.add('hidden');
                    updateAudienceTabsUI();
                    updateApp();
                });
            }
            return;
        }

        dom.listView.innerHTML = filteredPlaces.map(place => {
            const cat = CATEGORIES[place.category] || CATEGORIES.shop;
            const aud = AUDIENCE_LABELS[place.audience] || AUDIENCE_LABELS.both;
            const isCustom = place.isCustom ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-heading font-medium ml-1">ปักหมุดใหม่</span>` : '';

            return `
                <article data-id="${place.id}" class="place-card group bg-white hover:bg-emerald-50/30 border border-slate-200/80 hover:border-emerald-300 rounded-2xl p-3 shadow-sm hover:shadow-md transition-all cursor-pointer flex gap-3">
                    <!-- Left Category Gradient Thumbnail -->
                    <div class="w-16 h-16 rounded-xl bg-gradient-to-br ${cat.gradient} text-white flex flex-col items-center justify-center shrink-0 shadow-sm relative overflow-hidden">
                        <i class="fa-solid ${cat.icon} text-xl drop-shadow-sm"></i>
                        <span class="text-[9px] font-heading font-medium mt-1 opacity-95">${cat.label.split('/')[0]}</span>
                    </div>

                    <!-- Right Content -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-1.5">
                            <h3 class="font-heading font-semibold text-sm text-slate-800 group-hover:text-emerald-700 truncate leading-snug">
                                ${escapeHTML(place.name)}
                            </h3>
                            <span class="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-heading font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                                <i class="fa-solid fa-star text-[9px]"></i> ${place.rating.toFixed(1)}
                            </span>
                        </div>

                        <div class="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                            <span class="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>เปิดอยู่
                            </span>
                            <span class="text-slate-300">•</span>
                            <span class="text-slate-500 truncate">${escapeHTML(place.subdistrict)}</span>
                            ${isCustom}
                        </div>

                        <p class="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                            ${escapeHTML(place.shortDesc || place.highlights)}
                        </p>

                        <div class="mt-2 flex items-center justify-between gap-2">
                            <span class="inline-flex items-center gap-1 text-[10px] font-heading font-medium px-2 py-0.5 rounded-full border ${aud.badgeClass}">
                                <i class="fa-solid ${aud.icon} text-[9px]"></i> ${aud.label}
                            </span>
                            <span class="text-[11px] text-emerald-600 font-heading font-medium opacity-0 group-hover:opacity-100 transition">
                                ดูข้อมูล <i class="fa-solid fa-arrow-right text-[10px]"></i>
                            </span>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        // Attach card click listeners
        dom.listView.querySelectorAll('.place-card').forEach(card => {
            card.addEventListener('click', () => {
                selectPlace(card.dataset.id, true);
            });
        });
    }

    function renderDetailView(place) {
        const cat = CATEGORIES[place.category] || CATEGORIES.shop;
        const aud = AUDIENCE_LABELS[place.audience] || AUDIENCE_LABELS.both;
        const mapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;

        const amenitiesHtml = (place.amenities && place.amenities.length > 0)
            ? place.amenities.map(item => `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200/70">
                    <i class="fa-solid fa-check text-emerald-600 text-[10px]"></i> ${escapeHTML(item)}
                </span>
            `).join('')
            : '<span class="text-xs text-slate-400">ไม่ได้ระบุข้อมูล</span>';

        dom.detailView.innerHTML = `
            <!-- Cover Gradient Banner -->
            <div class="relative bg-gradient-to-br ${cat.gradient} text-white p-4 pt-3 pb-5 shrink-0">
                <!-- Decorative Pattern Overlay -->
                <div class="absolute inset-0 opacity-10 pointer-events-none" style="background-image: radial-gradient(circle at 20% 80%, #fff 1px, transparent 1px); background-size: 18px 18px;"></div>

                <!-- Top Back Button Row -->
                <div class="relative z-10 flex items-center justify-between mb-4">
                    <button id="btn-back-to-list" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/25 hover:bg-black/40 backdrop-blur-md text-white text-xs font-heading font-medium transition">
                        <i class="fa-solid fa-arrow-left"></i> กลับไปรายการ
                    </button>
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-[11px] font-heading font-medium">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse"></span> เปิดบริการ
                    </span>
                </div>

                <!-- Icon + Category & Audience Badges -->
                <div class="relative z-10 flex items-end justify-between gap-3">
                    <div>
                        <div class="flex flex-wrap items-center gap-1.5 mb-2">
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white text-slate-800 text-[11px] font-heading font-semibold shadow-sm">
                                <i class="fa-solid ${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}
                            </span>
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/25 backdrop-blur-sm text-white text-[11px] font-heading">
                                <i class="fa-solid ${aud.icon} text-[10px]"></i> ${aud.label}
                            </span>
                        </div>
                        <h2 class="font-heading font-bold text-lg leading-snug drop-shadow-sm">${escapeHTML(place.name)}</h2>
                    </div>
                    <div class="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/30">
                        <i class="fa-solid ${cat.icon} text-2xl"></i>
                    </div>
                </div>
            </div>

            <!-- Main Body Content -->
            <div class="p-4 space-y-4">

                <!-- Rating & Quick Action Buttons -->
                <div class="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-xl border border-amber-200 font-heading font-bold text-sm">
                            <i class="fa-solid fa-star text-amber-500 text-xs"></i> ${place.rating.toFixed(1)}
                        </div>
                        <span class="text-xs text-slate-500">(${place.reviewCount || 1} รีวิว)</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="btn-share-place" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-heading font-medium transition">
                            <i class="fa-solid fa-share-nodes"></i> แชร์พิกัด
                        </button>
                        <a href="${mapsDirUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-heading font-semibold shadow-sm transition">
                            <i class="fa-solid fa-diamond-turn-right"></i> นำทาง
                        </a>
                    </div>
                </div>

                <!-- Essential Info List -->
                <div class="space-y-2.5 text-sm">
                    <div class="flex items-start gap-3">
                        <i class="fa-solid fa-location-dot text-emerald-600 mt-1 w-4 text-center shrink-0"></i>
                        <div class="flex-1">
                            <p class="text-slate-800 font-medium">${escapeHTML(place.address || place.subdistrict + ' อ.เทิง จ.เชียงราย')}</p>
                            <div class="flex items-center flex-wrap gap-1.5 mt-1">
                                <p class="text-[11px] text-slate-400 font-mono">${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}</p>
                                ${state.isAdmin ? `
                                <button id="btn-move-pin" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-heading font-medium transition">
                                    <i class="fa-solid fa-location-crosshairs text-[10px]"></i> ย้ายพิกัด
                                </button>
                                <button id="btn-edit-place" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-heading font-medium transition">
                                    <i class="fa-solid fa-pen-to-square text-[10px]"></i> แก้ไข
                                </button>
                                <button id="btn-delete-place" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-heading font-medium transition">
                                    <i class="fa-solid fa-trash text-[10px]"></i> ลบ
                                </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-start gap-3">
                        <i class="fa-regular fa-clock text-emerald-600 mt-1 w-4 text-center shrink-0"></i>
                        <p class="text-slate-700">${escapeHTML(place.hours || 'ไม่ระบุเวลาเปิด-ปิด')}</p>
                    </div>
                    <div class="flex items-start gap-3">
                        <i class="fa-solid fa-phone text-emerald-600 mt-1 w-4 text-center shrink-0"></i>
                        <p class="text-slate-700">
                            ${place.phone && place.phone !== '-' 
                                ? `<a href="tel:${place.phone.replace(/[^0-9+]/g, '')}" class="text-blue-600 hover:underline font-medium">${escapeHTML(place.phone)}</a>` 
                                : '<span class="text-slate-400">ไม่มีหมายเลขโทรศัพท์</span>'}
                        </p>
                    </div>
                    <div class="flex items-start gap-3">
                        <i class="fa-solid fa-baht-sign text-emerald-600 mt-1 w-4 text-center shrink-0"></i>
                        <p class="text-slate-700"><span class="text-slate-500 text-xs mr-1">ช่วงราคา:</span> ${escapeHTML(place.priceRange || 'ราคามิตรภาพ')}</p>
                    </div>
                </div>

                <!-- IN-DEPTH INFO SECTION (ข้อมูลเจาะลึก) -->
                <div class="pt-3 border-t border-slate-100 space-y-3">
                    <h3 class="font-heading font-bold text-sm text-slate-800 flex items-center gap-2">
                        <span class="w-1.5 h-4 bg-emerald-600 rounded-full"></span>
                        ข้อมูลเจาะลึก (In-Depth Info)
                    </h3>

                    <!-- Highlights Card -->
                    <div class="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-3.5">
                        <h4 class="font-heading font-semibold text-xs text-emerald-800 flex items-center gap-1.5 mb-1.5">
                            <i class="fa-solid fa-sparkles text-emerald-600"></i> ไฮไลต์ / เมนูหรือสินค้าแนะนำ
                        </h4>
                        <p class="text-xs text-slate-700 leading-relaxed">${escapeHTML(place.highlights)}</p>
                    </div>

                    <!-- Local Insider Tips Card -->
                    <div class="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3.5">
                        <h4 class="font-heading font-semibold text-xs text-amber-900 flex items-center gap-1.5 mb-1.5">
                            <i class="fa-solid fa-lightbulb text-amber-500"></i> ทิปส์จากคนในพื้นที่ (Local Insider Tips)
                        </h4>
                        <p class="text-xs text-slate-700 leading-relaxed">${escapeHTML(place.localTips || 'แนะนำให้สอบถามข้อมูลเพิ่มเติมที่หน้าร้านโดยตรง')}</p>
                    </div>

                    <!-- Amenities -->
                    <div>
                        <h4 class="font-heading font-semibold text-xs text-slate-700 mb-2">สิ่งอำนวยความสะดวก</h4>
                        <div class="flex flex-wrap gap-1.5">
                            ${amenitiesHtml}
                        </div>
                    </div>
                </div>

                <!-- Full Width Google Maps CTA -->
                <div class="pt-2 pb-4">
                    <a href="${mapsDirUrl}" target="_blank" rel="noopener noreferrer" class="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-heading font-semibold text-sm shadow-md flex items-center justify-center gap-2 transition">
                        <i class="fa-solid fa-map-location-dot"></i> เปิดเส้นทางใน Google Maps
                    </a>
                </div>
            </div>
        `;

        // Bind Detail View Buttons
        document.getElementById('btn-back-to-list').addEventListener('click', closeDetailView);
        document.getElementById('btn-share-place').addEventListener('click', () => {
            const shareText = `${place.name} (${place.subdistrict} อ.เทิง จ.เชียงราย)\nพิกัด: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}\nGoogle Maps: https://www.google.com/maps?q=${place.lat},${place.lng}`;
            copyToClipboard(shareText, 'คัดลอกพิกัดและลิงก์แผนที่แล้ว!');
        });
        const btnMovePin = document.getElementById('btn-move-pin');
        if (btnMovePin) {
            btnMovePin.addEventListener('click', () => enterMovePinMode(place));
        }
        const btnEditPlace = document.getElementById('btn-edit-place');
        if (btnEditPlace) {
            btnEditPlace.addEventListener('click', () => openEditModal(place));
        }
        const btnDeletePlace = document.getElementById('btn-delete-place');
        if (btnDeletePlace) {
            btnDeletePlace.addEventListener('click', () => deletePlace(place));
        }
    }

    // =================================================================
    // 9. Selection & View Transitions
    // =================================================================
    function selectPlace(placeId, shouldFly = true) {
        const place = places.find(p => p.id === placeId);
        if (!place) return;

        state.selectedPlaceId = placeId;

        // Ensure sidebar is open on desktop and expanded on mobile
        if (state.isDesktopCollapsed) toggleDesktopSidebar(false);
        setMobileDrawerState(true);

        // Show Detail View, Hide List & Header
        dom.sidebarHeader.classList.add('hidden');
        dom.listView.classList.add('hidden');
        dom.detailView.classList.remove('hidden');
        dom.detailView.scrollTop = 0;

        renderDetailView(place);

        // Update Marker Active State
        const filtered = getFilteredPlaces();
        renderMapMarkers(filtered);

        // Smoothly fly map to location
        if (shouldFly) {
            const targetZoom = Math.max(map.getZoom(), 15);
            map.flyTo([place.lat, place.lng], targetZoom, {
                duration: 0.85,
                easeLinearity: 0.25
            });
        }
    }

    function closeDetailView() {
        state.selectedPlaceId = null;
        dom.detailView.classList.add('hidden');
        dom.sidebarHeader.classList.remove('hidden');
        dom.listView.classList.remove('hidden');
        updateApp();
    }

    function updateApp() {
        const filtered = getFilteredPlaces();
        renderCategoryChips();
        renderListView(filtered);
        renderMapMarkers(filtered);
    }

    // =================================================================
    // 10. Sidebar & Mobile Drawer Controls
    // =================================================================
    function toggleDesktopSidebar(forceCollapse = null) {
        state.isDesktopCollapsed = forceCollapse !== null ? forceCollapse : !state.isDesktopCollapsed;
        if (state.isDesktopCollapsed) {
            dom.sidebarContainer.classList.add('desktop-collapsed');
            dom.toggleSidebarIcon.className = 'fa-solid fa-chevron-right text-xs';
            dom.categoryBar.classList.remove('md:left-[416px]');
            dom.categoryBar.classList.add('md:left-10');
        } else {
            dom.sidebarContainer.classList.remove('desktop-collapsed');
            dom.toggleSidebarIcon.className = 'fa-solid fa-chevron-left text-xs';
            dom.categoryBar.classList.remove('md:left-10');
            dom.categoryBar.classList.add('md:left-[416px]');
        }
    }

    function setMobileDrawerState(expanded) {
        state.isMobileExpanded = expanded;
        if (expanded) {
            dom.sidebar.classList.remove('mobile-collapsed');
            dom.sidebar.classList.add('mobile-expanded');
            dom.mobileDrawerHint.textContent = 'แตะเพื่อย่อลงดูแผนที่';
        } else {
            dom.sidebar.classList.remove('mobile-expanded');
            dom.sidebar.classList.add('mobile-collapsed');
            dom.mobileDrawerHint.textContent = 'แตะเพื่อขยายดูรายการสถานที่';
        }
    }

    // =================================================================
    // 11. Add New Pin Flow (Interactive Mode + Modal)
    // =================================================================
    function setPickingBannerText(title, subtitle) {
        const titleEl = dom.pickingBanner.querySelector('p.font-heading');
        const subEl = dom.pickingBanner.querySelector('p.text-xs');
        if (titleEl) titleEl.textContent = title;
        if (subEl) subEl.textContent = subtitle;
    }

    function setAdminMode(enabled) {
        state.isAdmin = Boolean(enabled);
        try {
            if (state.isAdmin) {
                sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
            } else {
                sessionStorage.removeItem(ADMIN_SESSION_KEY);
            }
        } catch (_) {}

        if (state.isAdmin) {
            dom.btnAddPin.classList.remove('hidden');
            dom.btnAdminMode.className = 'px-2 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1 transition text-[11px] font-heading font-medium shadow-sm';
            dom.btnAdminMode.title = 'กำลังใช้งานโหมด Admin (คลิกเพื่อกลับเป็น Viewer)';
            dom.btnAdminMode.innerHTML = '<i class="fa-solid fa-unlock text-[10px]"></i><span>Admin</span>';
        } else {
            exitPickingMode();
            closeAddModal();
            dom.btnAddPin.classList.add('hidden');
            dom.btnAdminMode.className = 'w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition text-xs border border-slate-200';
            dom.btnAdminMode.title = 'เข้าสู่โหมด Admin';
            dom.btnAdminMode.innerHTML = '<i class="fa-solid fa-lock"></i>';
        }

        if (state.selectedPlaceId) {
            const current = places.find(p => p.id === state.selectedPlaceId);
            if (current) renderDetailView(current);
        }
    }

    function toggleAdminMode() {
        if (state.isAdmin) {
            setAdminMode(false);
            showToast('สลับกลับเป็นโหมด Viewer แล้ว', 'fa-eye');
            return;
        }
        const pin = prompt('กรอกรหัสผ่าน Admin:');
        if (pin === null) return;
        if (pin.trim() === ADMIN_PIN) {
            setAdminMode(true);
            showToast('เข้าสู่โหมด Admin แล้ว (เพิ่ม/แก้ไข/ย้าย/ลบหมุดได้)', 'fa-unlock');
        } else {
            showToast('รหัสผ่าน Admin ไม่ถูกต้อง', 'fa-circle-exclamation', true);
        }
    }

    function enterPickingMode() {
        if (!state.isAdmin) return;
        state.movingPlaceId = null;
        state.isPickingLocation = true;
        setPickingBannerText('โหมดปักหมุดสถานที่ใหม่', 'คลิกบนแผนที่เพื่อเลือกตำแหน่ง หรือใช้จุดกึ่งกลางแผนที่');
        document.body.classList.add('picking-mode');
        dom.pickingBanner.classList.remove('hidden');
        setMobileDrawerState(false);
        showToast('คลิกบนแผนที่เพื่อเลือกจุดที่ต้องการปักหมุด', 'fa-location-crosshairs');
    }

    function enterMovePinMode(place) {
        if (!state.isAdmin) return;
        state.isPickingLocation = false;
        state.movingPlaceId = place.id;
        setPickingBannerText(`โหมดย้ายพิกัด: ${place.name}`, 'คลิกบนแผนที่เพื่อวางตำแหน่งใหม่ (จะคัดลอกพิกัดให้อัตโนมัติ)');
        document.body.classList.add('picking-mode');
        dom.pickingBanner.classList.remove('hidden');
        setMobileDrawerState(false);
        showToast(`คลิกบนแผนที่เพื่อย้ายหมุด "${place.name}"`, 'fa-location-crosshairs');
    }

    async function applyMovedCoords(lat, lng) {
        const place = places.find(p => p.id === state.movingPlaceId);
        exitPickingMode();
        if (!place) return;

        const newLat = Number(lat.toFixed(6));
        const newLng = Number(lng.toFixed(6));
        place.lat = newLat;
        place.lng = newLng;
        saveCoordOverride(place.id, newLat, newLng);

        updateApp();
        renderDetailView(place);
        map.flyTo([newLat, newLng], Math.max(map.getZoom(), 15), { duration: 0.6 });

        const savedToCloud = await updatePlaceCoordsInFirestore(place.id, newLat, newLng);
        if (savedToCloud) {
            showToast(`บันทึกพิกัดใหม่ของ "${place.name}" ลง Firestore แล้ว!`, 'fa-cloud-arrow-up');
        } else {
            showToast(`ย้ายพิกัดแล้ว (บันทึกในเครื่องชั่วคราว)`, 'fa-location-dot');
        }
    }

    function exitPickingMode() {
        state.isPickingLocation = false;
        state.movingPlaceId = null;
        document.body.classList.remove('picking-mode');
        dom.pickingBanner.classList.add('hidden');
        if (tempPickMarker) {
            map.removeLayer(tempPickMarker);
            tempPickMarker = null;
        }
    }

    function setModalMode(isEdit) {
        const heading = dom.addPinModal.querySelector('h2');
        const submitBtn = dom.addPinForm.querySelector('button[type="submit"]');
        if (heading) {
            heading.textContent = isEdit ? 'แก้ไขข้อมูลสถานที่' : 'ปักหมุดร้านค้า/สถานที่ใหม่';
        }
        if (submitBtn) {
            submitBtn.innerHTML = isEdit
                ? '<i class="fa-solid fa-floppy-disk"></i> บันทึกการแก้ไข'
                : '<i class="fa-solid fa-check"></i> บันทึกหมุดลงแผนที่';
        }
    }

    function openAddModalWithCoords(lat, lng) {
        exitPickingMode();
        state.editingPlaceId = null;
        setModalMode(false);
        dom.addPinForm.reset();

        // Show temporary pin on map
        tempPickMarker = L.marker([lat, lng]).addTo(map);
        map.panTo([lat, lng]);

        dom.inputLat.value = lat.toFixed(6);
        dom.inputLng.value = lng.toFixed(6);
        dom.formCoordsDisplay.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        dom.addPinModal.classList.remove('hidden');
    }

    function openEditModal(place) {
        if (!state.isAdmin) return;
        exitPickingMode();
        state.editingPlaceId = place.id;
        setModalMode(true);
        dom.addPinForm.reset();

        document.getElementById('input-name').value = place.name || '';
        document.getElementById('input-category').value = place.category || 'shop';
        document.getElementById('input-subdistrict').value = place.subdistrict || 'ต.เวียง';
        document.getElementById('input-audience').value = place.audience || 'both';
        document.getElementById('input-hours').value = place.hours || '';
        document.getElementById('input-phone').value = (place.phone && place.phone !== '-') ? place.phone : '';
        document.getElementById('input-price').value = place.priceRange || '';
        document.getElementById('input-highlights').value = place.highlights || '';
        document.getElementById('input-tips').value = place.localTips || '';

        const placeAmenities = new Set(place.amenities || []);
        document.querySelectorAll('input[name="amenities"]').forEach(cb => {
            cb.checked = placeAmenities.has(cb.value);
        });

        dom.inputLat.value = Number(place.lat).toFixed(6);
        dom.inputLng.value = Number(place.lng).toFixed(6);
        dom.formCoordsDisplay.textContent = `${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}`;
        dom.addPinModal.classList.remove('hidden');
    }

    async function deletePlace(place) {
        if (!state.isAdmin) return;
        if (!confirm(`ต้องการลบ "${place.name}" ออกจากแผนที่ใช่หรือไม่?`)) return;

        places = places.filter(p => p.id !== place.id);
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const existing = JSON.parse(saved).filter(p => p.id !== place.id);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
            }
        } catch (err) {
            console.warn('Could not remove place from localStorage:', err);
        }

        closeDetailView();
        const deletedFromCloud = await deletePlaceFromFirestore(place.id);
        showToast(
            deletedFromCloud ? `ลบ "${place.name}" ออกจาก Firestore แล้ว` : `ลบ "${place.name}" เรียบร้อยแล้ว`,
            'fa-trash'
        );
    }

    function closeAddModal() {
        state.editingPlaceId = null;
        dom.addPinModal.classList.add('hidden');
        if (tempPickMarker) {
            map.removeLayer(tempPickMarker);
            tempPickMarker = null;
        }
    }

    function handleAddPinSubmit(e) {
        e.preventDefault();

        const name = document.getElementById('input-name').value.trim();
        const category = document.getElementById('input-category').value;
        const subdistrict = document.getElementById('input-subdistrict').value;
        const audience = document.getElementById('input-audience').value;
        const hours = document.getElementById('input-hours').value.trim() || 'เปิดบริการทุกวัน';
        const phone = document.getElementById('input-phone').value.trim() || '-';
        const priceRange = document.getElementById('input-price').value.trim() || 'ราคามิตรภาพ';
        const highlights = document.getElementById('input-highlights').value.trim();
        const localTips = document.getElementById('input-tips').value.trim() || 'ข้อมูลเพิ่มเติมจากผู้ใช้งานเทิงแมพ';
        const lat = parseFloat(dom.inputLat.value);
        const lng = parseFloat(dom.inputLng.value);

        const checkedAmenities = Array.from(document.querySelectorAll('input[name="amenities"]:checked'))
            .map(cb => cb.value);

        if (!name || !highlights || isNaN(lat) || isNaN(lng)) {
            showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน', 'fa-circle-exclamation', true);
            return;
        }

        // โหมดแก้ไขข้อมูลสถานที่เดิม
        if (state.editingPlaceId) {
            const idx = places.findIndex(p => p.id === state.editingPlaceId);
            if (idx !== -1) {
                const prev = places[idx];
                const updatedPlace = {
                    ...prev,
                    name,
                    category,
                    audience,
                    lat,
                    lng,
                    subdistrict,
                    address: prev.address || `${subdistrict} อ.เทิง จ.เชียงราย`,
                    hours,
                    phone,
                    priceRange,
                    shortDesc: highlights.length > 75 ? highlights.slice(0, 75) + '...' : highlights,
                    highlights,
                    localTips,
                    amenities: checkedAmenities
                };
                places[idx] = updatedPlace;

                try {
                    const saved = localStorage.getItem(STORAGE_KEY);
                    if (saved) {
                        const existing = JSON.parse(saved).map(p => p.id === updatedPlace.id ? updatedPlace : p);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
                    }
                } catch (err) {
                    console.warn('Could not update place in localStorage:', err);
                }

                savePlaceToFirestore(updatedPlace).then((ok) => {
                    if (ok) {
                        showToast(`บันทึกการแก้ไข "${name}" ลง Firestore แล้ว!`, 'fa-cloud-arrow-up');
                    }
                });

                closeAddModal();
                dom.addPinForm.reset();
                updateApp();
                selectPlace(updatedPlace.id, false);
                showToast(`อัปเดตข้อมูล "${name}" เรียบร้อยแล้ว`, 'fa-circle-check');
            }
            return;
        }

        const newPlace = {
            id: 'custom_' + Date.now(),
            name,
            category,
            audience,
            lat,
            lng,
            subdistrict,
            address: `${subdistrict} อ.เทิง จ.เชียงราย`,
            rating: 5.0,
            reviewCount: 1,
            isOpen: true,
            hours,
            phone,
            priceRange,
            shortDesc: highlights.length > 75 ? highlights.slice(0, 75) + '...' : highlights,
            highlights,
            localTips,
            amenities: checkedAmenities,
            tags: [subdistrict, CATEGORIES[category]?.label || 'สถานที่ใหม่', 'ปักหมุดใหม่'],
            isCustom: true
        };

        saveCustomPlace(newPlace);
        closeAddModal();
        dom.addPinForm.reset();

        // Reset filters so the newly added pin is immediately visible
        state.category = 'all';
        state.audience = 'all';
        state.searchQuery = '';
        dom.searchInput.value = '';
        dom.btnClearSearch.classList.add('hidden');
        updateAudienceTabsUI();

        updateApp();
        selectPlace(newPlace.id, true);
        showToast(`ปักหมุด "${name}" ลงบนเทิงแมพเรียบร้อยแล้ว!`, 'fa-circle-check');
    }

    // =================================================================
    // 12. Utility Helpers (Clipboard, Toast, Escape HTML)
    // =================================================================
    function copyToClipboard(text, successMsg) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast(successMsg, 'fa-copy');
        } catch (err) {
            showToast('ไม่สามารถคัดลอกได้ กรุณาลองใหม่อีกครั้ง', 'fa-circle-exclamation', true);
        }
        document.body.removeChild(textarea);
    }

    let toastTimer = null;
    function showToast(message, iconClass = 'fa-circle-check', isError = false) {
        dom.toastMessage.textContent = message;
        dom.toastIcon.className = `fa-solid ${iconClass} ${isError ? 'text-rose-400' : 'text-emerald-400'}`;
        dom.toast.classList.remove('opacity-0', '-translate-y-2');
        dom.toast.classList.add('opacity-100', 'translate-y-0');

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            dom.toast.classList.remove('opacity-100', 'translate-y-0');
            dom.toast.classList.add('opacity-0', '-translate-y-2');
        }, 3200);
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function updateAudienceTabsUI() {
        document.querySelectorAll('.audience-tab').forEach(tab => {
            const isActive = tab.dataset.audience === state.audience;
            if (isActive) {
                tab.className = 'audience-tab py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all bg-white text-emerald-700 shadow-sm';
            } else {
                tab.className = 'audience-tab py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all text-slate-600 hover:text-slate-800';
            }
        });
    }

    // =================================================================
    // 13. Event Listeners Binding
    // =================================================================
    function bindEvents() {
        // Search Input
        dom.searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            dom.btnClearSearch.classList.toggle('hidden', !state.searchQuery);
            updateApp();
        });

        dom.btnClearSearch.addEventListener('click', () => {
            state.searchQuery = '';
            dom.searchInput.value = '';
            dom.btnClearSearch.classList.add('hidden');
            dom.searchInput.focus();
            updateApp();
        });

        // Audience Mode Tabs
        document.querySelectorAll('.audience-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                state.audience = tab.dataset.audience;
                updateAudienceTabsUI();
                updateApp();
            });
        });

        // Sidebar Desktop Toggle & Mobile Handle
        dom.btnToggleSidebar.addEventListener('click', () => toggleDesktopSidebar());
        dom.mobileDrawerHandle.addEventListener('click', () => {
            setMobileDrawerState(!state.isMobileExpanded);
        });

        // Layer Switcher (Street vs Satellite)
        dom.btnLayerSwitch.addEventListener('click', () => {
            state.isSatellite = !state.isSatellite;
            if (state.isSatellite) {
                map.removeLayer(streetLayer);
                satelliteLayer.addTo(map);
                dom.layerPreviewBg.className = 'w-full h-full bg-gradient-to-br from-slate-100 via-emerald-50 to-sky-100 flex flex-col items-center justify-center text-slate-800 p-1';
                dom.layerPreviewIcon.className = 'fa-solid fa-map text-base mb-0.5 text-emerald-600';
                dom.layerPreviewLabel.textContent = 'แผนที่ถนน';
                showToast('สลับเป็นแผนที่ดาวเทียมแล้ว', 'fa-satellite');
            } else {
                map.removeLayer(satelliteLayer);
                streetLayer.addTo(map);
                dom.layerPreviewBg.className = 'w-full h-full bg-gradient-to-br from-emerald-800 via-teal-900 to-slate-900 flex flex-col items-center justify-center text-white p-1';
                dom.layerPreviewIcon.className = 'fa-solid fa-satellite text-base mb-0.5';
                dom.layerPreviewLabel.textContent = 'ดาวเทียม';
                showToast('สลับเป็นแผนที่ถนนแล้ว', 'fa-map');
            }
        });

        // Zoom & Reset Controls
        dom.btnZoomIn.addEventListener('click', () => map.zoomIn());
        dom.btnZoomOut.addEventListener('click', () => map.zoomOut());
        dom.btnResetThoeng.addEventListener('click', () => {
            map.flyTo(THOENG_CENTER, DEFAULT_ZOOM, { duration: 0.8 });
            showToast('กลับสู่ศูนย์กลางตัวเมืองเทิง', 'fa-house-flag');
        });

        // My Location (Geolocation)
        dom.btnMyLocation.addEventListener('click', () => {
            if (!navigator.geolocation) {
                showToast('เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง', 'fa-circle-exclamation', true);
                return;
            }
            showToast('กำลังค้นหาตำแหน่งปัจจุบันของคุณ...', 'fa-spinner fa-spin');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    if (userLocationMarker) map.removeLayer(userLocationMarker);
                    userLocationMarker = L.circleMarker([latitude, longitude], {
                        radius: 9,
                        fillColor: '#2563eb',
                        color: '#ffffff',
                        weight: 3,
                        opacity: 1,
                        fillOpacity: 0.95
                    }).addTo(map).bindTooltip('ตำแหน่งของคุณ', { className: 'custom-tooltip' });

                    map.flyTo([latitude, longitude], 15, { duration: 0.9 });
                    showToast('พบตำแหน่งปัจจุบันของคุณแล้ว', 'fa-location-crosshairs');
                },
                () => {
                    showToast('ไม่สามารถเข้าถึงตำแหน่งได้ (กรุณาอนุญาตสิทธิ์ Location)', 'fa-circle-exclamation', true);
                },
                { enableHighAccuracy: true, timeout: 8000 }
            );
        });

        // Admin Mode Toggle
        if (dom.btnAdminMode) {
            dom.btnAdminMode.addEventListener('click', toggleAdminMode);
        }

        // Add Pin Interactive Mode
        dom.btnAddPin.addEventListener('click', enterPickingMode);
        dom.btnCancelPick.addEventListener('click', exitPickingMode);
        dom.btnUseCenter.addEventListener('click', () => {
            const c = map.getCenter();
            if (state.movingPlaceId) {
                applyMovedCoords(c.lat, c.lng);
            } else {
                openAddModalWithCoords(c.lat, c.lng);
            }
        });

        // Add Pin Modal
        dom.btnCloseModal.addEventListener('click', closeAddModal);
        dom.btnCancelModal.addEventListener('click', closeAddModal);
        dom.btnRepickCoords.addEventListener('click', () => {
            closeAddModal();
            enterPickingMode();
        });
        dom.addPinForm.addEventListener('submit', handleAddPinSubmit);

        // Close modal when clicking backdrop
        dom.addPinModal.addEventListener('click', (e) => {
            if (e.target === dom.addPinModal) closeAddModal();
        });
    }

    // =================================================================
    // 14. Bootstrap Application
    // =================================================================
    function init() {
        loadInitialPlaces();
        initMap();
        bindEvents();
        let savedAdmin = false;
        try {
            savedAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
        } catch (_) {}
        setAdminMode(savedAdmin);
        updateApp();
        syncPlacesWithFirestore();

        const params = new URLSearchParams(window.location.search);
        if (params.get('admin') === '1' && !state.isAdmin) {
            setTimeout(toggleAdminMode, 300);
        }
    }

    window.addEventListener('DOMContentLoaded', init);
})();
