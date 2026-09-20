// Frontera de Colombia y división departamental sobre el mapa.
//
// El fondo de relieve ya trae límites, pero pintados dentro de la tesela: no se
// pueden encender ni apagar, no se pueden consultar y —lo que importa aquí— no se
// pueden llevar a la geometría del satélite. Estos son vectores, así que sirven
// para las dos cosas: esta capa los dibuja sobre el mapa y js/satelite.js los
// reproyecta sobre las bandas.
//
// Los datos vienen congelados de datos/limites-colombia.geojson, con su
// procedencia dentro del propio archivo. Aquí no se calcula ninguna geometría.

import { esc } from './util.js';
import { registrar } from './capas.js';

const COLOR_PAIS = '#f0f6fc';
const COLOR_DEPTO = '#9fb4cc';

let limites = null;

export const obtenerLimites = () => limites;

export function iniciarLimites(datos) {
  limites = datos;
  if (!datos?.features?.length) return;

  const pais = datos.features.filter((f) => f.properties.nivel === 'pais');
  const deptos = datos.features.filter((f) => f.properties.nivel === 'departamento');

  // Dos capas y no una: la frontera nacional interesa casi siempre y los
  // departamentos son ruido cuando se está mirando el corredor de la ruta, así que
  // cada una se enciende por su lado.
  const capaPais = L.geoJSON(
    { type: 'FeatureCollection', features: pais },
    {
      style: { color: COLOR_PAIS, weight: 1.6, opacity: 0.9, fill: false, interactive: false },
    }
  );

  const capaDeptos = L.geoJSON(
    { type: 'FeatureCollection', features: deptos },
    {
      style: { color: COLOR_DEPTO, weight: 0.8, opacity: 0.7, fill: true, fillOpacity: 0, dashArray: '4,4' },
      onEachFeature: (f, capa) => {
        const p = f.properties;
        // El relleno es transparente pero existe: sin él, acertarle a una línea de
        // 0,8 px con el ratón es un ejercicio de puntería.
        capa.bindTooltip(p.nombre || 'Territorio sin nombre en la fuente', { sticky: true });
        capa.bindPopup(`
          <div style="min-width:200px">
            <div style="font-size:14px;font-weight:700">${esc(p.nombre || 'Sin nombre en la fuente')}</div>
            <div style="color:#8b98a5;margin-bottom:6px">${esc(p.categoria)}${p.iso ? ` · ${esc(p.iso)}` : ''}</div>
            ${p._nota ? `<div style="font-size:11px;color:#8b98a5;font-style:italic">${esc(p._nota)}</div>` : ''}
            <div style="margin-top:6px;font-size:11px;color:#8b98a5">
              Natural Earth 1:10 M — cartografía general, para situarse, no para medir.
            </div>
          </div>`);
      },
    }
  );

  const proc = datos._procedencia || {};

  registrar({
    id: 'limite-pais',
    nombre: 'Frontera de Colombia',
    grupo: 'Navegación',
    capa: capaPais,
    visible: true,
    descripcion: `Frontera nacional, incluidas las islas. ${esc(proc.escala || '')} Fuente: ${esc(proc.fuente || 'Natural Earth')}.`,
  });

  registrar({
    id: 'limite-departamentos',
    nombre: `Departamentos (${deptos.length})`,
    grupo: 'Navegación',
    capa: capaDeptos,
    visible: true,
    descripcion:
      'División departamental. Clic en uno para ver su nombre y categoría. ' +
      'Natural Earth arrastra la división anterior a 1991 y llama Intendencia o Comisaría a nueve de ellos; ' +
      'aquí figuran como Departamento, con el valor original guardado en el archivo.',
  });
}
