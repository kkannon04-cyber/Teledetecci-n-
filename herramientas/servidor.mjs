// Servidor estático sin dependencias. Sirve la raíz del proyecto en localhost.
// Uso:  node herramientas/servidor.mjs  [puerto]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PUERTO = Number(process.argv[2]) || 5173;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

/* ---------- Proxy a la API del Aviation Weather Center ----------
   aviationweather.gov no envía cabeceras CORS, así que el navegador no puede
   consultarla directamente desde la página. El servidor la consulta por él y
   devuelve el JSON en el mismo origen. Solo se permiten estas tres rutas y
   siempre contra ese host: no es un proxy abierto. */
const API_AWC = 'https://aviationweather.gov/api/data';
const RUTAS_API = {
  // date=AAAAMMDD_HHMM consulta el estado de los avisos en esa hora, no el actual:
  // es lo que permite analizar un vuelo pasado con los SIGMET que estaban vigentes.
  '/api/sigmet': (p) =>
    `${API_AWC}/isigmet?format=json` +
    (p.get('date') ? `&date=${encodeURIComponent(p.get('date'))}` : '') +
    (p.get('hours') ? `&hours=${encodeURIComponent(p.get('hours'))}` : ''),
  '/api/metar': (p) => `${API_AWC}/metar?ids=${encodeURIComponent(p.get('ids') || '')}&format=json&hours=${encodeURIComponent(p.get('hours') || '3')}`,
  '/api/taf': (p) => `${API_AWC}/taf?ids=${encodeURIComponent(p.get('ids') || '')}&format=json`,
};

async function servirApi(res, ruta, parametros) {
  const construir = RUTAS_API[ruta];
  if (!construir) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Ruta de API no permitida' }));
    return;
  }

  const url = construir(parametros);
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 15000);
  try {
    const arriba = await fetch(url, {
      signal: control.signal,
      headers: { 'User-Agent': 'proyecto-teledeteccion/1.0' },
    });
    const texto = await arriba.text();
    if (!arriba.ok) throw new Error(`${arriba.status} ${arriba.statusText}`);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Fuente': url,
    });
    res.end(texto || '[]');
    // Se registra la URL de arriba entera, no solo la ruta local: es la forma de
    // ver para qué hora se pidieron los avisos cuando el caso no es de ahora.
    console.log(`  API  ${ruta} → ${arriba.status}  ${url}`);
  } catch (err) {
    // Que falle la consulta en vivo no es un error del visor: este responde 502
    // y la página se queda con los datos congelados en datos/.
    console.log(`  API  ${ruta} → falló (${err.message})`);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message, url }));
  } finally {
    clearTimeout(reloj);
  }
}

// Sirve video con soporte de rango, necesario para que el navegador
// pueda buscar dentro de las animaciones de SLIDER sin descargarlas enteras.
async function servirRango(req, res, ruta, tam, tipo) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!m) return false;
  let inicio = m[1] ? Number(m[1]) : 0;
  let fin = m[2] ? Number(m[2]) : tam - 1;
  if (Number.isNaN(inicio) || Number.isNaN(fin) || inicio > fin || fin >= tam) {
    res.writeHead(416, { 'Content-Range': `bytes */${tam}` });
    res.end();
    return true;
  }
  const { createReadStream } = await import('node:fs');
  res.writeHead(206, {
    'Content-Type': tipo,
    'Content-Length': fin - inicio + 1,
    'Content-Range': `bytes ${inicio}-${fin}/${tam}`,
    'Accept-Ranges': 'bytes',
  });
  createReadStream(ruta, { start: inicio, end: fin }).pipe(res);
  return true;
}

const servidor = createServer(async (req, res) => {
  try {
    const peticion = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(peticion.pathname);
    if (rel === '/') rel = '/index.html';

    if (rel.startsWith('/api/')) {
      await servirApi(res, rel, peticion.searchParams);
      return;
    }

    const destino = normalize(join(RAIZ, rel));
    // Impide salir de la carpeta del proyecto con ../
    if (destino !== RAIZ && !destino.startsWith(RAIZ + sep)) {
      res.writeHead(403).end('Prohibido');
      return;
    }

    const info = await stat(destino);
    if (info.isDirectory()) {
      res.writeHead(404).end('No encontrado');
      return;
    }

    const tipo = TIPOS[extname(destino).toLowerCase()] || 'application/octet-stream';
    if (await servirRango(req, res, destino, info.size, tipo)) return;

    const datos = await readFile(destino);
    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': datos.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    res.end(datos);
  } catch (err) {
    if (err.code === 'ENOENT') res.writeHead(404).end('No encontrado');
    else {
      console.error(err);
      res.writeHead(500).end('Error interno');
    }
  }
});

servidor.listen(PUERTO, () => {
  console.log('');
  console.log('  Visor de teledetección en marcha');
  console.log(`  →  http://localhost:${PUERTO}`);
  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});
