// Congela en datos/limites-colombia.geojson la frontera de Colombia y la división
// departamental, para que el visor pueda dibujarlas sobre el mapa y —sobre todo—
// sobre las bandas satelitales.
//
// POR QUÉ HACE FALTA. El panel satelital muestra la rejilla del ABI: nubes sobre
// negro, sin costas ni fronteras. Con la retícula de meridianos basta para situarse
// a vista de país, pero desde que el panel tiene zoom uno se acerca a una célula y
// se queda sin saber sobre qué departamento está. El mapa de la izquierda sí trae
// límites (vienen pintados en las teselas de OpenTopoMap), pero son parte de la
// imagen: no se pueden reproyectar a la geometría del satélite. Por eso hacen falta
// como vectores.
//
// DE DÓNDE SALEN. Natural Earth 1:10 000 000, versión GeoJSON del repositorio
// oficial nvkelso/natural-earth-vector. Es dominio público (CC0) y mantiene los dos
// niveles —países y divisiones de primer orden— como un conjunto coherente: por eso
// la frontera nacional y el contorno exterior de los departamentos coinciden. Se
// probaron antes dos alternativas y se descartaron:
//
//   - IGAC (mapas.igac.gov.co): es la fuente oficial colombiana y sería la
//     preferible, pero su servidor ArcGIS público no expone una capa de límites
//     departamentales; solo regiones de planificación y coberturas municipales
//     sueltas, de las que habría que disolver los departamentos.
//   - geoBoundaries: sirve Colombia, pero toma el país de Wikimedia y los
//     departamentos de OpenStreetMap. Son dos fuentes distintas, así que la línea
//     nacional y la unión de los departamentos no tienen por qué casar, y ese
//     desajuste se vería en pantalla.
//
// LO QUE ESTO NO ES. Natural Earth es cartografía general a 1:10 M: sirve para
// situarse, no para medir ni para resolver cuestiones de límites. Los trazados de
// frontera de un país no son competencia de este proyecto y el archivo lo dice.
//
// Uso:
//   node herramientas/capturar-limites.mjs
//   node herramientas/capturar-limites.mjs --decimales 5

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const PAISES = 'ne_10m_admin_0_countries.geojson';
const DIVISIONES = 'ne_10m_admin_1_states_provinces.geojson';

const argumento = (n, pd = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : pd;
};

async function pedir(nombre) {
  const url = BASE + nombre;
  const res = await fetch(url, { headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('  %s  %s MB', nombre.padEnd(42), (buf.length / 1048576).toFixed(1));
  return { url, datos: JSON.parse(buf.toString('utf8')) };
}

/** Redondea cada coordenada, recorriendo la geometría sea cual sea su anidamiento. */
function redondear(nodo, dec) {
  if (typeof nodo[0] === 'number') return [+nodo[0].toFixed(dec), +nodo[1].toFixed(dec)];
  return nodo.map((n) => redondear(n, dec));
}

const vertices = (g) =>
  g.type === 'Polygon' ? g.coordinates.flat().length : g.coordinates.flat(2).length;

/**
 * Categoría territorial vigente.
 *
 * Natural Earth arrastra `type_es` de una división anterior a 1991: llama
 * «Intendencia» a Arauca, Caquetá, Casanare y Putumayo, y «Comisaría» a Amazonas,
 * Guainía, Guaviare, Vaupés y Vichada. Esas figuras las suprimió la Constitución
 * de 1991 (art. 309), que elevó las nueve a departamento. Se corrige aquí, se deja
 * el valor original en `_tipoFuente` y se explica en la procedencia: publicar
 * «Comisaría del Vaupés» en 2026 sería repetir un dato caducado.
 */
function categoria(p) {
  if (p.iso_3166_2 === 'CO-CUN' && p.name === 'Bogota') return 'Distrito Capital';
  if (!p.name) return 'Territorio insular';
  return 'Departamento';
}

function nombre(p) {
  if (!p.name) return null;
  if (p.name === 'Bogota') return 'Bogotá, D.C.';
  return p.name_es || p.name;
}

async function main() {
  const dec = Number(argumento('decimales', '4'));

  console.log('\n  Descargando Natural Earth 1:10 M …\n');
  const paises = await pedir(PAISES);
  const divisiones = await pedir(DIVISIONES);

  const colombia = paises.datos.features.find((f) => f.properties.ADM0_A3 === 'COL');
  if (!colombia) throw new Error('No aparece Colombia (ADM0_A3=COL) en la capa de países');

  const deps = divisiones.datos.features.filter((f) => f.properties.adm0_a3 === 'COL');
  if (!deps.length) throw new Error('No aparece ningún departamento colombiano en la capa de divisiones');

  const rasgos = [];

  rasgos.push({
    type: 'Feature',
    properties: {
      nivel: 'pais',
      nombre: 'Colombia',
      categoria: 'Frontera nacional',
      _vertices: vertices(colombia.geometry),
    },
    geometry: { type: colombia.geometry.type, coordinates: redondear(colombia.geometry.coordinates, dec) },
  });

  // Orden alfabético, y el rasgo sin nombre —la isla suelta— al final.
  const ordenados = deps.slice().sort((a, b) => (nombre(a.properties) || 'zzz').localeCompare(nombre(b.properties) || 'zzz'));

  for (const f of ordenados) {
    const p = f.properties;
    rasgos.push({
      type: 'Feature',
      properties: {
        nivel: 'departamento',
        nombre: nombre(p),
        categoria: categoria(p),
        iso: p.iso_3166_2 || null,
        _tipoFuente: p.type_es || p.type || null,
        // Punto de rótulo que trae la propia fuente (campos latitude/longitude de
        // Natural Earth). Se conserva tal cual: es dónde el cartógrafo decidió que
        // cabe el nombre, que no es lo mismo que el centroide y suele quedar mejor.
        etiqueta: Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
          ? [+p.latitude.toFixed(dec), +p.longitude.toFixed(dec)]
          : null,
        _nota: p.name ? undefined : `Sin nombre ni departamento asignado en Natural Earth; la fuente la rotula «${p.note}». Por posición (${p.latitude.toFixed(3)}°N ${Math.abs(p.longitude).toFixed(3)}°W) es la isla de Malpelo. Se conserva porque es territorio nacional y cae dentro de la cobertura del caso, pero NO se le atribuye departamento aquí: eso sería añadir un dato que la fuente no trae.`,
        _vertices: vertices(f.geometry),
      },
      geometry: { type: f.geometry.type, coordinates: redondear(f.geometry.coordinates, dec) },
    });
  }

  // Ojo: en esta capa la categoría en español viene en `type`, no en `type_es`,
  // que llega vacío. Filtrar solo por type_es no encontraba nada y la corrección se
  // aplicaba en silencio sin quedar declarada, que es peor que no aplicarla.
  const tipoFuente = (f) => f.properties.type_es || f.properties.type || null;
  const corregidos = ordenados
    .filter((f) => ['Intendencia', 'Comisaría'].includes(tipoFuente(f)))
    .map((f) => `${nombre(f.properties)} (${tipoFuente(f)})`);

  const salida = {
    type: 'FeatureCollection',
    name: 'limites-colombia',
    _procedencia: {
      fuente: 'Natural Earth 1:10 000 000 — ne_10m_admin_0_countries y ne_10m_admin_1_states_provinces',
      urls: [paises.url, divisiones.url],
      licencia: 'Dominio público (Natural Earth, CC0). Sin restricciones de uso ni de redistribución.',
      porQueEstaFuente:
        'Los dos niveles vienen del mismo conjunto, así que la frontera nacional y el contorno exterior de los departamentos coinciden. IGAC, que sería la fuente oficial colombiana, no publica una capa de límites departamentales en su servidor ArcGIS abierto; geoBoundaries sí sirve Colombia pero toma el país de Wikimedia y los departamentos de OpenStreetMap, y ese cruce de fuentes deja un desajuste visible entre ambas líneas.',
      escala: 'Cartografía general a 1:10 M. Sirve para SITUARSE sobre la imagen satelital, no para medir ni para dirimir cuestiones de límites, que no son competencia de este proyecto.',
      precision: `Coordenadas redondeadas a ${dec} decimales de grado (unos ${Math.round(111320 / 10 ** dec)} m), muy por debajo del error propio de la escala de la fuente.`,
      correccionAplicada: corregidos.length
        ? `Natural Earth arrastra la división anterior a 1991 y llama Intendencia o Comisaría a ${corregidos.length} territorios: ${corregidos.join(', ')}. La Constitución de 1991 (art. 309) suprimió ambas figuras y las elevó a departamento, así que aquí figuran como Departamento. El valor original queda en _tipoFuente de cada rasgo.`
        : 'Ninguna.',
      capturado: new Date().toISOString(),
      generadoPor: 'herramientas/capturar-limites.mjs',
    },
    features: rasgos,
  };

  const ruta = join(RAIZ, 'datos', 'limites-colombia.geojson');
  const texto = JSON.stringify(salida);
  await writeFile(ruta, texto, 'utf8');

  const totalVert = rasgos.reduce((s, f) => s + f.properties._vertices, 0);
  console.log('\n  Colombia + %d divisiones · %d vértices · %s KB',
    rasgos.length - 1, totalVert, (Buffer.byteLength(texto) / 1024).toFixed(0));
  if (corregidos.length) console.log('  Categoría corregida en %d territorios (Intendencia/Comisaría → Departamento).', corregidos.length);
  const sinNombre = rasgos.filter((f) => f.nivel !== 'pais' && !f.properties.nombre).length;
  if (sinNombre) console.log('  %d rasgo(s) sin nombre en la fuente, conservados y anotados.', sinNombre);
  console.log('  Guardado en datos/limites-colombia.geojson\n');
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
