// Guion de la sustentación: escenas. Cada una fija capas, encuadre, banda activa
// y hora Z, de modo que la exposición se conduce con las flechas del teclado.
//
// Hubo un «modo presentación» que ocultaba los paneles y se activaba con la tecla
// P. Se retiró: no había nada en pantalla que lo anunciara ni que dijera cómo
// salir, así que se entraba en él sin querer. Para dejar sitio a la imagen está
// el plegado del panel (tecla H), que sí tiene botón y se ve.

import { bus, $, esc } from './util.js';
import { aplicarConjunto } from './capas.js';
import { obtenerMapa } from './mapa.js';
import { irAFecha, detenerReproduccion } from './tiempo.js';
import { activarBanda, cerrarPanel, compararCon } from './satelite.js';

let caso = null;
let actual = -1;

export function iniciarEscenas(datosCaso) {
  caso = datosCaso;

  // El guion ya no tiene lista en pantalla: se conduce con las flechas y con el
  // modo presentación. Si algún día vuelve a haber un índice visible, basta con
  // que exista #lista-escenas y esto lo vuelve a rellenar.
  const lista = document.getElementById('lista-escenas');
  if (lista) {
    lista.innerHTML = caso.escenas
      .map(
        (e, i) => `
      <div class="escena-item" data-escena="${i}">
        <span class="escena-num">${String(i + 1).padStart(2, '0')}</span>
        <span>${esc(e.titulo)}</span>
      </div>`
      )
      .join('');

    lista.querySelectorAll('.escena-item').forEach((el) => {
      el.addEventListener('click', () => ir(Number(el.dataset.escena)));
    });
  }

  document.getElementById('narracion-cerrar')?.addEventListener('click', cerrarNarracion);

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea, select')) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); ir(actual + 1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); ir(actual - 1); }
    else if (ev.key === 'Escape') cerrarNarracion();
  });
}

export function ir(i) {
  if (i < 0 || i >= caso.escenas.length) return;
  actual = i;
  const e = caso.escenas[i];

  detenerReproduccion();

  document.querySelectorAll('.escena-item').forEach((el, k) => el.classList.toggle('activa', k === i));

  if (e.horaZ) irAFecha(e.horaZ);
  if (Array.isArray(e.capas)) aplicarConjunto(e.capas);

  if (e.banda) {
    activarBanda(e.banda);
    // `comparar` deja la escena ya montada con la cortina entre las dos bandas.
    compararCon(e.comparar || null);
  } else {
    cerrarPanel();
  }

  if (e.vista) {
    obtenerMapa().flyTo([e.vista.lat, e.vista.lon], e.vista.zoom, { duration: 0.9 });
  }

  $('#narracion-titulo').textContent = e.titulo;
  $('#narracion-texto').textContent = e.texto;
  $('#narracion').hidden = false;

  bus.emit('escena', { indice: i, escena: e });
}

/** Cierra el cartel de narración sin salir de la escena. */
export function cerrarNarracion() {
  const n = document.getElementById('narracion');
  if (n) n.hidden = true;
}
