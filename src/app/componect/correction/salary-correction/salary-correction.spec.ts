import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalaryCorrection } from './salary-correction';

describe('SalaryCorrection', () => {
  let component: SalaryCorrection;
  let fixture: ComponentFixture<SalaryCorrection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalaryCorrection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SalaryCorrection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
