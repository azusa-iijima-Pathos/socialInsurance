import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthlySalary } from './monthly-salary';

describe('MonthlySalary', () => {
  let component: MonthlySalary;
  let fixture: ComponentFixture<MonthlySalary>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlySalary]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthlySalary);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
