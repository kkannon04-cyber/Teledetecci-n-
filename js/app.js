// Arranque: carga el caso, monta los módulos y los conecta por el bus.

import { bus, $, esc, cargarJSON, cargarJSONOpcional } from './util.js';
import { crearMapa, obtenerMapa } from './mapa.js';
import { pintarPanel } from './capas.js';
import { iniciarTiempo } from './tiempo.js';
import { iniciarMeteo } from './metar.js';
import { iniciarFenomenos } from './fenomenos.js';
import { iniciarSigmet } from './sigmet.js';
import { iniciarSatelite } from './satelite.js';
import { iniciarDecision } from './decision.js';
import { iniciarEscenas } from './escenas.js';
import { iniciarLimites } from './limites.js';
import { crearAnalizador } from './productos.js';
import { iniciarPerfil } from './perfil.js';
import { iniciarTramos } from './tramos.js';
import { iniciarVuelo } from './vuelo.js';
import { iniciarPortada } from './portada.js';
import { iniciarLateral } from './lateral.js';

async function main() {
  const caso = await cargarJSON('datos/caso.json');

  // Cabecera
  document.title = `${caso.meta.titulo} — ${caso.ruta.origen}/${caso.ruta.destino}`;
  $('#titulo-caso').textContent = `${caso.ruta.origen} → ${caso.ruta.destino}`;
  $('#sub-caso').textContent = `${caso.vuelo.indicativo} · ${caso.vuelo.aeronave} · ${caso.vuelo.nivelCrucero}`;
  if (caso.meta.esEjemplo) {
    const aviso = $('#aviso-ejemplo');
    aviso.hidden = false;
    aviso.title = caso.meta.notaEjemplo;
  }

  // Datos meteorológicos congelados (pueden no existir aún). El índice del mapa
  // dice qué teselas del fondo están guardadas en disco; si no está, el mapa las
  // pide todas a internet, como siempre.
  const [metar, taf, fenomenos, sigmet, indiceMapa, limites, barras] = await Promise.all([
    cargarJSONOpcional('datos/metar.json'),
    cargarJSONOpcional('datos/taf.json'),
    cargarJSONOpcional('datos/fenomenos.geojson'),
    cargarJSONOpcional('datos/sigmet.json'),
    cargarJSONOpcional('medios/mapa/indice.json'),
    cargarJSONOpcional('datos/limites-colombia.geojson'),
    cargarJSONOpcional('datos/barras-color.json'),
  ]);

  // Orden importante: el mapa registra sus capas antes de que se pinte el panel.
  // Y los límites van ANTES que el satélite: el panel satelital los reproyecta
  // sobre la banda activa, así que tienen que estar cargados cuando dibuje su
  // primer calco.
  crearMapa(caso, indiceMapa);
  iniciarLimites(limites);
  iniciarSatelite(caso, barras);
  iniciarFenomenos(fenomenos, caso.satelite.bandas);
  pintarPanel();

  iniciarMeteo(caso, metar, taf);
  iniciarDecision(caso);
  iniciarEscenas(caso);

  // Análisis derivado. El analizador es el que sabe convertir color de píxel en
  // temperatura de brillo y esta en altura de tope; a partir de él cuelgan el
  // corte vertical, el desglose por tramos y el panel de vuelo. Si faltara la
  // tabla de color o los cuadros de la banda 13, cada uno se apaga por su cuenta
  // y el resto del visor sigue funcionando igual.
  const analizador = barras ? crearAnalizador(caso, barras, metar) : null;
  if (analizador) {
    iniciarPerfil(caso, analizador, fenomenos);
    iniciarTramos(caso, analizador, fenomenos);
    iniciarVuelo(caso, analizador, fenomenos);
  } else {
    console.warn('Sin datos/barras-color.json no hay análisis radiométrico: se omiten perfil, tramos y EFB.');
  }

  // Los SIGMET se consultan en vivo contra la API: no se espera a que respondan
  // para montar el visor. Cuando llegan, el módulo registra su capa y repinta.
  iniciarSigmet(caso, sigmet).catch((e) => console.error('SIGMET', e));

  // La barra de tiempo va al final: su primer disparo alimenta a todos.
  iniciarTiempo(caso);

  montarPestanas();
  iniciarLateral();

  // La portada va al final: necesita que las escenas ya estén montadas para
  // poder saltar a la primera con la flecha derecha.
  iniciarPortada(caso, limites);

  bus.on('mapa-redimensionar', () => obtenerMapa().invalidateSize());
  window.addEventListener('resize', () => obtenerMapa().invalidateSize());

  // Encuadre inicial sobre la CAJA DE COBERTURA, no sobre la ruta.
  //
  // Las bandas, el mapa base y la meteorología cubren Colombia entera, y abrir el
  // visor encuadrado en el corredor esconde justo eso: da la impresión de que el
  // trabajo acaba en la ruta. Se abre viendo el país y desde ahí se baja a la ruta
  // con el zoom o con la primera escena. Si el caso no declarara caja, se cae al
  // encuadre de siempre sobre los waypoints.
  //
  // Se mide el contenedor justo antes: si no, Leaflet encuadra con el tamaño que
  // tenía el mapa al crearse y lo encuadrado queda desplazado o cortado.
  const wps = caso.ruta.waypoints;
  const cob = caso.cobertura?.caja;
  obtenerMapa().invalidateSize();
  obtenerMapa().fitBounds(
    cob
      ? [[cob.latMin, cob.lonMin], [cob.latMax, cob.lonMax]]
      : wps.map((w) => [w.lat, w.lon]),
    { padding: [30, 30] }
  );
}

function montarPestanas() {
  document.querySelectorAll('.pestana').forEach((p) => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.pestana').forEach((o) => o.classList.remove('activa'));
      document.querySelectorAll('.contenido-pestana').forEach((o) => o.classList.remove('activa'));
      p.classList.add('activa');
      document.getElementById(`tab-${p.dataset.pestana}`).classList.add('activa');
    });
  });
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `
    <div style="padding:40px;font-family:system-ui;color:#e6edf3">
      <h2 style="color:#f85149">No se pudo iniciar el visor</h2>
      <p>${esc(e.message)}</p>
      <p style="color:#8b98a5">Comprueba que el proyecto se esté sirviendo con
      <code>node herramientas/servidor.mjs</code> y no abriendo el archivo directamente.</p>
    </div>`;
});
