import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompanyForm } from './company-form';

describe('CompanyForm', () => {
  let component: CompanyForm;
  let fixture: ComponentFixture<CompanyForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyForm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompanyForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
