import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InsuranceCorrection } from './insurance-correction';

describe('InsuranceCorrection', () => {
  let component: InsuranceCorrection;
  let fixture: ComponentFixture<InsuranceCorrection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InsuranceCorrection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InsuranceCorrection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
