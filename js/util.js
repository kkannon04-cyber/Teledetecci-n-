// Utilidades compartidas: tiempo Zulu, geometría de ruta y bus de eventos.

/* ---------- Bus de eventos ----------
   Un único canal por el que la barra de tiempo avisa a mapa, satélite y
   meteorología. Evita que los módulos se llamen entre sí directamente. */
const oyentes = new Map();

export const bus = {
  on(evento, fn) {
    if (!oyentes.has(evento)) oyentes.set(evento, new Set());
    oyentes.get(evento).add(fn);
  },
  emit(evento, dato) {
    (oyentes.get(evento) || []).forEach((fn) => {
      try { fn(dato); } catch (e) { console.error(`[${evento}]`, e); }
    });
  },
};

/* ---------- Tiempo Zulu ---------- */

export const aFecha = (iso) => new Date(iso);

/** 1340Z */
export function horaZ(fecha) {
  const h = String(fecha.getUTCHours()).padStart(2, '0');
  const m = String(fecha.getUTCMinutes()).padStart(2, '0');
  return `${h}${m}Z`;
}

/** 31/1340Z — con día del mes, como en los reportes aeronáuticos */
export function horaZLarga(fecha) {
  return `${String(fecha.getUTCDate()).padStart(2, '0')}/${horaZ(fecha)}`;
}

/** 2026-08-31 13:40Z */
export function fechaHoraZ(fecha) {
  const f = fecha.toISOString();
  return `${f.slice(0, 10)} ${f.slice(11, 16)}Z`;
}

export const minutosEntre = (a, b) => (b - a) / 60000;

/* ---------- Geometría ---------- */

const RAD = Math.PI / 180;
const RADIO_TIERRA_NM = 3440.065;

/** Distancia ortodrómica en millas náuticas. */
export function distanciaNM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_NM * Math.asin(Math.sqrt(h));
}

/** Rumbo inicial verdadero en grados. */
export function rumbo(a, b) {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Longitud total de la ruta en NM. */
export function longitudRuta(wps) {
  let total = 0;
  for (let i = 1; i < wps.length; i++) total += distanciaNM(wps[i - 1], wps[i]);
  return total;
}

/**
 * Posición sobre la ruta para una fracción 0..1 del recorrido,
 * repartida por distancia real (no por número de waypoints).
 */
export function puntoEnRuta(wps, fraccion) {
  const f = Math.max(0, Math.min(1, fraccion));
  const total = longitudRuta(wps);
  let objetivo = total * f;

  for (let i = 1; i < wps.length; i++) {
    const tramo = distanciaNM(wps[i - 1], wps[i]);
    if (objetivo <= tramo || i === wps.length - 1) {
      const t = tramo === 0 ? 0 : Math.min(1, objetivo / tramo);
      return {
        lat: wps[i - 1].lat + (wps[i].lat - wps[i - 1].lat) * t,
        lon: wps[i - 1].lon + (wps[i].lon - wps[i - 1].lon) * t,
        rumbo: rumbo(wps[i - 1], wps[i]),
        tramo: `${wps[i - 1].nombre} → ${wps[i].nombre}`,
      };
    }
    objetivo -= tramo;
  }
  const u = wps[wps.length - 1];
  return { lat: u.lat, lon: u.lon, rumbo: 0, tramo: u.nombre };
}

/* ---------- Categoría de vuelo ---------- */

export const COLOR_CAT = {
  VFR: '#3fb950',
  MVFR: '#4da3ff',
  IFR: '#f85149',
  LIFR: '#d2a8ff',
  ND: '#6e7681',
};

export const colorCat = (cat) => COLOR_CAT[cat] || COLOR_CAT.ND;

/* ---------- DOM ---------- */

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Escapa texto antes de insertarlo con innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export async function cargarJSON(ruta) {
  const res = await fetch(ruta);
  if (!res.ok) throw new Error(`No se pudo cargar ${ruta} (${res.status})`);
  return res.json();
}

/** Carga opcional: devuelve null en vez de fallar si el archivo aún no existe. */
export async function cargarJSONOpcional(ruta) {
  try {
    return await cargarJSON(ruta);
  } catch {
    console.warn(`Aún no existe ${ruta} — se continúa sin ese dato.`);
    return null;
  }
}
