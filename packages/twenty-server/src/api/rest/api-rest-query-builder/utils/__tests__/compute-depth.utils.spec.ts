import { computeDepth } from 'src/api/rest/api-rest-query-builder/utils/compute-depth.utils';

describe('computeDepth', () => {
  it('should compute depth from query', () => {
    const request: any = {
      query: { depth: '1' },
    };

    expect(computeDepth(request)).toEqual(1);
  });

  it('should return default depth if missing', () => {
    const request: any = { query: {} };

    expect(computeDepth(request)).toEqual(undefined);
  });
  it('should raise if wrong depth', () => {
    const request: any = { query: { depth: '100' } };

    expect(() => computeDepth(request)).toThrow();

    request.query.depth = '0';

    expect(() => computeDepth(request)).toThrow();
  });
});
