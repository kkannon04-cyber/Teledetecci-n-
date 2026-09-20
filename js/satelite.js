// Panel satelital: bandas de SLIDER, comparador de cortina y superposición
// aproximada sobre el mapa.
//
// El satélite se muestra por defecto en su propio panel, en la geometría
// original de SLIDER (proyección geoestacionaria). La superposición sobre el
// mapa Leaflet es una aproximación y así se rotula: reproyectar correctamente
// una captura de pantalla no es posible sin los datos originales.

import { bus, $, esc, horaZLarga, aFecha } from './util.js';
import { registrar, obtener, mostrar } from './capas.js';
import { obtenerLimites } from './limites.js';
import { montarBoton, enPantallaCompleta } from './pantalla.js';
import { crearProyector, crearInversor, dentro } from './geoestacionaria.js';

let caso = null;
let bandas = [];
let activa = null;
let comparada = null;
let modoComparar = false;
let capaOverlay = null;
let horaActual = null;
let barras = null;      // datos/barras-color.json: tabla de color de cada banda

// Zoom y desplazamiento del panel satelital. El mapa de la izquierda es Leaflet y
// trae los suyos; este panel era una imagen encajada al recuadro y punto, así que
// la única forma de mirar de cerca una célula era abrir el JPEG aparte. La vista
// se guarda aquí —no en el DOM— porque el panel se repinta entero al cambiar de
// banda, de hora o al abrir la cortina, y el encuadre tiene que sobrevivir a eso:
// si se perdiera, comparar dos bandas de cerca sería imposible.
const VISTA = { k: 1, x: 0, y: 0 };
const K_MIN = 1;      // 1 = el recorte entero; por debajo no hay más imagen que ver
const K_MAX = 12;
let arrastroPanel = false;  // hubo arrastre de verdad: el click siguiente no cuenta

export function iniciarSatelite(datosCaso, tablasColor = null) {
  caso = datosCaso;
  bandas = caso.satelite.bandas;
  barras = tablasColor;

  crearOverlay();
  pintarPanelBandas();

  $('#btn-comparar').addEventListener('click', alternarComparar);

  bus.on('tiempo', ({ fecha }) => {
    horaActual = fecha;
    sincronizarMedio(fecha);
  });

  // El mapa calcula dónde está la aeronave; aquí se calca sobre la imagen para
  // poder decir por qué parte de la tormenta está pasando.
  bus.on('posicion-aeronave', (p) => {
    posicionAeronave = p;
    actualizarCalco();
  });

  // Se abre solo si alguna banda tiene medio de verdad. Antes caía en bandas[0]
  // aunque estuvieran todas pendientes, y el panel se quedaba ocupando media
  // pantalla para mostrar un marcador de posición, tapando el mapa.
  const primera = bandas.find((b) => b.medio?.tipo && b.medio.tipo !== 'pendiente' && primerArchivo(b.medio));
  if (primera) activarBanda(primera.id);
}

/* ---------- Panel lateral de bandas ---------- */

/**
 * Lista de bandas, en corto.
 *
 * Antes cada banda traía su párrafo de «para qué sirve» y otro de «cómo se lee»,
 * y ocho bandas seguidas convertían la pestaña en un muro de texto que nadie lee
 * durante una exposición. La explicación no se ha perdido: sigue entera en el
 * botón «?» del panel satelital, que la enseña de la banda que se está mirando,
 * que es cuando de verdad hace falta. Aquí queda lo que sirve para ELEGIR: qué
 * mide, en qué longitud de onda y si hay imagen en disco.
 */
function pintarPanelBandas() {
  const cont = $('#tab-bandas');
  cont.innerHTML =
    `<div class="hora-obs" style="margin-bottom:10px">
       ${esc(caso.satelite.plataforma)} · ${esc(caso.satelite.sector)}
     </div>` +
    bandas
      .map((b) => {
        const listo = b.medio?.tipo && b.medio.tipo !== 'pendiente' && primerArchivo(b.medio);
        const detalle = b.medio?.tipo === 'secuencia'
          ? `${b.medio.cuadros.length} cuadros`
          : listo ? b.medio.tipo : '';
        return `
      <div class="banda ${activa === b.id ? 'activa' : ''}" data-banda="${esc(b.id)}"
           title="${esc(b.para)}\n\n${esc(b.leer)}">
        <div class="banda-cab">
          <span class="banda-nombre">${esc(b.nombre)}</span>
          <span class="banda-canal">${esc(b.canal)}</span>
        </div>
        <div class="banda-pie">
          <span class="banda-onda">${esc(b.longitudOnda)} · ${esc(b.resolucion)}</span>
          <span class="banda-estado ${listo ? 'cargado' : ''}">${listo ? '● ' + esc(detalle) : '○ sin medio'}</span>
        </div>
        ${rampaDeFicha(b)}
      </div>`;
      })
      .join('') +
    `<div class="hora-obs" style="margin-top:12px">
       Pasa el cursor por una banda para ver qué mide. El botón <b>?</b> del panel
       explica la escala de color de la que esté activa.
     </div>`;

  cont.querySelectorAll('.banda').forEach((el) => {
    el.addEventListener('click', () => {
      if (modoComparar && activa && el.dataset.banda !== activa) fijarComparada(el.dataset.banda);
      else activarBanda(el.dataset.banda);
    });
  });
}

/**
 * Rampa de color en la ficha de cada banda, en la pestaña Bandas.
 *
 * La leyenda del panel solo enseña la de la banda activa, y buena parte de la
 * lectura multiespectral consiste en comparar: la 13 colorea por debajo de −30 °C,
 * la 9 y la 10 usan otra escala distinta y las visibles no tienen escala ninguna.
 * Verlas juntas ahorra tener que ir cambiando de banda para acordarse.
 */
function rampaDeFicha(b) {
  const t = tablaDe(b);
  if (!t) return '';
  const extremos = t.escala.length
    ? `${t.escala[0].valor} a ${t.escala[t.escala.length - 1].valor} ${t.unidad}`
    : 'escala de gris, sin valores publicados';
  return `
    <div class="ficha-rampa" title="${esc(t.lectura)}">
      <div class="ficha-rampa-barra" style="background:${degradado(t)}"></div>
      <div class="ficha-rampa-pie">${esc(barras.bandas[b.id])} · ${esc(extremos)}</div>
    </div>`;
}

/* ---------- Activación ---------- */

export function activarBanda(id) {
  const b = bandas.find((x) => x.id === id);
  if (!b) return;
  activa = id;
  document.querySelectorAll('.banda').forEach((el) => el.classList.toggle('activa', el.dataset.banda === id));
  $('#escenario').classList.add('dividido');
  render();
  actualizarOverlay(b);
  setTimeout(() => bus.emit('mapa-redimensionar'), 260);
}

export function cerrarPanel() {
  activa = null;
  reiniciarVista();
  $('#escenario').classList.remove('dividido');
  setTimeout(() => bus.emit('mapa-redimensionar'), 260);
}

function fijarComparada(id) {
  comparada = id;
  render();
}

/**
 * Fija la banda de contraste de la cortina, o la quita con null.
 * La usan las escenas: el campo `comparar` del guion existía en los datos desde el
 * principio pero no lo leía nadie, así que la comparación solo se podía activar a
 * mano. Con esto una escena puede llegar ya enfrentando dos bandas.
 */
export function compararCon(id) {
  modoComparar = Boolean(id);
  if (id) comparada = id;
  $('#btn-comparar').classList.toggle('activo', modoComparar);
  render();
}

function alternarComparar() {
  modoComparar = !modoComparar;
  $('#btn-comparar').classList.toggle('activo', modoComparar);
  if (modoComparar && !comparada) {
    comparada = bandas.find((b) => b.id !== activa)?.id || null;
  }
  render();
}

/* ---------- Render del panel central derecho ---------- */

function render() {
  const cont = $('#contenido-sat');
  const etq = $('#etq-sat');
  const b = bandas.find((x) => x.id === activa);
  if (!b) {
    cont.innerHTML = '';
    etq.hidden = true;
    return;
  }

  etq.hidden = false;
  etq.innerHTML = modoComparar && comparada
    ? `<b>${esc(nombre(comparada))}</b> ◀ cortina ▶ <b>${esc(b.nombre)}</b>
       <span class="fuente">${esc(caso.satelite.fuente)}</span>`
    : `<b>${esc(b.nombre)}</b> — ${esc(b.canal)} · ${esc(b.longitudOnda)} · ${esc(b.resolucion)}
       <span class="fuente">${esc(caso.satelite.fuente)}</span>`;

  // El calco va por encima de la imagen o del comparador: las dos bandas
  // enfrentadas comparten contorno, así que un solo calco vale para ambas.
  // Todo lo que se ve —imagen, cortina y calco— va dentro de #lienzo-sat, que es
  // lo único que se transforma. Meterlos juntos no es comodidad: la imagen usa
  // object-fit:contain y el calco preserveAspectRatio="xMidYMid meet", que dan
  // exactamente el mismo encaje, así que una única transformación sobre el padre
  // los mueve a la vez y el trazado sigue cayendo sobre su nube a cualquier zoom.
  // Los controles quedan FUERA del lienzo, para que no se escalen con él.
  const interior = modoComparar && comparada
    ? `<div id="comparador">
         ${medioHTML(bandas.find((x) => x.id === comparada), 'sat-a')}
         <div class="encima">${medioHTML(b, 'sat-b')}</div>
         <div id="divisor" style="left:50%"></div>
       </div>` + calcoHTML(b)
    : medioHTML(b, 'sat-a') + calcoHTML(b);

  cont.innerHTML = `<div id="lienzo-sat">${interior}</div>` + controlesHTML(b);
  if (modoComparar && comparada) activarDivisor();
  activarControles();
  aplicarVista();
  pintarTicks();
  pintarConvenciones();

  if (horaActual) sincronizarMedio(horaActual);
}

/* ---------- Zoom y desplazamiento del panel ----------
   El recorte cubre Colombia entera, pero encajado en el panel eso son unos pocos
   cientos de píxeles de pantalla para veinte grados de latitud: se ve dónde hay
   tormenta y no cómo es. La banda 2 trae 3 956 × 4 496 píxeles, así que hay detalle
   real que enseñar; lo que faltaba era poder acercarse a él. */

function controlesHTML(b) {
  return `
    <div id="barra-sat">
      ${leyendaHTML(b)}
      <div id="ctrl-sat">
        <button data-sat-zoom="1.6" title="Acercar (también con la rueda del ratón)">+</button>
        <button data-sat-zoom="0.625" title="Alejar">−</button>
        <button data-sat-reset title="Ver el recorte completo (o doble clic en la imagen)">⧉</button>
        <span id="lectura-sat"></span>
        <span id="coord-sat" title="Latitud y longitud del centro del panel"></span>
      </div>
    </div>
    <div id="convenciones-sat" hidden></div>`;
}

/* ---------- Convenciones de color de la banda ----------
   Las imágenes de SLIDER no son radiancias: son el producto ya renderizado, y cada
   banda lleva su propia tabla de color. Sin la tabla, «la nube sale roja» no dice
   nada; con ella dice «tope hacia −70 °C». La rampa y las marcas salen de la barra
   que publica el propio SLIDER, congelada en datos/barras-color.json. */

const tablaDe = (b) => {
  const id = barras?.bandas?.[b?.id];
  return id ? barras.tablas?.[id] : null;
};

/** Degradado CSS a partir de las 192 muestras de la rampa publicada. */
function degradado(t) {
  const paradas = t.rampa.map((c, i) =>
    `rgb(${c[0]},${c[1]},${c[2]}) ${((i / (t.rampa.length - 1)) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${paradas.join(',')})`;
}

function leyendaHTML(b) {
  const t = tablaDe(b);
  if (!t) return '<div id="leyenda-sat"></div>';
  return `
    <div id="leyenda-sat">
      <div id="rampa-sat" style="background:${degradado(t)}"></div>
      <div id="ticks-sat"></div>
    </div>
    <button id="btn-convenciones" title="Qué significa cada color en esta banda">?</button>`;
}

/**
 * Reparte los rótulos de la escala sin que se pisen.
 *
 * A ancho de panel partido caben cuatro o cinco de las catorce marcas de la banda
 * 13; en pantalla completa caben todas. Por eso el paso se calcula con el ancho que
 * hay en ese momento y no se fija de antemano.
 */
function pintarTicks() {
  const cont = document.getElementById('ticks-sat');
  const rampa = document.getElementById('rampa-sat');
  const b = bandas.find((x) => x.id === activa);
  const t = tablaDe(b);
  if (!cont || !rampa || !t) return;

  if (!t.escala.length) {
    cont.innerHTML = `<span class="tick-nota">${esc(t.unidad ? '' : 'escala de gris, sin valores publicados')}</span>`;
    return;
  }

  // El reparto se hace por SEPARACIÓN REAL, no cogiendo una marca de cada n: estas
  // barras no están equiespaciadas —el extremo frío va al doble de resolución— y un
  // paso fijo dejaba huecos enormes al principio y rótulos encimados al final.
  const ancho = rampa.getBoundingClientRect().width || 1;
  const minPx = 44;
  const enPx = (m) => m.pos * ancho;

  const marcas = [];
  for (const m of t.escala) {
    if (!marcas.length || enPx(m) - enPx(marcas[marcas.length - 1]) >= minPx) marcas.push(m);
  }

  // El extremo frío es el que se lee en un análisis convectivo, así que entra
  // siempre: si choca con las anteriores, son ellas las que salen.
  const ultima = t.escala[t.escala.length - 1];
  if (marcas[marcas.length - 1] !== ultima) {
    while (marcas.length && enPx(ultima) - enPx(marcas[marcas.length - 1]) < minPx) marcas.pop();
    marcas.push(ultima);
  }

  // La unidad se pega al último rótulo en vez de ir suelta a la derecha: ahí se
  // montaba encima de él en cuanto el panel se estrechaba.
  cont.innerHTML = marcas
    .map((m, i) => {
      const texto = m === ultima && t.unidad ? `${m.valor} ${t.unidad}` : String(m.valor);
      return `<span class="tick-sat" style="left:${(m.pos * 100).toFixed(2)}%">${esc(texto)}</span>`;
    })
    .join('');
}

function pintarConvenciones() {
  const caja = document.getElementById('convenciones-sat');
  const b = bandas.find((x) => x.id === activa);
  const t = tablaDe(b);
  if (!caja || !t) return;
  const proc = barras?._procedencia || {};
  caja.innerHTML = `
    <div class="conv-titulo">${esc(b.nombre)} — ${esc(b.canal)} · ${esc(b.longitudOnda)}</div>
    <div class="conv-rampa" style="background:${degradado(t)}"></div>
    <p class="conv-lectura">${esc(t.lectura)}</p>
    <p class="conv-para"><b>Para qué sirve.</b> ${esc(b.para)}</p>
    <p class="conv-fuente">
      Tabla <code>${esc(barras.bandas[b.id])}</code> de CIRA/RAMMB SLIDER, extraída de la barra que
      publica el propio servidor (<code>${esc(t.archivo)}</code>).
      ${esc(proc.limite || '')}
    </p>`;
}

/** Tamaño del panel: la caja sobre la que se calculan límites y encaje. */
const cajaPanel = () => $('#contenido-sat')?.getBoundingClientRect() || { width: 0, height: 0, left: 0, top: 0 };

/**
 * Ancho en píxeles de pantalla que ocupa la imagen a escala 1.
 * No es el ancho del panel: object-fit:contain deja banda negra por el lado que
 * sobra, y es este ancho —no el del panel— el que dice cuánto zoom cabe antes de
 * empezar a interpolar.
 */
function anchoImagen(b) {
  const r = cajaPanel();
  if (!b || !b.geo || !r.width) return 0;
  return Math.min(r.width, r.height * (b.geo.ancho / b.geo.alto));
}

/** Deja k, x e y dentro de lo visible: el lienzo nunca destapa el fondo del panel. */
function acotar() {
  const r = cajaPanel();
  VISTA.k = Math.min(K_MAX, Math.max(K_MIN, VISTA.k));
  VISTA.x = Math.min(0, Math.max(r.width - r.width * VISTA.k, VISTA.x));
  VISTA.y = Math.min(0, Math.max(r.height - r.height * VISTA.k, VISTA.y));
}

function aplicarVista() {
  const lienzo = document.getElementById('lienzo-sat');
  if (!lienzo) return;
  acotar();
  lienzo.style.transform = `translate(${VISTA.x.toFixed(2)}px, ${VISTA.y.toFixed(2)}px) scale(${VISTA.k.toFixed(4)})`;
  lienzo.classList.toggle('movible', VISTA.k > 1);
  // El divisor de la cortina va DENTRO del lienzo, para que su posición siga
  // anclada a la imagen y no a la pantalla. El precio es que la escala también lo
  // engorda: a ×12 la línea de 2 px se dibujaba de 24 y el tirador tapaba media
  // nube. Se le pasa el inverso del zoom y el CSS deshace el escalado solo en su
  // grosor, no en su posición.
  lienzo.style.setProperty('--k-inv', (1 / VISTA.k).toFixed(5));

  // El calco lleva el contraescalado horneado en el marcado —los grupos
  // `scale(1/k)`— así que hay que rehacerlo cuando cambia el zoom. Al desplazar no:
  // ahí solo cambia la traslación del lienzo, que ya mueve el calco con la imagen.
  if (kDelCalco !== VISTA.k) {
    kDelCalco = VISTA.k;
    actualizarCalco();
  }

  // La lectura dice el aumento y, cuando se pasa de la resolución nativa de la
  // banda, lo AVISA: a partir de ahí lo que se ve es interpolación del navegador,
  // no detalle que el instrumento haya medido. Confundir una cosa con otra es justo
  // lo que no puede pasar en un análisis de teledetección.
  const lectura = document.getElementById('lectura-sat');
  if (!lectura) return;
  const b = bandas.find((x) => x.id === activa);
  const ancho = anchoImagen(b);
  const kNativo = ancho ? b.geo.ancho / ancho : Infinity;
  const texto = `×${VISTA.k.toFixed(1).replace('.', ',')}`;
  if (VISTA.k > kNativo * 1.02) {
    lectura.textContent = `${texto} · pasa de ${b.resolucion}`;
    lectura.classList.add('interpolado');
    lectura.title = `Por encima de ×${kNativo.toFixed(1)} ya no queda píxel de satélite que mostrar: lo que se ve es interpolación del navegador, no detalle medido por el instrumento.`;
  } else {
    lectura.textContent = texto;
    lectura.classList.remove('interpolado');
    lectura.title = ancho ? `Resolución nativa de esta banda hasta ×${kNativo.toFixed(1)}.` : '';
  }

  const coord = document.getElementById('coord-sat');
  if (coord) {
    const c = coordenadasDelCentro(b);
    coord.textContent = c ? `${gradoTexto(c.lat, 'N', 'S')} ${gradoTexto(c.lon, 'E', 'W')}` : '';
  }
}

/**
 * Coordenadas del centro del panel.
 *
 * Al acercarse, los rótulos de la retícula se van fuera de pantalla y uno se queda
 * mirando una célula sin saber sobre dónde está. Esto deshace las dos
 * transformaciones que hay entre la pantalla y el satélite —el zoom del lienzo y
 * el encaje object-fit:contain de la imagen dentro del panel— y luego invierte la
 * proyección geoestacionaria.
 */
function coordenadasDelCentro(b) {
  const r = cajaPanel();
  const inv = crearInversor(caso.satelite?._recorte?.proyeccion, b?.geo);
  if (!inv || !r.width) return null;

  // Pantalla → coordenadas del lienzo sin transformar.
  const lx = (r.width / 2 - VISTA.x) / VISTA.k;
  const ly = (r.height / 2 - VISTA.y) / VISTA.k;

  // Lienzo → píxel de la imagen. object-fit:contain centra y deja banda por el
  // lado que sobra, así que hay que descontar ese desplazamiento.
  const anchoDib = anchoImagen(b);
  const altoDib = anchoDib * (b.geo.alto / b.geo.ancho);
  const ox = (r.width - anchoDib) / 2;
  const oy = (r.height - altoDib) / 2;
  const px = ((lx - ox) / anchoDib) * b.geo.ancho;
  const py = ((ly - oy) / altoDib) * b.geo.alto;
  if (px < 0 || py < 0 || px > b.geo.ancho || py > b.geo.alto) return null;

  return inv(px, py);
}

const gradoTexto = (v, pos, neg) =>
  `${Math.abs(v).toFixed(1).replace('.', ',')}°${v >= 0 ? pos : neg}`;

/** Acerca o aleja dejando quieto el punto que hay bajo el cursor. */
function zoomEn(factor, clienteX, clienteY) {
  const r = cajaPanel();
  const px = (clienteX === null || clienteX === undefined) ? r.width / 2 : clienteX - r.left;
  const py = (clienteY === null || clienteY === undefined) ? r.height / 2 : clienteY - r.top;
  const kPrevio = VISTA.k;
  VISTA.k = Math.min(K_MAX, Math.max(K_MIN, VISTA.k * factor));
  const real = VISTA.k / kPrevio;
  VISTA.x = px - (px - VISTA.x) * real;
  VISTA.y = py - (py - VISTA.y) * real;
  aplicarVista();
}

function reiniciarVista() {
  VISTA.k = 1;
  VISTA.x = 0;
  VISTA.y = 0;
  aplicarVista();
}

function activarControles() {
  const cont = $('#contenido-sat');
  if (!cont) return;

  cont.querySelectorAll('[data-sat-zoom]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomEn(Number(btn.dataset.satZoom), null, null);
    });
  });
  cont.querySelector('[data-sat-reset]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    reiniciarVista();
  });

  const conv = document.getElementById('convenciones-sat');
  cont.querySelector('#btn-convenciones')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (conv) conv.hidden = !conv.hidden;
    e.currentTarget.classList.toggle('activo', conv && !conv.hidden);
  });
  conv?.addEventListener('click', (e) => e.stopPropagation());

  // La barra inferior no debe disparar el arrastre del panel que hay debajo.
  cont.querySelector('#barra-sat')?.addEventListener('pointerdown', (e) => e.stopPropagation());

  // El botón de pantalla completa se monta una sola vez y sobrevive a los repintados
  // porque #ctrl-sat se rehace: por eso se comprueba si ya está.
  const ctrl = cont.querySelector('#ctrl-sat');
  if (ctrl && !ctrl.querySelector('.btn-pantalla')) {
    montarBoton(ctrl, document.getElementById('panel-satelite'), () => {
      // Al cambiar de tamaño cambian los límites del encuadre y cuántos rótulos de
      // la escala caben: las dos cosas se recalculan con el tamaño nuevo.
      aplicarVista();
      pintarTicks();
    });
  }

  // Rueda y arrastre se atan UNA sola vez a #contenido-sat, que no se repinta; lo
  // que se repinta es su contenido. Atarlos en cada render los acumularía y cada
  // golpe de rueda contaría tantas veces como renders hubiera habido.
  if (cont.dataset.navegable) return;
  cont.dataset.navegable = '1';

  cont.addEventListener('wheel', (e) => {
    if (!activa) return;
    e.preventDefault();
    zoomEn(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
  }, { passive: false });

  cont.addEventListener('dblclick', () => { if (activa) reiniciarVista(); });

  let arrastrando = false;
  let x0 = 0;
  let y0 = 0;
  let recorrido = 0;

  cont.addEventListener('pointerdown', (e) => {
    if (!activa || VISTA.k <= 1) return;
    // Los controles quedan fuera del arrastre. No es cosmético: setPointerCapture
    // sobre el contenedor hace que el click posterior se dispare en ÉL y no en el
    // botón, así que sin esta salida los botones de zoom no responden.
    if (e.target.closest('#ctrl-sat')) return;
    // Y sin preventDefault el navegador arranca su arrastre nativo de imagen, que
    // emite pointercancel: el desplazamiento se cortaba al primer movimiento.
    e.preventDefault();
    arrastrando = true;
    arrastroPanel = false;
    recorrido = 0;
    x0 = e.clientX;
    y0 = e.clientY;
    cont.setPointerCapture(e.pointerId);
    cont.classList.add('arrastrando');
  });
  cont.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    recorrido += Math.abs(dx) + Math.abs(dy);
    // Pasados unos píxeles esto es un arrastre y no un clic: se marca para que la
    // cortina no salte de sitio al soltar.
    if (recorrido > 6) arrastroPanel = true;
    VISTA.x += dx;
    VISTA.y += dy;
    x0 = e.clientX;
    y0 = e.clientY;
    aplicarVista();
  });
  const soltar = () => {
    arrastrando = false;
    cont.classList.remove('arrastrando');
  };
  cont.addEventListener('pointerup', soltar);
  cont.addEventListener('pointercancel', soltar);
}

const nombre = (id) => bandas.find((b) => b.id === id)?.nombre || id;

/** Archivo con el que arranca la banda: en una secuencia, su primer cuadro. */
function primerArchivo(medio) {
  const m = medio || {};
  return m.tipo === 'secuencia' ? m.cuadros?.[0]?.archivo : m.archivo;
}

function medioHTML(b, id) {
  if (!b) return '';
  const m = b.medio || {};
  // Antes se exigía m.archivo, que una secuencia no tiene —sus rutas están en
  // cuadros[]—, así que la rama de secuencia de más abajo era inalcanzable y el
  // panel mostraba el marcador de posición aunque los cuadros estuvieran en disco.
  if (!primerArchivo(m) || m.tipo === 'pendiente') return placeholder(b);

  const base = `id="${esc(id)}" data-banda="${esc(b.id)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"`;

  if (m.tipo === 'video') {
    return `<video ${base} src="${esc(m.archivo)}" muted playsinline preload="auto"></video>`;
  }
  if (m.tipo === 'secuencia') {
    const primera = m.cuadros?.[0]?.archivo || '';
    return `<img ${base} src="${esc(primera)}" alt="${esc(b.nombre)}" />`;
  }
  return `<img ${base} src="${esc(m.archivo)}" alt="${esc(b.nombre)}" />`;
}

function placeholder(b) {
  return `
    <div class="sat-vacio">
      <div class="icono">🛰</div>
      <div><b>${esc(b.nombre)}</b> — ${esc(b.canal)} · ${esc(b.longitudOnda)}</div>
      <div style="max-width:420px;font-size:12px">${esc(b.para)}</div>
      <div style="margin-top:8px;font-size:11.5px">
        Exporta esta banda desde SLIDER y guárdala en<br>
        <code>medios/satelite/${esc(b.id)}/</code>
      </div>
      <div style="margin-top:6px">
        <a href="${esc(b.permalink || caso.satelite.urlFuente)}" target="_blank" rel="noopener"
           style="color:var(--acento);font-size:11.5px">Abrir en SLIDER ↗</a>
      </div>
    </div>`;
}

/* ---------- Calco de la ruta sobre la imagen ----------
   Sin esto la banda es una foto sin referencia: se ve la tormenta pero no dónde
   cae respecto al vuelo. El SVG usa preserveAspectRatio="xMidYMid meet", que
   encaja píxel a píxel con el object-fit:contain de la imagen, así que el calco
   sigue cuadrando aunque el panel cambie de tamaño.

   Con el zoom aparece un problema que el mapa de Leaflet ya tenía resuelto: el
   calco vive dentro del lienzo que se escala, así que a ×12 el rótulo «SKVV» se
   dibujaba de doce centímetros y tapaba la nube que se quería mirar. La POSICIÓN
   sí tiene que escalar —cada marca pertenece a su latitud y longitud— pero el
   TAMAÑO no. Por eso cada elemento anclado a un punto se envuelve en un grupo
   `translate(punto) scale(1/k)`: el grupo se coloca en coordenadas de imagen y su
   contenido se dibuja en tamaño de pantalla. Los trazos continuos lo resuelven en
   el CSS con vector-effect:non-scaling-stroke. */

let posicionAeronave = null;
let kDelCalco = 1;   // zoom con el que se dibujó el calco que hay en pantalla

// Los límites son 16 000 vértices que hay que pasar por la proyección
// geoestacionaria uno a uno. El resultado NO depende del zoom ni de la hora —solo
// de la rejilla de la banda— así que se calcula una vez por banda y se guarda. Sin
// esta caché se reproyectarían enteros en cada paso de la barra de tiempo y en cada
// golpe de rueda, que es justo cuando el visor tiene que ir suelto.
const limitesPorBanda = new Map();

/**
 * Fronteras y departamentos sobre la imagen, en SVG.
 *
 * Cada anillo se recorre partiéndolo donde deja de verse: un punto fuera del disco
 * del satélite no tiene píxel, y unir el vértice anterior con el siguiente cerraría
 * el hueco con una recta que no existe. Por eso se emite una polilínea por tramo
 * continuo y no una por anillo.
 */
function limitesSVG(b, k) {
  if (limitesPorBanda.has(b.id)) return limitesPorBanda.get(b.id);

  const datos = obtenerLimites();
  const proy = crearProyector(caso.satelite?._recorte?.proyeccion, b.geo);
  if (!datos?.features?.length || !proy) {
    limitesPorBanda.set(b.id, { pais: '', deptos: '', etiquetas: [] });
    return limitesPorBanda.get(b.id);
  }
  const geo = b.geo;

  const punto = (lat, lon) => {
    const q = proy(lat, lon);
    if (!q || !dentro(q, geo, geo.ancho * 0.5)) return null;
    return { x: q.x * k, y: q.y * k };
  };

  /** Anillos de una geometría, sea Polygon o MultiPolygon. */
  const anillosDe = (g) =>
    g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];

  const trazar = (rasgos, clase) => {
    const partes = [];
    for (const f of rasgos) {
      for (const anillo of anillosDe(f.geometry)) {
        let tramo = [];
        for (const [lon, lat] of anillo) {
          const q = punto(lat, lon);
          if (!q) {
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

  const pais = datos.features.filter((f) => f.properties.nivel === 'pais');
  const deptos = datos.features.filter((f) => f.properties.nivel === 'departamento');

  const etiquetas = deptos
    .filter((f) => f.properties.nombre && Array.isArray(f.properties.etiqueta))
    .map((f) => ({ nombre: f.properties.nombre, p: punto(f.properties.etiqueta[0], f.properties.etiqueta[1]) }))
    .filter((e) => e.p);

  const salida = { pais: trazar(pais, 'pais-sat'), deptos: trazar(deptos, 'depto-sat'), etiquetas };
  limitesPorBanda.set(b.id, salida);
  return salida;
}

function calcoHTML(b) {
  const proy = crearProyector(caso.satelite?._recorte?.proyeccion, b.geo);
  if (!proy) return '';
  const geo = b.geo;

  // Se normaliza a un lienzo de 1000 de ancho. Las bandas tienen recortes de
  // tamaño muy distinto —865 px la 13, 3 460 px la 2— y si se dibujara en píxeles
  // de imagen, un texto de 14 saldría legible en una y de dos píxeles en la otra.
  const k = 1000 / geo.ancho;
  const altoVista = geo.alto * k;

  // Inverso del zoom del panel, en unidades del lienzo del SVG. Lo que se dibuja
  // dentro de un grupo con este factor conserva su tamaño en pantalla.
  const kInv = (1 / VISTA.k).toFixed(4);

  const punto = (lat, lon) => {
    const p = proy(lat, lon);
    if (!dentro(p, geo, geo.ancho)) return null;
    return { x: p.x * k, y: p.y * k };
  };

  // Retícula de meridianos y paralelos enteros: la referencia que permite decir
  // «esto es el Amazonas a 2° sur», no «esto es una nube».
  const reticula = [];
  const etiquetas = [];
  const c = caso.satelite._recorte.contorno;
  const lats = c.map((p) => p[0]), lons = c.map((p) => p[1]);
  const paso = 5;
  const desdeLat = Math.ceil(Math.min(...lats) / paso) * paso;
  const hastaLat = Math.floor(Math.max(...lats) / paso) * paso;
  const desdeLon = Math.ceil(Math.min(...lons) / paso) * paso;
  const hastaLon = Math.floor(Math.max(...lons) / paso) * paso;

  const enLienzo = (p) => p && p.x >= 0 && p.y >= 0 && p.x <= 1000 && p.y <= altoVista;

  /** Traza una línea de la retícula y le pone la etiqueta en su primer punto visible. */
  const linea = (puntos, texto, dx, dy) => {
    const visibles = puntos.filter(enLienzo);
    if (visibles.length < 2) return;
    reticula.push(`<polyline points="${puntos.filter(Boolean).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" class="rej" />`);
    const a = visibles[0];
    etiquetas.push(
      `<g transform="translate(${a.x.toFixed(1)},${a.y.toFixed(1)}) scale(${kInv})">` +
      `<text x="${dx}" y="${dy}" class="rej-etq">${texto}</text></g>`
    );
  };

  const grado = (v, pos, neg) => `${Math.abs(v).toFixed(0)}°${v === 0 ? '' : v > 0 ? pos : neg}`;

  for (let la = desdeLat; la <= hastaLat; la += paso) {
    const pts = [];
    for (let lo = Math.min(...lons); lo <= Math.max(...lons); lo += 0.5) pts.push(punto(la, lo));
    linea(pts, grado(la, 'N', 'S'), 10, -10);
  }
  for (let lo = desdeLon; lo <= hastaLon; lo += paso) {
    const pts = [];
    for (let la = Math.max(...lats); la >= Math.min(...lats); la -= 0.5) pts.push(punto(la, lo));
    linea(pts, grado(lo, 'E', 'W'), 8, 26);
  }

  // Ruta
  const wps = caso.ruta.waypoints.map((w) => ({ w, p: punto(w.lat, w.lon) })).filter((o) => o.p);
  const trazado = wps.length > 1
    ? `<polyline points="${wps.map((o) => `${o.p.x.toFixed(1)},${o.p.y.toFixed(1)}`).join(' ')}" class="ruta-sat" />`
    : '';

  const marcasWp = wps
    .filter((o) => o.w.tipo !== 'aerodromo')
    .map((o) => `<g transform="translate(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)}) scale(${kInv})">` +
                `<circle r="6" class="wp-sat" /></g>`)
    .join('');

  // Aeródromos, con etiqueta: son los puntos que se reconocen de un vistazo.
  const enVista = (p) => p && p.x >= 0 && p.y >= 0 && p.x <= 1000 && p.y <= altoVista;

  const ads = caso.aerodromos
    .map((a) => ({ a, p: punto(a.lat, a.lon) }))
    .filter((o) => enVista(o.p))
    .map((o) => `
      <g transform="translate(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)}) scale(${kInv})">
        <circle r="9" class="ad-sat" />
        <text x="15" y="7" class="ad-etq-sat">${esc(o.a.icao)}</text>
      </g>`)
    .join('');

  // Aeronave en la posición que marca la barra de tiempo.
  let avion = '';
  if (posicionAeronave) {
    const p = punto(posicionAeronave.lat, posicionAeronave.lon);
    if (enVista(p)) {
      avion = `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${kInv}) rotate(${posicionAeronave.rumbo.toFixed(0)})">
                 <path d="M0,-16 L4,-2 L16,4 L16,6 L4,4 L4,12 L7,16 L7,18 L0,16 L-7,18 L-7,16 L-4,12 L-4,4 L-16,6 L-16,4 L-4,-2 Z" class="avion-sat" />
               </g>`;
    }
  }

  // Límites administrativos, debajo de todo lo demás: son referencia de fondo, no
  // el contenido del análisis. Los nombres de departamento solo aparecen a partir
  // de ×1,8; a la vista completa del país serían treinta y cuatro rótulos
  // pisándose encima y tapando las nubes que se quieren leer.
  const lim = limitesSVG(b, k);
  const rotulosDepto = VISTA.k >= 1.8
    ? lim.etiquetas
        .filter((e) => enLienzo(e.p))
        .map((e) => `<g transform="translate(${e.p.x.toFixed(1)},${e.p.y.toFixed(1)}) scale(${kInv})">` +
                    `<text class="depto-etq-sat">${esc(e.nombre.toUpperCase())}</text></g>`)
        .join('')
    : '';

  return `<svg id="calco-sat" viewBox="0 0 1000 ${altoVista.toFixed(1)}" preserveAspectRatio="xMidYMid meet">
    ${lim.deptos}${lim.pais}${rotulosDepto}${reticula.join('')}${etiquetas.join('')}${trazado}${marcasWp}${ads}${avion}
  </svg>`;
}

/** Repinta solo el avión, que es lo único que se mueve con la barra de tiempo. */
function actualizarCalco() {
  const svg = document.getElementById('calco-sat');
  const b = bandas.find((x) => x.id === activa);
  if (!svg || !b) return;
  const nuevo = calcoHTML(b);
  if (nuevo) svg.outerHTML = nuevo;
}

/* ---------- Sincronización con la barra de tiempo ---------- */

function sincronizarMedio(fecha) {
  for (const el of document.querySelectorAll('#contenido-sat [data-banda]')) {
    const b = bandas.find((x) => x.id === el.dataset.banda);
    const m = b?.medio;
    if (!m) continue;

    // Secuencia de cuadros: se elige el más cercano a la hora seleccionada.
    if (m.tipo === 'secuencia' && Array.isArray(m.cuadros) && m.cuadros.length) {
      let mejor = m.cuadros[0];
      let dif = Infinity;
      for (const c of m.cuadros) {
        const d = Math.abs(aFecha(c.horaZ) - fecha);
        if (d < dif) { dif = d; mejor = c; }
      }
      if (el.tagName === 'IMG' && !el.src.endsWith(mejor.archivo)) el.src = mejor.archivo;
      continue;
    }

    // Video con ventana temporal declarada: la barra de tiempo lo recorre.
    if (m.tipo === 'video' && m.inicioZ && m.finZ && el.tagName === 'VIDEO' && el.duration) {
      const ini = aFecha(m.inicioZ);
      const fin = aFecha(m.finZ);
      const f = (fecha - ini) / (fin - ini);
      if (f >= 0 && f <= 1) el.currentTime = f * el.duration;
    }
  }
}

/* ---------- Comparador de cortina ---------- */

function activarDivisor() {
  const comp = $('#comparador');
  const div = $('#divisor');
  const encima = comp?.querySelector('.encima');
  if (!comp || !div || !encima) return;

  let arrastrando = false;
  const mover = (clientX) => {
    const r = comp.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    div.style.left = `${pct}%`;
    encima.style.clipPath = `inset(0 0 0 ${pct}%)`;
  };

  // stopPropagation: el arrastre del panel escucha en #contenido-sat, que es
  // antepasado del divisor. Sin esto, mover la cortina con el panel acercado
  // desplazaba además la imagen bajo el dedo.
  div.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    arrastrando = true;
    div.setPointerCapture(e.pointerId);
  });
  div.addEventListener('pointermove', (e) => arrastrando && mover(e.clientX));
  div.addEventListener('pointerup', () => { arrastrando = false; });

  // Un clic en la imagen mueve la cortina a ese punto, pero soltar tras arrastrar
  // el panel también dispara un clic: si no se distinguiera, cada desplazamiento
  // terminaría con la cortina saltando adonde quedó el dedo.
  comp.addEventListener('click', (e) => {
    if (arrastroPanel) { arrastroPanel = false; return; }
    if (e.target !== div) mover(e.clientX);
  });
}

/* ---------- Superposición aproximada sobre el mapa ---------- */

function crearOverlay() {
  const conEsquinas = bandas.find((b) => b.esquinas);
  const limites = conEsquinas?.esquinas || [[0, -85], [16, -60]];

  capaOverlay = L.imageOverlay('', limites, { opacity: 0.65, interactive: false });

  // El aviso de georreferenciación aproximada acompaña a la capa: aparece
  // cuando se enciende y desaparece cuando se apaga.
  capaOverlay.on('add', (e) => {
    const cont = e.target._map?.getContainer();
    if (cont && !cont.querySelector('.aviso-geo')) {
      const aviso = L.DomUtil.create('div', 'aviso-geo', cont);
      aviso.textContent = 'Georreferenciación aproximada — referencia visual, no métrica';
    }
  });
  capaOverlay.on('remove', (e) => {
    e.target._map?.getContainer().querySelector('.aviso-geo')?.remove();
  });

  registrar({
    id: 'overlay-satelite',
    nombre: 'Superposición satelital (aprox.)',
    grupo: 'Satélite',
    capa: capaOverlay,
    opacidad: 0.65,
    descripcion:
      'Ancla la imagen de la banda activa sobre el mapa por sus cuatro esquinas. Georreferenciación APROXIMADA: SLIDER entrega proyección geoestacionaria, no Web Mercator. Válida como referencia visual, no para medir.',
  });
}

function actualizarOverlay(b) {
  if (!capaOverlay) return;
  const m = b.medio || {};
  const archivo = m.tipo === 'secuencia' ? m.cuadros?.[0]?.archivo : m.archivo;

  if (!archivo || !b.esquinas) {
    // Sin esquinas declaradas la superposición no tiene sentido: se apaga.
    if (obtener('overlay-satelite')?.visible) mostrar('overlay-satelite', false);
    return;
  }
  capaOverlay.setUrl(archivo);
  capaOverlay.setBounds(L.latLngBounds(b.esquinas));
}
