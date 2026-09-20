// Vuelo simulado: panel de cabina, alertas y puntos de decisión.
//
// Hasta aquí el visor era un atlas: capas que se encienden y se apagan. Esto lo
// convierte en un vuelo. La barra de tiempo mueve la aeronave por la ruta, y en
// cada instante el panel dice lo que tendría delante la tripulación —dónde está,
// qué le queda, qué hay sobre ella y a qué distancia está lo que importa— leído
// de las mismas imágenes congeladas que analiza el resto del proyecto.
//
// LAS ALERTAS NO SON DECORADO. Cada una nace de una medida con nombre: la
// temperatura de brillo bajo la vertical, la distancia a una célula seguida, el
// techo del alterno. Si el dato no está, la alerta no se inventa: se calla y lo
// dice.
//
// LOS PUNTOS DE DECISIÓN tampoco son un guion. El momento en que aparecen sale
// del encuentro calculado con la célula, y cada opción trae su consecuencia
// CALCULADA —millas extra, separación resultante, combustible— no un texto
// escrito de antemano. Eso es lo que los hace defendibles en una sustentación:
// se puede preguntar «¿de dónde sale ese número?» y hay respuesta.

import { bus, $, esc, horaZ, horaZLarga, distanciaNM, rumbo, longitudRuta, aFecha, colorCat } from './util.js';
import { categoriaEn } from './metar.js';
import { irAFecha } from './tiempo.js';
import { aFL } from './productos.js';

let caso = null;
let analizador = null;
let fenomenos = null;
let posicion = null;
let horaActual = null;
let lecturaBajoAeronave = null;
let lecturaEnCurso = null;   // { clave, promesa } de la lectura en vuelo
let generacion = 0;          // ordinal de pintura, para descartar las tardías
let decisionTomada = null;
let panelAbierto = false;

const NM_AVISO = 50;    // distancia a la que una célula pasa a ser aviso
const NM_ALERTA = 25;   // y a la que pasa a ser alerta

export function iniciarVuelo(datosCaso, an, geojson) {
  caso = datosCaso;
  analizador = an;
  fenomenos = geojson;

  $('#btn-cabina').hidden = false;
  $('#btn-cabina').addEventListener('click', alternar);

  bus.on('tiempo', ({ fecha }) => { horaActual = fecha; actualizar(); });
  bus.on('posicion-aeronave', (p) => { posicion = p; actualizar(); });
}

export function alternar(forzar) {
  panelAbierto = typeof forzar === 'boolean' ? forzar : !panelAbierto;
  $('#efb').hidden = !panelAbierto;
  $('#btn-cabina').classList.toggle('activo', panelAbierto);
  if (panelAbierto) actualizar();
}

export const cabinaAbierta = () => panelAbierto;

/* ---------- Estado de vuelo derivado ---------- */

/** Todo lo que se puede decir del vuelo en este instante. */
export function estadoVuelo() {
  if (!posicion || !horaActual) return null;

  const wps = caso.ruta.waypoints;
  const total = longitudRuta(wps);
  const recorrido = total * posicion.fraccion;
  const restante = Math.max(0, total - recorrido);
  const vel = caso.vuelo.velocidadCruceroKt;

  // Siguiente punto publicado, que es lo que se navega.
  const siguiente = wps.find((w) => w.desdeOrigenNM > recorrido) || wps[wps.length - 1];
  const distSiguiente = Math.max(0, siguiente.desdeOrigenNM - recorrido);

  const eta = aFecha(caso.vuelo.etaZ);
  const minutosRestantes = (restante / vel) * 60;

  return {
    horaZ: horaActual,
    lat: posicion.lat,
    lon: posicion.lon,
    rumbo: posicion.rumbo,
    tramo: posicion.tramo,
    enVuelo: posicion.enVuelo,
    recorridoNM: recorrido,
    restanteNM: restante,
    altitudFt: altitudEn(recorrido),
    siguiente: siguiente.nombre,
    distSiguienteNM: distSiguiente,
    minutosSiguiente: (distSiguiente / vel) * 60,
    eta,
    minutosRestantes,
    velocidadKt: vel,
  };
}

function altitudEn(nm) {
  const wps = caso.ruta.waypoints;
  const crucero = caso.vuelo.nivelCruceroFt;
  const total = longitudRuta(wps);
  const toc = wps.find((w) => w.tipo === 'toc')?.desdeOrigenNM ?? 55;
  const tod = wps.find((w) => w.tipo === 'tod')?.desdeOrigenNM ?? total - 66;
  const e0 = caso.aerodromos.find((a) => a.icao === caso.ruta.origen)?.elevFt ?? 0;
  const e1 = caso.aerodromos.find((a) => a.icao === caso.ruta.destino)?.elevFt ?? 0;
  if (nm <= toc) return e0 + (crucero - e0) * (nm / Math.max(1, toc));
  if (nm >= tod) return crucero + (e1 - crucero) * ((nm - tod) / Math.max(1, total - tod));
  return crucero;
}

/* ---------- Células próximas en este instante ---------- */

/**
 * Distancia de la aeronave a cada célula EN ESTA HORA.
 *
 * Se usa el paso de la célula más cercano en el tiempo, no su geometría de pico:
 * una célula que a las 2030Z estaba a 18 NM pudo estar a 80 NM a las 1950Z, y
 * mezclar las dos cosas daría una alerta falsa.
 */
function celulasAhora() {
  if (!fenomenos?.features || !posicion) return [];
  const t = horaActual.getTime();

  return fenomenos.features
    .map((f) => {
      const p = f.properties;
      const pasos = p.pasos || [];
      let mejor = null;
      for (const s of pasos) {
        const d = Math.abs(aFecha(s.horaZ) - t);
        if (!mejor || d < mejor.dt) mejor = { paso: s, dt: d };
      }
      if (!mejor || mejor.dt > 15 * 60000) return null;   // no está viva ahora
      const nm = distanciaNM(posicion, mejor.paso.centro);
      return {
        id: p.id,
        severidad: p.severidad,
        p05: p.p05TbC,
        nm,
        centro: mejor.paso.centro,
        marcacion: rumbo(posicion, mejor.paso.centro),
        area: mejor.paso.areaNM2,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nm - b.nm);
}

/** Marcación relativa al morro, que es como se canta en cabina. */
function relativa(marcacion, proa) {
  const d = ((marcacion - proa + 540) % 360) - 180;
  const reloj = Math.round(((d + 360) % 360) / 30) || 12;
  return { grados: d, reloj, lado: d < 0 ? 'izquierda' : 'derecha' };
}

/* ---------- Lectura satelital bajo la vertical ---------- */

/**
 * Bastaba un booleano «ya estoy pidiendo»: si entraba una segunda peticion
 * mientras la primera volaba, se descartaba en silencio y el panel se quedaba
 * con la lectura del instante anterior. Ahora la peticion se identifica por su
 * punto —hora y coordenadas—: si la que esta en curso es la misma, se espera;
 * si es otra, se lanza la nueva y la vieja deja de poder escribir el resultado.
 */
async function pedirLectura() {
  if (!posicion || !horaActual || !analizador?.medible('band_13')) return;
  const clave = `${horaActual.getTime()}|${posicion.lat.toFixed(3)}|${posicion.lon.toFixed(3)}`;

  if (lecturaEnCurso?.clave !== clave) {
    const promesa = analizador
      .valorEn('band_13', horaActual, posicion.lat, posicion.lon)
      .then((v) => { if (lecturaEnCurso?.clave === clave) lecturaBajoAeronave = v; })
      .catch(() => { if (lecturaEnCurso?.clave === clave) lecturaBajoAeronave = null; });
    lecturaEnCurso = { clave, promesa };
  }
  await lecturaEnCurso.promesa;
}

/* ---------- Alertas ---------- */

function alertas(est) {
  const out = [];
  const cel = celulasAhora();

  for (const c of cel.slice(0, 3)) {
    if (c.nm > NM_AVISO) continue;
    const rel = relativa(c.marcacion, est.rumbo);
    out.push({
      grado: c.nm < NM_ALERTA ? 'alerta' : 'aviso',
      texto: `Célula ${c.id} (${c.severidad}) a ${c.nm.toFixed(0)} NM, a las ${rel.reloj}`,
      detalle: `Percentil 5 del tope ${c.p05} °C · área ${c.area} NM² · marcación ${Math.round(c.marcacion)}°`,
    });
  }

  const l = lecturaBajoAeronave;
  if (l?.nube && l.sobreCrucero) {
    out.push({
      grado: 'alerta',
      texto: `Tope de nube por encima de ${caso.vuelo.nivelCrucero} en la vertical`,
      detalle: l.topeFL != null
        ? `Tope estimado FL${l.topeFL} frente a ${caso.vuelo.nivelCrucero} (Tb ${l.valor.toFixed(1)} °C)`
        : `Tb ${l.valor.toFixed(1)} °C, por debajo de la tropopausa del modelo: altura no cotizable`,
    });
  }

  // Destino y alterno, con la categoría vigente a la hora de llegada estimada.
  const destino = caso.ruta.destino;
  const catDestino = categoriaEn(destino, est.eta);
  if (catDestino === 'IFR' || catDestino === 'LIFR') {
    out.push({
      grado: 'alerta',
      texto: `${destino} en ${catDestino} a la hora estimada de llegada`,
      detalle: `Categoría calculada con el METAR vigente a ${horaZ(est.eta)}.`,
    });
  }

  if (!out.length) {
    out.push({ grado: 'ok', texto: 'Sin conflictos a menos de 50 NM', detalle: 'Ninguna célula seguida en el entorno y tope de nube por debajo del nivel de crucero.' });
  }
  return out;
}

/* ---------- Puntos de decisión ----------
   Se disparan por el encuentro CALCULADO con la célula más comprometida: quince
   minutos antes del punto de máxima aproximación, que es cuando un desvío todavía
   sale barato. Las opciones traen su consecuencia en números. */

function puntoDecision(est) {
  if (!fenomenos?.features) return null;

  const critica = fenomenos.features
    .map((f) => f.properties)
    .filter((p) => p.encuentro && p.encuentro.distanciaNM < NM_ALERTA)
    .sort((a, b) => a.encuentro.distanciaNM - b.encuentro.distanciaNM)[0];
  if (!critica) return null;

  const tEnc = aFecha(critica.encuentro.horaZ).getTime();
  const anticipo = (tEnc - horaActual.getTime()) / 60000;
  if (anticipo < 0 || anticipo > 20) return null;   // solo en la ventana útil

  const cpa = critica.encuentro.distanciaNM;
  const objetivo = 25;                                // separación que se busca
  const desvioNM = Math.max(0, objetivo - cpa);

  // Millas extra de un desvío lateral en dos tramos (salir y volver a la ruta),
  // con el tramo de 150 NM que queda por delante como base. Es geometría, no una
  // estimación: la declara la propia opción.
  const base = 150;
  const extra = 2 * (Math.hypot(base / 2, desvioNM) - base / 2);
  const minutosExtra = (extra / est.velocidadKt) * 60;

  const alterno = caso.aerodromos
    .filter((a) => a.rol === 'alterno')
    .map((a) => ({ a, nm: distanciaNM(posicion, a) }))
    .sort((x, y) => x.nm - y.nm)[0];

  return {
    id: critica.id,
    horaZ: critica.encuentro.horaZ,
    anticipoMin: Math.round(anticipo),
    cpa,
    severidad: critica.severidad,
    p05: critica.p05TbC,
    opciones: [
      {
        id: 'continuar',
        titulo: 'Mantener ruta y nivel',
        consecuencia: `Paso a ${cpa} NM del centro de ${critica.id} a las ${horaZ(aFecha(critica.encuentro.horaZ))}. ` +
          `Sin coste en tiempo ni combustible.`,
        riesgo: cpa < 10 ? 'alto' : cpa < 25 ? 'medio' : 'bajo',
        base: 'Distancia de máxima aproximación calculada cruzando la posición de la aeronave con el centroide seguido de la célula.',
      },
      {
        id: 'desviar',
        titulo: `Desvío lateral de ${Math.round(desvioNM)} NM`,
        consecuencia: `Separación resultante ≈ ${objetivo} NM. Coste: ${extra.toFixed(1)} NM extra, ` +
          `unos ${minutosExtra.toFixed(0)} min a ${est.velocidadKt} kt.`,
        riesgo: 'bajo',
        base: `Geometría de un desvío simétrico sobre un tramo de ${base} NM: 2·(√((${base}/2)² + d²) − ${base}/2).`,
      },
      {
        id: 'nivel',
        titulo: 'Sobrevolar cambiando de nivel',
        consecuencia: critica.p05TbC <= -60
          ? `NO VIABLE: el percentil 5 del tope es ${critica.p05TbC} °C, muy por encima de cualquier nivel disponible para un ${caso.vuelo.aeronave}.`
          : `El tope estimado queda cerca del nivel de crucero; un nivel superior podría salvarlo, pero la tabla semicircular solo ofrece impares.`,
        riesgo: critica.p05TbC <= -60 ? 'alto' : 'medio',
        base: 'Percentil 5 de la temperatura de brillo de la célula, de datos/fenomenos.geojson.',
      },
      alterno && {
        id: 'alterno',
        titulo: `Desviar a ${alterno.a.icao}`,
        consecuencia: `${Math.round(alterno.nm)} NM desde la posición actual, ` +
          `unos ${Math.round((alterno.nm / est.velocidadKt) * 60)} min. ` +
          `Categoría allí a esa hora: ${categoriaEn(alterno.a.icao, new Date(horaActual.getTime() + (alterno.nm / est.velocidadKt) * 3600000))}.`,
        riesgo: 'medio',
        base: 'Distancia ortodrómica desde la posición simulada y METAR del alterno a la hora estimada de llegada.',
      },
    ].filter(Boolean),
  };
}

/* ---------- Pintado ---------- */

async function actualizar() {
  if (!panelAbierto) return;

  // El mapa emite 'posicion-aeronave' DENTRO de su propio oyente de 'tiempo', y
  // ese oyente se registra antes que el de este modulo. De ahi que al mover la
  // barra lleguen dos actualizaciones: la primera con la posicion nueva y el
  // reloj todavia viejo, la segunda ya con los dos al dia. Sin este ordinal, la
  // primera terminaba despues y machacaba a la buena: el panel mostraba la hora
  // del paso anterior junto a la posicion actual.
  const mia = ++generacion;
  await pedirLectura();
  if (mia !== generacion) return;

  const est = estadoVuelo();
  if (!est) return;

  const l = lecturaBajoAeronave;
  const cel = celulasAhora();
  const av = alertas(est);
  const dec = puntoDecision(est);
  const catDestino = categoriaEn(caso.ruta.destino, est.eta);

  const campo = (etq, val, extra = '') =>
    `<div class="efb-campo"><span>${esc(etq)}</span><b>${val}</b>${extra}</div>`;

  $('#efb').innerHTML = `
    <div class="efb-cab">
      <span class="efb-ind">${esc(caso.vuelo.indicativo)}</span>
      <span class="efb-ruta">${esc(caso.ruta.origen)} → ${esc(caso.ruta.destino)}</span>
      <span class="efb-reloj">${esc(horaZLarga(est.horaZ))}</span>
      <button id="efb-cerrar" title="Cerrar el panel de cabina">×</button>
    </div>

    ${!est.enVuelo ? `<div class="efb-fuera">Fuera de la ventana del vuelo (salida ${esc(horaZ(aFecha(caso.vuelo.salidaZ)))}, ETA ${esc(horaZ(aFecha(caso.vuelo.etaZ)))})</div>` : ''}

    <div class="efb-rejilla">
      ${campo('Posición', `${est.lat.toFixed(2)}° ${est.lon.toFixed(2)}°`)}
      ${campo('Rumbo', `${Math.round(est.rumbo)}°`)}
      ${campo('Altitud', est.altitudFt >= caso.vuelo.nivelCruceroFt - 50 ? esc(caso.vuelo.nivelCrucero) : `${Math.round(est.altitudFt).toLocaleString('es')} ft`)}
      ${campo('Velocidad', `${est.velocidadKt} kt`)}
      ${campo('Recorrido', `${Math.round(est.recorridoNM)} NM`)}
      ${campo('Restante', `${Math.round(est.restanteNM)} NM`)}
      ${campo('Siguiente', esc(est.siguiente), `<span class="efb-sub">${Math.round(est.distSiguienteNM)} NM · ${Math.round(est.minutosSiguiente)} min</span>`)}
      ${campo('ETA', esc(horaZ(est.eta)), `<span class="efb-sub" style="color:${colorCat(catDestino)}">${esc(catDestino)} en ${esc(caso.ruta.destino)}</span>`)}
    </div>

    <div class="efb-titulo">Bajo la vertical <span class="efb-fuente">banda 13 · ${esc(l?.horaZ ? horaZ(aFecha(l.horaZ)) : '—')}</span></div>
    <div class="efb-vertical">
      ${l
        ? `${campo('Temp. de brillo', `${l.valor.toFixed(1)} °C`)}
           ${campo('Nube', l.nube ? 'sí' : 'no detectada')}
           ${campo('Tope estimado', l.nube ? (l.topeFL != null ? `FL${l.topeFL}` : 'sobre tropopausa') : '—')}
           ${campo('Respecto al nivel', l.nube ? (l.sobreCrucero ? 'POR ENCIMA' : 'por debajo') : '—')}
           ${l.ambiguo ? '<div class="efb-aviso">Color ambiguo en este punto: lectura no concluyente.</div>' : ''}`
        : '<div class="efb-aviso">Sin lectura satelital en esta posición.</div>'}
    </div>

    <div class="efb-titulo">Alertas</div>
    <div class="efb-alertas">
      ${av.map((a) => `
        <div class="efb-alerta g-${esc(a.grado)}" title="${esc(a.detalle)}">
          <span class="ea-punto"></span>
          <span class="ea-txt">${esc(a.texto)}</span>
        </div>`).join('')}
    </div>

    ${cel.length ? `
      <div class="efb-titulo">Células seguidas <span class="efb-fuente">${cel.length} vivas ahora</span></div>
      <table class="efb-celulas">
        ${cel.slice(0, 5).map((c) => {
          const rel = relativa(c.marcacion, est.rumbo);
          return `<tr class="sev-${esc(c.severidad)}">
            <td>${esc(c.id)}</td>
            <td>${c.nm.toFixed(0)} NM</td>
            <td>${rel.reloj} h</td>
            <td>${c.p05} °C</td>
          </tr>`;
        }).join('')}
      </table>` : ''}

    ${dec ? panelDecision(dec) : ''}
    ${decisionTomada ? `
      <div class="efb-decidido">
        Decisión registrada: <b>${esc(decisionTomada.titulo)}</b>
        <div class="efb-sub">${esc(decisionTomada.consecuencia)}</div>
        <button id="efb-deshacer">Revisar</button>
      </div>` : ''}`;

  $('#efb-cerrar')?.addEventListener('click', () => alternar(false));
  $('#efb-deshacer')?.addEventListener('click', () => { decisionTomada = null; actualizar(); });

  document.querySelectorAll('#efb [data-opcion]').forEach((b) => {
    b.addEventListener('click', () => {
      const op = dec.opciones.find((o) => o.id === b.dataset.opcion);
      decisionTomada = op;
      bus.emit('decision-tomada', { punto: dec, opcion: op });
      actualizar();
    });
  });
}

function panelDecision(d) {
  return `
    <div class="efb-decision">
      <div class="ed-cab">
        <span class="ed-eti">PUNTO DE DECISIÓN</span>
        <span class="ed-tiempo">${d.anticipoMin} min para el paso</span>
      </div>
      <div class="ed-texto">
        La célula <b>${esc(d.id)}</b> (${esc(d.severidad)}, percentil 5 ${d.p05} °C) quedará a
        <b>${d.cpa} NM</b> a las ${esc(horaZ(aFecha(d.horaZ)))}. Hay que decidir ahora.
      </div>
      ${d.opciones.map((o) => `
        <button class="ed-opcion r-${esc(o.riesgo)}" data-opcion="${esc(o.id)}" title="${esc(o.base)}">
          <span class="eo-tit">${esc(o.titulo)}</span>
          <span class="eo-con">${esc(o.consecuencia)}</span>
        </button>`).join('')}
      <div class="ed-nota">Cada consecuencia está calculada con los datos del caso; pasa el cursor por una opción para ver de dónde sale.</div>
    </div>`;
}

export const decisionActual = () => decisionTomada;
