import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Bonus } from './bonus';

describe('Bonus', () => {
  let component: Bonus;
  let fixture: ComponentFixture<Bonus>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Bonus]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Bonus);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
