// Detección de núcleos fríos sobre la imagen infrarroja.
//
// Es el paso que convierte «se ve una tormenta ahí» en un polígono con una
// temperatura mínima, un área y una vida. Todo lo que hace está declarado y es
// determinista: la misma imagen da el mismo polígono siempre, que es justo lo que
// necesita un caso congelado.
//
// EL PROCEDIMIENTO, en cuatro pasos:
//
//   1. CLASIFICAR cada píxel. La tabla de la banda 13 colorea sin ambigüedad de
//      −30 a −80 °C; fuera de ese tramo es gris, y el gris lo comparten el suelo
//      caliente y la cima de −80 a −90. Se resuelve por CONECTIVIDAD: se inunda el
//      gris desde el borde de la imagen, y el gris al que se llega es suelo. El
//      gris que queda aislado, rodeado de color frío, es la cima del núcleo. No es
//      una heurística de conveniencia: es la estructura física de un cumulonimbo,
//      cuya cima más fría está siempre dentro de su propio yunque.
//   2. UMBRALIZAR por temperatura de brillo.
//   3. AGRUPAR en componentes conexas y quedarse con las que tienen tamaño real.
//   4. CONTORNEAR cada componente y simplificar el trazo.
//
// Lo que NO hace: decidir si el núcleo es granizo, turbulencia o engelamiento. Eso
// es interpretación del analista sobre esta evidencia, y va rotulado como tal.

/* ---------- Tabla de consulta color → temperatura ----------
   Invertir la rampa píxel a píxel serían 192 comparaciones por píxel y 1,1
   millones de píxeles por cuadro. Con una rejilla de 64³ en RGB se hace una vez y
   después cada píxel es una lectura de índice. El error que introduce la rejilla
   —4 niveles por canal— queda muy por debajo del que ya mete el JPEG. */

const BITS = 6;             // 64 niveles por canal
const LADO = 1 << BITS;
const DESPL = 8 - BITS;

/**
 * @param {object} lector  crearLector(...) de radiometria.js
 * @returns {{valor:Float32Array, clase:Uint8Array}}  por celda de la rejilla RGB
 *          clase: 0 = gris ambiguo · 1 = color inequívoco
 */
export function construirTabla(lector) {
  const n = LADO ** 3;
  const valor = new Float32Array(n);     // valor si el color es inequívoco
  const valorFrio = new Float32Array(n); // rama fría del gris ambiguo
  const clase = new Uint8Array(n);

  for (let r = 0; r < LADO; r++) {
    for (let g = 0; g < LADO; g++) {
      for (let b = 0; b < LADO; b++) {
        // Centro de la celda, no su esquina: reparte el error de cuantización.
        const rr = (r << DESPL) + (1 << (DESPL - 1));
        const gg = (g << DESPL) + (1 << (DESPL - 1));
        const bb = (b << DESPL) + (1 << (DESPL - 1));
        const cand = lector.candidatos(rr, gg, bb);
        const i = (r * LADO + g) * LADO + b;
        if (!cand.length) { clase[i] = 0; valor[i] = NaN; valorFrio[i] = NaN; continue; }
        if (cand.length === 1) {
          clase[i] = 1;
          valor[i] = cand[0].valor;
          valorFrio[i] = cand[0].valor;
        } else {
          // Ambiguo: se guardan las dos ramas y decide la conectividad.
          const orden = [...cand].sort((a, c) => a.valor - c.valor);
          clase[i] = 0;
          valor[i] = orden[orden.length - 1].valor;  // rama cálida
          valorFrio[i] = orden[0].valor;             // rama fría
        }
      }
    }
  }
  return { valor, valorFrio, clase };
}

const indiceRGB = (r, g, b) =>
  (((r >> DESPL) * LADO + (g >> DESPL)) * LADO + (b >> DESPL));

/**
 * Campo de temperatura de brillo de un cuadro entero.
 *
 * Devuelve Tb por píxel y una máscara de procedencia, para que nadie confunda un
 * valor resuelto por vecindad con uno leído directamente del color.
 */
/**
 * @param {number} umbralColorFrio   a partir de aquí la tabla colorea sin ambigüedad
 * @param {number} umbralCola        adyacencia exigida para aceptar un gris como cola fría
 *
 * POR QUÉ DOS UMBRALES. La cola gris de la tabla EMPIEZA en −80 °C. Para que un
 * gris encerrado sea de verdad la cima de −85 °C, tiene que estar pegado a color
 * de ESE extremo, no a cualquier color frío. Con un único umbral de −30 °C, una
 * mota gris de compresión perdida dentro de un yunque a −45 °C quedaba tocando
 * «color frío» y se le adjudicaban −88 °C: 43 grados de error inventados por un
 * artefacto del JPEG. Exigir −72 °C de adyacencia lo impide, porque respeta la
 * continuidad de la propia rampa: del color a la cola se pasa por −80, no por −45.
 */
export function campoTb(cuadro, tabla, umbralColorFrio = -30, umbralCola = -72) {
  const { datos, ancho, alto } = cuadro;
  const n = ancho * alto;
  const tb = new Float32Array(n);
  const ambiguo = new Uint8Array(n);      // 1 = el color era gris
  const frioColor = new Uint8Array(n);    // 1 = color frío inequívoco (−30…−80)

  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const idx = indiceRGB(datos[k], datos[k + 1], datos[k + 2]);
    if (tabla.clase[idx] === 1) {
      tb[i] = tabla.valor[idx];
      // `frioColor` marca solo el EXTREMO frío de la rampa de color, que es el
      // único sitio por donde la tabla entra en la cola gris.
      if (tb[i] <= umbralCola) frioColor[i] = 1;
    } else {
      tb[i] = tabla.valor[idx];   // provisional: rama cálida
      ambiguo[i] = 1;
    }
  }

  // Inundación del gris desde el borde: al gris que se alcanza desde fuera se
  // llega por el suelo, así que es suelo. Lo que queda es gris encerrado.
  const alcanzado = new Uint8Array(n);
  const pila = [];
  const meter = (x, y) => {
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return;
    const i = y * ancho + x;
    if (alcanzado[i] || !ambiguo[i]) return;
    alcanzado[i] = 1;
    pila.push(i);
  };
  for (let x = 0; x < ancho; x++) { meter(x, 0); meter(x, alto - 1); }
  for (let y = 0; y < alto; y++) { meter(0, y); meter(ancho - 1, y); }

  while (pila.length) {
    const i = pila.pop();
    const x = i % ancho;
    const y = (i / ancho) | 0;
    meter(x + 1, y); meter(x - 1, y); meter(x, y + 1); meter(x, y - 1);
  }

  // Gris no alcanzado desde el borde: es la cima fría. Se le pone la rama fría,
  // pero SOLO si toca color frío — un gris encerrado por color cálido no es una
  // cima, es un lago o una sombra de la propia tabla.
  let resueltos = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      if (!ambiguo[i] || alcanzado[i]) continue;
      let tocaFrio = false;
      for (let dy = -1; dy <= 1 && !tocaFrio; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= ancho || yy >= alto) continue;
          if (frioColor[yy * ancho + xx]) { tocaFrio = true; break; }
        }
      }
      if (tocaFrio) {
        const k = i * 4;
        tb[i] = tabla.valorFrio[indiceRGB(datos[k], datos[k + 1], datos[k + 2])];
        resueltos++;
      }
    }
  }

  // El gris encerrado que NO tocaba color frío puede estar a dos píxeles de él:
  // una segunda pasada propaga hacia dentro hasta que deja de crecer. Así se
  // resuelve una cima grande sin tener que suponer nada sobre su tamaño.
  let cambios = 1;
  let pasadas = 0;
  while (cambios && pasadas < 12) {
    cambios = 0;
    pasadas++;
    for (let y = 1; y < alto - 1; y++) {
      for (let x = 1; x < ancho - 1; x++) {
        const i = y * ancho + x;
        if (!ambiguo[i] || alcanzado[i] || tb[i] <= umbralColorFrio) continue;
        let vecinoFrio = false;
        for (let dy = -1; dy <= 1 && !vecinoFrio; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * ancho + (x + dx);
            if (tb[j] <= umbralCola) { vecinoFrio = true; break; }
          }
        }
        if (vecinoFrio) {
          const k = i * 4;
          tb[i] = tabla.valorFrio[indiceRGB(datos[k], datos[k + 1], datos[k + 2])];
          cambios++;
          resueltos++;
        }
      }
    }
  }

  return { tb, ambiguo, ancho, alto, grisesResueltos: resueltos };
}

/* ---------- Componentes conexas ---------- */

/**
 * Agrupa los píxeles por debajo del umbral en componentes de 4-vecindad.
 *
 * Se devuelve el mínimo absoluto PERO TAMBIÉN los percentiles, y la severidad
 * debería mirar estos últimos. El mínimo de una componente es el valor de UN
 * píxel, y en el borde de un núcleo el JPEG produce anillos de color que la
 * inversión puede resolver como una cima de −89 °C que no existe. El percentil 5
 * necesita que un 5 % del área esté igual de fría, y eso el ruido no lo fabrica.
 *
 * @returns {{etiqueta:Int32Array, lista:Array}}
 */
export function componentes(campo, umbral, minPixeles = 60) {
  const { tb, ancho, alto } = campo;
  const n = ancho * alto;
  const etiqueta = new Int32Array(n).fill(-1);
  const salida = [];
  const pila = new Int32Array(n);

  for (let s = 0; s < n; s++) {
    if (etiqueta[s] !== -1 || !(tb[s] <= umbral)) continue;
    const id = salida.length;
    let tope = 0;
    pila[tope++] = s;
    etiqueta[s] = id;

    let cuenta = 0;
    let minTb = Infinity;
    let x0 = ancho; let y0 = alto; let x1 = 0; let y1 = 0;
    let sx = 0; let sy = 0;
    const valores = [];

    while (tope) {
      const i = pila[--tope];
      const x = i % ancho;
      const y = (i / ancho) | 0;
      cuenta++;
      sx += x; sy += y;
      valores.push(tb[i]);
      if (tb[i] < minTb) minTb = tb[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;

      const vecinos = [i - 1, i + 1, i - ancho, i + ancho];
      for (let v = 0; v < 4; v++) {
        const j = vecinos[v];
        if (j < 0 || j >= n) continue;
        // Evita saltar de un extremo de la fila al siguiente.
        if ((v === 0 && x === 0) || (v === 1 && x === ancho - 1)) continue;
        if (etiqueta[j] !== -1 || !(tb[j] <= umbral)) continue;
        etiqueta[j] = id;
        pila[tope++] = j;
      }
    }

    if (cuenta >= minPixeles) {
      valores.sort((a, b) => a - b);
      const pct = (p) => valores[Math.min(valores.length - 1, Math.floor((p / 100) * valores.length))];
      salida.push({
        etiqueta: id, pixeles: cuenta, minTb,
        p05: pct(5), p25: pct(25), mediana: pct(50),
        bbox: [x0, y0, x1, y1],
        centro: { x: sx / cuenta, y: sy / cuenta },
      });
    } else {
      // Demasiado pequeña: se desmarca para que no la contornee nadie.
      salida.push(null);
    }
  }

  return { etiqueta, lista: salida.filter(Boolean) };
}

/* ---------- Contorno ----------
   Trazado de Moore: se recorre el borde de la componente girando siempre en el
   mismo sentido. Da el contorno exacto en píxeles, no una envolvente convexa, que
   es lo que permite que el yunque conserve su forma en vez de salir como un óvalo. */

const VECINDAD = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export function contorno(etiquetas, ancho, alto, id) {
  const dentro = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto && etiquetas[y * ancho + x] === id;

  // Primer píxel en orden de barrido.
  let ix = -1; let iy = -1;
  for (let y = 0; y < alto && iy < 0; y++) {
    for (let x = 0; x < ancho; x++) {
      if (etiquetas[y * ancho + x] === id) { ix = x; iy = y; break; }
    }
  }
  if (iy < 0) return [];

  const puntos = [[ix, iy]];
  let cx = ix; let cy = iy;
  let dir = 6; // se entró desde arriba
  const maxPasos = ancho * alto * 4;

  for (let paso = 0; paso < maxPasos; paso++) {
    let siguiente = null;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;   // arranca girando a la izquierda del avance
      const nx = cx + VECINDAD[d][0];
      const ny = cy + VECINDAD[d][1];
      if (dentro(nx, ny)) { siguiente = [nx, ny, d]; break; }
    }
    if (!siguiente) break;
    [cx, cy, dir] = siguiente;
    if (cx === ix && cy === iy && puntos.length > 2) break;
    puntos.push([cx, cy]);
  }
  return puntos;
}

/* ---------- Simplificación ---------- */

/** Douglas-Peucker sobre el contorno en píxeles. */
export function simplificar(puntos, tolerancia = 2) {
  if (puntos.length < 4) return puntos;

  const dist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  const rec = (pts) => {
    if (pts.length < 3) return pts;
    let peor = 0;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > peor) { peor = d; idx = i; }
    }
    if (peor <= tolerancia) return [pts[0], pts[pts.length - 1]];
    return [...rec(pts.slice(0, idx + 1)).slice(0, -1), ...rec(pts.slice(idx))];
  };

  return rec(puntos);
}
