// Matriz de decisión del aeropuerto alterno y bitácora operacional.
// Los pesos son editables en vivo: mover uno recalcula el ganador al instante.

import { bus, $, esc, distanciaNM, colorCat, fechaHoraZ, aFecha } from './util.js';
import { categoriaEn } from './metar.js';
import { centrarEn } from './mapa.js';

let caso = null;
let pesos = {};
let horaEvaluacion = null;

export function iniciarDecision(datosCaso) {
  caso = datosCaso;
  for (const c of caso.alternos.criterios) pesos[c.id] = c.peso;

  horaEvaluacion = aFecha(caso.vuelo.etaZ);
  bus.on('tiempo', ({ fecha }) => {
    horaEvaluacion = fecha;
    pintar();
  });
  pintar();
}

/** Puntuación 0–10 del criterio meteorológico a partir de la categoría vigente. */
function puntajeMeteo(icao) {
  return { VFR: 10, MVFR: 6, IFR: 2, LIFR: 0, ND: 5 }[categoriaEn(icao, horaEvaluacion)] ?? 5;
}

function filas() {
  const destino = caso.aerodromos.find((a) => a.icao === caso.ruta.destino);
  const alternos = caso.aerodromos.filter((a) => a.rol === 'alterno');
  const pesoTotal = Object.values(pesos).reduce((s, p) => s + p, 0) || 1;

  return alternos
    .map((alt) => {
      const base = caso.alternos.evaluacion[alt.icao] || {};
      // El criterio meteorológico se recalcula con el METAR de la hora seleccionada,
      // no se toma del JSON: es el que cambia al mover la barra de tiempo.
      const puntajes = { ...base, meteo: puntajeMeteo(alt.icao) };
      const total = caso.alternos.criterios.reduce(
        (s, c) => s + (puntajes[c.id] ?? 0) * (pesos[c.id] / pesoTotal),
        0
      );
      return {
        alt,
        puntajes,
        total,
        cat: categoriaEn(alt.icao, horaEvaluacion),
        nm: destino ? Math.round(distanciaNM(destino, alt)) : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function pintar() {
  const datos = filas();
  const ganador = datos[0];
  const criterios = caso.alternos.criterios;

  const controlesPeso = `
    <div class="pesos">
      <div class="grupo-titulo">Pesos de los criterios</div>
      ${criterios
        .map(
          (c) => `
        <div class="peso-fila" title="${esc(c.descripcion)}">
          <label for="peso-${esc(c.id)}">${esc(c.nombre)}</label>
          <input type="range" id="peso-${esc(c.id)}" data-peso="${esc(c.id)}"
                 min="0" max="50" step="5" value="${pesos[c.id]}" />
          <span class="val" id="val-${esc(c.id)}">${pesos[c.id]}</span>
        </div>`
        )
        .join('')}
    </div>`;

  const tabla = `
    <table class="matriz">
      <thead>
        <tr>
          <th style="text-align:left">Alterno</th>
          <th>Cat.</th>
          ${criterios.map((c) => `<th title="${esc(c.nombre)}">${esc(c.nombre.split(' ')[0].slice(0, 6))}</th>`).join('')}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${datos
          .map(
            (d, i) => `
          <tr class="${i === 0 ? 'ganador' : ''}" data-icao="${esc(d.alt.icao)}" style="cursor:pointer">
            <td class="icao-col">${esc(d.alt.icao)}<div style="font-size:9.5px;color:var(--muy-tenue);font-weight:400">${d.nm != null ? d.nm + ' NM' : ''}</div></td>
            <td><span style="color:${colorCat(d.cat)};font-family:var(--mono);font-size:10px;font-weight:700">${esc(d.cat)}</span></td>
            ${criterios.map((c) => `<td>${d.puntajes[c.id] ?? '—'}</td>`).join('')}
            <td class="total">${d.total.toFixed(1)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  const seleccion = caso.alternos.seleccionado || ganador?.alt.icao;
  const adSel = caso.aerodromos.find((a) => a.icao === seleccion);

  const bitacora = `
    <div class="grupo-titulo" style="margin-top:20px">Bitácora de decisión</div>
    <div class="tarjeta">
      <div class="tarjeta-cab">
        <span class="icao">${esc(seleccion || '—')}</span>
        <span class="rol">alterno seleccionado</span>
        <span class="cat cat-${esc(ganador?.cat || 'ND')}">${esc(ganador?.cat || 'ND')}</span>
      </div>
      <div class="campos">
        <div><div class="campo-etq">Evaluado a</div><div class="campo-val">${esc(fechaHoraZ(horaEvaluacion))}</div></div>
        <div><div class="campo-etq">Distancia</div><div class="campo-val">${ganador?.nm != null ? ganador.nm + ' NM' : '—'}</div></div>
        <div><div class="campo-etq">Pista</div><div class="campo-val">${adSel ? esc(adSel.pistas[0].longitudFt.toLocaleString('es') + ' ft') : '—'}</div></div>
        <div><div class="campo-etq">Aproximación</div><div class="campo-val" style="font-size:10.5px">${adSel ? esc(adSel.ayudas[0]) : '—'}</div></div>
        <div><div class="campo-etq">Horario</div><div class="campo-val">${adSel ? esc(adSel.horario) : '—'}</div></div>
        <div><div class="campo-etq">Comb. alterno</div><div class="campo-val">${esc(caso.bitacora.combustibleAlterno || caso.vuelo.combustibleAlternoMin + ' min')}</div></div>
      </div>
      <div style="margin-top:10px">
        <div class="campo-etq">Justificación</div>
        <div style="font-size:12px;color:#b6c2cf;margin-top:3px">
          ${esc(caso.alternos.justificacion || (adSel ? `Obtiene la puntuación ponderada más alta (${ganador.total.toFixed(1)}/10) a la hora evaluada. ${adSel.notas}` : 'Pendiente de redactar.'))}
        </div>
      </div>
      <div style="margin-top:10px">
        <div class="campo-etq">Decisión</div>
        <div style="font-family:var(--mono);font-size:15px;font-weight:700;margin-top:3px;color:${
          caso.bitacora.decision === 'GO' ? 'var(--vfr)' : caso.bitacora.decision === 'NO-GO' ? 'var(--ifr)' : 'var(--sev-leve)'
        }">${esc(caso.bitacora.decision || 'PENDIENTE')}</div>
      </div>
    </div>
    <button id="btn-imprimir" style="width:100%;margin-top:10px">Exportar bitácora a PDF</button>`;

  $('#tab-alterno').innerHTML = controlesPeso + tabla + bitacora;

  $('#tab-alterno').querySelectorAll('input[data-peso]').forEach((el) => {
    el.addEventListener('input', () => {
      pesos[el.dataset.peso] = Number(el.value);
      document.getElementById(`val-${el.dataset.peso}`).textContent = el.value;
      pintar();
    });
  });

  $('#tab-alterno').querySelectorAll('tr[data-icao]').forEach((tr) => {
    tr.addEventListener('click', () => centrarEn(tr.dataset.icao));
  });

  document.getElementById('btn-imprimir')?.addEventListener('click', () => window.print());
}
