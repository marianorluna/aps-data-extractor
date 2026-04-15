import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import './App.css';

/** Renderiza la colección de propiedades del endpoint MD en una tabla agrupada por objeto. */
function PropertiesTable({ payload }) {
  const collection = useMemo(() => {
    const list =
      payload?.data?.collection ||
      payload?.collection ||
      payload?.data?.properties ||
      [];
    return Array.isArray(list) ? list : [];
  }, [payload]);

  if (collection.length === 0) {
    return (
      <pre className="extract-json-pre">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  return (
    <div className="prop-table-container">
      {collection.map((obj) => (
        <details key={obj.objectid ?? obj.externalId ?? Math.random()} className="prop-object" open={collection.length === 1}>
          <summary className="prop-object-summary">
            <strong>{obj.name || `Objeto ${obj.objectid}`}</strong>
            {obj.externalId ? (
              <span className="prop-ext-id"> &nbsp;·&nbsp; {obj.externalId}</span>
            ) : null}
          </summary>
          {obj.properties && typeof obj.properties === 'object' ? (
            Object.entries(obj.properties).map(([group, fields]) => (
              <div key={group} className="prop-group">
                <div className="prop-group-label">{group}</div>
                <table className="prop-table">
                  <tbody>
                    {typeof fields === 'object' && !Array.isArray(fields)
                      ? Object.entries(fields).map(([k, v]) => (
                        <tr key={k}>
                          <td className="prop-key">{k}</td>
                          <td className="prop-val">
                            {v == null ? <em className="prop-nil">—</em> : String(v)}
                          </td>
                        </tr>
                      ))
                      : (
                        <tr>
                          <td className="prop-val" colSpan={2}>
                            {JSON.stringify(fields)}
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <pre className="extract-json-pre">{JSON.stringify(obj, null, 2)}</pre>
          )}
        </details>
      ))}
    </div>
  );
}

/**
 * Recorre el árbol de objetos del Model Derivative y construye
 * un mapa objectid → nombre de categoría (nivel 1 bajo la raíz).
 * Estructura típica: Raíz → Categoría → Familia → Tipo → Instancia
 */
function buildCategoryMap(treeData) {
  const map = {};
  const root =
    treeData?.data?.objects?.[0] ??
    treeData?.objects?.[0] ??
    null;
  if (!root) return map;

  function walkInstances(node, categoryName) {
    if (node.objectid != null) map[node.objectid] = categoryName;
    if (node.objects?.length) {
      for (const child of node.objects) {
        walkInstances(child, categoryName);
      }
    }
  }

  for (const categoryNode of root.objects ?? []) {
    const catName = categoryNode.name || '(sin categoría)';
    walkInstances(categoryNode, catName);
  }
  return map;
}

/** Detalle de propiedades de un único elemento (misma estructura que PropertiesTable). */
function AnalyticsSelectedElementDetail({ obj }) {
  if (!obj) return null;
  return (
    <div className="analytics-selected-wrap">
      <h5 className="analytics-selected-title">
        Propiedades: <strong>{obj.name || `Objeto ${obj.objectid ?? ''}`}</strong>
        {obj.externalId ? (
          <span className="analytics-selected-extid"> · {obj.externalId}</span>
        ) : null}
      </h5>
      {obj.properties && typeof obj.properties === 'object' ? (
        Object.entries(obj.properties).map(([group, fields]) => (
          <div key={group} className="prop-group">
            <div className="prop-group-label">{group}</div>
            <table className="prop-table">
              <tbody>
                {typeof fields === 'object' && !Array.isArray(fields)
                  ? Object.entries(fields).map(([k, v]) => (
                    <tr key={k}>
                      <td className="prop-key">{k}</td>
                      <td className="prop-val">
                        {v == null ? <em className="prop-nil">—</em> : String(v)}
                      </td>
                    </tr>
                  ))
                  : (
                    <tr>
                      <td className="prop-val" colSpan={2}>
                        {JSON.stringify(fields)}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <pre className="extract-json-pre">{JSON.stringify(obj, null, 2)}</pre>
      )}
    </div>
  );
}

function ModelAnalyticsPanel({ payload, categoryMap = {} }) {
  const collection = useMemo(() => getPropertiesCollectionFromPayload(payload), [payload]);
  const pageSize = 10;
  const [query, setQuery] = useState('');
  const [builtInCategoryFilter, setBuiltInCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [detailPage, setDetailPage] = useState(1);
  const [selectedElementId, setSelectedElementId] = useState(null);

  const normalizedElements = useMemo(() => {
    return collection.map((obj) => {
      const builtInCategory = getBuiltInCategoryLabel(obj, categoryMap);
      const typeName =
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return key === 'type name' || key === 'family and type' || key === 'family name';
        }) || '(sin tipo)';
      const level =
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return (
            key === 'level' ||
            key === 'base level' ||
            key === 'reference level' ||
            key === 'associated level'
          );
        }) || '(sin nivel)';
      const lengthParsed = parseLeadingNumberAndUnit(
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return key === 'length' || key === 'computed length';
        })
      );
      const areaParsed = parseLeadingNumberAndUnit(
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return key === 'area' || key === 'uncompressed area' || key === 'surface area';
        })
      );
      const volumeParsed = parseLeadingNumberAndUnit(
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return key === 'volume' || key === 'computed volume';
        })
      );
      const depthParsed = parseLeadingNumberAndUnit(
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return (
            key === 'depth' ||
            key === 'overall depth' ||
            key === 'profundidad' ||
            key === 'profundidad total'
          );
        })
      );
      const widthParsed = parseLeadingNumberAndUnit(
        findPropertyEntry(obj, (k) => {
          const key = k.toLowerCase();
          return (
            key === 'width' ||
            key === 'overall width' ||
            key === 'anchura' ||
            key === 'ancho' ||
            key === 'anchura total'
          );
        })
      );

      const { n: length, unit: lengthUnit } = lengthParsed;
      const { n: area, unit: areaUnit } = areaParsed;
      const { n: volume, unit: volumeUnit } = volumeParsed;
      const { n: depth, unit: depthUnit } = depthParsed;
      const { n: width, unit: widthUnit } = widthParsed;

      return {
        id: obj.objectid ?? obj.externalId ?? Math.random().toString(36).slice(2),
        name: obj.name || '(sin nombre)',
        externalId: obj.externalId || '',
        builtInCategory: String(builtInCategory),
        typeName: String(typeName),
        level: String(level),
        length: Number.isFinite(length) ? length : null,
        lengthUnit: lengthUnit || null,
        area: Number.isFinite(area) ? area : null,
        areaUnit: areaUnit || null,
        volume: Number.isFinite(volume) ? volume : null,
        volumeUnit: volumeUnit || null,
        depth: Number.isFinite(depth) ? depth : null,
        depthUnit: depthUnit || null,
        width: Number.isFinite(width) ? width : null,
        widthUnit: widthUnit || null,
        raw: obj,
      };
    });
  }, [collection, categoryMap]);

  const filterOptions = useMemo(() => {
    const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));
    return {
      builtInCategories: uniq(normalizedElements.map((x) => x.builtInCategory)),
      types: uniq(normalizedElements.map((x) => x.typeName)),
      levels: uniq(normalizedElements.map((x) => x.level)),
    };
  }, [normalizedElements]);

  /** Tipos visibles en el desplegable: acotados por la categoría integrada elegida. */
  const typeSelectOptions = useMemo(() => {
    const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));
    if (builtInCategoryFilter === 'all') {
      return uniq(normalizedElements.map((el) => el.typeName));
    }
    return uniq(
      normalizedElements
        .filter((el) => el.builtInCategory === builtInCategoryFilter)
        .map((el) => el.typeName)
    );
  }, [normalizedElements, builtInCategoryFilter]);

  const filteredElements = useMemo(() => {
    const q = query.trim().toLowerCase();
    return normalizedElements.filter((el) => {
      if (builtInCategoryFilter !== 'all' && el.builtInCategory !== builtInCategoryFilter) return false;
      if (typeFilter !== 'all' && el.typeName !== typeFilter) return false;
      if (levelFilter !== 'all' && el.level !== levelFilter) return false;
      if (!q) return true;
      return (
        el.name.toLowerCase().includes(q) ||
        el.externalId.toLowerCase().includes(q) ||
        el.builtInCategory.toLowerCase().includes(q) ||
        el.typeName.toLowerCase().includes(q) ||
        el.level.toLowerCase().includes(q)
      );
    });
  }, [normalizedElements, query, builtInCategoryFilter, typeFilter, levelFilter]);

  const measurementUnits = useMemo(() => {
    const lenRows = filteredElements.filter((e) => e.length != null);
    const areaRows = filteredElements.filter((e) => e.area != null);
    const volRows = filteredElements.filter((e) => e.volume != null);
    const depthRows = filteredElements.filter((e) => e.depth != null);
    const widthRows = filteredElements.filter((e) => e.width != null);
    const lenU = lenRows.map((e) => e.lengthUnit);
    const areaU = areaRows.map((e) => e.areaUnit);
    const volU = volRows.map((e) => e.volumeUnit);
    const depthU = depthRows.map((e) => e.depthUnit);
    const widthU = widthRows.map((e) => e.widthUnit);
    return {
      length: pickDominantUnit(lenU),
      lengthMixed: hasMixedMeasurementUnits(lenU),
      area: pickDominantUnit(areaU),
      areaMixed: hasMixedMeasurementUnits(areaU),
      volume: pickDominantUnit(volU),
      volumeMixed: hasMixedMeasurementUnits(volU),
      depth: pickDominantUnit(depthU),
      depthMixed: hasMixedMeasurementUnits(depthU),
      width: pickDominantUnit(widthU),
      widthMixed: hasMixedMeasurementUnits(widthU),
    };
  }, [filteredElements]);

  const totals = useMemo(() => {
    let length = 0;
    let area = 0;
    let volume = 0;
    let depth = 0;
    let width = 0;
    let withLength = 0;
    let withArea = 0;
    let withVolume = 0;
    let withDepth = 0;
    let withWidth = 0;
    for (const el of filteredElements) {
      if (el.length != null) {
        length += el.length;
        withLength += 1;
      }
      if (el.area != null) {
        area += el.area;
        withArea += 1;
      }
      if (el.volume != null) {
        volume += el.volume;
        withVolume += 1;
      }
      if (el.depth != null) {
        depth += el.depth;
        withDepth += 1;
      }
      if (el.width != null) {
        width += el.width;
        withWidth += 1;
      }
    }
    return {
      length,
      area,
      volume,
      depth,
      width,
      withLength,
      withArea,
      withVolume,
      withDepth,
      withWidth,
    };
  }, [filteredElements]);

  /** Ocultar dimensión en tabla y KPI si ningún elemento filtrado aporta valor numérico. */
  const dimensionVisibility = useMemo(
    () => ({
      length: totals.withLength > 0,
      area: totals.withArea > 0,
      volume: totals.withVolume > 0,
      depth: totals.withDepth > 0,
      width: totals.withWidth > 0,
    }),
    [totals]
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredElements.length / pageSize)),
    [filteredElements.length, pageSize]
  );

  useEffect(() => {
    setDetailPage(1);
    setSelectedElementId(null);
  }, [query, builtInCategoryFilter, typeFilter, levelFilter]);

  useEffect(() => {
    if (typeFilter === 'all') return;
    if (!typeSelectOptions.includes(typeFilter)) setTypeFilter('all');
  }, [typeFilter, typeSelectOptions]);

  useEffect(() => {
    if (detailPage > totalPages) setDetailPage(totalPages);
  }, [detailPage, totalPages]);

  const pagedDetails = useMemo(() => {
    const start = (detailPage - 1) * pageSize;
    return filteredElements.slice(start, start + pageSize);
  }, [filteredElements, detailPage, pageSize]);

  if (!collection.length) return <PropertiesTable payload={payload} />;

  const mixedUnitsTitle =
    'Hay varias unidades distintas entre los elementos filtrados; la suma numérica puede mezclar magnitudes. Se indica la unidad más frecuente.';

  return (
    <div className="analytics-panel">
      <div className="analytics-controls">
        <input
          type="text"
          className="analytics-input"
          placeholder="Buscar por nombre, categoría integrada, tipo, nivel, externalId"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="analytics-select"
          value={builtInCategoryFilter}
          onChange={(e) => setBuiltInCategoryFilter(e.target.value)}
        >
          <option value="all">Categorías</option>
          {filterOptions.builtInCategories.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select className="analytics-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">Tipos</option>
          {typeSelectOptions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select className="analytics-select" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="all">Niveles</option>
          {filterOptions.levels.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="analytics-kpis">
        <div className="analytics-kpi"><span>Elementos</span><strong>{filteredElements.length}</strong></div>
        {dimensionVisibility.length ? (
          <div
            className="analytics-kpi"
            title={measurementUnits.lengthMixed ? mixedUnitsTitle : undefined}
          >
            <span>
              Σ Longitud
              {measurementUnits.length ? ` (${measurementUnits.length})` : ''}
              {measurementUnits.lengthMixed ? ' *' : ''}
            </span>
            <strong>{formatMeasurementDecimals3(totals.length)}</strong>
          </div>
        ) : null}
        {dimensionVisibility.area ? (
          <div
            className="analytics-kpi"
            title={measurementUnits.areaMixed ? mixedUnitsTitle : undefined}
          >
            <span>
              Σ Área
              {measurementUnits.area ? ` (${measurementUnits.area})` : ''}
              {measurementUnits.areaMixed ? ' *' : ''}
            </span>
            <strong>{formatMeasurementDecimals3(totals.area)}</strong>
          </div>
        ) : null}
        {dimensionVisibility.volume ? (
          <div
            className="analytics-kpi"
            title={measurementUnits.volumeMixed ? mixedUnitsTitle : undefined}
          >
            <span>
              Σ Volumen
              {measurementUnits.volume ? ` (${measurementUnits.volume})` : ''}
              {measurementUnits.volumeMixed ? ' *' : ''}
            </span>
            <strong>{formatMeasurementDecimals3(totals.volume)}</strong>
          </div>
        ) : null}
        {dimensionVisibility.depth ? (
          <div
            className="analytics-kpi"
            title={measurementUnits.depthMixed ? mixedUnitsTitle : undefined}
          >
            <span>
              Σ Profundidad
              {measurementUnits.depth ? ` (${measurementUnits.depth})` : ''}
              {measurementUnits.depthMixed ? ' *' : ''}
            </span>
            <strong>{formatMeasurementDecimals3(totals.depth)}</strong>
          </div>
        ) : null}
        {dimensionVisibility.width ? (
          <div
            className="analytics-kpi"
            title={measurementUnits.widthMixed ? mixedUnitsTitle : undefined}
          >
            <span>
              Σ Ancho
              {measurementUnits.width ? ` (${measurementUnits.width})` : ''}
              {measurementUnits.widthMixed ? ' *' : ''}
            </span>
            <strong>{formatMeasurementDecimals3(totals.width)}</strong>
          </div>
        ) : null}
      </div>

      <div className="analytics-cards-column">
        <div className="analytics-table-wrap analytics-card">
          <div className="analytics-title-row">
            <h4 className="analytics-title">Detalle filtrado</h4>
            <div className="analytics-pagination">
              <button
                type="button"
                className="analytics-page-btn"
                onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                disabled={detailPage <= 1}
              >
                Anterior
              </button>
              <span className="analytics-page-info">
                Página {detailPage} de {totalPages}
              </span>
              <button
                type="button"
                className="analytics-page-btn"
                onClick={() => setDetailPage((p) => Math.min(totalPages, p + 1))}
                disabled={detailPage >= totalPages}
              >
                Siguiente
              </button>
            </div>
          </div>
          <table className="analytics-table analytics-table-compact">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Categoría integrada</th>
                <th>Tipo</th>
                <th>Nivel</th>
                {dimensionVisibility.length ? (
                  <th
                    className="analytics-col-num"
                    title={measurementUnits.lengthMixed ? mixedUnitsTitle : undefined}
                  >
                    Longitud
                    {measurementUnits.length ? ` (${measurementUnits.length})` : ''}
                    {measurementUnits.lengthMixed ? ' *' : ''}
                  </th>
                ) : null}
                {dimensionVisibility.depth ? (
                  <th
                    className="analytics-col-num"
                    title={measurementUnits.depthMixed ? mixedUnitsTitle : undefined}
                  >
                    Profundidad
                    {measurementUnits.depth ? ` (${measurementUnits.depth})` : ''}
                    {measurementUnits.depthMixed ? ' *' : ''}
                  </th>
                ) : null}
                {dimensionVisibility.width ? (
                  <th
                    className="analytics-col-num"
                    title={measurementUnits.widthMixed ? mixedUnitsTitle : undefined}
                  >
                    Ancho
                    {measurementUnits.width ? ` (${measurementUnits.width})` : ''}
                    {measurementUnits.widthMixed ? ' *' : ''}
                  </th>
                ) : null}
                {dimensionVisibility.area ? (
                  <th
                    className="analytics-col-num"
                    title={measurementUnits.areaMixed ? mixedUnitsTitle : undefined}
                  >
                    Área
                    {measurementUnits.area ? ` (${measurementUnits.area})` : ''}
                    {measurementUnits.areaMixed ? ' *' : ''}
                  </th>
                ) : null}
                {dimensionVisibility.volume ? (
                  <th
                    className="analytics-col-num"
                    title={measurementUnits.volumeMixed ? mixedUnitsTitle : undefined}
                  >
                    Volumen
                    {measurementUnits.volume ? ` (${measurementUnits.volume})` : ''}
                    {measurementUnits.volumeMixed ? ' *' : ''}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {pagedDetails.map((el) => {
                const isSelected = selectedElementId === el.id;
                return (
                  <tr
                    key={el.id}
                    className={`analytics-row-selectable${isSelected ? ' analytics-row-selected' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`Elemento ${el.name}, ver propiedades`}
                    onClick={() =>
                      setSelectedElementId((prev) => (prev === el.id ? null : el.id))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedElementId((prev) => (prev === el.id ? null : el.id));
                      }
                    }}
                  >
                    <td>{el.name}</td>
                    <td>{el.builtInCategory}</td>
                    <td>{el.typeName}</td>
                    <td>{el.level}</td>
                    {dimensionVisibility.length ? (
                      <td className="analytics-col-num">
                        {el.length == null || !Number.isFinite(el.length)
                          ? '—'
                          : formatMeasurementDecimals3(el.length)}
                      </td>
                    ) : null}
                    {dimensionVisibility.depth ? (
                      <td className="analytics-col-num">
                        {el.depth == null || !Number.isFinite(el.depth)
                          ? '—'
                          : formatMeasurementDecimals3(el.depth)}
                      </td>
                    ) : null}
                    {dimensionVisibility.width ? (
                      <td className="analytics-col-num">
                        {el.width == null || !Number.isFinite(el.width)
                          ? '—'
                          : formatMeasurementDecimals3(el.width)}
                      </td>
                    ) : null}
                    {dimensionVisibility.area ? (
                      <td className="analytics-col-num">
                        {el.area == null || !Number.isFinite(el.area)
                          ? '—'
                          : formatMeasurementDecimals3(el.area)}
                      </td>
                    ) : null}
                    {dimensionVisibility.volume ? (
                      <td className="analytics-col-num">
                        {el.volume == null || !Number.isFinite(el.volume)
                          ? '—'
                          : formatMeasurementDecimals3(el.volume)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selectedElementId != null ? (
          <div className="analytics-table-wrap analytics-card analytics-properties-card">
            <AnalyticsSelectedElementDetail
              obj={filteredElements.find((x) => x.id === selectedElementId)?.raw ?? null}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Extrae el primer número y el sufijo de unidad (si existe) de valores Revit/APS ("12,5 m²", "3 ft").
 * Si el valor es solo numérico, `unit` queda en null (no hay etiqueta en el dato).
 */
function parseLeadingNumberAndUnit(value) {
  if (value == null) return { n: null, unit: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { n: value, unit: null };
  const s = String(value).trim();
  if (!s) return { n: null, unit: null };
  const normalized = s.replace(/,/g, '.');
  const m = normalized.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/);
  if (!m) return { n: null, unit: null };
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return { n: null, unit: null };
  const start = normalized.indexOf(m[0]);
  const end = start + m[0].length;
  const rest = normalized.slice(end).trim();
  const unit = rest.length > 0 ? rest : null;
  return { n, unit };
}

function pickDominantUnit(unitList) {
  const tallies = new Map();
  for (const raw of unitList) {
    if (raw == null) continue;
    const u = String(raw).trim();
    if (!u) continue;
    tallies.set(u, (tallies.get(u) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [u, c] of tallies) {
    if (c > bestCount) {
      bestCount = c;
      best = u;
    }
  }
  return best;
}

function hasMixedMeasurementUnits(unitList) {
  const distinct = new Set();
  for (const raw of unitList) {
    if (raw == null) continue;
    const u = String(raw).trim();
    if (!u) continue;
    distinct.add(u);
  }
  return distinct.size > 1;
}

const MEASUREMENT_DECIMAL_PLACES = 3;
const DISPLAY_LOCALE = 'es-ES';

/** Longitud / área / volumen en pantalla: siempre 3 decimales (locale para separadores). */
function formatMeasurementDecimals3(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(DISPLAY_LOCALE, {
    minimumFractionDigits: MEASUREMENT_DECIMAL_PLACES,
    maximumFractionDigits: MEASUREMENT_DECIMAL_PLACES,
  });
}

function formatDateTimeEs(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(DISPLAY_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getPropertiesCollectionFromPayload(payload) {
  const list =
    payload?.data?.collection ||
    payload?.collection ||
    payload?.data?.properties ||
    [];
  return Array.isArray(list) ? list : [];
}

function findPropertyEntry(obj, keyMatcher) {
  const props = obj?.properties;
  if (!props || typeof props !== 'object') return null;
  for (const group of Object.keys(props)) {
    const fields = props[group];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    for (const k of Object.keys(fields)) {
      if (keyMatcher(k, fields[k])) return fields[k];
    }
  }
  return null;
}

/** Normaliza etiquetas de parámetro Revit/APS (mayúsculas, guiones, acentos). */
function normalizeParameterKeyName(k) {
  return String(k)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_.-]/g, '');
}

/**
 * Devuelve la categoría integrada (Built-in Category) de un elemento.
 * Fuentes en orden de prioridad:
 *   1. Árbol de objetos MD (categoryMap: objectid → categoryName)  ← más fiable
 *   2. Parámetro explícito BuiltInCategory / Categoría integrada
 *   3. Campo cuya clave contiene "category/categoría" con valor OST_*
 *   4. Parámetro "Category" textual
 *   5. Fallback a getCategoryLabel (family name / family and type)
 */
function getBuiltInCategoryLabel(obj, categoryMap = {}) {
  const objectid = obj?.objectid;
  if (objectid != null && categoryMap[objectid]) {
    return categoryMap[objectid];
  }

  const explicitKeyTargets = new Set([
    'builtincategory',
    'categoriaintegrada',
    'categoriaincorporada',
  ]);

  const props = obj?.properties;
  if (props && typeof props === 'object') {
    for (const group of Object.keys(props)) {
      const fields = props[group];
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
      for (const [k, v] of Object.entries(fields)) {
        if (explicitKeyTargets.has(normalizeParameterKeyName(k)) && v != null && String(v).trim()) {
          return String(v).trim();
        }
      }
    }
  }

  const ostCategory = findPropertyEntry(obj, (k, val) => {
    if (typeof val !== 'string') return false;
    const t = val.trim();
    if (!/^OST_[A-Za-z0-9_]+$/.test(t)) return false;
    const nk = normalizeParameterKeyName(k);
    return nk.includes('category') || nk.includes('categoria');
  });
  if (ostCategory != null && String(ostCategory).trim()) return String(ostCategory).trim();

  const categoryOnly = findPropertyEntry(obj, (k) => k.toLowerCase() === 'category');
  if (categoryOnly != null && String(categoryOnly).trim()) return String(categoryOnly).trim();

  return getCategoryLabel(obj);
}

function getCategoryLabel(obj) {
  const keys = ['category', 'family name', 'family and type'];
  for (const c of keys) {
    const v = findPropertyEntry(obj, (k) => k.toLowerCase() === c);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '(sin categoría)';
}

function getFamilyTypeLabel(obj) {
  const keys = ['type name', 'family and type', 'family name', 'type'];
  for (const c of keys) {
    const v = findPropertyEntry(obj, (k) => k.toLowerCase() === c);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/**
 * Agrega conteos por categoría y sumas aproximadas de campos típicos de geometría.
 * @returns {null | {
 *   totalElements: number,
 *   byCategory: Array<{ category: string, count: number }>,
 *   topTypes: Array<{ label: string, count: number }>,
 *   metrics: { area: number | null, volume: number | null, length: number | null },
 *   metricSamples: { area: number, volume: number, length: number },
 *   metricDisplayUnits: { area: string | null, volume: string | null, length: string | null,
 *     areaMixed: boolean, volumeMixed: boolean, lengthMixed: boolean },
 *   counts: { walls: number, floors: number, doors: number, windows: number, roofs: number },
 * }}
 */
function buildModelGeometrySummary(payload) {
  const collection = getPropertiesCollectionFromPayload(payload);
  if (collection.length === 0) return null;

  const byCat = new Map();
  const byType = new Map();
  let areaAcc = 0;
  let areaCount = 0;
  let volAcc = 0;
  let volCount = 0;
  let lenAcc = 0;
  let lenCount = 0;
  const areaUnitsSeen = [];
  const volUnitsSeen = [];
  const lenUnitsSeen = [];
  const counts = { walls: 0, floors: 0, doors: 0, windows: 0, roofs: 0 };

  const bumpStructural = (catRaw) => {
    const c = catRaw.toLowerCase();
    if (c === 'walls' || (c.includes('wall') && !c.includes('curtain'))) counts.walls += 1;
    else if (c.includes('floor') && !c.includes('flooring')) counts.floors += 1;
    else if (c.includes('door')) counts.doors += 1;
    else if (c.includes('window')) counts.windows += 1;
    else if (c.includes('roof')) counts.roofs += 1;
  };

  for (const obj of collection) {
    const cat = getBuiltInCategoryLabel(obj);
    byCat.set(cat, (byCat.get(cat) || 0) + 1);
    bumpStructural(cat);

    const ft = getFamilyTypeLabel(obj);
    if (ft) {
      const key = ft.length > 140 ? `${ft.slice(0, 137)}…` : ft;
      byType.set(key, (byType.get(key) || 0) + 1);
    }

    const props = obj?.properties;
    if (props && typeof props === 'object') {
      for (const group of Object.values(props)) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        for (const [k, v] of Object.entries(group)) {
          const kl = k.toLowerCase();
          if (
            kl === 'area' ||
            kl === 'uncompressed area' ||
            kl === 'surface area' ||
            kl === 'host area'
          ) {
            const { n, unit } = parseLeadingNumberAndUnit(v);
            if (n != null) {
              areaAcc += n;
              areaCount += 1;
              if (unit) areaUnitsSeen.push(unit);
            }
          } else if (kl === 'volume' || kl === 'computed volume') {
            const { n, unit } = parseLeadingNumberAndUnit(v);
            if (n != null) {
              volAcc += n;
              volCount += 1;
              if (unit) volUnitsSeen.push(unit);
            }
          } else if (
            kl === 'length' ||
            kl === 'unconnected height' ||
            kl === 'height' ||
            kl === 'computed length'
          ) {
            const { n, unit } = parseLeadingNumberAndUnit(v);
            if (n != null) {
              lenAcc += n;
              lenCount += 1;
              if (unit) lenUnitsSeen.push(unit);
            }
          }
        }
      }
    }
  }

  const byCategory = [...byCat.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const topTypes = [...byType.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    totalElements: collection.length,
    byCategory,
    topTypes,
    metrics: {
      area: areaCount ? areaAcc : null,
      volume: volCount ? volAcc : null,
      length: lenCount ? lenAcc : null,
    },
    metricSamples: { area: areaCount, volume: volCount, length: lenCount },
    metricDisplayUnits: {
      area: pickDominantUnit(areaUnitsSeen),
      areaMixed: hasMixedMeasurementUnits(areaUnitsSeen),
      volume: pickDominantUnit(volUnitsSeen),
      volumeMixed: hasMixedMeasurementUnits(volUnitsSeen),
      length: pickDominantUnit(lenUnitsSeen),
      lengthMixed: hasMixedMeasurementUnits(lenUnitsSeen),
    },
    counts,
  };
}

function GeometrySummaryPanel({
  summary,
  busy,
  error,
  sourceLabel,
  onReload,
  reloadDisabled,
}) {
  return (
    <div className="geometry-summary-panel" role="region" aria-labelledby="geometry-summary-title">
      <div className="geometry-summary-header">
        <h4 id="geometry-summary-title" className="geometry-summary-title">
          Resumen del modelo (elementos / geometría)
        </h4>
        <button
          type="button"
          className="geometry-summary-reload"
          onClick={onReload}
          disabled={reloadDisabled}
        >
          {busy ? 'Cargando…' : 'Recalcular'}
        </button>
      </div>
      {sourceLabel && (
        <p className="geometry-summary-source">
          Fuente de propiedades: <strong>{sourceLabel}</strong>
        </p>
      )}
      <p className="geometry-summary-disclaimer">
        Datos derivados de Model Derivative (propiedades exportadas). Las sumas de área/volumen/longitud son
        aproximadas (suman valores numéricos encontrados en campos homónimos, no sustituyen a Revit).
      </p>
      {busy && <p className="extract-info geometry-summary-status">Analizando propiedades del modelo…</p>}
      {error && !busy && (
        <p className="extract-hint extract-error-tight geometry-summary-status" role="alert">
          {error}
        </p>
      )}
      {summary && !busy && (
        <>
          <p className="geometry-summary-total">
            <strong>{summary.totalElements}</strong> elementos con propiedades en esta vista.
          </p>
          <div className="geometry-metrics-grid">
            <div className="geometry-metric-card">
              <span className="geometry-metric-label">Muros (por categoría)</span>
              <span className="geometry-metric-value">{summary.counts.walls}</span>
            </div>
            <div className="geometry-metric-card">
              <span className="geometry-metric-label">Suelos / losas</span>
              <span className="geometry-metric-value">{summary.counts.floors}</span>
            </div>
            <div className="geometry-metric-card">
              <span className="geometry-metric-label">Puertas</span>
              <span className="geometry-metric-value">{summary.counts.doors}</span>
            </div>
            <div className="geometry-metric-card">
              <span className="geometry-metric-label">Ventanas</span>
              <span className="geometry-metric-value">{summary.counts.windows}</span>
            </div>
            <div className="geometry-metric-card">
              <span className="geometry-metric-label">Cubiertas</span>
              <span className="geometry-metric-value">{summary.counts.roofs}</span>
            </div>
          </div>
          <div className="geometry-derived-row">
            {summary.metrics.area != null && (
              <span
                title={
                  summary.metricDisplayUnits?.areaMixed
                    ? 'Varias unidades en el modelo; la suma numérica puede mezclar magnitudes.'
                    : undefined
                }
              >
                Σ Área (~)
                {summary.metricDisplayUnits?.area ? ` (${summary.metricDisplayUnits.area})` : ''}
                {summary.metricDisplayUnits?.areaMixed ? ' *' : ''}
                :{' '}
                <strong>{formatMeasurementDecimals3(summary.metrics.area)}</strong>{' '}
                ({summary.metricSamples.area} valores)
              </span>
            )}
            {summary.metrics.volume != null && (
              <span
                title={
                  summary.metricDisplayUnits?.volumeMixed
                    ? 'Varias unidades en el modelo; la suma numérica puede mezclar magnitudes.'
                    : undefined
                }
              >
                Σ Volumen (~)
                {summary.metricDisplayUnits?.volume ? ` (${summary.metricDisplayUnits.volume})` : ''}
                {summary.metricDisplayUnits?.volumeMixed ? ' *' : ''}
                :{' '}
                <strong>{formatMeasurementDecimals3(summary.metrics.volume)}</strong>{' '}
                ({summary.metricSamples.volume} valores)
              </span>
            )}
            {summary.metrics.length != null && (
              <span
                title={
                  summary.metricDisplayUnits?.lengthMixed
                    ? 'Varias unidades en el modelo; la suma numérica puede mezclar magnitudes.'
                    : undefined
                }
              >
                Σ Longitud / alturas (~)
                {summary.metricDisplayUnits?.length ? ` (${summary.metricDisplayUnits.length})` : ''}
                {summary.metricDisplayUnits?.lengthMixed ? ' *' : ''}
                :{' '}
                <strong>{formatMeasurementDecimals3(summary.metrics.length)}</strong>{' '}
                ({summary.metricSamples.length} valores)
              </span>
            )}
            {summary.metrics.area == null &&
              summary.metrics.volume == null &&
              summary.metrics.length == null && (
                <span className="geometry-no-metrics">No se encontraron campos numéricos típicos de geometría.</span>
              )}
          </div>
          <h5 className="geometry-subtitle">Elementos por categoría integrada</h5>
          <div className="geometry-table-wrap">
            <table className="geometry-summary-table">
              <thead>
                <tr>
                  <th>Categoría integrada</th>
                  <th className="geometry-col-num">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {summary.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td className="geometry-col-num">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.topTypes.length > 0 && (
            <>
              <h5 className="geometry-subtitle">Tipos / familias más frecuentes</h5>
              <div className="geometry-table-wrap">
                <table className="geometry-summary-table geometry-summary-table-compact">
                  <thead>
                    <tr>
                      <th>Tipo o familia</th>
                      <th className="geometry-col-num">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topTypes.map((row) => (
                      <tr key={row.label}>
                        <td className="geometry-type-cell">{row.label}</td>
                        <td className="geometry-col-num">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const BACKEND_ORIGIN =
  process.env.REACT_APP_BACKEND_ORIGIN || 'http://localhost:3000';
const API_BASE =
  process.env.REACT_APP_API_URL || `${BACKEND_ORIGIN}/api`;
const DEMO_CAPTCHA_SITE_KEY =
  process.env.REACT_APP_DEMO_CAPTCHA_SITE_KEY || '';

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile-script="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile));
      existing.addEventListener('error', () =>
        reject(new Error('No se pudo cargar Cloudflare Turnstile'))
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = '1';
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('No se pudo cargar Cloudflare Turnstile'));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

/** Claves para `public/oauth-redirect.html` (evita pantalla en blanco al salir hacia APS). */
const OAUTH_LOGIN_STORAGE_KEY = 'arqfi_oauth_login_url';
const OAUTH_BACKEND_ORIGIN_STORAGE_KEY = 'arqfi_oauth_backend_origin';

/** URL de la página intermedia OAuth (`public/oauth-redirect.html`). */
function getOauthRedirectPageUrl(opts = {}) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const url = new URL(`${base}/oauth-redirect.html`, window.location.origin);
  if (opts.popup) url.searchParams.set('popup', '1');
  return url.toString();
}

const ARQFI_OAUTH_POSTMESSAGE = 'arqfi-oauth-done';

axios.defaults.withCredentials = true;

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  /** Exploración sin OAuth: solo el modelo demo configurado en el servidor. */
  const [demoMode, setDemoMode] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [demoEntryBusy, setDemoEntryBusy] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [hubs, setHubs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contents, setContents] = useState([]);
  const [selectedHub, setSelectedHub] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  /** Pila desde raíz del proyecto hasta la carpeta cuyo contenido se lista: { id, name } */
  const [folderPath, setFolderPath] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [modelData, setModelData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [ossBucket, setOssBucket] = useState('');
  const [ossUploadResult, setOssUploadResult] = useState(null);
  const [ossBusy, setOssBusy] = useState(false);
  const [ossTranslateMsg, setOssTranslateMsg] = useState(null);
  const [ossUploadProgress, setOssUploadProgress] = useState(null);
  const ossFileRef = useRef(null);

  const [ossBucketsList, setOssBucketsList] = useState([]);
  const [ossBucketsLoading, setOssBucketsLoading] = useState(false);
  const [ossSelectedListBucket, setOssSelectedListBucket] = useState(null);
  const [ossObjectsList, setOssObjectsList] = useState([]);
  const [ossObjectsLoading, setOssObjectsLoading] = useState(false);
  const [ossObjectsNext, setOssObjectsNext] = useState(null);
  const [ossDeletingObjectKey, setOssDeletingObjectKey] = useState(null);
  /** Objeto OSS seleccionado en el explorador para extraer datos (no es un ítem de Docs). */
  const [selectedOssObject, setSelectedOssObject] = useState(null);

  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState(null);
  const [propertiesBusy, setPropertiesBusy] = useState(false);
  const [propertiesPayload, setPropertiesPayload] = useState(null);
  const [propertiesError, setPropertiesError] = useState(null);
  const [propertiesGuidLabel, setPropertiesGuidLabel] = useState(null);
  const [categoryMap, setCategoryMap] = useState({});

  const [geometrySummary, setGeometrySummary] = useState(null);
  const [geometrySummaryBusy, setGeometrySummaryBusy] = useState(false);
  const [geometrySummaryError, setGeometrySummaryError] = useState(null);
  const [geometrySummarySourceLabel, setGeometrySummarySourceLabel] = useState('');
  const [geometryReloadTick, setGeometryReloadTick] = useState(0);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  /** Móvil/tablet en modo demo: menú "Demo" con acciones y aviso. */
  const [demoHeaderMenuOpen, setDemoHeaderMenuOpen] = useState(false);
  const demoHeaderMenuRef = useRef(null);
  /** Ventana emergente OAuth (mantiene la app visible mientras Autodesk carga). */
  const oauthPopupRef = useRef(null);
  const oauthPopupPendingRef = useRef(false);
  /** Vista móvil/tablet: tres pestañas en lugar de columnas. */
  const [compactLayout, setCompactLayout] = useState(false);
  const [compactTab, setCompactTab] = useState('hubs');
  const [modelHeaderCollapsed, setModelHeaderCollapsed] = useState(false);
  /** Primera comprobación de sesión: evita parpadeo del login antes de saber si hay cookie. */
  const [authBootstrapPending, setAuthBootstrapPending] = useState(true);
  /** Tras pulsar login: overlay si el navegador va a pantalla completa (sin popup). */
  const [oauthLeaving, setOauthLeaving] = useState(false);
  /** Login en popup: overlay en la ventana principal hasta terminar OAuth. */
  const [oauthPopupPending, setOauthPopupPending] = useState(false);
  const [demoCaptchaConfig, setDemoCaptchaConfig] = useState({
    enabled: false,
    provider: 'turnstile',
    siteKey: DEMO_CAPTCHA_SITE_KEY,
  });
  const [demoCaptchaToken, setDemoCaptchaToken] = useState('');
  const [demoCaptchaError, setDemoCaptchaError] = useState(null);
  const [demoRetryAfterSec, setDemoRetryAfterSec] = useState(0);
  const demoCaptchaContainerRef = useRef(null);
  const demoCaptchaWidgetRef = useRef(null);

  // Verificar autenticación al cargar
  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const apply = () => setCompactLayout(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setModelHeaderCollapsed(compactLayout);
  }, [compactLayout]);

  useEffect(() => {
    if (demoMode && compactLayout) {
      setCompactTab('modelos');
    }
  }, [demoMode, compactLayout]);

  useEffect(() => {
    if (!compactLayout) setDemoHeaderMenuOpen(false);
  }, [compactLayout]);

  useEffect(() => {
    if (!extractResult || extractResult.status !== 'ready' || !extractResult.urnBase64) {
      setGeometrySummary(null);
      setGeometrySummaryError(null);
      setGeometrySummaryBusy(false);
      setGeometrySummarySourceLabel('');
      return;
    }

    let cancelled = false;

    const resolveGuid = async () => {
      const views = extractResult.views || [];
      if (views.length > 0) {
        const v =
          views.find((x) => String(x.role || '').toLowerCase() === '3d') || views[0];
        if (v?.guid) {
          return { guid: v.guid, label: v.name || v.guid };
        }
      }
      const meta = await axios.get(
        `${API_BASE}/metadata/${encodeURIComponent(extractResult.urnBase64)}`
      );
      const metaList = meta.data?.data?.metadata || meta.data?.metadata || [];
      const node =
        metaList.find((m) => String(m.role || '').toLowerCase() === '3d') || metaList[0];
      if (!node?.guid) return null;
      return { guid: node.guid, label: node.name || node.guid };
    };

    (async () => {
      setGeometrySummaryBusy(true);
      setGeometrySummary(null);
      setGeometrySummaryError(null);
      try {
        const target = await resolveGuid();
        if (cancelled) return;
        if (!target) {
          setGeometrySummaryError(
            'No hay vista 3D ni nodos en metadata para cargar propiedades del modelo.'
          );
          return;
        }
        setGeometrySummarySourceLabel(target.label);
        const res = await axios.get(
          `${API_BASE}/properties/${encodeURIComponent(extractResult.urnBase64)}/${encodeURIComponent(target.guid)}`
        );
        if (cancelled) return;
        const sum = buildModelGeometrySummary(res.data);
        if (!sum || !sum.totalElements) {
          setGeometrySummaryError(
            'Las propiedades devueltas no contienen elementos enumerables para el resumen.'
          );
        } else {
          setGeometrySummary(sum);
          setGeometrySummaryError(null);
        }
      } catch (err) {
        if (cancelled) return;
        const st = err.response?.status;
        const d = err.response?.data;
        if (st === 404 || d?.error === 'no_properties') {
          setGeometrySummaryError(
            'APS no publicó base de propiedades para esta vista: no se puede calcular el resumen geométrico.'
          );
        } else {
          const msg =
            d?.details?.diagnostic ||
            (typeof d?.details === 'object' ? JSON.stringify(d.details) : d?.details) ||
            d?.error ||
            err.message;
          setGeometrySummaryError(String(msg));
        }
      } finally {
        if (!cancelled) setGeometrySummaryBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryReloadTick]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onDocClick = (event) => {
      if (!userMenuRef.current?.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!demoHeaderMenuOpen) return undefined;
    const onDocClick = (event) => {
      if (!demoHeaderMenuRef.current?.contains(event.target)) {
        setDemoHeaderMenuOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setDemoHeaderMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [demoHeaderMenuOpen]);

  const demoCaptchaSiteKey = demoCaptchaConfig.siteKey || DEMO_CAPTCHA_SITE_KEY;
  const demoCaptchaRequired =
    !authenticated &&
    !demoMode &&
    demoAvailable &&
    demoCaptchaConfig.enabled &&
    demoCaptchaConfig.provider === 'turnstile' &&
    !!demoCaptchaSiteKey;

  useEffect(() => {
    let disposed = false;
    if (!demoCaptchaRequired) {
      if (window.turnstile && demoCaptchaWidgetRef.current != null) {
        try {
          window.turnstile.remove(demoCaptchaWidgetRef.current);
        } catch {
          // Ignorar: widget ya destruido.
        }
      }
      demoCaptchaWidgetRef.current = null;
      setDemoCaptchaToken('');
      setDemoCaptchaError(null);
      return undefined;
    }

    const mountCaptcha = async () => {
      try {
        const turnstile = await loadTurnstileScript();
        if (disposed || !turnstile || !demoCaptchaContainerRef.current) return;
        if (demoCaptchaWidgetRef.current != null) {
          turnstile.remove(demoCaptchaWidgetRef.current);
          demoCaptchaWidgetRef.current = null;
        }
        demoCaptchaWidgetRef.current = turnstile.render(demoCaptchaContainerRef.current, {
          sitekey: demoCaptchaSiteKey,
          theme: 'light',
          callback: (token) => {
            setDemoCaptchaToken(token || '');
            setDemoCaptchaError(null);
          },
          'expired-callback': () => {
            setDemoCaptchaToken('');
          },
          'error-callback': () => {
            setDemoCaptchaToken('');
            setDemoCaptchaError('No se pudo validar CAPTCHA. Intenta recargar la página.');
          },
        });
      } catch (err) {
        if (!disposed) {
          setDemoCaptchaError(err.message || 'No se pudo cargar CAPTCHA.');
        }
      }
    };

    mountCaptcha();
    return () => {
      disposed = true;
    };
  }, [demoCaptchaRequired, demoCaptchaSiteKey]);

  useEffect(() => {
    if (demoRetryAfterSec <= 0) return undefined;
    const id = window.setInterval(() => {
      setDemoRetryAfterSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [demoRetryAfterSec]);

  /** Auto-fetch de propiedades + árbol de objetos para la vista graphics. */
  useEffect(() => {
    const graphicsGuid = extractResult?.graphicsView?.guid;
    const urn = extractResult?.urnBase64;
    if (extractResult?.status !== 'ready' || !graphicsGuid || !urn) return;

    let cancelled = false;
    setPropertiesBusy(true);
    setPropertiesError(null);
    setPropertiesPayload(null);
    setCategoryMap({});
    setPropertiesGuidLabel(
      extractResult.graphicsView.name || '{3D} — graphics'
    );

    const propsUrl = `${API_BASE}/properties/${encodeURIComponent(urn)}/${encodeURIComponent(graphicsGuid)}`;
    const treeUrl = `${API_BASE}/tree/${encodeURIComponent(urn)}/${encodeURIComponent(graphicsGuid)}`;

    Promise.all([
      axios.get(propsUrl),
      axios.get(treeUrl).catch(() => ({ data: null })),
    ])
      .then(([propsRes, treeRes]) => {
        if (cancelled) return;
        setPropertiesPayload(propsRes.data);
        if (treeRes.data) {
          setCategoryMap(buildCategoryMap(treeRes.data));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const st = err.response?.status;
        const d = err.response?.data;
        if (st === 404 || d?.error === 'no_properties') {
          setPropertiesError('__no_properties__');
        } else {
          const diag =
            d?.details?.diagnostic ||
            (typeof d?.details === 'object'
              ? JSON.stringify(d.details)
              : d?.details) ||
            d?.error ||
            err.message;
          setPropertiesError(String(diag));
        }
      })
      .finally(() => {
        if (!cancelled) setPropertiesBusy(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractResult?.status, extractResult?.graphicsView?.guid, extractResult?.urnBase64]);

  const checkAuth = async () => {
    try {
      const response = await axios.get(`${API_BASE}/status`);
      setAuthenticated(response.data.authenticated);
      setDemoAvailable(!!response.data.demoAvailable);
      const captchaCfg = response.data?.demoCaptcha || {};
      setDemoCaptchaConfig({
        enabled: !!captchaCfg.enabled,
        provider: captchaCfg.provider || 'turnstile',
        siteKey: captchaCfg.siteKey || DEMO_CAPTCHA_SITE_KEY,
      });
      if (response.data.authenticated) {
        fetchUserProfile();
      }
    } catch (err) {
      setError('Error checking authentication');
    } finally {
      setAuthBootstrapPending(false);
    }
  };

  const handleExitDemo = () => {
    setDemoMode(false);
    setExtractResult(null);
    setModelData(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setGeometrySummary(null);
    setGeometrySummaryError(null);
    setCompactTab('hubs');
  };

  const fetchUserProfile = async () => {
    try {
      const response = await axios.get(`${API_BASE}/user-profile`);
      setUserProfile(response.data);
      fetchHubs();
    } catch (err) {
      setError('Error fetching user profile');
    }
  };

  const fetchHubs = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/hubs`);
      setHubs(response.data.data || []);
      setError(null);
    } catch (err) {
      setError('Error fetching hubs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleHubSelect = async (hubId) => {
    setSelectedHub(hubId);
    setSelectedProject(null);
    setFolderPath([]);
    setSelectedFile(null);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setContents([]);
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/hubs/${hubId}/projects`);
      setProjects(response.data.data || []);
      setError(null);
    } catch (err) {
      setError('Error fetching projects: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectContents = async (hubId, projectId, path) => {
    const leaf = path.length > 0 ? path[path.length - 1] : null;
    const url = leaf
      ? `${API_BASE}/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/contents?folderId=${encodeURIComponent(leaf.id)}`
      : `${API_BASE}/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/contents`;
    const response = await axios.get(url);
    setContents(response.data.data || []);
  };

  const handleProjectSelect = async (projectId) => {
    setSelectedProject(projectId);
    setFolderPath([]);
    setSelectedFile(null);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setLoading(true);
    try {
      await fetchProjectContents(selectedHub, projectId, []);
      setError(null);
    } catch (err) {
      setError('Error fetching contents: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const displayName = (item) =>
    item.attributes?.displayName || item.attributes?.name || item.id;

  const formatBytes = (n) => {
    if (n == null || Number.isNaN(Number(n))) return '';
    const v = Number(n);
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fetchOssBuckets = async () => {
    setOssBucketsLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/oss/buckets`, { params: { limit: 50 } });
      setOssBucketsList(res.data.items || []);
      setError(null);
    } catch (err) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message;
      setError(
        'Error listando buckets OSS: ' +
        (typeof msg === 'string' ? msg : JSON.stringify(msg))
      );
    } finally {
      setOssBucketsLoading(false);
    }
  };

  const fetchOssObjects = async (bucketKey, startAt) => {
    setOssObjectsLoading(true);
    try {
      const params = { limit: 50 };
      if (startAt) params.startAt = startAt;
      const res = await axios.get(
        `${API_BASE}/oss/buckets/${encodeURIComponent(bucketKey)}/objects`,
        { params }
      );
      const chunk = res.data.items || [];
      if (startAt) {
        setOssObjectsList((prev) => [...prev, ...chunk]);
      } else {
        setOssObjectsList(chunk);
      }
      setOssObjectsNext(res.data.next || null);
      setError(null);
    } catch (err) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message;
      setError(
        'Error listando objetos OSS: ' +
        (typeof msg === 'string' ? msg : JSON.stringify(msg))
      );
      if (!startAt) setOssObjectsList([]);
    } finally {
      setOssObjectsLoading(false);
    }
  };

  const handleOssBucketListSelect = async (bucketKey) => {
    setOssSelectedListBucket(bucketKey);
    setOssBucket(bucketKey);
    setSelectedOssObject(null);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setOssObjectsNext(null);
    await fetchOssObjects(bucketKey);
  };

  const handleOssObjectSelect = (o) => {
    setSelectedOssObject(o);
    setSelectedFile(null);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setModelData({
      name: o.objectKey,
      type: 'oss.object',
      created: null,
      modified: null,
    });
    setOssUploadResult({
      urn: o.urn,
      urnBase64: o.urnBase64,
      bucketKey: o.bucketKey,
      objectKey: o.objectKey,
      size: o.size,
    });
    setError(null);
    if (window.matchMedia('(max-width: 1024px)').matches) {
      setCompactTab('modelos');
    }
  };

  const handleOssObjectsLoadMore = () => {
    if (!ossSelectedListBucket || !ossObjectsNext) return;
    fetchOssObjects(ossSelectedListBucket, ossObjectsNext);
  };

  const handleOssObjectDelete = async (o, e) => {
    e?.stopPropagation?.();
    if (!o?.bucketKey || !o?.objectKey) return;
    if (
      !window.confirm(
        `¿Eliminar el archivo «${o.objectKey}» del bucket «${o.bucketKey}»? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setOssDeletingObjectKey(`${o.bucketKey}/${o.objectKey}`);
    try {
      await axios.delete(
        `${API_BASE}/oss/buckets/${encodeURIComponent(o.bucketKey)}/objects`,
        { params: { objectKey: o.objectKey } }
      );
      const isDeletedSelected =
        selectedOssObject?.bucketKey === o.bucketKey &&
        selectedOssObject?.objectKey === o.objectKey;
      if (isDeletedSelected) {
        setSelectedOssObject(null);
        setExtractResult(null);
        setPropertiesPayload(null);
        setPropertiesError(null);
        setPropertiesGuidLabel(null);
        setModelData(null);
      }
      const matchesUploadResult =
        ossUploadResult?.bucketKey === o.bucketKey &&
        ossUploadResult?.objectKey === o.objectKey;
      if (matchesUploadResult) {
        setOssUploadResult(null);
      }
      setError(null);
      setOssTranslateMsg(`Archivo «${o.objectKey}» eliminado.`);
      if (ossSelectedListBucket) {
        await fetchOssObjects(ossSelectedListBucket);
      }
    } catch (err) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message;
      setError(
        'Error al eliminar archivo OSS: ' +
        (typeof msg === 'string' ? msg : JSON.stringify(msg))
      );
    } finally {
      setOssDeletingObjectKey(null);
    }
  };

  const handleOssBucketDelete = async (bucketKey, e) => {
    e?.stopPropagation?.();
    if (
      !window.confirm(
        `¿Eliminar el bucket «${bucketKey}» y todo su contenido? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setOssBucketsLoading(true);
    try {
      await axios.delete(`${API_BASE}/oss/buckets/${encodeURIComponent(bucketKey)}`);
      if (ossSelectedListBucket === bucketKey) {
        setOssSelectedListBucket(null);
        setOssObjectsList([]);
        setOssObjectsNext(null);
        setSelectedOssObject(null);
        setOssUploadResult(null);
      }
      if (ossBucket.trim() === bucketKey) {
        setOssBucket('');
      }
      setError(null);
      setOssTranslateMsg(`Bucket «${bucketKey}» eliminado.`);
      await fetchOssBuckets();
    } catch (err) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message;
      setError(
        'Error al eliminar bucket: ' +
        (typeof msg === 'string' ? msg : JSON.stringify(msg))
      );
    } finally {
      setOssBucketsLoading(false);
    }
  };

  const handleFolderOpen = async (folder) => {
    if (folder.type !== 'folders') return;
    const nextPath = [
      ...folderPath,
      { id: folder.id, name: displayName(folder) }
    ];
    setFolderPath(nextPath);
    setSelectedFile(null);
    setLoading(true);
    try {
      await fetchProjectContents(selectedHub, selectedProject, nextPath);
      setError(null);
    } catch (err) {
      setError('Error fetching contents: ' + err.message);
      setFolderPath(folderPath);
    } finally {
      setLoading(false);
    }
  };

  const handleBreadcrumbNavigate = async (depth) => {
    const nextPath = folderPath.slice(0, depth);
    setFolderPath(nextPath);
    setSelectedFile(null);
    setLoading(true);
    try {
      await fetchProjectContents(selectedHub, selectedProject, nextPath);
      setError(null);
    } catch (err) {
      setError('Error fetching contents: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file) => {
    setSelectedFile(file);
    setSelectedOssObject(null);
    setOssUploadResult(null);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    setLoading(true);
    try {
      // Mostrar información básica del archivo
      setModelData({
        name: file.attributes?.displayName,
        type: file.type,
        created: file.attributes?.createTime,
        modified: file.attributes?.lastModifiedTime
      });
      setError(null);
      if (window.matchMedia('(max-width: 1024px)').matches) {
        setCompactTab('modelos');
      }
    } catch (err) {
      setError('Error processing file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyExtractResponse = (data) => {
    if (data.status === 'ready') {
      const views = data.views || [];
      const graphicsView =
        views.find((v) => String(v.role || '').toLowerCase() === 'graphics') ||
        null;
      setExtractResult({
        status: 'ready',
        views,
        thumbnails: data.thumbnails || [],
        otherResources: data.otherResources || [],
        metadataHasPropertyDb: !!data.metadataHasPropertyDb,
        canRetryWithForce: !!data.canRetryWithForce,
        recoveryHint: data.recoveryHint || null,
        manifestStatus: data.manifestStatus || null,
        manifestProgress: data.manifestProgress || null,
        urnBase64: data.urnBase64,
        storageUrnBase64: data.storageUrnBase64,
        source: data.source,
        graphicsView,
      });
    } else if (data.status === 'translation_started') {
      setExtractResult({
        status: 'translation_started',
        message: data.message,
        urnBase64: data.urnBase64,
        format: data.format,
        forced: !!data.forced,
        source: data.source,
      });
    } else if (data.status === 'translating') {
      setExtractResult({
        status: 'translating',
        message: data.message,
        urnBase64: data.urnBase64,
        source: data.source,
      });
    } else {
      setExtractResult({ message: JSON.stringify(data, null, 2) });
    }
  };

  const captureDemoRateLimit = (err) => {
    const status = err?.response?.status;
    if (status !== 429) return 0;
    const rawRetryAfter = err?.response?.headers?.['retry-after'];
    const retryAfter = Number(rawRetryAfter);
    const safeRetryAfter = Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter)) : 60;
    setDemoRetryAfterSec(safeRetryAfter);
    return safeRetryAfter;
  };

  const handleEnterDemo = async () => {
    if (demoCaptchaRequired && !demoCaptchaToken) {
      setError('Completa el CAPTCHA antes de entrar al modo demo.');
      return;
    }
    setDemoEntryBusy(true);
    setDemoRetryAfterSec(0);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/demo/extract`, {
        captchaToken: demoCaptchaToken || undefined,
      });
      const label =
        typeof res.data.demoLabel === 'string' ? res.data.demoLabel : 'Modelo de ejemplo';
      setModelData({
        name: label,
        type: 'demo',
        created: null,
        modified: null,
      });
      applyExtractResponse(res.data);
      setDemoMode(true);
      if (window.matchMedia('(max-width: 1024px)').matches) {
        setCompactTab('modelos');
      }
    } catch (err) {
      const d = err.response?.data;
      const retryAfter = captureDemoRateLimit(err);
      const msg =
        (typeof d?.details === 'object' && d?.details !== null
          ? JSON.stringify(d.details)
          : d?.details) ||
        d?.error ||
        err.message;
      const finalMsg = typeof msg === 'string' ? msg : JSON.stringify(msg);
      setError(
        retryAfter > 0
          ? `${finalMsg} Reintenta en ${retryAfter}s para evitar bloqueo temporal.`
          : finalMsg
      );
      if (window.turnstile && demoCaptchaWidgetRef.current != null) {
        window.turnstile.reset(demoCaptchaWidgetRef.current);
      }
      setDemoCaptchaToken('');
    } finally {
      setDemoEntryBusy(false);
    }
  };

  const handleExtractModel = async (forceReprocess = false) => {
    if (demoMode) {
      setExtractBusy(true);
      setExtractResult(null);
      setPropertiesPayload(null);
      setPropertiesError(null);
      setPropertiesGuidLabel(null);
      try {
        const res = await axios.post(`${API_BASE}/demo/extract`, {
          forceReprocess,
          captchaToken: demoCaptchaToken || undefined,
        });
        applyExtractResponse(res.data);
        setDemoRetryAfterSec(0);
        setError(null);
      } catch (err) {
        const d = err.response?.data;
        const retryAfter = captureDemoRateLimit(err);
        const msg =
          (typeof d?.details === 'object' && d?.details !== null
            ? JSON.stringify(d.details)
            : d?.details) ||
          d?.error ||
          err.message;
        const finalMsg =
          retryAfter > 0
            ? `${String(msg)} Reintenta en ${retryAfter}s para evitar bloqueo temporal.`
            : String(msg);
        setExtractResult({ error: finalMsg });
        const code = d?.code || '';
        if (code === 'captcha_required' && window.turnstile && demoCaptchaWidgetRef.current != null) {
          window.turnstile.reset(demoCaptchaWidgetRef.current);
          setDemoCaptchaToken('');
        }
      } finally {
        setExtractBusy(false);
      }
      return;
    }

    if (selectedOssObject?.urnBase64) {
      setExtractBusy(true);
      setExtractResult(null);
      setPropertiesPayload(null);
      setPropertiesError(null);
      setPropertiesGuidLabel(null);
      try {
        const res = await axios.post(`${API_BASE}/oss/extract`, {
          urnBase64: selectedOssObject.urnBase64,
          forceReprocess,
        });
        applyExtractResponse(res.data);
        setError(null);
      } catch (err) {
        const d = err.response?.data;
        const msg =
          (typeof d?.details === 'object' && d?.details !== null
            ? JSON.stringify(d.details)
            : d?.details) ||
          d?.error ||
          err.message;
        setExtractResult({ error: String(msg) });
      } finally {
        setExtractBusy(false);
      }
      return;
    }

    if (!selectedProject || !selectedFile || selectedFile.type !== 'items') {
      setExtractResult({
        error:
          'Selecciona un archivo de Autodesk Docs o un RVT o NWC en la sección OSS del panel lateral.',
      });
      return;
    }
    setExtractBusy(true);
    setExtractResult(null);
    setPropertiesPayload(null);
    setPropertiesError(null);
    setPropertiesGuidLabel(null);
    try {
      const res = await axios.post(`${API_BASE}/docs/extract`, {
        projectId: selectedProject,
        itemId: selectedFile.id,
        forceReprocess,
      });
      applyExtractResponse(res.data);
      setError(null);
    } catch (err) {
      const d = err.response?.data;
      const msg =
        (typeof d?.details === 'object' && d?.details !== null
          ? JSON.stringify(d.details)
          : d?.details) ||
        d?.error ||
        err.message;
      setExtractResult({ error: String(msg) });
    } finally {
      setExtractBusy(false);
    }
  };

  const fetchPropertiesForGuid = async (guid, viewName) => {
    const urn = extractResult?.urnBase64;
    if (!urn || !guid) return;
    setPropertiesBusy(true);
    setPropertiesError(null);
    setPropertiesPayload(null);
    setPropertiesGuidLabel(viewName || guid);
    try {
      const url = `${API_BASE}/properties/${encodeURIComponent(urn)}/${encodeURIComponent(guid)}`;
      const res = await axios.get(url);
      setPropertiesPayload(res.data);
    } catch (err) {
      const st = err.response?.status;
      const d = err.response?.data;
      if (st === 404 || d?.error === 'no_properties') {
        setPropertiesError('__no_properties__');
      } else {
        const diag =
          d?.details?.diagnostic ||
          (typeof d?.details === 'object' ? JSON.stringify(d.details) : d?.details) ||
          d?.error ||
          err.message;
        setPropertiesError(String(diag));
      }
    } finally {
      setPropertiesBusy(false);
    }
  };

  const handleLogin = () => {
    if (demoMode) {
      handleExitDemo();
    }
    const backendBase = BACKEND_ORIGIN.replace(/\/+$/, '');
    const loginUrl = `${backendBase}/auth/login`;
    let backendOrigin = '';
    try {
      backendOrigin = new URL(loginUrl).origin;
    } catch {
      setError('URL del backend no válida. Revisa REACT_APP_BACKEND_ORIGIN.');
      return;
    }
    try {
      sessionStorage.setItem(OAUTH_LOGIN_STORAGE_KEY, loginUrl);
      sessionStorage.setItem(OAUTH_BACKEND_ORIGIN_STORAGE_KEY, backendOrigin);
    } catch {
      setError('No se pudo guardar el estado de login (sessionStorage bloqueado).');
      return;
    }
    setError(null);
    const popupUrl = getOauthRedirectPageUrl({ popup: true });
    const feat =
      'popup=yes,scrollbars=yes,resizable=yes,width=520,height=720,left=' +
      Math.max(0, Math.round(window.screenX + (window.outerWidth - 520) / 2)) +
      ',top=' +
      Math.max(0, Math.round(window.screenY + (window.outerHeight - 720) / 2));
    const popup = window.open(popupUrl, 'arqfi_oauth', feat);
    if (!popup) {
      setOauthLeaving(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.location.assign(getOauthRedirectPageUrl({ popup: false }));
        });
      });
      return;
    }
    oauthPopupRef.current = popup;
    popup.focus();
    oauthPopupPendingRef.current = true;
    setOauthPopupPending(true);
  };

  /** Cierra popup si sigue abierto y refresca sesión en esta ventana. */
  const finishOAuthPopupFlow = async () => {
    oauthPopupPendingRef.current = false;
    const w = oauthPopupRef.current;
    oauthPopupRef.current = null;
    try {
      if (w && !w.closed) w.close();
    } catch {
      /* ignore */
    }
    setOauthPopupPending(false);
    setOauthLeaving(false);
    await checkAuth();
  };

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== ARQFI_OAUTH_POSTMESSAGE) return;
      if (!oauthPopupPendingRef.current) return;
      void finishOAuthPopupFlow();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!oauthPopupPending) return undefined;
    const id = setInterval(async () => {
      try {
        const response = await axios.get(`${API_BASE}/status`);
        if (response.data.authenticated) {
          void finishOAuthPopupFlow();
        }
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthPopupPending]);

  useEffect(() => {
    if (!oauthPopupPending) return undefined;
    const w = oauthPopupRef.current;
    if (!w) return undefined;
    const id = setInterval(() => {
      if (w.closed) {
        clearInterval(id);
        oauthPopupRef.current = null;
        oauthPopupPendingRef.current = false;
        setOauthPopupPending(false);
        void checkAuth();
      }
    }, 400);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthPopupPending]);

  const handleCreateOssBucket = async () => {
    setOssBusy(true);
    setOssTranslateMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/oss/buckets`, {
        bucketKey: ossBucket.trim() || undefined,
      });
      setOssBucket(res.data.bucketKey);
      setError(null);
      void fetchOssBuckets();
      setOssTranslateMsg(
        res.data.alreadyExists
          ? 'El bucket ya existía; puedes subir un .rvt o .nwc.'
          : 'Bucket creado (transient). Puedes subir un .rvt o .nwc.'
      );
    } catch (err) {
      const msg =
        err.response?.data?.details?.reason ||
        err.response?.data?.error ||
        err.message;
      setError('Error creando bucket OSS: ' + msg);
    } finally {
      setOssBusy(false);
    }
  };

  const handleOssUpload = async () => {
    const bucketKey = ossBucket.trim();
    if (!bucketKey) {
      setError('Indica un nombre de bucket o pulsa «Crear bucket» primero.');
      return;
    }
    const file = ossFileRef.current?.files?.[0];
    if (!file) {
      setError('Selecciona un archivo RVT o NWC para subir a OSS.');
      return;
    }
    const allowedOssExt = ['.rvt', '.nwc'];
    const fileNameLower = String(file.name || '').toLowerCase();
    const hasAllowedExtension = allowedOssExt.some((ext) => fileNameLower.endsWith(ext));
    if (!hasAllowedExtension) {
      setError('Solo se permiten archivos .rvt o .nwc para OSS.');
      return;
    }
    setOssBusy(true);
    setOssTranslateMsg(null);
    setOssUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(
        `${API_BASE}/oss/buckets/${encodeURIComponent(bucketKey)}/upload`,
        formData,
        {
          onUploadProgress: (ev) => {
            if (ev.total) {
              setOssUploadProgress(Math.round((ev.loaded / ev.total) * 100));
            }
          },
        }
      );
      setOssUploadResult(res.data);
      setError(null);
      setOssTranslateMsg(
        res.data.createdBucket
          ? 'Se creó el bucket y el archivo se subió correctamente.'
          : 'Archivo subido a OSS. Puedes solicitar la traducción (Model Derivative).'
      );
      if (ossSelectedListBucket === bucketKey) {
        await fetchOssObjects(bucketKey);
      }
    } catch (err) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message;
      setError('Error subiendo a OSS: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
      setOssUploadResult(null);
    } finally {
      setOssBusy(false);
      setOssUploadProgress(null);
    }
  };

  const handleOssTranslate = async () => {
    if (!ossUploadResult?.urnBase64) return;
    setOssBusy(true);
    setOssTranslateMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/translate`, {
        urnBase64: ossUploadResult.urnBase64,
      });
      setError(null);
      setOssTranslateMsg(
        'Job de traducción enviado. Revisa result en APS: ' +
        JSON.stringify(res.data?.result || res.data)
      );
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError('Error en traducción: ' + msg);
    } finally {
      setOssBusy(false);
    }
  };

  if (authBootstrapPending) {
    return (
      <div
        className="app-container login-container arqfi-auth-loading-screen"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="login-box arqfi-auth-loading-box">
          <div className="arqfi-auth-spinner" aria-hidden="true" />
          <p className="arqfi-auth-loading-title">Comprobando sesión…</p>
          <p className="arqfi-auth-loading-hint">Conectando con el servidor.</p>
        </div>
      </div>
    );
  }

  if (!authenticated && !demoMode) {
    return (
      <div className="app-container login-container">
        <div className="login-box">
          <h1>📐 ARQFI APS Data Extractor</h1>
          <p>Extrae datos y propiedades de tus modelos RVT y NWC usando APS</p>
          <p className="login-tagline">
            Inicia sesión con Autodesk para ver tus proyectos y modelos.
          </p>
          <p className="login-popup-hint">
            Se abrirá una ventana de Autodesk. Mantén esta página abierta; si el navegador bloquea
            ventanas emergentes, se usará redirección en la misma pestaña.
          </p>
          <button
            type="button"
            onClick={handleLogin}
            className="login-btn"
            disabled={oauthLeaving || oauthPopupPending || demoEntryBusy}
          >
            {oauthLeaving
              ? 'Redirigiendo…'
              : oauthPopupPending
                ? 'Completa el inicio de sesión…'
                : 'Iniciar sesión con Autodesk'}
          </button>
          {demoAvailable ? (
            <>
              <p className="login-demo-sep" aria-hidden="true">
                o
              </p>
              <button
                type="button"
                onClick={() => void handleEnterDemo()}
                className="login-btn login-btn-demo"
                disabled={
                  oauthLeaving ||
                  oauthPopupPending ||
                  demoEntryBusy ||
                  demoRetryAfterSec > 0 ||
                  (demoCaptchaRequired && !demoCaptchaToken)
                }
              >
                {demoEntryBusy
                  ? 'Cargando demo…'
                  : demoRetryAfterSec > 0
                    ? `Espera ${demoRetryAfterSec}s…`
                    : 'Solo ver demo'}
              </button>
              {demoCaptchaRequired ? (
                <div className="login-demo-captcha-wrap">
                  <div ref={demoCaptchaContainerRef} className="login-demo-captcha" />
                  {demoCaptchaError ? (
                    <p className="login-demo-captcha-error">{demoCaptchaError}</p>
                  ) : null}
                </div>
              ) : null}
              <p className="login-demo-hint">
                Modelo de ejemplo alojado por la app (consume cuota del servidor). Para tus RVT o
                NWC en la nube, usa el inicio de sesión.
              </p>
              {error ? <div className="error-banner">{error}</div> : null}
            </>
          ) : (
            <p className="login-demo-unavailable">
              La demo sin cuenta no está disponible en este servidor (falta configurar el modelo de
              ejemplo).
            </p>
          )}
        </div>
        {oauthPopupPending ? (
          <div className="arqfi-oauth-overlay" role="status" aria-live="polite" aria-busy="true">
            <div className="arqfi-auth-spinner" aria-hidden="true" />
            <p className="arqfi-oauth-overlay-title">Inicio de sesión en curso</p>
            <p className="arqfi-oauth-overlay-hint">
              Completa los pasos en la ventana emergente de Autodesk (puede verse en blanco unos
              segundos; es habitual). Cuando termine, esta página continuará sola.
            </p>
          </div>
        ) : null}
        {oauthLeaving ? (
          <div className="arqfi-oauth-overlay" role="status" aria-live="polite" aria-busy="true">
            <div className="arqfi-auth-spinner" aria-hidden="true" />
            <p className="arqfi-oauth-overlay-title">Redirigiendo a Autodesk</p>
            <p className="arqfi-oauth-overlay-hint">
              Si la siguiente pantalla queda en blanco unos segundos, suele ser normal durante la
              autorización.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  const userInitials = `${userProfile?.firstName?.[0] || ''}${userProfile?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>📐 ARQFI APS Data Extractor</h1>
        <div className="header-user-actions" ref={userMenuRef}>
          {demoMode && !authenticated ? (
            compactLayout ? (
              <div className="demo-header-menu-wrap" ref={demoHeaderMenuRef}>
                <button
                  type="button"
                  className="demo-header-menu-trigger"
                  aria-haspopup="menu"
                  aria-expanded={demoHeaderMenuOpen}
                  aria-controls="demo-header-actions-menu"
                  onClick={() => setDemoHeaderMenuOpen((prev) => !prev)}
                >
                  Demo
                </button>
                {demoHeaderMenuOpen ? (
                  <div
                    id="demo-header-actions-menu"
                    className="demo-header-menu-dropdown"
                    role="menu"
                    aria-label="Opciones de modo demostración"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="demo-header-menu-btn demo-header-menu-btn-primary"
                      disabled={oauthLeaving || oauthPopupPending}
                      onClick={() => {
                        setDemoHeaderMenuOpen(false);
                        handleLogin();
                      }}
                    >
                      Iniciar sesión con Autodesk
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="demo-header-menu-btn demo-header-menu-btn-secondary"
                      onClick={() => {
                        setDemoHeaderMenuOpen(false);
                        handleExitDemo();
                      }}
                    >
                      Salir de la demo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="demo-header-menu-btn demo-header-menu-btn-info"
                      onClick={() => setDemoHeaderMenuOpen(false)}
                    >
                      Estás viendo un modelo de ejemplo. Inicia sesión con Autodesk para explorar tus
                      proyectos y archivos en la nube.
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <span className="header-demo-badge" title="Sin acceso a tus hubs hasta iniciar sesión">
                  Modo demo
                </span>
                <button
                  type="button"
                  className="header-demo-login-btn"
                  onClick={handleLogin}
                  disabled={oauthLeaving || oauthPopupPending}
                >
                  Iniciar sesión con Autodesk
                </button>
                <button type="button" className="header-demo-exit-btn" onClick={handleExitDemo}>
                  Salir de la demo
                </button>
              </>
            )
          ) : (
            <>
              {userProfile && (
                <span className="user-info user-info-inline">
                  {userProfile.firstName} {userProfile.lastName}
                </span>
              )}
              <button
                type="button"
                className="user-menu-trigger"
                aria-label="Menú de usuario"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((prev) => !prev)}
              >
                <span className="user-menu-initials">{userInitials}</span>
              </button>
              {userMenuOpen && (
                <div className="user-menu-dropdown" role="menu" aria-label="Acciones de sesión">
                  {userProfile && (
                    <p className="user-menu-name">
                      {userProfile.firstName} {userProfile.lastName}
                    </p>
                  )}
                  <a href={`${BACKEND_ORIGIN}/logout`} className="logout-btn user-menu-logout" role="menuitem">
                    Logout
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {demoMode && !authenticated && !compactLayout ? (
        <div className="demo-mode-banner" role="status">
          Estás viendo un modelo de ejemplo. Inicia sesión con Autodesk para explorar tus proyectos
          y archivos en la nube.
        </div>
      ) : null}

      {error && <div className="error-banner">{error}</div>}

      <div className={`app-workspace${compactLayout ? ' app-workspace--tabs' : ''}`}>
        {compactLayout && !demoMode && (
          <div className="compact-tab-bar" role="tablist" aria-label="Secciones de la aplicación">
            <button
              type="button"
              role="tab"
              aria-selected={compactTab === 'hubs'}
              className={`compact-tab${compactTab === 'hubs' ? ' compact-tab-active' : ''}`}
              onClick={() => setCompactTab('hubs')}
            >
              Hubs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={compactTab === 'modelos'}
              className={`compact-tab${compactTab === 'modelos' ? ' compact-tab-active' : ''}`}
              onClick={() => setCompactTab('modelos')}
            >
              Modelos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={compactTab === 'subida'}
              className={`compact-tab${compactTab === 'subida' ? ' compact-tab-active' : ''}`}
              onClick={() => setCompactTab('subida')}
            >
              OSS
            </button>
          </div>
        )}

        <div className={`main-layout${compactLayout ? ' main-layout--compact-tabs' : ''}`}>
          {/* Panel izquierdo: Navegación */}
          {(!compactLayout || compactTab === 'hubs') && !demoMode && (
            <aside
              className={`sidebar sidebar-left${!compactLayout && leftSidebarCollapsed ? ' sidebar-collapsed' : ''}`}
              aria-label="Panel de navegación"
            >
              {!compactLayout && (
                <div className="sidebar-toggle-row sidebar-toggle-row-left">
                  <button
                    type="button"
                    className="sidebar-toggle-btn"
                    aria-label={
                      leftSidebarCollapsed ? 'Expandir panel izquierdo' : 'Comprimir panel izquierdo'
                    }
                    onClick={() => setLeftSidebarCollapsed((prev) => !prev)}
                  >
                    {leftSidebarCollapsed ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M15 6l-6 6 6 6" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
              {(compactLayout || !leftSidebarCollapsed) && (
                <>
                  <div className="section">
                    <h3>Hubs</h3>
                    {loading && <p className="loading">Cargando...</p>}
                    {hubs.length === 0 && !loading && <p className="empty">No hubs available</p>}
                    <ul className="item-list">
                      {hubs.map(hub => (
                        <li
                          key={hub.id}
                          className={selectedHub === hub.id ? 'active' : ''}
                          onClick={() => handleHubSelect(hub.id)}
                        >
                          {hub.attributes.name}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {selectedHub && (
                    <div className="section">
                      <h3>Proyectos</h3>
                      {loading && <p className="loading">Cargando...</p>}
                      {projects.length === 0 && !loading && <p className="empty">No projects</p>}
                      <ul className="item-list">
                        {projects.map(project => (
                          <li
                            key={project.id}
                            className={selectedProject === project.id ? 'active' : ''}
                            onClick={() => handleProjectSelect(project.id)}
                          >
                            {project.attributes.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedProject && (
                    <div className="section">
                      <h3>Archivos</h3>
                      <nav className="folder-breadcrumb" aria-label="Ruta de carpetas">
                        <button
                          type="button"
                          className={`folder-crumb${folderPath.length === 0 ? ' folder-crumb-current' : ''}`}
                          onClick={() => handleBreadcrumbNavigate(0)}
                        >
                          Raíz del proyecto
                        </button>
                        {folderPath.map((seg, i) => (
                          <span key={`${seg.id}-${i}`} className="folder-breadcrumb-sep">
                            <span className="folder-breadcrumb-slash" aria-hidden="true">
                              /
                            </span>
                            <button
                              type="button"
                              className={`folder-crumb${i === folderPath.length - 1 ? ' folder-crumb-current' : ''}`}
                              onClick={() => handleBreadcrumbNavigate(i + 1)}
                            >
                              {seg.name}
                            </button>
                          </span>
                        ))}
                      </nav>
                      {loading && <p className="loading">Cargando...</p>}
                      {contents.length === 0 && !loading && <p className="empty">No files</p>}
                      <ul className="item-list">
                        {contents.map(item => (
                          <li
                            key={item.id}
                            className={
                              item.type === 'folders'
                                ? 'item-folder'
                                : selectedFile?.id === item.id
                                  ? 'active'
                                  : ''
                            }
                            onClick={() =>
                              item.type === 'folders'
                                ? handleFolderOpen(item)
                                : item.type === 'items' && handleFileSelect(item)
                            }
                          >
                            {item.type === 'folders' ? '📁' : '📄'}{' '}
                            {displayName(item)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="section oss-explorer-section">
                    <h3>OSS | Object Storage Service</h3>
                    <p className="oss-explorer-hint">
                      Buckets y objetos de la aplicación APS (no aparecen en Hubs/Docs).
                    </p>
                    <button
                      type="button"
                      className="oss-explorer-refresh"
                      onClick={fetchOssBuckets}
                      disabled={ossBucketsLoading || ossBusy}
                    >
                      {ossBucketsLoading ? 'Cargando buckets…' : 'Actualizar buckets'}
                    </button>
                    {ossBucketsList.length === 0 && !ossBucketsLoading && (
                      <p className="empty oss-explorer-empty">Pulsa «Actualizar buckets» para listar.</p>
                    )}
                    <ul className="item-list oss-bucket-list">
                      {ossBucketsList.map((b) => (
                        <li
                          key={b.bucketKey}
                          className={
                            ossSelectedListBucket === b.bucketKey ? 'active oss-bucket-li' : 'oss-bucket-li'
                          }
                          onClick={() => handleOssBucketListSelect(b.bucketKey)}
                        >
                          <div className="oss-bucket-row-main">
                            <span className="oss-bucket-key">{b.bucketKey}</span>
                            <span className="oss-bucket-policy">{b.policyKey || '—'}</span>
                          </div>
                          <div className="oss-bucket-actions" onClick={(e) => e.stopPropagation()} role="group" aria-label="Acciones del bucket">
                            <button
                              type="button"
                              className="oss-bucket-action-btn oss-bucket-action-danger"
                              title="Eliminar bucket y todo su contenido"
                              disabled={ossBucketsLoading || ossBusy}
                              onClick={(e) => handleOssBucketDelete(b.bucketKey, e)}
                            >
                              Eliminar
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {ossSelectedListBucket && (
                      <div className="oss-objects-block">
                        <h4 className="oss-objects-heading">Objetos en «{ossSelectedListBucket}»</h4>
                        {ossObjectsLoading && ossObjectsList.length === 0 && (
                          <p className="loading">Cargando objetos…</p>
                        )}
                        <ul className="item-list oss-object-list">
                          {ossObjectsList
                            .filter((o) => /\.rvt$/i.test(o.objectKey))
                            .map((o) => (
                              <li
                                key={`${o.bucketKey}/${o.objectKey}`}
                                className={
                                  selectedOssObject?.objectKey === o.objectKey &&
                                    selectedOssObject?.bucketKey === o.bucketKey
                                    ? 'active'
                                    : ''
                                }
                                onClick={() => handleOssObjectSelect(o)}
                              >
                                <span className="oss-obj-name">📄 {o.objectKey}</span>
                                {o.size != null ? (
                                  <span className="oss-obj-size">{formatBytes(o.size)}</span>
                                ) : null}
                                <div
                                  className="oss-obj-actions"
                                  onClick={(e) => e.stopPropagation()}
                                  role="group"
                                  aria-label="Acciones del archivo"
                                >
                                  <button
                                    type="button"
                                    className="oss-bucket-action-btn oss-bucket-action-danger"
                                    title="Eliminar archivo del bucket"
                                    disabled={
                                      ossObjectsLoading ||
                                      !!ossDeletingObjectKey ||
                                      ossBusy
                                    }
                                    onClick={(e) => handleOssObjectDelete(o, e)}
                                  >
                                    {ossDeletingObjectKey === `${o.bucketKey}/${o.objectKey}`
                                      ? 'Eliminando…'
                                      : 'Eliminar'}
                                  </button>
                                </div>
                              </li>
                            ))}
                        </ul>
                        {ossObjectsList.length > 0 &&
                          ossObjectsList.filter((o) => /\.rvt$/i.test(o.objectKey)).length === 0 && (
                            <p className="empty">No hay archivos .rvt en este bucket.</p>
                          )}
                        {ossObjectsNext && (
                          <button
                            type="button"
                            className="oss-more-btn"
                            onClick={handleOssObjectsLoadMore}
                            disabled={ossObjectsLoading}
                          >
                            {ossObjectsLoading ? 'Cargando…' : 'Más objetos…'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>
          )}

          {(!compactLayout || compactTab === 'modelos') && (
            <main className={`content${compactLayout ? ' content--compact-tab' : ''}`}>
              <div className="content-body">
                {selectedFile || selectedOssObject || demoMode ? (
                  <div className="model-data">
                    <section className="model-summary-card">
                      <div className="model-summary-head">
                        <h2>{modelData?.name}</h2>
                        <button
                          type="button"
                          className="model-summary-toggle"
                          aria-expanded={!modelHeaderCollapsed}
                          aria-label={
                            modelHeaderCollapsed
                              ? 'Expandir resumen del modelo'
                              : 'Comprimir resumen del modelo'
                          }
                          onClick={() => setModelHeaderCollapsed((prev) => !prev)}
                        >
                          {modelHeaderCollapsed ? '▾' : '▴'}
                        </button>
                      </div>

                      {!modelHeaderCollapsed && (
                        <>
                          {demoMode && modelData?.type === 'demo' && (
                            <p className="model-source-demo">
                              Modo demostración: usa este modelo RVT de ejemplo para probar cómo funciona la extracción de propiedades y métricas antes de trabajar con tus propios archivos. De esta manera, puedes consultar la información del modelo sin necesidad de tener una licencia ni abrir el archivo en Revit.
                            </p>
                          )}
                          {selectedOssObject && (
                            <p className="model-source-oss">
                              Origen: almacenamiento OSS · bucket{' '}
                              <code>{selectedOssObject.bucketKey}</code>
                            </p>
                          )}
                          {!demoMode && (
                            <>
                              <div className="info-grid">
                                <div className="info-item">
                                  <span className="label">Tipo:</span>
                                  <span className="value">{modelData?.type}</span>
                                </div>
                                <div className="info-item">
                                  <span className="label">Creado:</span>
                                  <span className="value">
                                    {formatDateTimeEs(modelData?.created)}
                                  </span>
                                </div>
                                <div className="info-item">
                                  <span className="label">Modificado:</span>
                                  <span className="value">
                                    {formatDateTimeEs(modelData?.modified)}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="extract-btn"
                                onClick={() => handleExtractModel(false)}
                                disabled={
                                  extractBusy ||
                                  (selectedOssObject
                                    ? !selectedOssObject.urnBase64
                                    : !selectedProject || selectedFile?.type !== 'items')
                                }
                              >
                                {extractBusy ? 'Extrayendo…' : 'Extraer Datos del Modelo'}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </section>
                    {extractResult?.error && (
                      <p className="extract-error" role="alert">
                        {extractResult.error}
                      </p>
                    )}
                    {(extractResult?.status === 'translation_started' ||
                      extractResult?.status === 'translating') && (
                        <p className="extract-info" role="status">
                          {extractResult.message}
                          {extractResult.format && (
                            <> &nbsp;(<strong>{extractResult.format.toUpperCase()}</strong>)</>
                          )}
                          {extractResult.forced && (
                            <> &nbsp;<strong>(reproceso forzado)</strong></>
                          )}
                        </p>
                      )}
                    {extractResult?.status === 'ready' && (
                      <div className="extract-success" role="status">
                        {!demoMode && (
                          <div className="extract-status-bar">
                            <span className="extract-status-badge">✓ Modelo listo</span>
                            {extractResult.graphicsView ? (
                              <span className="extract-status-source">
                                Vista: <strong>{extractResult.graphicsView.name || '{3D} — graphics'}</strong>
                              </span>
                            ) : (
                              <span className="extract-status-warn">
                                Vista «graphics» no encontrada automáticamente
                              </span>
                            )}
                            <div className="extract-status-actions">
                              <button
                                type="button"
                                className="extract-btn extract-btn-secondary extract-btn-sm"
                                onClick={() => handleExtractModel(false)}
                                disabled={extractBusy || propertiesBusy}
                              >
                                Recargar
                              </button>
                              {extractResult.canRetryWithForce && (
                                <button
                                  type="button"
                                  className="extract-btn extract-btn-secondary extract-btn-sm"
                                  onClick={() => handleExtractModel(true)}
                                  disabled={extractBusy || propertiesBusy}
                                >
                                  Reprocesar forzado
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Cargando propiedades */}
                        {propertiesBusy && (
                          <p className="extract-info">
                            Cargando propiedades del modelo…
                          </p>
                        )}

                        {!demoMode && propertiesGuidLabel && (
                          <p className="extract-hint">
                            Fuente de propiedades: <strong>{propertiesGuidLabel}</strong>
                          </p>
                        )}

                        {!demoMode && (
                          <GeometrySummaryPanel
                            summary={geometrySummary}
                            busy={geometrySummaryBusy}
                            error={geometrySummaryError}
                            sourceLabel={geometrySummarySourceLabel}
                            onReload={() => setGeometryReloadTick((tick) => tick + 1)}
                            reloadDisabled={extractBusy || propertiesBusy || geometrySummaryBusy}
                          />
                        )}

                        {/* Propiedades cargadas → tabla directa */}
                        {propertiesPayload && !propertiesBusy && (
                          <div className="extract-properties-panel">
                            <ModelAnalyticsPanel payload={propertiesPayload} categoryMap={categoryMap} />
                          </div>
                        )}

                        {/* Error genérico */}
                        {propertiesError && propertiesError !== '__no_properties__' && !propertiesBusy && (
                          <p className="extract-error extract-error-tight" role="alert">
                            {propertiesError}
                          </p>
                        )}

                        {/* No hay graphics view — fallback a lista manual */}
                        {!extractResult.graphicsView && !propertiesBusy && !propertiesPayload && (
                          <div className="extract-fallback">
                            <p className="extract-hint">
                              No se detectó la vista <em>graphics</em> automáticamente.
                              Selecciona una vista manualmente:
                            </p>
                            {extractResult.views.length > 0 ? (
                              <ul className="extract-view-list">
                                {extractResult.views.map((v) => (
                                  <li key={v.guid}>
                                    <div className="extract-view-row">
                                      <div className="extract-view-main">
                                        <strong>{v.name || '(sin nombre)'}</strong>
                                        {v.role ? ` — ${v.role}` : ''}
                                        <br />
                                        <span className="extract-guid">{v.guid}</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="extract-prop-btn"
                                        onClick={() => fetchPropertiesForGuid(v.guid, v.name)}
                                        disabled={propertiesBusy}
                                      >
                                        Propiedades
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="extract-empty-section">No hay vistas disponibles en este manifest.</p>
                            )}
                          </div>
                        )}

                        {/* Sin base de propiedades (APS 404) — ofrecer reproceso + fallback manual */}
                        {propertiesError === '__no_properties__' && !propertiesBusy && (
                          <div className="extract-fallback">
                            <p className="extract-hint">
                              APS no publicó la base de propiedades para esta vista.
                              Prueba con <strong>Reprocesar forzado</strong> o selecciona otra vista:
                            </p>
                            {!extractResult.canRetryWithForce && (
                              <button
                                type="button"
                                className="extract-btn extract-btn-secondary"
                                onClick={() => handleExtractModel(true)}
                                disabled={extractBusy}
                              >
                                Reprocesar forzado
                              </button>
                            )}
                            {extractResult.views.length > 0 && (
                              <ul className="extract-view-list" style={{ marginTop: '0.75rem' }}>
                                {extractResult.views.map((v) => (
                                  <li key={v.guid}>
                                    <div className="extract-view-row">
                                      <div className="extract-view-main">
                                        <strong>{v.name || '(sin nombre)'}</strong>
                                        {v.role ? ` — ${v.role}` : ''}
                                      </div>
                                      <button
                                        type="button"
                                        className="extract-prop-btn"
                                        onClick={() => fetchPropertiesForGuid(v.guid, v.name)}
                                        disabled={propertiesBusy}
                                      >
                                        Propiedades
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      {compactLayout ? (
                        <>
                          Selecciona un modelo RVT o NWC en la pestaña <strong>HUBS</strong> o en la pestaña <strong>OSS</strong> y luego revisa los datos aquí en{' '}
                          <strong>Modelos</strong>.
                        </>
                      ) : (
                        <>
                          Selecciona un modelo RVT o NWC desde los <strong>HUBS</strong> o en la sección <strong>OSS</strong> en la barra lateral.
                        </>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </main>
          )}

          {(!compactLayout || compactTab === 'subida') && !demoMode && (
            <aside
              className={`sidebar sidebar-right${!compactLayout && rightSidebarCollapsed ? ' sidebar-collapsed' : ''}`}
              aria-label="Panel de subida OSS"
            >
              {!compactLayout && (
                <div className="sidebar-toggle-row sidebar-toggle-row-right">
                  <button
                    type="button"
                    className="sidebar-toggle-btn"
                    aria-label={
                      rightSidebarCollapsed ? 'Expandir panel derecho' : 'Comprimir panel derecho'
                    }
                    onClick={() => setRightSidebarCollapsed((prev) => !prev)}
                  >
                    {rightSidebarCollapsed ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M15 6l-6 6 6 6" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
              {(compactLayout || !rightSidebarCollapsed) && (
                <div className="section oss-upload-section" aria-labelledby="oss-heading">
                  <h3 id="oss-heading"> OSS</h3>
                  <p className="oss-explorer-hint">
                    Subida vía URLs firmadas S3 (Direct-to-S3). Token de aplicación (2-legged) en el servidor.
                    Bucket <code>transient</code> (~24 h). Límite de subida: 100 MB.
                  </p>
                  <div className="oss-upload-form-block">
                    <div className="oss-row">
                      <label className="oss-label" htmlFor="oss-bucket">
                        Nombre del bucket
                      </label>
                      <input
                        id="oss-bucket"
                        type="text"
                        className="oss-input"
                        placeholder="vacío = nombre autogenerado al crear"
                        value={ossBucket}
                        onChange={(e) => setOssBucket(e.target.value)}
                        disabled={ossBusy}
                      />
                    </div>
                    <div className="oss-upload-actions">
                      <button
                        type="button"
                        className="oss-section-btn"
                        onClick={handleCreateOssBucket}
                        disabled={ossBusy}
                      >
                        Crear bucket
                      </button>
                      <input
                        ref={ossFileRef}
                        type="file"
                        accept=".rvt,.nwc"
                        className="oss-file"
                        disabled={ossBusy}
                      />
                      <button
                        type="button"
                        className="oss-section-btn oss-section-btn-accent"
                        onClick={handleOssUpload}
                        disabled={ossBusy}
                      >
                        {ossBusy && ossUploadProgress != null
                          ? `Subiendo… ${ossUploadProgress}%`
                          : 'Subir Modelo'}
                      </button>
                      <button
                        type="button"
                        className="oss-section-btn"
                        onClick={handleOssTranslate}
                        disabled={ossBusy || !ossUploadResult?.urnBase64}
                      >
                        Traducir (SVF2)
                      </button>
                    </div>
                    {ossUploadProgress != null && (
                      <div className="oss-upload-progress-wrap" aria-hidden="true">
                        <div
                          className="oss-upload-progress-bar"
                          style={{ width: `${ossUploadProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {ossTranslateMsg && (
                    <p className="oss-success" role="status">
                      {ossTranslateMsg}
                    </p>
                  )}
                  {ossUploadResult && (
                    <dl className="oss-result oss-upload-result-block">
                      <dt>URN</dt>
                      <dd className="oss-mono">{ossUploadResult.urn}</dd>
                      <dt>urnBase64</dt>
                      <dd className="oss-mono oss-break">{ossUploadResult.urnBase64}</dd>
                    </dl>
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
