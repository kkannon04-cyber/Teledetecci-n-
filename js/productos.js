// Productos derivados: de color de píxel a magnitud con sentido operacional.
//
// Tres saltos, cada uno con su fórmula declarada y sus límites escritos:
//
//   1. COLOR → TEMPERATURA DE BRILLO. Invirtiendo la tabla publicada
//      (radiometria.js), con desambiguación por vecindad donde el color no basta.
//   2. TEMPERATURA DE BRILLO → ALTURA DEL TOPE. Con un gradiente térmico
//      declarado y ANCLADO EN UN METAR REAL de la hora, no en una atmósfera
//      tipo inventada.
//   3. ALTURA DEL TOPE → RESPUESTA OPERACIONAL. ¿Queda por encima o por debajo
//      del nivel de crucero? Esa es la pregunta que el análisis tiene que contestar.
//
// Todo lo que sale de aquí es CALCULADO, nunca observado, y así se rotula. La
// procedencia viaja con el número: cada lectura lleva qué banda, qué cuadro, qué
// estación la ancló y con cuánto error de ajuste, para que el informe pueda citar
// la cifra sin tener que creérsela.

import { crearLector } from './radiometria.js';
import { sondaEn } from './muestreo.js';
import { distanciaNM, puntoEnRuta, longitudRuta } from './util.js';

/* ---------- Modelo de altura de tope ----------
   T(z) = T0 − Γ·(z − z0), con Γ = 6,5 °C/km.

   Γ es el gradiente de la troposfera de la Atmósfera Tipo OACI (Doc 7488), que
   es un valor PUBLICADO, no una estimación de andar por casa. Lo que no es
   publicado es que ese gradiente valga para la Amazonía el 07 SEP 2026: sin
   radiosondeo no hay forma de saberlo, y por eso la altura sale marcada como
   calculada y con su incertidumbre.

   T0 y z0 NO son de atmósfera tipo: son la temperatura y la elevación del METAR
   real más cercano a la hora. Anclar en el dato observado es lo que separa esto
   de un número plausible. */

const GAMMA_C_POR_KM = 6.5;
const M_POR_FT = 0.3048;

/** Temperatura a la que el modelo deja de valer: la tropopausa tropical. */
const TB_TROPOPAUSA = -75;

/* ---------- Máscara de nube ----------
   Sin esto el modelo le calcula «altura de tope» también al suelo desnudo, y
   devuelve un cumulonimbo de 4 000 ft donde solo hay selva al sol. La altura de
   tope SOLO significa algo si el píxel es nube, así que primero hay que decidir
   si lo es.

   Criterio declarado: el píxel es nube si su temperatura de brillo está más de
   10 °C por debajo de la del METAR de anclaje. El umbral no es arbitrario en su
   orden de magnitud —la absorción del vapor de agua en la ventana de 10,3 µm ya
   enfría la señal unos grados respecto al suelo real, y el suelo tropical a las
   13:30 locales está más caliente que la garita— pero tampoco es un producto
   calibrado: es un corte razonado, y por eso se declara y se puede discutir.
   Un tope por debajo del umbral se rotula «sin nube detectada», no «tope a 0 ft». */
const UMBRAL_NUBE_C = 10;

export const MODELO_TOPE = {
  formula: 'z_tope = z_estación + (T_estación − Tb) / Γ,  con Γ = 6,5 °C/km',
  gammaCPorKm: GAMMA_C_POR_KM,
  origenGamma: 'Gradiente térmico de la troposfera en la Atmósfera Tipo OACI (Doc 7488).',
  ancla: 'T_estación y z_estación salen del METAR real más cercano al punto y a la hora, no de una atmósfera tipo.',
  limites: [
    'Γ es el valor tipo, no el gradiente medido del día: sin radiosondeo no se puede verificar. La altura es una ESTIMACIÓN.',
    `Por debajo de ${TB_TROPOPAUSA} °C el perfil deja de ser lineal (tropopausa tropical) y el modelo sobreestima la altura: esos topes se marcan y no se cotizan en pies.`,
    'Tb es la temperatura RADIATIVA del tope. En cirro fino el instrumento ve parcialmente a través de la nube, Tb sale más cálida que el tope real y la altura queda subestimada.',
    'Entre el dato original y este color hay 192 escalones de tabla y una compresión JPEG: el error de ajuste viaja con cada lectura.',
    `La altura solo se calcula donde la máscara da nube (Tb al menos ${UMBRAL_NUBE_C} °C por debajo del METAR de anclaje). En cielo despejado no hay tope que medir y el campo sale vacío, no en cero.`,
  ],
  umbralNubeC: UMBRAL_NUBE_C,
};

/** ¿Hay nube en este píxel, o es suelo? */
export const esNube = (tb, ancla) =>
  tb != null && ancla?.temp != null && tb < ancla.temp - UMBRAL_NUBE_C;

/** Altura del tope en pies a partir de la temperatura de brillo. */
export function alturaTope(tb, ancla) {
  if (tb == null || !ancla || ancla.temp == null) return null;
  const z0m = (ancla.elev ?? 0) * M_POR_FT;
  const km = (ancla.temp - tb) / GAMMA_C_POR_KM;
  const metros = z0m + km * 1000;
  return {
    ft: metros / M_POR_FT,
    sobreTropopausa: tb < TB_TROPOPAUSA,
    ancla,
  };
}

export const aFL = (ft) => Math.round(ft / 100);

/* ---------- Anclaje en METAR ---------- */

/**
 * Índice de observaciones por estación, para encontrar deprisa la más cercana
 * en espacio y en tiempo. Solo entran las que traen temperatura: una estación sin
 * termómetro no puede anclar nada.
 */
function indexarMetar(metar) {
  const datos = metar?.datos || [];
  const porEstacion = new Map();
  for (const o of datos) {
    if (o.temp == null || o.lat == null || o.lon == null) continue;
    if (!porEstacion.has(o.icaoId)) porEstacion.set(o.icaoId, []);
    porEstacion.get(o.icaoId).push(o);
  }
  for (const lista of porEstacion.values()) {
    lista.sort((a, b) => new Date(a.reportTime) - new Date(b.reportTime));
  }
  return porEstacion;
}

/**
 * METAR que ancla el cálculo en un punto y una hora.
 *
 * Se elige la estación más próxima EN DISTANCIA que además tenga observación
 * dentro de ±90 min. No se coge la más cercana en el tiempo aunque esté a 400 NM:
 * la temperatura de superficie de otra región no dice nada del perfil de aquí.
 */
function crearAnclador(metar) {
  const porEstacion = indexarMetar(metar);

  return function anclaEn(lat, lon, fecha) {
    let mejor = null;
    for (const lista of porEstacion.values()) {
      const est = lista[0];
      const nm = distanciaNM({ lat, lon }, { lat: est.lat, lon: est.lon });
      if (mejor && nm > mejor.nm) continue;

      let obs = null;
      let dif = Infinity;
      for (const o of lista) {
        const d = Math.abs(new Date(o.reportTime) - fecha);
        if (d < dif) { dif = d; obs = o; }
      }
      if (!obs || dif > 90 * 60000) continue;
      mejor = { nm, obs, minutos: dif / 60000 };
    }
    if (!mejor) return null;
    return {
      icao: mejor.obs.icaoId,
      nombre: mejor.obs.name,
      temp: mejor.obs.temp,
      elev: mejor.obs.elev,
      distanciaNM: mejor.nm,
      desfaseMin: Math.round(mejor.minutos),
      horaZ: mejor.obs.reportTime,
      crudo: mejor.obs.rawOb,
    };
  };
}

/* ---------- Desambiguación del gris ----------
   En la banda 13 un gris puede ser suelo a +30 °C o un tope a −85 °C. El píxel
   solo no lo resuelve; la VECINDAD sí. Un tope de −85 °C no aparece aislado en
   mitad de la selva: está siempre dentro de un núcleo cuyo borde la tabla sí
   colorea sin ambigüedad (−30 a −80 °C). Así que se mira la ventana: si alrededor
   hay color frío de verdad, el gris del centro es la cima del núcleo; si no lo
   hay, es suelo.

   Cuando la ventana no permite decidir, la lectura sale marcada `ambiguo` y quien
   la pinte tiene que decirlo. No se elige «la más probable» en silencio.

   El umbral de vecindad es −72 °C y no −30 °C por la misma razón que en
   nucleos.js: la cola gris de la tabla arranca en −80 °C, así que solo se llega a
   ella desde el extremo frío de la rampa de color. Aceptar cualquier color frío
   convertía una mota de compresión dentro de un yunque a −45 °C en un tope de
   −88 °C. */

const RADIO_VENTANA = 4;
const FRACCION_FRIA = 0.12;
const UMBRAL_COLA_C = -72;

function decidirPreferencia(lector, ventana) {
  if (!ventana.length) return null;
  let frios = 0;
  let nitidos = 0;
  for (const [r, g, b] of ventana) {
    const cand = lector.candidatos(r, g, b);
    if (cand.length !== 1) continue;      // solo cuentan los inequívocos
    nitidos++;
    if (cand[0].valor <= UMBRAL_COLA_C) frios++;
  }
  if (!nitidos) return null;
  return frios / nitidos >= FRACCION_FRIA ? 'frio' : 'calido';
}

/* ---------- Analizador ---------- */

export function crearAnalizador(caso, barras, metar) {
  const anclaEn = crearAnclador(metar);
  const lectores = new Map();
  const bandaDe = (id) => caso.satelite.bandas.find((b) => b.id === id);

  function lectorDe(bandaId) {
    if (!lectores.has(bandaId)) lectores.set(bandaId, crearLector(barras, bandaId));
    return lectores.get(bandaId);
  }

  /** ¿Esta banda se puede leer en unidades físicas y tiene cuadros en disco? */
  function medible(bandaId) {
    const b = bandaDe(bandaId);
    return Boolean(lectorDe(bandaId) && b?.medio?.tipo === 'secuencia' && b.medio.cuadros?.length);
  }

  /** Lectura de un punto: temperatura de brillo con su procedencia. */
  async function valorEn(bandaId, fecha, lat, lon) {
    const banda = bandaDe(bandaId);
    const lector = lectorDe(bandaId);
    if (!banda || !lector) return null;
    const sonda = await sondaEn(caso, banda, fecha);
    if (!sonda) return null;
    const l = leerConSonda(lector, sonda, lat, lon, bandaId);
    if (!l) return null;

    // La lectura suelta se devuelve ya interpretada: quien pregunta por un punto
    // quiere saber si hay nube y hasta dónde llega, no solo cuántos grados marca.
    const ancla = anclaEn(lat, lon, fecha);
    const nube = esNube(l.valor, ancla);
    const tope = nube ? alturaTope(l.valor, ancla) : null;
    const cotizable = tope && !tope.sobreTropopausa;
    return {
      ...l,
      ancla,
      nube,
      topeFt: cotizable ? tope.ft : null,
      topeFL: cotizable ? aFL(tope.ft) : null,
      topeSobreTropopausa: tope?.sobreTropopausa ?? false,
      sobreCrucero: cotizable ? tope.ft > caso.vuelo.nivelCruceroFt : Boolean(tope?.sobreTropopausa),
    };
  }

  function leerConSonda(lector, sonda, lat, lon, bandaId) {
    const rgb = sonda.rgbEn(lat, lon);
    if (!rgb) return null;

    // La vecindad solo se mira cuando hace falta. Desambiguar cuesta 81 lecturas
    // de rampa por punto, y la inmensa mayoría de los píxeles casan con un único
    // tramo: hacerlo siempre multiplicaría por ochenta el coste del perfil para
    // resolver una ambigüedad que no existe.
    const directa = lector.leer(rgb[0], rgb[1], rgb[2], null);
    if (!directa) return null;
    const preferir = directa.ambiguo
      ? decidirPreferencia(lector, sonda.ventanaEn(lat, lon, RADIO_VENTANA))
      : null;
    const l = preferir ? lector.leer(rgb[0], rgb[1], rgb[2], preferir) : directa;
    return {
      bandaId,
      valor: l.valor,
      unidad: lector.unidad,
      ambiguo: l.ambiguo && !preferir,
      desambiguadoPorVecindad: l.ambiguo && Boolean(preferir),
      saturado: l.saturado,
      errorAjuste: Math.round(l.distancia),
      archivo: sonda.archivo,
      horaZ: sonda.horaZ,
    };
  }

  /**
   * Corte de la ruta: N puntos repartidos por distancia, con su temperatura de
   * brillo, la altura de tope que implica y si esa altura supera el crucero.
   *
   * Es el producto central del análisis: convierte una imagen en una respuesta a
   * «¿puedo ir por aquí a FL210?».
   */
  async function perfilRuta(bandaId, fecha, puntos = 180) {
    const banda = bandaDe(bandaId);
    const lector = lectorDe(bandaId);
    if (!banda || !lector) return null;

    const sonda = await sondaEn(caso, banda, fecha);
    if (!sonda) return null;

    const wps = caso.ruta.waypoints;
    const total = longitudRuta(wps);
    const crucero = caso.vuelo.nivelCruceroFt;

    const muestras = [];
    let anclaCache = null;
    let anclaCadaNM = 0;

    for (let i = 0; i < puntos; i++) {
      const f = i / (puntos - 1);
      const p = puntoEnRuta(wps, f);
      const nm = total * f;

      const lectura = leerConSonda(lector, sonda, p.lat, p.lon, bandaId);

      // El ancla se recalcula cada 40 NM: buscar la estación más cercana en cada
      // uno de los 180 puntos costaría 180 barridos del índice y el resultado
      // apenas cambia dentro de ese tramo.
      if (!anclaCache || nm - anclaCadaNM > 40) {
        anclaCache = anclaEn(p.lat, p.lon, fecha);
        anclaCadaNM = nm;
      }

      // La altura de tope solo se calcula donde hay nube: al suelo despejado el
      // modelo le sacaría un tope de unos pocos miles de pies que no existe.
      const nube = esNube(lectura?.valor, anclaCache);
      const tope = nube ? alturaTope(lectura.valor, anclaCache) : null;
      const cotizable = tope && !tope.sobreTropopausa;

      muestras.push({
        nm,
        fraccion: f,
        lat: p.lat,
        lon: p.lon,
        tramo: p.tramo,
        tb: lectura?.valor ?? null,
        nube,
        ambiguo: lectura?.ambiguo ?? true,
        saturado: lectura?.saturado ?? false,
        errorAjuste: lectura?.errorAjuste ?? null,
        topeFt: cotizable ? tope.ft : null,
        topeSobreTropopausa: tope?.sobreTropopausa ?? false,
        topeFL: cotizable ? aFL(tope.ft) : null,
        sobreCrucero: cotizable ? tope.ft > crucero : Boolean(tope?.sobreTropopausa),
        ancla: anclaCache,
      });
    }

    return {
      bandaId,
      banda: banda.nombre,
      horaZ: sonda.horaZ,
      archivo: sonda.archivo,
      unidad: lector.unidad,
      cruceroFt: crucero,
      muestras,
      modelo: MODELO_TOPE,
    };
  }

  /**
   * Diferencia entre dos bandas en el mismo punto.
   *
   * Las bandas 07, 09, 10 y 13 comparten EXACTAMENTE la misma rejilla del recorte
   * (989 × 1124 px, zoom 3), así que la resta es píxel a píxel y no hay que
   * remuestrear nada: los dos valores salen del mismo trozo de atmósfera.
   *
   *   B09 − B13 ≳ 0  → el vapor de agua se ve tan frío como la ventana limpia:
   *                    firma de tope que alcanza o rebasa la tropopausa.
   *   B07 − B13 < 0 de noche → nube baja o niebla: la gota pequeña emite menos a
   *                    3,9 µm que a 10,3 µm.
   */
  async function diferenciaEn(idA, idB, fecha, lat, lon) {
    const a = await valorEn(idA, fecha, lat, lon);
    const b = await valorEn(idB, fecha, lat, lon);
    if (!a || !b) return null;
    const mismaRejilla =
      bandaDe(idA)?.geo?.ancho === bandaDe(idB)?.geo?.ancho &&
      bandaDe(idA)?.geo?.alto === bandaDe(idB)?.geo?.alto;
    return {
      a, b,
      diferencia: a.valor - b.valor,
      mismaRejilla,
      ambiguo: a.ambiguo || b.ambiguo,
    };
  }

  /** Corte de diferencia a lo largo de la ruta, con las dos bandas a la vez. */
  async function perfilDiferencia(idA, idB, fecha, puntos = 120) {
    const pa = await perfilRuta(idA, fecha, puntos);
    const pb = await perfilRuta(idB, fecha, puntos);
    if (!pa || !pb) return null;
    return {
      idA, idB,
      horaZ: pa.horaZ,
      muestras: pa.muestras.map((m, i) => ({
        nm: m.nm,
        lat: m.lat,
        lon: m.lon,
        valor: m.tb != null && pb.muestras[i].tb != null ? m.tb - pb.muestras[i].tb : null,
        ambiguo: m.ambiguo || pb.muestras[i].ambiguo,
      })),
    };
  }

  return {
    medible,
    valorEn,
    perfilRuta,
    diferenciaEn,
    perfilDiferencia,
    anclaEn,
    lectorDe,
    modelo: MODELO_TOPE,
  };
}
