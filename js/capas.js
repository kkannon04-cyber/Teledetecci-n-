// Registro central de capas: encendido/apagado, opacidad y orden.
// Cualquier módulo registra aquí su capa y aparece sola en el panel derecho.

import { bus, $, esc } from './util.js';

const registro = new Map();
let mapa = null;

export function iniciarCapas(instanciaMapa) {
  mapa = instanciaMapa;
}

/**
 * @param {object} def
 *   id, nombre, grupo, capa (L.Layer), visible, conOpacidad, exclusivo (nombre de grupo radio)
 */
export function registrar(def) {
  const capa = {
    conOpacidad: true,
    visible: false,
    exclusivo: null,
    opacidad: 1,
    ...def,
  };
  registro.set(capa.id, capa);
  if (capa.visible) capa.capa.addTo(mapa);
  return capa;
}

export const obtener = (id) => registro.get(id);
export const todas = () => Array.from(registro.values());

export function mostrar(id, visible) {
  const c = registro.get(id);
  if (!c || c.visible === visible) return;

  if (visible && c.exclusivo) {
    // Grupo excluyente (mapas base): apaga los hermanos primero.
    for (const otra of registro.values()) {
      if (otra.exclusivo === c.exclusivo && otra.id !== id && otra.visible) mostrar(otra.id, false);
    }
  }

  c.visible = visible;
  if (visible) c.capa.addTo(mapa);
  else mapa.removeLayer(c.capa);

  sincronizarUI();
  bus.emit('capa-cambio', { id, visible });
}

export function fijarOpacidad(id, valor) {
  const c = registro.get(id);
  if (!c) return;
  c.opacidad = valor;
  if (typeof c.capa.setOpacity === 'function') {
    c.capa.setOpacity(valor);
  } else if (typeof c.capa.setStyle === 'function') {
    c.capa.setStyle({ opacity: valor, fillOpacity: valor * 0.25 });
  } else if (typeof c.capa.eachLayer === 'function') {
    c.capa.eachLayer((hija) => {
      if (typeof hija.setOpacity === 'function') hija.setOpacity(valor);
      else if (typeof hija.setStyle === 'function') hija.setStyle({ opacity: valor, fillOpacity: valor * 0.25 });
    });
  }
}

/** Aplica exactamente el conjunto de capas de una escena. */
export function aplicarConjunto(ids) {
  const deseadas = new Set(ids);
  for (const c of registro.values()) {
    // Los mapas base solo se tocan si la escena nombra alguno.
    if (c.exclusivo && !ids.some((i) => registro.get(i)?.exclusivo === c.exclusivo)) continue;
    mostrar(c.id, deseadas.has(c.id));
  }
}

const ORDEN_GRUPOS = ['Mapa base', 'Ruta', 'Aeródromos', 'Navegación', 'Satélite', 'Fenómenos', 'Avisos', 'Operacional'];

export function pintarPanel() {
  const cont = $('#tab-capas');
  const porGrupo = new Map();
  for (const c of registro.values()) {
    if (!porGrupo.has(c.grupo)) porGrupo.set(c.grupo, []);
    porGrupo.get(c.grupo).push(c);
  }

  // Los grupos conocidos van en el orden declarado; cualquier otro, al final.
  const rango = (g) => (ORDEN_GRUPOS.indexOf(g) === -1 ? ORDEN_GRUPOS.length : ORDEN_GRUPOS.indexOf(g));
  const grupos = Array.from(porGrupo.keys()).sort((a, b) => rango(a) - rango(b));

  cont.innerHTML = grupos
    .map((g) => {
      const filas = porGrupo
        .get(g)
        .map(
          (c) => `
        <div class="capa ${c.visible ? '' : 'apagada'}" data-capa="${esc(c.id)}">
          <input type="checkbox" id="chk-${esc(c.id)}" ${c.visible ? 'checked' : ''} />
          <label for="chk-${esc(c.id)}" title="${esc(c.descripcion || c.nombre)}">${esc(c.nombre)}</label>
          ${c.conOpacidad
            ? `<input type="range" min="0" max="1" step="0.05" value="${c.opacidad}" data-op="${esc(c.id)}" title="Opacidad" />`
            : ''}
        </div>`
        )
        .join('');
      return `<div class="grupo-capa"><div class="grupo-titulo">${esc(g)}</div>${filas}</div>`;
    })
    .join('');

  cont.querySelectorAll('input[type=checkbox]').forEach((el) => {
    el.addEventListener('change', () => mostrar(el.closest('.capa').dataset.capa, el.checked));
  });
  cont.querySelectorAll('input[type=range]').forEach((el) => {
    el.addEventListener('input', () => fijarOpacidad(el.dataset.op, Number(el.value)));
  });
}

/** Refresca las casillas sin volver a construir el panel entero. */
function sincronizarUI() {
  for (const c of registro.values()) {
    const fila = document.querySelector(`.capa[data-capa="${CSS.escape(c.id)}"]`);
    if (!fila) continue;
    fila.classList.toggle('apagada', !c.visible);
    const chk = fila.querySelector('input[type=checkbox]');
    if (chk && chk.checked !== c.visible) chk.checked = c.visible;
  }
}
