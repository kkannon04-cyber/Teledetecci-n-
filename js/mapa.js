// Mapa Leaflet: mapas base, ruta, aeródromos, anillos operacionales
// y el marcador de aeronave que se mueve con la barra de tiempo.

import { bus, colorCat, distanciaNM, puntoEnRuta, longitudRuta, esc, aFecha, minutosEntre } from './util.js';
import { registrar, iniciarCapas } from './capas.js';
import { montarBoton } from './pantalla.js';

let mapa = null;
let caso = null;
let marcadorAeronave = null;
let capaAerodromos = null;
let indiceTeselas = null; // qué teselas del mapa base están guardadas en disco
const marcadoresAD = new Map();

export function crearMapa(datosCaso, indiceMapa = null) {
  caso = datosCaso;
  indiceTeselas = indiceMapa;

  mapa = L.map('mapa', {
    center: [8.0, -74.3],
    zoom: 6,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  });
  iniciarCapas(mapa);

  crearMapasBase();
  crearRuta();
  crearAerodromos();
  crearRadioayudas();
  crearZonas();
  crearHuellaSatelite();
  crearAnillos();
  crearPrecipitacion();
  crearAeronave();

  crearBotonPantalla();

  bus.on('tiempo', ({ fecha }) => moverAeronave(fecha));
  return mapa;
}

/**
 * Botón de pantalla completa del mapa, debajo del zoom de Leaflet.
 *
 * Va dentro del contenedor del propio mapa y no en una barra aparte porque en
 * pantalla completa lo único que se ve es ese contenedor: un botón de fuera se
 * quedaría escondido detrás y no habría forma de salir salvo con Escape.
 */
function crearBotonPantalla() {
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const caja = L.DomUtil.create('div', 'leaflet-bar ctrl-pantalla-mapa');
      L.DomEvent.disableClickPropagation(caja);
      // Leaflet redibuja sus teselas por el tamaño que tenía el contenedor: sin
      // invalidateSize, al entrar en pantalla completa queda un mapa pequeño en una
      // esquina rodeado de gris.
      montarBoton(caja, document.getElementById('mapa'), () => mapa.invalidateSize());
      return caja;
    },
  });
  mapa.addControl(new Control());
}

export const obtenerMapa = () => mapa;

/* ---------- Mapas base ---------- */

function crearMapasBase() {
  // Se evita CARTO a propósito: desde que exige apikey, sus tiles llegan con la
  // marca de agua "API KEY REQUIRED" incrustada en la imagen (responde 200, así
  // que no se detecta como error). Esri sirve estos servicios sin clave.
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const attEsri = 'Esri, HERE, Garmin, © OpenStreetMap contributors';

  // El fondo oscuro son dos capas: relleno + rótulos, como los publica Esri.
  const oscuro = L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      attribution: attEsri,
      maxZoom: 16,
    }),
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 16,
    }),
  ]);

  // Relieve: las teselas guardadas en medios/mapa/ para la zona del caso, y las de
  // fuera desde internet. Así el proyecto entregado se abre y pinta el mapa sin red
  // —que es lo que hace falta para exponerlo o para mandárselo a alguien— y quien
  // sí tenga red puede irse a cualquier parte del mundo.
  //
  // Cuál es cuál lo dice medios/mapa/indice.json, que enumera lo guardado. Se
  // consulta ANTES de pedir la tesela: probar y esperar el 404 también funcionaría
  // —hay respaldo remoto igualmente— pero llenaría la consola de errores falsos.
  const OTM = 'https://a.tile.opentopomap.org';
  const guardada = (c) => {
    const r = indiceTeselas?.zooms?.[c.z];
    return r && c.x >= r.x[0] && c.x <= r.x[1] && c.y >= r.y[0] && c.y <= r.y[1];
  };

  const CapaRelieve = L.TileLayer.extend({
    getTileUrl(c) {
      return guardada(c) ? `medios/mapa/${c.z}/${c.x}/${c.y}.png` : `${OTM}/${c.z}/${c.x}/${c.y}.png`;
    },
  });
  const relieve = new CapaRelieve('', {
    attribution: '© OpenTopoMap, © OpenStreetMap',
    maxZoom: 17,
  });
  // Y si una guardada faltara —descarga incompleta—, se reintenta fuera antes de
  // dejar el hueco en blanco.
  relieve.on('tileerror', (ev) => {
    const t = ev.tile;
    if (!t || t.dataset.remoto || !guardada(ev.coords)) return;
    t.dataset.remoto = '1';
    t.src = `${OTM}/${ev.coords.z}/${ev.coords.x}/${ev.coords.y}.png`;
  });

  const imagen = L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  });

  // Fondo claro: es el que se imprime bien en el informe y la bitácora.
  const claro = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  });

  registrar({ id: 'base-relieve', nombre: 'Relieve', grupo: 'Mapa base', capa: relieve, visible: true, exclusivo: 'base', descripcion: 'Topografía. Justifica altitudes mínimas, engelamiento orográfico y viabilidad de alternos de montaña. Es el único fondo guardado en el proyecto: los otros tres necesitan internet.' });
  registrar({ id: 'base-oscuro', nombre: 'Mapa oscuro', grupo: 'Mapa base', capa: oscuro, exclusivo: 'base', descripcion: 'Fondo neutro. Máximo contraste para las capas superpuestas. Necesita internet.' });
  registrar({ id: 'base-imagen', nombre: 'Imagen satelital', grupo: 'Mapa base', capa: imagen, exclusivo: 'base', descripcion: 'Ortoimagen de referencia geográfica.' });
  registrar({ id: 'base-claro', nombre: 'Mapa claro (impresión)', grupo: 'Mapa base', capa: claro, exclusivo: 'base', descripcion: 'Fondo claro de OpenStreetMap. Es el que conviene para exportar el informe y la bitácora a PDF.' });
}

/* ---------- Ruta ---------- */

/**
 * Por qué este vuelo va a FL210 y no a FL200.
 *
 * El nivel de crucero no se elige: lo impone la tabla semicircular a partir de
 * la derrota MAGNÉTICA, y esa derrota depende de la declinación, que cambia a lo
 * largo de 553 NM. Se muestra tramo a tramo para que se vea que la regla se
 * cumple en toda la ruta y no solo en el rumbo directo.
 */
function tablaNiveles() {
  const n = caso.nivelesCrucero;
  if (!n) return '';

  const filas = (n.segmentos || [])
    .map(
      (s) => `<tr>
        <td style="padding:1px 8px 1px 0;font-family:var(--mono)">${esc(s.desde)}→${esc(s.hasta)}</td>
        <td style="padding:1px 8px;text-align:right;font-family:var(--mono)">${s.rumboVerdadero.toFixed(1)}°</td>
        <td style="padding:1px 8px;text-align:right;font-family:var(--mono);color:#8b98a5">${s.declinacion.toFixed(2)}°</td>
        <td style="padding:1px 8px;text-align:right;font-family:var(--mono);font-weight:700">${s.rumboMagnetico.toFixed(1)}°</td>
        <td style="padding:1px 0 1px 8px;color:#8b98a5">${esc(s.semicirculo)}</td>
      </tr>`
    )
    .join('');

  return `
    <details style="margin-top:8px;border-top:1px solid #30363d;padding-top:7px">
      <summary style="cursor:pointer;font-size:11px;color:#4da3ff">
        Nivel <b>${esc(n.nivelAsignado)}</b> — tabla semicircular (${esc(n.aplicacion)})
      </summary>
      <div style="font-size:10.5px;line-height:1.6;color:#c9d1d9;margin-top:6px">
        ${esc(n.regla)}
        <table style="margin:7px 0;border-collapse:collapse;font-size:10px">
          <tr style="color:#8b98a5">
            <td style="padding-right:8px">Tramo</td>
            <td style="padding:0 8px;text-align:right">RV</td>
            <td style="padding:0 8px;text-align:right">Var</td>
            <td style="padding:0 8px;text-align:right">RM</td>
            <td style="padding-left:8px">Semicírculo</td>
          </tr>
          ${filas}
        </table>
        <div style="color:#8b98a5">${esc(n.margen)}</div>
        ${n.nivelDescartado
          ? `<div style="margin-top:6px"><b>${esc(n.nivelDescartado.nivel)} descartado.</b> ${esc(n.nivelDescartado.motivo)}</div>`
          : ''}
        <div style="margin-top:6px;color:#8b98a5">Declinación: ${esc(n.declinacion?.modelo || '')}, época ${esc(n.declinacion?.epoca || '')} (${esc(n.declinacion?.incertidumbre || '')}).</div>
      </div>
    </details>`;
}

function crearRuta() {
  const wps = caso.ruta.waypoints;
  const linea = L.polyline(wps.map((w) => [w.lat, w.lon]), {
    color: '#4da3ff',
    weight: 3,
    opacity: 0.95,
    dashArray: '1,0',
  });

  // La cadena ATS completa queda a un clic sobre el trazado: es la trazabilidad
  // de que los puntos no son inventados sino aerovías publicadas.
  if (caso.ruta.cadenaATS) {
    const vias = (caso.ruta.aerovias || [])
      .map((v) => `<b>${esc(v.designador)}</b> ${esc(v.desde)} → ${esc(v.hasta)} <span style="color:#5c6773">(${esc(v.clase)}, ${esc(v.fuente)})</span>`)
      .join('<br>');
    linea.bindPopup(`
      <div style="min-width:250px">
        <div style="font-family:var(--mono);font-size:12.5px;font-weight:700">${esc(caso.ruta.cadenaATS)}</div>
        <div style="color:#8b98a5;margin:6px 0">${Math.round(longitudRuta(wps))} NM · ${wps.length} puntos</div>
        <div style="font-size:11px;line-height:1.8">${vias}</div>
        ${tablaNiveles()}
      </div>`, { maxWidth: 420 });
  }

  const grupo = L.layerGroup([linea]);

  for (const w of wps) {
    if (w.tipo === 'aerodromo') continue; // Ya lo dibuja la capa de aeródromos
    const simbolo = { toc: '▲', tod: '▼', vor: '◇' }[w.tipo] || '△';
    L.marker([w.lat, w.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="color:#4da3ff;font-size:11px;text-shadow:0 0 4px #000">${simbolo}</div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
    })
      .bindTooltip(w.nombre, { permanent: true, direction: 'top', className: 'etiqueta-wp', offset: [0, -6] })
      .addTo(grupo);
  }

  const nm = Math.round(longitudRuta(wps));
  registrar({
    id: 'ruta',
    nombre: `Ruta y waypoints (${nm} NM)`,
    grupo: 'Ruta',
    capa: grupo,
    visible: true,
    descripcion: caso.ruta.cadenaATS
      ? `${caso.ruta.cadenaATS} — ${nm} NM. Clic sobre el trazado para ver las aerovías. Puntos del AIP Colombia; TOC y TOD calculados.`
      : `Trazado de ${caso.ruta.origen} a ${caso.ruta.destino}, ${nm} NM.`,
  });
}

/* ---------- Aeródromos ---------- */

function iconoAD(ad, cat) {
  const color = colorCat(cat);
  const tam = ad.rol === 'alterno' ? 12 : 16;
  return L.divIcon({
    className: '',
    html: `<div class="marcador-ad" style="width:${tam}px;height:${tam}px;background:${color};color:${color}"></div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
  });
}

function crearAerodromos() {
  capaAerodromos = L.layerGroup();

  for (const ad of caso.aerodromos) {
    const m = L.marker([ad.lat, ad.lon], { icon: iconoAD(ad, 'ND'), zIndexOffset: 500 })
      .bindTooltip(ad.icao, { permanent: true, direction: 'right', className: 'etiqueta-ad', offset: [9, 0] })
      .bindPopup(popupAD(ad));
    m.on('click', () => bus.emit('aerodromo-seleccionado', ad.icao));
    m.addTo(capaAerodromos);
    marcadoresAD.set(ad.icao, { marcador: m, ad });
  }

  registrar({
    id: 'aerodromos',
    nombre: 'Aeródromos',
    grupo: 'Aeródromos',
    capa: capaAerodromos,
    visible: true,
    conOpacidad: false,
    descripcion: 'Color según categoría de vuelo del METAR vigente (VFR / MVFR / IFR / LIFR).',
  });
}

function popupAD(ad) {
  const pistas = ad.pistas
    .map((p) => {
      const metros = p.longitudM ? ` (${p.longitudM.toLocaleString('es')} × ${p.anchoM} m, ${p.superficie})` : '';
      return `${p.designacion} — ${p.longitudFt.toLocaleString('es')} ft${metros}`;
    })
    .join('<br>');
  return `
    <div style="min-width:210px">
      <div style="font-family:var(--mono);font-size:15px;font-weight:700">${esc(ad.icao)}</div>
      <div style="color:#8b98a5;margin-bottom:6px">${esc(ad.nombre)} — ${esc(ad.ciudad)}</div>
      <div style="font-size:11px;line-height:1.7">
        <b>Elevación</b> ${ad.elevFt.toLocaleString('es')} ft<br>
        <b>Pistas</b><br>${pistas}<br>
        <b>Ayudas</b> ${esc(ad.ayudas.join(', '))}<br>
        <b>Horario</b> ${esc(ad.horario)}
      </div>
      <div style="margin-top:7px;font-size:11px;color:#8b98a5;font-style:italic">${esc(ad.notas)}</div>
    </div>`;
}

/** La llama el módulo de meteorología cuando cambia la hora. */
export function colorearAerodromos(catPorIcao) {
  for (const [icao, { marcador, ad }] of marcadoresAD) {
    marcador.setIcon(iconoAD(ad, catPorIcao[icao] || 'ND'));
  }
}

export function centrarEn(icao) {
  const e = marcadoresAD.get(icao);
  if (e) {
    mapa.setView([e.ad.lat, e.ad.lon], Math.max(mapa.getZoom(), 8));
    e.marcador.openPopup();
  }
}

/* ---------- Radioayudas (AIP ENR 4.1) ---------- */

function crearRadioayudas() {
  // Las radioayudas que la ruta sobrevuela ya las dibuja la capa de ruta: aquí
  // van todas las demás del país, que son las que anclan a los alternos y las que
  // dan referencia fuera del corredor.
  const vores = (caso.navegacion?.vor || []).filter((v) => !v.enRuta);
  if (!vores.length) return;

  const grupo = L.layerGroup();
  for (const v of vores) {
    L.marker([v.lat, v.lon], {
      icon: L.divIcon({
        className: '',
        html: '<div style="color:#8b98a5;font-size:13px;line-height:13px;text-shadow:0 0 4px #000">◇</div>',
        iconSize: [13, 13],
        iconAnchor: [6.5, 6.5],
      }),
    })
      .bindTooltip(v.ident, { direction: 'bottom', className: 'etiqueta-wp', offset: [0, 5] })
      .bindPopup(`
        <div style="min-width:180px">
          <div style="font-family:var(--mono);font-size:15px;font-weight:700">${esc(v.ident)}</div>
          <div style="color:#8b98a5;margin-bottom:6px">${v.nombre
            ? esc(v.nombre)
            : '<i>nombre no publicado en la base consultada</i>'}</div>
          <div style="font-size:11px;line-height:1.7">
            <b>Tipo</b> ${esc(v.tipo)}<br>
            <b>Coordenadas</b> ${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}<br>
            ${v.distanciaRutaNM != null ? `<b>Separación a la ruta</b> ${v.distanciaRutaNM} NM<br>` : ''}
            <b>Fuente</b> ${esc(v.fuente)}
          </div>
        </div>`)
      .addTo(grupo);
  }

  registrar({
    id: 'vor',
    nombre: `Radioayudas ENR 4.1 (${vores.length})`,
    grupo: 'Navegación',
    capa: grupo,
    conOpacidad: false,
    descripcion: 'VOR/DME publicados en AIP Colombia ENR 4.1 fuera de la ruta, de todo el país. Son las radioayudas de referencia de los alternos. Los que llegan sin nombre lo dicen en su globo: la base publica identificador y coordenadas, no el nombre de la estación.',
  });
}

/* ---------- Zonas restringidas (AIP ENR 5.1) ---------- */

const COLOR_ZONA = { P: '#f85149', R: '#f0883e', D: '#d29922' };

function crearZonas() {
  const zonas = caso.navegacion?.zonas || [];
  if (!zonas.length) return;

  const grupo = L.layerGroup();
  for (const z of zonas) {
    const color = COLOR_ZONA[z.clase] || '#8b98a5';
    const techo = z.hastaEtq || `${z.hastaFt.toLocaleString('es')} ft`;
    L.circle([z.lat, z.lon], {
      radius: z.radioNM * 1852,
      color,
      weight: z.afectaRuta ? 2 : 1,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: z.afectaRuta ? 0.18 : 0.07,
      dashArray: z.afectaRuta ? null : '4,5',
    })
      .bindTooltip(`${z.id} · ${z.claseTexto}`, { sticky: true })
      .bindPopup(`
        <div style="min-width:220px">
          <div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${color}">${esc(z.id)}</div>
          <div style="color:#8b98a5;margin-bottom:6px">${esc(z.nombre)} — zona ${esc(z.claseTexto.toLowerCase())}</div>
          <div style="font-size:11px;line-height:1.7">
            <b>Límites verticales</b> ${z.desdeFt === 0 ? 'SFC' : z.desdeFt.toLocaleString('es') + ' ft'} – ${esc(techo)}<br>
            <b>Separación a la ruta</b> ${z.distanciaRutaNM} NM<br>
            <b>Fuente</b> ${esc(z.fuente)}
          </div>
          <div style="margin-top:7px;font-size:11px;color:#8b98a5;font-style:italic">
            Círculo de ${z.radioNM} NM alrededor del punto de referencia publicado: representación ilustrativa.
            El AIP remite el trazado lateral al RAC 5-1.3 y a las cartas de radionavegación.
          </div>
        </div>`)
      .addTo(grupo);
  }

  const enRuta = zonas.filter((z) => z.afectaRuta).length;
  registrar({
    id: 'zonas',
    nombre: `Zonas P/R/D (${zonas.length}${enRuta ? `, ${enRuta} sobre la ruta` : ''})`,
    grupo: 'Navegación',
    capa: grupo,
    descripcion: 'Zonas prohibidas, restringidas y peligrosas de AIP Colombia ENR 5.1 en todo el país, no solo junto a la ruta. Trazado ilustrativo de 5 NM, no el límite lateral oficial.',
  });
}

/* ---------- Huella del recorte satelital ---------- */

function crearHuellaSatelite() {
  const contorno = caso.satelite?._recorte?.contorno;
  if (!Array.isArray(contorno) || contorno.length < 3) return;

  // El borde no es un rectángulo: el recorte es rectangular en la rejilla del
  // satélite, y proyectado sobre el mapa sale ligeramente curvado. Se dibuja el
  // contorno real, no una caja aproximada.
  const grupo = L.layerGroup();
  L.polygon(contorno, {
    color: '#d2a8ff',
    weight: 1.5,
    dashArray: '7,6',
    fill: false,
    interactive: false,
  }).addTo(grupo);

  const lats = contorno.map((p) => p[0]);
  const lons = contorno.map((p) => p[1]);
  const centroArriba = [Math.max(...lats), (Math.min(...lons) + Math.max(...lons)) / 2];
  L.marker(centroArriba, {
    icon: L.divIcon({
      className: '',
      html: '<div class="etq-huella">COBERTURA DE LAS BANDAS</div>',
      iconSize: [190, 16],
      iconAnchor: [95, 16],
    }),
    interactive: false,
  }).addTo(grupo);

  registrar({
    id: 'huella-satelite',
    nombre: 'Cobertura de las bandas',
    grupo: 'Satélite',
    capa: grupo,
    visible: true,
    conOpacidad: false,
    descripcion:
      'Trozo de mundo que abarcan las imágenes del panel satelital. Sale curvado porque el recorte es rectangular en la rejilla del satélite, no en el mapa.',
  });
}

/* ---------- Anillos operacionales ---------- */

function crearAnillos() {
  const grupo = L.layerGroup();
  const destino = caso.aerodromos.find((a) => a.icao === caso.ruta.destino);
  if (!destino) return;

  // Anillo de 100 NM alrededor del destino: referencia de proximidad de alternos.
  L.circle([destino.lat, destino.lon], {
    radius: 100 * 1852,
    color: '#4da3ff',
    weight: 1,
    dashArray: '5,6',
    fill: false,
  })
    .bindTooltip('100 NM del destino', { direction: 'top' })
    .addTo(grupo);

  // Distancia destino → cada alterno, dibujada y rotulada.
  for (const alt of caso.aerodromos.filter((a) => a.rol === 'alterno')) {
    const nm = Math.round(distanciaNM(destino, alt));
    L.polyline([[destino.lat, destino.lon], [alt.lat, alt.lon]], {
      color: '#8b98a5',
      weight: 1,
      dashArray: '3,5',
      opacity: 0.8,
    })
      .bindTooltip(`${destino.icao} → ${alt.icao}: ${nm} NM`, { sticky: true })
      .addTo(grupo);
  }

  registrar({
    id: 'anillos',
    nombre: 'Anillos y distancias a alternos',
    grupo: 'Operacional',
    capa: grupo,
    descripcion: 'Anillo de 100 NM del destino y distancia a cada alterno candidato.',
  });
}

/* ---------- Precipitación ---------- */

function crearPrecipitacion() {
  // RainViewer: contraste independiente frente a la interpretación satelital.
  const capa = L.tileLayer('https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/4/1_1.png', {
    attribution: 'RainViewer',
    opacity: 0.7,
    maxZoom: 12,
  });
  registrar({
    id: 'precipitacion',
    nombre: 'Precipitación (radar)',
    grupo: 'Avisos',
    capa,
    opacidad: 0.7,
    descripcion: 'Mosaico de radar/nowcast. Contraste independiente contra lo interpretado en el satélite. Requiere conexión.',
  });
}

/* ---------- Aeronave ---------- */

function crearAeronave() {
  marcadorAeronave = L.marker([caso.ruta.waypoints[0].lat, caso.ruta.waypoints[0].lon], {
    icon: iconoAeronave(0),
    zIndexOffset: 1000,
    interactive: false,
  });
  registrar({
    id: 'aeronave',
    nombre: 'Posición de la aeronave',
    grupo: 'Ruta',
    capa: marcadorAeronave,
    visible: true,
    conOpacidad: false,
    descripcion: 'Posición estimada según la hora de la barra de tiempo, interpolada por distancia.',
  });
}

function iconoAeronave(rumboGrados) {
  return L.divIcon({
    className: '',
    html: `<svg id="insignia-aeronave" width="26" height="26" viewBox="0 0 24 24"
             style="transform:rotate(${rumboGrados}deg)">
             <path d="M12 2 L14.2 11 L22 14.4 L22 16.2 L14.2 14.4 L14.2 19.6 L16.6 21.4 L16.6 22.6 L12 21.4
                      L7.4 22.6 L7.4 21.4 L9.8 19.6 L9.8 14.4 L2 16.2 L2 14.4 L9.8 11 Z"
                   fill="#f0f6fc" stroke="#0d1117" stroke-width="0.8"/>
           </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function moverAeronave(fecha) {
  const salida = aFecha(caso.vuelo.salidaZ);
  const eta = aFecha(caso.vuelo.etaZ);
  const duracion = minutosEntre(salida, eta);
  const transcurrido = minutosEntre(salida, fecha);
  const fraccion = duracion <= 0 ? 0 : transcurrido / duracion;

  const p = puntoEnRuta(caso.ruta.waypoints, fraccion);
  marcadorAeronave.setLatLng([p.lat, p.lon]);
  marcadorAeronave.setIcon(iconoAeronave(p.rumbo));

  // Fuera de la ventana del vuelo la aeronave se atenúa: no está volando.
  const enVuelo = fraccion >= 0 && fraccion <= 1;
  const el = marcadorAeronave.getElement();
  if (el) el.style.opacity = enVuelo ? '1' : '0.28';

  bus.emit('posicion-aeronave', { ...p, fraccion, enVuelo });
}
