import { describe, expect, it } from 'vitest';
import { passwordMeetsRules } from './password-input';

describe('passwordMeetsRules', () => {
  it('rejects a password missing any required character class', () => {
    expect(passwordMeetsRules('short1!')).toBe(false); // too short
    expect(passwordMeetsRules('alllowercase1!')).toBe(false); // no uppercase
    expect(passwordMeetsRules('ALLUPPERCASE1!')).toBe(false); // no lowercase
    expect(passwordMeetsRules('NoNumbersHere!')).toBe(false); // no number
    expect(passwordMeetsRules('NoSpecialChar1')).toBe(false); // no special char
  });

  it('accepts a password meeting every rule', () => {
    expect(passwordMeetsRules('Str0ng!Password')).toBe(true);
  });
});
