import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddDependents } from './add-dependents';

describe('AddDependents', () => {
  let component: AddDependents;
  let fixture: ComponentFixture<AddDependents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddDependents]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddDependents);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
