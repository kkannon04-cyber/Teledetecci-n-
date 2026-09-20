// Deriva los fenómenos convectivos del caso a partir de las imágenes congeladas
// y los escribe en datos/fenomenos.geojson.
//
//   node herramientas/servidor.mjs          (en otra consola)
//   node herramientas/derivar-fenomenos.mjs
//
// POR QUÉ ASÍ Y NO A MANO. Un polígono dibujado a ojo sobre la imagen no se puede
// defender: nadie puede reproducirlo ni discutir dónde acaba. Este trazado sale de
// un umbral de temperatura de brillo declarado, aplicado a un cuadro concreto con
// su nombre de archivo, y se vuelve a obtener idéntico ejecutando esto otra vez.
// Lo que sigue siendo interpretación —que un núcleo de −70 °C implique granizo o
// turbulencia severa— va rotulado como interpretación, separado de la medida.
//
// POR QUÉ CON NAVEGADOR. Los cuadros son JPEG y el proyecto no tiene dependencias:
// no hay decodificador de JPEG en Node aquí. El navegador sí lo trae, y además es
// el mismo decodificador que usa el visor, así que la derivación y lo que se ve en
// pantalla salen exactamente del mismo píxel.
//
// SEGUIMIENTO. Cada núcleo se enlaza con el del cuadro anterior por proximidad de
// centroide, de modo que lo que se guarda no es una mancha suelta por imagen sino
// una CÉLULA con nacimiento, máximo y final. Esa es la diferencia entre una foto y
// un análisis.

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_VISOR || 'http://localhost:5173';

/* ---------- Criterios declarados ----------
   Los umbrales no se heredan de ningún estándar que este proyecto pueda citar, así
   que se declaran aquí con su razón y se pueden discutir uno a uno. El único que
   NO es una convención es el operacional: el nivel de crucero del propio caso. */

const CRITERIOS = {
  umbralNucleoC: -52,
  razonUmbral:
    'Corte para «convección profunda». A −52 °C el tope está, con el modelo de este caso, muy por encima del nivel de vuelo, y es un valor bajo de sobra para excluir el cirro delgado y la nubosidad media.',
  escalones: [
    { severidad: 'leve', hasta: -52, desde: -60 },
    { severidad: 'moderado', hasta: -60, desde: -70 },
    { severidad: 'severo', hasta: -70, desde: -999 },
  ],
  minPixeles: 80,
  razonMinPixeles:
    'A 2 km de resolución, 80 píxeles son unos 320 km². Por debajo de eso la componente es ruido de umbral o una torre aislada que no define un área a evitar.',
  corredorNM: 120,
  razonCorredor:
    'Solo se guardan los núcleos que llegan a 120 NM de la ruta. Más lejos no condicionan esta navegación y llenarían el archivo de células del resto del país.',
  enlaceMaxNM: 45,
  razonEnlace:
    'Dos núcleos de cuadros consecutivos (10 min) se consideran la misma célula si sus centroides distan menos de 45 NM: a 10 minutos eso son 270 kt de desplazamiento, techo generoso para propagación convectiva.',
  maxCelulas: 14,
};

const RAD = Math.PI / 180;
const RADIO_TIERRA_NM = 3440.065;

function distanciaNM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_NM * Math.asin(Math.sqrt(h));
}

/** Distancia de un punto al segmento, en NM, proyectando en plano local. */
function distanciaASegmento(p, a, b) {
  const kx = Math.cos(((a.lat + b.lat) / 2) * RAD) * 60;
  const ky = 60;
  const px = (p.lon - a.lon) * kx;
  const py = (p.lat - a.lat) * ky;
  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * ky;
  const l2 = bx * bx + by * by;
  const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

const distanciaARuta = (p, wps) => {
  let min = Infinity;
  for (let i = 1; i < wps.length; i++) {
    const d = distanciaASegmento(p, wps[i - 1], wps[i]);
    if (d < min) min = d;
  }
  return min;
};

/** ¿Algún punto de la ruta cae dentro del polígono? */
function rutaAtraviesa(anillo, wps, porSegmento = 60) {
  const dentro = (lat, lon) => {
    let d = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
  };
  // Se recorre segmento a segmento: repartir la fracción por número de waypoints
  // muestrearía de más los tramos cortos y de menos los largos, que es justo donde
  // está la Amazonía.
  for (let s = 1; s < wps.length; s++) {
    for (let k = 0; k <= porSegmento; k++) {
      const t = k / porSegmento;
      const lat = wps[s - 1].lat + (wps[s].lat - wps[s - 1].lat) * t;
      const lon = wps[s - 1].lon + (wps[s].lon - wps[s - 1].lon) * t;
      if (dentro(lat, lon)) return true;
    }
  }
  return false;
}

/* ---------- Trabajo dentro del navegador ---------- */

/** Prepara caso, tabla de color y tabla de consulta. Se hace una sola vez. */
async function inicializar() {
  const [util, rad, nuc, geo] = await Promise.all([
    import('/js/util.js'), import('/js/radiometria.js'),
    import('/js/nucleos.js'), import('/js/geoestacionaria.js'),
  ]);
  const caso = await util.cargarJSON('/datos/caso.json');
  const barras = await util.cargarJSON('/datos/barras-color.json');
  const banda = caso.satelite.bandas.find((b) => b.id === 'band_13');
  const lector = rad.crearLector(barras, 'band_13');
  window.__d = {
    caso, barras, banda, lector, nuc,
    tabla: nuc.construirTabla(lector),
    inversor: geo.crearInversor(caso.satelite._recorte.proyeccion, banda.geo),
    mue: await import('/js/muestreo.js'),
  };
  return {
    cuadros: banda.medio.cuadros.map((c) => ({ horaZ: c.horaZ, archivo: c.archivo })),
    geo: banda.geo,
  };
}

/** Procesa un cuadro y devuelve sus núcleos ya en latitud y longitud. */
async function procesarCuadro([indice, criterios]) {
  const d = window.__d;
  const c = d.banda.medio.cuadros[indice];
  const cuadro = await d.mue.cargarCuadro(c.archivo);
  const campo = d.nuc.campoTb(cuadro, d.tabla);
  const { etiqueta, lista } = d.nuc.componentes(campo, criterios.umbralNucleoC, criterios.minPixeles);

  const escalaX = cuadro.ancho / d.banda.geo.ancho;
  const escalaY = cuadro.alto / d.banda.geo.alto;
  const aLatLon = (px, py) => d.inversor(px / escalaX, py / escalaY);

  const salida = [];
  for (const comp of lista) {
    const bruto = d.nuc.contorno(etiqueta, campo.ancho, campo.alto, comp.etiqueta);
    if (bruto.length < 8) continue;
    const simple = d.nuc.simplificar(bruto, 2.2);
    const anillo = [];
    for (const [x, y] of simple) {
      const q = aLatLon(x + 0.5, y + 0.5);
      if (q) anillo.push([Number(q.lon.toFixed(4)), Number(q.lat.toFixed(4))]);
    }
    if (anillo.length < 4) continue;
    anillo.push(anillo[0]);

    const centro = aLatLon(comp.centro.x, comp.centro.y);
    if (!centro) continue;

    // Área: el píxel de la banda 13 son 2 km de lado en el nadir, pero sobre
    // Colombia el satélite mira oblicuo y el píxel se alarga. Se calcula el área
    // real del polígono en el plano local en vez de contar píxeles.
    let area2 = 0;
    const kx = Math.cos(centro.lat * Math.PI / 180) * 60;
    for (let i = 0, j = anillo.length - 2; i < anillo.length - 1; j = i++) {
      area2 += (anillo[j][0] * kx) * (anillo[i][1] * 60) - (anillo[i][0] * kx) * (anillo[j][1] * 60);
    }

    salida.push({
      anillo,
      centro: { lat: Number(centro.lat.toFixed(4)), lon: Number(centro.lon.toFixed(4)) },
      minTb: Number(comp.minTb.toFixed(1)),
      p05: Number(comp.p05.toFixed(1)),
      mediana: Number(comp.mediana.toFixed(1)),
      pixeles: comp.pixeles,
      areaNM2: Math.abs(area2 / 2),
    });
  }
  return { horaZ: c.horaZ, archivo: c.archivo, nucleos: salida, grisesResueltos: campo.grisesResueltos };
}

/* ---------- Programa ---------- */

async function main() {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    // Playwright no está instalado en el proyecto —que no tiene dependencias— sino
    // en la caché de npx. Se busca ahí antes de rendirse.
    const { execSync } = await import('node:child_process');
    const base = execSync('npm config get cache', { encoding: 'utf8' }).trim();
    const { readdirSync, existsSync } = await import('node:fs');
    const dir = join(base, '_npx');
    let hallado = null;
    for (const d of readdirSync(dir)) {
      const p = join(dir, d, 'node_modules', 'playwright', 'index.mjs');
      if (existsSync(p)) { hallado = p; break; }
    }
    if (!hallado) throw new Error('No se encontró Playwright. Instálalo con: npx playwright install chromium');
    ({ chromium } = await import('file:///' + hallado.replace(/\\/g, '/')));
  }

  console.log(`Abriendo ${BASE} …`);
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  const fallos = [];
  pagina.on('pageerror', (e) => fallos.push(e.message));
  await pagina.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  const info = await pagina.evaluate(inicializar);
  console.log(`Banda 13 · ${info.cuadros.length} cuadros · rejilla ${info.geo.ancho}×${info.geo.alto} px`);

  const porCuadro = [];
  for (let i = 0; i < info.cuadros.length; i++) {
    const r = await pagina.evaluate(procesarCuadro, [i, CRITERIOS]);
    porCuadro.push(r);
    process.stdout.write(
      `  ${r.horaZ.slice(11, 16)}Z  ${String(r.nucleos.length).padStart(2)} núcleos ≤ ${CRITERIOS.umbralNucleoC} °C` +
      `  (grises resueltos: ${r.grisesResueltos})\n`
    );
  }

  await navegador.close();
  if (fallos.length) console.warn('Avisos del navegador:', fallos.slice(0, 3));

  const caso = require('../datos/caso.json');
  const wps = caso.ruta.waypoints;

  /* ---------- Seguimiento: de manchas por cuadro a células con vida ---------- */

  const celulas = [];
  for (const cuadro of porCuadro) {
    for (const n of cuadro.nucleos) {
      const dRuta = distanciaARuta(n.centro, wps);
      if (dRuta > CRITERIOS.corredorNM) continue;

      // Se enlaza con la célula abierta más próxima del cuadro anterior, y solo
      // con una: sin esta exclusión, dos núcleos de este cuadro podrían declararse
      // los dos continuación de la misma célula.
      const idx = porCuadro.indexOf(cuadro);
      const previa = celulas
        .filter((c) => !c.enlazadaEn?.has?.(idx) && c.ultimoCuadro === idx - 1 &&
          distanciaNM(c.ultimoCentro, n.centro) <= CRITERIOS.enlaceMaxNM)
        .sort((a, b) => distanciaNM(a.ultimoCentro, n.centro) - distanciaNM(b.ultimoCentro, n.centro))[0];

      const paso = {
        horaZ: cuadro.horaZ,
        archivo: cuadro.archivo,
        minTb: n.minTb,
        p05: n.p05,
        mediana: n.mediana,
        areaNM2: Math.round(n.areaNM2),
        centro: n.centro,
        distanciaRutaNM: Number(dRuta.toFixed(1)),
        cruzaRuta: rutaAtraviesa(n.anillo, wps),
        anillo: n.anillo,
      };

      if (previa) {
        previa.pasos.push(paso);
        previa.ultimoCentro = n.centro;
        previa.ultimoCuadro = idx;
        previa.enlazadaEn.add(idx);
      } else {
        celulas.push({
          pasos: [paso],
          ultimoCentro: n.centro,
          ultimoCuadro: idx,
          enlazadaEn: new Set([idx]),
        });
      }
    }
  }

  /* ---------- Encuentro: ¿coincide el avión con la célula? ----------
     Que una célula cruce la traza y que el vuelo se la encuentre son dos cosas
     distintas: un cumulonimbo sobre ROKUL a las 2140Z no afecta a un avión que
     aterrizó a las 2055Z. Aquí se cruza la vida de cada célula con la posición que
     tiene la aeronave en ese mismo instante, que es la pregunta que de verdad
     contesta el análisis. */

  const salidaMs = new Date(caso.vuelo.salidaZ).getTime();
  const etaMs = new Date(caso.vuelo.etaZ).getTime();
  const totalNM = (() => {
    let t = 0;
    for (let i = 1; i < wps.length; i++) t += distanciaNM(wps[i - 1], wps[i]);
    return t;
  })();

  /** Posición de la aeronave a una hora dada, repartida por distancia real. */
  function posicionEn(ms) {
    const f = (ms - salidaMs) / (etaMs - salidaMs);
    if (f < 0 || f > 1) return null;
    let objetivo = totalNM * f;
    for (let i = 1; i < wps.length; i++) {
      const d = distanciaNM(wps[i - 1], wps[i]);
      if (objetivo <= d || i === wps.length - 1) {
        const t = d ? Math.min(1, objetivo / d) : 0;
        return {
          lat: wps[i - 1].lat + (wps[i].lat - wps[i - 1].lat) * t,
          lon: wps[i - 1].lon + (wps[i].lon - wps[i - 1].lon) * t,
          nm: totalNM * f,
        };
      }
      objetivo -= d;
    }
    return null;
  }

  for (const c of celulas) {
    let mejor = null;
    for (const p of c.pasos) {
      const pos = posicionEn(new Date(p.horaZ).getTime());
      if (!pos) continue;
      const d = distanciaNM(pos, p.centro);
      if (!mejor || d < mejor.distanciaNM) {
        mejor = {
          horaZ: p.horaZ,
          distanciaNM: Number(d.toFixed(1)),
          aeronaveNM: Math.round(pos.nm),
          minTb: p.minTb,
          dentroDelNucleo: p.cruzaRuta && d < 25,
        };
      }
    }
    c.encuentro = mejor;
  }

  // Orden de interés: manda el encuentro real con el vuelo; el frío solo desempata.
  const puntuar = (c) => {
    const e = c.encuentro;
    const enVuelo = e ? Math.max(0, 300 - e.distanciaNM) * 10 : 0;
    const cruza = c.pasos.some((p) => p.cruzaRuta) ? 200 : 0;
    return enVuelo + cruza - Math.min(...c.pasos.map((p) => p.minTb));
  };

  const elegidas = celulas
    .filter((c) => c.pasos.length >= 2)
    .sort((a, b) => puntuar(b) - puntuar(a))
    .slice(0, CRITERIOS.maxCelulas);

  /* ---------- A GeoJSON ---------- */

  const features = elegidas.map((c, i) => {
    // El cuadro «pico» es el del percentil 5 más frío, no el del mínimo absoluto:
    // representa el momento en que la célula está más desarrollada en ÁREA fría,
    // que es lo que importa, y no el instante en que un píxel suelto dio el valor
    // más bajo por ruido de compresión.
    const pico = c.pasos.reduce((a, b) => (b.p05 < a.p05 ? b : a));
    const minTb = pico.minTb;
    const p05 = pico.p05;
    const dMin = Math.min(...c.pasos.map((p) => p.distanciaRutaNM));
    const cruza = c.pasos.some((p) => p.cruzaRuta);
    // La severidad se clasifica por el percentil 5, por lo mismo.
    const sev = p05 <= -70 ? 'severo' : p05 <= -60 ? 'moderado' : 'leve';
    const desde = c.pasos[0].horaZ;
    const hasta = c.pasos[c.pasos.length - 1].horaZ;
    const id = `cb-${String(i + 1).padStart(2, '0')}`;
    const enc = c.encuentro;

    // −90 °C es el ÚLTIMO valor rotulado de la barra: por debajo, la rampa satura
    // en blanco y la imagen deja de distinguir temperaturas. Decir «−90» a secas
    // sería fingir una medida donde solo hay un tope de escala.
    const saturado = minTb <= -89.9;
    const tbTexto = saturado ? '≤ −90 °C (tope de escala de la tabla)' : `${minTb} °C`;

    return {
      type: 'Feature',
      properties: {
        id,
        nombre: `Núcleo convectivo ${id.slice(3)} · ${cruza ? 'sobre la ruta' : `a ${Math.round(dMin)} NM`}`,
        tipo: 'convectivo',
        severidad: sev,
        nivelesFt: 'Tope estimado; ver topeFL en la ficha',
        desdeZ: desde,
        hastaZ: hasta,
        bandaClave: 'band_13',
        bandasApoyo: ['band_09', 'band_07'],

        evidencia:
          `Percentil 5 de la temperatura de brillo: ${p05} °C; mínimo absoluto ${tbTexto}. Banda 13 (10,3 µm), ` +
          `medida invirtiendo la tabla de color ircimss2 publicada por SLIDER. Contorno trazado sobre el cuadro ` +
          `${pico.archivo.split('/').pop()} (${pico.horaZ.slice(11, 16)}Z) por el umbral declarado de ${CRITERIOS.umbralNucleoC} °C. ` +
          `Área en su máximo: ${pico.areaNM2} NM². Seguida ${c.pasos.length} cuadros, de ${desde.slice(11, 16)}Z a ${hasta.slice(11, 16)}Z. ` +
          `La severidad se clasifica por el PERCENTIL 5 y no por el mínimo: el mínimo es el valor de un solo píxel y el ` +
          `anillo de compresión del JPEG en el borde del núcleo puede fabricarlo.` +
          (saturado
            ? ' El mínimo absoluto está además SATURADO: la barra publicada no rotula por debajo de −90 °C, así que es un límite, no una medida.'
            : ''),

        interpretacion:
          `INTERPRETACIÓN DEL ANALISTA sobre la medida anterior, no dato observado. ` +
          (p05 <= -70
            ? 'Percentil 5 por debajo de −70 °C: convección profunda con cima en la alta troposfera, compatible con corriente ascendente intensa, granizo en el núcleo y actividad eléctrica.'
            : p05 <= -60
              ? 'Percentil 5 entre −60 y −70 °C: cumulonimbo maduro, con yunque desarrollado y probable actividad eléctrica.'
              : 'Percentil 5 entre −52 y −60 °C: convección profunda en desarrollo o en disipación.') +
          ` La temperatura sola no distingue fase de crecimiento de fase de disipación: para eso está la evolución del área y del percentil, que va en \`pasos\`.`,

        // Que la traza cruce la célula y que el VUELO se la encuentre son cosas
        // distintas: lo segundo depende de la hora a la que el avión pasa por ahí.
        impacto:
          (cruza
            ? `La traza de la ruta atraviesa este núcleo (distancia mínima 0 NM) entre ${desde.slice(11, 16)}Z y ${hasta.slice(11, 16)}Z. `
            : `Se aproxima a ${Math.round(dMin)} NM de la traza. `) +
          (enc
            ? `ENCUENTRO CON EL VUELO: a las ${enc.horaZ.slice(11, 16)}Z la aeronave está en la milla ${enc.aeronaveNM} ` +
              `y la célula a ${enc.distanciaNM} NM de ella` +
              (enc.dentroDelNucleo ? ', DENTRO del núcleo.' : '.')
            : 'Su vida queda FUERA de la ventana del vuelo (salida 1830Z, ETA 2055Z): no condiciona esta navegación.'),

        recomendacion: !enc
          ? 'No requiere acción: la célula nace o muere fuera del tiempo de vuelo. Se conserva por contexto del campo convectivo.'
          : enc.dentroDelNucleo
            ? 'Exige desvío lateral o cambio de hora de paso: el nivel de crucero no salva un tope de esta temperatura.'
            : enc.distanciaNM < 25
              ? 'Margen por debajo de 25 NM en el momento del paso: vigilar evolución y prever desvío.'
              : 'No condiciona la ruta por sí solo mientras mantenga esta separación.',

        // Medidas, separadas del texto, para que las use el visor y el informe.
        minTbC: minTb,
        minTbSaturado: saturado,
        p05TbC: p05,
        medianaTbC: pico.mediana,
        encuentro: enc,
        distanciaMinRutaNM: Number(dMin.toFixed(1)),
        cruzaRuta: cruza,
        areaMaxNM2: pico.areaNM2,
        horaPicoZ: pico.horaZ,
        archivoPico: pico.archivo,
        cuadros: c.pasos.length,
        pasos: c.pasos.map((p) => ({
          horaZ: p.horaZ, minTb: p.minTb, p05: p.p05, areaNM2: p.areaNM2,
          distanciaRutaNM: p.distanciaRutaNM, cruzaRuta: p.cruzaRuta,
          centro: p.centro,
        })),
        _procedencia: 'derivado',
      },
      geometry: { type: 'Polygon', coordinates: [pico.anillo] },
    };
  });

  const salida = {
    type: 'FeatureCollection',
    _procedencia: {
      queEs:
        'Núcleos convectivos DERIVADOS automáticamente de las imágenes congeladas de la banda 13, no trazados a mano. ' +
        'La geometría de cada célula es el contorno del umbral en su cuadro más frío; su vigencia es el intervalo en que se la siguió.',
      generadoPor: 'herramientas/derivar-fenomenos.mjs',
      generado: new Date().toISOString(),
      banda: 'band_13 — Infrarrojo ventana limpia, 10,3 µm',
      tablaColor: 'ircimss2 (CIRA/RAMMB SLIDER), congelada en datos/barras-color.json',
      criterios: CRITERIOS,
      desambiguacionGris:
        'La tabla ircimss2 usa gris dos veces: rampa cálida (+40…−30 °C) y cola fría (−80…−90 °C). ' +
        'Se resuelve por conectividad: el gris alcanzable desde el borde de la imagen es suelo; el gris encerrado por color frío es la cima del núcleo.',
      clasificacion: 'calculado',
      limites: [
        'El umbral es un corte declarado, no una clasificación de fenómeno: un núcleo frío NO es por sí mismo una observación de granizo, turbulencia o engelamiento.',
        'La imagen es el producto renderizado de SLIDER, con 192 escalones de tabla y compresión JPEG por medio; no son radiancias calibradas del ABI.',
        'El satélite ve el TOPE. Lo que ocurre bajo el yunque —base de la nube, cizalladura, granizo en superficie— no está en este dato.',
        'El seguimiento enlaza por proximidad de centroide: en una fusión o una división de células puede continuar la rama equivocada.',
      ],
    },
    features,
  };

  const destino = join(RAIZ, 'datos', 'fenomenos.geojson');
  await writeFile(destino, JSON.stringify(salida, null, 1), 'utf8');

  console.log(`\n${features.length} células escritas en datos/fenomenos.geojson`);
  for (const f of features) {
    const p = f.properties;
    const e = p.encuentro;
    console.log(
      `  ${p.id}  p05 ${String(p.p05TbC).padStart(6)} °C  ${String(p.areaMaxNM2).padStart(6)} NM²  ${p.severidad.padEnd(9)}` +
      `${p.desdeZ.slice(11, 16)}–${p.hastaZ.slice(11, 16)}Z  ` +
      (e ? `encuentro ${e.horaZ.slice(11, 16)}Z a ${String(e.distanciaNM).padStart(5)} NM${e.dentroDelNucleo ? '  ← DENTRO' : ''}`
         : 'fuera de la ventana del vuelo')
    );
  }
  console.log('  (severidad por percentil 5, no por el mínimo: ver evidencia de cada célula)');
}

main().catch((e) => {
  console.error('Falló la derivación:', e);
  process.exit(1);
});
