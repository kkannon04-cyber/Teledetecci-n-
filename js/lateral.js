// Plegado del panel de herramientas.
//
// El panel ocupa 340 px fijos, que en un portátil es la cuarta parte de la
// pantalla. Durante una sustentación lo que hay que mirar es la imagen de
// satélite y el corte, no la lista de capas: esto lo quita de en medio sin
// perderlo, y lo devuelve con la misma tecla.
//
// Al plegarlo cambia el ancho del escenario, así que hay que avisar a Leaflet:
// si no, el mapa se queda con el tamaño anterior y lo que se ve son teselas
// estiradas y el encuadre corrido.

import { bus, $ } from './util.js';

const CLASE = 'lateral-oculto';
let plegado = false;

export function iniciarLateral() {
  const btn = $('#btn-lateral');
  if (!btn) return;

  btn.addEventListener('click', () => alternar());

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea, select')) return;
    if (ev.key === 'h' || ev.key === 'H') { ev.preventDefault(); alternar(); }
  });

  aplicar();
}

export function alternar(forzar) {
  plegado = typeof forzar === 'boolean' ? forzar : !plegado;
  aplicar();
}

export const lateralPlegado = () => plegado;

function aplicar() {
  document.body.classList.toggle(CLASE, plegado);
  const btn = $('#btn-lateral');
  if (btn) {
    btn.textContent = plegado ? 'Panel ⟨' : 'Panel ⟩';
    btn.classList.toggle('activo', plegado);
    btn.title = plegado
      ? 'Desplegar el panel de herramientas (tecla H)'
      : 'Plegar el panel de herramientas (tecla H)';
  }

  // La transición de la rejilla dura 220 ms: se remide al terminar, no antes,
  // o Leaflet se quedaría con el ancho intermedio.
  setTimeout(() => bus.emit('mapa-redimensionar'), 260);
}
