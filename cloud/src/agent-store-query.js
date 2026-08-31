export const AGENT_SNAPSHOT_KIND_LIMITS = Object.freeze({
  set: 1200,
  meal: 250,
  supplement: 250,
  bodyweight: 120,
  habit: 180,
  steps: 120
});
export const MAX_AGENT_SNAPSHOT_ROWS = Object.values(AGENT_SNAPSHOT_KIND_LIMITS)
  .reduce((total, limit) => total + limit, 0);
export const AGENT_SNAPSHOT_KIND_SCAN_LIMITS = Object.freeze(
  Object.fromEntries(Object.entries(AGENT_SNAPSHOT_KIND_LIMITS)
    .map(([kind, limit]) => [kind, limit * 4]))
);
export const MAX_AGENT_SNAPSHOT_SCAN_ROWS = Object.values(AGENT_SNAPSHOT_KIND_SCAN_LIMITS)
  .reduce((total, limit) => total + limit, 0);

/**
 * Build one indexed range query per record kind. The primary key is (ns, key), so
 * each query can stop at its own LIMIT without sorting or scanning the other kinds.
 * The larger scan LIMIT lets the caller discard corrupt records before applying
 * the smaller agent-context cap. Both ceilings are fixed and independently
 * reported, so a hostile namespace cannot create unbounded work or silent gaps.
 */
export function datedExportQueries({ ns, keyPrefix, kinds, oldest, through }) {
  return kinds.map(kind => {
    const limit = AGENT_SNAPSHOT_KIND_LIMITS[kind];
    if (!limit) throw new Error(`unsupported dated record kind: ${kind}`);
    const scanLimit = AGENT_SNAPSHOT_KIND_SCAN_LIMITS[kind];
    const datedPrefix = `${keyPrefix}${kind}:`;
    const dateStart = datedPrefix.length + 1;
    const keyEndingClause = kind === 'bodyweight' || kind === 'steps'
      ? 'AND length(key) = ?'
      : "AND substr(key, ?, 1) = ':'";
    const keyEndingParam = kind === 'bodyweight' || kind === 'steps'
      ? datedPrefix.length + 10
      : dateStart + 10;
    return {
      kind,
      limit,
      scanLimit,
      sql: `SELECT key, value, updated FROM records
        WHERE ns = ? AND deleted = 0 AND key >= ? AND key < ?
          AND length(CAST(key AS BLOB)) <= 512 AND length(CAST(value AS BLOB)) <= 8192
          AND substr(key, ?, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND date(substr(key, ?, 10), '+0 days') = substr(key, ?, 10)
          ${keyEndingClause}
        ORDER BY key DESC LIMIT ?`,
      params: [
        ns,
        `${datedPrefix}${oldest}`,
        `${datedPrefix}${through}\uffff`,
        dateStart,
        dateStart,
        dateStart,
        keyEndingParam,
        scanLimit + 1
      ]
    };
  });
}

export function capDatedExport(rowsByKind, isCandidate = () => true) {
  const candidateLimitedKinds = [];
  const sourceScanLimitedKinds = [];
  const rows = [];
  for (const [kind, kindRows] of Object.entries(rowsByKind)) {
    const limit = AGENT_SNAPSHOT_KIND_LIMITS[kind];
    const scanLimit = AGENT_SNAPSHOT_KIND_SCAN_LIMITS[kind];
    if (kindRows.length > scanLimit) sourceScanLimitedKinds.push(kind);
    const candidates = kindRows.slice(0, scanLimit)
      .filter(row => isCandidate(kind, row));
    if (candidates.length > limit) candidateLimitedKinds.push(kind);
    rows.push(...candidates.slice(0, limit));
  }
  const limitedKinds = [...new Set([...candidateLimitedKinds, ...sourceScanLimitedKinds])];
  return {
    limited: limitedKinds.length > 0,
    limitedKinds,
    candidateLimitReached: candidateLimitedKinds.length > 0,
    candidateLimitedKinds,
    sourceScanLimitReached: sourceScanLimitedKinds.length > 0,
    sourceScanLimitedKinds,
    rows
  };
}
