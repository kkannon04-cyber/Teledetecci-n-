// Proyección geoestacionaria del GOES-R, en el navegador.
//
// Las imágenes del panel satelital son recortes del disco completo de GOES-19 en
// la rejilla fija del ABI: no son un mapa, son lo que ve el satélite desde su
// órbita. Sin esto, dos bandas preciosas al lado del mapa no dicen QUÉ trozo de
// mundo son ni por dónde va el avión dentro de ellas.
//
// Es la misma fórmula que usa herramientas/capturar-satelite.mjs para recortar,
// repetida aquí para el sentido contrario: dado un punto de la ruta, ¿en qué
// píxel de esta imagen cae? Los parámetros vienen del propio caso
// (satelite._recorte.proyeccion), no escritos a mano, así que si algún día se
// recaptura con otro satélite o meridiano, esto sigue cuadrando.

const RAD = Math.PI / 180;

/**
 * Construye el conversor para una banda concreta.
 * @param {object} proyeccion  satelite._recorte.proyeccion del caso
 * @param {object} geo         banda.geo: ventana de píxeles dentro del disco
 */
export function crearProyector(proyeccion, geo) {
  if (!proyeccion || !geo) return null;

  const { lonSat, borde, radioEcuatorial: rEq, radioPolar: rPol, alturaSatelite: H } = proyeccion;
  const e2 = 1 - (rPol * rPol) / (rEq * rEq);
  const lon0 = lonSat * RAD;

  /** lat/lon en grados → píxel dentro del recorte. null si el satélite no lo ve. */
  return function aPixel(latGrados, lonGrados) {
    const lat = latGrados * RAD;
    const lon = lonGrados * RAD;

    const latGeo = Math.atan(((rPol * rPol) / (rEq * rEq)) * Math.tan(lat));
    const rc = rPol / Math.sqrt(1 - e2 * Math.cos(latGeo) ** 2);

    const sx = H - rc * Math.cos(latGeo) * Math.cos(lon - lon0);
    const sy = -rc * Math.cos(latGeo) * Math.sin(lon - lon0);
    const sz = rc * Math.sin(latGeo);

    // Al otro lado del planeta: el satélite no lo ve.
    if (H * (H - sx) < sy * sy + ((rEq * rEq) / (rPol * rPol)) * sz * sz) return null;

    const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz));
    const y = Math.atan(sz / sx);

    return {
      x: ((x + borde) / (2 * borde)) * geo.lado - geo.x0,
      y: ((borde - y) / (2 * borde)) * geo.lado - geo.y0,
    };
  };
}

/**
 * El camino de vuelta: píxel del recorte → latitud y longitud.
 *
 * Hace falta desde que el panel satelital tiene zoom. La retícula rotula sus
 * meridianos y paralelos en el primer punto visible de cada línea, y al acercarse
 * esos rótulos se van fuera de pantalla: uno acaba mirando una célula convectiva
 * preciosa sin saber sobre qué departamento está. Con esto el panel puede decir
 * qué coordenadas tiene delante en todo momento.
 *
 * Es la inversa exacta de crearProyector, no una aproximación: se resuelve la
 * misma cuadrática del GOES-R PUG (vol. 3, §5.1.2.8) que usa el capturador.
 */
export function crearInversor(proyeccion, geo) {
  if (!proyeccion || !geo) return null;

  const { lonSat, borde, radioEcuatorial: rEq, radioPolar: rPol, alturaSatelite: H } = proyeccion;
  const razon = (rEq * rEq) / (rPol * rPol);
  const lon0 = lonSat * RAD;

  /** Píxel dentro del recorte → {lat, lon} en grados. null si cae fuera del disco. */
  return function aLatLon(px, py) {
    const x = ((px + geo.x0) / geo.lado) * 2 * borde - borde;
    const y = borde - ((py + geo.y0) / geo.lado) * 2 * borde;

    const a = Math.sin(x) ** 2 + Math.cos(x) ** 2 * (Math.cos(y) ** 2 + razon * Math.sin(y) ** 2);
    const b = -2 * H * Math.cos(x) * Math.cos(y);
    const c = H * H - rEq * rEq;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null; // la visual no corta la Tierra: fuera del disco

    const rs = (-b - Math.sqrt(disc)) / (2 * a);
    const sx = rs * Math.cos(x) * Math.cos(y);
    const sy = -rs * Math.sin(x);
    const sz = rs * Math.cos(x) * Math.sin(y);

    return {
      lat: Math.atan(razon * (sz / Math.sqrt((H - sx) ** 2 + sy * sy))) / RAD,
      lon: (lon0 - Math.atan(sy / (H - sx))) / RAD,
    };
  };
}

/** ¿Cae el punto dentro del recorte, con margen de tolerancia en píxeles? */
export const dentro = (p, geo, margen = 0) =>
  p && p.x >= -margen && p.y >= -margen && p.x <= geo.ancho + margen && p.y <= geo.alto + margen;
