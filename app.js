'use strict';

/********************************************************************
- 1. STATIC DEFINITIONS (ICONS, SPECS, CARE CARDS, BOTANICAL SVGS)
 ********************************************************************/
const APP_NAME = 'VERDURE Botanical Manager';

const SPEC_DEFINITIONS = [
  { key: 'lightLevel', id: 'specLight', label: '光量・ライト' },
  { key: 'soil', id: 'specSoil', label: '用土・鉢' },
  {
    key: 'waterIntervalDays',
    id: 'specWaterInterval',
    label: '水やり目安・方法',
    formatValue: (plant) => plant.waterIntervalDays
      ? `${plant.waterIntervalDays}日ごと / ${plant.waterMethod || '通常'}`
      : (plant.waterMethod || '未設定')
  },
  { key: 'shop', id: 'specShop', label: '購入店・入手先' },
  {
    key: 'price',
    id: 'specPrice',
    label: '購入価格',
    formatValue: (plant) => plant.price !== null && plant.price !== undefined
      ? `¥${Number(plant.price).toLocaleString()}`
      : '未設定'
  },
  { key: 'purchaseDate', id: 'specPurchaseDate', label: 'お迎え日' }
];

const QUICK_CARE_CARDS = [
  {
    careType: 'lastWatered',
    label: '水やり',
    icon: 'droplets',
    boxId: 'detailLastWatered',
    subId: 'detailWaterSub',
    btnClass: 'bg-sky-50 hover:bg-sky-600 text-sky-700 hover:text-white border-sky-200/80',
    formatSub: (p) => p.waterIntervalDays ? `目安: ${p.waterIntervalDays}日ごと (${p.waterMethod || '通常'})` : (p.waterMethod || '目安未設定')
  },
  {
    careType: 'lastRepotted',
    label: '植替え',
    icon: 'shovel',
    boxId: 'detailLastRepotted',
    subId: 'detailSoilSub',
    btnClass: 'bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white border-amber-200/70',
    formatSub: (p) => p.soil || '用土未設定'
  }
];

/********************************************************************
- 2. STATE & INDEXED-DB STORAGE ENGINE
 ********************************************************************/
const DB_NAME = 'BotanicalLogDB';
const DB_VERSION = 1;
const STORE_NAME = 'appData';
const STATE_KEY = 'verdure_state_v1';
const MAX_IMPORT_BYTES = 1000 * 1024 * 1024;

const appState = {
  plants: [],
  selectedLocation: 'すべて',
  onlyNeedsWater: false,
  selectedStatus: 'all',
  batchMode: false,
  batchSelectedIds: new Set(),
  batchSelectedMaterials: new Set(),
  activeDetailPlantId: null,
  returnToDetailPlantId: null,
  selectedFormSvgType: 'agave',
  tempFormPhotoDataUrl: null,
  tempGrowthPhotos: [],
  growthPhotoSelectionId: 0,
  activeQuickLogPlantId: null,
  tempQuickLogPhotos: [],
  quickLogPhotoSelectionId: 0,
  dbLoadError: true
};

let cachedDB = null;
let svgUniqueCounter = 0;
let activeConfirmCleanup = null;

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const PLANT_STATUSES = {
  normal:  { label: '通常', badgeClass: 'bg-sage-100 text-sage-800 border-sage-200' },
  rooting: { label: '発根管理中', badgeClass: 'bg-teal-50 text-teal-800 border-teal-200' },
  curing:  { label: '養生中', badgeClass: 'bg-terracotta/15 text-terracotta border-terracotta/30' }
};

const MATERIAL_DEFS = {
  menedel:     { label: 'メネデール', group: 'water', updatesWatered: true },
  hyponex_liq: { label: 'ハイポ原液', group: 'water', updatesWatered: true },
  hyponex_pow: { label: '微粉ハイポ', group: 'water', updatesWatered: true },
  magamp:      { label: 'マグァンプ', group: 'solid', updatesWatered: false },
  fruit_fert:  { label: '果樹の肥料', group: 'solid', updatesWatered: false },
  ortran:      { label: 'オルトラン', group: 'solid', updatesWatered: false },
  benika:      { label: 'ベニカ',     group: 'solid', updatesWatered: false }
};

const LOG_TAGS = {
  growth:   { label: '成長記録', badgeClass: 'bg-sage-100 text-sage-800 border-sage-200' },
  repot:    { label: '植替え', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  cut:      { label: '胴切り・茎伏せ', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  rooting:  { label: '発根・水差し', badgeClass: 'bg-teal-50 text-teal-800 border-teal-200' },
  check:    { label: '根確認・処置', badgeClass: 'bg-orange-50 text-orange-800 border-orange-200' },
  move:     { label: '場所・環境変更', badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  status:   { label: '状態変更', badgeClass: 'bg-teal-50 text-teal-800 border-teal-200' },
  material: { label: '資材使用', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
};

function getSortedGrowthLogs(plant) {
  if (!Array.isArray(plant?.growthLogs)) return [];
  return [...plant.growthLogs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

const MAX_PHOTOS_PER_LOG = 6;

function getLogPhotos(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.photos) && entry.photos.length > 0) return entry.photos;
  if (entry.photoDataUrl) return [entry.photoDataUrl];
  return [];
}

function getPhotoLogs(plant) {
  return getSortedGrowthLogs(plant).filter(g => getLogPhotos(g).length > 0);
}

function canEditData() {
  if (!appState.dbLoadError) return true;
  showToast('データ保護モード中のため変更できません（JSON読込で復元してください）');
  return false;
}

async function runWithButtonDisabled(button, task) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await task();
  } finally {
    if (button) button.disabled = false;
  }
}

function openDB() {
  if (cachedDB) return Promise.resolve(cachedDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      cachedDB = req.result;
      cachedDB.onclose = () => { cachedDB = null; };
      resolve(cachedDB);
    };
    req.onerror = () => reject(req.error);
  });
}

function waitForTransaction(tx, getResult = () => undefined) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(getResult());
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

async function saveToDB(plants = appState.plants, allowRecovery = false) {
  if (appState.dbLoadError && !allowRecovery) {
    showToast('データ保護モード中のため保存できません（JSON読込で復元してください）');
    throw new Error('データの読み込みに失敗したため保存できません');
  }
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      version: '1.0',
      updatedAt: new Date().toISOString(),
      plants
    }, STATE_KEY);
    await waitForTransaction(tx);
  } catch (err) {
    console.error('IndexedDB Save Error:', err);
    showToast(`保存に失敗しました: ${err.message || err.name}。画面を閉じる前にJSONに書き出してください`, true);
    throw err;
  }
}

async function loadFromDB() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
  const stored = await waitForTransaction(tx, () => req.result);
  return stored == null ? null : validatePlantRecords(stored.plants);
}

/********************************************************************
- 3. CLIENT-SIDE AUTOMATIC IMAGE COMPRESSION
 ********************************************************************/
function compressImageFile(file, maxDim = 800, quality = 0.76) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        const approxKB = Math.round((dataUrl.length * 3) / 4 / 1024);
        resolve({ dataUrl, approxKB, width, height });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/********************************************************************
- 4. DATE UTILITIES & SAMPLE DATA
 ********************************************************************/
function formatLocalDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayStr() {
  return formatLocalDate(new Date());
}

function getDaysAgoStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatLocalDate(d);
}

function calcDaysBetween(dateStr1, dateStr2 = getTodayStr()) {
  if (!dateStr1) return null;
  const d1 = new Date(`${dateStr1}T00:00:00`);
  const d2 = new Date(`${dateStr2}T00:00:00`);
  const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  return Number.isNaN(diff) ? null : diff;
}

function getInitialSamplePlants() {
  return [
    {
      id: 'p_sample_1',
      name: 'アガベ チタノタ シーザー',
      svgType: 'agave',
      location: 'ライト棚・直下',
      soil: '無機質土・スリット鉢',
      lightLevel: '25,000 lx (強光)',
      waterIntervalDays: 7,
      waterMethod: '底面給水(ドボン)',
      purchaseDate: getDaysAgoStr(95),
      price: 6800,
      shop: 'Botanical Market',
      lastWatered: getDaysAgoStr(8),
      lastFertilized: getDaysAgoStr(15),
      lastRepotted: getDaysAgoStr(60),
      notes: '鋸歯のうねりが強い選抜株。サーキュレーター24時間直風で締め作り中。',
      status: 'normal',
      materialLogs: {},
      materialAutoLog: [],
      growthLogs: []
    },
    {
      id: 'p_sample_2',
      name: 'モンステラ デリシオーサ',
      svgType: 'monstera',
      location: '窓際・室内',
      soil: 'ベラボン / ねこチップ',
      lightLevel: '4,000 lx (中光)',
      waterIntervalDays: 5,
      waterMethod: '通常水やり',
      purchaseDate: getDaysAgoStr(140),
      price: 4200,
      shop: 'Green Interior Tokyo',
      lastWatered: getDaysAgoStr(2),
      lastFertilized: getDaysAgoStr(10),
      lastRepotted: getDaysAgoStr(120),
      notes: 'ねこチップ＋透明スリット鉢で根の動きを観察中。新葉の切れ込みが増えてきた。',
      status: 'normal',
      materialLogs: {},
      materialAutoLog: [],
      growthLogs: []
    },
    {
      id: 'p_sample_3',
      name: 'パキポディウム グラキリス',
      svgType: 'caudex',
      location: 'ライト棚・直下',
      soil: '無機質土・プレステラ',
      lightLevel: '28,000 lx (強光)',
      waterIntervalDays: 6,
      waterMethod: '底面給水(ドボン)',
      purchaseDate: getDaysAgoStr(210),
      price: 12500,
      shop: '塊根植物フェア',
      lastWatered: getDaysAgoStr(6),
      lastFertilized: getDaysAgoStr(20),
      lastRepotted: getDaysAgoStr(180),
      notes: '塊根部の張り良好。水やり後はしっかり風を当てて2日で乾かすサイクル。',
      status: 'normal',
      materialLogs: {},
      materialAutoLog: [],
      growthLogs: []
    },
    {
      id: 'p_sample_4',
      name: 'リプサリス カスッサ',
      svgType: 'hanging',
      location: 'キッチンレール',
      soil: '観葉植物ブレンド土',
      lightLevel: '2,000 lx (弱〜中光)',
      waterIntervalDays: 6,
      waterMethod: '通常水やり',
      purchaseDate: getDaysAgoStr(45),
      price: 2900,
      shop: '地元の園芸店',
      lastWatered: getDaysAgoStr(4),
      lastFertilized: getDaysAgoStr(25),
      lastRepotted: getDaysAgoStr(40),
      notes: 'ダクトレールからハンギング。エアコンの風が直接当たらない位置をキープ。',
      status: 'normal',
      materialLogs: {},
      materialAutoLog: [],
      growthLogs: []
    }
  ];
}

/********************************************************************
- 5. DOM HELPERS & RENDERING ENGINE
 ********************************************************************/
function createElement(tagName, className = '', text = null) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
}

function createLucideIcon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (className) svg.setAttribute('class', className);

  const paths = ICON_PATHS[name];
  if (paths) svg.innerHTML = paths;
  return svg;
}

function initializeIconPlaceholders() {
  document.querySelectorAll('span[data-icon]').forEach(element => {
    const iconName = element.dataset.icon;
    const iconClasses = element.dataset.iconClass || '';
    if (iconName && ICON_PATHS[iconName]) {
      element.replaceWith(createLucideIcon(iconName, iconClasses));
    }
  });
}

function appendBotanicalSvg(container, svgMarkup) {
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  if (parsed.documentElement.tagName !== 'svg') {
    throw new Error('Invalid built-in botanical SVG');
  }
  const svgEl = document.importNode(parsed.documentElement, true);
  const idElements = svgEl.querySelectorAll('[id]');
  if (idElements.length > 0) {
    const suffix = `_${++svgUniqueCounter}`;
    const idMap = new Map();
    idElements.forEach(el => {
      const oldId = el.getAttribute('id');
      const newId = `${oldId}${suffix}`;
      idMap.set(oldId, newId);
      el.setAttribute('id', newId);
    });
    svgEl.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes('url(#')) {
          let nextVal = attr.value;
          idMap.forEach((newId, oldId) => {
            nextVal = nextVal.replaceAll(`url(#${oldId})`, `url(#${newId})`);
          });
          if (nextVal !== attr.value) el.setAttribute(attr.name, nextVal);
        }
      }
    });
  }
  container.replaceChildren(svgEl);
}

function renderApp() {
  renderLocationTabs();
  renderPlantGrid();
  updateHeaderBadges();
  updateActiveFilterDot();
}

function getWaterMarginDays(plant) {
  if (!plant.waterIntervalDays) return null;
  if (!plant.lastWatered) return -9999;
  const elapsed = calcDaysBetween(plant.lastWatered);
  return elapsed === null ? null : Number(plant.waterIntervalDays) - elapsed;
}

function isPlantNeedingWater(plant) {
  if (plant.status && plant.status !== 'normal') return false;
  const margin = getWaterMarginDays(plant);
  return margin !== null && margin <= 0;
}

function updateHeaderBadges() {
  const needsWaterCount = appState.plants.filter(isPlantNeedingWater).length;
  const badge = document.getElementById('needsWaterCountBadge');
  badge.textContent = needsWaterCount;

  const btn = document.getElementById('filterNeedsWaterBtn');
  if (appState.onlyNeedsWater) {
    btn.className = 'ui-btn ui-md font-semibold border-amber-500 bg-amber-500 text-white transition shrink-0 shadow-2xs cursor-pointer';
    badge.className = 'px-1.5 py-0.5 rounded-full bg-white text-amber-800 text-[10px] font-bold leading-none';
  } else {
    btn.className = 'ui-btn ui-md font-medium border-stoneborder bg-white text-gray-600 hover:bg-amber-50 transition shrink-0 cursor-pointer';
    badge.className = 'px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold leading-none';
  }
}

function renderLocationTabs() {
  const container = document.getElementById('locationTabsContainer');
  const counts = new Map([['すべて', appState.plants.length]]);
  appState.plants.forEach(p => {
    const loc = p.location || '未設定';
    counts.set(loc, (counts.get(loc) || 0) + 1);
  });

  const locations = ['すべて', ...Array.from(counts.keys()).filter(k => k !== 'すべて')];
  if (!locations.includes(appState.selectedLocation)) {
    appState.selectedLocation = 'すべて';
  }

  container.replaceChildren();
  locations.forEach(loc => {
    const active = appState.selectedLocation === loc;
    const button = createElement(
      'button',
      `ui-btn ui-md font-medium transition shrink-0 cursor-pointer ${
        active ? 'bg-sage-600 text-white border-sage-600 shadow-2xs' : 'bg-white text-gray-600 border-stoneborder hover:bg-sage-50'
      }`
    );
    button.type = 'button';
    button.addEventListener('click', () => selectLocationTab(loc));
    button.append(
      createLucideIcon(loc === 'すべて' ? 'layout-grid' : 'map-pin', `w-3.5 h-3.5 ${active ? 'text-sage-200' : 'text-gray-400'}`),
      createElement('span', '', loc),
      createElement('span', `text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-sage-700 text-sage-100' : 'bg-gray-100 text-gray-500'}`, String(counts.get(loc) || 0))
    );
    container.appendChild(button);
  });
}

function getFilteredAndSortedPlants() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  document.getElementById('clearSearchBtn').classList.toggle('hidden', !q);

  const list = appState.plants.filter(p => {
    if (appState.selectedLocation !== 'すべて') {
      const loc = p.location || '未設定';
      if (loc !== appState.selectedLocation) return false;
    }
    if (appState.onlyNeedsWater && !isPlantNeedingWater(p)) return false;
    const plantStatus = p.status || 'normal';
    if (appState.selectedStatus !== 'all' && plantStatus !== appState.selectedStatus) return false;
    if (q) {
      const hay = `${p.name || ''} ${p.soil || ''} ${p.shop || ''} ${p.location || ''} ${p.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sortVal = document.getElementById('sortSelect').value;
  list.sort((a, b) => {
    if (sortVal === 'water_priority') {
      const ma = getWaterMarginDays(a) ?? 9999;
      const mb = getWaterMarginDays(b) ?? 9999;
      if (ma !== mb) return ma - mb;
      const da = a.lastWatered ? calcDaysBetween(a.lastWatered) : 9999;
      const db = b.lastWatered ? calcDaysBetween(b.lastWatered) : 9999;
      return db - da;
    }
    if (sortVal === 'water_desc') {
      const da = a.lastWatered ? calcDaysBetween(a.lastWatered) : 9999;
      const db = b.lastWatered ? calcDaysBetween(b.lastWatered) : 9999;
      return db - da;
    }
    if (sortVal === 'name_asc') return (a.name || '').localeCompare(b.name || '', 'ja');
    if (sortVal === 'purchase_desc') return (b.purchaseDate || '').localeCompare(a.purchaseDate || '');
    if (sortVal === 'purchase_asc') return (a.purchaseDate || '9999').localeCompare(b.purchaseDate || '9999');
    if (sortVal === 'price_desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
    return 0;
  });

  return list;
}

function createPlantCard(plant) {
  const svgInfo = BOTANICAL_SVGS[plant.svgType] || BOTANICAL_SVGS.agave;
  const photoLogs = getPhotoLogs(plant);
  const latestLog = photoLogs[photoLogs.length - 1];
  const latestPhotos = getLogPhotos(latestLog);
  const latestPhoto = latestPhotos[latestPhotos.length - 1] || null;
  const totalPhotoCount = photoLogs.reduce((sum, g) => sum + getLogPhotos(g).length, 0);

  const daysSinceWater = plant.lastWatered ? calcDaysBetween(plant.lastWatered) : null;
  const waterMargin = getWaterMarginDays(plant);
  const needsWater = isPlantNeedingWater(plant);

  let waterBadgeText;
  if (daysSinceWater === 0) {
    waterBadgeText = '今日完了';
  } else if (waterMargin !== null && waterMargin !== -9999) {
    if (waterMargin > 0) waterBadgeText = `あと${waterMargin}日`;
    else if (waterMargin === 0) waterBadgeText = '今日目安';
    else waterBadgeText = `${Math.abs(waterMargin)}日超過`;
  } else {
    waterBadgeText = daysSinceWater === null ? '未記録' : `${daysSinceWater}日前`;
  }

  const isBatchSelected = appState.batchSelectedIds.has(plant.id);
  const card = createElement('article', `group bg-surface rounded-2xl border shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden ${
    isBatchSelected ? 'border-sage-600 ring-2 ring-sage-500/30' : 'border-stoneborder'
  }${appState.batchMode ? ' cursor-pointer' : ''}`);
  card.id = `card_${plant.id}`;
  if (appState.batchMode) card.addEventListener('click', () => toggleSelectInBatch(plant.id));

  // Thumbnail / SVG Visual Area
  const visual = createElement('div', `relative h-28 sm:h-44 bg-sage-50/60 border-b border-stoneborder flex items-center justify-center overflow-hidden ${latestPhoto ? '' : 'pt-6 sm:pt-7'}`);
  if (latestPhoto) {
    const image = createElement('img', 'w-full h-full object-cover group-hover:scale-105 transition duration-500');
    image.src = latestPhoto;
    image.alt = plant.name;
    visual.appendChild(image);

    const svgBadge = createElement('div', 'absolute bottom-2.5 right-2.5 w-8 h-8 rounded-xl bg-white/90 backdrop-blur-xs p-0.5 border border-stoneborder shadow-xs');
    svgBadge.title = svgInfo.label;
    appendBotanicalSvg(svgBadge, svgInfo.svg);
    visual.appendChild(svgBadge);
  } else {
    const svgWrap = createElement('div', 'w-16 h-16 sm:w-24 sm:h-24 p-1 sm:p-2 transition-transform duration-300 group-hover:scale-110 flex items-center justify-center');
    appendBotanicalSvg(svgWrap, svgInfo.svg);
    visual.appendChild(svgWrap);
  }

  // Top Overlay Row (Location & Status — 140px幅でも重ならないようFlex配置)
  const topOverlay = createElement('div', 'absolute top-1.5 inset-x-1.5 sm:top-2.5 sm:inset-x-2.5 flex items-start justify-between gap-1 pointer-events-none');

  const locationPill = createElement('div', 'flex items-center gap-1 min-w-0 flex-1');
  if (appState.batchMode) {
    const checkWrap = createElement('div', `w-5 h-5 sm:w-6 sm:h-6 rounded-lg shrink-0 ${isBatchSelected ? 'bg-sage-600 text-white' : 'bg-white/90 text-gray-400 border border-gray-300'} flex items-center justify-center shadow-xs`);
    checkWrap.appendChild(createLucideIcon('check', 'w-3.5 h-3.5 sm:w-4 sm:h-4'));
    locationPill.appendChild(checkWrap);
  }
  const locationBadge = createElement('span', 'marker-badge font-medium bg-white/90 backdrop-blur-xs text-charcoal border-stoneborder/80 shadow-2xs min-w-0 max-w-full');
  locationBadge.append(createLucideIcon('map-pin', 'text-sage-600'), createElement('span', 'truncate', plant.location || '未設定'));
  locationPill.appendChild(locationBadge);

  const statusWrap = createElement('div', 'shrink-0');
  const plantStatus = plant.status && PLANT_STATUSES[plant.status] ? plant.status : 'normal';
  if (plantStatus !== 'normal') {
    const stInfo = PLANT_STATUSES[plantStatus];
    statusWrap.appendChild(createElement('span', `marker-badge font-bold shadow-2xs ${stInfo.badgeClass}`, stInfo.label));
  } else {
    const statusBadge = createElement('span', `marker-badge font-bold shadow-2xs ${
      needsWater ? 'bg-amber-500 text-white border-transparent' : daysSinceWater === 0 ? 'bg-sky-600 text-white border-transparent' : 'bg-white/90 backdrop-blur-xs text-charcoal border-stoneborder/80'
    }`);
    statusBadge.append(
      createLucideIcon('droplets', `${needsWater || daysSinceWater === 0 ? 'text-white' : 'text-sky-500'}`),
      createElement('span', '', waterBadgeText)
    );
    statusWrap.appendChild(statusBadge);
  }

  topOverlay.append(locationPill, statusWrap);
  visual.appendChild(topOverlay);

  if (photoLogs.length) {
    const logBadge = createElement('span', 'marker-badge absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 bg-black/60 text-white font-medium border-transparent');
    logBadge.append(createLucideIcon('images'), document.createTextNode(`${totalPhotoCount}枚`));
    visual.appendChild(logBadge);
  }

  visual.addEventListener('click', event => {
    event.stopPropagation();
    if (appState.batchMode) {
      toggleSelectInBatch(plant.id);
      return;
    }
    openDetailModal(plant.id);
  });
  visual.style.cursor = 'pointer';
  card.appendChild(visual);

  // Card Body
  const body = createElement('div', 'px-3 pt-3 pb-3 sm:px-3.5 sm:pt-3.5 sm:pb-3.5 flex-1 flex flex-col justify-between gap-2');
  const details = createElement('div');
  const name = createElement('h3', 'font-medium text-[13px] sm:text-sm text-charcoal hover:text-sage-600 transition cursor-pointer line-clamp-1 leading-snug', plant.name);
  name.addEventListener('click', event => {
    event.stopPropagation();
    if (appState.batchMode) {
      toggleSelectInBatch(plant.id);
      return;
    }
    openDetailModal(plant.id);
  });
  details.appendChild(name);

  body.appendChild(details);

  // Quick Care & Log Buttons
  const actions = createElement('div', 'grid grid-cols-[1.15fr_1fr] gap-1.5');

  const waterCard = QUICK_CARE_CARDS[0];
  const waterBtn = createElement('button', `ui-btn ui-sm card-action font-medium transition cursor-pointer ${waterCard.btnClass}`);
  waterBtn.type = 'button';
  waterBtn.title = plant.lastWatered === getTodayStr() ? '今日の水やり記録を取り消す' : '今日水やりしたとして記録';
  waterBtn.append(
    createLucideIcon(waterCard.icon, 'w-3.5 h-3.5 shrink-0'),
    createElement('span', 'leading-none whitespace-nowrap', waterCard.label)
  );
  waterBtn.addEventListener('click', event => {
    event.stopPropagation();
    recordPlantCare(plant.id, waterCard.careType, `${waterCard.label}を記録しました`);
  });

  const quickLogBtn = createElement('button', 'ui-btn ui-sm card-action font-medium transition cursor-pointer bg-sage-50 hover:bg-sage-600 text-sage-800 hover:text-white border-sage-200/80');
  quickLogBtn.type = 'button';
  quickLogBtn.title = '写真やひとことメモをサッと追加';
  quickLogBtn.append(
    createLucideIcon('square-pen', 'w-3.5 h-3.5 shrink-0'),
    createElement('span', 'leading-none whitespace-nowrap', '記録')
  );
  quickLogBtn.addEventListener('click', event => {
    event.stopPropagation();
    openQuickLogModal(plant.id);
  });

  actions.append(waterBtn, quickLogBtn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function renderPlantGrid() {
  const grid = document.getElementById('plantGrid');
  const emptyState = document.getElementById('emptyState');
  const list = getFilteredAndSortedPlants();

  if (list.length === 0) {
    grid.replaceChildren();
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  grid.replaceChildren(...list.map(createPlantCard));
}

/********************************************************************
- 6. ONE-TAP QUICK CARE & BATCH ACTIONS
 ********************************************************************/
function getTodayCareUndo(plant, today) {
  if (!plant.careUndo || plant.careUndo.date !== today) {
    plant.careUndo = { date: today, fields: {}, materials: {} };
  }
  return plant.careUndo;
}

function addCareSource(plant, field, source, today) {
  const undo = getTodayCareUndo(plant, today);
  if (!undo.fields[field]) {
    undo.fields[field] = { previous: plant[field] || '', sources: [] };
  }
  const sources = undo.fields[field].sources;
  if (!sources.includes(source)) sources.push(source);
  plant[field] = today;
}

function removeCareSource(plant, field, source, today) {
  const entry = plant.careUndo?.date === today ? plant.careUndo.fields[field] : null;
  if (!entry || !entry.sources.includes(source)) return false;
  entry.sources = entry.sources.filter(item => item !== source);
  if (plant[field] === today && entry.sources.length === 0) {
    plant[field] = entry.previous;
  }
  if (entry.sources.length === 0) delete plant.careUndo.fields[field];
  return true;
}

function updateRepottedFromLog(plant, date) {
  if (plant.lastRepotted && date < plant.lastRepotted) return;
  const entry = plant.careUndo?.fields.lastRepotted;
  if (entry) {
    if (date === plant.careUndo.date) entry.previous = date;
    else delete plant.careUndo.fields.lastRepotted;
  }
  plant.lastRepotted = date;
}

async function recordPlantCare(plantId, careType, toastMessage) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant) return;

  const today = getTodayStr();
  const isUndo = plant[careType] === today;

  if (isUndo) {
    if (!removeCareSource(plant, careType, 'direct', today)) {
      showToast('以前の日付を復元できないため取り消せません。資材や育成ログの記録も確認してください');
      return;
    }
  } else {
    addCareSource(plant, careType, 'direct', today);
  }

  try {
    await saveToDB();
  } catch (err) {
    renderApp();
    if (appState.activeDetailPlantId === plantId) populateDetailModal(plantId);
    return;
  }
  const existingCard = document.getElementById(`card_${plantId}`);
  if (existingCard) {
    existingCard.replaceWith(createPlantCard(plant));
    updateHeaderBadges();
  } else {
    renderApp();
  }
  if (appState.activeDetailPlantId === plantId) {
    populateDetailModal(plantId);
  }
  showToast(isUndo ? `今日の記録を取り消しました（${plant.name}）` : `${toastMessage}（${plant.name}）`);
}

function setBatchMode(enabled) {
  appState.batchMode = enabled;
  appState.batchSelectedIds.clear();
  appState.batchSelectedMaterials.clear();
  renderBatchMaterialChips();
  document.getElementById('batchActionBar').classList.toggle('hidden', !appState.batchMode);

  const btn = document.getElementById('batchModeBtnHeader');
  if (btn) {
    btn.classList.toggle('bg-sage-100', appState.batchMode);
    btn.classList.toggle('text-sage-800', appState.batchMode);
    btn.classList.toggle('border-sage-500', appState.batchMode);
    btn.classList.toggle('font-semibold', appState.batchMode);
    btn.classList.toggle('bg-white', !appState.batchMode);
    btn.classList.toggle('text-charcoal', !appState.batchMode);
    btn.classList.toggle('border-stoneborder', !appState.batchMode);
    btn.classList.toggle('font-medium', !appState.batchMode);
  }

  updateBatchCountUI();
  renderApp();
}

function toggleBatchMode() {
  setBatchMode(!appState.batchMode);
}

function toggleSelectInBatch(plantId) {
  if (appState.batchSelectedIds.has(plantId)) {
    appState.batchSelectedIds.delete(plantId);
  } else {
    appState.batchSelectedIds.add(plantId);
  }
  updateBatchCountUI();
  renderApp();
}

function selectAllVisibleInBatch() {
  getFilteredAndSortedPlants().forEach(p => appState.batchSelectedIds.add(p.id));
  updateBatchCountUI();
  renderApp();
}

function clearBatchSelection() {
  appState.batchSelectedIds.clear();
  updateBatchCountUI();
  renderApp();
}

function updateBatchCountUI() {
  document.getElementById('batchSelectedCount').textContent = appState.batchSelectedIds.size;
}

async function executeBatchCare(careFields, toastMessage) {
  if (!canEditData()) return;
  if (appState.batchSelectedIds.size === 0) {
    showToast('ケア対象の株カードをタップして選択してください');
    return;
  }
  const today = getTodayStr();
  let count = 0;
  appState.plants.forEach(p => {
    if (appState.batchSelectedIds.has(p.id)) {
      careFields.forEach(field => addCareSource(p, field, 'direct', today));
      count++;
    }
  });
  try {
    await saveToDB();
  } catch (err) {
    renderApp();
    return;
  }
  showToast(toastMessage.replace('{count}', count));
  setBatchMode(false);
}

function applyMaterialUsage(plant, code, today) {
  const def = MATERIAL_DEFS[code];
  if (!def) return null;
  if (!plant.materialLogs || typeof plant.materialLogs !== 'object') plant.materialLogs = {};
  if (plant.materialLogs[code] === today) return null;
  const undo = getTodayCareUndo(plant, today);
  const previous = plant.materialLogs[code] || '';
  plant.materialLogs[code] = today;
  addCareSource(plant, 'lastFertilized', `material:${code}`, today);
  if (def.updatesWatered) addCareSource(plant, 'lastWatered', `material:${code}`, today);

  let createdLogId = null;
  if (Array.isArray(plant.materialAutoLog) && plant.materialAutoLog.includes(code)) {
    if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];
    createdLogId = createId('g');
    plant.growthLogs.push({
      id: createdLogId,
      tag: 'material',
      date: today,
      photos: [],
      photoDataUrl: '',
      note: `${def.label}を使用${def.updatesWatered ? '（水やり兼用）' : ''}`
    });
  }
  undo.materials[code] = { previous, logId: createdLogId || '' };
  return createdLogId;
}

async function recordMaterialUsage(plantId, code) {
  if (!canEditData()) return;
  const def = MATERIAL_DEFS[code];
  const plant = appState.plants.find(p => p.id === plantId);
  if (!def || !plant) return;

  const today = getTodayStr();
  if (!plant.materialLogs || typeof plant.materialLogs !== 'object') plant.materialLogs = {};
  const isUndo = plant.materialLogs[code] === today;

  if (isUndo) {
    const snap = plant.careUndo?.date === today ? plant.careUndo.materials[code] : null;
    if (!snap) {
      showToast('以前の資材記録を復元できないため取り消せません');
      return;
    }
    if (snap.previous) plant.materialLogs[code] = snap.previous;
    else delete plant.materialLogs[code];
    removeCareSource(plant, 'lastFertilized', `material:${code}`, today);
    if (def.updatesWatered) removeCareSource(plant, 'lastWatered', `material:${code}`, today);
    if (snap.logId && Array.isArray(plant.growthLogs)) {
      plant.growthLogs = plant.growthLogs.filter(g => g.id !== snap.logId);
    }
    delete plant.careUndo.materials[code];
  } else {
    applyMaterialUsage(plant, code, today);
  }

  try {
    await saveToDB();
  } catch (err) {
    renderApp();
    if (appState.activeDetailPlantId === plantId) populateDetailModal(plantId);
    return;
  }
  renderApp();
  if (appState.activeDetailPlantId === plantId) populateDetailModal(plantId);
  showToast(isUndo ? `${def.label}の記録を取り消しました（${plant.name}）` : `🧪 ${def.label}を記録しました（${plant.name}）`);
}

function renderBatchMaterialChips() {
  const container = document.getElementById('batchMaterialChips');
  if (!container) return;
  container.replaceChildren();

  Object.entries(MATERIAL_DEFS).forEach(([code, def]) => {
    const selected = appState.batchSelectedMaterials.has(code);
    const chip = createElement(
      'button',
      `ui-btn ui-sm font-semibold transition cursor-pointer ${
        selected
          ? 'bg-white text-sage-800 border-white shadow-2xs'
          : 'bg-sage-700/80 text-sage-100 border-sage-600 hover:bg-sage-600'
      }`
    );
    chip.type = 'button';
    chip.appendChild(createElement('span', 'leading-none', def.label));
    if (def.updatesWatered) {
      chip.appendChild(createLucideIcon('droplets', `w-3 h-3 block shrink-0 ${selected ? 'text-sky-600' : 'text-sky-300'}`));
    }
    chip.addEventListener('click', () => {
      if (appState.batchSelectedMaterials.has(code)) {
        appState.batchSelectedMaterials.delete(code);
      } else {
        appState.batchSelectedMaterials.add(code);
      }
      renderBatchMaterialChips();
    });
    container.appendChild(chip);
  });

  const labelEl = document.getElementById('batchMaterialBtnLabel');
  if (labelEl) {
    const codes = Array.from(appState.batchSelectedMaterials);
    if (codes.length === 0) {
      labelEl.textContent = '資材を記録';
    } else {
      const hasWater = codes.some(c => MATERIAL_DEFS[c]?.updatesWatered);
      labelEl.textContent = hasWater
        ? `水やり＋資材(${codes.length})を記録`
        : `資材(${codes.length})を記録`;
    }
  }
}

async function executeBatchMaterial() {
  if (!canEditData()) return;
  const codes = Array.from(appState.batchSelectedMaterials);
  if (codes.length === 0) {
    showToast('使用する資材チップをタップして選択してください');
    return;
  }
  if (appState.batchSelectedIds.size === 0) {
    showToast('対象の株カードをタップして選択してください');
    return;
  }
  const today = getTodayStr();
  let count = 0;
  appState.plants.forEach(p => {
    if (appState.batchSelectedIds.has(p.id)) {
      codes.forEach(code => applyMaterialUsage(p, code, today));
      count++;
    }
  });
  try {
    await saveToDB();
  } catch (err) {
    renderApp();
    return;
  }
  const names = codes.map(c => MATERIAL_DEFS[c]?.label).filter(Boolean).join('・');
  showToast(`🧪 ${count}株に「${names}」を一括記録しました`);
  setBatchMode(false);
}

/********************************************************************
- 7. PLANT DETAIL & GROWTH COMPARISON MODAL
 ********************************************************************/
function openDetailModal(plantId) {
  appState.activeDetailPlantId = plantId;
  cancelEditGrowthLog();
  populateDetailModal(plantId);
  document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetailModal() {
  appState.activeDetailPlantId = null;
  document.getElementById('detailModal').classList.add('hidden');
}

function populateDetailModal(plantId) {
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant) return;

  const svgInfo = BOTANICAL_SVGS[plant.svgType] || BOTANICAL_SVGS.agave;
  appendBotanicalSvg(document.getElementById('detailSvgBadge'), svgInfo.svg);
  document.getElementById('detailLocationBadge').textContent = plant.location || '場所未設定';
  const statusEl = document.getElementById('detailStatusBadge');
  const stKey = plant.status && PLANT_STATUSES[plant.status] ? plant.status : 'normal';
  if (statusEl) {
    if (stKey !== 'normal') {
      const stInfo = PLANT_STATUSES[stKey];
      statusEl.className = `marker-badge font-bold shrink-0 ${stInfo.badgeClass}`;
      statusEl.textContent = stInfo.label;
    } else {
      statusEl.className = 'hidden marker-badge font-bold shrink-0';
      statusEl.textContent = '';
    }
  }
  document.getElementById('detailPlantName').textContent = plant.name;

  const daysOwned = plant.purchaseDate ? calcDaysBetween(plant.purchaseDate) : null;
  document.getElementById('detailDaysOwnedBadge').textContent =
    daysOwned !== null && daysOwned >= 0 ? `お迎えから ${daysOwned}日目` : '';

  QUICK_CARE_CARDS.forEach(card => {
    const careDate = plant[card.careType];
    const daysAgo = careDate ? calcDaysBetween(careDate) : null;
    const text = careDate ? `${careDate} (${daysAgo === 0 ? '今日' : `${daysAgo}日前`})` : '未記録';

    const boxEl = document.getElementById(card.boxId);
    if (boxEl) boxEl.textContent = text;

    if (card.subId) {
      const subEl = document.getElementById(card.subId);
      if (subEl) subEl.textContent = card.formatSub(plant);
    }
  });

  SPEC_DEFINITIONS.forEach(spec => {
    const specEl = document.getElementById(spec.id);
    if (!specEl) return;
    specEl.textContent = spec.formatValue ? spec.formatValue(plant) : (plant[spec.key] || '未設定');
  });

  const notesBox = document.getElementById('specNotesBox');
  if (plant.notes) {
    notesBox.classList.remove('hidden');
    document.getElementById('specNotes').textContent = plant.notes;
  } else {
    notesBox.classList.add('hidden');
  }

const todayStr = getTodayStr();
  const waterBtnEl = document.getElementById('detailQuickWaterBtn');
  if (waterBtnEl) {
    const done = plant.lastWatered === todayStr;
    waterBtnEl.textContent = done ? '今日済 (取消)' : '今日記録';
    waterBtnEl.className = done
      ? 'ui-btn ui-sm bg-white text-sky-700 border-sky-300 hover:bg-sky-50 font-semibold transition shrink-0 cursor-pointer'
      : 'ui-btn ui-sm border-transparent bg-sky-600 text-white hover:bg-sky-700 font-semibold transition shrink-0 cursor-pointer';
  }
  const repotBtnEl = document.getElementById('detailQuickRepotBtn');
  if (repotBtnEl) {
    const done = plant.lastRepotted === todayStr;
    repotBtnEl.textContent = done ? '今日済 (取消)' : '今日記録';
    repotBtnEl.className = done
      ? 'ui-btn ui-sm bg-white text-amber-800 border-amber-300 hover:bg-amber-50 font-semibold transition shrink-0 cursor-pointer'
      : 'ui-btn ui-sm border-transparent bg-amber-600 text-white hover:bg-amber-700 font-semibold transition shrink-0 cursor-pointer';
  }

  const matContainer = document.getElementById('detailMaterialsContainer');
  if (matContainer) {
    matContainer.replaceChildren();
    const matLogs = plant.materialLogs || {};
    const autoList = Array.isArray(plant.materialAutoLog) ? plant.materialAutoLog : [];

    const groups = [
      { key: 'water', title: '水やり兼用（最終水やり日も更新）' },
      { key: 'solid', title: '固形肥料・薬剤（水やり日とは独立）' }
    ];

    groups.forEach(grp => {
      const entries = Object.entries(MATERIAL_DEFS).filter(([, def]) => def.group === grp.key);
      if (!entries.length) return;
      const section = createElement('div', 'space-y-1.5');
      section.appendChild(createElement('p', 'text-[10px] font-semibold text-gray-500', grp.title));
      const row = createElement('div', 'flex flex-wrap gap-1.5');

      entries.forEach(([code, def]) => {
        const lastDate = matLogs[code];
        const days = lastDate ? calcDaysBetween(lastDate) : null;
        const isToday = lastDate === todayStr;
        const dateLabel = isToday ? '今日済' : (lastDate ? `${days}日前` : '未記録');
        const isAuto = autoList.includes(code);

        const chip = createElement(
          'button',
          `ui-btn ui-sm font-medium transition cursor-pointer ${
            isToday
              ? (def.updatesWatered ? 'bg-sky-600 text-white border-sky-600 shadow-2xs' : 'bg-sage-600 text-white border-sage-600 shadow-2xs')
              : (def.updatesWatered
                  ? 'bg-white hover:bg-sky-50 text-sky-800 border-sky-200'
                  : 'bg-white hover:bg-sage-100/70 text-charcoal border-stoneborder')
          }`
        );
        chip.type = 'button';
        chip.title = isToday ? `${def.label}の今日の記録を取り消す` : `${def.label}を今日使用として記録`;
        if (isToday) {
          chip.appendChild(createLucideIcon('check', 'w-3 h-3 text-white block shrink-0'));
        } else if (isAuto) {
          const icon = createLucideIcon('file-check', 'w-3 h-3 text-sage-600 block shrink-0');
          icon.setAttribute('aria-label', '自動記録ON');
          chip.appendChild(icon);
        }
        chip.append(
          createElement('span', 'font-semibold leading-none', def.label),
          createElement('span', `text-[10px] leading-none ${isToday ? 'text-white/90' : 'text-gray-400'}`, dateLabel)
        );
        chip.addEventListener('click', () => recordMaterialUsage(plant.id, code));
        row.appendChild(chip);
      });

      section.appendChild(row);
      matContainer.appendChild(section);
    });
  }

  const logs = getSortedGrowthLogs(plant);
  const photoLogs = logs.filter(g => getLogPhotos(g).length > 0);
  document.getElementById('growthCountBadge').textContent = `(${logs.length}件)`;

  const compSec = document.getElementById('growthComparisonSection');
  if (photoLogs.length >= 2) {
    compSec.classList.remove('hidden');
    const first = photoLogs[0];
    const latest = photoLogs[photoLogs.length - 1];

    const firstImg = document.getElementById('compareFirstImg');
    firstImg.src = getLogPhotos(first)[0];
    firstImg.dataset.caption = `BEFORE (${first.date}) ${first.note || ''}`.trim();
    document.getElementById('compareFirstDate').textContent = first.date;
    document.getElementById('compareFirstNote').textContent = first.note || '初回記録';

    const latestPhotos = getLogPhotos(latest);
    const latestImg = document.getElementById('compareLatestImg');
    latestImg.src = latestPhotos[latestPhotos.length - 1];
    latestImg.dataset.caption = `NOW (${latest.date}) ${latest.note || ''}`.trim();
    document.getElementById('compareLatestDate').textContent = latest.date;
    document.getElementById('compareLatestNote').textContent = latest.note || '最新記録';

    const diffDays = calcDaysBetween(first.date, latest.date);
    document.getElementById('comparisonSpanBadge').textContent =
      diffDays !== null && diffDays > 0 ? `${diffDays}日間` : '成長記録比較';
  } else {
    compSec.classList.add('hidden');
  }

  const timelineGrid = document.getElementById('growthTimelineGrid');
  const reversed = [...logs].reverse();
  timelineGrid.replaceChildren();

  if (reversed.length === 0) {
    timelineGrid.appendChild(createElement(
      'div',
      'py-8 text-center text-xs text-gray-400 border border-dashed border-stoneborder rounded-2xl',
      'まだ育成ログがありません。上のフォームから写真やひとことメモを記録してみましょう。'
    ));
    return;
  }

  let lastYear = null;
  reversed.forEach((entry, idx) => {
    const isLast = idx === reversed.length - 1;
    const tagInfo = LOG_TAGS[entry.tag] || LOG_TAGS.growth;

    const dateStr = entry.date || '';
    const parts = dateStr.split('-');
    const year = parts.length === 3 ? parts[0] : '';
    const shortDate = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : dateStr;

    if (year && year !== lastYear) {
      const yearDivider = createElement('div', `flex items-center gap-2.5 ${idx === 0 ? 'mb-3' : 'mt-1 mb-3'}`);
      yearDivider.append(
        createElement('span', 'h-px flex-1 bg-stoneborder/80'),
        createElement('span', 'px-2.5 py-0.5 rounded-full bg-canvas border border-stoneborder text-[11px] font-bold text-sage-700 tabular-nums', `${year}年`),
        createElement('span', 'h-px flex-1 bg-stoneborder/80')
      );
      timelineGrid.appendChild(yearDivider);
      lastYear = year;
    }

    const nextDateParts = reversed[idx + 1]?.date ? reversed[idx + 1].date.split('-') : [];
    const nextYear = nextDateParts.length === 3 ? nextDateParts[0] : '';
    const isYearLast = isLast || (year && nextYear && year !== nextYear);

    const row = createElement('div', 'flex items-stretch group');

    // Left: Date (M/D)
    const dateCol = createElement(
      'div',
      'w-10 sm:w-11 shrink-0 text-[11px] font-semibold text-gray-500 pt-1 pr-2 text-right tabular-nums',
      shortDate
    );

    // Center: Dot & Vertical Line
    const axisCol = createElement('div', 'flex flex-col items-center shrink-0');
    axisCol.appendChild(createElement('span', 'w-2.5 h-2.5 rounded-full bg-sage-500 ring-4 ring-white mt-1.5 shrink-0 z-10'));
    if (!isYearLast) {
      axisCol.appendChild(createElement('span', 'w-px flex-1 bg-stoneborder my-0.5'));
    }

    // Right: Content
    const contentCol = createElement('div', `flex-1 min-w-0 pl-3 ${isLast ? 'pb-1' : 'pb-5'}`);
    const headerRow = createElement('div', 'flex items-center justify-between gap-2');
    const tagBadge = createElement('span', `inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${tagInfo.badgeClass}`, tagInfo.label);

    const controlsWrap = createElement('div', 'flex items-center gap-1 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition shrink-0');
    const editButton = createElement('button', 'p-1 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50');
    editButton.type = 'button';
    editButton.title = 'この記録を編集';
    editButton.appendChild(createLucideIcon('pencil', 'w-3.5 h-3.5'));
    editButton.addEventListener('click', () => editGrowthLogEntry(plant.id, entry.id));

    const deleteButton = createElement('button', 'p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50');
    deleteButton.type = 'button';
    deleteButton.title = 'この記録を削除';
    deleteButton.appendChild(createLucideIcon('trash-2', 'w-3.5 h-3.5'));
    deleteButton.addEventListener('click', () => deleteGrowthLogEntry(plant.id, entry.id));

    controlsWrap.append(editButton, deleteButton);
    headerRow.append(tagBadge, controlsWrap);
    contentCol.appendChild(headerRow);

    if (entry.note) {
      contentCol.appendChild(createElement('p', 'text-xs text-charcoal mt-1 whitespace-pre-line leading-relaxed', entry.note));
    }

    const photos = getLogPhotos(entry);
    if (photos.length > 0) {
      const imgWrap = createElement('div', photos.length === 1 ? 'mt-2' : 'mt-2 flex flex-wrap gap-1.5');
      const thumbSize = photos.length === 1 ? 'w-28 h-28 sm:w-32 sm:h-32' : 'w-20 h-20 sm:w-24 sm:h-24';
      photos.forEach((src, photoIdx) => {
        const image = createElement('img', `${thumbSize} rounded-xl object-cover border border-stoneborder cursor-zoom-in shadow-2xs`);
        image.src = src;
        image.alt = 'Growth log';
        image.dataset.action = 'viewImageFullscreen';
        const suffix = photos.length > 1 ? ` (${photoIdx + 1}/${photos.length})` : '';
        image.dataset.caption = `${entry.date || ''} [${tagInfo.label}]${suffix} ${entry.note || ''}`.trim();
        imgWrap.appendChild(image);
      });
      contentCol.appendChild(imgWrap);
    }

    row.append(dateCol, axisCol, contentCol);
    timelineGrid.appendChild(row);
  });
}

function renderPhotoPreviewList(listEl, photos, onRemove) {
  listEl.replaceChildren();
  photos.forEach((src, idx) => {
    const wrap = createElement('div', 'relative w-14 h-14 shrink-0');
    const img = createElement('img', 'w-full h-full rounded-lg object-cover border border-stoneborder');
    img.src = src;
    const removeBtn = createElement('button', 'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-charcoal/80 hover:bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs cursor-pointer', '×');
    removeBtn.type = 'button';
    removeBtn.title = 'この写真を外す';
    removeBtn.addEventListener('click', () => onRemove(idx));
    wrap.append(img, removeBtn);
    listEl.appendChild(wrap);
  });
}

function updateGrowthPhotoPreviewUI() {
  const photos = appState.tempGrowthPhotos;
  const box = document.getElementById('newGrowthPreviewBox');
  const list = document.getElementById('newGrowthPreviewList');
  const info = document.getElementById('newGrowthSizeInfo');
  const label = document.getElementById('newGrowthPhotoLabel');

  if (photos.length === 0) {
    box.classList.add('hidden');
    list.replaceChildren();
    label.textContent = `写真を追加（最大${MAX_PHOTOS_PER_LOG}枚）`;
    return;
  }

  box.classList.remove('hidden');
  info.textContent = `${photos.length} / ${MAX_PHOTOS_PER_LOG}枚 選択中（軽量化完了）`;
  label.textContent = photos.length >= MAX_PHOTOS_PER_LOG ? `上限(${MAX_PHOTOS_PER_LOG}枚)` : `さらに追加 (${photos.length}/${MAX_PHOTOS_PER_LOG})`;
  renderPhotoPreviewList(list, photos, idx => {
    appState.tempGrowthPhotos.splice(idx, 1);
    updateGrowthPhotoPreviewUI();
  });
}

async function previewGrowthPhoto(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;

  const remain = MAX_PHOTOS_PER_LOG - appState.tempGrowthPhotos.length;
  if (remain <= 0) {
    showToast(`写真は1投稿あたり最大${MAX_PHOTOS_PER_LOG}枚までです`);
    return;
  }
  const selectionId = appState.growthPhotoSelectionId;
  const targets = files.slice(0, remain);
  if (files.length > remain) {
    showToast(`最大${MAX_PHOTOS_PER_LOG}枚までのため、先頭${remain}枚を読み込みます`);
  }

  for (const file of targets) {
    try {
      const { dataUrl } = await compressImageFile(file);
      if (selectionId !== appState.growthPhotoSelectionId) return;
      if (appState.tempGrowthPhotos.length >= MAX_PHOTOS_PER_LOG) {
        showToast(`写真は1投稿あたり最大${MAX_PHOTOS_PER_LOG}枚までです`);
        break;
      }
      appState.tempGrowthPhotos.push(dataUrl);
    } catch (e) {
      if (selectionId !== appState.growthPhotoSelectionId) return;
      showToast('一部の画像の読み込みに失敗しました');
    }
  }
  updateGrowthPhotoPreviewUI();
}

function clearNewGrowthPhoto() {
  appState.growthPhotoSelectionId++;
  appState.tempGrowthPhotos = [];
  const input = document.getElementById('newGrowthPhotoInput');
  if (input) input.value = '';
  updateGrowthPhotoPreviewUI();
}

function editGrowthLogEntry(plantId, logId) {
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant || !Array.isArray(plant.growthLogs)) return;
  const log = plant.growthLogs.find(g => g.id === logId);
  if (!log) return;

  document.getElementById('editGrowthLogId').value = log.id;
  document.getElementById('newGrowthTagInput').value = LOG_TAGS[log.tag] ? log.tag : 'growth';
  document.getElementById('newGrowthDateInput').value = log.date || getTodayStr();
  document.getElementById('newGrowthNoteInput').value = log.note || '';

  appState.tempGrowthPhotos = [...getLogPhotos(log)];
  updateGrowthPhotoPreviewUI();

  const addBtn = document.getElementById('addGrowthLogBtn');
  addBtn.textContent = '更新';
  addBtn.classList.remove('bg-sage-600', 'hover:bg-sage-700');
  addBtn.classList.add('bg-amber-600', 'hover:bg-amber-700');

  document.getElementById('cancelEditGrowthLogBtn').classList.remove('hidden');
  document.getElementById('growthAlbumTitle').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditGrowthLog() {
  clearNewGrowthPhoto();
  document.getElementById('newGrowthTagInput').value = 'growth';
  document.getElementById('newGrowthDateInput').value = getTodayStr();
  document.getElementById('newGrowthNoteInput').value = '';
  document.getElementById('editGrowthLogId').value = '';

  const addBtn = document.getElementById('addGrowthLogBtn');
  addBtn.textContent = '追加';
  addBtn.classList.remove('bg-amber-600', 'hover:bg-amber-700');
  addBtn.classList.add('bg-sage-600', 'hover:bg-sage-700');

  document.getElementById('cancelEditGrowthLogBtn').classList.add('hidden');
}

async function addGrowthLogEntry() {
  if (!canEditData()) return;
  const addBtn = document.getElementById('addGrowthLogBtn');
  await runWithButtonDisabled(addBtn, async () => {
    const plantId = appState.activeDetailPlantId;
    const plant = appState.plants.find(p => p.id === plantId);
    if (!plant) return;

    const tagVal = document.getElementById('newGrowthTagInput').value || 'growth';
    const dateVal = document.getElementById('newGrowthDateInput').value || getTodayStr();
    const noteVal = document.getElementById('newGrowthNoteInput').value.trim();
    const editLogId = document.getElementById('editGrowthLogId').value;

    if (appState.tempGrowthPhotos.length === 0 && !noteVal) {
      showToast('写真またはひとことメモを入力してください');
      return;
    }

    if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];

    let successMessage;
    if (editLogId) {
      const logIndex = plant.growthLogs.findIndex(g => g.id === editLogId);
      if (logIndex === -1) {
        showToast('更新する育成ログが見つかりません');
        return;
      }
      plant.growthLogs[logIndex] = {
        id: editLogId,
        tag: tagVal,
        date: dateVal,
        photos: [...appState.tempGrowthPhotos],
        photoDataUrl: '',
        note: noteVal
      };
      if (tagVal === 'repot') updateRepottedFromLog(plant, dateVal);
      successMessage = '📝 育成ログを更新しました';
    } else {
      const newLogId = createId('g');
      plant.growthLogs.push({
        id: newLogId,
        tag: tagVal,
        date: dateVal,
        photos: [...appState.tempGrowthPhotos],
        photoDataUrl: '',
        note: noteVal
      });
      if (tagVal === 'repot') updateRepottedFromLog(plant, dateVal);
      document.getElementById('editGrowthLogId').value = newLogId;
      successMessage = '📝 育成ログを追加しました';
    }

    try {
      await saveToDB();
    } catch (err) {
      populateDetailModal(plantId);
      renderApp();
      return;
    }

    cancelEditGrowthLog();
    populateDetailModal(plantId);
    renderApp();
    showToast(successMessage);
  });
}

function updateQuickLogPhotoPreviewUI() {
  const photos = appState.tempQuickLogPhotos;
  const wrap = document.getElementById('quickLogPreviewWrap');
  const list = document.getElementById('quickLogPreviewList');
  const count = document.getElementById('quickLogPhotoCount');
  const label = document.getElementById('quickLogPhotoLabel');

  if (photos.length === 0) {
    wrap.classList.add('hidden');
    list.replaceChildren();
    label.textContent = `写真を選択（最大${MAX_PHOTOS_PER_LOG}枚）`;
    return;
  }

  wrap.classList.remove('hidden');
  count.textContent = `${photos.length} / ${MAX_PHOTOS_PER_LOG}枚 選択中`;
  label.textContent = photos.length >= MAX_PHOTOS_PER_LOG ? `上限(${MAX_PHOTOS_PER_LOG}枚)` : `さらに追加 (${photos.length}/${MAX_PHOTOS_PER_LOG})`;
  renderPhotoPreviewList(list, photos, idx => {
    appState.tempQuickLogPhotos.splice(idx, 1);
    updateQuickLogPhotoPreviewUI();
  });
}

function openFilterModal() {
  const modal = document.getElementById('filterModal');
  if (modal) modal.classList.remove('hidden');
}

function closeFilterModal() {
  const modal = document.getElementById('filterModal');
  if (modal) modal.classList.add('hidden');
  updateActiveFilterDot();
}

function updateActiveFilterDot() {
  const dot = document.getElementById('activeFilterDot');
  if (!dot) return;
  const searchVal = (document.getElementById('searchInput')?.value || '').trim();
  const sortVal = document.getElementById('sortSelect')?.value || 'water_priority';
  const statusVal = document.getElementById('statusFilterSelect')?.value || 'all';
  const isActive = Boolean(searchVal) || sortVal !== 'water_priority' || statusVal !== 'all';
  dot.classList.toggle('hidden', !isActive);
}

function openQuickLogModal(plantId) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant) return;
  appState.activeQuickLogPlantId = plantId;
  clearQuickLogPhoto();
  document.getElementById('quickLogPlantName').textContent = plant.name;
  document.getElementById('quickLogTagInput').value = 'growth';
  document.getElementById('quickLogDateInput').value = getTodayStr();
  document.getElementById('quickLogNoteInput').value = '';
  document.getElementById('quickLogModal').classList.remove('hidden');
}

function closeQuickLogModal() {
  appState.activeQuickLogPlantId = null;
  clearQuickLogPhoto();
  document.getElementById('quickLogModal').classList.add('hidden');
}

async function previewQuickLogPhoto(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;

  const remain = MAX_PHOTOS_PER_LOG - appState.tempQuickLogPhotos.length;
  if (remain <= 0) {
    showToast(`写真は1投稿あたり最大${MAX_PHOTOS_PER_LOG}枚までです`);
    return;
  }
  const selectionId = appState.quickLogPhotoSelectionId;
  const targets = files.slice(0, remain);
  if (files.length > remain) {
    showToast(`最大${MAX_PHOTOS_PER_LOG}枚までのため、先頭${remain}枚を読み込みます`);
  }

  for (const file of targets) {
    try {
      const { dataUrl } = await compressImageFile(file);
      if (selectionId !== appState.quickLogPhotoSelectionId) return;
      if (appState.tempQuickLogPhotos.length >= MAX_PHOTOS_PER_LOG) {
        showToast(`写真は1投稿あたり最大${MAX_PHOTOS_PER_LOG}枚までです`);
        break;
      }
      appState.tempQuickLogPhotos.push(dataUrl);
    } catch (e) {
      if (selectionId !== appState.quickLogPhotoSelectionId) return;
      showToast('一部の画像の読み込みに失敗しました');
    }
  }
  updateQuickLogPhotoPreviewUI();
}

function clearQuickLogPhoto() {
  appState.quickLogPhotoSelectionId++;
  appState.tempQuickLogPhotos = [];
  const input = document.getElementById('quickLogPhotoInput');
  if (input) input.value = '';
  updateQuickLogPhotoPreviewUI();
}

async function submitQuickLog() {
  if (!canEditData()) return;
  const submitBtn = document.getElementById('submitQuickLogBtn');
  await runWithButtonDisabled(submitBtn, async () => {
    const plantId = appState.activeQuickLogPlantId;
    const plant = appState.plants.find(p => p.id === plantId);
    if (!plant) return;

    const tagVal = document.getElementById('quickLogTagInput').value || 'growth';
    const dateVal = document.getElementById('quickLogDateInput').value || getTodayStr();
    const noteVal = document.getElementById('quickLogNoteInput').value.trim();

    if (appState.tempQuickLogPhotos.length === 0 && !noteVal) {
      showToast('写真またはひとことメモを入力してください');
      return;
    }

    if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];
    plant.growthLogs.push({
      id: createId('g'),
      tag: tagVal,
      date: dateVal,
      photos: [...appState.tempQuickLogPhotos],
      photoDataUrl: '',
      note: noteVal
    });
    if (tagVal === 'repot') updateRepottedFromLog(plant, dateVal);

    try {
      await saveToDB();
    } catch (err) {
      renderApp();
      return;
    }

    const existingCard = document.getElementById(`card_${plantId}`);
    if (existingCard) {
      existingCard.replaceWith(createPlantCard(plant));
    } else {
      renderApp();
    }
    closeQuickLogModal();
    showToast(`📝 「${plant.name}」に記録を追加しました`);
  });
}

async function deleteGrowthLogEntry(plantId, logId) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant || !Array.isArray(plant.growthLogs)) return;

  openConfirmDialog('育成ログの削除', 'この育成ログを削除しますか？', async () => {
    if (!canEditData()) return;
    plant.growthLogs = plant.growthLogs.filter(g => g.id !== logId);
    if (document.getElementById('editGrowthLogId').value === logId) {
      cancelEditGrowthLog();
    }
    try {
      await saveToDB();
    } catch (err) {
      populateDetailModal(plantId);
      renderApp();
      return;
    }
    populateDetailModal(plantId);
    renderApp();
    showToast('育成ログを削除しました');
  });
}

/********************************************************************
- 8. ADD / EDIT PLANT FORM MODAL
 ********************************************************************/
function renderSvgSelector() {
  const grid = document.getElementById('svgSelectorGrid');
  const buttons = Object.entries(BOTANICAL_SVGS).map(([key, item]) => {
    const active = appState.selectedFormSvgType === key;
    const button = createElement('button', `p-2 rounded-xl border flex flex-col items-center gap-1 transition cursor-pointer ${
      active ? 'border-sage-600 bg-sage-50 ring-2 ring-sage-500/20' : 'border-stoneborder bg-white hover:bg-gray-50'
    }`);
    button.type = 'button';
    button.addEventListener('click', () => selectFormSvg(key));
    const illustration = createElement('div', 'w-9 h-9');
    appendBotanicalSvg(illustration, item.svg);
    button.append(illustration, createElement('span', 'text-[10px] font-medium text-charcoal text-center leading-tight', item.label));
    return button;
  });
  grid.replaceChildren(...buttons);
}

function selectFormSvg(typeKey) {
  appState.selectedFormSvgType = typeKey;
  renderSvgSelector();
}

function renderFormMaterialAutoLogGrid(selectedCodes = []) {
  const grid = document.getElementById('formMaterialAutoLogGrid');
  if (!grid) return;
  const selectedSet = new Set(selectedCodes);
  grid.replaceChildren();
  Object.entries(MATERIAL_DEFS).forEach(([code, def]) => {
    const label = createElement('label', 'ui-btn ui-sm border-stoneborder bg-white hover:bg-sage-50 cursor-pointer select-none');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = code;
    cb.name = 'materialAutoLog';
    cb.checked = selectedSet.has(code);
    cb.className = 'accent-sage-600 cursor-pointer';
    label.append(cb, createElement('span', 'text-charcoal', def.label));
    grid.appendChild(label);
  });
}

function openPlantFormModal(editPlantId = null) {
  const form = document.getElementById('plantForm');
  form.reset();
  clearFormPhoto();

  const isEdit = typeof editPlantId === 'string' && editPlantId.length > 0;
  if (isEdit) {
    const p = appState.plants.find(x => x.id === editPlantId);
    if (!p) return;
    setPlantFormTitle('pencil', `「${p.name}」を編集`);
    document.getElementById('formPlantId').value = p.id;
    document.getElementById('formName').value = p.name || '';
    appState.selectedFormSvgType = p.svgType || 'agave';
    document.getElementById('formLocation').value = p.location || '';
    document.getElementById('formSoil').value = p.soil || '';
    document.getElementById('formLight').value = p.lightLevel || '';
    document.getElementById('formWaterInterval').value = p.waterIntervalDays || '';
    document.getElementById('formWaterMethod').value = p.waterMethod || '通常水やり';
    document.getElementById('formPurchaseDate').value = p.purchaseDate || '';
    document.getElementById('formPrice').value = p.price ?? '';
    document.getElementById('formShop').value = p.shop || '';
    document.getElementById('formNotes').value = p.notes || '';
    document.getElementById('formStatus').value = PLANT_STATUSES[p.status] ? p.status : 'normal';
    document.getElementById('formMaterialAutoLogWrap')?.classList.remove('hidden');
    renderFormMaterialAutoLogGrid(Array.isArray(p.materialAutoLog) ? p.materialAutoLog : []);
  } else {
    setPlantFormTitle('sprout', '新しい株を追加');
    document.getElementById('formPlantId').value = '';
    appState.selectedFormSvgType = 'agave';
    document.getElementById('formPurchaseDate').value = getTodayStr();
    document.getElementById('formStatus').value = 'normal';
    document.getElementById('formMaterialAutoLogWrap')?.classList.add('hidden');
    renderFormMaterialAutoLogGrid([]);
    if (appState.selectedLocation !== 'すべて' && appState.selectedLocation !== '未設定') {
      document.getElementById('formLocation').value = appState.selectedLocation;
    }
  }

  renderSvgSelector();
  document.getElementById('formModal').classList.remove('hidden');
}

function setPlantFormTitle(iconName, title) {
  const heading = document.getElementById('formModalTitle');
  heading.replaceChildren(
    createLucideIcon(iconName, 'w-5 h-5 text-sage-600'),
    createElement('span', '', title)
  );
}

function closePlantFormModal() {
  document.getElementById('formModal').classList.add('hidden');
  const returnId = appState.returnToDetailPlantId;
  appState.returnToDetailPlantId = null;
  if (returnId && appState.plants.some(p => p.id === returnId)) {
    openDetailModal(returnId);
  }
}

async function handleFormPhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { dataUrl, approxKB } = await compressImageFile(file);
    appState.tempFormPhotoDataUrl = dataUrl;
    document.getElementById('formPhotoPreview').src = dataUrl;
    document.getElementById('formPhotoSizeBadge').textContent = `約${approxKB}KBに自動圧縮済`;
    document.getElementById('formPhotoPreviewWrap').classList.remove('hidden');
  } catch (e) {
    showToast('画像の圧縮に失敗しました');
  }
}

function clearFormPhoto() {
  appState.tempFormPhotoDataUrl = null;
  document.getElementById('formPhotoInput').value = '';
  document.getElementById('formPhotoPreviewWrap').classList.add('hidden');
}

async function savePlantForm(event) {
  event.preventDefault();
  if (!canEditData()) return;
  const submitBtn = event.submitter || event.target.querySelector('button[type="submit"]');

  await runWithButtonDisabled(submitBtn, async () => {
    const id = document.getElementById('formPlantId').value;
    const name = document.getElementById('formName').value.trim();
    if (!name) return;

    const location = document.getElementById('formLocation').value.trim() || '未設定';
    const soil = document.getElementById('formSoil').value.trim();
    const lightLevel = document.getElementById('formLight').value.trim();
    const waterIntervalDays = document.getElementById('formWaterInterval').value
      ? Number(document.getElementById('formWaterInterval').value)
      : null;
    const waterMethod = document.getElementById('formWaterMethod').value;
    const purchaseDate = document.getElementById('formPurchaseDate').value;
    const price = document.getElementById('formPrice').value ? Number(document.getElementById('formPrice').value) : null;
    const shop = document.getElementById('formShop').value.trim();
    const notes = document.getElementById('formNotes').value.trim();
    const status = PLANT_STATUSES[document.getElementById('formStatus').value]
      ? document.getElementById('formStatus').value
      : 'normal';
    const materialAutoLog = Array.from(document.querySelectorAll('input[name="materialAutoLog"]:checked'))
      .map(el => el.value)
      .filter(code => Object.prototype.hasOwnProperty.call(MATERIAL_DEFS, code));

    if (id) {
      const plant = appState.plants.find(p => p.id === id);
      if (!plant) {
        showToast('更新する株が見つかりません');
        return;
      }
      const prevLocation = plant.location || '未設定';
      const prevSoil = plant.soil || '';
      const prevStatus = PLANT_STATUSES[plant.status] ? plant.status : 'normal';
      const autoChanges = [];
      if (prevLocation !== location) autoChanges.push(`場所: ${prevLocation} → ${location}`);
      if (prevSoil !== soil) autoChanges.push(`用土: ${prevSoil || '未設定'} → ${soil || '未設定'}`);
      if (prevStatus !== status) {
        autoChanges.push(`状態: ${PLANT_STATUSES[prevStatus].label} → ${PLANT_STATUSES[status].label}`);
      }

      Object.assign(plant, {
        name,
        svgType: appState.selectedFormSvgType,
        location,
        soil,
        lightLevel,
        waterIntervalDays,
        waterMethod,
        purchaseDate,
        price,
        shop,
        notes,
        status,
        materialAutoLog
      });
      if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];
      if (autoChanges.length > 0) {
        const today = getTodayStr();
        const isSoilChanged = prevSoil !== soil;
        plant.growthLogs.push({
          id: createId('g'),
          tag: isSoilChanged ? 'repot' : (prevStatus !== status ? 'status' : 'move'),
          date: today,
          photos: [],
          photoDataUrl: '',
          note: autoChanges.join('\n').slice(0, 1000)
        });
        if (isSoilChanged) updateRepottedFromLog(plant, today);
      }
      if (appState.tempFormPhotoDataUrl) {
        plant.growthLogs.push({
          id: createId('g'),
          tag: 'growth',
          date: getTodayStr(),
          photos: [appState.tempFormPhotoDataUrl],
          photoDataUrl: '',
          note: '写真追加'
        });
      }
    } else {
      const newPlant = {
        id: createId('p'),
        name,
        svgType: appState.selectedFormSvgType,
        location,
        soil,
        lightLevel,
        waterIntervalDays,
        waterMethod,
        purchaseDate,
        price,
        shop,
        notes,
        status,
        materialLogs: {},
        materialAutoLog,
        lastWatered: null,
        lastFertilized: null,
        lastRepotted: purchaseDate || getTodayStr(),
        growthLogs: []
      };
      if (appState.tempFormPhotoDataUrl) {
        newPlant.growthLogs.push({
          id: createId('g'),
          tag: 'growth',
          date: purchaseDate || getTodayStr(),
          photos: [appState.tempFormPhotoDataUrl],
          photoDataUrl: '',
          note: 'お迎え・初回記録'
        });
      }
      appState.plants.unshift(newPlant);
      document.getElementById('formPlantId').value = newPlant.id;
    }

    if (appState.tempFormPhotoDataUrl) clearFormPhoto();

    try {
      await saveToDB();
    } catch (err) {
      renderApp();
      return;
    }

    if (appState.selectedLocation !== 'すべて' && appState.selectedLocation !== location) {
      appState.selectedLocation = 'すべて';
    }
    appState.onlyNeedsWater = false;

    closePlantFormModal();
    renderApp();
    showToast(id ? `🌿 「${name}」の情報を更新しました` : `🌱 「${name}」をコレクションに追加しました`);
  });
}

function confirmDeletePlant(plantId) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant) return;
  openConfirmDialog(
    '株データの削除',
    `「${plant.name}」と、その成長アルバム写真をすべて削除しますか？`,
    async () => {
      if (!canEditData()) return;
      appState.plants = appState.plants.filter(p => p.id !== plantId);
      try {
        await saveToDB();
      } catch (err) {
        closeDetailModal();
        renderApp();
        return;
      }
      closeDetailModal();
      renderApp();
      showToast(`「${plant.name}」を削除しました`);
    }
  );
}

/********************************************************************
- 9. JSON EXPORT & IMPORT (SIMPLE VALIDATION)
 ********************************************************************/
function createExportJSON(plants) {
  const validPlants = validatePlantRecords(plants);
  return JSON.stringify({
    appName: APP_NAME,
    version: '1.0',
    exportedAt: new Date().toISOString(),
    plantCount: validPlants.length,
    plants: validPlants
  }, null, 2);
}

function exportData() {
  if (appState.dbLoadError) {
    showToast('保存データを読み込めなかったためJSONに書き出せません', true);
    return;
  }
  let jsonStr;
  try {
    jsonStr = createExportJSON(appState.plants);
  } catch (err) {
    showToast(`JSONを書き出せません: ${err.message}`, true);
    return;
  }
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verdure_plants_${getTodayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('📦 写真を含む全データをJSONに書き出しました');
}

function triggerImport() {
  document.getElementById('importFileInput').value = '';
  document.getElementById('importFileInput').click();
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showToast('JSONファイルが大きすぎます（上限1GB）');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed) && parsed?.appName != null && parsed.appName !== APP_NAME) {
        throw new Error('VERDUREのバックアップではありません');
      }
      const importedPlants = validatePlantRecords(Array.isArray(parsed) ? parsed : parsed?.plants);
      openConfirmDialog(
        'データの読み込み（復元）',
        `JSONファイルから ${importedPlants.length}株 のデータ（成長写真を含む）を読み込み、現在のデータを上書きしますか？`,
        async () => {
          const importBtn = document.querySelector('[data-action="triggerImport"]');
          await runWithButtonDisabled(importBtn, async () => {
            try {
              await saveToDB(importedPlants, true);
            } catch (err) {
              return;
            }
            appState.plants = importedPlants;
            appState.selectedLocation = 'すべて';
            appState.dbLoadError = false;
            setBatchMode(false);
            showToast(`✅ ${importedPlants.length}株のデータを復元しました`);
          });
        }
      );
    } catch (err) {
      showToast(err instanceof SyntaxError
        ? `JSONの形式が正しくありません: ${err.message}`
        : `JSONを読み込めません: ${err.message}`, true);
    }
  };
  reader.onerror = () => showToast(`JSONファイルを読み込めませんでした: ${reader.error?.message || '読み込みエラー'}`, true);
  reader.readAsText(file);
}

function validatePlantRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error('植物データが配列形式ではありません');
  }

  const readStr = (val, label, max) => {
    if (val == null) return '';
    if (typeof val !== 'string' || val.length > max) {
      throw new Error(`${label}は${max}文字以内の文字列にしてください`);
    }
    return val;
  };
  const readDate = (val, label) => {
    const str = readStr(val, label, 10);
    if (str && !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      throw new Error(`${label}はYYYY-MM-DD形式の日付にしてください`);
    }
    return str;
  };
  const readNum = (val, label) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(`${label}は0以上の数値にしてください`);
    }
    return val;
  };
  const readCareUndo = (value, name) => {
    if (value == null) return null;
    const invalid = () => { throw new Error(`${name}のケア取消情報が不正です`); };
    const isObject = val => val && typeof val === 'object' && !Array.isArray(val);
    if (!isObject(value) || !isObject(value.fields) || !isObject(value.materials)) invalid();
    const date = readDate(value.date, `${name}のケア取消情報の日付`);
    if (!date) invalid();
    const fields = {};
    for (const [field, entry] of Object.entries(value.fields)) {
      if (!['lastWatered', 'lastFertilized', 'lastRepotted'].includes(field) ||
          !isObject(entry) || !Array.isArray(entry.sources) || entry.sources.length === 0) invalid();
      const sources = entry.sources.map(source => {
        if (source === 'direct' && field !== 'lastFertilized') return source;
        if (typeof source !== 'string' || !source.startsWith('material:')) invalid();
        const code = source.slice('material:'.length);
        if (!Object.prototype.hasOwnProperty.call(MATERIAL_DEFS, code) ||
            field === 'lastRepotted' ||
            (field === 'lastWatered' && !MATERIAL_DEFS[code].updatesWatered)) invalid();
        return source;
      });
      if (new Set(sources).size !== sources.length) invalid();
      fields[field] = { previous: readDate(entry.previous, `${name}のケア取消前の日付`), sources };
    }
    const materials = {};
    for (const [code, entry] of Object.entries(value.materials)) {
      if (!Object.prototype.hasOwnProperty.call(MATERIAL_DEFS, code) || !isObject(entry)) invalid();
      materials[code] = {
        previous: readDate(entry.previous, `${name}の資材取消前の日付`),
        logId: readStr(entry.logId, `${name}の資材取消対象ログID`, 200)
      };
    }
    return { date, fields, materials };
  };

  return records.map((record, i) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`${i + 1}株目のデータが不正です`);
    }
    const name = readStr(record.name, `${i + 1}株目の植物名`, 200);
    if (!name.trim()) throw new Error(`${i + 1}株目の植物名がありません`);

    const logs = record.growthLogs == null ? [] : record.growthLogs;
    if (!Array.isArray(logs)) throw new Error(`${name}の成長記録が配列ではありません`);

    return {
      id: typeof record.id === 'string' && record.id ? record.id : createId(`p_${i}`),
      name,
      svgType: typeof record.svgType === 'string' && Object.prototype.hasOwnProperty.call(BOTANICAL_SVGS, record.svgType)
        ? record.svgType
        : 'agave',
      location: readStr(record.location, `${name}の置き場所`, 200),
      soil: readStr(record.soil, `${name}の用土`, 300),
      lightLevel: readStr(record.lightLevel, `${name}の光量`, 300),
      waterIntervalDays: readNum(record.waterIntervalDays, `${name}の水やり頻度`),
      waterMethod: readStr(record.waterMethod, `${name}の水やり方法`, 100),
      purchaseDate: readDate(record.purchaseDate, `${name}の購入日`),
      price: readNum(record.price, `${name}の価格`),
      shop: readStr(record.shop, `${name}の購入店`, 300),
      lastWatered: readDate(record.lastWatered, `${name}の水やり日`),
      lastFertilized: readDate(record.lastFertilized, `${name}の活力剤の日`),
      lastRepotted: readDate(record.lastRepotted, `${name}の植え替え日`),
      notes: readStr(record.notes, `${name}の育成メモ`, 5000),
      status: (() => {
        if (record.status == null || record.status === '') return 'normal';
        if (typeof record.status !== 'string' || !Object.prototype.hasOwnProperty.call(PLANT_STATUSES, record.status)) {
          throw new Error(`${name}の育成ステータス(${record.status})が不正です`);
        }
        return record.status;
      })(),
      materialLogs: (() => {
        if (record.materialLogs == null) return {};
        if (typeof record.materialLogs !== 'object' || Array.isArray(record.materialLogs)) {
          throw new Error(`${name}の資材記録が不正です`);
        }
        const out = {};
        Object.entries(record.materialLogs).forEach(([k, v]) => {
          if (!Object.prototype.hasOwnProperty.call(MATERIAL_DEFS, k)) {
            throw new Error(`${name}の資材コード(${k})が不正です`);
          }
          if (v !== null && v !== undefined && v !== '') {
            out[k] = readDate(v, `${name}の資材(${k})使用日`);
          }
        });
        return out;
      })(),
      materialAutoLog: (() => {
        if (record.materialAutoLog == null) return [];
        if (!Array.isArray(record.materialAutoLog)) {
          throw new Error(`${name}の資材自動記録設定が配列ではありません`);
        }
        const out = [];
        record.materialAutoLog.forEach((code, idx) => {
          if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(MATERIAL_DEFS, code)) {
            throw new Error(`${name}の資材自動記録設定(${idx + 1}件目: ${code})が不正です`);
          }
          if (!out.includes(code)) out.push(code);
        });
        return out;
      })(),
      careUndo: readCareUndo(record.careUndo, name),
      growthLogs: logs.map((entry, j) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`${name}の成長記録${j + 1}件目が不正です`);
        }
        const rawPhotos = Array.isArray(entry.photos)
          ? entry.photos
          : (entry.photoDataUrl ? [entry.photoDataUrl] : []);
        if (rawPhotos.length > MAX_PHOTOS_PER_LOG) {
          throw new Error(`${name}の成長記録${j + 1}件目の写真枚数が上限(${MAX_PHOTOS_PER_LOG}枚)を超えています`);
        }
        const photos = rawPhotos.map((src, k) => {
          if (typeof src !== 'string' || !/^data:image\/(?:webp|jpeg|png);base64,/.test(src)) {
            throw new Error(`${name}の成長記録${j + 1}件目の写真${k + 1}枚目の形式が不正です`);
          }
          return src;
        });
        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : createId(`g_${j}`),
          tag: typeof entry.tag === 'string' && Object.prototype.hasOwnProperty.call(LOG_TAGS, entry.tag) ? entry.tag : 'growth',
          date: readDate(entry.date, `${name}の成長記録${j + 1}件目の日付`),
          photos,
          photoDataUrl: '',
          note: readStr(entry.note, `${name}の成長記録${j + 1}件目のメモ`, 1000)
        };
      })
    };
  });
}

/********************************************************************
- 10. FULLSCREEN IMAGE VIEWER (ZOOM & PAN ENGINE)
 ********************************************************************/
const imageViewerState = {
  scale: 1,
  minScale: 1,
  maxScale: 5,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  initialPinchDistance: 0,
  initialPinchScale: 1
};

function applyImageTransform(animate = false) {
  const img = document.getElementById('imageViewerImg');
  const stage = document.getElementById('imageViewerStage');
  const zoomLabel = document.getElementById('imageZoomLevel');
  if (!img || !stage) return;

  if (imageViewerState.scale <= 1) {
    imageViewerState.scale = 1;
    imageViewerState.translateX = 0;
    imageViewerState.translateY = 0;
  }

  img.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
  img.style.transform = `translate3d(${imageViewerState.translateX}px, ${imageViewerState.translateY}px, 0) scale(${imageViewerState.scale})`;
  stage.style.cursor = imageViewerState.scale > 1
    ? (imageViewerState.isDragging ? 'grabbing' : 'grab')
    : 'zoom-in';

  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(imageViewerState.scale * 100)}%`;
  }
}

function setImageZoom(nextScale, animate = true) {
  imageViewerState.scale = Math.min(
    imageViewerState.maxScale,
    Math.max(imageViewerState.minScale, nextScale)
  );
  applyImageTransform(animate);
}

function resetImageZoom() {
  imageViewerState.scale = 1;
  imageViewerState.translateX = 0;
  imageViewerState.translateY = 0;
  imageViewerState.isDragging = false;
  applyImageTransform(true);
}

function viewImageFullscreen(event) {
  const target = event?.target;
  const imgSrc = target?.src;
  if (!imgSrc) return;

  const viewerImg = document.getElementById('imageViewerImg');
  const captionEl = document.getElementById('imageViewerCaption');
  viewerImg.src = imgSrc;

  const caption = target.dataset?.caption || '';
  if (caption) {
    captionEl.textContent = caption;
    captionEl.classList.remove('hidden');
  } else {
    captionEl.textContent = '';
    captionEl.classList.add('hidden');
  }

  resetImageZoom();
  document.getElementById('imageViewerModal').classList.remove('hidden');
}

function closeImageViewer() {
  document.getElementById('imageViewerModal').classList.add('hidden');
  document.getElementById('imageViewerImg').src = '';
  resetImageZoom();
}

function initializeImageViewerEvents() {
  const stage = document.getElementById('imageViewerStage');
  if (!stage) return;

  stage.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (imageViewerState.scale > 1) {
      resetImageZoom();
    } else {
      setImageZoom(2.5, true);
    }
  });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.35 : -0.35;
    setImageZoom(imageViewerState.scale + delta, false);
  }, { passive: false });

  stage.addEventListener('mousedown', (e) => {
    if (imageViewerState.scale <= 1) return;
    e.preventDefault();
    imageViewerState.isDragging = true;
    imageViewerState.dragStartX = e.clientX - imageViewerState.translateX;
    imageViewerState.dragStartY = e.clientY - imageViewerState.translateY;
    applyImageTransform(false);
  });

  window.addEventListener('mousemove', (e) => {
    if (!imageViewerState.isDragging) return;
    imageViewerState.translateX = e.clientX - imageViewerState.dragStartX;
    imageViewerState.translateY = e.clientY - imageViewerState.dragStartY;
    applyImageTransform(false);
  });

  window.addEventListener('mouseup', () => {
    if (!imageViewerState.isDragging) return;
    imageViewerState.isDragging = false;
    applyImageTransform(false);
  });

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      imageViewerState.initialPinchDistance = Math.hypot(dx, dy);
      imageViewerState.initialPinchScale = imageViewerState.scale;
      imageViewerState.isDragging = false;
    } else if (e.touches.length === 1 && imageViewerState.scale > 1) {
      imageViewerState.isDragging = true;
      imageViewerState.dragStartX = e.touches[0].clientX - imageViewerState.translateX;
      imageViewerState.dragStartY = e.touches[0].clientY - imageViewerState.translateY;
    }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && imageViewerState.initialPinchDistance > 0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.hypot(dx, dy);
      const ratio = currentDistance / imageViewerState.initialPinchDistance;
      setImageZoom(imageViewerState.initialPinchScale * ratio, false);
    } else if (e.touches.length === 1 && imageViewerState.isDragging) {
      e.preventDefault();
      imageViewerState.translateX = e.touches[0].clientX - imageViewerState.dragStartX;
      imageViewerState.translateY = e.touches[0].clientY - imageViewerState.dragStartY;
      applyImageTransform(false);
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    imageViewerState.initialPinchDistance = 0;
    imageViewerState.isDragging = e.touches.length === 1 && imageViewerState.scale > 1;
    if (imageViewerState.isDragging) {
      imageViewerState.dragStartX = e.touches[0].clientX - imageViewerState.translateX;
      imageViewerState.dragStartY = e.touches[0].clientY - imageViewerState.translateY;
    }
    applyImageTransform(false);
  });

  stage.addEventListener('touchcancel', () => {
    imageViewerState.initialPinchDistance = 0;
    imageViewerState.isDragging = false;
    applyImageTransform(false);
  });
}

/********************************************************************
- 11. FILTER HELPERS, DIALOG, TOAST & EVENT INITIALIZATION
 ********************************************************************/
function selectLocationTab(loc) {
  appState.selectedLocation = loc;
  renderApp();
}

function toggleNeedsWaterFilter() {
  appState.onlyNeedsWater = !appState.onlyNeedsWater;
  renderApp();
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  renderApp();
}

function resetFilters() {
  appState.selectedLocation = 'すべて';
  appState.onlyNeedsWater = false;
  appState.selectedStatus = 'all';
  const stSelect = document.getElementById('statusFilterSelect');
  if (stSelect) stSelect.value = 'all';
  document.getElementById('sortSelect').value = 'water_priority';
  document.getElementById('searchInput').value = '';
  renderApp();
}

function closeConfirmDialog() {
  if (activeConfirmCleanup) activeConfirmCleanup();
}

function openConfirmDialog(title, message, onConfirm) {
  closeConfirmDialog();
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const dialog = document.getElementById('confirmDialog');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const okBtn = document.getElementById('confirmOkBtn');

  const cleanup = () => {
    dialog.classList.add('hidden');
    cancelBtn.onclick = null;
    okBtn.onclick = null;
    if (activeConfirmCleanup === cleanup) activeConfirmCleanup = null;
  };
  activeConfirmCleanup = cleanup;

  cancelBtn.onclick = cleanup;
  okBtn.onclick = () => {
    cleanup();
    onConfirm();
  };
  dialog.classList.remove('hidden');
}

function showToast(message, persistent = false) {
  const container = document.getElementById('toastContainer');
  const toast = createElement(
    'div',
    'px-4 py-2.5 rounded-2xl bg-charcoal text-white text-xs font-medium shadow-lg flex items-center gap-2 animate-fade-in',
    message
  );
  container.appendChild(toast);
  if (persistent) {
    toast.classList.remove('pointer-events-none');
    toast.classList.add('pointer-events-auto', 'cursor-pointer');
    toast.title = 'クリックして閉じる';
    toast.addEventListener('click', () => toast.remove());
    return;
  }
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

function initializeUIEvents() {
  const actions = {
    toggleBatchMode,
    exportData,
    triggerImport,
    openPlantFormModal: () => openPlantFormModal(null),
    selectAllVisibleInBatch,
    clearBatchSelection,
    executeBatchWater: () => executeBatchCare(['lastWatered'], '💧 {count}株の一括水やりを記録しました'),
    executeBatchMaterial,
    editActivePlant: () => {
      if (!appState.activeDetailPlantId) return;
      const targetId = appState.activeDetailPlantId;
      appState.returnToDetailPlantId = targetId;
      closeDetailModal();
      openPlantFormModal(targetId);
    },
    deleteActivePlant: () => {
      if (!appState.activeDetailPlantId) return;
      confirmDeletePlant(appState.activeDetailPlantId);
    },
    quickCareFromModal: (event) => {
      if (!appState.activeDetailPlantId) return;
      const target = event?.target?.closest('[data-care-type]');
      if (!target) return;
      const careType = target.dataset.careType;
      const cardDef = QUICK_CARE_CARDS.find(c => c.careType === careType);
      const label = cardDef ? cardDef.label : 'ケア';
      recordPlantCare(appState.activeDetailPlantId, careType, `${label}を記録しました`);
    },
    clearSearch,
    toggleNeedsWaterFilter,
    resortGrid: () => {
      renderApp();
      showToast('並び順を更新しました');
    },
    resetFilters,
    openFilterModal,
    closeFilterModal,
    closeDetailModal,
    addGrowthLogEntry,
    cancelEditGrowthLog,
    clearNewGrowthPhoto,
    closeQuickLogModal,
    clearQuickLogPhoto,
    submitQuickLog,
    closePlantFormModal,
    clearFormPhoto,
    viewImageFullscreen,
    closeImageViewer,
    zoomInImage: () => setImageZoom(imageViewerState.scale + 0.5, true),
    zoomOutImage: () => setImageZoom(imageViewerState.scale - 0.5, true),
    resetImageZoom
  };

  function debounce(func, delay = 150) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  }

  function updateModalViewport() {
    const vv = window.visualViewport;
    const h = vv ? Math.min(window.innerHeight, vv.height) : window.innerHeight;
    document.documentElement.style.setProperty('--modal-viewport-height', `${h}px`);
  }
  updateModalViewport();
  window.addEventListener('resize', updateModalViewport, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateModalViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', updateModalViewport, { passive: true });
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const actionName = actionElement.dataset.action;
    if (Object.prototype.hasOwnProperty.call(actions, actionName)) {
      actions[actionName](event);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('imageViewerModal').classList.contains('hidden')) {
      closeImageViewer();
    } else if (!document.getElementById('confirmDialog').classList.contains('hidden')) {
      closeConfirmDialog();
    } else if (!document.getElementById('filterModal').classList.contains('hidden')) {
      closeFilterModal();
    } else if (!document.getElementById('quickLogModal').classList.contains('hidden')) {
      closeQuickLogModal();
    } else if (!document.getElementById('formModal').classList.contains('hidden')) {
      closePlantFormModal();
    } else if (!document.getElementById('detailModal').classList.contains('hidden')) {
      closeDetailModal();
    }
  });

  document.getElementById('searchInput').addEventListener('input', debounce(renderApp, 150));
  document.getElementById('sortSelect').addEventListener('change', renderApp);
  document.getElementById('statusFilterSelect').addEventListener('change', (e) => {
    appState.selectedStatus = e.target.value || 'all';
    renderApp();
  });
  renderBatchMaterialChips();
  document.getElementById('plantForm').addEventListener('submit', savePlantForm);
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);
  document.getElementById('formPhotoInput').addEventListener('change', handleFormPhotoSelect);
  document.getElementById('newGrowthPhotoInput').addEventListener('change', previewGrowthPhoto);
  document.getElementById('quickLogPhotoInput').addEventListener('change', previewQuickLogPhoto);
  document.getElementById('filterModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'filterModal') closeFilterModal();
  });

  initializeImageViewerEvents();
  initializeIconPlaceholders();
}

/********************************************************************
- 12. INITIALIZATION
 ********************************************************************/
window.addEventListener('DOMContentLoaded', async () => {
  initializeUIEvents();
  try {
    const stored = await loadFromDB();
    if (stored !== null) {
      appState.plants = stored;
      appState.dbLoadError = false;
    } else {
      appState.plants = getInitialSamplePlants();
      appState.dbLoadError = false;
      await saveToDB();
    }
  } catch (err) {
    console.error('Stored plant data load/validation failed:', err);
    appState.dbLoadError = true;
    appState.plants = [];
    showToast(`保存データを読み込めません: ${err.message || err.name}。既存データは上書きしません`, true);
  }
  renderApp();
});