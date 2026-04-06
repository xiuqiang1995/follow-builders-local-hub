import { expect, test } from 'vitest';

import nextConfig from '../next.config';

test('next dev allows common local origins', () => {
  expect(nextConfig.allowedDevOrigins).toEqual(
    expect.arrayContaining(['127.0.0.1', 'localhost'])
  );
});
