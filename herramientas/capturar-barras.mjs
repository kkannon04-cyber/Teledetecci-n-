// Congela las barras de color con las que SLIDER renderiza cada banda, y extrae de
// ellas una leyenda que el visor pueda dibujar a cualquier tamaño.
//
// POR QUÉ. Las imágenes de medios/satelite/ no son radiancias: son el producto ya
// renderizado por SLIDER, que aplica a cada banda una tabla de color distinta. Sin
// esa tabla, «la nube sale roja» no significa nada. Con ella significa «tope a unos
// −70 °C», que es un dato operacional.
//
// DE DÓNDE SALE. Del propio SLIDER. `define-products.js` declara qué tabla usa cada
// producto (`color_table_name`) y el servidor publica la barra correspondiente en
//   /data/color_bar/{satelite}/color_bar_1920_{tabla}.png
// Son PNG de 1920×12 px con la rampa y sus valores rotulados. Se guardan tal cual en
// medios/satelite/barras/ —son la evidencia— y además se extrae de ellas:
//
//   - la RAMPA de color, muestreando la fila 0, que es la única sin tinta de rótulo;
//   - la posición de cada MARCA, detectada comparando las dos filas de abajo contra
//     la fila 0: donde difieren hay tinta, y por debajo de la fila 9 la única tinta
//     que hay son las marcas, no los números. De esa tinta se conservan solo los
//     grupos de 2 o 3 px, que es lo que mide una marca: los de 1 px son el rabo de
//     la «p» de «Temperature» y los de 5 px, el paréntesis de «(deg C)».
//
// Los VALORES de esas marcas se declaran abajo, transcritos de la propia barra, y el
// número de valores tiene que cuadrar con el número de marcas detectadas: si no
// cuadra, la barra queda sin escala numérica en vez de inventarse una.
//
// Uso:
//   node herramientas/capturar-barras.mjs
//   node herramientas/capturar-barras.mjs --satelite goes-19

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DESTINO = join(RAIZ, 'medios', 'satelite', 'barras');
const SLIDER = 'https://rammb-slider.cira.colostate.edu';

const argumento = (n, pd = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : pd;
};

/**
 * Qué tabla usa cada banda. Sale de `color_table_name` en el define-products.js de
 * SLIDER; se comprueba contra el servidor en cada ejecución.
 */
const TABLA_DE_BANDA = {
  band_01: 'lowlight4',
  band_02: 'lowlight4',
  band_04: 'cirrusband',
  band_05: 'cirrusband',
  band_07: 'svgair2',
  band_09: 'svgawvx',
  band_10: 'svgawvx',
  band_13: 'ircimss2',
};

/**
 * Valores rotulados en cada barra, en orden de izquierda a derecha, transcritos de
 * la imagen publicada. No se interpolan ni se completan: si la detección de marcas
 * no encuentra exactamente esta cantidad, la barra se guarda SIN escala.
 *
 * lowlight4 y cirrusband no llevan ninguno: son rampas de gris sin valores
 * publicados, porque una banda reflectiva no mide temperatura sino reflectancia, y
 * SLIDER no publica su calibración.
 */
const VALORES = {
  lowlight4: { unidad: null, valores: [] },
  cirrusband: { unidad: null, valores: [] },
  svgair2: { unidad: '°C', valores: [120, 90, 60, 50, 40, 30, 20, 10, 0, -10, -20, -30, -40, -50, -60, -70] },
  svgawvx: { unidad: '°C', valores: [5, 0, -5, -10, -15, -20, -25, -30, -40, -50, -60, -70, -80] },
  ircimss2: { unidad: '°C', valores: [40, 30, 20, 10, 0, -10, -20, -30, -40, -50, -60, -70, -80, -90] },
};

/**
 * Cómo se lee cada tabla. Es lo único de este archivo que no sale de un píxel: es
 * interpretación, y por eso va en su propio campo y no mezclado con la escala.
 * Los umbrales que se citan están leídos de la barra, no supuestos.
 */
const LECTURA = {
  lowlight4:
    'Escala de gris, sin valores publicados: es reflectancia, no temperatura. Oscuro = poca luz reflejada (mar, selva); claro = mucha (nube densa, arena). Solo sirve de día.',
  cirrusband:
    'Escala de gris, sin valores publicados. En estas dos bandas lo que hay que mirar no es el tono sino QUÉ sale claro: a 1,37 µm solo el hielo alto; a 1,6 µm la gota de agua líquida, mientras el hielo se oscurece.',
  svgair2:
    'Blanco en el extremo cálido (+120 a +40 °C: focos de calor y suelo al sol), rampa de gris de +40 a 0, negro hacia −10 y −20 °C, y de ahí verde azulado y cian a medida que se enfría, hasta −70 °C. De noche los estratos bajos contrastan con el suelo porque emiten distinto a 3,9 y a 10,3 µm; de día la banda mezcla emisión térmica y reflexión solar.',
  svgawvx:
    'Es la temperatura de brillo de la capa de vapor, y se lee al revés de lo que parece: CÁLIDO significa que la radiación sale de niveles bajos, o sea aire SECO por encima; FRÍO significa columna húmeda o nube. Amarillo (+5 a 0 °C) y rojo (−5 a −15) = aire seco; naranja (−20) y rojo muy oscuro a negro (−25) = transición; gris (−30) que aclara hasta blanco (−40) = húmedo; azul (−50) = muy húmedo o nube media; verde (−60) y rojo (−70) = nube alta; amarillo otra vez (−80) = los topes más fríos.',
  ircimss2:
    'Temperatura del tope de nube. De +40 a −30 °C es una rampa de GRIS —suelo, mar y nube baja— y el COLOR empieza exactamente en −30 °C, que es lo que la hace útil de un vistazo: cian −30, azul −40, verde −50, amarillo −60, naranja y rojo −65 a −75, negro −80, y gris que aclara hasta blanco en −90 °C. Por debajo de −60 °C hay convección profunda con probable granizo, turbulencia severa y actividad eléctrica; a FL210 nada de eso se sobrevuela.',
};

async function pedir(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function resolverPlaywright() {
  const cache = join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
  const candidatos = [RAIZ];
  if (existsSync(cache)) for (const d of readdirSync(cache)) candidatos.push(join(cache, d, 'node_modules'));
  for (const base of candidatos) {
    try { return createRequire(join(base, 'x.js'))('playwright'); } catch { /* sigue */ }
  }
  throw new Error('No se encontró Playwright. Instálalo con: npx playwright install chromium');
}

/** Comprueba contra SLIDER que la tabla declarada para cada banda sigue siendo esa. */
async function comprobarTablas() {
  const js = (await pedir(`${SLIDER}/js/define-products.js`)).toString('utf8');
  const discrepancias = [];
  for (const [banda, tabla] of Object.entries(TABLA_DE_BANDA)) {
    const i = js.indexOf(`"${banda}": {`);
    if (i < 0) { discrepancias.push(`${banda}: no aparece en define-products.js`); continue; }
    const real = (js.slice(i, i + 1600).match(/"color_table_name":\s*"([^"]+)"/) || [])[1];
    if (real !== tabla) discrepancias.push(`${banda}: SLIDER usa «${real}» y aquí figura «${tabla}»`);
  }
  return discrepancias;
}

async function main() {
  const satelite = argumento('satelite', 'goes-19');
  await mkdir(DESTINO, { recursive: true });

  console.log('\n  Comprobando contra SLIDER qué tabla usa cada banda…');
  const discrepancias = await comprobarTablas();
  if (discrepancias.length) {
    console.log('  AVISO — la asignación banda→tabla ya no coincide con SLIDER:');
    discrepancias.forEach((d) => console.log('    ' + d));
    console.log('  Se continúa, pero hay que revisar TABLA_DE_BANDA antes de fiarse de la leyenda.\n');
  } else {
    console.log('  Coincide en las ocho bandas.\n');
  }

  const { chromium } = resolverPlaywright();
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  await pagina.goto('about:blank');

  const tablas = {};
  try {
    for (const nombre of [...new Set(Object.values(TABLA_DE_BANDA))]) {
      const url = `${SLIDER}/data/color_bar/${satelite}/color_bar_1920_${nombre}.png`;
      const png = await pedir(url);
      await writeFile(join(DESTINO, `${nombre}.png`), png);

      const medido = await pagina.evaluate(async ({ b64, muestras }) => {
        const img = new Image();
        await new Promise((ok, mal) => { img.onload = ok; img.onerror = () => mal(new Error('PNG ilegible')); img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const px = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };

        // Rampa: fila 0, la única sin tinta de rótulo en ninguna de las cinco barras.
        const rampa = [];
        for (let i = 0; i < muestras; i++) {
          const x = Math.round((i * (c.width - 1)) / (muestras - 1));
          rampa.push(px(x, 0));
        }

        // Marcas: columnas donde las dos filas de abajo se apartan de la rampa. Los
        // números ocupan las filas de en medio y no llegan aquí, así que lo que se
        // detecta son las marcas y nada más.
        const dif = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        const cols = [];
        for (let x = 0; x < c.width; x++) {
          const base = px(x, 0);
          if (dif(px(x, c.height - 1), base) > 120 || dif(px(x, c.height - 2), base) > 120) cols.push(x);
        }
        const grupos = [];
        let ini = null, prev = null;
        const cerrar = () => { if (ini !== null) grupos.push([ini, prev]); };
        for (const x of cols) {
          if (ini === null) { ini = x; prev = x; continue; }
          if (x - prev > 4) { cerrar(); ini = x; }
          prev = x;
        }
        cerrar();

        // Una marca mide 2 px. Lo de 1 px es el rabo de la «p» de «Temperature» y lo
        // de 5 px, el paréntesis de «(deg C)»: descartarlos por anchura es lo que
        // hace que el recuento cuadre con los valores transcritos.
        const marcas = grupos
          .filter(([a, b]) => b - a + 1 >= 2 && b - a + 1 <= 3)
          .map(([a, b]) => (a + b) / 2);
        const descartados = grupos.length - marcas.length;

        return { ancho: c.width, alto: c.height, rampa, marcas, descartados };
      }, { b64: png.toString('base64'), muestras: 192 });

      const esperados = VALORES[nombre]?.valores || [];
      const cuadra = esperados.length === medido.marcas.length;

      tablas[nombre] = {
        archivo: `medios/satelite/barras/${nombre}.png`,
        urlFuente: url,
        ancho: medido.ancho,
        alto: medido.alto,
        rampa: medido.rampa,
        unidad: esperados.length ? VALORES[nombre].unidad : null,
        // Cada marca, con su posición relativa en la barra (0 a 1) y su valor.
        escala: cuadra
          ? medido.marcas.map((x, i) => ({ pos: +(x / (medido.ancho - 1)).toFixed(5), valor: esperados[i] }))
          : [],
        lectura: LECTURA[nombre],
        _escalaSinDeclarar: esperados.length === 0
          ? 'Esta tabla no lleva valores rotulados en la barra publicada: es una rampa de gris de reflectancia, no de temperatura.'
          : cuadra
            ? undefined
            : `NO SE PUBLICA ESCALA: se detectaron ${medido.marcas.length} marcas en la barra y la transcripción declara ${esperados.length} valores. Al no cuadrar, se prefiere quedarse sin escala numérica antes que asignar valores a marcas que quizá no son las que se leyeron.`,
      };

      console.log('  %s  %d marcas detectadas (%d trozos de texto descartados) · %s',
        nombre.padEnd(12), medido.marcas.length, medido.descartados,
        esperados.length === 0 ? 'rampa de gris, sin escala numérica'
          : cuadra ? `escala de ${esperados[0]} a ${esperados[esperados.length - 1]} ${VALORES[nombre].unidad}`
            : `SIN ESCALA (se esperaban ${esperados.length} valores)`);
    }
  } finally {
    await navegador.close();
  }

  const salida = {
    _procedencia: {
      fuente: `CIRA/RAMMB SLIDER — barras de color publicadas en ${SLIDER}/data/color_bar/${satelite}/`,
      queEs: 'La tabla de color con la que SLIDER renderiza cada banda. Las imágenes de medios/satelite/ son ese producto ya renderizado, no radiancias calibradas: sin esta tabla, el color de una nube no es un dato.',
      comoSeObtuvo: 'La rampa se muestrea de la fila 0 del PNG publicado, que es la única sin tinta de rótulo. Las marcas se detectan comparando las dos filas inferiores contra esa fila 0. Los valores de las marcas están TRANSCRITOS de la propia barra y solo se publican si su número coincide con el de marcas detectadas.',
      limite: 'Sirve para leer estructuras y comparar bandas entre sí. Para temperaturas de brillo con exactitud harían falta los ficheros NetCDF del ABI, no el producto renderizado.',
      satelite,
      discrepanciasConSlider: discrepancias.length ? discrepancias : 'ninguna: la asignación banda→tabla coincide con define-products.js',
      capturado: new Date().toISOString(),
      generadoPor: 'herramientas/capturar-barras.mjs',
    },
    bandas: TABLA_DE_BANDA,
    tablas,
  };

  const ruta = join(RAIZ, 'datos', 'barras-color.json');
  await writeFile(ruta, JSON.stringify(salida), 'utf8');
  console.log('\n  Guardado en datos/barras-color.json y medios/satelite/barras/\n');
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
