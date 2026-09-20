// Barra de tiempo Zulu. Es el eje que sincroniza todo el visor:
// al moverla emite 'tiempo' y mapa, satélite y meteorología reaccionan juntos.

import { bus, $, horaZ, horaZLarga, aFecha } from './util.js';

let pasos = [];       // Array de Date, uno por escalón de la ventana
let indice = 0;
let temporizador = null;

export function iniciarTiempo(caso) {
  const inicio = aFecha(caso.ventanaTiempo.inicioZ);
  const fin = aFecha(caso.ventanaTiempo.finZ);
  const pasoMs = caso.ventanaTiempo.pasoMinutos * 60000;

  pasos = [];
  for (let t = inicio.getTime(); t <= fin.getTime(); t += pasoMs) pasos.push(new Date(t));

  const control = $('#linea-tiempo');
  control.min = 0;
  control.max = pasos.length - 1;

  $('#etq-inicio').textContent = horaZLarga(inicio);
  $('#etq-fin').textContent = horaZLarga(fin);

  dibujarMarcas(caso, inicio, fin);

  control.addEventListener('input', () => irA(Number(control.value)));
  $('#ctrl-play').addEventListener('click', alternarReproduccion);

  // Arranca en la hora de análisis declarada en el caso.
  irA(indiceMasCercano(aFecha(caso.ventanaTiempo.horaAnalisisZ)));
}

/** Marcas de eventos del vuelo sobre la línea de tiempo. */
function dibujarMarcas(caso, inicio, fin) {
  const cont = $('#marcas');
  cont.innerHTML = '';
  const total = fin - inicio;
  if (total <= 0) return;

  const eventos = [
    { t: aFecha(caso.vuelo.salidaZ), etq: 'SALIDA', destacada: true },
    { t: aFecha(caso.ventanaTiempo.horaAnalisisZ), etq: 'ANÁLISIS', destacada: true },
    { t: aFecha(caso.vuelo.etaZ), etq: 'ETA', destacada: true },
  ];

  // Dos eventos a la misma hora —salida y análisis, por ejemplo— se dibujaban
  // uno encima del otro y las etiquetas quedaban ilegibles. Se agrupan por
  // posición y se rotulan juntos.
  const porPosicion = new Map();
  for (const ev of eventos) {
    const pos = ((ev.t - inicio) / total) * 100;
    if (pos < 0 || pos > 100) continue;
    const clave = pos.toFixed(1);
    if (!porPosicion.has(clave)) porPosicion.set(clave, { pos, etiquetas: [], t: ev.t, destacada: false });
    const grupo = porPosicion.get(clave);
    grupo.etiquetas.push(ev.etq);
    grupo.destacada = grupo.destacada || ev.destacada;
  }

  for (const g of porPosicion.values()) {
    const el = document.createElement('div');
    el.className = 'marca' + (g.destacada ? ' destacada' : '');
    el.style.left = `${g.pos}%`;
    el.textContent = `${g.etiquetas.join(' · ')} ${horaZ(g.t)}`;
    el.title = g.t.toISOString();
    cont.appendChild(el);
  }
}

function indiceMasCercano(fecha) {
  let mejor = 0;
  let dif = Infinity;
  pasos.forEach((p, i) => {
    const d = Math.abs(p - fecha);
    if (d < dif) { dif = d; mejor = i; }
  });
  return mejor;
}

export function irA(i) {
  indice = Math.max(0, Math.min(pasos.length - 1, i));
  const control = $('#linea-tiempo');
  if (Number(control.value) !== indice) control.value = indice;

  const actual = pasos[indice];
  $('#reloj-z').textContent = horaZLarga(actual);
  bus.emit('tiempo', { fecha: actual, indice, total: pasos.length });
}

export function irAFecha(iso) {
  irA(indiceMasCercano(aFecha(iso)));
}

export const fechaActual = () => pasos[indice];

function alternarReproduccion() {
  const btn = $('#ctrl-play');
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
    btn.textContent = '▶';
    btn.classList.remove('activo');
    return;
  }
  btn.textContent = '❚❚';
  btn.classList.add('activo');
  temporizador = setInterval(() => {
    irA(indice >= pasos.length - 1 ? 0 : indice + 1);
  }, 550);
}

export function detenerReproduccion() {
  if (temporizador) alternarReproduccion();
}
