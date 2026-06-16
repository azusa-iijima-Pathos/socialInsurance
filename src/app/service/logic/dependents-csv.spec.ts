import { TestBed } from '@angular/core/testing';

import { DependentsCSV } from './dependents-csv';

describe('DependentsCSV', () => {
  let service: DependentsCSV;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DependentsCSV);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
