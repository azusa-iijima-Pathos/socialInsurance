import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FixSalaryCorrection } from './fix-salary-correction';

describe('FixSalaryCorrection', () => {
  let component: FixSalaryCorrection;
  let fixture: ComponentFixture<FixSalaryCorrection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FixSalaryCorrection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FixSalaryCorrection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
