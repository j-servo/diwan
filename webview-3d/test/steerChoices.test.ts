import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EFFORTS,
  ALLOWED_MODELS,
  effortWord,
  formatTokens,
  parseTokenBudget,
  validTokenBudget,
} from '../../core/src/steerChoices.js';

describe('steerChoices', () => {
  it('has exactly the three exact model ids and the five efforts', () => {
    expect(ALLOWED_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(ALLOWED_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortWord('xhigh')).toBe('extra high');
  });
  it('parses 500K, 1.5M and plain digits', () => {
    expect(parseTokenBudget('500K')).toBe(500_000);
    expect(parseTokenBudget('500k')).toBe(500_000);
    expect(parseTokenBudget('1.5M')).toBe(1_500_000);
    expect(parseTokenBudget('250000')).toBe(250_000);
    expect(parseTokenBudget('1,500,000')).toBe(1_500_000);
    for (const bad of ['', 'abc', '5 G', '-5K', '1.2.3M', '$5'])
      expect(parseTokenBudget(bad)).toBeNull();
  });
  it('accepts 50K to 10M only', () => {
    expect(validTokenBudget(50_000)).toBe(true);
    expect(validTokenBudget(10_000_000)).toBe(true);
    expect(validTokenBudget(49_999)).toBe(false);
    expect(validTokenBudget(10_000_001)).toBe(false);
    expect(validTokenBudget(NaN)).toBe(false);
    expect(validTokenBudget('500000')).toBe(false);
    expect(validTokenBudget(500_000.5)).toBe(false);
  });
  it('formats', () => {
    expect(formatTokens(500_000)).toBe('500K');
    expect(formatTokens(182_300)).toBe('182K');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(940)).toBe('940');
  });
});
