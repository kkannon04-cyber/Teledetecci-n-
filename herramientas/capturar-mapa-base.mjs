// Guarda en disco las teselas del mapa base de la zona del caso.
//
// Sin esto el visor necesita internet para pintar el fondo: los datos, las bandas
// y los avisos ya están congelados en el proyecto, pero el mapa se quedaría en
// gris. Para entregar el trabajo a alguien —o exponerlo en un aula sin red— hace
// falta que también el fondo viaje dentro de la carpeta.
//
// Solo se bajan los niveles de zoom que usan las escenas (4 a 8) y solo sobre la
// caja del caso: son unos cientos de teselas, no un volcado del servidor. La
// descarga es en serie y con pausa, que es como pide la política de uso de
// OpenTopoMap.
//
// Uso:
//   node herramientas/capturar-mapa-base.mjs
//   node herramientas/capturar-mapa-base.mjs --zmin 4 --zmax 9

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DESTINO = join(RAIZ, 'medios', 'mapa');
const ORIGEN = 'https://a.tile.opentopomap.org';
const ATRIBUCION = '© OpenTopoMap (CC-BY-SA) · datos © OpenStreetMap contributors (ODbL)';

const argumento = (n, pd = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : pd;
};

const aX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const aY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Une dos índices de rangos por zoom quedandose con el rectangulo que los abarca. */
function unir(anterior, nuevos) {
  const salida = { ...anterior };
  for (const [z, r] of Object.entries(nuevos)) {
    const a = anterior[z];
    salida[z] = a
      ? { x: [Math.min(a.x[0], r.x[0]), Math.max(a.x[1], r.x[1])], y: [Math.min(a.y[0], r.y[0]), Math.max(a.y[1], r.y[1])] }
      : r;
  }
  return salida;
}

async function main() {
  const zMin = Number(argumento('zmin', '4'));
  const zMax = Number(argumento('zmax', '8'));

  const caso = JSON.parse(await readFile(join(RAIZ, 'datos', 'caso.json'), 'utf8'));

  // La caja es la de cobertura nacional declarada en el caso —Colombia entera, la
  // misma que recorta las bandas— más un margen. El margen no es decorativo: el
  // mapa ocupa una ventana apaisada, así que Leaflet pide bastante más de lo que
  // encuadra el país, y sin ese colchón el fondo aparece cortado en cuanto alguien
  // mueve el mapa un poco.
  const margen = Number(argumento('margen', '2'));
  const c = caso.cobertura?.caja || caso.satelite?._recorte?.caja;
  const caja = c
    ? { latMin: c.latMin - margen, latMax: c.latMax + margen, lonMin: c.lonMin - margen, lonMax: c.lonMax + margen }
    : { latMin: -13, latMax: 13, lonMin: -85, lonMax: -59 };

  console.log('\n  Caja: lat %s … %s   lon %s … %s',
    caja.latMin.toFixed(2), caja.latMax.toFixed(2), caja.lonMin.toFixed(2), caja.lonMax.toFixed(2));
  console.log('  Zoom %d a %d · origen %s\n', zMin, zMax, ORIGEN);

  // En los zooms bajos la pantalla abarca medio continente aunque el caso sea un
  // corredor —el encuadre inicial sobre la ruta ya llega a los 22 °N— así que hasta
  // el zoom 6 se guarda una caja continental. Son unos cientos de teselas más y son
  // las que evitan que el mapa alejado salga con los bordes en blanco.
  const CONTINENTAL = { latMin: -35, latMax: 25, lonMin: -95, lonMax: -30 };
  const cajaDe = (z) => (z <= 6 ? CONTINENTAL : caja);

  // El índice anterior se lee ANTES de bajar nada, no al final. Al ampliar de la
  // caja de la ruta a la de Colombia el rango no solo crece: se desplaza, y gana
  // teselas por el norte mientras pierde otras por el este que siguen en disco.
  // Se baja la UNIÓN de lo que había y lo que pide la caja nueva, y esa misma
  // unión es la que se escribe en el índice. Así lo indexado y lo que hay en disco
  // siguen siendo lo mismo: si se escribiera la unión sin bajarla, el visor
  // pediría a disco teselas que no existen y se comería un 404 por cada una.
  const rutaIndice = join(DESTINO, 'indice.json');
  let anterior = {};
  if (existsSync(rutaIndice)) {
    try { anterior = JSON.parse(await readFile(rutaIndice, 'utf8')).zooms || {}; } catch { anterior = {}; }
  }

  let bajadas = 0, reusadas = 0, fallidas = 0, bytes = 0;
  const zooms = {};

  for (let z = zMin; z <= zMax; z++) {
    const c = cajaDe(z);
    const previo = anterior[z];
    const x0 = previo ? Math.min(aX(c.lonMin, z), previo.x[0]) : aX(c.lonMin, z);
    const x1 = previo ? Math.max(aX(c.lonMax, z), previo.x[1]) : aX(c.lonMax, z);
    const y0 = previo ? Math.min(aY(c.latMax, z), previo.y[0]) : aY(c.latMax, z); // y crece hacia el sur
    const y1 = previo ? Math.max(aY(c.latMin, z), previo.y[1]) : aY(c.latMin, z);
    zooms[z] = { x: [x0, x1], y: [y0, y1] };
    const total = (x1 - x0 + 1) * (y1 - y0 + 1);
    process.stdout.write(`  z${z}  ${total} teselas  `);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const archivo = join(DESTINO, String(z), String(x), `${y}.png`);
        // La pausa cortés es para el servidor: si la tesela ya está, no hay a quién
        // ser cortés, y esperar 120 ms por cada una convertiría una comprobación
        // instantánea en un minuto largo.
        if (existsSync(archivo)) { reusadas++; process.stdout.write('·'); continue; }
        try {
          const res = await fetch(`${ORIGEN}/${z}/${x}/${y}.png`, {
            headers: { 'User-Agent': 'proyecto-teledeteccion/1.0 (trabajo academico, uso offline)' },
          });
          if (!res.ok) throw new Error(String(res.status));
          const buf = Buffer.from(await res.arrayBuffer());
          await mkdir(dirname(archivo), { recursive: true });
          await writeFile(archivo, buf);
          bajadas++; bytes += buf.length;
          process.stdout.write('#');
        } catch {
          fallidas++;
          process.stdout.write('x');
        }
        await new Promise((r) => setTimeout(r, 120)); // ritmo cortés
      }
    }
    process.stdout.write('\n');
  }

  // El índice deja que el visor sepa QUÉ hay guardado antes de pedirlo. Sin él, la
  // única forma de averiguarlo es pedir la tesela y comerse un 404 por cada una que
  // falte: funciona, porque hay respaldo remoto, pero llena la consola de errores
  // que no son errores y tapa los que sí lo son.
  //
  // Se FUNDE con el índice anterior en vez de sustituirlo, y la fusión es la UNIÓN
  // de los rangos, no el reemplazo. Dos motivos, los dos vividos:
  //
  //   - una pasada sobre un rango parcial de zooms (--zmin 4 --zmax 5) borraría
  //     del índice los niveles que sí están en disco, y el visor los pediría a
  //     internet teniéndolos delante;
  //   - al ampliar la caja de la ruta a la caja de Colombia, el rango se desplaza
  //     más que crecer: gana teselas por el norte y pierde por el este. Las del
  //     este siguen en disco, y sustituir el rango en vez de unirlo las dejaría
  //     fuera del índice, otra vez pidiéndolas a la red sin necesidad.
  await mkdir(DESTINO, { recursive: true });
  await writeFile(
    rutaIndice,
    JSON.stringify(
      { origen: ORIGEN, atribucion: ATRIBUCION, caja, zooms: unir(anterior, zooms), generado: new Date().toISOString() },
      null, 2
    ),
    'utf8'
  );

  await writeFile(
    join(DESTINO, 'LEEME.txt'),
    `Teselas del mapa base guardadas para que el visor funcione sin internet.\n\n` +
      `Origen: ${ORIGEN}\nAtribución: ${ATRIBUCION}\n` +
      `Zoom ${zMin}–${zMax}, caja lat ${caja.latMin.toFixed(2)}…${caja.latMax.toFixed(2)} ` +
      `lon ${caja.lonMin.toFixed(2)}…${caja.lonMax.toFixed(2)}.\n` +
      `Generado el ${new Date().toISOString()} por herramientas/capturar-mapa-base.mjs.\n\n` +
      `El visor las usa primero y solo sale a internet para los niveles de zoom que\n` +
      `no estén aquí. Fuera de esta caja o por encima del zoom ${zMax} hace falta red.\n`,
    'utf8'
  );

  console.log('\n  %d teselas nuevas (%s MB) · %d ya estaban · %d fallidas',
    bajadas, (bytes / 1048576).toFixed(1), reusadas, fallidas);
  console.log('  Guardadas en medios/mapa/\n');
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
