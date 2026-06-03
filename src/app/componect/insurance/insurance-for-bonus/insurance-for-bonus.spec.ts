import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InsuranceForBonus } from './insurance-for-bonus';

describe('InsuranceForBonus', () => {
  let component: InsuranceForBonus;
  let fixture: ComponentFixture<InsuranceForBonus>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InsuranceForBonus]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InsuranceForBonus);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
