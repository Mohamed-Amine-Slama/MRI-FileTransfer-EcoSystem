import { describe, expect, it } from 'vitest';
import { groupSeries } from './series';

describe('groupSeries', () => {
  it('groups by series in first-appearance order', () => {
    expect(
      groupSeries([
        { sopInstanceUid: 'a1', seriesInstanceUid: 'A' },
        { sopInstanceUid: 'b1', seriesInstanceUid: 'B' },
        { sopInstanceUid: 'a2', seriesInstanceUid: 'A' },
      ]),
    ).toEqual([
      { seriesInstanceUid: 'A', sopInstanceUids: ['a1', 'a2'] },
      { seriesInstanceUid: 'B', sopInstanceUids: ['b1'] },
    ]);
  });

  it('is empty for no instances', () => expect(groupSeries([])).toEqual([]));
});
