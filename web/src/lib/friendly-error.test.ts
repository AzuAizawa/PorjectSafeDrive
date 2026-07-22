import { describe, expect, it } from 'vitest';
import { friendlyErrorMessage } from './friendly-error';

describe('friendlyErrorMessage', () => {
  it('maps a row-level security violation to a friendly message', () => {
    const err = new Error('new row violates row-level security policy for table "vehicles"');
    expect(friendlyErrorMessage(err)).toBe("You don't have permission to do this — make sure you're verified and try again.");
  });

  it('maps a foreign key violation to a friendly message', () => {
    const err = new Error('update or delete on table "vehicles" violates foreign key constraint "fk_x"');
    expect(friendlyErrorMessage(err)).toMatch(/no longer exists/i);
  });

  it('maps a duplicate key violation to a friendly message', () => {
    const err = new Error('duplicate key value violates unique constraint "profiles_email_key"');
    expect(friendlyErrorMessage(err)).toMatch(/already exists/i);
  });

  it('passes through a custom RAISE EXCEPTION message unchanged', () => {
    const err = new Error('must be at least 21 years old to book a vehicle');
    expect(friendlyErrorMessage(err)).toBe('must be at least 21 years old to book a vehicle');
  });

  it('handles a non-Error thrown value', () => {
    expect(friendlyErrorMessage('plain string error')).toBe('plain string error');
  });
});
