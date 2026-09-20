// Portada de sustentación.
//
// Lo primero que ve la sala. El texto sale de `caso.meta` y de `caso.ruta`, no
// está escrito aquí: si mañana el caso cambia de ruta o de fecha, la portada
// cambia con él y no se queda diciendo algo que ya no es verdad.
//
// EL FONDO ES EL PROPIO CASO. No es una imagen decorativa traída de fuera: son
// los cuadros congelados de la banda 13 —los mismos que analiza el resto del
// proyecto— pasando en bucle, con la frontera de Colombia y los departamentos
// calcados encima por la proyección geoestacionaria. Así, antes de explicar nada,
// la pantalla ya está enseñando el dato del que se va a hablar.
//
// El velo oscuro no es un adorno: sobre una animación de nubes, con zonas que
// pasan de negro a blanco puro, un texto claro se vuelve ilegible cada pocos
// segundos. El degradado mantiene el contraste constante en la mitad donde está
// la letra y deja la imagen respirar en la otra.
//
// Se cierra con cualquiera de sus dos botones —uno entra en ventana y el otro
// pone el visor entero a pantalla completa—, con Enter, con Escape o con la flecha
// derecha, que además arranca la primera escena del guion. Se vuelve a ella desde
// el botón de la cabecera.

import { $, esc, aFecha } from './util.js';
import { ir as irAEscena } from './escenas.js';
import { crearProyector, dentro } from './geoestacionaria.js';
import { alternar as alternarPantalla, enPantallaCompleta } from './pantalla.js';

const MS_POR_CUADRO = 420;

let caso = null;
let limites = null;
let abierta = false;
let cuadros = [];
let cargados = [];
let indice = 0;
let temporizador = null;

export function iniciarPortada(datosCaso, geojsonLimites) {
  caso = datosCaso;
  limites = geojsonLimites;

  pintar();
  mostrar(true);
  prepararFondo();

  $('#btn-portada').addEventListener('click', () => mostrar(!abierta));

  document.addEventListener('keydown', (ev) => {
    if (!abierta) return;
    if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      mostrar(false);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      mostrar(false);
      irAEscena(0);
    }
  });
}

export function mostrar(v) {
  abierta = v;
  const el = document.getElementById('portada');
  if (el) el.hidden = !v;
  $('#btn-portada')?.classList.toggle('activo', v);

  // La animación solo corre mientras se ve: no tiene sentido decodificar un JPEG
  // cada 420 ms detrás de un panel cerrado.
  if (v) arrancar(); else parar();
}

export const portadaAbierta = () => abierta;

/* ---------- Fondo animado ---------- */

function prepararFondo() {
  const banda = caso.satelite?.bandas?.find((b) => b.id === 'band_13');
  cuadros = banda?.medio?.tipo === 'secuencia' ? (banda.medio.cuadros || []) : [];
  if (!cuadros.length) return;

  pintarLimites(banda);

  // Los cuadros se traen de uno en uno y en orden. Son 28 JPEG de casi 300 KB:
  // pedirlos todos a la vez atasca la carga del visor justo cuando el usuario
  // acaba de abrirlo. En cuanto hay dos, la animación ya puede empezar.
  let i = 0;
  const siguiente = () => {
    if (i >= cuadros.length) return;
    const img = new Image();
    const c = cuadros[i++];
    img.onload = () => {
      cargados.push({ img, horaZ: c.horaZ });
      if (cargados.length === 2 && abierta) arrancar();
      siguiente();
    };
    img.onerror = siguiente;
    img.src = c.archivo;
  };
  siguiente();
}

function arrancar() {
  if (temporizador || cargados.length < 2) return;
  temporizador = setInterval(avanzar, MS_POR_CUADRO);
  avanzar();
}

function parar() {
  if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

function avanzar() {
  if (!cargados.length) return;
  indice = (indice + 1) % cargados.length;
  const cuadro = cargados[indice];
  const fondo = document.getElementById('pt-fondo');
  const reloj = document.getElementById('pt-reloj');
  if (fondo) fondo.src = cuadro.img.src;
  if (reloj) reloj.textContent = cuadro.horaZ.slice(11, 16) + 'Z';
}

/**
 * Frontera y departamentos calcados sobre la imagen.
 *
 * Es la misma proyección geoestacionaria que usa el calco del panel satelital:
 * los límites no se dibujan «a ojo» encima, se calculan para la rejilla concreta
 * de esta banda. Se emiten en el sistema de píxeles del recorte y el SVG se
 * comparte caja con la imagen —el contenedor tiene la proporción exacta del
 * recorte— así que los dos cuadran solos a cualquier tamaño de pantalla.
 */
function pintarLimites(banda) {
  const svg = document.getElementById('pt-limites');
  if (!svg || !limites?.features?.length) return;

  const proy = crearProyector(caso.satelite?._recorte?.proyeccion, banda.geo);
  if (!proy) return;
  const geo = banda.geo;

  const anillos = (g) =>
    g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];

  const trazar = (rasgos, clase) => {
    const partes = [];
    for (const f of rasgos) {
      for (const anillo of anillos(f.geometry)) {
        let tramo = [];
        for (const [lon, lat] of anillo) {
          const q = proy(lat, lon);
          // Un punto que el satélite no ve no tiene píxel: se corta el tramo en
          // vez de unirlo con una recta que no existe.
          if (!q || !dentro(q, geo, geo.ancho * 0.4)) {
            if (tramo.length > 1) partes.push(tramo);
            tramo = [];
            continue;
          }
          tramo.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
        }
        if (tramo.length > 1) partes.push(tramo);
      }
    }
    return partes.map((t) => `<polyline points="${t.join(' ')}" class="${clase}" />`).join('');
  };

  svg.setAttribute('viewBox', `0 0 ${geo.ancho} ${geo.alto}`);
  svg.innerHTML =
    trazar(limites.features.filter((f) => f.properties.nivel === 'departamento'), 'pt-depto') +
    trazar(limites.features.filter((f) => f.properties.nivel === 'pais'), 'pt-pais');
}

/* ---------- Texto ---------- */

function pintar() {
  const m = caso.meta || {};
  const v = caso.vuelo || {};
  const r = caso.ruta || {};

  const origen = caso.aerodromos?.find((a) => a.icao === r.origen);
  const destino = caso.aerodromos?.find((a) => a.icao === r.destino);
  const ciudades = origen && destino ? `${origen.ciudad} – ${destino.ciudad}` : '';

  const fecha = v.salidaZ
    ? aFecha(v.salidaZ).toISOString().slice(0, 10).split('-').reverse().join('/')
    : '';

  // Los integrantes salen de meta.integrantes; si no estuviera, se cae a
  // meta.autor antes que inventarse nombres.
  const gente = Array.isArray(m.integrantes) && m.integrantes.length
    ? m.integrantes
    : (m.autor ? [m.autor] : []);

  document.getElementById('portada').innerHTML = `
    <div id="pt-mapa">
      <img id="pt-fondo" alt="" />
      <svg id="pt-limites" preserveAspectRatio="xMidYMid meet"></svg>
    </div>
    <div id="pt-velo"></div>

    <div id="pt-sello">
      <span id="pt-reloj">—</span>
      <span>GOES-19 · banda 13 · 10,3 µm</span>
    </div>

    <div id="pt-contenido">
      <div class="pt-marca">${esc(m.asignatura || 'Teledetección')}</div>

      <h1 class="pt-titulo">${esc(m.titulo || 'Análisis de teledetección aplicada a una ruta aeronáutica')}</h1>

      <div class="pt-ruta">${esc(r.origen || '')} → ${esc(r.destino || '')}</div>
      <p class="pt-sub">
        ${ciudades ? `<b>${esc(ciudades)}</b> · ` : ''}${r.distanciaNM ? `${Math.round(r.distanciaNM)} NM sobre la Amazonía` : ''}
        ${v.aeronave ? ` · <b>${esc(v.aeronave)}</b> a ${esc(v.nivelCrucero || '')}` : ''}
        ${v.salidaLocal ? `<br>Salida ${esc(v.salidaLocal)} · ETA ${esc(v.etaZ ? v.etaZ.slice(11, 16) + 'Z' : '')}` : ''}
      </p>

      <div class="pt-linea"></div>

      ${gente.length ? `
        <div class="pt-etq">Integrantes</div>
        <div class="pt-integrantes">
          ${gente.map((n) => `<div class="pt-persona">${esc(n)}</div>`).join('')}
        </div>` : ''}

      <div class="pt-pie">
        <span><b>Fecha del caso</b> ${esc(fecha)}</span>
        <span><b>Plataforma</b> ${esc(caso.satelite?.plataforma || '')}</span>
        <span><b>Fuente</b> ${esc(caso.satelite?.fuente || '')}</span>
        <span><b>Base aeronáutica</b> AIP Colombia AIRAC A 73-26</span>
      </div>
    </div>

    <div class="pt-entrar">
      <span class="pt-pista">→ empieza el guion · Esc cierra</span>
      <button id="pt-boton" class="pt-sec">Pantalla completa</button>
      <button id="pt-ventana">Entrar al visor</button>
    </div>`;

  document.getElementById('pt-ventana').addEventListener('click', () => mostrar(false));

  // Pantalla completa de TODO el documento, no de un panel suelto: así el visor
  // entero —cabecera, mapa, panel y barra de tiempo— ocupa el proyector sin la
  // cromática del navegador alrededor. El navegador solo la concede desde un
  // gesto del usuario, y por eso cuelga de este botón y no del arranque.
  //
  // NO cierra la portada: poner la pantalla completa y empezar la exposición son
  // dos decisiones distintas, y juntarlas obligaba a volver atrás para enseñar la
  // portada ya a pantalla completa, que es justo como se quiere enseñar.
  const btn = document.getElementById('pt-boton');
  btn.addEventListener('click', async () => {
    const activa = await alternarPantalla(document.documentElement);
    btn.textContent = activa ? 'Salir de pantalla completa' : 'Pantalla completa';
  });

  // Salir con Escape o con F11 no pasa por el botón: el rótulo se corrige solo.
  document.addEventListener('fullscreenchange', () => {
    const b = document.getElementById('pt-boton');
    if (b) b.textContent = enPantallaCompleta(document.documentElement) ? 'Salir de pantalla completa' : 'Pantalla completa';
  });
}
