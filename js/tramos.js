// Análisis tramo a tramo y por fase de vuelo.
//
// El visor tenía los datos en paralelo —capas por un lado, bandas por otro,
// METAR en su pestaña— y dejaba al espectador la tarea de cruzarlos. Esto los
// cruza: recorre la ruta en el orden en que la vuela el avión y, para cada tramo,
// junta lo que dice el satélite, lo que dicen las estaciones y lo que implica
// para el nivel de vuelo, terminando en un veredicto.
//
// El veredicto es una REGLA DECLARADA, no una opinión. Está escrita abajo en
// `REGLA` y se enseña en la interfaz: quien no esté de acuerdo puede discutir el
// criterio, que es como se discute un análisis.

import { bus, $, esc, horaZ, distanciaNM, aFecha } from './util.js';
import { categoriaEn } from './metar.js';
import { centrarEn } from './mapa.js';
import { irAFecha } from './tiempo.js';

export const REGLA = {
  libre: 'Ningún punto del tramo con tope de nube por encima del nivel de crucero, y ninguna célula seguida a menos de 25 NM en el momento de pasar.',
  precaucion: 'Topes por encima del crucero en menos del 20 % del tramo, o célula entre 25 y 50 NM en el momento de pasar.',
  evitar: 'Topes por encima del crucero en el 20 % o más del tramo, o célula a menos de 25 NM en el momento de pasar.',
  nota: 'El criterio mira el momento en que la aeronave pasa por el tramo, no la ventana entera: una célula que nace cuando el avión ya ha pasado no penaliza el tramo.',
};

const ORDEN = { libre: 0, precaucion: 1, evitar: 2 };
const ETIQUETA = { libre: 'LIBRE', precaucion: 'PRECAUCIÓN', evitar: 'EVITAR' };

let caso = null;
let analizador = null;
let fenomenos = null;
let horaActual = null;
let cache = null;
let calculando = false;

export function iniciarTramos(datosCaso, an, geojson) {
  caso = datosCaso;
  analizador = an;
  fenomenos = geojson;

  bus.on('tiempo', ({ fecha }) => {
    horaActual = fecha;
    recalcular();
  });
  recalcular();
}

/* ---------- Geometría de los tramos ---------- */

/** Tramos reales entre waypoints publicados, con su fase de vuelo. */
function definirTramos() {
  const wps = caso.ruta.waypoints;
  const toc = wps.find((w) => w.tipo === 'toc')?.desdeOrigenNM ?? 55;
  const tod = wps.find((w) => w.tipo === 'tod')?.desdeOrigenNM ?? 487;

  const fase = (desde, hasta) => {
    const medio = (desde + hasta) / 2;
    if (medio <= toc) return 'ascenso';
    if (medio >= tod) return 'descenso';
    return 'crucero';
  };

  const out = [];
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1];
    const b = wps[i];
    const seg = caso.nivelesCrucero.segmentos.find((s) => s.desde === a.nombre && s.hasta === b.nombre);
    out.push({
      desde: a.nombre,
      hasta: b.nombre,
      desdeNM: a.desdeOrigenNM,
      hastaNM: b.desdeOrigenNM,
      distanciaNM: b.desdeOrigenNM - a.desdeOrigenNM,
      fase: fase(a.desdeOrigenNM, b.desdeOrigenNM),
      rumboMagnetico: seg?.rumboMagnetico ?? null,
      rumboVerdadero: seg?.rumboVerdadero ?? null,
      declinacion: seg?.declinacion ?? null,
      calculado: a.tipo === 'toc' || a.tipo === 'tod' || b.tipo === 'toc' || b.tipo === 'tod',
      lat: (a.lat + b.lat) / 2,
      lon: (a.lon + b.lon) / 2,
    });
  }
  return out;
}

/** Hora estimada de paso por una distancia dada, con la velocidad del caso. */
function horaEn(nm) {
  const salida = aFecha(caso.vuelo.salidaZ).getTime();
  const eta = aFecha(caso.vuelo.etaZ).getTime();
  const total = caso.ruta.waypoints[caso.ruta.waypoints.length - 1].desdeOrigenNM;
  return new Date(salida + (eta - salida) * (nm / total));
}

/* ---------- Cálculo ---------- */

async function recalcular() {
  if (!analizador?.medible('band_13') || calculando) return;
  calculando = true;
  try {
    const tramos = definirTramos();

    // El perfil se muestrea UNA vez por hora de análisis y se reparte entre los
    // tramos: pedir un perfil por tramo decodificaría el mismo JPEG ocho veces.
    const perfil = horaActual ? await analizador.perfilRuta('band_13', horaActual, 170) : null;

    for (const t of tramos) {
      const dentro = perfil ? perfil.muestras.filter((m) => m.nm >= t.desdeNM && m.nm <= t.hastaNM) : [];
      const conNube = dentro.filter((m) => m.nube);
      const porEncima = dentro.filter((m) => m.sobreCrucero);

      t.horaPaso = horaEn((t.desdeNM + t.hastaNM) / 2);
      t.muestras = dentro.length;
      t.conNube = conNube.length;
      t.fraccionSobreCrucero = dentro.length ? porEncima.length / dentro.length : 0;
      t.tbMin = conNube.length ? Math.min(...conNube.map((m) => m.tb)) : null;
      t.topeMaxFL = conNube.length
        ? Math.max(...conNube.map((m) => (m.topeFL != null ? m.topeFL : 999)))
        : null;
      t.sobreTropopausa = conNube.some((m) => m.topeSobreTropopausa);
      t.ambiguos = dentro.filter((m) => m.ambiguo).length;

      // Células seguidas que se encuentran con el avión EN ESTE TRAMO.
      t.celulas = (fenomenos?.features || [])
        .map((f) => f.properties)
        .filter((p) => p.encuentro &&
          p.encuentro.aeronaveNM >= t.desdeNM - 15 && p.encuentro.aeronaveNM <= t.hastaNM + 15)
        .sort((a, b) => a.encuentro.distanciaNM - b.encuentro.distanciaNM);
      t.celulaMasCerca = t.celulas[0] || null;

      // Estación de superficie más próxima al punto medio, con su categoría.
      const ads = caso.aerodromos
        .map((a) => ({ a, nm: distanciaNM({ lat: t.lat, lon: t.lon }, a) }))
        .sort((x, y) => x.nm - y.nm);
      t.estacion = ads[0]
        ? { icao: ads[0].a.icao, nm: Math.round(ads[0].nm), cat: categoriaEn(ads[0].a.icao, t.horaPaso) }
        : null;

      t.veredicto = juzgar(t);
    }

    cache = tramos;
    pintar();
  } catch (e) {
    console.error('tramos', e);
  } finally {
    calculando = false;
  }
}

/** La regla, aplicada. Devuelve además el motivo, que es lo que se enseña. */
function juzgar(t) {
  const d = t.celulaMasCerca?.encuentro?.distanciaNM ?? Infinity;
  const frac = t.fraccionSobreCrucero;

  if (frac >= 0.2 || d < 25) {
    return {
      nivel: 'evitar',
      motivo: d < 25
        ? `Célula ${t.celulaMasCerca.id} a ${d} NM cuando la aeronave pasa por aquí.`
        : `${Math.round(frac * 100)} % del tramo con topes por encima de ${caso.vuelo.nivelCrucero}.`,
    };
  }
  if (frac > 0 || d < 50) {
    return {
      nivel: 'precaucion',
      motivo: d < 50
        ? `Célula ${t.celulaMasCerca.id} a ${d} NM en el momento del paso.`
        : `${Math.round(frac * 100)} % del tramo con topes por encima del crucero.`,
    };
  }
  return { nivel: 'libre', motivo: 'Sin topes por encima del crucero ni células próximas al pasar.' };
}

/* ---------- Pintado ---------- */

function pintar() {
  const cont = $('#tab-tramos');
  if (!cont || !cache) return;

  const fases = [
    { id: 'ascenso', nombre: 'Salida y ascenso', detalle: `SKVV → TOC · ${caso.vuelo.nivelCrucero}` },
    { id: 'crucero', nombre: 'Crucero', detalle: `${caso.vuelo.nivelCrucero} · ${caso.vuelo.velocidadCruceroKt} kt` },
    { id: 'descenso', nombre: 'Descenso y llegada', detalle: 'TOD → SKLT' },
  ];

  const peor = cache.reduce((a, b) => (ORDEN[b.veredicto.nivel] > ORDEN[a.veredicto.nivel] ? b : a));

  cont.innerHTML = `
    <div class="resumen-ruta v-${esc(peor.veredicto.nivel)}">
      <div class="rr-etq">Veredicto de la ruta a ${esc(horaActual ? horaZ(horaActual) : '—')}</div>
      <div class="rr-val">${esc(ETIQUETA[peor.veredicto.nivel])}</div>
      <div class="rr-motivo">Lo marca el tramo ${esc(peor.desde)} → ${esc(peor.hasta)}: ${esc(peor.veredicto.motivo)}</div>
    </div>

    ${fases.map((f) => {
      const ts = cache.filter((t) => t.fase === f.id);
      if (!ts.length) return '';
      const nm = ts.reduce((s, t) => s + t.distanciaNM, 0);
      return `
      <div class="fase">
        <div class="fase-cab">
          <span class="fase-nombre">${esc(f.nombre)}</span>
          <span class="fase-detalle">${esc(f.detalle)} · ${Math.round(nm)} NM</span>
        </div>
        ${ts.map(filaTramo).join('')}
      </div>`;
    }).join('')}

    <div class="grupo-titulo" style="margin-top:18px">Regla de decisión</div>
    <div class="regla">
      <div><b class="v-libre-t">LIBRE</b> ${esc(REGLA.libre)}</div>
      <div><b class="v-precaucion-t">PRECAUCIÓN</b> ${esc(REGLA.precaucion)}</div>
      <div><b class="v-evitar-t">EVITAR</b> ${esc(REGLA.evitar)}</div>
      <div class="regla-nota">${esc(REGLA.nota)}</div>
    </div>`;

  cont.querySelectorAll('.tramo').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('abierto');
      const t = cache[Number(el.dataset.i)];
      if (t) irAFecha(t.horaPaso.toISOString());
    });
  });
}

function filaTramo(t, i) {
  const idx = cache.indexOf(t);
  const tope = t.topeMaxFL == null ? '—'
    : t.sobreTropopausa ? '> tropopausa'
    : `FL${t.topeMaxFL}`;

  return `
    <div class="tramo v-${esc(t.veredicto.nivel)}" data-i="${idx}">
      <div class="tramo-cab">
        <span class="tramo-nombre">${esc(t.desde)} → ${esc(t.hasta)}${t.calculado ? '<i title="Punto calculado, no publicado">*</i>' : ''}</span>
        <span class="tramo-nm">${Math.round(t.distanciaNM)} NM</span>
        <span class="tramo-hora">${esc(horaZ(t.horaPaso))}</span>
        <span class="tramo-v">${esc(ETIQUETA[t.veredicto.nivel])}</span>
      </div>
      <div class="tramo-barra">
        <div class="tb-relleno" style="width:${(t.fraccionSobreCrucero * 100).toFixed(0)}%"></div>
      </div>
      <div class="tramo-detalle">
        <dl>
          <dt>Rumbo magnético</dt><dd>${t.rumboMagnetico != null ? t.rumboMagnetico.toFixed(1) + '°' : '—'}
            ${t.rumboVerdadero != null ? `<span class="tenue">(verdadero ${t.rumboVerdadero.toFixed(1)}°, decl. ${t.declinacion}°)</span>` : ''}</dd>
          <dt>Tope de nube máximo</dt><dd>${esc(tope)} <span class="tenue">calculado</span></dd>
          <dt>Tb mínima</dt><dd>${t.tbMin != null ? t.tbMin.toFixed(1) + ' °C' : 'sin nube detectada'}</dd>
          <dt>Tramo sobre crucero</dt><dd>${(t.fraccionSobreCrucero * 100).toFixed(0)} % <span class="tenue">(${t.conNube}/${t.muestras} puntos con nube)</span></dd>
          <dt>Estación más próxima</dt><dd>${t.estacion ? `${esc(t.estacion.icao)} a ${t.estacion.nm} NM · <b class="cat-${esc(t.estacion.cat)}">${esc(t.estacion.cat)}</b>` : '—'}</dd>
          ${t.celulaMasCerca ? `<dt>Célula más próxima</dt><dd>${esc(t.celulaMasCerca.id)} a ${t.celulaMasCerca.encuentro.distanciaNM} NM
            <span class="tenue">(${esc(t.celulaMasCerca.severidad)}, p05 ${t.celulaMasCerca.p05TbC} °C)</span></dd>` : ''}
          ${t.ambiguos ? `<dt>Lecturas ambiguas</dt><dd>${t.ambiguos} de ${t.muestras}</dd>` : ''}
        </dl>
        <div class="tramo-motivo">${esc(t.veredicto.motivo)}</div>
      </div>
    </div>`;
}

/** Resumen para la bitácora y el informe. */
export const tramosActuales = () => cache;
