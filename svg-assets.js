'use strict';

/********************************************************************
- STATIC SVG ASSETS (LUCIDE ICON PATHS & BOTANICAL ILLUSTRATIONS)
 ********************************************************************/
const ICON_PATHS = {
  'sprout': '<path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/>',
  'plant-plus': '<path d="M13 9.5V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3" fill="#588157" fill-opacity="0.25"/><path d="M3 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4" fill="#588157" fill-opacity="0.25"/><path d="M18.5 14v6" stroke-width="2.2"/><path d="M15.5 17h6" stroke-width="2.2"/>',
  'layers': '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'upload': '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'droplets': '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  'flask-conical': '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'droplet': '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  'leaf': '<path d="M11 20a10 10 0 0 0 10-10 25.9 25.9 0 0 0-1.04-7.281 1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'trash-2': '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'shovel': '<path d="M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z"/><path d="M3 22a1 1 0 0 1-1-1v-3.586a1 1 0 0 1 .293-.707l3.355-3.355a1.205 1.205 0 0 1 1.704 0l3.296 3.296a1.205 1.205 0 0 1 0 1.704l-3.355 3.355a1 1 0 0 1-.707.293z"/><path d="m9 15 7.879-7.878"/>',
  'sliders-horizontal': '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'timer': '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  'store': '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
  'japanese-yen': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 8 3 3v7"/><path d="m12 11 3-3"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  'calendar': '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  'sparkles': '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  'camera': '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  'image-plus': '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'images': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'layout-grid': '<circle cx="17.5" cy="17.5" r="3.5"/><circle cx="17.5" cy="6.5" r="3.5"/><circle cx="6.5" cy="17.5" r="3.5"/><circle cx="6.5" cy="6.5" r="3.5"/>',
  'archive': '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'
};

const BOTANICAL_SVGS = {
  agave: {
    label: 'アガベ・多肉',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 10C29 22 25 34 26 44H38C39 34 35 22 32 10Z" fill="#588157" fill-opacity="0.2" stroke="#3A5A40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32 44C23 44 15 35 12 22C21 25 27 33 28 44" fill="#588157" fill-opacity="0.15" stroke="#3A5A40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32 44C41 44 49 35 52 22C43 25 37 33 36 44" fill="#588157" fill-opacity="0.15" stroke="#3A5A40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M26 44C17 44 10 40 8 33C16 34 22 38 26 44Z" stroke="#3A5A40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M38 44C47 44 54 40 56 33C48 34 42 38 38 44Z" stroke="#3A5A40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M20 44H44L41 55H23L20 44Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  },
  monstera: {
    label: 'モンステラ・アロイド',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 44V20" stroke="#3A5A40" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M32 12C20 12 13 21 15 32C19 31 23 29 23 29C23 29 18 35 20 39C24 41 30 41 32 41C34 41 40 41 44 39C46 35 41 29 41 29C41 29 45 31 49 32C51 21 44 12 32 12Z" fill="#588157" fill-opacity="0.2" stroke="#3A5A40" stroke-width="2" stroke-linejoin="round"/>
      <path d="M22 44H42L39 55H25L22 44Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  },
  caudex: {
    label: '塊根・コーデックス',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 1.5)">
        <path d="M22 44C18 39 19 29 26 26C27 21 31 19 34 22C40 24 45 31 42 44H22Z" fill="#D97757" fill-opacity="0.2" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
        <path d="M29 21C27 16 22 13 17 14" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
        <path d="M34 21C36 15 42 12 47 14" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
        <circle cx="16" cy="14" r="3" fill="#588157"/>
        <circle cx="48" cy="14" r="3" fill="#588157"/>
        <circle cx="32" cy="11" r="3" fill="#588157"/>
        <path d="M19 44H45L42 54H22L19 44Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
      </g>
    </svg>`
  },
  hanging: {
    label: 'ハンギング・シダ',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 8L23 26M32 8L41 26" stroke="#2F3E46" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M21 26H43L40 36H24L21 26Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
      <path d="M25 36C21 42 17 48 16 55" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
      <path d="M32 36V57" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
      <path d="M39 36C43 42 47 48 48 55" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
      <circle cx="19" cy="45" r="2.5" fill="#588157"/>
      <circle cx="16" cy="53" r="2.5" fill="#588157"/>
      <circle cx="32" cy="48" r="2.5" fill="#588157"/>
      <circle cx="45" cy="45" r="2.5" fill="#588157"/>
      <circle cx="48" cy="53" r="2.5" fill="#588157"/>
    </svg>`
  },
  tree: {
    label: 'フィカス・枝物',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 44V22C32 18.5 34 16.5 36.8 15.4" stroke="#2F3E46" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M32 23C31.8 20.5 31 18.8 29.7 17.5" stroke="#2F3E46" stroke-width="2" stroke-linecap="round"/>
      <path d="M32 33C29 30 27 28.5 24.8 26.8" stroke="#2F3E46" stroke-width="2" stroke-linecap="round"/>
      <path d="M32 34C34.5 32 36.2 30.8 38.2 29.6" stroke="#2F3E46" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="20" cy="25" rx="6" ry="4" transform="rotate(-20 20 25)" fill="#588157" fill-opacity="0.25" stroke="#3A5A40" stroke-width="2"/>
      <ellipse cx="42" cy="14" rx="6" ry="4" transform="rotate(15 42 14)" fill="#588157" fill-opacity="0.25" stroke="#3A5A40" stroke-width="2"/>
      <ellipse cx="44" cy="28" rx="6" ry="4" transform="rotate(-15 44 28)" fill="#588157" fill-opacity="0.25" stroke="#3A5A40" stroke-width="2"/>
      <ellipse cx="25" cy="14.5" rx="5.5" ry="3.8" transform="rotate(25 25 14.5)" fill="#588157" fill-opacity="0.25" stroke="#3A5A40" stroke-width="2"/>
      <path d="M22 44H42L39 55H25L22 44Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  },
  conophytum: {
    label: 'コノフィツム',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(-4.8, -11.5) scale(1.15)">
        <path d="M 24 44 C 21 32 22 23 27 23 C 30 23 32 26 32 28 C 32 26 34 23 37 23 C 42 23 43 32 40 44 Z" fill="#588157" fill-opacity="0.2" stroke="#3A5A40" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M 32 28 V 30" stroke="#3A5A40" stroke-width="1.75" stroke-linecap="round"/>
        <path d="M 20 38 H 44 L 41 55 H 23 L 20 38 Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="1.75" stroke-linejoin="round"/>
      </g>
    </svg>`
  },
  echeveria: {
    label: 'エケベリア系',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="eke-leaf-grad1" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#EAA1A7" stop-opacity="1" /><stop offset="17%" stop-color="#EAA1A7" stop-opacity="0.9" /><stop offset="20%" stop-color="#789977" stop-opacity="1" />
        </linearGradient>
        <linearGradient id="eke-leaf-grad2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#EAA1A7" stop-opacity="1" /><stop offset="20%" stop-color="#EAA1A7" stop-opacity="0.9" /><stop offset="23%" stop-color="#789977" stop-opacity="1" />
        </linearGradient>
        <linearGradient id="eke-leaf-grad3" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#EAA1A7" stop-opacity="1" /><stop offset="28%" stop-color="#EAA1A7" stop-opacity="0.9" /><stop offset="31%" stop-color="#789977" stop-opacity="1" />
        </linearGradient>
      </defs>
      <g transform="translate(8.96, 11.5) scale(0.72)">
        <g fill="url(#eke-leaf-grad1)" stroke="#3A5A40" stroke-width="2.7" stroke-linejoin="round">
          <path d="M 32 38 C 12 34 16 6 32 2 C 48 6 52 34 32 38 Z" transform="rotate(0 32 32)"/>
          <path d="M 32 38 C 12 34 16 6 32 2 C 48 6 52 34 32 38 Z" transform="rotate(72 32 32)"/>
          <path d="M 32 38 C 12 34 16 6 32 2 C 48 6 52 34 32 38 Z" transform="rotate(144 32 32)"/>
          <path d="M 32 38 C 12 34 16 6 32 2 C 48 6 52 34 32 38 Z" transform="rotate(216 32 32)"/>
          <path d="M 32 38 C 12 34 16 6 32 2 C 48 6 52 34 32 38 Z" transform="rotate(288 32 32)"/>
        </g>
        <g fill="url(#eke-leaf-grad2)" stroke="#3A5A40" stroke-width="2.7" stroke-linejoin="round">
          <path d="M 32 36 C 16 32 19 11 32 7 C 45 11 48 32 32 36 Z" transform="rotate(36 32 32)"/>
          <path d="M 32 36 C 16 32 19 11 32 7 C 45 11 48 32 32 36 Z" transform="rotate(108 32 32)"/>
          <path d="M 32 36 C 16 32 19 11 32 7 C 45 11 48 32 32 36 Z" transform="rotate(180 32 32)"/>
          <path d="M 32 36 C 16 32 19 11 32 7 C 45 11 48 32 32 36 Z" transform="rotate(252 32 32)"/>
          <path d="M 32 36 C 16 32 19 11 32 7 C 45 11 48 32 32 36 Z" transform="rotate(324 32 32)"/>
        </g>
        <g fill="url(#eke-leaf-grad3)" stroke="#3A5A40" stroke-width="2.7" stroke-linejoin="round">
          <path d="M 32 34 C 21 31 23 16 32 12 C 41 16 43 31 32 34 Z" transform="rotate(15 32 32)"/>
          <path d="M 32 34 C 21 31 23 16 32 12 C 41 16 43 31 32 34 Z" transform="rotate(87 32 32)"/>
          <path d="M 32 34 C 21 31 23 16 32 12 C 41 16 43 31 32 34 Z" transform="rotate(159 32 32)"/>
          <path d="M 32 34 C 21 31 23 16 32 12 C 41 16 43 31 32 34 Z" transform="rotate(231 32 32)"/>
          <path d="M 32 34 C 21 31 23 16 32 12 C 41 16 43 31 32 34 Z" transform="rotate(303 32 32)"/>
        </g>
      </g>
    </svg>`
  },
  haworthia: {
    label: 'ハオルチア',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="haworthia-window" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#E3EAE5" stop-opacity="0.9" />
          <stop offset="30%" stop-color="#E3EAE5" stop-opacity="0.9" />
          <stop offset="31%" stop-color="#789977" stop-opacity="1" />
        </linearGradient>
      </defs>
      <g transform="translate(-3.84, -9.5) scale(1.12)">
        <path d="M20 38 C15 35 16 28 19 28 C22 28 24 32 25 38 Z" fill="url(#haworthia-window)" stroke="#3A5A40" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M44 38 C49 35 48 28 45 28 C42 28 40 32 39 38 Z" fill="url(#haworthia-window)" stroke="#3A5A40" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M24 38 C20 30 20 25 24 25 C28 25 28 30 29 38 Z" fill="url(#haworthia-window)" stroke="#3A5A40" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M40 38 C44 30 44 25 40 25 C36 25 36 30 35 38 Z" fill="url(#haworthia-window)" stroke="#3A5A40" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M28 38 C29 27 28 22 32 22 C36 22 35 27 36 38 Z" fill="url(#haworthia-window)" stroke="#3A5A40" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M 20 38 H 44 L 41 55 H 23 L 20 38 Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="1.8" stroke-linejoin="round"/>
      </g>
    </svg>`
  },
  cactus: {
    label: 'サボテン・ユーフォルビア',
    svg: `<svg viewBox="0 0 64 64" fill="none" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect x="26" y="14" width="12" height="30" rx="6" fill="#588157" fill-opacity="0.2" stroke="#3A5A40" stroke-width="2"/>
      <path d="M26 30H20C17 30 16 28 16 25V20" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
      <path d="M38 26H44C47 26 48 24 48 21V17" stroke="#3A5A40" stroke-width="2" stroke-linecap="round"/>
      <path d="M21 44H43L40 55H24L21 44Z" fill="#E3EAE5" stroke="#2F3E46" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  }
};