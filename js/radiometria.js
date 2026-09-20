// Inversión de la tabla de color: de color de píxel a valor físico.
//
// Las imágenes de SLIDER no son radiancias calibradas: son el producto YA
// RENDERIZADO, cada banda con su tabla de color. Mientras no se invierta esa
// tabla, «la nube sale roja» es una impresión, no una medida, y todo el análisis
// se queda en lo cualitativo. Aquí se hace el camino de vuelta: color → posición
// en la rampa → valor rotulado en la barra, con la rampa y las marcas que el
// propio SLIDER publica y que datos/barras-color.json tiene congeladas.
//
// LO QUE ESTO NO ES. No sustituye al NetCDF del ABI. Entre el dato original y
// este color hay una cuantización a 192 escalones y una compresión JPEG, y las
// dos meten error. Por eso cada lectura sale con su distancia de ajuste y sus
// banderas: quien la use decide si la cifra aguanta o no. Nunca se devuelve un
// número liso fingiendo exactitud que no hay.
//
// LA AMBIGÜEDAD DEL GRIS. En la tabla ircimss2 (banda 13) el gris aparece DOS
// veces: la rampa cálida va de negro en +40 °C a gris claro en −30 °C, y la cola
// fría vuelve a arrancar en negro a −80 °C y aclara hasta blanco en −90 °C. Un
// píxel gris, por sí solo, puede ser suelo caliente o el tope de un cumulonimbo:
// son 120 °C de diferencia. El color NO lo resuelve, así que no se resuelve aquí:
// se devuelven los dos candidatos y quien llama desambigua por vecindad
// (productos.js), que es donde sí hay información para hacerlo.

/** Distancia euclídea al cuadrado en RGB. Basta para casar contra la rampa. */
const dist2 = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

/**
 * Valor rotulado en la barra para una posición 0..1 de la rampa.
 *
 * Interpola entre las marcas transcritas. Fuera de la primera y la última NO
 * extrapola: la barra no dice qué hay más allá, así que devuelve el valor del
 * extremo y lo marca como saturado.
 */
function crearEscala(escala) {
  if (!escala?.length) return null;
  const primera = escala[0];
  const ultima = escala[escala.length - 1];

  return function valorEn(pos) {
    if (pos <= primera.pos) return { valor: primera.valor, saturado: pos < primera.pos - 1e-6 };
    if (pos >= ultima.pos) return { valor: ultima.valor, saturado: pos > ultima.pos + 1e-6 };
    for (let i = 1; i < escala.length; i++) {
      if (pos <= escala[i].pos) {
        const f = (pos - escala[i - 1].pos) / (escala[i].pos - escala[i - 1].pos);
        return { valor: escala[i - 1].valor + f * (escala[i].valor - escala[i - 1].valor), saturado: false };
      }
    }
    return { valor: ultima.valor, saturado: true };
  };
}

/**
 * Lector para una banda concreta.
 * @param {object} barras  datos/barras-color.json ya cargado
 * @param {string} bandaId p.ej. 'band_13'
 * @returns {object|null}  null si la banda no tiene tabla con valores publicados
 */
export function crearLector(barras, bandaId) {
  const idTabla = barras?.bandas?.[bandaId];
  const t = idTabla ? barras.tablas?.[idTabla] : null;
  if (!t?.rampa?.length || !t.escala?.length) return null;

  const rampa = t.rampa;
  const n = rampa.length;
  const valorEn = crearEscala(t.escala);

  // Dónde deja de haber información: en el extremo frío la rampa satura en blanco
  // puro y varios escalones seguidos comparten color. Por debajo de ese punto la
  // imagen ya no distingue temperaturas, y decir «−93 °C» sería inventar precisión.
  let idxSaturado = n;
  for (let i = n - 1; i > 0; i--) {
    if (rampa[i][0] === rampa[i - 1][0] && rampa[i][1] === rampa[i - 1][1] && rampa[i][2] === rampa[i - 1][2]) idxSaturado = i;
    else break;
  }

  const pos = (i) => i / (n - 1);

  /**
   * Todos los tramos de la rampa que casan con este color.
   *
   * Se buscan los mínimos locales de la distancia y no solo el mejor: en una
   * rampa que pasa dos veces por el mismo gris, el mejor absoluto lo decide el
   * ruido del JPEG, no la física. Devolver los dos deja la decisión donde
   * corresponde.
   */
  function candidatos(r, g, b) {
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = dist2(r, g, b, rampa[i]);

    // Mínimos locales, agrupando las mesetas (tramos de rampa de color repetido).
    const minimos = [];
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && d[j + 1] === d[i]) j++;            // meseta [i..j]
      const izq = i === 0 ? Infinity : d[i - 1];
      const der = j === n - 1 ? Infinity : d[j + 1];
      if (d[i] <= izq && d[i] <= der) minimos.push({ idx: Math.round((i + j) / 2), d: d[i] });
      i = j + 1;
    }
    if (!minimos.length) return [];

    minimos.sort((a, b2) => a.d - b2.d);
    const mejor = minimos[0].d;

    // Tolerancia: se conservan los mínimos que compiten de verdad con el mejor.
    // El término aditivo cubre el ruido de compresión, que en JPEG 4:2:0 mueve
    // varias unidades por canal incluso en zonas planas.
    const tope = mejor * 1.25 + 300;

    const salida = [];
    for (const m of minimos) {
      if (m.d > tope) break;
      // Dos mínimos pegados son el mismo tramo de rampa, no dos lecturas distintas.
      if (salida.some((s) => Math.abs(s.idx - m.idx) < 8)) continue;
      const p = pos(m.idx);
      const v = valorEn(p);
      salida.push({
        idx: m.idx,
        pos: p,
        valor: v.valor,
        distancia: Math.sqrt(m.d),
        saturado: v.saturado || m.idx >= idxSaturado,
      });
    }
    return salida;
  }

  /**
   * Lectura de un píxel.
   * @param {number} r,g,b
   * @param {'frio'|'calido'|null} preferir  desempate cuando el color es ambiguo
   * @returns {{valor:number, distancia:number, ambiguo:boolean, saturado:boolean,
   *            candidatos:Array, preferido:boolean}}
   */
  function leer(r, g, b, preferir = null) {
    const cand = candidatos(r, g, b);
    if (!cand.length) return null;

    let elegido = cand[0];
    let preferido = false;

    if (cand.length > 1 && preferir) {
      // 'frio' = el candidato de valor más bajo; 'calido' = el más alto. En la
      // banda 13 eso es exactamente elegir entre la cola de −80 y la rampa cálida.
      const orden = [...cand].sort((a, b2) => a.valor - b2.valor);
      const q = preferir === 'frio' ? orden[0] : orden[orden.length - 1];
      if (q !== elegido) {
        elegido = q;
        preferido = true;
      }
    }

    return {
      valor: elegido.valor,
      distancia: elegido.distancia,
      ambiguo: cand.length > 1,
      saturado: elegido.saturado,
      candidatos: cand,
      preferido,
    };
  }

  return {
    bandaId,
    tabla: idTabla,
    unidad: t.unidad,
    lectura: t.lectura,
    escala: t.escala,
    minimo: Math.min(...t.escala.map((e) => e.valor)),
    maximo: Math.max(...t.escala.map((e) => e.valor)),
    leer,
    candidatos,
    /** Color de la rampa para un valor dado: sirve para pintar gráficas con la tabla real. */
    colorDe(valor) {
      let mejor = 0;
      let dif = Infinity;
      for (let i = 0; i < n; i++) {
        const v = valorEn(pos(i)).valor;
        const d = Math.abs(v - valor);
        if (d < dif) { dif = d; mejor = i; }
      }
      const c = rampa[mejor];
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    },
  };
}

/** ¿Qué bandas del caso tienen tabla con valores físicos publicados? */
export function bandasMedibles(barras, bandas) {
  return bandas.filter((b) => {
    const id = barras?.bandas?.[b.id];
    return id && barras.tablas?.[id]?.escala?.length;
  });
}
