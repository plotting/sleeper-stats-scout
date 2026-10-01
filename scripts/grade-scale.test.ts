import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeGrades, zGrade } from '../src/utils/gradeScale';

test('z grades span the whole scale', () => {
  assert.equal(zGrade(2), 'A+');
  assert.equal(zGrade(0), 'B');
  assert.equal(zGrade(-0.8), 'C');
  assert.equal(zGrade(-2), 'F');
});

test('relative grades spread a bunched group', () => {
  const g = relativeGrades([2207, 1657, 1275, 1256, 782, 770, 751, 491, 385, 313]);
  assert.equal(g[0], 'A+');
  assert.ok(['D', 'F'].includes(g[9]));
  assert.ok(new Set(g).size >= 5);
});

test('identical values all get the same middle grade', () => {
  assert.deepEqual(relativeGrades([5, 5, 5]), ['B', 'B', 'B']);
});
