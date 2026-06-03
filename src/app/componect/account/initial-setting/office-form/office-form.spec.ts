import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OfficeForm } from './office-form';

describe('OfficeForm', () => {
  let component: OfficeForm;
  let fixture: ComponentFixture<OfficeForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficeForm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OfficeForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
