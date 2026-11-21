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
    careType: 'lastFertilized',
    label: '活力剤',
    icon: 'flask-conical',
    boxId: 'detailLastFertilized',
    subId: null,
    btnClass: 'bg-emerald-50/70 hover:bg-emerald-600 text-emerald-800 hover:text-white border-emerald-200/70',
    formatSub: () => '定期ケア'
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
  batchMode: false,
  batchSelectedIds: new Set(),
  activeDetailPlantId: null,
  selectedFormSvgType: 'agave',
  tempFormPhotoDataUrl: null,
  tempGrowthPhotoDataUrl: null,
  dbLoadError: true
};

let cachedDB = null;
let svgUniqueCounter = 0;
let activeConfirmCleanup = null;

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function getSortedGrowthLogs(plant) {
  if (!Array.isArray(plant?.growthLogs)) return [];
  return [...plant.growthLogs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
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
}

function getWaterMarginDays(plant) {
  if (!plant.waterIntervalDays) return null;
  if (!plant.lastWatered) return -9999;
  const elapsed = calcDaysBetween(plant.lastWatered);
  return elapsed === null ? null : Number(plant.waterIntervalDays) - elapsed;
}

function isPlantNeedingWater(plant) {
  const margin = getWaterMarginDays(plant);
  return margin !== null && margin <= 0;
}

function updateHeaderBadges() {
  const needsWaterCount = appState.plants.filter(isPlantNeedingWater).length;
  const badge = document.getElementById('needsWaterCountBadge');
  badge.textContent = needsWaterCount;

  const btn = document.getElementById('filterNeedsWaterBtn');
  if (appState.onlyNeedsWater) {
    btn.className = 'h-9 px-3 rounded-xl text-xs font-semibold border border-amber-500 bg-amber-500 text-white flex items-center gap-1.5 transition shrink-0 shadow-2xs';
    badge.className = 'px-1.5 py-0.5 rounded-full bg-white text-amber-800 text-[10px] font-bold leading-none';
  } else {
    btn.className = 'h-9 px-3 rounded-xl text-xs font-medium border border-stoneborder bg-white text-gray-600 hover:bg-amber-50 flex items-center gap-1.5 transition shrink-0';
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
      `px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition cursor-pointer ${
        active ? 'bg-sage-600 text-white shadow-2xs' : 'bg-white text-gray-600 border border-stoneborder hover:bg-sage-50'
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
  const sortedLogs = getSortedGrowthLogs(plant);
  const latestLog = sortedLogs[sortedLogs.length - 1];
  const latestPhoto = latestLog?.photoDataUrl || null;

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

  // Location & Batch Checkbox
  const locationPill = createElement('div', 'absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 flex items-start gap-1.5 max-w-[58%] sm:max-w-[62%]');
  if (appState.batchMode) {
    const checkWrap = createElement('div', `w-5 h-5 sm:w-6 sm:h-6 rounded-lg shrink-0 ${isBatchSelected ? 'bg-sage-600 text-white' : 'bg-white/90 text-gray-400 border border-gray-300'} flex items-center justify-center shadow-xs`);
    checkWrap.appendChild(createLucideIcon('check', 'w-3.5 h-3.5 sm:w-4 sm:h-4'));
    locationPill.appendChild(checkWrap);
  }
  const locationBadge = createElement('span', 'marker-badge font-medium bg-white/90 backdrop-blur-xs text-charcoal border-stoneborder/80 shadow-2xs min-w-0 max-w-full');
  locationBadge.append(createLucideIcon('map-pin', 'text-sage-600'), createElement('span', 'truncate', plant.location || '未設定'));
  locationPill.appendChild(locationBadge);
  visual.appendChild(locationPill);

  // Water Status Badge
  const statusWrap = createElement('div', 'absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5');
  const statusBadge = createElement('span', `marker-badge font-bold shadow-2xs ${
    needsWater ? 'bg-amber-500 text-white border-transparent' : daysSinceWater === 0 ? 'bg-sky-600 text-white border-transparent' : 'bg-white/90 backdrop-blur-xs text-charcoal border-stoneborder/80'
  }`);
  statusBadge.append(
    createLucideIcon('droplets', `${needsWater || daysSinceWater === 0 ? 'text-white' : 'text-sky-500'}`),
    createElement('span', '', waterBadgeText)
  );
  statusWrap.appendChild(statusBadge);
  visual.appendChild(statusWrap);

  if (sortedLogs.length) {
    const logBadge = createElement('span', 'marker-badge absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 bg-black/60 text-white font-medium border-transparent');
    logBadge.append(createLucideIcon('images'), document.createTextNode(`${sortedLogs.length}枚`));
    visual.appendChild(logBadge);
  }

  visual.addEventListener('click', event => {
    event.stopPropagation();
    openDetailModal(plant.id);
  });
  visual.style.cursor = 'pointer';
  card.appendChild(visual);

  // Card Body
  const body = createElement('div', 'p-2 sm:p-4 flex-1 flex flex-col justify-between space-y-2 sm:space-y-3');
  const details = createElement('div');
  const name = createElement('h3', 'font-bold text-sm sm:text-base text-charcoal hover:text-sage-600 transition cursor-pointer line-clamp-1', plant.name);
  name.addEventListener('click', event => {
    event.stopPropagation();
    openDetailModal(plant.id);
  });
  details.appendChild(name);

  body.appendChild(details);

  // Quick Care Buttons
  const actions = createElement('div', 'grid grid-cols-2 gap-1 sm:gap-1.5');
  QUICK_CARE_CARDS.slice(0, 2).forEach(cardDef => {
    const button = createElement('button', `py-2 px-1 sm:px-2 rounded-lg sm:rounded-xl text-xs font-semibold border flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1 transition cursor-pointer ${cardDef.btnClass}`);
    button.type = 'button';
    button.title = `今日${cardDef.label}したとして記録`;
    button.append(
      createLucideIcon(cardDef.icon, 'w-3.5 h-3.5 shrink-0'),
      createElement('span', 'text-[10px] sm:text-xs leading-none mt-0.5 sm:mt-0', cardDef.label)
    );
    button.addEventListener('click', event => {
      event.stopPropagation();
      recordPlantCare(plant.id, cardDef.careType, `${cardDef.label}を記録しました`);
    });
    actions.appendChild(button);
  });
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
async function recordPlantCare(plantId, careType, toastMessage) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant) return;
  plant[careType] = getTodayStr();
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
  showToast(`${toastMessage}（${plant.name}）`);
}

function setBatchMode(enabled) {
  appState.batchMode = enabled;
  appState.batchSelectedIds.clear();
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
      careFields.forEach(field => { p[field] = today; });
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

  const logs = getSortedGrowthLogs(plant);
  document.getElementById('growthCountBadge').textContent = `(${logs.length}枚)`;

  const compSec = document.getElementById('growthComparisonSection');
  if (logs.length >= 2) {
    compSec.classList.remove('hidden');
    const first = logs[0];
    const latest = logs[logs.length - 1];

    const firstImg = document.getElementById('compareFirstImg');
    firstImg.src = first.photoDataUrl;
    firstImg.dataset.caption = `BEFORE (${first.date}) ${first.note || ''}`.trim();
    document.getElementById('compareFirstDate').textContent = first.date;
    document.getElementById('compareFirstNote').textContent = first.note || '初回記録';

    const latestImg = document.getElementById('compareLatestImg');
    latestImg.src = latest.photoDataUrl;
    latestImg.dataset.caption = `NOW (${latest.date}) ${latest.note || ''}`.trim();
    document.getElementById('compareLatestDate').textContent = latest.date;
    document.getElementById('compareLatestNote').textContent = latest.note || '最新記録';

    const diffDays = calcDaysBetween(first.date, latest.date);
    document.getElementById('comparisonSpanBadge').textContent =
      diffDays !== null && diffDays > 0 ? `${diffDays}日間の変化` : '成長記録比較';
  } else {
    compSec.classList.add('hidden');
  }

  const timelineGrid = document.getElementById('growthTimelineGrid');
  const reversed = [...logs].reverse();
  timelineGrid.replaceChildren();

  if (reversed.length === 0) {
    timelineGrid.appendChild(createElement(
      'div',
      'col-span-full py-8 text-center text-xs text-gray-400 border border-dashed border-stoneborder rounded-2xl',
      'まだ成長写真が登録されていません。上の「写真を選択」から1枚目を記録してみましょう。'
    ));
    return;
  }

  reversed.forEach(entry => {
    const item = createElement('div', 'bg-canvas rounded-2xl border border-stoneborder overflow-hidden flex flex-col justify-between group');
    const imageWrap = createElement('div', 'aspect-square bg-gray-100 relative overflow-hidden');
    const image = createElement('img', 'w-full h-full object-cover cursor-zoom-in');
    image.src = entry.photoDataUrl;
    image.alt = 'Growth log';
    image.dataset.action = 'viewImageFullscreen';
    image.dataset.caption = `${entry.date || ''} ${entry.note || ''}`.trim();
    imageWrap.appendChild(image);

    const controlsWrap = createElement('div', 'opacity-0 group-hover:opacity-100 transition absolute top-2 right-2 flex items-center gap-1.5');

    const editButton = createElement('button', 'p-1.5 rounded-lg bg-black/60 text-white hover:bg-amber-500');
    editButton.type = 'button';
    editButton.title = 'この記録を編集';
    editButton.appendChild(createLucideIcon('pencil', 'w-3.5 h-3.5'));
    editButton.addEventListener('click', () => editGrowthLogEntry(plant.id, entry.id));

    const deleteButton = createElement('button', 'p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-600');
    deleteButton.type = 'button';
    deleteButton.title = 'この写真を削除';
    deleteButton.appendChild(createLucideIcon('trash-2', 'w-3.5 h-3.5'));
    deleteButton.addEventListener('click', () => deleteGrowthLogEntry(plant.id, entry.id));

    controlsWrap.append(editButton, deleteButton);
    imageWrap.appendChild(controlsWrap);
    item.appendChild(imageWrap);

    const caption = createElement('div', 'p-2.5');
    caption.append(
      createElement('p', 'text-[11px] font-bold text-charcoal', entry.date || ''),
      createElement('p', 'text-xs text-gray-600 mt-0.5 line-clamp-2', entry.note || '記録のみ')
    );
    item.appendChild(caption);
    timelineGrid.appendChild(item);
  });
}

async function previewGrowthPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { dataUrl, approxKB, width, height } = await compressImageFile(file);
    appState.tempGrowthPhotoDataUrl = dataUrl;
    document.getElementById('newGrowthPreviewImg').src = dataUrl;
    document.getElementById('newGrowthSizeInfo').textContent = `${width}×${height}px / 約${approxKB}KB (WebP軽量化済)`;
    document.getElementById('newGrowthPreviewBox').classList.remove('hidden');
    document.getElementById('newGrowthPhotoLabel').textContent = '別の写真に変更';
  } catch (e) {
    showToast('画像の読み込みに失敗しました');
  }
}

function clearNewGrowthPhoto() {
  appState.tempGrowthPhotoDataUrl = null;
  document.getElementById('newGrowthPhotoInput').value = '';
  document.getElementById('newGrowthPreviewBox').classList.add('hidden');
  document.getElementById('newGrowthPhotoLabel').textContent = '写真を選択 (自動圧縮)';
}

function editGrowthLogEntry(plantId, logId) {
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant || !Array.isArray(plant.growthLogs)) return;
  const log = plant.growthLogs.find(g => g.id === logId);
  if (!log) return;

  document.getElementById('editGrowthLogId').value = log.id;
  document.getElementById('newGrowthDateInput').value = log.date || getTodayStr();
  document.getElementById('newGrowthNoteInput').value = log.note || '';

  appState.tempGrowthPhotoDataUrl = log.photoDataUrl;
  document.getElementById('newGrowthPreviewImg').src = log.photoDataUrl;
  document.getElementById('newGrowthSizeInfo').textContent = '現在の写真 (変更可能)';
  document.getElementById('newGrowthPreviewBox').classList.remove('hidden');
  document.getElementById('newGrowthPhotoLabel').textContent = '別の写真に変更';

  const addBtn = document.getElementById('addGrowthLogBtn');
  addBtn.textContent = '更新';
  addBtn.classList.remove('bg-sage-600', 'hover:bg-sage-700');
  addBtn.classList.add('bg-amber-600', 'hover:bg-amber-700');

  document.getElementById('cancelEditGrowthLogBtn').classList.remove('hidden');
  document.getElementById('growthAlbumTitle').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditGrowthLog() {
  clearNewGrowthPhoto();
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

    if (!appState.tempGrowthPhotoDataUrl) {
      showToast('追加・更新する写真を選択してください');
      return;
    }

    const dateVal = document.getElementById('newGrowthDateInput').value || getTodayStr();
    const noteVal = document.getElementById('newGrowthNoteInput').value.trim();
    const editLogId = document.getElementById('editGrowthLogId').value;

    if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];

    let successMessage;
    if (editLogId) {
      const logIndex = plant.growthLogs.findIndex(g => g.id === editLogId);
      if (logIndex === -1) {
        showToast('更新する成長記録が見つかりません');
        return;
      }
      plant.growthLogs[logIndex] = {
        id: editLogId,
        date: dateVal,
        photoDataUrl: appState.tempGrowthPhotoDataUrl,
        note: noteVal
      };
      successMessage = '📷 成長記録を更新しました';
    } else {
      const newLogId = createId('g');
      plant.growthLogs.push({
        id: newLogId,
        date: dateVal,
        photoDataUrl: appState.tempGrowthPhotoDataUrl,
        note: noteVal
      });
      document.getElementById('editGrowthLogId').value = newLogId;
      successMessage = '📷 成長アルバムに写真を追加しました';
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

async function deleteGrowthLogEntry(plantId, logId) {
  if (!canEditData()) return;
  const plant = appState.plants.find(p => p.id === plantId);
  if (!plant || !Array.isArray(plant.growthLogs)) return;

  openConfirmDialog('写真の削除', 'この成長記録写真を削除しますか？', async () => {
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
    showToast('写真を削除しました');
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
  } else {
    setPlantFormTitle('sprout', '新しい株を追加');
    document.getElementById('formPlantId').value = '';
    appState.selectedFormSvgType = 'agave';
    document.getElementById('formPurchaseDate').value = getTodayStr();
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

    if (id) {
      const plant = appState.plants.find(p => p.id === id);
      if (!plant) {
        showToast('更新する株が見つかりません');
        return;
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
        notes
      });
      if (appState.tempFormPhotoDataUrl) {
        if (!Array.isArray(plant.growthLogs)) plant.growthLogs = [];
        plant.growthLogs.push({
          id: createId('g'),
          date: getTodayStr(),
          photoDataUrl: appState.tempFormPhotoDataUrl,
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
        lastWatered: null,
        lastFertilized: null,
        lastRepotted: purchaseDate || getTodayStr(),
        growthLogs: []
      };
      if (appState.tempFormPhotoDataUrl) {
        newPlant.growthLogs.push({
          id: createId('g'),
          date: purchaseDate || getTodayStr(),
          photoDataUrl: appState.tempFormPhotoDataUrl,
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
      growthLogs: logs.map((entry, j) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`${name}の成長記録${j + 1}件目が不正です`);
        }
        if (typeof entry.photoDataUrl !== 'string' || !/^data:image\/(?:webp|jpeg|png);base64,/.test(entry.photoDataUrl)) {
          throw new Error(`${name}の成長記録${j + 1}件目の画像形式が不正です`);
        }
        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : createId(`g_${j}`),
          date: readDate(entry.date, `${name}の成長記録${j + 1}件目の日付`),
          photoDataUrl: entry.photoDataUrl,
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
    executeBatchWater: () => executeBatchCare(['lastWatered'], '💧 {count}株の一括水やりを記録しました'),
    executeBatchFertilizer: () => executeBatchCare(['lastWatered', 'lastFertilized'], '🧪 {count}株に水やり＋活力剤を一括記録しました'),
    editActivePlant: () => {
      if (!appState.activeDetailPlantId) return;
      const targetId = appState.activeDetailPlantId;
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
    closeDetailModal,
    addGrowthLogEntry,
    cancelEditGrowthLog,
    clearNewGrowthPhoto,
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
    } else if (!document.getElementById('formModal').classList.contains('hidden')) {
      closePlantFormModal();
    } else if (!document.getElementById('detailModal').classList.contains('hidden')) {
      closeDetailModal();
    }
  });

  document.getElementById('searchInput').addEventListener('input', debounce(renderApp, 150));
  document.getElementById('sortSelect').addEventListener('change', renderApp);
  document.getElementById('plantForm').addEventListener('submit', savePlantForm);
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);
  document.getElementById('formPhotoInput').addEventListener('change', handleFormPhotoSelect);
  document.getElementById('newGrowthPhotoInput').addEventListener('change', previewGrowthPhoto);

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