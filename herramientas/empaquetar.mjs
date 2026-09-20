// Comprueba que el proyecto está completo y lo deja en un .zip listo para enviar.
//
// La comprobación es la parte que importa: un .zip pesado no sirve de nada si
// dentro falta un cuadro de satélite o si caso.json apunta a un archivo que no
// existe. Quien lo reciba no va a poder distinguir «no está» de «no carga», así
// que se mira antes de empaquetar.
//
// Uso:
//   node herramientas/empaquetar.mjs
//   node herramientas/empaquetar.mjs --solo-comprobar
//   node herramientas/empaquetar.mjs --destino "C:\\Users\\HP\\Desktop"

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argumento = (n, pd = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : pd;
};
const bandera = (n) => process.argv.includes(`--${n}`);

const MB = (b) => (b / 1048576).toFixed(1);

/** Archivos sin los que el visor no arranca o queda cojo. */
const IMPRESCINDIBLES = [
  'index.html', 'ABRIR.cmd', 'COMO-ABRIR.md', 'LEEME.md',
  'css/estilo.css', 'js/app.js', 'js/mapa.js', 'js/satelite.js', 'js/sigmet.js',
  'js/geoestacionaria.js', 'datos/caso.json', 'datos/metar.json', 'datos/taf.json',
  'datos/sigmet.json', 'datos/fenomenos.geojson', 'informe/informe.md',
  // El análisis derivado: sin la tabla de color no hay temperatura de brillo, y
  // sin ella se apagan el perfil, los tramos y el panel de vuelo.
  'datos/barras-color.json', 'js/radiometria.js', 'js/muestreo.js', 'js/productos.js',
  'js/nucleos.js', 'js/perfil.js', 'js/tramos.js', 'js/vuelo.js',
  'js/decodificar.js', 'js/portada.js', 'js/lateral.js', 'datos/limites-colombia.geojson',
  'informe/Guia-corte-vertical.pdf', 'informe/Guia-EFB.pdf', 'informe/Guia-Tramos.pdf',
  'informe/Briefing-Sustentacion.pdf',
  'informe/asesoria-meteorologo.md',
  'herramientas/servidor.mjs', 'herramientas/servidor.ps1',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];

async function comprobar() {
  const problemas = [];
  const avisos = [];

  for (const f of IMPRESCINDIBLES) {
    if (!existsSync(join(RAIZ, ...f.split('/')))) problemas.push(`falta ${f}`);
  }

  const caso = JSON.parse(await readFile(join(RAIZ, 'datos', 'caso.json'), 'utf8'));

  // Cada cuadro que el caso declara tiene que estar en disco y no estar vacío.
  let cuadros = 0, bytesCuadros = 0;
  for (const b of caso.satelite?.bandas || []) {
    const lista = b.medio?.cuadros || (b.medio?.archivo ? [{ archivo: b.medio.archivo }] : []);
    if (!lista.length) { avisos.push(`${b.id} no tiene medio asociado`); continue; }
    for (const c of lista) {
      const ruta = join(RAIZ, ...c.archivo.split('/'));
      if (!existsSync(ruta)) { problemas.push(`${b.id}: falta ${c.archivo}`); continue; }
      const info = await stat(ruta);
      if (info.size < 2000) problemas.push(`${b.id}: ${c.archivo} pesa ${info.size} B, parece vacío`);
      cuadros++; bytesCuadros += info.size;
    }
    const video = join(RAIZ, 'medios', 'satelite', b.id, 'animacion.webm');
    if (!existsSync(video)) avisos.push(`${b.id} sin animacion.webm`);
  }

  // El mapa base cacheado: sin él el visor pide teselas a internet.
  const mapa = join(RAIZ, 'medios', 'mapa');
  if (!existsSync(mapa)) avisos.push('sin medios/mapa/: el fondo del mapa necesitará internet');

  // Los límites son opcionales para arrancar, pero sin ellos el panel satelital
  // vuelve a ser nubes sobre negro: se avisa, no se bloquea.
  if (!existsSync(join(RAIZ, 'datos', 'limites-colombia.geojson'))) {
    avisos.push('sin datos/limites-colombia.geojson: no se dibujarán la frontera ni los departamentos (rehazlo con herramientas/capturar-limites.mjs)');
  }

  // Sin la tabla de color, el panel satelital sigue funcionando pero deja de decir
  // qué significa cada color, que es la mitad de la lectura de una banda.
  if (!existsSync(join(RAIZ, 'datos', 'barras-color.json'))) {
    avisos.push('sin datos/barras-color.json: el panel satelital no mostrará la escala de color de cada banda (rehazlo con herramientas/capturar-barras.mjs)');
  }

  // Coherencia de fechas: el caso, los datos meteorológicos y las imágenes tienen
  // que hablar del mismo día. Es el error que más caro sale y el más difícil de ver.
  const dia = caso.ventanaTiempo.horaAnalisisZ.slice(0, 10);
  for (const b of caso.satelite?.bandas || []) {
    const malas = (b.medio?.cuadros || []).filter((c) => !c.horaZ.startsWith(dia));
    if (malas.length) problemas.push(`${b.id}: ${malas.length} cuadro(s) de un día distinto al del caso (${dia})`);
  }
  const metar = JSON.parse(await readFile(join(RAIZ, 'datos', 'metar.json'), 'utf8'));
  const enDia = (metar.datos || []).filter((m) => (m.reportTime || '').startsWith(dia)).length;
  if (!enDia) problemas.push(`datos/metar.json no tiene ninguna observación del ${dia}`);

  return { problemas, avisos, caso, cuadros, bytesCuadros, dia, metar: metar.datos?.length || 0, enDia };
}

/**
 * Comprime la carpeta con las clases de compresión de .NET, que están en cualquier
 * Windows: sigue sin añadir dependencias al proyecto, que es la regla de aquí.
 *
 * NO se usa `Compress-Archive`, que es lo primero que uno escribe: con este volumen
 * —223 archivos de imagen y 227 MB— falla con un `PermissionDenied ... IOException`
 * señalando un archivo cualquiera, y además tarda minutos. `ZipFile` hace lo mismo
 * en unos segundos y sin fallar.
 *
 * Se arma entrada a entrada, en vez de con CreateFromDirectory, para poder elegir
 * el nombre de la carpeta raíz DENTRO del zip: así, se descomprima como se
 * descomprima —con el explorador de Windows o con «extraer aquí» de 7-Zip—, todo
 * queda recogido en una carpeta y no desparramado por la de descargas.
 */
function comprimir(destinoZip, raizEnZip) {
  const guion = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$origen = '${RAIZ.replace(/'/g, "''")}'`,
    `$destino = '${destinoZip.replace(/'/g, "''")}'`,
    `$raiz = '${raizEnZip.replace(/'/g, "''")}'`,
    // COMO-ENVIAR.md es para quien envía, no para quien recibe: lo dice en su
    // primera línea y además lleva rutas locales de esta máquina. Fuera del paquete.
    "$excluidos = @('COMO-ENVIAR.md')",
    'if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Force }',
    '$base = (Resolve-Path -LiteralPath $origen).Path.TrimEnd([char]92)',
    "$zip = [System.IO.Compression.ZipFile]::Open($destino, 'Create')",
    'try {',
    '  $n = 0',
    '  Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $excluidos -notcontains $_.Name } | ForEach-Object {',
    '    $rel = $_.FullName.Substring($base.Length + 1).Replace([char]92, [char]47)',
    '    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, "$raiz/$rel", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null',
    '    $n++',
    '  }',
    '  Write-Output "archivos:$n"',
    '} finally { $zip.Dispose() }',
  ].join('; ');

  return new Promise((resolver, rechazar) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', guion], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    let err = '';
    p.stdout.on('data', (d) => { salida += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (c) => (c === 0
      ? resolver(Number((salida.match(/archivos:(\d+)/) || [])[1] || 0))
      : rechazar(new Error(err.trim().split('\n').slice(-3).join(' ') || `código ${c}`))));
  });
}

async function main() {
  console.log('\n  Comprobando el proyecto…\n');
  const r = await comprobar();

  console.log('  Caso            %s → %s, %s', r.caso.ruta.origen, r.caso.ruta.destino, r.caso.ventanaTiempo.horaAnalisisZ);
  console.log('  Bandas          %d, %d cuadros en total (%s MB)', r.caso.satelite.bandas.length, r.cuadros, MB(r.bytesCuadros));
  console.log('  METAR           %d observaciones, %d del %s', r.metar, r.enDia, r.dia);

  if (r.avisos.length) {
    console.log('\n  Avisos:');
    r.avisos.forEach((a) => console.log('    · ' + a));
  }
  if (r.problemas.length) {
    console.log('\n  PROBLEMAS (%d):', r.problemas.length);
    r.problemas.slice(0, 30).forEach((p) => console.log('    ! ' + p));
    if (r.problemas.length > 30) console.log('    … y %d más', r.problemas.length - 30);
    console.log('\n  No se empaqueta con problemas sin resolver.\n');
    process.exit(1);
  }
  console.log('\n  Sin problemas: todo lo que el caso declara está en disco.');

  if (bandera('solo-comprobar')) { console.log(''); return; }

  const carpetaDestino = argumento('destino', dirname(RAIZ));
  if (!existsSync(carpetaDestino)) {
    console.log('\n  La carpeta de destino no existe: %s', carpetaDestino);
    console.log('  (Ojo con el Escritorio: si está sincronizado, suele estar en OneDrive\\Desktop.)\n');
    process.exit(1);
  }
  const nombre = `visor-teledeteccion-${r.caso.ruta.origen}-${r.caso.ruta.destino}-${r.dia.replace(/-/g, '')}.zip`;
  const destinoZip = join(carpetaDestino, nombre);

  console.log('  Comprimiendo en %s …', destinoZip);
  console.log('  (son cientos de MB de JPEG, que ya vienen comprimidos: tarda un rato y el .zip pesará casi lo mismo)\n');
  const archivos = await comprimir(destinoZip, nombre.replace(/\.zip$/, ''));

  const info = await stat(destinoZip);
  console.log('  Listo: %s  (%s MB, %d archivos)', destinoZip, MB(info.size), archivos);
  console.log('  Dentro va todo recogido en la carpeta %s/\n', nombre.replace(/\.zip$/, ''));
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
