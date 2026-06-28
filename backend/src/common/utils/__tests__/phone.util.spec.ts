import { detectOperator, normalizeMalagasyPhone, toInternationalFormat } from '../phone.util';

describe('phone.util', () => {
  describe('normalizeMalagasyPhone', () => {
    it('keeps an already-local number unchanged', () => {
      expect(normalizeMalagasyPhone('0341234567')).toBe('0341234567');
    });

    it('converts +261 international prefix to local format', () => {
      expect(normalizeMalagasyPhone('+261341234567')).toBe('0341234567');
    });

    it('converts 261 international prefix to local format', () => {
      expect(normalizeMalagasyPhone('261341234567')).toBe('0341234567');
    });

    it('strips spaces and dashes', () => {
      expect(normalizeMalagasyPhone('034 123-4567')).toBe('0341234567');
    });
  });

  describe('toInternationalFormat', () => {
    it('converts a local number to the 261 international format', () => {
      expect(toInternationalFormat('0341234567')).toBe('261341234567');
    });

    it('is idempotent on an already-international number', () => {
      expect(toInternationalFormat('+261341234567')).toBe('261341234567');
    });
  });

  describe('detectOperator', () => {
    it.each([
      ['0341234567', 'mvola'],
      ['0381234567', 'mvola'],
      ['0331234567', 'airtel'],
      ['0321234567', 'orange'],
      ['0371234567', 'orange'],
    ])('detects %s as %s', (phone, expected) => {
      expect(detectOperator(phone)).toBe(expected);
    });

    it('detects operator from an international-format number', () => {
      expect(detectOperator('+261341234567')).toBe('mvola');
    });

    it('returns null for an unrecognized prefix', () => {
      expect(detectOperator('0201234567')).toBeNull();
    });
  });
});
