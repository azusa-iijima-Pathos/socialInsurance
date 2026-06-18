import { Timestamp } from '@angular/fire/firestore';
import { InsuranceDetail } from '../../model/employee';
import {
  isLastDayOfCalendarMonth,
  resolveBonusTargetMonthFromPaymentDate,
  resolveInsuranceTargetMonthStart,
  shouldCollectBonusInsurancePremium,
  shouldCollectInsurancePremium,
  startOfCalendarMonth,
} from './insurance-premium-collection.util';

function detail(partial: Partial<InsuranceDetail>): InsuranceDetail {
  return partial as InsuranceDetail;
}

function ts(dateText: string): Timestamp {
  const date = new Date(`${dateText}T00:00:00`);
  return Timestamp.fromDate(date);
}

describe('insurance-premium-collection.util', () => {
  it('resolves payroll id to calendar month start', () => {
    const target = resolveInsuranceTargetMonthStart('2025-04');
    expect(target).toEqual(startOfCalendarMonth(2025, 4));
  });

  it('collects from acquisition month even when acquired mid-month', () => {
    const insurance = detail({
      joined: true,
      acquiredDate: ts('2025-03-15'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2025, 2)).toBeFalse();
    expect(shouldCollectInsurancePremium(insurance, 2025, 3)).toBeTrue();
    expect(shouldCollectInsurancePremium(insurance, 2025, 4)).toBeTrue();
  });

  it('exempts months before loss month', () => {
    const insurance = detail({
      joined: false,
      acquiredDate: ts('2024-01-01'),
      lostDate: ts('2025-03-31'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2025, 4)).toBeFalse();
  });

  it('collects months after loss month when loss is in the future', () => {
    const insurance = detail({
      joined: true,
      acquiredDate: ts('2024-01-01'),
      lostDate: ts('2025-06-15'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2025, 5)).toBeTrue();
  });

  it('collects when loss is on the last day of the target month', () => {
    const insurance = detail({
      joined: false,
      acquiredDate: ts('2024-01-01'),
      lostDate: ts('2025-04-30'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2025, 4)).toBeTrue();
    expect(shouldCollectInsurancePremium(insurance, 2025, 5)).toBeFalse();
  });

  it('collects when joined flag is missing but acquired date exists', () => {
    const insurance = detail({
      acquiredDate: ts('2020-04-01'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2026, 4)).toBeTrue();
  });

  it('exempts when loss is mid-month in the target month', () => {
    const insurance = detail({
      joined: false,
      acquiredDate: ts('2024-01-01'),
      lostDate: ts('2025-04-15'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2025, 3)).toBeTrue();
    expect(shouldCollectInsurancePremium(insurance, 2025, 4)).toBeFalse();
    expect(shouldCollectInsurancePremium(insurance, 2025, 5)).toBeFalse();
  });

  it('detects last day of month for 31-day and 28-day months', () => {
    expect(isLastDayOfCalendarMonth(new Date('2025-01-31T00:00:00'))).toBeTrue();
    expect(isLastDayOfCalendarMonth(new Date('2025-02-28T00:00:00'))).toBeTrue();
    expect(isLastDayOfCalendarMonth(new Date('2025-02-27T00:00:00'))).toBeFalse();
  });

  it('exempts when actively joined but lostDate is in prior month', () => {
    const insurance = detail({
      joined: true,
      acquiredDate: ts('2020-04-01'),
      lostDate: ts('2026-03-31'),
    });

    expect(shouldCollectInsurancePremium(insurance, 2026, 4)).toBeFalse();
  });

  describe('shouldCollectBonusInsurancePremium', () => {
    it('resolves target month from bonus payment date', () => {
      expect(resolveBonusTargetMonthFromPaymentDate(new Date('2025-06-25T00:00:00'))).toEqual({
        year: 2025,
        month: 6,
      });
    });

    it('collects when loss month is after bonus payment month', () => {
      const insurance = detail({
        joined: true,
        acquiredDate: ts('2024-01-01'),
        lostDate: ts('2025-07-01'),
      });

      expect(shouldCollectBonusInsurancePremium(insurance, 2025, 6)).toBeTrue();
    });

    it('exempts when loss month is the same as bonus payment month', () => {
      const insuranceAtMonthEnd = detail({
        joined: false,
        acquiredDate: ts('2024-01-01'),
        lostDate: ts('2025-06-30'),
      });
      const insuranceMidMonth = detail({
        joined: false,
        acquiredDate: ts('2024-01-01'),
        lostDate: ts('2025-06-15'),
      });

      expect(shouldCollectBonusInsurancePremium(insuranceAtMonthEnd, 2025, 6)).toBeFalse();
      expect(shouldCollectBonusInsurancePremium(insuranceMidMonth, 2025, 6)).toBeFalse();
    });

    it('exempts when loss month is before bonus payment month', () => {
      const insurance = detail({
        joined: false,
        acquiredDate: ts('2024-01-01'),
        lostDate: ts('2025-05-31'),
      });

      expect(shouldCollectBonusInsurancePremium(insurance, 2025, 6)).toBeFalse();
    });
  });
});
