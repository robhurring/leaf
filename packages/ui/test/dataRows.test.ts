import { describe, it, expect } from 'vitest';
import { latLonKeys, parseRows } from '../src/data/rows.js';

describe('data rows', () => {
  it('reads a CSV into rows, numbers as numbers', () => {
    expect(parseRows('month,revenue\nJan,12.5\nFeb,"1,200"\n', 'sales.csv')).toEqual([
      { month: 'Jan', revenue: 12.5 },
      { month: 'Feb', revenue: '1,200' },
    ]);
  });

  it('reads tab-separated files too', () => {
    expect(parseRows('a\tb\n1\tx\n', 'x.tsv')).toEqual([{ a: 1, b: 'x' }]);
  });

  it('reads a JSON array of objects, and JSON Lines', () => {
    expect(parseRows('[{"a":1},{"a":2}]', 'x.json')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseRows('{"a":1}\n\n{"a":2}\n', 'x.jsonl')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseRows('{"a":1}\n', 'x.ndjson')).toEqual([{ a: 1 }]);
  });

  it('says what is wrong with a file it cannot read', () => {
    expect(() => parseRows('{"a":1}', 'x.json')).toThrow(/array/);
    expect(() => parseRows('{"a":1}\nnope\n', 'x.jsonl')).toThrow(/line 2/);
    expect(() => parseRows('x', 'x.bin')).toThrow(/CSV, TSV, JSON, or JSON Lines/);
  });

  it('finds latitude and longitude columns by their usual names', () => {
    expect(latLonKeys({ latitude: 1, lng: 2 })).toEqual({ lat: 'latitude', lon: 'lng' });
    expect(latLonKeys({ Lat: 1, Lon: 2 })).toEqual({ lat: 'Lat', lon: 'Lon' });
    expect(latLonKeys({ x: 1 })).toBeNull();
  });
});
