// Decodificación de los partes aeronáuticos, grupo a grupo.
//
// `METAR SKLT 071900Z 09006KT 9999 FEW017 SCT100 31/24 Q1009` es exacto y es
// ilegible para cualquiera que no lo lea a diario. En una sustentación eso tiene
// un coste: el evaluador no puede comprobar lo que se afirma sin fiarse. Esto
// desmonta el parte en sus grupos y traduce cada uno al lado del original, sin
// sustituirlo: el crudo sigue estando, que es lo que se cita.
//
// Solo se traduce lo que ESTÁ en el parte. Un grupo desconocido se marca como no
// reconocido y se deja tal cual; no se adivina.

/* ---------- Diccionarios ---------- */

const DESCRIPTOR = {
  MI: 'banco bajo', BC: 'bancos', PR: 'parcial', DR: 'arrastrado por el viento',
  BL: 'levantado por el viento', SH: 'chubascos', TS: 'tormenta', FZ: 'engelante',
};

const FENOMENO = {
  DZ: 'llovizna', RA: 'lluvia', SN: 'nieve', SG: 'cinarra', PL: 'hielo granulado',
  GR: 'granizo', GS: 'granizo menudo', UP: 'precipitación desconocida',
  BR: 'neblina', FG: 'niebla', FU: 'humo', VA: 'ceniza volcánica', DU: 'polvo',
  SA: 'arena', HZ: 'calima', PY: 'rocío marino',
  PO: 'remolinos de polvo', SQ: 'turbonada', FC: 'tornado o tromba',
  SS: 'tempestad de arena', DS: 'tempestad de polvo',
};

const NUBOSIDAD = {
  FEW: { texto: 'algunas nubes', octas: '1–2 octas' },
  SCT: { texto: 'nubes dispersas', octas: '3–4 octas' },
  BKN: { texto: 'nubosidad fragmentada', octas: '5–7 octas' },
  OVC: { texto: 'cielo cubierto', octas: '8 octas' },
  VV: { texto: 'visibilidad vertical (cielo oculto)', octas: '—' },
};

const TIPO_NUBE = { CB: 'cumulonimbo', TCU: 'cumulo congestus (TCU)' };

const PELIGRO_SIGMET = {
  TS: 'tormenta', TSGR: 'tormenta con granizo', TURB: 'turbulencia',
  ICE: 'engelamiento', MTW: 'ondas de montaña', DS: 'tempestad de polvo',
  SS: 'tempestad de arena', VA: 'ceniza volcánica', TC: 'ciclón tropical',
  CONVECTIVE: 'convección', IFR: 'condiciones IFR', ICING: 'engelamiento',
};

const CALIFICADOR = { SEV: 'severa', MOD: 'moderada', EMBD: 'embebida', ISOL: 'aislada', OCNL: 'ocasional', FRQ: 'frecuente', OBSC: 'oscurecida', SQL: 'en línea de turbonada' };

/* ---------- METAR / TAF ---------- */

const RE = {
  estacion: /^[A-Z]{4}$/,
  hora: /^(\d{2})(\d{2})(\d{2})Z$/,
  viento: /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/,
  vientoVar: /^(\d{3})V(\d{3})$/,
  visib: /^(\d{4})(NDV)?$/,
  visibSM: /^(M)?(\d+(?:\/\d+)?)SM$/,
  nube: /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})(CB|TCU)?$/,
  temp: /^(M?\d{2})\/(M?\d{2})$/,
  qnh: /^([QA])(\d{4})$/,
  tiempo: /^([-+]|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)?)((?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/,
  rvr: /^R(\d{2}[LCR]?)\/(.+)$/,
  cambio: /^(BECMG|TEMPO|PROB\d{2}|FM\d{6}|TL\d{4}|AT\d{4})$/,
  periodoTaf: /^(\d{4})\/(\d{4})$/,
};

const num = (s) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));

/**
 * Desmonta un METAR o TAF en grupos traducidos.
 * @returns {Array<{crudo:string, tipo:string, texto:string, nota?:string}>}
 */
export function decodificarParte(crudo) {
  if (!crudo) return [];
  const fichas = String(crudo).replace(/\s+/g, ' ').trim().split(' ');
  const out = [];
  let enRemarks = false;

  for (let i = 0; i < fichas.length; i++) {
    const f = fichas[i];
    if (!f) continue;

    if (enRemarks) { out.push({ crudo: f, tipo: 'rmk', texto: 'comentario local' }); continue; }

    if (f === 'RMK') { enRemarks = true; out.push({ crudo: f, tipo: 'rmk', texto: 'comienzo de comentarios (no normalizados)' }); continue; }
    if (f === 'METAR' || f === 'SPECI' || f === 'TAF') {
      out.push({ crudo: f, tipo: 'cab', texto: f === 'SPECI' ? 'informe especial, emitido fuera de hora por cambio significativo' : f === 'TAF' ? 'pronóstico de aeródromo' : 'informe meteorológico ordinario de aeródromo' });
      continue;
    }
    if (f === 'AUTO') { out.push({ crudo: f, tipo: 'cab', texto: 'observación automática, sin intervención humana' }); continue; }
    if (f === 'COR' || f === 'AMD') { out.push({ crudo: f, tipo: 'cab', texto: f === 'COR' ? 'corregido' : 'enmendado' }); continue; }
    if (f === 'NIL') { out.push({ crudo: f, tipo: 'cab', texto: 'sin informe' }); continue; }
    if (f === 'CAVOK') {
      out.push({ crudo: f, tipo: 'visib', texto: 'CAVOK: visibilidad 10 km o más, sin nubes por debajo de 5 000 ft ni CB, y sin fenómenos significativos' });
      continue;
    }
    if (f === 'NOSIG') { out.push({ crudo: f, tipo: 'tendencia', texto: 'sin cambios significativos previstos en las próximas 2 h' }); continue; }
    if (f === 'NSC') { out.push({ crudo: f, tipo: 'nube', texto: 'sin nubosidad significativa' }); continue; }
    if (f === 'NCD') { out.push({ crudo: f, tipo: 'nube', texto: 'sin nubes detectadas (sensor automático)' }); continue; }
    if (f === 'SKC' || f === 'CLR') { out.push({ crudo: f, tipo: 'nube', texto: 'cielo despejado' }); continue; }

    let m;
    if ((m = f.match(RE.hora))) {
      out.push({ crudo: f, tipo: 'hora', texto: `día ${m[1]} del mes, ${m[2]}:${m[3]} UTC` });
      continue;
    }
    if (i <= 2 && RE.estacion.test(f)) {
      out.push({ crudo: f, tipo: 'estacion', texto: 'indicador OACI de la estación' });
      continue;
    }
    if ((m = f.match(RE.viento))) {
      const dir = m[1] === 'VRB' ? 'dirección variable' : `del ${Number(m[1])}°`;
      const u = m[4] === 'KT' ? 'kt' : 'm/s';
      out.push({
        crudo: f, tipo: 'viento',
        texto: `viento ${dir}, ${Number(m[2])} ${u}` + (m[3] ? `, con rachas de ${Number(m[3])} ${u}` : ''),
        nota: m[3] ? 'La racha se informa cuando supera en 10 kt o más al viento medio.' : undefined,
      });
      continue;
    }
    if ((m = f.match(RE.vientoVar))) {
      out.push({ crudo: f, tipo: 'viento', texto: `dirección oscilando entre ${Number(m[1])}° y ${Number(m[2])}°` });
      continue;
    }
    if ((m = f.match(RE.nube))) {
      const n = NUBOSIDAD[m[1]];
      const ft = m[2] === '///' ? null : Number(m[2]) * 100;
      out.push({
        crudo: f, tipo: 'nube',
        texto: `${n.texto} (${n.octas})` + (ft != null ? ` a ${ft.toLocaleString('es')} ft sobre el aeródromo` : ', altura no medida') +
          (m[3] ? ` — ${TIPO_NUBE[m[3]]}` : ''),
        nota: m[3] === 'CB' ? 'La presencia de CB es la señal de tormenta en el parte de superficie.' : undefined,
      });
      continue;
    }
    if ((m = f.match(RE.temp))) {
      const t = num(m[1]);
      const d = num(m[2]);
      out.push({
        crudo: f, tipo: 'temp',
        texto: `temperatura ${t} °C, punto de rocío ${d} °C (diferencia ${(t - d).toFixed(0)} °C)`,
        nota: t - d <= 2 ? 'Diferencia de 2 °C o menos: aire saturado, riesgo de niebla o nube muy baja.' : undefined,
      });
      continue;
    }
    if ((m = f.match(RE.qnh))) {
      out.push({
        crudo: f, tipo: 'qnh',
        texto: m[1] === 'Q' ? `QNH ${Number(m[2])} hPa` : `altímetro ${(Number(m[2]) / 100).toFixed(2)} inHg`,
      });
      continue;
    }
    if ((m = f.match(RE.visibSM))) {
      out.push({ crudo: f, tipo: 'visib', texto: `visibilidad ${m[1] ? 'menor de ' : ''}${m[2]} millas terrestres` });
      continue;
    }
    if ((m = f.match(RE.visib))) {
      const v = Number(m[1]);
      out.push({
        crudo: f, tipo: 'visib',
        texto: v >= 9999 ? 'visibilidad de 10 km o más' : `visibilidad ${v.toLocaleString('es')} m`,
      });
      continue;
    }
    if ((m = f.match(RE.tiempo))) {
      const int = m[1] === '-' ? 'débil ' : m[1] === '+' ? 'fuerte ' : m[1] === 'VC' ? 'en las proximidades: ' : '';
      const desc = m[2] ? DESCRIPTOR[m[2]] + ' de ' : '';
      const fen = (m[3].match(/.{2}/g) || []).map((c) => FENOMENO[c] || c).join(' y ');
      out.push({ crudo: f, tipo: 'tiempo', texto: `${int}${desc}${fen}`.trim() });
      continue;
    }
    if ((m = f.match(RE.periodoTaf))) {
      out.push({ crudo: f, tipo: 'periodo', texto: `validez del día ${m[1].slice(0, 2)} a las ${m[1].slice(2)}:00 UTC hasta el día ${m[2].slice(0, 2)} a las ${m[2].slice(2)}:00 UTC` });
      continue;
    }
    if ((m = f.match(RE.cambio))) {
      const t = m[1];
      const texto = t === 'BECMG' ? 'cambio gradual a partir de aquí'
        : t === 'TEMPO' ? 'variación temporal, menos de una hora cada vez y menos de la mitad del periodo'
        : t.startsWith('PROB') ? `probabilidad del ${t.slice(4)} % de lo que sigue`
        : t.startsWith('FM') ? `desde el día ${t.slice(2, 4)} a las ${t.slice(4, 6)}:${t.slice(6)} UTC`
        : t.startsWith('TL') ? `hasta las ${t.slice(2, 4)}:${t.slice(4)} UTC`
        : `a las ${t.slice(2, 4)}:${t.slice(4)} UTC`;
      out.push({ crudo: f, tipo: 'cambio', texto });
      continue;
    }
    if ((m = f.match(RE.rvr))) {
      out.push({ crudo: f, tipo: 'rvr', texto: `alcance visual en la pista ${m[1]}: ${m[2]}` });
      continue;
    }
    if (f.startsWith('WS')) { out.push({ crudo: f, tipo: 'tiempo', texto: 'cizalladura del viento notificada' }); continue; }

    out.push({ crudo: f, tipo: 'desconocido', texto: 'grupo no reconocido por este decodificador' });
  }

  return out;
}

/* ---------- Categoría de vuelo ----------
   Se deja explícito de dónde sale el corte: es la convención de la FAA, la misma
   que usa la API de la que salen estos partes, para que la categoría que muestra
   el visor y la que trae el dato no se contradigan. */

export const CRITERIO_CATEGORIA = {
  VFR: 'techo por encima de 3 000 ft Y visibilidad mayor de 5 SM',
  MVFR: 'techo de 1 000 a 3 000 ft O visibilidad de 3 a 5 SM',
  IFR: 'techo de 500 a menos de 1 000 ft O visibilidad de 1 a menos de 3 SM',
  LIFR: 'techo por debajo de 500 ft O visibilidad menor de 1 SM',
  fuente: 'Convención de categorías de vuelo de la FAA, la misma que aplica el Aviation Weather Center a estos partes. El techo es la base de la primera capa BKN u OVC.',
};

/* ---------- SIGMET ---------- */

/** Traduce la cabecera de un SIGMET a una ficha legible. */
export function decodificarSigmet(s) {
  if (!s) return null;
  const peligro = PELIGRO_SIGMET[s.hazard] || s.hazard || 'fenómeno no especificado';
  const cal = CALIFICADOR[s.qualifier] || s.qualifier || '';

  const capa = s.base != null && s.top != null
    ? `entre ${Number(s.base).toLocaleString('es')} y ${Number(s.top).toLocaleString('es')} ft`
    : s.top != null ? `hasta ${Number(s.top).toLocaleString('es')} ft`
    : s.base != null ? `desde ${Number(s.base).toLocaleString('es')} ft`
    : 'sin capa declarada';

  const mov = s.dir && s.spd
    ? `se desplaza hacia ${s.dir} a ${s.spd} kt`
    : 'sin movimiento declarado';

  const evol = s.chng === 'INTSF' ? 'intensificándose'
    : s.chng === 'WKN' ? 'debilitándose'
    : s.chng === 'NC' ? 'sin cambios'
    : null;

  return {
    titulo: `${cal ? cal.toUpperCase() + ' ' : ''}${peligro}`.trim(),
    capa,
    movimiento: mov,
    evolucion: evol,
    fir: s.firName || s.firId || '',
    serie: s.seriesId || '',
    validez: s.validTimeFrom && s.validTimeTo
      ? `${new Date(s.validTimeFrom * 1000).toISOString().slice(11, 16)}Z – ${new Date(s.validTimeTo * 1000).toISOString().slice(11, 16)}Z`
      : '',
    // El texto crudo manda siempre: la traducción es una ayuda, no la fuente.
    crudo: s.rawSigmet || '',
  };
}

/** Explicación corta de un peligro, para la ficha del visor. */
export function queSignifica(hazard) {
  const m = {
    TS: 'Tormenta: corrientes verticales intensas, granizo, engelamiento y actividad eléctrica. Se evita lateralmente, no por encima.',
    TSGR: 'Tormenta con granizo confirmado: el granizo puede salir despedido del yunque a varias millas del núcleo.',
    TURB: 'Turbulencia declarada por el centro de vigilancia; en severa provoca pérdidas momentáneas de control de la actitud.',
    ICE: 'Engelamiento: agua líquida subenfriada que se congela al impactar. Crítico entre 0 y −20 °C.',
    MTW: 'Ondas de montaña: ascensos y descensos organizados a sotavento del relieve.',
    VA: 'Ceniza volcánica: daña los motores por fusión en la turbina. Se evita por completo.',
    IFR: 'Condiciones instrumentales extensas en la zona.',
  };
  return m[hazard] || null;
}
