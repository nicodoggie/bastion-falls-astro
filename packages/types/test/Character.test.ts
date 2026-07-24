import assert from 'node:assert/strict';
import test from 'node:test';

import { CharacterRelativeSchema } from '../src/Character.ts';

test('CharacterRelativeSchema preserves adopted child and adoptive parent relationships', () => {
  const adoptedChild = CharacterRelativeSchema.safeParse({
    name: 'Dante Le Fanu',
    type: 'adopted child',
  });
  const adoptiveParent = CharacterRelativeSchema.safeParse({
    name: 'Narmaya',
    type: 'adoptive parent',
  });

  assert.equal(adoptedChild.success, true);
  assert.equal(adoptiveParent.success, true);
  if (adoptedChild.success && adoptiveParent.success) {
    assert.equal(adoptedChild.data.type, 'adopted child');
    assert.equal(adoptiveParent.data.type, 'adoptive parent');
  }
});
