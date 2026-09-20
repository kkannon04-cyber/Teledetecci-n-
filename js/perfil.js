// Corte vertical de la ruta: distancia contra altitud.
//
// El mapa enseña la tormenta en planta y no dice si se pasa por encima. Esta
// vista contesta justo eso: pone el nivel de crucero y el tope de nube derivado
// en el mismo par de ejes, y donde la nube sube por encima de la línea de FL210,
// el problema se ve sin tener que explicarlo.
//
// El relleno de nube se pinta con LA PROPIA TABLA de la banda 13, no con una
// paleta inventada: el color de la gráfica y el color de la imagen significan lo
// mismo, así que mirar el corte y mirar el satélite es leer la misma escala.
//
// Todo lo que se dibuja aquí es CALCULADO. El eje de altitud no es una medida: es
// la temperatura de brillo pasada por el modelo de productos.js, con su ancla
// METAR y sus límites. La gráfica lo rotula en su propio pie para que nadie lo
// cite como si fuera un sondeo.

import { bus, $, esc, horaZ, longitudRuta } from './util.js';
import { aFL } from './productos.js';

const M = { izq: 54, der: 14, arr: 14, aba: 30 };
const PUNTOS = 170;

let caso = null;
let analizador = null;
let fenomenos = null;
let bandaId = 'band_13';
let horaActual = null;
let ultimo = null;          // último perfil calculado
let calculando = false;
let pendiente = null;
let posicion = null;        // posición de la aeronave, del bus
let abierto = false;

export function iniciarPerfil(datosCaso, an, geojson) {
  caso = datosCaso;
  analizador = an;
  fenomenos = geojson;

  if (!analizador?.medible(bandaId)) {
    $('#perfil-cuerpo').innerHTML =
      `<div class="perfil-vacio">La banda 13 no tiene cuadros en disco: sin imagen no hay corte que trazar.</div>`;
    return;
  }

  $('#btn-perfil').addEventListener('click', alternar);
  $('#btn-perfil').hidden = false;

  bus.on('tiempo', ({ fecha }) => {
    horaActual = fecha;
    if (abierto) recalcular();
  });
  bus.on('posicion-aeronave', (p) => {
    posicion = p;
    if (abierto && ultimo) pintarAeronave();
  });
}

export function alternar(forzar) {
  abierto = typeof forzar === 'boolean' ? forzar : !abierto;
  document.getElementById('perfil').hidden = !abierto;
  $('#btn-perfil').classList.toggle('activo', abierto);
  bus.emit('mapa-redimensionar');
  if (abierto) recalcular();
}

export const perfilAbierto = () => abierto;

/** Último corte calculado, para que otros módulos no vuelvan a muestrear. */
export const perfilActual = () => ultimo;

/* ---------- Cálculo ---------- */

async function recalcular() {
  if (!horaActual) return;
  // El muestreo es caro y la barra de tiempo se arrastra: se encola solo la
  // última petición en vez de acumular una por cada paso intermedio.
  if (calculando) { pendiente = horaActual; return; }
  calculando = true;
  try {
    const p = await analizador.perfilRuta(bandaId, horaActual, PUNTOS);
    ultimo = p;
    pintar();
  } catch (e) {
    console.error('perfil', e);
  } finally {
    calculando = false;
    if (pendiente) { pendiente = null; recalcular(); }
  }
}

/* ---------- Dibujo ---------- */

function pintar() {
  const cont = $('#perfil-cuerpo');
  if (!ultimo || !cont) return;

  const r = cont.getBoundingClientRect();
  const W = Math.max(520, r.width);
  const H = Math.max(180, r.height);
  const ancho = W - M.izq - M.der;
  const alto = H - M.arr - M.aba;

  const totalNM = longitudRuta(caso.ruta.waypoints);
  const crucero = caso.vuelo.nivelCruceroFt;

  // Escala vertical: hasta 50 000 ft. No se ajusta al máximo del momento porque
  // entonces la línea de crucero saltaría de sitio al mover la barra de tiempo y
  // la comparación entre horas dejaría de ser visual.
  const TECHO_FT = 50000;
  const x = (nm) => M.izq + (nm / totalNM) * ancho;
  const y = (ft) => M.arr + (1 - Math.min(ft, TECHO_FT) / TECHO_FT) * alto;

  const lector = analizador.lectorDe(bandaId);
  const m = ultimo.muestras;

  /* --- Relleno de nube, tramo a tramo con el color de su temperatura ---
     Se dibuja una columna por muestra en vez de un área continua: así cada trozo
     lleva SU color de la tabla y el degradado del relleno es la escala real de la
     banda, no una interpolación decorativa. */
  const anchoCol = ancho / (m.length - 1) + 0.6;
  const columnas = m
    .map((s) => {
      if (!s.nube) return '';
      const techo = s.topeFt != null ? s.topeFt : TECHO_FT;
      const color = lector ? lector.colorDe(s.tb) : '#4da3ff';
      const yTop = y(techo);
      return `<rect x="${(x(s.nm) - anchoCol / 2).toFixed(1)}" y="${yTop.toFixed(1)}" ` +
        `width="${anchoCol.toFixed(1)}" height="${(y(0) - yTop).toFixed(1)}" ` +
        `fill="${color}" opacity="${s.topeSobreTropopausa ? 0.55 : 0.82}" />`;
    })
    .join('');

  /* --- Contorno del tope --- */
  const linea = [];
  for (const s of m) {
    if (!s.nube) { linea.push(null); continue; }
    linea.push([x(s.nm), y(s.topeFt != null ? s.topeFt : TECHO_FT)]);
  }
  let d = '';
  let abiertoTrazo = false;
  for (const p of linea) {
    if (!p) { abiertoTrazo = false; continue; }
    d += (abiertoTrazo ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ' ';
    abiertoTrazo = true;
  }

  /* --- Rejilla --- */
  const nivelesFt = [10000, 20000, 30000, 40000, 50000];
  const rejilla = nivelesFt
    .map((ft) => `<line class="pf-rej" x1="${M.izq}" y1="${y(ft).toFixed(1)}" x2="${(W - M.der).toFixed(1)}" y2="${y(ft).toFixed(1)}" />` +
      `<text class="pf-eje" x="${M.izq - 8}" y="${(y(ft) + 3.5).toFixed(1)}" text-anchor="end">FL${aFL(ft)}</text>`)
    .join('');

  /* --- Nivel de crucero: la línea que decide --- */
  const yCru = y(crucero);
  const crucero_ = `
    <line class="pf-crucero" x1="${M.izq}" y1="${yCru.toFixed(1)}" x2="${(W - M.der).toFixed(1)}" y2="${yCru.toFixed(1)}" />
    <text class="pf-crucero-etq" x="${W - M.der - 4}" y="${(yCru - 6).toFixed(1)}" text-anchor="end">${esc(caso.vuelo.nivelCrucero)}</text>`;

  /* --- Tramos en que la nube rebasa el crucero --- */
  const conflictos = [];
  let ini = null;
  for (const s of m) {
    const malo = s.nube && s.sobreCrucero;
    if (malo && ini === null) ini = s.nm;
    if (!malo && ini !== null) { conflictos.push([ini, s.nm]); ini = null; }
  }
  if (ini !== null) conflictos.push([ini, totalNM]);

  const zonas = conflictos
    .map(([a, b]) => `<rect class="pf-conflicto" x="${x(a).toFixed(1)}" y="${M.arr}" ` +
      `width="${Math.max(1.5, x(b) - x(a)).toFixed(1)}" height="${alto.toFixed(1)}" />`)
    .join('');

  /* --- Waypoints --- */
  const marcas = caso.ruta.waypoints
    .map((w) => {
      const px = x(w.desdeOrigenNM);
      const esCalc = w.tipo === 'toc' || w.tipo === 'tod';
      return `<line class="pf-wp ${esCalc ? 'calc' : ''}" x1="${px.toFixed(1)}" y1="${M.arr}" x2="${px.toFixed(1)}" y2="${(M.arr + alto).toFixed(1)}" />` +
        `<text class="pf-wp-etq" x="${px.toFixed(1)}" y="${(H - M.aba + 13).toFixed(1)}" text-anchor="middle">${esc(w.nombre)}</text>`;
    })
    .join('');

  /* --- Senda vertical del vuelo: subida, crucero y descenso --- */
  const wps = caso.ruta.waypoints;
  const toc = wps.find((w) => w.tipo === 'toc');
  const tod = wps.find((w) => w.tipo === 'tod');
  const elevSalida = caso.aerodromos.find((a) => a.icao === caso.ruta.origen)?.elevFt ?? 0;
  const elevLlegada = caso.aerodromos.find((a) => a.icao === caso.ruta.destino)?.elevFt ?? 0;
  const senda = `<polyline class="pf-senda" points="
      ${x(0).toFixed(1)},${y(elevSalida).toFixed(1)}
      ${x(toc?.desdeOrigenNM ?? 55).toFixed(1)},${yCru.toFixed(1)}
      ${x(tod?.desdeOrigenNM ?? totalNM - 66).toFixed(1)},${yCru.toFixed(1)}
      ${x(totalNM).toFixed(1)},${y(elevLlegada).toFixed(1)}" />`;

  /* --- Células convectivas que cruzan la ruta ---
     Varias pueden encontrarse con la aeronave en la MISMA milla: en este caso
     cb-01, cb-03 y cb-05 coinciden, y sus tres rótulos se dibujaban uno encima de
     otro hasta quedar ilegibles. Se escalonan en vertical por orden de llegada,
     que además deja claro de un vistazo cuántas hay apiladas en ese punto. */
  const SEPARACION_PX = 26;
  const filas = [];
  const celulas = (fenomenos?.features || [])
    .filter((f) => f.properties.cruzaRuta && f.properties.encuentro)
    .sort((a, b) => a.properties.encuentro.aeronaveNM - b.properties.encuentro.aeronaveNM)
    .map((f) => {
      const p = f.properties;
      const nm = p.encuentro.aeronaveNM;
      const px = x(nm);

      // Primera fila libre en la que este rótulo no pisa a otro ya colocado.
      let fila = 0;
      while (filas[fila] != null && Math.abs(filas[fila] - px) < SEPARACION_PX) fila++;
      filas[fila] = px;

      const yTexto = M.arr + 11 + fila * 13;
      return `<g class="pf-celula sev-${esc(p.severidad)}" data-fen="${esc(p.id)}">
          <line x1="${px.toFixed(1)}" y1="${M.arr}" x2="${px.toFixed(1)}" y2="${(M.arr + alto).toFixed(1)}" />
          <text x="${px.toFixed(1)}" y="${yTexto.toFixed(1)}" text-anchor="middle">${esc(p.id)}</text>
        </g>`;
    })
    .join('');

  const svg = `
    <svg id="pf-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${zonas}
      ${rejilla}
      ${columnas}
      <path class="pf-tope" d="${d}" />
      ${senda}
      ${crucero_}
      ${marcas}
      ${celulas}
      <g id="pf-cursor" hidden>
        <line class="pf-cruz" y1="${M.arr}" y2="${(M.arr + alto).toFixed(1)}" />
        <circle class="pf-punto" r="4" />
      </g>
      <g id="pf-avion"></g>
      <rect id="pf-captura" x="${M.izq}" y="${M.arr}" width="${ancho}" height="${alto}" fill="transparent" />
    </svg>
    <div id="pf-globo" hidden></div>`;

  cont.innerHTML = svg;
  pintarPie();
  activarHover(x, y, totalNM);
  pintarAeronave();
}

/** Pie con la procedencia: la gráfica no se cita sin esto. */
function pintarPie() {
  const s = ultimo.muestras.filter((q) => q.nube);
  const conflicto = s.filter((q) => q.sobreCrucero).length;
  const ambiguas = ultimo.muestras.filter((q) => q.ambiguo).length;
  const ancla = ultimo.muestras.find((q) => q.ancla)?.ancla;

  $('#perfil-pie').innerHTML = `
    <span class="pf-dato"><b>${horaZ(new Date(ultimo.horaZ))}</b> · ${esc(ultimo.banda)}</span>
    <span class="pf-dato">${s.length}/${ultimo.muestras.length} puntos con nube</span>
    <span class="pf-dato ${conflicto ? 'alerta' : ''}">${conflicto} por encima de ${esc(caso.vuelo.nivelCrucero)}</span>
    ${ambiguas ? `<span class="pf-dato aviso">${ambiguas} ambiguos</span>` : ''}
    <span class="pf-proc" title="${esc(ultimo.modelo.formula + ' — ' + ultimo.modelo.limites.join(' '))}">
      altura CALCULADA (${esc(ultimo.modelo.formula)})${ancla ? ` · anclada en ${esc(ancla.icao)} ${ancla.temp}°C` : ''} ⓘ
    </span>`;
}

/* ---------- Aeronave sobre el corte ---------- */

function pintarAeronave() {
  const g = document.getElementById('pf-avion');
  if (!g || !ultimo) return;
  if (!posicion || !posicion.enVuelo) { g.innerHTML = ''; return; }

  const cont = $('#perfil-cuerpo');
  const r = cont.getBoundingClientRect();
  const W = Math.max(520, r.width);
  const H = Math.max(180, r.height);
  const ancho = W - M.izq - M.der;
  const alto = H - M.arr - M.aba;
  const totalNM = longitudRuta(caso.ruta.waypoints);
  const TECHO_FT = 50000;
  const x = (nm) => M.izq + (nm / totalNM) * ancho;
  const y = (ft) => M.arr + (1 - Math.min(ft, TECHO_FT) / TECHO_FT) * alto;

  const nm = totalNM * posicion.fraccion;
  const ft = altitudEn(nm);
  const px = x(nm);
  const py = y(ft);

  // ¿Hay nube por encima del avión justo aquí?
  const cerca = ultimo.muestras.reduce((a, b) => (Math.abs(b.nm - nm) < Math.abs(a.nm - nm) ? b : a));
  const dentro = cerca.nube && cerca.sobreCrucero;

  g.innerHTML = `
    <line class="pf-avion-guia ${dentro ? 'alerta' : ''}" x1="${px.toFixed(1)}" y1="${M.arr}" x2="${px.toFixed(1)}" y2="${(M.arr + alto).toFixed(1)}" />
    <g transform="translate(${px.toFixed(1)},${py.toFixed(1)})">
      <path class="pf-avion ${dentro ? 'alerta' : ''}" d="M-9,0 L4,-4 L9,0 L4,4 Z" />
    </g>`;
}

/** Altitud de la senda declarada a una distancia dada. */
function altitudEn(nm) {
  const wps = caso.ruta.waypoints;
  const crucero = caso.vuelo.nivelCruceroFt;
  const total = longitudRuta(wps);
  const toc = wps.find((w) => w.tipo === 'toc')?.desdeOrigenNM ?? 55;
  const tod = wps.find((w) => w.tipo === 'tod')?.desdeOrigenNM ?? total - 66;
  const e0 = caso.aerodromos.find((a) => a.icao === caso.ruta.origen)?.elevFt ?? 0;
  const e1 = caso.aerodromos.find((a) => a.icao === caso.ruta.destino)?.elevFt ?? 0;
  if (nm <= toc) return e0 + (crucero - e0) * (nm / toc);
  if (nm >= tod) return crucero + (e1 - crucero) * ((nm - tod) / Math.max(1, total - tod));
  return crucero;
}

/* ---------- Interacción ---------- */

function activarHover(x, y, totalNM) {
  const captura = document.getElementById('pf-captura');
  const cursor = document.getElementById('pf-cursor');
  const globo = document.getElementById('pf-globo');
  const svg = document.getElementById('pf-svg');
  if (!captura || !svg) return;

  const mover = (ev) => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = ((ev.clientX - r.left) / r.width) * vb.width;
    const nm = ((sx - M.izq) / (vb.width - M.izq - M.der)) * totalNM;

    const s = ultimo.muestras.reduce((a, b) => (Math.abs(b.nm - nm) < Math.abs(a.nm - nm) ? b : a));
    if (!s) return;

    cursor.hidden = false;
    const px = x(s.nm);
    cursor.querySelector('.pf-cruz').setAttribute('x1', px);
    cursor.querySelector('.pf-cruz').setAttribute('x2', px);
    const punto = cursor.querySelector('.pf-punto');
    punto.setAttribute('cx', px);
    punto.setAttribute('cy', y(s.topeFt ?? 0));
    punto.style.opacity = s.nube ? '1' : '0';

    globo.hidden = false;
    globo.style.left = `${Math.min(r.width - 220, Math.max(0, (px / vb.width) * r.width + 10))}px`;
    globo.innerHTML = `
      <div class="gl-tit">${Math.round(s.nm)} NM · ${esc(s.tramo)}</div>
      <div class="gl-fila"><span>Temp. de brillo</span><b>${s.tb != null ? s.tb.toFixed(1) + ' °C' : '—'}</b></div>
      <div class="gl-fila"><span>Nube</span><b>${s.nube ? 'sí' : 'no detectada'}</b></div>
      ${s.nube ? `<div class="gl-fila"><span>Tope estimado</span><b>${
        s.topeFL != null ? 'FL' + s.topeFL : 'sobre tropopausa'}</b></div>` : ''}
      ${s.nube && s.sobreCrucero ? `<div class="gl-alerta">Por encima de ${esc(caso.vuelo.nivelCrucero)}</div>` : ''}
      ${s.ambiguo ? `<div class="gl-aviso">Color ambiguo: lectura no concluyente</div>` : ''}
      ${s.saturado ? `<div class="gl-aviso">Valor saturado en el extremo de la tabla</div>` : ''}
      ${s.ancla ? `<div class="gl-proc">Anclado en ${esc(s.ancla.icao)} · ${s.ancla.temp} °C · ${Math.round(s.ancla.distanciaNM)} NM</div>` : ''}`;
  };

  captura.addEventListener('pointermove', mover);
  captura.addEventListener('pointerleave', () => {
    cursor.hidden = true;
    globo.hidden = true;
  });
}
