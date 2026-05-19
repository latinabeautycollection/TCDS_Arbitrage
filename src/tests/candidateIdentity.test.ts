import { deriveWatchlistIdentity } from '../services/identity/watchlistIdentity';

describe('deriveWatchlistIdentity', () => {
  it('builds console family identity', () => {
    const id = deriveWatchlistIdentity({
      categoryKey: 'game_consoles',
      familyName: 'Nintendo Switch OLED Console',
      brand: 'Nintendo',
      modelFamily: 'switch_oled',
    });
    expect(id.normalizedBrand).toBe('nintendo');
    expect(id.normalizedProductType).toBe('console');
    expect(id.canonicalProductKey).toContain('game_consoles|nintendo|console');
  });
});
