import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey } from '../src/utils/dynastyValue';

test('suffixes and punctuation do not matter', () => {
  assert.equal(nameKey('Todd Gurley II'), nameKey('Todd Gurley'));
  assert.equal(nameKey('Odell Beckham Jr.'), nameKey('Odell Beckham'));
  assert.equal(nameKey('A.J. Green'), nameKey('AJ Green'));
  assert.equal(nameKey("Le'Veon Bell"), nameKey('LeVeon Bell'));
});

test('known renames and spellings map together', () => {
  assert.equal(nameKey('Phillip Rivers'), nameKey('Philip Rivers'));
  assert.equal(nameKey('Robby Anderson'), nameKey('Robbie Chosen'));
});

test('different players stay different', () => {
  assert.notEqual(nameKey('Mike Williams'), nameKey('Mike Evans'));
});
