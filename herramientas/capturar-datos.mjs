// Congela METAR, TAF y avisos SIGMET/AIRMET del caso en datos/*.json.
//
// Se ejecuta desde Node, no desde el navegador: así no hay CORS y el caso
// queda guardado en disco, idéntico cada vez que se abra el visor.
//
// Uso:
//   node herramientas/capturar-datos.mjs
//   node herramientas/capturar-datos.mjs --horas 12
//   node herramientas/capturar-datos.mjs --fecha 20260831_1340   (histórico)
//
// La consulta NO se limita a los aeródromos del caso: se pide además todo lo que
// haya dentro de la caja de cobertura nacional declarada en caso.cobertura, para
// que el visor pueda pintar la meteorología de Colombia entera y no solo la de
// los seis aeródromos de la ruta.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATOS = join(RAIZ, 'datos');
const API = 'https://aviationweather.gov/api/data';

function argumento(nombre, pordefecto = null) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : pordefecto;
}

async function pedir(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const texto = await res.text();
  if (!texto.trim()) return [];
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`Respuesta no es JSON válido: ${url}`);
  }
}

/** AAAAMMDD_HHMM de una fecha cualquiera. */
function sello(fecha) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getUTCFullYear()}${p(fecha.getUTCMonth() + 1)}${p(fecha.getUTCDate())}` +
    `_${p(fecha.getUTCHours())}${p(fecha.getUTCMinutes())}`;
}

/**
 * Instantes en los que se consultan los SIGMET.
 *
 * Un SIGMET dura entre dos y seis horas y se emite en cualquier momento: pedir
 * solo la hora de análisis dejaría fuera los avisos que se emiten CON EL VUELO YA
 * EN RUTA, que son justo los que hay que ver al mover la barra de tiempo. Así que
 * se barre la ventana entera del caso cada hora y se funden los resultados.
 */
function instantesSigmet(caso, pasoMin = 60) {
  const ini = new Date(caso.ventanaTiempo?.inicioZ || caso.ventanaTiempo?.horaAnalisisZ);
  const fin = new Date(caso.ventanaTiempo?.finZ || caso.ventanaTiempo?.horaAnalisisZ);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return [];
  const fuera = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += pasoMin * 60000) fuera.push(new Date(t));
  const ultimo = fuera[fuera.length - 1];
  if (!ultimo || ultimo.getTime() !== fin.getTime()) fuera.push(fin);
  return fuera;
}

/** Clave con la que dos consultas distintas reconocen el MISMO aviso. */
const claveSigmet = (a) =>
  [a.isigmetId ?? a.airSigmetId ?? '', a.icaoId ?? '', a.firId ?? '', a.seriesId ?? '',
   a.hazard ?? '', a.validTimeFrom ?? '', a.validTimeTo ?? ''].join('|');

async function guardar(nombre, contenido) {
  const ruta = join(DATOS, nombre);
  await writeFile(ruta, JSON.stringify(contenido, null, 2), 'utf8');
  return ruta;
}

async function main() {
  const caso = JSON.parse(await readFile(join(DATOS, 'caso.json'), 'utf8'));
  const icaos = caso.aerodromos.map((a) => a.icao);
  const lista = icaos.join(',');

  // Caja nacional declarada en el caso. Si no está, se pide solo por
  // identificador: mejor un caso corto que uno con una caja inventada.
  const caja = caso.cobertura?.caja || null;
  if (!caja) console.log('  aviso: caso.cobertura.caja no está declarada; solo se consultan los aeródromos del caso');

  const horas = argumento('horas', '12');
  const fecha = argumento('fecha'); // formato YYYYMMDD_HHMM para consulta histórica

  console.log(`\n  Aeródromos: ${lista}`);
  console.log(`  Ventana METAR: últimas ${horas} h${fecha ? ` desde ${fecha}` : ''}`);
  if (caja) console.log(`  Caja de cobertura: lat ${caja.latMin} … ${caja.latMax}   lon ${caja.lonMin} … ${caja.lonMax}`);
  console.log('');

  const capturadoEn = new Date().toISOString();

  // --- METAR y TAF ---
  // Dos consultas por producto, no una:
  //   - por IDENTIFICADOR, los seis aeródromos del caso. Es la que no puede
  //     fallar: el panel de meteorología y la matriz de alternos dependen de ella.
  //   - por CAJA, todo lo que reporte dentro de la cobertura nacional. Es la que
  //     llena el mapa más allá de la ruta.
  // Se funden por clave para que un aeródromo que aparezca en las dos no salga
  // dos veces. Si la consulta por caja fallara, el caso sigue completo.
  const cajaTexto = caja
    ? `${caja.latMin},${caja.lonMin},${caja.latMax},${caja.lonMax}`
    : null;

  const fundir = (a, b, clave) => {
    const vistos = new Set(a.map(clave));
    return a.concat(b.filter((x) => !vistos.has(clave(x))));
  };
  const claveObs = (o) => `${o.icaoId}|${o.reportTime}|${o.rawOb}`;
  const claveTaf = (t) => `${t.icaoId}|${t.issueTime}|${t.rawTAF}`;

  let urlMetar = `${API}/metar?ids=${lista}&format=json&hours=${horas}`;
  if (fecha) urlMetar += `&date=${fecha}`;
  let metar = await pedir(urlMetar);
  const metarCaso = metar.length;

  let urlMetarCaja = null;
  if (cajaTexto) {
    urlMetarCaja = `${API}/metar?bbox=${cajaTexto}&format=json&hours=${horas}` + (fecha ? `&date=${fecha}` : '');
    try {
      metar = fundir(metar, await pedir(urlMetarCaja), claveObs);
    } catch (e) {
      console.log(`  aviso: la consulta METAR por caja falló (${e.message.split(' — ')[0]}); queda solo la de los seis aeródromos`);
      urlMetarCaja = null;
    }
  }
  console.log(`  METAR   ${String(metar.length).padStart(4)} observaciones (${metarCaso} de los aeródromos del caso, ${new Set(metar.map((m) => m.icaoId)).size} estaciones distintas)`);

  let urlTaf = `${API}/taf?ids=${lista}&format=json`;
  if (fecha) urlTaf += `&date=${fecha}`;
  let taf = await pedir(urlTaf);
  const tafCaso = taf.length;

  let urlTafCaja = null;
  if (cajaTexto) {
    urlTafCaja = `${API}/taf?bbox=${cajaTexto}&format=json` + (fecha ? `&date=${fecha}` : '');
    try {
      taf = fundir(taf, await pedir(urlTafCaja), claveTaf);
    } catch (e) {
      console.log(`  aviso: la consulta TAF por caja falló (${e.message.split(' — ')[0]}); queda solo la de los seis aeródromos`);
      urlTafCaja = null;
    }
  }
  console.log(`  TAF     ${String(taf.length).padStart(4)} pronósticos (${tafCaso} de los aeródromos del caso, ${new Set(taf.map((t) => t.icaoId)).size} estaciones distintas)`);

  // --- SIGMET internacional ---
  // Se barre la ventana completa del caso, no solo la hora de análisis: un aviso
  // emitido a mitad de vuelo es exactamente el que hay que ver al mover la barra
  // de tiempo, y una consulta a una sola hora no lo trae. Los avisos repetidos
  // entre consultas se funden por clave.
  //
  // No se filtran por caja: son pocos y el visor ya los cruza contra la ruta y
  // deja elegir el alcance. Guardarlos todos permite además contrastar el visor
  // contra el mapa del AWC sin volver a la red.
  const instantes = argumento('fecha-sigmet')
    ? [argumento('fecha-sigmet')]
    : instantesSigmet(caso).map(sello);

  const porClave = new Map();
  const urlsSigmet = [];
  let consultasOk = 0;
  for (const inst of instantes) {
    const url = `${API}/isigmet?format=json&date=${inst}`;
    try {
      for (const a of await pedir(url)) if (!porClave.has(claveSigmet(a))) porClave.set(claveSigmet(a), a);
      urlsSigmet.push(url);
      consultasOk++;
    } catch (e) {
      console.log(`  SIGMET  ${inst}Z no disponible (${e.message.split(' — ')[0]})`);
    }
  }
  const sigmet = [...porClave.values()];
  console.log(`  SIGMET  ${String(sigmet.length).padStart(4)} avisos internacionales distintos, de ${consultasOk} consultas entre ${instantes[0]}Z y ${instantes[instantes.length - 1]}Z`);

  // --- PIREP (puede no haber cobertura fuera de EE.UU.) ---
  let pirep = [];
  try {
    pirep = await pedir(`${API}/pirep?format=json&hours=${horas}`);
    console.log(`  PIREP   ${String(pirep.length).padStart(4)} reportes`);
  } catch {
    console.log('  PIREP     0 reportes (sin cobertura en la región)');
  }

  await guardar('metar.json', { capturadoEn, fuente: urlMetar, fuenteCaja: urlMetarCaja, caja, datos: metar });
  await guardar('taf.json', { capturadoEn, fuente: urlTaf, fuenteCaja: urlTafCaja, caja, datos: taf });
  await guardar('sigmet.json', { capturadoEn, fuentes: urlsSigmet, horasConsultadas: instantes, datos: sigmet });
  await guardar('pirep.json', { capturadoEn, datos: pirep });

  // Resumen legible por aeródromo, útil para pegar en el informe.
  console.log('\n  Última observación por aeródromo:\n');
  for (const icao of icaos) {
    const obs = metar
      .filter((m) => m.icaoId === icao)
      .sort((a, b) => new Date(b.reportTime) - new Date(a.reportTime))[0];
    if (obs) {
      console.log(`  ${icao}  [${(obs.fltCat || '—').padEnd(4)}]  ${obs.rawOb}`);
    } else {
      console.log(`  ${icao}  sin datos en la ventana consultada`);
    }
  }

  console.log(`\n  Guardado en datos/ a las ${capturadoEn}\n`);
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
