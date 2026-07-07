import { describe, it, expect } from 'vitest';
import {
  validateProjectInput,
  createProject,
  applyProjectUpdate,
  ProjectValidationError,
  type Project,
} from '@throng/core';

const baseInput = { name: 'Subnet Vault', colour: '#6aa3ff', rootFolder: 'C:/code/subnet' };

function makeProject(overrides: Partial<Project> = {}): Project {
  return createProject(baseInput, {
    id: 'p1',
    ownerUser: 'alice',
    now: '2026-06-26T00:00:00.000Z',
    isActive: true,
    ...overrides,
  });
}

describe('validateProjectInput', () => {
  it('accepts a well-formed input and trims the name', () => {
    const result = validateProjectInput({ ...baseInput, name: '  Subnet Vault  ' });
    expect(result.name).toBe('Subnet Vault');
    expect(result.colour).toBe('#6aa3ff');
    expect(result.rootFolder).toBe('C:/code/subnet');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => validateProjectInput({ ...baseInput, name: '   ' })).toThrow(ProjectValidationError);
  });

  it('rejects a name longer than 120 characters', () => {
    expect(() => validateProjectInput({ ...baseInput, name: 'x'.repeat(121) })).toThrow(
      ProjectValidationError,
    );
  });

  it('rejects a malformed colour', () => {
    expect(() => validateProjectInput({ ...baseInput, colour: 'blue' })).toThrow(
      ProjectValidationError,
    );
    expect(() => validateProjectInput({ ...baseInput, colour: '#12' })).toThrow(
      ProjectValidationError,
    );
  });

  it('accepts 3- and 6-digit hex colours, case-insensitively', () => {
    expect(validateProjectInput({ ...baseInput, colour: '#FFF' }).colour).toBe('#FFF');
    expect(validateProjectInput({ ...baseInput, colour: '#AbC123' }).colour).toBe('#AbC123');
  });

  it('rejects an empty root folder', () => {
    expect(() => validateProjectInput({ ...baseInput, rootFolder: '   ' })).toThrow(
      ProjectValidationError,
    );
  });
});

describe('createProject', () => {
  it('builds a project with identity, owner, timestamps and active flag', () => {
    const project = makeProject();
    expect(project).toMatchObject({
      id: 'p1',
      ownerUser: 'alice',
      name: 'Subnet Vault',
      colour: '#6aa3ff',
      rootFolder: 'C:/code/subnet',
      isActive: true,
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });

  it('defaults isActive to false when not specified', () => {
    const project = createProject(baseInput, {
      id: 'p2',
      ownerUser: 'alice',
      now: '2026-06-26T00:00:00.000Z',
    });
    expect(project.isActive).toBe(false);
  });

  it('validates its input', () => {
    expect(() =>
      createProject({ ...baseInput, name: '' }, { id: 'p3', ownerUser: 'alice', now: 'now' }),
    ).toThrow(ProjectValidationError);
  });
});

describe('applyProjectUpdate', () => {
  it('updates only the provided fields and bumps updatedAt', () => {
    const project = makeProject();
    const updated = applyProjectUpdate(project, { name: 'Renamed' }, '2026-06-27T00:00:00.000Z');
    expect(updated.name).toBe('Renamed');
    expect(updated.colour).toBe(project.colour);
    expect(updated.rootFolder).toBe(project.rootFolder);
    expect(updated.updatedAt).toBe('2026-06-27T00:00:00.000Z');
    expect(updated.createdAt).toBe(project.createdAt);
    expect(updated.id).toBe(project.id);
  });

  it('validates the merged result', () => {
    const project = makeProject();
    expect(() => applyProjectUpdate(project, { colour: 'not-a-colour' }, 'now')).toThrow(
      ProjectValidationError,
    );
  });

  it('does not mutate the original project', () => {
    const project = makeProject();
    applyProjectUpdate(project, { name: 'Renamed' }, 'now');
    expect(project.name).toBe('Subnet Vault');
  });
});
