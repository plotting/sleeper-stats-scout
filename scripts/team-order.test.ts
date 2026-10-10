import test from 'node:test';
import assert from 'node:assert/strict';
import { sortByTeamOrder } from '../src/hooks/useTeams';

test('sortByTeamOrder puts anything with a team id into the site-wide order (ascending team id) without mutating the input', () => {
  const rows = [{ id: 9, n: 'Erik' }, { id: 2, n: 'Brian' }, { id: 5, n: 'Nate' }];
  assert.deepEqual(sortByTeamOrder(rows, (r) => r.id).map((r) => r.n), ['Brian', 'Nate', 'Erik']);
  assert.deepEqual(rows.map((r) => r.id), [9, 2, 5]);
});
