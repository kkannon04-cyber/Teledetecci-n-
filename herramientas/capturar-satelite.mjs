// Descarga imágenes GOES-19 (ABI) recortadas a la zona que cubre la ruta del caso
// y las deja en medios/satelite/ para que el visor funcione sin internet.
//
// Fuente: CIRA/RAMMB SLIDER, que publica el disco completo en teselas de 678 px
// bajo el patrón —descubierto sondeando el servidor, la fecha va PARTIDA—:
//
//   /data/imagery/{YYYY}/{MM}/{DD}/goes-19---full_disk/{banda}/{sello}/{zz}/{fila}_{col}.png
//
// El disco viene en proyección geoestacionaria (rejilla fija ABI), no en
// coordenadas geográficas: para quedarnos solo con el corredor de la ruta hay que
// traducir latitud/longitud a píxel con la proyección del GOES-R PUG. Esa
// traducción es la parte frágil de todo esto, así que el modo --verificar la
// contrasta contra NASA GIBS, que sirve las mismas bandas 2 y 13 ya
// georreferenciadas.
//
// Uso:
//   node herramientas/capturar-satelite.mjs --verificar
//   node herramientas/capturar-satelite.mjs --fecha 20260902 --desde 1100 --hasta 1400
//   node herramientas/capturar-satelite.mjs --bandas band_13 --paso 30 --sin-video

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MEDIOS = join(RAIZ, 'medios', 'satelite');
const SLIDER = 'https://rammb-slider.cira.colostate.edu';
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const SATELITE = 'goes-19';
const SECTOR = 'full_disk';
const LADO_TESELA = 678;

/* ===================== Bandas ===================== */
// Zoom = resolución nativa del instrumento. Pedir más sería interpolar.
const BANDAS = {
  band_01: {
    nombre: 'Azul visible', canal: 'Banda 1', onda: '0.47 µm', resolucion: '1 km', zoom: 4, gibs: null,
    para: 'Aerosoles, bruma y humo. Es la banda más sensible a la dispersión atmosférica.',
    leer: 'La bruma y el humo aparecen como un velo lechoso que en la banda 2 apenas se nota. Compararla con la 2 separa lo que es aerosol de lo que es nube. Solo sirve de día.',
  },
  band_02: {
    nombre: 'Rojo visible', canal: 'Banda 2', onda: '0.64 µm', resolucion: '0.5 km', zoom: 5,
    gibs: 'GOES-East_ABI_Band2_Red_Visible_1km',
    para: 'Textura y estructura de la nube a la máxima resolución del instrumento: torres convectivas, sombras del yunque, líneas de turbulencia.',
    leer: 'Blanco intenso con textura granulada y abultada = desarrollo vertical activo. La sombra que proyecta el yunque dice hacia dónde crece la célula. Solo sirve de día.',
  },
  band_04: {
    nombre: 'Cirros', canal: 'Banda 4', onda: '1.37 µm', resolucion: '2 km', zoom: 3, gibs: null,
    para: 'Cirros finos y altos, incluidos los que el visible confunde con bruma y los que el infrarrojo apenas insinúa.',
    leer: 'A 1.37 µm el vapor de agua de los niveles bajos absorbe casi toda la radiación solar, así que el suelo y la nube baja salen NEGROS: lo único que aparece brillante es el hielo por encima de unos 6 km. Un velo claro sobre fondo negro es cirro, y el cirro que se extiende sobre la ruta es el yunque de una célula que ya está descargando. Solo sirve de día.',
  },
  band_05: {
    nombre: 'Nieve y hielo', canal: 'Banda 5', onda: '1.6 µm', resolucion: '1 km', zoom: 4, gibs: null,
    para: 'Separa la nube de agua líquida de la nube de hielo. Es la banda del engelamiento.',
    leer: 'Al revés que el visible: el hielo absorbe a 1.6 µm y sale OSCURO, mientras que la gota de agua sobreenfriada sale clara. Lo que se ve claro aquí y frío en la banda 13 es lo que engela.',
  },
  band_07: {
    nombre: 'Ventana de onda corta', canal: 'Banda 7', onda: '3.9 µm', resolucion: '2 km', zoom: 3, gibs: null,
    para: 'Niebla y estratos bajos de madrugada, focos de calor, y —restada de la banda 13— el producto clásico de nube baja nocturna.',
    leer: 'De noche los estratos bajos contrastan con el suelo porque emiten distinto a 3.9 y a 10.3 µm. De día mezcla emisión térmica y reflexión solar: las nubes de gota pequeña se ven brillantes.',
  },
  band_09: {
    nombre: 'Vapor de agua, nivel medio', canal: 'Banda 9', onda: '6.9 µm', resolucion: '2 km', zoom: 3, gibs: null,
    para: 'Humedad y circulación de la troposfera media, hacia 400–500 hPa. No llega a ver el suelo: ve la capa que este avión tiene por encima.',
    leer: 'Oscuro = aire seco y descendente; claro = aire húmedo o nube alta. Lo que importa aquí no son las manchas sino los BORDES: un límite marcado entre zona clara y zona oscura es un cortante de viento, y ahí es donde aparece la turbulencia en aire claro. Funciona de día y de noche.',
  },
  band_10: {
    nombre: 'Vapor de agua, nivel bajo', canal: 'Banda 10', onda: '7.3 µm', resolucion: '2 km', zoom: 3, gibs: null,
    para: 'Humedad de la troposfera baja y media, hacia 600–750 hPa: la capa en la que de verdad vuela un turbohélice a FL210.',
    leer: 'Es la banda de vapor más próxima al nivel de crucero de este vuelo. Las lenguas oscuras son intrusiones de aire seco, que ahogan la convección; las claras son la humedad que la alimenta. Comparada con la banda 9 dice si la humedad está abajo o arriba, que es lo que decide si la célula crece. Funciona de día y de noche.',
  },
  band_13: {
    nombre: 'Infrarrojo ventana limpia', canal: 'Banda 13', onda: '10.3 µm', resolucion: '2 km', zoom: 3,
    gibs: 'GOES-East_ABI_Band13_Clean_Infrared',
    para: 'Temperatura de brillo del tope de nube. Es la banda que cuantifica la severidad convectiva.',
    leer: 'Topes por debajo de −60 °C indican convección profunda con probable granizo, turbulencia severa y actividad eléctrica. Funciona de día y de noche.',
  },
};

/* ===================== Argumentos ===================== */
function argumento(nombre, pordefecto = null) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : pordefecto;
}
const bandera = (n) => process.argv.includes(`--${n}`);

/* ===================== Proyección geoestacionaria =====================
   GOES-R PUG vol. 3 §5.1.2.8. El disco completo abarca siempre el mismo ángulo
   de barrido —±0,151872 rad medido al BORDE de la imagen— sea cual sea la
   resolución; por eso el paso de ángulo a píxel solo necesita el lado en píxeles,
   y sale igual de válido a 2 km, 1 km o 0,5 km. */
const R_EQ = 6378137.0;
const R_POL = 6356752.31414;
const H_SAT = 42164160.0;                       // distancia al centro de la Tierra
const E2 = 1 - (R_POL * R_POL) / (R_EQ * R_EQ); // excentricidad al cuadrado
const BORDE = 0.151872;                         // rad, borde del disco completo

// Meridiano subsatélite. Nominal de GOES-East; se puede forzar con --lonsat
// si la verificación contra GIBS demostrara que no es este.
const LON_SAT = Number(argumento('lonsat', '-75.0'));

/** lat/lon en grados → ángulos de barrido (x este-oeste, y norte-sur) en radianes. */
function aEscaneo(latGrados, lonGrados, lonSat = LON_SAT) {
  const lat = (latGrados * Math.PI) / 180;
  const lon = (lonGrados * Math.PI) / 180;
  const lon0 = (lonSat * Math.PI) / 180;

  const latGeocentrica = Math.atan(((R_POL * R_POL) / (R_EQ * R_EQ)) * Math.tan(lat));
  const rc = R_POL / Math.sqrt(1 - E2 * Math.cos(latGeocentrica) ** 2);

  const sx = H_SAT - rc * Math.cos(latGeocentrica) * Math.cos(lon - lon0);
  const sy = -rc * Math.cos(latGeocentrica) * Math.sin(lon - lon0);
  const sz = rc * Math.sin(latGeocentrica);

  // Punto al otro lado del planeta: no lo ve el satélite.
  const visible = H_SAT * (H_SAT - sx) >= sy * sy + ((R_EQ * R_EQ) / (R_POL * R_POL)) * sz * sz;

  return {
    x: Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz)),
    y: Math.atan(sz / sx),
    visible,
  };
}

/** Ángulos de barrido → píxel dentro de la imagen de disco completo de ese zoom. */
function aPixel(x, y, zoom) {
  const lado = LADO_TESELA * 2 ** zoom;
  return {
    col: ((x + BORDE) / (2 * BORDE)) * lado,
    fila: ((BORDE - y) / (2 * BORDE)) * lado,
    lado,
  };
}

/** Píxel → lat/lon. Inversa del PUG; sirve para dibujar el contorno del recorte. */
function aLatLon(col, fila, zoom, lonSat = LON_SAT) {
  const lado = LADO_TESELA * 2 ** zoom;
  const x = (col / lado) * 2 * BORDE - BORDE;
  const y = BORDE - (fila / lado) * 2 * BORDE;

  const razon = (R_EQ * R_EQ) / (R_POL * R_POL);
  const a = Math.sin(x) ** 2 + Math.cos(x) ** 2 * (Math.cos(y) ** 2 + razon * Math.sin(y) ** 2);
  const b = -2 * H_SAT * Math.cos(x) * Math.cos(y);
  const c = H_SAT * H_SAT - R_EQ * R_EQ;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null; // fuera del disco

  const rs = (-b - Math.sqrt(disc)) / (2 * a);
  const sx = rs * Math.cos(x) * Math.cos(y);
  const sy = -rs * Math.sin(x);
  const sz = rs * Math.cos(x) * Math.sin(y);

  return {
    lat: (Math.atan(razon * (sz / Math.sqrt((H_SAT - sx) ** 2 + sy * sy))) * 180) / Math.PI,
    lon: ((lonSat * Math.PI) / 180 - Math.atan(sy / (H_SAT - sx))) * (180 / Math.PI),
  };
}

/**
 * Ventana de píxeles que cubre la caja geográfica.
 * Se recorre el perímetro, no solo las esquinas: en proyección geoestacionaria
 * los paralelos y meridianos salen curvos y las esquinas se quedan cortas.
 */
function ventanaPixeles(caja, zoom) {
  const { latMin, latMax, lonMin, lonMax } = caja;
  let colMin = Infinity, colMax = -Infinity, filaMin = Infinity, filaMax = -Infinity;
  let fuera = 0;
  const N = 80;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const puntos = [
      [latMin + (latMax - latMin) * t, lonMin],
      [latMin + (latMax - latMin) * t, lonMax],
      [latMin, lonMin + (lonMax - lonMin) * t],
      [latMax, lonMin + (lonMax - lonMin) * t],
    ];
    for (const [la, lo] of puntos) {
      const e = aEscaneo(la, lo);
      if (!e.visible) { fuera++; continue; }
      const p = aPixel(e.x, e.y, zoom);
      colMin = Math.min(colMin, p.col); colMax = Math.max(colMax, p.col);
      filaMin = Math.min(filaMin, p.fila); filaMax = Math.max(filaMax, p.fila);
    }
  }
  if (fuera) throw new Error(`${fuera} puntos de la caja quedan fuera del disco visible del satélite`);

  const lado = LADO_TESELA * 2 ** zoom;
  const x0 = Math.max(0, Math.floor(colMin));
  const y0 = Math.max(0, Math.floor(filaMin));
  const x1 = Math.min(lado, Math.ceil(colMax));
  const y1 = Math.min(lado, Math.ceil(filaMax));

  return { x0, y0, ancho: x1 - x0, alto: y1 - y0 };
}

// La ventana se calcula UNA vez a este zoom y las demás bandas la heredan
// multiplicada por potencias de dos. Así las cinco cubren exactamente el mismo
// trozo de mundo: sin esto, el redondeo a píxel entero de cada zoom las
// descuadraba un par de kilómetros y la cortina comparadora no casaba.
const ZOOM_BASE = 3;

function escalarVentana(base, zoom) {
  const f = 2 ** (zoom - ZOOM_BASE);
  const x0 = base.x0 * f, y0 = base.y0 * f;
  const ancho = base.ancho * f, alto = base.alto * f;
  return {
    x0, y0, ancho, alto,
    teselaX0: Math.floor(x0 / LADO_TESELA),
    teselaY0: Math.floor(y0 / LADO_TESELA),
    teselaX1: Math.floor((x0 + ancho - 1) / LADO_TESELA),
    teselaY1: Math.floor((y0 + alto - 1) / LADO_TESELA),
    zoom,
    lado: LADO_TESELA * 2 ** zoom,
  };
}

/** Contorno geográfico real del recorte, recorriendo su perímetro en píxeles. */
function contornoDelRecorte(ventana) {
  const puntos = [];
  const N = 24;
  const borde = [];
  for (let i = 0; i <= N; i++) borde.push([ventana.x0 + (ventana.ancho * i) / N, ventana.y0]);
  for (let i = 0; i <= N; i++) borde.push([ventana.x0 + ventana.ancho, ventana.y0 + (ventana.alto * i) / N]);
  for (let i = N; i >= 0; i--) borde.push([ventana.x0 + (ventana.ancho * i) / N, ventana.y0 + ventana.alto]);
  for (let i = N; i >= 0; i--) borde.push([ventana.x0, ventana.y0 + (ventana.alto * i) / N]);

  for (const [c, f] of borde) {
    const p = aLatLon(c, f, ventana.zoom);
    if (p) puntos.push([+p.lat.toFixed(4), +p.lon.toFixed(4)]);
  }
  return puntos;
}

/* ===================== Caja de cobertura =====================
   El caso es un corredor, pero el visor tiene que servir para mirar el país
   entero: las bandas se recortan a Colombia completa, no solo a la ruta. La caja
   es la UNIÓN de dos cosas, así que ampliar la cobertura nunca puede dejar fuera
   un trozo de ruta:

     - el territorio colombiano publicado (continental + archipiélago de San
       Andrés, Providencia y Santa Catalina), y
     - la propia ruta del caso,

   ambos con el mismo margen. Con --solo-ruta se vuelve al recorte de antes. */
const COLOMBIA = {
  // Puntos extremos del territorio nacional, en grados decimales:
  //   N  Punta Gallinas (Guajira)          12°27'46\" N
  //   S  Quebrada San Antonio (Amazonas)    4°13'30\" S
  //   E  Isla San José / Piedra del Cocuy  66°50'54\" W
  //   O  Cabo Manglares (Nariño)           79°01'23\" W
  //   Insular: Providencia y Santa Catalina 13.40 N / 81.75 W
  latMin: -4.23, latMax: 13.40, lonMin: -81.75, lonMax: -66.85,
  _nota: 'Extremos continentales e insulares del territorio colombiano. No incluye los cayos del norte del archipiélago (Serranilla, Bajo Nuevo), que quedarían a más de 15 °N y ensancharían el recorte sin aportar nada a este caso.',
};

async function cajaDeLaRuta(margen) {
  const caso = JSON.parse(await readFile(join(RAIZ, 'datos', 'caso.json'), 'utf8'));

  // --caja latMin,latMax,lonMin,lonMax fuerza una zona distinta a la de la ruta.
  // Sirve para verificar la proyección sobre una costa reconocible, que es la
  // única forma de comprobar la geolocalización sin fiarse de la propia fórmula.
  const forzada = argumento('caja');
  if (forzada) {
    const [latMin, latMax, lonMin, lonMax] = forzada.split(',').map(Number);
    return { caso, caja: { latMin, latMax, lonMin, lonMax } };
  }

  const lats = caso.ruta.waypoints.map((w) => w.lat).concat(caso.aerodromos.map((a) => a.lat));
  const lons = caso.ruta.waypoints.map((w) => w.lon).concat(caso.aerodromos.map((a) => a.lon));
  const ruta = {
    latMin: Math.min(...lats) - margen,
    latMax: Math.max(...lats) + margen,
    lonMin: Math.min(...lons) - margen,
    lonMax: Math.max(...lons) + margen,
  };
  if (bandera('solo-ruta')) return { caso, caja: ruta, cobertura: 'ruta' };

  return {
    caso,
    cobertura: 'nacional',
    caja: {
      latMin: Math.min(ruta.latMin, COLOMBIA.latMin - margen),
      latMax: Math.max(ruta.latMax, COLOMBIA.latMax + margen),
      lonMin: Math.min(ruta.lonMin, COLOMBIA.lonMin - margen),
      lonMax: Math.max(ruta.lonMax, COLOMBIA.lonMax + margen),
    },
  };
}

/* ===================== Descarga ===================== */
// Cinco intentos con espera creciente: son miles de teselas seguidas contra un
// servidor en Colorado y un corte de un segundo tumbaba la banda entera.
async function pedirBinario(url, intentos = 5) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === intentos) throw new Error(`${e.message} — ${url}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

/** Ejecuta la tarea sobre cada elemento con un tope de tareas simultáneas. */
async function enParalelo(elementos, tope, tarea) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(tope, elementos.length) }, async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      resultados[i] = await tarea(elementos[i]);
    }
  });
  await Promise.all(obreros);
  return resultados;
}

async function pedirJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** Sellos temporales publicados para una banda y una fecha, en orden ascendente. */
async function sellosDe(banda, fecha) {
  const j = await pedirJSON(`${SLIDER}/data/json/${SATELITE}/${SECTOR}/${banda}/${fecha}_by_hour.json`);
  return Object.values(j.timestamps_int || {}).flat().map(String).sort();
}

const urlTesela = (banda, fecha, sello, zoom, fila, col) =>
  `${SLIDER}/data/imagery/${fecha.slice(0, 4)}/${fecha.slice(4, 6)}/${fecha.slice(6, 8)}` +
  `/${SATELITE}---${SECTOR}/${banda}/${sello}/${String(zoom).padStart(2, '0')}` +
  `/${String(fila).padStart(3, '0')}_${String(col).padStart(3, '0')}.png`;

/* ===================== Composición con el navegador =====================
   Se usa Chromium (el de Playwright, ya instalado) como compositor de imagen:
   dibuja las teselas en un canvas y devuelve el recorte en JPEG. Evita añadir
   sharp o jimp a un proyecto que no tiene package.json ni node_modules. */
function resolverPlaywright() {
  const candidatos = [RAIZ, join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx')];
  for (const base of candidatos) {
    try {
      return createRequire(join(base, 'x.js'))('playwright');
    } catch { /* sigue buscando */ }
  }
  // Último recurso: rastrear la caché de npx, donde lo deja `npx playwright`.
  const cache = join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache)) {
      const modulos = join(cache, d, 'node_modules');
      if (existsSync(join(modulos, 'playwright'))) return createRequire(join(modulos, 'x.js'))('playwright');
    }
  }
  throw new Error('No se encontró Playwright. Instálalo con: npx playwright install chromium');
}

async function abrirCompositor() {
  const { chromium } = resolverPlaywright();
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  return { navegador, pagina };
}

/** Dibuja las teselas en un canvas y devuelve el recorte como Buffer JPEG. */
async function componer(pagina, teselas, ventana, calidad) {
  const dataUrl = await pagina.evaluate(
    async ({ teselas, ventana, calidad, LADO }) => {
      const lienzo = document.createElement('canvas');
      lienzo.width = ventana.ancho;
      lienzo.height = ventana.alto;
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);

      for (const t of teselas) {
        const img = new Image();
        await new Promise((ok, mal) => {
          img.onload = ok;
          img.onerror = () => mal(new Error('tesela ilegible'));
          img.src = t.datos;
        });
        // Posición de la tesela dentro del disco, menos el origen del recorte.
        ctx.drawImage(img, t.col * LADO - ventana.x0, t.fila * LADO - ventana.y0);
      }
      return lienzo.toDataURL('image/jpeg', calidad);
    },
    { teselas, ventana, calidad, LADO: LADO_TESELA }
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/* ===================== Captura de una banda ===================== */
async function capturarBanda(pagina, banda, fecha, sellos, ventana, zoom, calidad, registro, caja) {
  const carpeta = join(MEDIOS, banda);
  await mkdir(carpeta, { recursive: true });
  const cuadros = [];

  // Un cuadro solo se reutiliza si se generó con LA MISMA fecha, zoom y recorte,
  // Y ADEMÁS lo escribió esa misma configuración. Las dos condiciones hacen falta:
  //
  //   - Sin la primera, una prueba sobre otra zona dejaría archivos con el mismo
  //     nombre y la serie definitiva los daría por buenos.
  //   - Sin la segunda, un cuadro de OTRO DÍA que el servidor no publica hoy
  //     sobrevive con el mismo nombre —la configuración ya coincide, así que la
  //     ficha no protege— y se cuela en la serie sin que nada avise. Pasó de
  //     verdad: al mover el caso del 01 al 04 de septiembre, los cuadros de las
  //     1640Z y 1740Z del día 1 se reutilizaron como si fueran del día 4.
  //
  // Por eso la ficha lleva también la lista de sellos que produjo. Si falta —fichas
  // de versiones anteriores de este script— no se reutiliza nada: se rehace.
  const fichaRuta = join(carpeta, 'parametros.json');
  const ficha = { fecha, zoom, caja, ventana: { x0: ventana.x0, y0: ventana.y0, ancho: ventana.ancho, alto: ventana.alto } };

  let previa = null;
  if (existsSync(fichaRuta)) {
    try { previa = JSON.parse(await readFile(fichaRuta, 'utf8')); } catch { previa = null; }
  }
  const mismaConfig = previa
    && JSON.stringify({ fecha: previa.fecha, zoom: previa.zoom, caja: previa.caja, ventana: previa.ventana }) === JSON.stringify(ficha);
  const yaCapturados = new Set(mismaConfig && Array.isArray(previa.capturados) ? previa.capturados : []);

  // Al cambiar los parámetros hay que BORRAR lo que quedó de la captura anterior,
  // no solo rehacer lo que toque esta ventana.
  if (previa && !mismaConfig) {
    const viejos = readdirSync(carpeta).filter((f) => /^\d{4}z\.jpg$/.test(f) || f === 'animacion.webm');
    for (const f of viejos) await rm(join(carpeta, f), { force: true });
    console.log('    parámetros distintos a los de la captura anterior: se borran %d cuadros y se rehacen', viejos.length);
  }
  // La ficha se guarda tras CADA cuadro, no al terminar la banda. Un fallo de red
  // a mitad de la banda 2 —28 cuadros de 36 teselas— echaría a perder media hora de
  // descarga si el registro solo existiera al final.
  const guardarFicha = () =>
    writeFile(fichaRuta, JSON.stringify({ ...ficha, capturados: [...yaCapturados].sort() }, null, 2), 'utf8');
  await guardarFicha();

  for (const sello of sellos) {
    const hhmm = sello.slice(8, 12);
    const destino = join(carpeta, `${hhmm}z.jpg`);

    if (yaCapturados.has(hhmm) && existsSync(destino)) {
      cuadros.push({ sello, hhmm, archivo: `medios/satelite/${banda}/${hhmm}z.jpg`, reutilizado: true });
      process.stdout.write('·');
      continue;
    }

    const pendientes = [];
    for (let fila = ventana.teselaY0; fila <= ventana.teselaY1; fila++) {
      for (let col = ventana.teselaX0; col <= ventana.teselaX1; col++) {
        pendientes.push({ fila, col, url: urlTesela(banda, fecha, sello, zoom, fila, col) });
      }
    }

    // En serie, un cuadro de la banda 2 son 36 viajes de ida y vuelta a Colorado.
    // Pero a zoom 5 las teselas pesan lo suyo y con seis peticiones simultáneas el
    // servidor acaba cortando la conexión, así que se baja el paralelismo donde
    // más grande es cada tesela.
    const simultaneas = zoom >= 5 ? 3 : 6;
    let bytes = 0;
    try {
      const teselas = await enParalelo(pendientes, simultaneas, async (t) => {
        const buf = await pedirBinario(t.url);
        bytes += buf.length;
        return { fila: t.fila, col: t.col, datos: `data:image/png;base64,${buf.toString('base64')}` };
      });

      const jpeg = await componer(pagina, teselas, ventana, calidad);
      await writeFile(destino, jpeg);
      cuadros.push({ sello, hhmm, archivo: `medios/satelite/${banda}/${hhmm}z.jpg`, bytesTeselas: bytes, bytesSalida: jpeg.length });
      yaCapturados.add(hhmm);
      await guardarFicha();
      registro.descargados += teselas.length;
      registro.bytesDescargados += bytes;
      process.stdout.write('#');
    } catch (e) {
      // Un corte de red no puede tirar una descarga de media hora. El cuadro queda
      // sin bajar y se anota como fallo de red —que no es lo mismo que un cuadro
      // que el satélite no publicó—; repetir el comando lo completa.
      registro.fallidos.push({ banda, hhmm, motivo: e.message.split(' — ')[0] });
      process.stdout.write('x');
    }
  }

  process.stdout.write('\n');

  // Lo que no esté en la lista se borra: es un cuadro de una captura anterior que
  // el servidor ya no publica para esta fecha, justo el archivo que se colaría en
  // la siguiente pasada incremental haciéndose pasar por bueno.

  const huerfanos = readdirSync(carpeta).filter((f) => /^\d{4}z\.jpg$/.test(f) && !yaCapturados.has(f.slice(0, 4)));
  for (const f of huerfanos) await rm(join(carpeta, f), { force: true });
  if (huerfanos.length) {
    console.log('    %d cuadro(s) sobrante(s) de una captura anterior, borrados: %s', huerfanos.length, huerfanos.join(' '));
  }

  return cuadros;
}

/* ===================== Vídeo ===================== */
function rutaFfmpeg() {
  const base = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    if (!d.startsWith('ffmpeg')) continue;
    const exe = join(base, d, 'ffmpeg-win64.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * Arma la animación de una banda.
 *
 * El ffmpeg que trae Playwright es una compilación mínima: no tiene el demuxer
 * `concat` ni `image2` de fichero, solo `image2pipe`, y como codificador de vídeo
 * solo VP8. Así que los cuadros se le pasan por la tubería de entrada, en orden, y
 * la salida es WebM. No hay forma de sacar MP4 con este binario.
 */
async function armarVideo(banda, cuadros) {
  const ff = rutaFfmpeg();
  if (!ff) return { ok: false, motivo: 'no se encontró ffmpeg' };
  if (cuadros.length < 2) return { ok: false, motivo: 'hacen falta al menos dos cuadros' };

  const salida = join(MEDIOS, banda, 'animacion.webm');
  // Este build exige `pipe:0` explícito: con `-` responde «Protocol not found».
  const args = [
    '-y', '-f', 'image2pipe', '-framerate', '6', '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libvpx', '-b:v', '2M', '-pix_fmt', 'yuv420p', salida,
  ];

  return new Promise((resolver) => {
    const p = spawn(ff, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    let resuelto = false;
    const terminar = (r) => { if (!resuelto) { resuelto = true; resolver(r); } };

    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => terminar({ ok: false, motivo: e.message }));
    // Si ffmpeg muere a media escritura, la tubería rompe: se recoge aquí en vez
    // de dejar que el error sin capturar tumbe el proceso entero.
    p.stdin.on('error', () => {});
    p.on('close', (codigo) => {
      terminar(codigo === 0
        ? { ok: true, archivo: `medios/satelite/${banda}/animacion.webm`, cuadros: cuadros.length }
        : { ok: false, motivo: err.trim().split('\n').filter(Boolean).slice(-2).join(' · ') });
    });

    // En orden cronológico, que es como se nombraron los archivos.
    (async () => {
      for (const c of [...cuadros].sort((a, b) => a.hhmm.localeCompare(b.hhmm))) {
        if (resuelto || p.stdin.destroyed) break;
        const buf = await readFile(join(RAIZ, ...c.archivo.split('/')));
        if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
      }
      p.stdin.end();
    })().catch(() => p.stdin.destroy());
  });
}

/* ===================== Referencia GIBS para verificar ===================== */
async function referenciaGIBS(banda, caja, instanteISO) {
  const capa = BANDAS[banda].gibs;
  if (!capa) return null;
  // Web Mercator: mismos límites que la caja, ya georreferenciados por la NASA.
  const aMercator = (lat, lon) => {
    const x = (lon * 20037508.34) / 180;
    const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
    return [x, y];
  };
  const [xMin, yMin] = aMercator(caja.latMin, caja.lonMin);
  const [xMax, yMax] = aMercator(caja.latMax, caja.lonMax);
  const url = `${GIBS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${capa}&CRS=EPSG:3857` +
    `&BBOX=${xMin},${yMin},${xMax},${yMax}&WIDTH=1000&HEIGHT=${Math.round((1000 * (yMax - yMin)) / (xMax - xMin))}` +
    `&FORMAT=image/jpeg&TIME=${instanteISO}`;
  return { url, datos: await pedirBinario(url) };
}

/* ===================== Principal ===================== */
async function main() {
  // 1.5° de margen alrededor de Colombia: bastante para ver de dónde vienen los
  // sistemas que entran al país sin doblar el peso de cada cuadro. Sobre la ruta
  // el margen efectivo es mucho mayor, porque la caja nacional la desborda por
  // los cuatro lados.
  const margen = Number(argumento('margen', '1.5'));
  const { caso, caja, cobertura } = await cajaDeLaRuta(margen);

  const analisis = new Date(caso.ventanaTiempo.horaAnalisisZ);
  const p2 = (n) => String(n).padStart(2, '0');
  const fecha = argumento('fecha', `${analisis.getUTCFullYear()}${p2(analisis.getUTCMonth() + 1)}${p2(analisis.getUTCDate())}`);
  // Por defecto, la ventana declarada en el caso: una hora antes de la salida y
  // una hora después de la ETA. Se puede acotar con --desde/--hasta.
  const hhmm = (iso) => { const d = new Date(iso); return `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`; };
  const desde = argumento('desde', hhmm(caso.ventanaTiempo.inicioZ));
  const hasta = argumento('hasta', hhmm(caso.ventanaTiempo.finZ));
  const paso = Number(argumento('paso', '10'));
  const calidad = Number(argumento('calidad', '0.85'));
  const soloVerificar = bandera('verificar');
  const listaBandas = (argumento('bandas') || Object.keys(BANDAS).join(',')).split(',').filter((b) => BANDAS[b]);

  console.log('\n  Caja de cobertura %s (con %s° de margen):', cobertura, margen);
  console.log('    lat %s … %s   lon %s … %s', caja.latMin.toFixed(2), caja.latMax.toFixed(2), caja.lonMin.toFixed(2), caja.lonMax.toFixed(2));
  console.log('  Meridiano subsatélite: %s°', LON_SAT);
  console.log('  Fecha %s · ventana %sZ–%sZ · paso %d min%s\n', fecha, desde, hasta, paso, soloVerificar ? ' · MODO VERIFICACIÓN (un cuadro)' : '');

  const ventanaBase = ventanaPixeles(caja, ZOOM_BASE);
  const contorno = contornoDelRecorte({ ...ventanaBase, zoom: ZOOM_BASE });
  const lats = contorno.map((p) => p[0]), lons = contorno.map((p) => p[1]);
  console.log('  Recorte real: lat %s … %s   lon %s … %s',
    Math.min(...lats).toFixed(2), Math.max(...lats).toFixed(2),
    Math.min(...lons).toFixed(2), Math.max(...lons).toFixed(2));

  const { navegador, pagina } = await abrirCompositor();
  const registro = { descargados: 0, bytesDescargados: 0, bandas: {}, huecos: [], fallidos: [], contorno, ventanaBase };

  try {
    for (const banda of listaBandas) {
      const meta = BANDAS[banda];
      const zoom = Number((argumento('zoom') || '').split(',').map((s) => s.split('=')).find(([b]) => b === banda)?.[1] ?? meta.zoom);
      const ventana = escalarVentana(ventanaBase, zoom);

      const todos = await sellosDe(banda, fecha);
      let sellos = todos.filter((s) => {
        const hhmm = s.slice(8, 12);
        if (hhmm < desde || hhmm > hasta) return false;
        return Number(hhmm.slice(2)) % paso === 0;
      });
      if (soloVerificar) sellos = sellos.slice(0, 1);

      const esperados = Math.floor(((Number(hasta.slice(0, 2)) * 60 + Number(hasta.slice(2))) -
        (Number(desde.slice(0, 2)) * 60 + Number(desde.slice(2)))) / paso) + 1;
      if (!soloVerificar && sellos.length < esperados) {
        registro.huecos.push(`${banda}: ${sellos.length} de ${esperados} cuadros esperados`);
      }

      const teselasPorCuadro = (ventana.teselaX1 - ventana.teselaX0 + 1) * (ventana.teselaY1 - ventana.teselaY0 + 1);
      console.log('  %s  %s · zoom %d · recorte %d×%d px · %d teselas/cuadro · %d cuadros',
        banda.padEnd(8), meta.onda.padEnd(8), zoom, ventana.ancho, ventana.alto, teselasPorCuadro, sellos.length);

      const cuadros = await capturarBanda(pagina, banda, fecha, sellos, ventana, zoom, calidad, registro, caja);
      registro.bandas[banda] = { meta, zoom, ventana, cuadros, teselasPorCuadro };

      if (soloVerificar && meta.gibs && cuadros[0]) {
        const s = cuadros[0].sello;
        const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00Z`;
        const ref = await referenciaGIBS(banda, caja, iso);
        if (ref) {
          const destino = join(MEDIOS, `referencia-gibs-${banda}.jpg`);
          await writeFile(destino, ref.datos);
          registro.bandas[banda].gibs = { url: ref.url, archivo: `medios/satelite/referencia-gibs-${banda}.jpg` };
          console.log('    referencia GIBS guardada para contrastar geolocalización');
        }
      }
    }
  } finally {
    await navegador.close();
  }

  if (!soloVerificar && !bandera('sin-video')) {
    console.log('\n  Armando animaciones…');
    for (const banda of listaBandas) {
      const r = await armarVideo(banda, registro.bandas[banda].cuadros);
      registro.bandas[banda].video = r;
      console.log('    %s  %s', banda.padEnd(8), r.ok ? r.archivo : `sin vídeo (${r.motivo})`);
    }
  }

  if (bandera('aplicar')) await aplicarAlCaso(registro, fecha, caja);

  await escribirInforme(registro, { fecha, desde, hasta, paso, caja, margen, cobertura, soloVerificar });

  console.log('\n  %d teselas descargadas · %s MB', registro.descargados, (registro.bytesDescargados / 1048576).toFixed(1));
  if (registro.huecos.length) {
    console.log('  HUECOS DECLARADOS:');
    registro.huecos.forEach((h) => console.log('    ' + h));
  }
  if (registro.fallidos.length) {
    console.log('  CUADROS QUE FALLARON POR RED (repite el comando para completarlos):');
    registro.fallidos.forEach((f) => console.log('    %s %sZ — %s', f.banda, f.hhmm, f.motivo));
  }
  console.log('  Informe: medios/satelite/verificacion.md\n');
}

/* ===================== Integración en el caso ===================== */
/**
 * Reescribe caso.satelite.bandas con lo que hay realmente en disco.
 * Se llama con --aplicar, nunca de forma automática: mientras la captura sea de
 * una fecha distinta a la del caso, mezclarlas daría un análisis falso.
 */
async function aplicarAlCaso(registro, fecha, caja) {
  const ruta = join(RAIZ, 'datos', 'caso.json');
  const caso = JSON.parse(await readFile(ruta, 'utf8'));

  const fechaCaso = new Date(caso.ventanaTiempo.horaAnalisisZ);
  const p2 = (n) => String(n).padStart(2, '0');
  const selloCaso = `${fechaCaso.getUTCFullYear()}${p2(fechaCaso.getUTCMonth() + 1)}${p2(fechaCaso.getUTCDate())}`;
  if (selloCaso !== fecha) {
    console.log('\n  AVISO: las imágenes son del %s y el caso analiza el %s.', fecha, selloCaso);
    console.log('  No se aplican: sería mezclar dos días distintos en el mismo análisis.\n');
    return;
  }

  const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;
  caso.satelite = {
    plataforma: 'GOES-19 (GOES-East)',
    sector: 'Full Disk, recortado a Colombia entera (continental e insular) mas margen',
    fuente: 'CIRA/RAMMB SLIDER — Colorado State University',
    urlFuente: `${SLIDER}/`,
    _recorte: {
      caja,
      // Con esto el visor puede situar la ruta y el avión DENTRO de la imagen:
      // repite la misma proyección en el navegador y sabe a qué píxel cae cada
      // latitud y longitud. Sin estos parámetros, las bandas serían dos fotos
      // bonitas sin forma de saber qué trozo de mundo son.
      proyeccion: {
        lonSat: LON_SAT, borde: BORDE, radioEcuatorial: R_EQ, radioPolar: R_POL, alturaSatelite: H_SAT,
      },
      contorno: registro.contorno,
      cobertura: 'Colombia completa (continental e insular) más margen, no solo el corredor de la ruta.',
      nota: 'Recorte calculado con la proyección geoestacionaria del GOES-R PUG y verificado contra NASA GIBS: ver medios/satelite/verificacion.md. Todas las bandas comparten el mismo contorno geográfico.',
    },
    bandas: Object.entries(registro.bandas).map(([banda, d]) => ({
      id: banda,
      nombre: d.meta.nombre,
      canal: d.meta.canal,
      longitudOnda: d.meta.onda,
      resolucion: d.meta.resolucion,
      para: d.meta.para,
      leer: d.meta.leer,
      medio: {
        tipo: 'secuencia',
        cuadros: d.cuadros.map((c) => ({
          horaZ: `${iso}T${c.sello.slice(8, 10)}:${c.sello.slice(10, 12)}:00Z`,
          archivo: c.archivo,
        })),
      },
      // Ventana de píxeles dentro del disco completo: la usa el visor para
      // convertir latitud/longitud en coordenada de esta imagen concreta.
      geo: { zoom: d.zoom, lado: d.ventana.lado, x0: d.ventana.x0, y0: d.ventana.y0, ancho: d.ventana.ancho, alto: d.ventana.alto },
      permalink: `${SLIDER}/?sat=${SATELITE}&sec=${SECTOR}&p%5B0%5D=${banda}`,
      _procedencia: `Teselas de SLIDER a zoom ${d.zoom} (${d.meta.resolucion}, resolución nativa), recompuestas y recortadas a la caja de la ruta.`,
    })),
  };

  await writeFile(ruta, JSON.stringify(caso, null, 2), 'utf8');
  console.log('\n  datos/caso.json actualizado con %d bandas.', Object.keys(registro.bandas).length);
}

async function escribirInforme(registro, cfg) {
  await mkdir(MEDIOS, { recursive: true });
  const lineas = [
    '# Captura satelital — trazabilidad',
    '',
    `Generado por \`herramientas/capturar-satelite.mjs\` el ${new Date().toISOString()}.`,
    '',
    '## Parámetros',
    '',
    `- Satélite / sector: **${SATELITE} / ${SECTOR}**`,
    `- Fecha: **${cfg.fecha}** · ventana **${cfg.desde}Z–${cfg.hasta}Z** · paso **${cfg.paso} min**`,
    `- Caja de cobertura ${cfg.cobertura} (margen ${cfg.margen}°): lat ${cfg.caja.latMin.toFixed(3)} … ${cfg.caja.latMax.toFixed(3)}, lon ${cfg.caja.lonMin.toFixed(3)} … ${cfg.caja.lonMax.toFixed(3)}`,
    `- Meridiano subsatélite usado en la proyección: **${LON_SAT}°**`,
    cfg.soloVerificar ? '- **Modo verificación**: un solo cuadro por banda.' : '',
    '',
    '## Bandas',
    '',
    '| Banda | λ | Resolución | Zoom | Recorte | Teselas/cuadro | Cuadros | Vídeo |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const [banda, d] of Object.entries(registro.bandas)) {
    lineas.push(`| ${banda} — ${d.meta.nombre} | ${d.meta.onda} | ${d.meta.resolucion} | ${d.zoom} | ${d.ventana.ancho}×${d.ventana.alto} px | ${d.teselasPorCuadro} | ${d.cuadros.length} | ${d.video?.ok ? 'webm' : '—'} |`);
  }

  lineas.push('', '## Verificación de geolocalización', '');
  lineas.push('Las bandas 2 y 13 son las únicas que NASA GIBS publica georreferenciadas, así que');
  lineas.push('sirven de contraste independiente del recorte calculado aquí: misma caja, mismo');
  lineas.push('instante, dos proyecciones distintas. Si los accidentes geográficos y los bordes de');
  lineas.push('nube coinciden, la traducción de latitud/longitud a píxel es correcta — y lo es');
  lineas.push('también para las demás bandas, que usan exactamente la misma rejilla fija del ABI.');
  lineas.push('');

  const conGibs = Object.entries(registro.bandas).filter(([, d]) => d.gibs);
  for (const [banda, d] of conGibs) {
    lineas.push(`- **${banda}** (esta ejecución): \`${d.cuadros[0].archivo}\` frente a \`${d.gibs.archivo}\``);
    lineas.push(`  - GIBS: \`${d.gibs.url}\``);
  }

  // Las referencias de ejecuciones anteriores siguen siendo prueba válida: se citan
  // aunque esta pasada no las haya vuelto a bajar.
  const previas = existsSync(MEDIOS)
    ? readdirSync(MEDIOS).filter((f) => f.startsWith('referencia-gibs-') && !conGibs.some(([b]) => f.includes(b)))
    : [];
  for (const f of previas) {
    lineas.push(`- **${f.replace('referencia-gibs-', '').replace('.jpg', '')}**: referencia guardada en una verificación anterior — \`medios/satelite/${f}\``);
  }
  if (!conGibs.length && !previas.length) {
    lineas.push('_Sin referencia GIBS todavía. Se genera con `--verificar`._');
  }

  lineas.push('', '## URLs de origen', '');
  for (const [banda, d] of Object.entries(registro.bandas)) {
    const c = d.cuadros[0];
    if (!c) continue;
    lineas.push(`- **${banda}**: \`${urlTesela(banda, cfg.fecha, c.sello, d.zoom, d.ventana.teselaY0, d.ventana.teselaX0)}\` (primera tesela del primer cuadro)`);
  }

  if (registro.huecos.length) {
    lineas.push('', '## Huecos declarados', '');
    lineas.push('Cuadros que el servidor no publica. **No se rellenan con el vecino**: se dejan como hueco.');
    lineas.push('');
    registro.huecos.forEach((h) => lineas.push(`- ${h}`));
  }

  lineas.push('', '---', '',
    `Teselas descargadas: **${registro.descargados}** (${(registro.bytesDescargados / 1048576).toFixed(1)} MB).`,
    'Las teselas no se conservan: solo el recorte compuesto de cada cuadro.', '');

  await writeFile(join(MEDIOS, 'verificacion.md'), lineas.filter((l) => l !== '').join('\n') + '\n', 'utf8');
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
