export interface SeriesGroup {
  seriesInstanceUid: string;
  sopInstanceUids: string[];
}

/**
 * A study's instances as one stack per series. Order is kept as given: the
 * API lists instances by SeriesNumber, then InstanceNumber, so each stack
 * comes out in slice order.
 */
export function groupSeries(
  instances: { sopInstanceUid: string; seriesInstanceUid: string }[],
): SeriesGroup[] {
  const groups = new Map<string, string[]>();
  for (const i of instances) {
    const list = groups.get(i.seriesInstanceUid) ?? [];
    list.push(i.sopInstanceUid);
    groups.set(i.seriesInstanceUid, list);
  }
  return [...groups].map(([seriesInstanceUid, sopInstanceUids]) => ({
    seriesInstanceUid,
    sopInstanceUids,
  }));
}
