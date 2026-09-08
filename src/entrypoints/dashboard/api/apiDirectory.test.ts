import { describe, expect, it } from 'vitest';
import { API_DIRECTORY, API_DIRECTORY_BY_ID, DIRECTORY_CATEGORIES } from './apiDirectory';

describe('API directory data integrity', () => {
  it('has a curated but substantial set of entries', () => {
    expect(API_DIRECTORY.length).toBeGreaterThanOrEqual(100);
    expect(API_DIRECTORY.length).toBeLessThan(200);
  });

  it('has unique ids that are stable slugs', () => {
    const ids = API_DIRECTORY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('has valid categories and a label for each', () => {
    const categoryIds = new Set(DIRECTORY_CATEGORIES.map((c) => c.id));
    for (const api of API_DIRECTORY) {
      expect(categoryIds.has(api.category), `${api.id} → unknown category ${api.category}`).toBe(true);
    }
    // Every category has at least one API (no dead tabs).
    for (const c of DIRECTORY_CATEGORIES) {
      expect(API_DIRECTORY.some((a) => a.category === c.id), `category ${c.id} is empty`).toBe(true);
    }
  });

  it('has parseable example URLs', () => {
    for (const api of API_DIRECTORY) {
      // Variable placeholders are expected — strip them before parsing.
      const url = api.example.url.replace(/\{\{[\w.-]+\}\}/g, 'example.com');
      expect(() => new URL(url), `${api.id} → bad URL ${api.example.url}`).not.toThrow();
    }
  });

  it('marks key-required entries with a note pointing at a variable', () => {
    for (const api of API_DIRECTORY) {
      if (api.auth !== 'none') {
        expect(api.example.note, `${api.id} needs a key hint`).toBeTruthy();
      }
    }
  });

  it('gives key-based entries a {{apiKey}} placeholder in their example', () => {
    for (const api of API_DIRECTORY) {
      if (api.auth === 'key') {
        const serialized = JSON.stringify(api.example);
        expect(serialized.includes('{{apiKey}}'), `${api.id} should reference {{apiKey}}`).toBe(true);
      }
    }
  });

  it('has name + description on every entry', () => {
    for (const api of API_DIRECTORY) {
      expect(api.name.trim().length).toBeGreaterThan(0);
      expect(api.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('covers the popular category with at least five no-key entries', () => {
    const popularNoKey = API_DIRECTORY.filter((a) => a.category === 'popular' && a.auth === 'none');
    expect(popularNoKey.length).toBeGreaterThanOrEqual(5);
  });

  it('builds a working id lookup', () => {
    expect(API_DIRECTORY_BY_ID.get('github')?.name).toBe('GitHub API');
    expect(API_DIRECTORY_BY_ID.size).toBe(API_DIRECTORY.length);
  });
});