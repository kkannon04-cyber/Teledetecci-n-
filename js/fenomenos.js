// Fenómenos meteorológicos identificados sobre la evidencia satelital.
// Cada polígono lleva su ficha de análisis: qué banda lo revela y por qué.

import { bus, $, esc, horaZLarga, aFecha } from './util.js';
import { registrar } from './capas.js';
import { obtenerMapa } from './mapa.js';

const COLOR_SEV = { leve: '#d29922', moderado: '#f0883e', severo: '#f85149' };
const ICONO_TIPO = {
  convectivo: '⛈',
  engelamiento: '❄',
  turbulencia: '≋',
  visibilidad: '☁',
  viento: '➤',
  ceniza: '▲',
};

let coleccion = null;
let capaGeo = null;
let bandas = [];
const porId = new Map();

/** Caja propia dentro de la pestaña: el bloque SIGMET comparte ese contenedor. */
function contenedor() {
  let caja = document.getElementById('bloque-fenomenos');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'bloque-fenomenos';
    $('#tab-fenomenos').append(caja);
  }
  return caja;
}

export function iniciarFenomenos(geojson, bandasSat) {
  coleccion = geojson;
  bandas = bandasSat || [];
  if (!coleccion?.features?.length) {
    contenedor().innerHTML = `
      <div class="grupo-titulo" style="margin-top:16px">Fenómenos interpretados</div>
      <div class="hora-obs">
        Sin fenómenos trazados todavía. Se definen en <code>datos/fenomenos.geojson</code>
        a partir de la evidencia satelital, que en este caso está pendiente.
      </div>`;
    return;
  }

  capaGeo = L.geoJSON(coleccion, {
    style: (f) => estilo(f.properties, true),
    onEachFeature: (f, capa) => {
      porId.set(f.properties.id, capa);
      capa.bindTooltip(`${ICONO_TIPO[f.properties.tipo] || '●'} ${f.properties.nombre}`, { sticky: true });
      capa.on('click', () => abrirFicha(f.properties.id));
    },
  });

  registrar({
    id: 'fenomenos',
    nombre: 'Fenómenos identificados',
    grupo: 'Fenómenos',
    capa: capaGeo,
    visible: true,
    opacidad: 1,
    descripcion: 'Polígonos trazados a partir de la evidencia satelital. Clic para ver la ficha de análisis.',
  });

  bus.on('tiempo', ({ fecha }) => actualizarVigencia(fecha));
  pintarPanel();
}

function estilo(p, activo) {
  const color = COLOR_SEV[p.severidad] || '#8b98a5';
  return {
    color,
    weight: activo ? 2 : 1,
    opacity: activo ? 0.95 : 0.3,
    fillColor: color,
    fillOpacity: activo ? 0.18 : 0.05,
    dashArray: activo ? null : '4,5',
  };
}

/** Atenúa los fenómenos que no están vigentes a la hora seleccionada. */
function actualizarVigencia(fecha) {
  if (!capaGeo) return;
  capaGeo.eachLayer((capa) => {
    const p = capa.feature.properties;
    const activo = fecha >= aFecha(p.desdeZ) && fecha <= aFecha(p.hastaZ);
    capa.setStyle(estilo(p, activo));
    const fila = document.querySelector(`.fenomeno[data-id="${CSS.escape(p.id)}"]`);
    if (fila) fila.style.opacity = activo ? '1' : '0.42';
  });
}

function nombreBanda(id) {
  const b = bandas.find((x) => x.id === id);
  return b ? `${b.nombre} · ${b.canal}` : id;
}

/**
 * La interpretación del GeoJSON viene envuelta en dos frases de método: un
 * preámbulo que remite a «la medida anterior» —la evidencia, que este panel ya
 * no muestra— y una coletilla que remite al campo interno `pasos`. Sin la
 * evidencia delante, la primera queda colgando; la segunda señala a algo que el
 * lector no tiene. Se recortan aquí, en la presentación: el dato no se toca y,
 * si el generador cambia el texto, el recorte no encuentra nada y no hace nada.
 * La advertencia de que esto es interpretación y no observación no se pierde:
 * pasa al rótulo del bloque.
 */
const PREAMBULO_ANALISTA = 'INTERPRETACIÓN DEL ANALISTA sobre la medida anterior, no dato observado. ';
const COLETILLA_PASOS =
  ' La temperatura sola no distingue fase de crecimiento de fase de disipación: ' +
  'para eso está la evolución del área y del percentil, que va en `pasos`.';

function sinMetodologia(texto) {
  let t = texto || '';
  if (t.startsWith(PREAMBULO_ANALISTA)) t = t.slice(PREAMBULO_ANALISTA.length);
  if (t.endsWith(COLETILLA_PASOS)) t = t.slice(0, -COLETILLA_PASOS.length);
  return t.trim();
}

function pintarPanel() {
  const cont = contenedor();
  cont.innerHTML =
    `<div class="grupo-titulo" style="margin-top:16px">Fenómenos interpretados</div>
     <div class="hora-obs" style="margin-bottom:10px">
       ${coleccion.features.length} fenómenos identificados. Los atenuados no están vigentes a la hora seleccionada.
     </div>` +
    coleccion.features
      .map((f) => {
        const p = f.properties;
        const apoyo = (p.bandasApoyo || []).map((b) => `<span class="etiqueta-banda">${esc(nombreBanda(b))}</span>`).join('');
        return `
      <div class="fenomeno sev-${esc(p.severidad)}" data-id="${esc(p.id)}">
        <h4>${ICONO_TIPO[p.tipo] || '●'} ${esc(p.nombre)}</h4>
        <div class="meta">${esc(p.severidad.toUpperCase())} · ${esc(p.nivelesFt)} · ${esc(horaZLarga(aFecha(p.desdeZ)))}–${esc(horaZLarga(aFecha(p.hastaZ)))}</div>
        <div class="detalle">
          <div><span class="etiqueta-banda">Banda clave: ${esc(nombreBanda(p.bandaClave))}</span>${apoyo}</div>
          <dl>
            <dt>Interpretación <span class="marca-analista">del analista, no dato observado</span></dt>
            <dd>${esc(sinMetodologia(p.interpretacion))}</dd>
            <dt>Impacto operacional</dt><dd>${esc(p.impacto)}</dd>
            <dt>Recomendación</dt><dd>${esc(p.recomendacion)}</dd>
          </dl>
        </div>
      </div>`;
      })
      .join('');

  cont.querySelectorAll('.fenomeno').forEach((el) => {
    el.addEventListener('click', () => {
      const abierto = el.classList.contains('abierto');
      cont.querySelectorAll('.fenomeno').forEach((o) => o.classList.remove('abierto'));
      if (!abierto) {
        el.classList.add('abierto');
        const capa = porId.get(el.dataset.id);
        if (capa) obtenerMapa().fitBounds(capa.getBounds(), { padding: [60, 60] });
      }
    });
  });
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
