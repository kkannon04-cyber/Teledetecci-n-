// SIGMET: avisos oficiales de fenómeno significativo, cruzados geométricamente
// contra la ruta del caso.
//
// El aviso trae uno o varios polígonos de vértices publicados, unos límites
// verticales y una franja de validez. Aquí se responde a tres preguntas por
// aviso, que son las que importan operacionalmente:
//
//   1. ¿Su polígono corta la ruta, o a cuántas millas queda?
//   2. ¿Sus niveles se solapan con el perfil vertical del vuelo?
//   3. ¿Está vigente a la hora seleccionada en la barra de tiempo?
//
// Solo cuando las tres son afirmativas el aviso afecta de verdad al vuelo. Un
// SIGMET que cruza la ruta pero por debajo del perfil no la afecta, y decirlo
// es tan importante como detectar el que sí.
//
// OJO AL COMPARAR CON EL MAPA DEL AVIATION WEATHER CENTER: esa página pinta la
// situación de AHORA, mientras que aquí la vigencia se evalúa a la hora del
// caso, que es la que marca la barra de tiempo. Un aviso emitido después de esa
// hora sale atenuado aquí y en color pleno allá, y ninguno de los dos se
// equivoca. El pie del panel deja escrita la hora de evaluación.

import { decodificarSigmet, queSignifica } from './decodificar.js';
import { bus, $, esc, horaZLarga } from './util.js';
import { registrar, pintarPanel as pintarPanelCapas } from './capas.js';
import { obtenerMapa } from './mapa.js';
import { fechaActual } from './tiempo.js';

const COLOR_PELIGRO = {
  TS: '#f85149',      // tormenta
  TSGR: '#f85149',    // tormenta con granizo
  TURB: '#f0883e',    // turbulencia
  ICE: '#4da3ff',     // engelamiento
  VA: '#d2a8ff',      // ceniza volcánica
  MTW: '#d29922',     // onda de montaña
  DS: '#8b7355',      // tormenta de polvo
  SS: '#8b7355',      // tormenta de arena
  TC: '#ff7b72',      // ciclón tropical
};

const NOMBRE_PELIGRO = {
  TS: 'Tormenta',
  TSGR: 'Tormenta con granizo',
  TURB: 'Turbulencia',
  ICE: 'Engelamiento',
  VA: 'Ceniza volcánica',
  MTW: 'Onda de montaña',
  DS: 'Tormenta de polvo',
  SS: 'Tormenta de arena',
  TC: 'Ciclón tropical',
};

// Alcances seleccionables.
//
// El de por defecto NO es un radio sino una CAJA: la de cobertura nacional
// declarada en caso.cobertura, la misma que recorta las bandas y acota la
// consulta METAR. Un radio alrededor de la ruta deja fuera medio país —San
// Andrés y Providencia quedan a más de 700 NM del trazado— y el visor tiene que
// servir para mirar Colombia entera, no solo el corredor. El de 300 NM sigue
// estando porque es el del análisis de ruta propiamente dicho; los dos últimos
// existen para contrastar el visor contra el mapa del AWC sin que falte nada.
const ALCANCES = [
  { id: 'cobertura', etq: 'Colombia (caja de cobertura)' },
  { id: 300, etq: 'Área de la ruta (300 NM)' },
  { id: 1500, etq: 'Regional (1 500 NM)' },
  { id: Infinity, etq: 'Todo el mundo' },
];

// Por debajo de esta separación el veredicto deja de ser «no cruza» a secas: el
// polígono de un SIGMET se publica en minutos de arco enteros, así que unas pocas
// millas están dentro del propio error de trazado del aviso.
const ROCE_NM = 10;

let caso = null;
let analizados = [];    // todos los avisos decodificados, sin filtro de alcance
let avisos = [];        // los que se muestran con el alcance elegido
let sinDecodificar = [];
let alcance = 'cobertura';
let capa = null;
let procedencia = { modo: 'congelado', hora: null, detalle: '' };
let horaActual = null;
const porId = new Map();

/* ==================== Lectura de la geometría del aviso ==================== */

/**
 * Devuelve los anillos del aviso como listas de {lat, lon}.
 *
 * El AWC usa dos formas distintas en el mismo campo `coords` y hay que
 * soportar las dos:
 *  - geom "AREA": coords es la lista de vértices — [{lat, lon}, …].
 *  - geom "AREAS": el aviso publica VARIAS áreas y coords es una lista de
 *    listas — [[{lat, lon}, …], [{lat, lon}, …]].
 *
 * Leer la segunda forma como si fuera la primera da NaN y el aviso desaparece
 * del mapa sin dar error: así se perdían los SIGMET de áreas múltiples, que
 * son justo los de tormenta más extensos. Además, el AWC suele dejar en esos
 * avisos un área residual de un solo vértice con lon nula, resto de repetir el
 * punto de cierre: se descarta, no se dibuja como polígono degenerado.
 */
function anillosDe(aviso) {
  const coords = aviso?.coords;
  if (!Array.isArray(coords) || !coords.length) return [];

  const crudos = Array.isArray(coords[0]) ? coords : [coords];

  return crudos
    .map((anillo) =>
      (Array.isArray(anillo) ? anillo : [])
        .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    )
    .filter((anillo) => anillo.length >= 3);
}

/** Rectángulo envolvente de todos los anillos del aviso. */
function cajaDe(anillos) {
  const pts = anillos.flat();
  return {
    latMin: Math.min(...pts.map((p) => p.lat)),
    latMax: Math.max(...pts.map((p) => p.lat)),
    lonMin: Math.min(...pts.map((p) => p.lon)),
    lonMax: Math.max(...pts.map((p) => p.lon)),
  };
}

/* ==================== Geometría ==================== */

const RAD = Math.PI / 180;

/** Proyección plana local: NM respecto a un origen. Suficiente a esta escala. */
function proyector(latRef) {
  const kx = Math.cos(latRef * RAD) * 60;
  return (p) => [p.lon * kx, p.lat * 60];
}

function seCortan(a, b, c, d) {
  const cruz = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cruz(c, d, a), d2 = cruz(c, d, b), d3 = cruz(a, b, c), d4 = cruz(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function dentroDelPoligono(p, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i], [xj, yj] = poligono[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function distanciaPuntoSegmento(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/**
 * Cruce de los anillos del aviso con la polilínea de la ruta.
 * Devuelve si se cortan y, si no, a cuántas NM queda el borde más próximo.
 */
function analizarGeometria(anillos, waypoints) {
  if (!anillos.length) return { valido: false };

  const proy = proyector(waypoints[0].lat);
  const ruta = waypoints.map(proy);
  let minGlobal = Infinity;

  for (const anillo of anillos) {
    const pol = anillo.map(proy);

    // 1. Algún punto de la ruta dentro del polígono.
    for (const punto of ruta) {
      if (dentroDelPoligono(punto, pol)) return { valido: true, cruza: true, distanciaNM: 0 };
    }
    // 2. Algún tramo de la ruta que corte un lado del polígono.
    for (let i = 1; i < ruta.length; i++) {
      for (let j = 0, k = pol.length - 1; j < pol.length; k = j++) {
        if (seCortan(ruta[i - 1], ruta[i], pol[k], pol[j])) return { valido: true, cruza: true, distanciaNM: 0 };
      }
    }
    // 3. Sin cruce: la separación mínima entre ambos contornos.
    for (let i = 1; i < ruta.length; i++) {
      for (const v of pol) minGlobal = Math.min(minGlobal, distanciaPuntoSegmento(v, ruta[i - 1], ruta[i]));
    }
    for (let j = 0, k = pol.length - 1; j < pol.length; k = j++) {
      for (const punto of ruta) minGlobal = Math.min(minGlobal, distanciaPuntoSegmento(punto, pol[k], pol[j]));
    }
  }
  // Sin redondear: por debajo de media milla el entero diría «0 NM», que se lee
  // como que cruza y contradice el veredicto de al lado. Quien redondea es la
  // presentación, no el cálculo.
  return { valido: true, cruza: false, distanciaNM: minGlobal };
}

/**
 * Distancia legible. Un polígono puede rozar el trazado sin cortarlo —pasó con el
 * SIGMET 39 de SBAZ, cuyo borde queda a 0,13 NM de la pista de Leticia— y esa
 * diferencia entre rozar y cruzar es justo la que hay que poder leer.
 */
const distanciaTexto = (nm) =>
  !Number.isFinite(nm) ? '—' : nm < 0.5 ? 'menos de media milla' : nm < 10 ? `${nm.toFixed(1)} NM` : `${Math.round(nm)} NM`;

/* ==================== Perfil vertical ==================== */

/** Franja de altitud que ocupa el vuelo: del suelo más bajo al nivel de crucero. */
function envolventeVuelo() {
  const alturas = caso.aerodromos
    .filter((a) => a.rol === 'origen' || a.rol === 'destino')
    .map((a) => a.elevFt);
  const techo = caso.vuelo.nivelCruceroFt || Number(String(caso.vuelo.nivelCrucero).replace(/\D/g, '')) * 100;
  return { desde: Math.min(...alturas, techo), hasta: techo };
}

function analizarVertical(aviso) {
  const v = envolventeVuelo();
  // El AWC deja base/top en null cuando el aviso no los acota: se toma el peor caso.
  const base = aviso.base ?? 0;
  const tope = aviso.top ?? 60000;
  return { base, tope, solapa: base <= v.hasta && tope >= v.desde, vuelo: v };
}

/* ==================== Carga ==================== */

/** AAAAMMDD_HHMM, el formato de fecha que espera la API del AWC. */
function selloFecha(f) {
  const p = (n) => String(n).padStart(2, '0');
  return `${f.getUTCFullYear()}${p(f.getUTCMonth() + 1)}${p(f.getUTCDate())}_${p(f.getUTCHours())}${p(f.getUTCMinutes())}`;
}

/**
 * De dónde salen los avisos.
 *
 * PRIMERO lo congelado en `datos/sigmet.json`, y no es una preferencia estética:
 * el caso tiene que dar lo mismo cada vez que se abre, y ese archivo lo garantiza.
 * Además la captura congelada es MÁS COMPLETA que cualquier consulta en vivo,
 * porque `capturar-datos.mjs` barre la ventana entera hora a hora y funde los
 * resultados: una consulta a la hora de análisis solo devuelve los avisos vigentes
 * en ese instante y se deja fuera los que se emiten con el vuelo ya en ruta. En
 * este caso la diferencia es grande —la consulta puntual a las 1830Z trae 8 avisos
 * en la caja y 1 sobre la ruta; la captura barrida trae 18 y 3— y los que faltan
 * son justo los del tramo final del vuelo.
 *
 * La API solo se consulta cuando NO hay captura, o cuando se pulsa «Consultar de
 * nuevo», que llama a esta función con `congelado = null` a propósito. Esa consulta
 * sí va a la hora del caso y no al presente: si el vuelo es pasado, preguntar por
 * los avisos de ahora sería una respuesta correcta a la pregunta equivocada.
 * En los dos casos la interfaz rotula de dónde vienen los datos.
 */
async function obtenerAvisos(congelado, fecha) {
  if (congelado?.datos?.length) {
    const horas = congelado.horasConsultadas;
    procedencia = {
      modo: 'congelado',
      hora: congelado.capturadoEn ? new Date(congelado.capturadoEn) : null,
      detalle: `datos/sigmet.json · ${congelado.datos.length} avisos` + (Array.isArray(horas) && horas.length
        ? ` de ${horas.length} consultas a la API entre ${horas[0]}Z y ${horas[horas.length - 1]}Z, la ventana completa del caso`
        : ' de la captura guardada'),
    };
    return congelado.datos;
  }

  const historica = fecha && Date.now() - fecha.getTime() > 90 * 60 * 1000;
  const url = historica ? `/api/sigmet?date=${selloFecha(fecha)}` : '/api/sigmet';

  try {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 12000);
    const res = await fetch(url, { signal: control.signal, cache: 'no-store' });
    clearTimeout(reloj);
    if (!res.ok) throw new Error(`la API respondió ${res.status}`);
    const datos = await res.json();
    if (!Array.isArray(datos)) throw new Error('respuesta inesperada de la API');
    procedencia = {
      modo: historica ? 'historico' : 'vivo',
      hora: historica ? fecha : new Date(),
      detalle: historica
        ? `Aviation Weather Center, consulta para ${selloFecha(fecha)}Z · aviationweather.gov/api/data/isigmet`
        : 'Aviation Weather Center · aviationweather.gov/api/data/isigmet',
    };
    return datos;
  } catch (e) {
    procedencia = {
      modo: 'congelado',
      hora: congelado?.capturadoEn ? new Date(congelado.capturadoEn) : null,
      detalle: `Consulta a la API no disponible (${e.message}). Se usa la captura de datos/sigmet.json.`,
    };
    return congelado?.datos || [];
  }
}

export async function iniciarSigmet(datosCaso, congelado, fechaConsulta) {
  caso = datosCaso;
  const hora = fechaConsulta || new Date(caso.ventanaTiempo.horaAnalisisZ);
  const crudos = await obtenerAvisos(congelado, hora);
  const waypoints = caso.ruta.waypoints;

  analizados = [];
  sinDecodificar = [];

  for (const [i, a] of crudos.entries()) {
    const anillos = anillosDe(a);
    const geo = analizarGeometria(anillos, waypoints);
    if (!geo.valido) {
      sinDecodificar.push(`${a.firId || '????'} ${a.hazard || ''} ${a.seriesId || ''}`.trim());
      continue;
    }
    analizados.push({
      id: `sigmet-${i}`,
      crudo: a,
      anillos,
      peligro: a.hazard || '??',
      fir: a.firName || a.firId || '—',
      serie: a.seriesId || '',
      desde: a.validTimeFrom ? new Date(a.validTimeFrom * 1000) : null,
      hasta: a.validTimeTo ? new Date(a.validTimeTo * 1000) : null,
      cruza: geo.cruza,
      distanciaNM: geo.distanciaNM,
      caja: cajaDe(anillos),
      ...analizarVertical(a),
    });
  }

  // Primero lo que corta la ruta, luego por cercanía.
  analizados.sort((x, y) => (y.cruza - x.cruza) || (x.distanciaNM - y.distanciaNM));

  horaActual = fechaActual() || horaActual;
  bus.on('tiempo', ({ fecha }) => {
    horaActual = fecha;
    actualizarVigencia();
  });

  aplicarAlcance();
}

/** ¿El aviso toca la caja de cobertura del caso? */
function tocaCobertura(aviso) {
  const c = caso?.cobertura?.caja;
  if (!c) return true; // sin caja declarada no se puede filtrar: se muestra todo
  const b = aviso.caja;
  return !(b.latMax < c.latMin || b.latMin > c.latMax || b.lonMax < c.lonMin || b.lonMin > c.lonMax);
}

/** Rehace capa y panel con el alcance elegido, sin volver a consultar la API. */
function aplicarAlcance() {
  avisos = alcance === 'cobertura'
    ? analizados.filter((a) => a.cruza || tocaCobertura(a))
    : analizados.filter((a) => a.cruza || a.distanciaNM <= alcance);
  crearCapa();
  pintarPanel();
}

/* ==================== Mapa ==================== */

function estilo(a, vig) {
  const color = COLOR_PELIGRO[a.peligro] || '#8b98a5';
  const afecta = a.cruza && a.solapa && vig;
  return {
    color,
    weight: afecta ? 3 : a.cruza ? 2 : 1,
    opacity: vig ? 0.95 : 0.28,
    fillColor: color,
    fillOpacity: vig ? (afecta ? 0.22 : 0.08) : 0.03,
    dashArray: a.cruza ? null : '5,6',
  };
}

function crearCapa() {
  // Al cambiar de alcance o reconsultar se reconstruye la capa entera: hay que
  // retirar la anterior del mapa o quedarían los polígonos viejos debajo.
  if (capa) obtenerMapa().removeLayer(capa);
  porId.clear();

  capa = L.layerGroup();
  for (const a of avisos) {
    // Un aviso puede tener varias áreas: se agrupan para poder encuadrarlas y
    // estilarlas como una sola unidad.
    const grupo = L.featureGroup(
      a.anillos.map((anillo) => L.polygon(anillo.map((p) => [p.lat, p.lon])))
    );
    grupo.setStyle(estilo(a, true));
    grupo.bindTooltip(
      `${esc(a.peligro)} · ${esc(a.fir)}${a.cruza ? ' — CRUZA LA RUTA' : ` — a ${distanciaTexto(a.distanciaNM)}`}`,
      { sticky: true }
    );
    grupo.bindPopup(popup(a));
    grupo.on('click', () => abrirFicha(a.id));
    porId.set(a.id, grupo);
    grupo.addTo(capa);
  }

  const cruzan = avisos.filter((a) => a.cruza).length;
  registrar({
    id: 'sigmet',
    nombre: `SIGMET vigentes (${avisos.length}${cruzan ? `, ${cruzan} sobre la ruta` : ''})`,
    grupo: 'Avisos',
    capa,
    visible: true,
    descripcion:
      'Avisos SIGMET del Aviation Weather Center. Trazo continuo: su polígono corta la ruta. ' +
      'Atenuados: no vigentes a la hora seleccionada en la barra de tiempo.',
  });

  // La API responde después de que el panel de capas se haya pintado, así que
  // hay que repintarlo para que aparezca esta capa con su recuento.
  pintarPanelCapas();
}

function popup(a) {
  const color = COLOR_PELIGRO[a.peligro] || '#8b98a5';
  return `
    <div style="min-width:250px;max-width:320px">
      <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${color}">
        ${esc(a.peligro)} — ${esc(NOMBRE_PELIGRO[a.peligro] || 'Fenómeno significativo')}
      </div>
      <div style="color:#8b98a5;margin-bottom:6px">${esc(a.fir)}${a.serie ? ` · SIGMET ${esc(a.serie)}` : ''}</div>
      <div style="font-size:11px;line-height:1.7">
        <b>Validez</b> ${a.desde ? esc(horaZLarga(a.desde)) : '—'} – ${a.hasta ? esc(horaZLarga(a.hasta)) : '—'}<br>
        <b>Niveles</b> ${nivelTexto(a)}<br>
        <b>Áreas</b> ${a.anillos.length}<br>
        <b>Respecto a la ruta</b> ${a.cruza ? 'cruza el trazado' : `a ${distanciaTexto(a.distanciaNM)}`}<br>
        <b>Perfil del vuelo</b> ${a.solapa ? 'se solapa en vertical' : 'sin solape vertical'}
      </div>
      <div class="crudo" style="margin-top:8px;white-space:pre-wrap;font-size:10px">${esc((a.crudo.rawSigmet || '').trim())}</div>
    </div>`;
}

function nivelTexto(a) {
  const f = (n) => (n >= 1000 ? `FL${String(Math.round(n / 100)).padStart(3, '0')}` : `${n.toLocaleString('es')} ft`);
  // El AWC codifica la superficie como base 0; en aeronáutica eso se escribe SFC.
  const base = a.crudo.base == null || a.crudo.base === 0 ? 'SFC' : f(a.crudo.base);
  const tope = a.crudo.top == null ? 'sin acotar' : f(a.crudo.top);
  return `${base} / ${tope}`;
}

const vigente = (a) => !horaActual || !a.desde || !a.hasta || (horaActual >= a.desde && horaActual <= a.hasta);

function actualizarVigencia() {
  for (const a of avisos) {
    const grupo = porId.get(a.id);
    if (grupo) grupo.setStyle(estilo(a, vigente(a)));
    const fila = document.querySelector(`.fenomeno[data-id="${CSS.escape(a.id)}"]`);
    if (fila) {
      fila.style.opacity = vigente(a) ? '1' : '0.4';
      const etq = fila.querySelector('[data-vigencia]');
      if (etq) etq.textContent = vigente(a) ? 'VIGENTE' : 'fuera de validez';
    }
  }
  // El panel no se repinta entero en cada paso de la barra —sería tirar y rehacer
  // dieciocho fichas por cada movimiento— pero la hora que encabeza el bloque SÍ
  // tiene que seguirla: si no, el panel dice haber evaluado la vigencia a una hora
  // y las etiquetas de al lado corresponden a otra.
  const etqHora = document.getElementById('sigmet-hora-vigencia');
  if (etqHora) etqHora.textContent = horaActual ? horaZLarga(horaActual) : '—';
  pintarResumen();
}

/* ==================== Panel ==================== */

function contenedor() {
  let caja = document.getElementById('bloque-sigmet');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'bloque-sigmet';
    $('#tab-fenomenos').prepend(caja);
  }
  return caja;
}

/** Los que de verdad afectan al vuelo: cruzan, solapan en vertical y están vigentes. */
const afectan = () => avisos.filter((a) => a.cruza && a.solapa && vigente(a));

function pintarResumen() {
  const caja = document.getElementById('resumen-sigmet');
  if (!caja) return;
  const lista = afectan();
  const activos = avisos.filter(vigente);

  // «No cruza» no significa «no importa». Un polígono que pasa a milla y media del
  // trazado no corta nada y aun así condiciona el vuelo, así que el veredicto tiene
  // tres estados y no dos.
  const proximo = activos[0];
  const roza = !lista.length && proximo && !proximo.cruza && proximo.distanciaNM < ROCE_NM;

  caja.className = `veredicto-sigmet ${lista.length ? 'alerta' : roza ? 'rozando' : 'limpio'}`;
  caja.innerHTML = lista.length
    ? `<b>${lista.length} SIGMET afecta${lista.length > 1 ? 'n' : ''} la ruta</b> a la hora seleccionada:
       ${lista.map((a) => `${esc(a.peligro)} (${esc(a.fir)})`).join(', ')}.`
    : roza
      ? `<b>Ningún SIGMET corta el trazado, pero uno lo roza.</b>
         ${esc(NOMBRE_PELIGRO[proximo.peligro] || proximo.peligro)} de ${esc(proximo.fir)}, con el borde de su polígono
         a ${distanciaTexto(proximo.distanciaNM)} de la ruta y niveles ${nivelTexto(proximo)}.
         Rozar no es cruzar, pero a esa distancia el margen lo pone la precisión del polígono, no el vuelo.
         ${activos.length} aviso${activos.length === 1 ? '' : 's'} vigente${activos.length === 1 ? '' : 's'} en el alcance mostrado.`
      : `<b>Ningún SIGMET cruza la ruta</b> a la hora seleccionada.
         ${activos.length} aviso${activos.length === 1 ? '' : 's'} vigente${activos.length === 1 ? '' : 's'} en el alcance mostrado;
         el más próximo, a ${proximo ? distanciaTexto(proximo.distanciaNM) : '—'} del trazado.`;
}

function pintarPanel() {
  const caja = contenedor();
  const p = procedencia;
  const SELLOS = {
    vivo: ['sello-vivo', 'EN VIVO', 'consultado'],
    historico: ['sello-historico', 'HORA DEL CASO', 'avisos vigentes a las'],
    congelado: ['sello-congelado', 'CONGELADO', 'captura de'],
  };
  const [clase, etiqueta, prefijo] = SELLOS[p.modo] || SELLOS.congelado;
  const sello = `<span class="${clase}">${etiqueta}</span> ${prefijo} ${
    p.hora ? esc(horaZLarga(p.hora)) : 'sin fecha'
  } · ${esc(p.detalle)}`;

  const fuera = analizados.length - avisos.length;

  caja.innerHTML = `
    <div class="grupo-titulo">SIGMET · avisos oficiales</div>
    <div class="hora-obs" style="margin-bottom:8px">${sello}</div>
    <div id="resumen-sigmet" class="veredicto-sigmet limpio"></div>

    <div class="fila-alcance">
      <label for="sel-alcance">Alcance</label>
      <select id="sel-alcance">
        ${ALCANCES.map((a) => `<option value="${a.id}" ${a.id === alcance ? 'selected' : ''}>${esc(a.etq)}</option>`).join('')}
      </select>
      <button id="btn-sigmet-refrescar">Consultar de nuevo</button>
    </div>

    <div class="hora-obs" style="margin:6px 0 10px">
      ${avisos.length} de ${analizados.length} avisos decodificados${fuera ? ` · ${fuera} fuera del alcance` : ''}${
        sinDecodificar.length ? ` · ${sinDecodificar.length} sin geometría utilizable (${esc(sinDecodificar.slice(0, 4).join(', '))}${sinDecodificar.length > 4 ? '…' : ''})` : ''
      }.<br>
      Vigencia evaluada a las <b id="sigmet-hora-vigencia">${horaActual ? esc(horaZLarga(horaActual)) : '—'}</b>, la hora de la barra de tiempo.
      «Consultar de nuevo» pregunta a la API por esa misma hora y sustituye lo congelado:
      devuelve solo los avisos vigentes en ese instante, no la ventana entera, así que
      normalmente trae MENOS avisos que la captura. Recargar la página vuelve a lo congelado.
      El mapa del Aviation Weather Center siempre pinta la situación actual: si el caso no es de ahora, no tienen por qué coincidir.
    </div>

    ${avisos.map(ficha).join('') ||
      '<div class="hora-obs">Ningún aviso SIGMET en el alcance seleccionado.</div>'}`;

  caja.querySelectorAll('.fenomeno').forEach((el) => {
    el.addEventListener('click', () => {
      const abierto = el.classList.contains('abierto');
      caja.querySelectorAll('.fenomeno').forEach((o) => o.classList.remove('abierto'));
      if (!abierto) {
        el.classList.add('abierto');
        const g = porId.get(el.dataset.id);
        if (g) obtenerMapa().fitBounds(g.getBounds(), { padding: [60, 60] });
      }
    });
  });

  document.getElementById('sel-alcance')?.addEventListener('change', (ev) => {
    ev.stopPropagation();
    alcance = ev.target.value === 'cobertura' ? 'cobertura' : Number(ev.target.value);
    aplicarAlcance();
  });

  document.getElementById('btn-sigmet-refrescar')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    ev.target.disabled = true;
    ev.target.textContent = 'Consultando…';
    // Se pregunta por la hora que marca la barra, no por el momento presente.
    await iniciarSigmet(caso, null, horaActual);
  });

  actualizarVigencia();
}

function ficha(a) {
  const color = COLOR_PELIGRO[a.peligro] || '#8b98a5';
  const relacion = a.cruza
    ? `<span style="color:${a.solapa ? '#f85149' : '#d29922'}">${a.solapa ? 'CRUZA LA RUTA' : 'cruza en planta, no en altura'}</span>`
    : `a ${distanciaTexto(a.distanciaNM)} de la ruta`;

  return `
    <div class="fenomeno" data-id="${esc(a.id)}" style="border-left-color:${color}">
      <h4><span style="color:${color}">◆</span> ${esc(NOMBRE_PELIGRO[a.peligro] || a.peligro)} — ${esc(a.fir)}</h4>
      <div class="meta">
        ${esc(a.peligro)}${a.serie ? ` ${esc(a.serie)}` : ''} · ${nivelTexto(a)} ·
        <span data-vigencia>VIGENTE</span> · ${relacion}
      </div>
      <div class="detalle">
        <dl>
          <dt>Validez</dt><dd>${a.desde ? esc(horaZLarga(a.desde)) : '—'} – ${a.hasta ? esc(horaZLarga(a.hasta)) : '—'}</dd>
          <dt>Relación con la ruta</dt>
          <dd>${a.cruza
              ? 'El polígono publicado corta el trazado.'
              : `El borde más próximo del polígono queda a ${distanciaTexto(a.distanciaNM)} del trazado.`}
            ${a.anillos.length > 1 ? ` El aviso publica ${a.anillos.length} áreas separadas.` : ''}
            ${a.solapa
              ? `Sus niveles (${nivelTexto(a)}) se solapan con el perfil del vuelo (${a.vuelo.desde.toLocaleString('es')} – ${a.vuelo.hasta.toLocaleString('es')} ft).`
              : `Sus niveles (${nivelTexto(a)}) quedan fuera del perfil del vuelo (${a.vuelo.desde.toLocaleString('es')} – ${a.vuelo.hasta.toLocaleString('es')} ft), así que no lo afecta aunque coincida en planta.`}
          </dd>
          <dt>Texto del aviso</dt>
          <dd><div class="crudo" style="white-space:pre-wrap">${esc((a.crudo.rawSigmet || '').trim())}</div>
              ${explicacionSigmet(a.crudo)}</dd>
        </dl>
      </div>
    </div>`;
}

function abrirFicha(id) {
  document.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.pestana === 'fenomenos'));
  document.querySelectorAll('.contenido-pestana').forEach((c) => c.classList.toggle('activa', c.id === 'tab-fenomenos'));
  const fila = document.querySelector(`.fenomeno[data-id="${CSS.escape(id)}"]`);
  if (fila) {
    document.querySelectorAll('.fenomeno').forEach((o) => o.classList.remove('abierto'));
    fila.classList.add('abierto');
    fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ---------- Traducción del aviso ----------
   El texto crudo del SIGMET es la fuente y se queda arriba, tal cual. Esto lo
   acompaña con la lectura de sus campos: qué fenómeno, entre qué niveles, hacia
   dónde va y qué implica para el vuelo. La explicación del peligro es doctrina
   general, no algo que diga este aviso concreto, y va rotulada aparte. */

function explicacionSigmet(crudo) {
  const d = decodificarSigmet(crudo);
  if (!d) return '';
  const q = queSignifica(crudo.hazard);
  return `
    <div class="decodificado">
      <div class="dec-grupo"><span class="dec-crudo">Fenómeno</span><span class="dec-texto">${esc(d.titulo)}</span></div>
      <div class="dec-grupo"><span class="dec-crudo">Capa</span><span class="dec-texto">${esc(d.capa)}</span></div>
      <div class="dec-grupo"><span class="dec-crudo">Movimiento</span><span class="dec-texto">${esc(d.movimiento)}</span></div>
      ${d.evolucion ? `<div class="dec-grupo"><span class="dec-crudo">Evolución</span><span class="dec-texto">${esc(d.evolucion)}</span></div>` : ''}
      ${d.validez ? `<div class="dec-grupo"><span class="dec-crudo">Validez</span><span class="dec-texto">${esc(d.validez)}</span></div>` : ''}
      ${q ? `<div class="dec-nota" style="margin-left:0">${esc(q)} <i style="color:var(--muy-tenue)">— doctrina general sobre el fenómeno, no contenido de este aviso.</i></div>` : ''}
    </div>`;
}
