import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompanyConfirm } from './company-confirm';

describe('CompanyConfirm', () => {
  let component: CompanyConfirm;
  let fixture: ComponentFixture<CompanyConfirm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyConfirm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompanyConfirm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
