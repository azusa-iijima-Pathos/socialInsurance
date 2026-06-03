import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RetireEntry } from './retire-entry';

describe('RetireEntry', () => {
  let component: RetireEntry;
  let fixture: ComponentFixture<RetireEntry>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RetireEntry]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RetireEntry);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
