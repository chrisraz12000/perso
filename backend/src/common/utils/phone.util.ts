export type MobileMoneyOperator = 'mvola' | 'airtel' | 'orange';

const OPERATOR_PREFIXES: Record<MobileMoneyOperator, string[]> = {
  mvola: ['034', '038'],
  airtel: ['033'],
  orange: ['032', '037'],
};

export function normalizeMalagasyPhone(phone: string): string {
  const stripped = phone.replace(/[\s-]/g, '');
  if (stripped.startsWith('+261')) return `0${stripped.slice(4)}`;
  if (stripped.startsWith('261')) return `0${stripped.slice(3)}`;
  return stripped;
}

export function toInternationalFormat(phone: string): string {
  return `261${normalizeMalagasyPhone(phone).replace(/^0/, '')}`;
}

export function detectOperator(phone: string): MobileMoneyOperator | null {
  const clean = normalizeMalagasyPhone(phone);
  for (const operator of Object.keys(OPERATOR_PREFIXES) as MobileMoneyOperator[]) {
    if (OPERATOR_PREFIXES[operator].some((prefix) => clean.startsWith(prefix))) {
      return operator;
    }
  }
  return null;
}
