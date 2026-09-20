// Muestreo de píxeles de las bandas congeladas.
//
// El panel satelital enseña las imágenes; esto las LEE. Carga el cuadro que toca
// en un lienzo fuera de pantalla, saca su ImageData una sola vez y desde ahí
// responde consultas por latitud y longitud pasando por la proyección
// geoestacionaria, que es la misma que usa el calco.
//
// Todo sale de disco: los cuadros son los que capturó herramientas/capturar-satelite.mjs
// y están declarados cuadro a cuadro en caso.json. No se pide nada a la red, así
// que el mismo instante da el mismo píxel en cada reproducción del caso.
//
// La caché no es un lujo. El perfil de la ruta muestrea 200 puntos por banda y por
// hora, y el corte vertical vuelve a pedirlos al mover la barra de tiempo: sin
// guardar el ImageData se decodificaría el JPEG entero cada vez.

import { crearProyector } from './geoestacionaria.js';

const cacheCuadros = new Map();   // archivo → {datos, ancho, alto}
const cacheProyectores = new Map(); // bandaId → proyector

/** Cuadro de la secuencia más cercano a una hora. null si la banda no es secuencia. */
export function cuadroEn(banda, fecha) {
  const m = banda?.medio;
  if (m?.tipo !== 'secuencia' || !m.cuadros?.length) return null;
  let mejor = m.cuadros[0];
  let dif = Infinity;
  for (const c of m.cuadros) {
    const d = Math.abs(new Date(c.horaZ) - fecha);
    if (d < dif) { dif = d; mejor = c; }
  }
  return mejor;
}

/**
 * Carga un cuadro y devuelve sus píxeles.
 *
 * Se usa createImageBitmap + OffscreenCanvas cuando existen —decodifica fuera del
 * hilo principal y no bloquea la interfaz al arrastrar la barra de tiempo— y se
 * cae a <img> + <canvas> si el navegador no los trae.
 */
export async function cargarCuadro(archivo) {
  if (cacheCuadros.has(archivo)) return cacheCuadros.get(archivo);

  const pendiente = (async () => {
    const res = await fetch(archivo);
    if (!res.ok) throw new Error(`No se pudo leer ${archivo} (${res.status})`);
    const blob = await res.blob();

    let ancho;
    let alto;
    let ctx;

    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
      const bmp = await createImageBitmap(blob);
      ancho = bmp.width;
      alto = bmp.height;
      const lienzo = new OffscreenCanvas(ancho, alto);
      ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
    } else {
      const url = URL.createObjectURL(blob);
      const img = await new Promise((ok, mal) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => mal(new Error(`Imagen ilegible: ${archivo}`));
        i.src = url;
      });
      ancho = img.naturalWidth;
      alto = img.naturalHeight;
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;
      ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    }

    const datos = ctx.getImageData(0, 0, ancho, alto).data;
    return { datos, ancho, alto };
  })();

  cacheCuadros.set(archivo, pendiente);
  const listo = await pendiente;
  cacheCuadros.set(archivo, listo);
  return listo;
}

function proyectorDe(caso, banda) {
  if (!cacheProyectores.has(banda.id)) {
    cacheProyectores.set(banda.id, crearProyector(caso.satelite?._recorte?.proyeccion, banda.geo));
  }
  return cacheProyectores.get(banda.id);
}

/**
 * Lienzo de consulta sobre un cuadro ya cargado.
 *
 * Devuelve funciones que trabajan en píxeles de la imagen REAL, no del recorte
 * declarado: si el JPEG guardado tuviera otro tamaño que `geo`, la escala se
 * corrige aquí y nadie más se entera.
 */
export function crearSonda(caso, banda, cuadro) {
  const proy = proyectorDe(caso, banda);
  if (!proy || !cuadro) return null;

  const escalaX = cuadro.ancho / banda.geo.ancho;
  const escalaY = cuadro.alto / banda.geo.alto;
  const { datos, ancho, alto } = cuadro;

  /** RGB en un píxel de la imagen. null fuera del lienzo. */
  function rgbEnPixel(px, py) {
    const x = Math.round(px);
    const y = Math.round(py);
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return null;
    const k = (y * ancho + x) * 4;
    return [datos[k], datos[k + 1], datos[k + 2]];
  }

  /** lat/lon → píxel de la imagen. null si el satélite no ve ese punto. */
  function aPixel(lat, lon) {
    const p = proy(lat, lon);
    if (!p) return null;
    return { x: p.x * escalaX, y: p.y * escalaY };
  }

  return {
    ancho,
    alto,
    aPixel,
    rgbEnPixel,
    /** RGB en una coordenada geográfica. */
    rgbEn(lat, lon) {
      const p = aPixel(lat, lon);
      return p ? rgbEnPixel(p.x, p.y) : null;
    },
    /**
     * Ventana cuadrada de lado (2·radio+1) píxeles alrededor de un punto.
     * Es lo que permite desambiguar un gris por su vecindad y calcular
     * estadísticos de área en vez de fiarlo todo a un único píxel.
     */
    ventanaEn(lat, lon, radio = 3) {
      const p = aPixel(lat, lon);
      if (!p) return [];
      const out = [];
      for (let dy = -radio; dy <= radio; dy++) {
        for (let dx = -radio; dx <= radio; dx++) {
          const c = rgbEnPixel(p.x + dx, p.y + dy);
          if (c) out.push(c);
        }
      }
      return out;
    },
  };
}

/** Carga el cuadro que corresponde a una hora y devuelve su sonda lista. */
export async function sondaEn(caso, banda, fecha) {
  const c = cuadroEn(banda, fecha);
  if (!c) return null;
  const cuadro = await cargarCuadro(c.archivo);
  const sonda = crearSonda(caso, banda, cuadro);
  return sonda ? { ...sonda, archivo: c.archivo, horaZ: c.horaZ } : null;
}

/** Para que el informe pueda declarar cuánta imagen se ha leído de verdad. */
export const cuadrosEnCache = () => cacheCuadros.size;
