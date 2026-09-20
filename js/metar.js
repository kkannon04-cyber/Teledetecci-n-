// METAR y TAF: selecciona la observación vigente para la hora de la barra,
// la decodifica y colorea los aeródromos del mapa.
//
// Dos públicos distintos y por eso dos salidas distintas:
//
//   - el PANEL detalla los seis aeródromos del caso —origen, destino y alternos—,
//     que son los que se planifican y los únicos con TAF que mirar;
//   - la CAPA pinta todas las demás estaciones que reportan dentro de la caja de
//     cobertura nacional. Sirve para leer de un vistazo cómo está el país entero
//     a la hora de la barra, que es la lectura que el corredor por sí solo no da.

import { bus, $, esc, colorCat, horaZLarga, fechaHoraZ } from './util.js';
import { colorearAerodromos, centrarEn } from './mapa.js';
import { registrar, pintarPanel as pintarPanelCapas } from './capas.js';
import { decodificarParte, CRITERIO_CATEGORIA } from './decodificar.js';

let caso = null;
let observaciones = [];
let pronosticos = [];
let capturadoEn = null;
let capaEstaciones = null;
const marcadoresEstacion = new Map();

export function iniciarMeteo(datosCaso, metar, taf) {
  caso = datosCaso;
  observaciones = (metar?.datos || []).slice().sort((a, b) => new Date(a.reportTime) - new Date(b.reportTime));
  pronosticos = taf?.datos || [];
  capturadoEn = metar?.capturadoEn || null;

  crearCapaEstaciones();

  bus.on('tiempo', ({ fecha }) => actualizar(fecha));
  bus.on('aerodromo-seleccionado', (icao) => {
    activarPestana('meteo');
    const tarjeta = document.getElementById(`tarjeta-${icao}`);
    if (tarjeta) tarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/* ---------- Capa de estaciones ---------- */

/**
 * Una marca por estación que reporte y no sea de las seis del caso: esas ya
 * tienen su propio marcador, con etiqueta y ficha, y duplicarlas solo taparía.
 * La posición sale del propio METAR (campos lat/lon del AWC), no de una tabla
 * aparte que habría que mantener.
 */
function crearCapaEstaciones() {
  const delCaso = new Set(caso.aerodromos.map((a) => a.icao));
  const porIcao = new Map();
  for (const o of observaciones) {
    if (delCaso.has(o.icaoId)) continue;
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    if (!porIcao.has(o.icaoId)) porIcao.set(o.icaoId, o);
  }
  if (!porIcao.size) return;

  capaEstaciones = L.layerGroup();
  for (const [icao, o] of porIcao) {
    const m = L.circleMarker([o.lat, o.lon], {
      radius: 5, weight: 1.5, color: '#0d1117', fillColor: colorCat('ND'), fillOpacity: 0.95,
    })
      .bindTooltip(icao, { direction: 'top', offset: [0, -6] })
      // El globo se ata vacío aquí y se rellena en cada paso de la barra de tiempo:
      // setPopupContent no hace nada si antes no hubo bindPopup.
      .bindPopup('');
    m.addTo(capaEstaciones);
    marcadoresEstacion.set(icao, { marcador: m, nombre: o.name || '' });
  }

  registrar({
    id: 'estaciones-metar',
    nombre: `Estaciones METAR (${porIcao.size})`,
    grupo: 'Aeródromos',
    capa: capaEstaciones,
    visible: true,
    conOpacidad: false,
    descripcion:
      'Todas las estaciones que reportan METAR dentro de la caja de cobertura nacional, coloreadas por categoría de vuelo a la hora de la barra. ' +
      'No son aeródromos del caso: están para leer la situación de Colombia entera, no la de la ruta.',
  });
  pintarPanelCapas();
}

/** Recolorea las estaciones y reescribe su globo con la observación vigente. */
function actualizarEstaciones(fecha) {
  for (const [icao, { marcador, nombre }] of marcadoresEstacion) {
    const obs = obsVigente(icao, fecha);
    const cat = obs ? obs.fltCat || categoria(obs.clouds, obs.visib) : 'ND';
    marcador.setStyle({ fillColor: colorCat(cat) });
    marcador.setPopupContent(globoEstacion(icao, nombre, obs, cat, fecha));
  }
}

function globoEstacion(icao, nombre, obs, cat, fecha) {
  if (!obs) return `<b>${esc(icao)}</b><br>${esc(nombre)}<br>Sin observación vigente a esta hora.`;
  const t = new Date(obs.reportTime);
  const desfase = Math.round((fecha - t) / 60000);
  return `<b>${esc(icao)}</b> <span style="color:${colorCat(cat)}">${esc(cat)}</span><br>
    ${esc(nombre)}<br>
    <span style="color:var(--muy-tenue)">${esc(horaZLarga(t))} · ${desfase >= 0 ? `${desfase} min antes` : `${Math.abs(desfase)} min después`} de la hora seleccionada</span><br>
    <code style="font-size:11px">${esc(obs.rawOb || '')}</code>`;
}

/* ---------- Selección temporal ---------- */

/** Última observación de ese aeródromo emitida en o antes de la hora dada. */
function obsVigente(icao, fecha) {
  let vigente = null;
  for (const o of observaciones) {
    if (o.icaoId !== icao) continue;
    if (new Date(o.reportTime) <= fecha) vigente = o;
    else break;
  }
  // Si la hora del caso es anterior a todo lo capturado, se usa la más antigua
  // y se marca como fuera de ventana en la interfaz.
  return vigente || observaciones.find((o) => o.icaoId === icao) || null;
}

const tafDe = (icao) => pronosticos.find((t) => t.icaoId === icao) || null;

/* ---------- Categoría de vuelo ---------- */

/** Techo: base más baja con cobertura BKN, OVC u OVX, en pies. */
function techo(clouds) {
  if (!Array.isArray(clouds)) return null;
  const cubiertas = clouds.filter((c) => ['BKN', 'OVC', 'OVX', 'VV'].includes(c.cover) && c.base != null);
  if (!cubiertas.length) return null;
  return Math.min(...cubiertas.map((c) => c.base));
}

/** Visibilidad en millas terrestres a partir del campo, que puede venir como "6+". */
function visibSM(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace('+', ''));
  return Number.isNaN(n) ? null : n;
}

/** Categoría de vuelo según techo y visibilidad (criterio estándar). */
export function categoria(clouds, visib) {
  const c = techo(clouds);
  const v = visibSM(visib);
  if (c == null && v == null) return 'ND';
  const porTecho = c == null ? 'VFR' : c < 500 ? 'LIFR' : c < 1000 ? 'IFR' : c <= 3000 ? 'MVFR' : 'VFR';
  const porVis = v == null ? 'VFR' : v < 1 ? 'LIFR' : v < 3 ? 'IFR' : v <= 5 ? 'MVFR' : 'VFR';
  const orden = ['VFR', 'MVFR', 'IFR', 'LIFR'];
  return orden[Math.max(orden.indexOf(porTecho), orden.indexOf(porVis))];
}

/* ---------- Actualización ---------- */

function actualizar(fecha) {
  const catPorIcao = {};
  const tarjetas = [];

  for (const ad of caso.aerodromos) {
    const obs = obsVigente(ad.icao, fecha);
    const cat = obs ? obs.fltCat || categoria(obs.clouds, obs.visib) : 'ND';
    catPorIcao[ad.icao] = cat;
    tarjetas.push(tarjeta(ad, obs, tafDe(ad.icao), cat, fecha));
  }

  colorearAerodromos(catPorIcao);
  actualizarEstaciones(fecha);

  const encabezado = capturadoEn
    ? `<div class="hora-obs" style="margin-bottom:12px">Instantánea congelada el ${esc(fechaHoraZ(new Date(capturadoEn)))} · fuente: Aviation Weather Center</div>`
    : `<div class="hora-obs" style="margin-bottom:12px">Sin datos capturados. Ejecuta <code>node herramientas/capturar-datos.mjs</code></div>`;

  $('#tab-meteo').innerHTML = encabezado + tarjetas.join('');
  activarDecodificadores($('#tab-meteo'));

  $('#tab-meteo').querySelectorAll('[data-ir-a]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => centrarEn(el.dataset.irA));
  });
}

function tarjeta(ad, obs, taf, cat, fecha) {
  if (!obs) {
    return `<div class="tarjeta" id="tarjeta-${esc(ad.icao)}">
      <div class="tarjeta-cab" data-ir-a="${esc(ad.icao)}">
        <span class="icao">${esc(ad.icao)}</span>
        <span class="rol">${esc(ad.rol)}</span>
        <span class="cat cat-ND">ND</span>
      </div>
      <div class="crudo">Sin observación capturada para este aeródromo.</div>
    </div>`;
  }

  const t = new Date(obs.reportTime);
  const desfase = Math.round((fecha - t) / 60000);
  const antiguedad = desfase < 0
    ? `<span style="color:var(--sev-leve)">emitido ${Math.abs(desfase)} min después de la hora seleccionada</span>`
    : `${desfase} min antes de la hora seleccionada`;

  const nubes = (obs.clouds || [])
    .map((c) => `${c.cover}${c.base != null ? ' ' + c.base.toLocaleString('es') + ' ft' : ''}`)
    .join(', ') || 'sin capa significativa';

  return `
  <div class="tarjeta" id="tarjeta-${esc(ad.icao)}">
    <div class="tarjeta-cab" data-ir-a="${esc(ad.icao)}" title="Centrar en el mapa">
      <span class="icao">${esc(ad.icao)}</span>
      <span class="rol">${esc(ad.rol)}</span>
      <span class="cat cat-${esc(cat)}">${esc(cat)}</span>
    </div>
    <div class="hora-obs">${esc(horaZLarga(t))} · ${antiguedad}</div>
    <div class="crudo">${esc(obs.rawOb || '')}</div>
    ${bloqueDecodificado(obs.rawOb, 'm-' + ad.icao)}
    <div class="campos">
      <div><div class="campo-etq">Viento</div><div class="campo-val">${vientoTexto(obs)}</div></div>
      <div><div class="campo-etq">Visibilidad</div><div class="campo-val">${esc(obs.visib ?? '—')} SM</div></div>
      <div><div class="campo-etq">Temp / Rocío</div><div class="campo-val">${obs.temp ?? '—'}° / ${obs.dewp ?? '—'}°</div></div>
      <div><div class="campo-etq">QNH</div><div class="campo-val">${obs.altim ? Math.round(obs.altim) + ' hPa' : '—'}</div></div>
      <div style="grid-column:1/-1"><div class="campo-etq">Nubosidad</div><div class="campo-val">${esc(nubes)}</div></div>
      <div style="grid-column:1/-1"><div class="campo-etq">Spread</div><div class="campo-val">${spread(obs)}</div></div>
    </div>
    ${bloqueTaf(taf, fecha)}
  </div>`;
}

/* ---------- Decodificación grupo a grupo ----------
   El crudo se queda donde estaba: es la fuente y es lo que se cita. Esto se
   despliega debajo y traduce cada grupo al lado del original, para que cualquiera
   pueda comprobar la lectura sin saber leer un METAR de memoria. */

export function bloqueDecodificado(crudo, id) {
  if (!crudo) return '';
  const grupos = decodificarParte(crudo);
  if (!grupos.length) return '';
  return `
    <button class="dec-boton" data-dec="${esc(id)}">Descifrar el parte</button>
    <div class="decodificado" id="dec-${esc(id)}" hidden>
      ${grupos.map((g) => `
        <div class="dec-grupo t-${esc(g.tipo)}">
          <span class="dec-crudo">${esc(g.crudo)}</span>
          <span class="dec-texto">${esc(g.texto)}</span>
        </div>
        ${g.nota ? `<div class="dec-nota">${esc(g.nota)}</div>` : ''}`).join('')}
      <div class="dec-nota" style="margin-left:0;color:var(--muy-tenue)">
        Categoría de vuelo: ${esc(CRITERIO_CATEGORIA.fuente)}
      </div>
    </div>`;
}

/** Un solo oyente para todos los botones: las tarjetas se repintan a cada hora. */
export function activarDecodificadores(contenedor) {
  if (!contenedor || contenedor.dataset.decListo) return;
  contenedor.dataset.decListo = '1';
  contenedor.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dec]');
    if (!b) return;
    ev.stopPropagation();
    const caja = document.getElementById('dec-' + b.dataset.dec);
    if (!caja) return;
    caja.hidden = !caja.hidden;
    b.textContent = caja.hidden ? 'Descifrar el parte' : 'Ocultar el descifrado';
  });
}

function vientoTexto(o) {
  if (o.wspd === 0 || o.wspd == null) return 'calma';
  const dir = o.wdir === 'VRB' || o.wdir == null ? 'VRB' : String(o.wdir).padStart(3, '0') + '°';
  return `${dir} / ${o.wspd} kt${o.wgst ? ` ráfaga ${o.wgst} kt` : ''}`;
}

/** El spread temp/rocío anticipa niebla: por debajo de 2 °C hay riesgo. */
function spread(o) {
  if (o.temp == null || o.dewp == null) return '—';
  const d = o.temp - o.dewp;
  const alerta = d <= 2 ? ' <span style="color:var(--sev-moderado)">— riesgo de niebla</span>' : '';
  return `${d.toFixed(0)} °C${alerta}`;
}

/* ---------- TAF ---------- */

function bloqueTaf(taf, fecha) {
  if (!taf) return '<div class="hora-obs" style="margin-top:8px">Sin TAF disponible.</div>';

  const periodos = (taf.fcsts || []).map((f) => {
    const desde = new Date(f.timeFrom * 1000);
    const hasta = new Date(f.timeTo * 1000);
    const cat = categoria(f.clouds, f.visib);
    return {
      desde, hasta, cat,
      dur: Math.max(1, (hasta - desde) / 60000),
      tipo: f.fcstChange || 'BASE',
      prob: f.probability,
      vigente: fecha >= desde && fecha < hasta,
    };
  });

  const barra = periodos.length
    ? `<div class="barra-taf">${periodos
        .map(
          (p) => `<div class="periodo-taf ${p.vigente ? 'vigente' : ''}"
                       style="flex-grow:${p.dur};background:${colorCat(p.cat)}"
                       title="${esc(horaZLarga(p.desde))} – ${esc(horaZLarga(p.hasta))} · ${esc(p.tipo)}${p.prob ? ' PROB' + p.prob : ''} · ${esc(p.cat)}">
                    ${p.dur > 90 ? esc(p.tipo === 'BASE' ? p.cat : p.tipo) : ''}
                  </div>`
        )
        .join('')}</div>
       <div class="hora-obs">Periodos del TAF coloreados por categoría de vuelo. El recuadro blanco marca el periodo vigente a la hora seleccionada.</div>`
    : '';

  return `<div style="margin-top:10px">
    <div class="campo-etq" style="margin-bottom:4px">TAF</div>
    <div class="crudo taf">${esc(taf.rawTAF || '')}</div>
    ${barra}
  </div>`;
}

/* ---------- Auxiliar ---------- */

function activarPestana(nombre) {
  document.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.pestana === nombre));
  document.querySelectorAll('.contenido-pestana').forEach((c) => c.classList.toggle('activa', c.id === `tab-${nombre}`));
}

/** La usa la matriz de decisión para puntuar automáticamente el criterio meteorológico. */
export function categoriaEn(icao, fecha) {
  const o = obsVigente(icao, fecha);
  return o ? o.fltCat || categoria(o.clouds, o.visib) : 'ND';
}
