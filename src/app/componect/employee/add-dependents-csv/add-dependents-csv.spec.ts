import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddDependentsCSV } from './add-dependents-csv';

describe('AddDependentsCSV', () => {
  let component: AddDependentsCSV;
  let fixture: ComponentFixture<AddDependentsCSV>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddDependentsCSV]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddDependentsCSV);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
