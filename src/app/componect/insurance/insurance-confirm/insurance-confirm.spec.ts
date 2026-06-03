import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InsuranceConfirm } from './insurance-confirm';

describe('InsuranceConfirm', () => {
  let component: InsuranceConfirm;
  let fixture: ComponentFixture<InsuranceConfirm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InsuranceConfirm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InsuranceConfirm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
