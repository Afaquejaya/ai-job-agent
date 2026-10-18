import { describe, expect, it } from 'vitest';
import { declarationProblems, SOURCE_IDS, SOURCE_REGISTRY, sourceDeclarationSchema } from './index';

describe('SOURCE_REGISTRY', () => {
  it('declares every known source', () => {
    expect(Object.keys(SOURCE_REGISTRY).sort()).toEqual([...SOURCE_IDS].sort());
  });

  it.each(SOURCE_IDS)('%s has a valid and consistent declaration', (id) => {
    const declaration = SOURCE_REGISTRY[id];
    expect(sourceDeclarationSchema.parse(declaration)).toEqual(declaration);
    expect(declarationProblems(declaration)).toEqual([]);
  });
});

describe('declarationProblems', () => {
  it('rejects automation on an unreviewed source', () => {
    const declaration = {
      ...SOURCE_REGISTRY.linkedin,
      automation: { autoFillPermitted: true, autoSubmitPermitted: true },
    };
    expect(declarationProblems(declaration)).toContain(
      'Automation cannot be permitted before the source policy has been reviewed',
    );
  });
});
