/**
 * parseGithubUrl.test.ts — Unit tests for GitHub URL parsing.
 * Pure function tests: no network, no browser.
 */

import { describe, it, expect } from 'vitest';
import { parseGithubUrl } from '../src/github/parseGithubUrl.js';
import type { ParsedGithubUrl } from '../src/github/parseGithubUrl.js';

function isUrlError(result: ParsedGithubUrl): result is { code: string; message: string } {
  return (result as { code?: string }).code !== undefined;
}

describe('parseGithubUrl — valid repo URLs', () => {
  it('parses plain repo URL with https', () => {
    const result = parseGithubUrl('https://github.com/facebook/react');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
      expect(result.ref).toBeUndefined();
    }
  });

  it('parses repo URL without scheme', () => {
    const result = parseGithubUrl('github.com/facebook/react');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    }
  });

  it('parses repo URL with trailing slash', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    }
  });

  it('parses repo URL with .git suffix', () => {
    const result = parseGithubUrl('https://github.com/facebook/react.git');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    }
  });

  it('parses tree URL with branch ref', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/tree/main/src');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.ref).toBe('main');
      expect(result.path).toBe('src');
    }
  });

  it('parses blob URL with commit SHA ref', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/blob/a1b2c3d4e5f6/src/index.js');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.ref).toBe('a1b2c3d4e5f6');
      expect(result.path).toBe('src/index.js');
    }
  });

  it('parses www.github.com host', () => {
    const result = parseGithubUrl('https://www.github.com/facebook/react');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    }
  });
});

describe('parseGithubUrl — commit URLs', () => {
  it('parses commit URL with full SHA', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/commit/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('commit');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
      expect(result.sha).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    }
  });

  it('parses commit URL with short SHA', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/commit/a1b2c3d');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('commit');
      expect(result.sha).toBe('a1b2c3d');
    }
  });
});

describe('parseGithubUrl — pull request URLs', () => {
  it('parses pull URL', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/pull/12345');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('pull');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
      expect(result.number).toBe(12345);
    }
  });

  it('parses pull URL with /files suffix', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/pull/12345/files');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('pull');
      expect(result.number).toBe(12345);
    }
  });
});

describe('parseGithubUrl — invalid inputs', () => {
  it('rejects non-GitHub host', () => {
    const result = parseGithubUrl('https://gitlab.com/owner/repo');
    expect(isUrlError(result)).toBe(true);
    if (isUrlError(result)) {
      expect(result.code).toBe('UNSUPPORTED_HOST');
    }
  });

  it('rejects look-alike host', () => {
    const result = parseGithubUrl('https://github.com.evil.com/owner/repo');
    expect(isUrlError(result)).toBe(true);
    if (isUrlError(result)) {
      expect(result.code).toBe('UNSUPPORTED_HOST');
    }
  });

  it('rejects javascript scheme', () => {
    const result = parseGithubUrl('javascript:alert(1)');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects file scheme', () => {
    const result = parseGithubUrl('file:///etc/passwd');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects missing owner/repo', () => {
    const result = parseGithubUrl('https://github.com/');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects only owner', () => {
    const result = parseGithubUrl('https://github.com/facebook');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects invalid PR number', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/pull/abc');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects negative PR number', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/pull/-1');
    expect(isUrlError(result)).toBe(true);
  });

  it('rejects unsupported page', () => {
    const result = parseGithubUrl('https://github.com/facebook/react/issues/1');
    expect(isUrlError(result)).toBe(true);
    if (isUrlError(result)) {
      expect(result.code).toBe('UNSUPPORTED_PAGE');
    }
  });

  it('trims whitespace', () => {
    const result = parseGithubUrl('  https://github.com/facebook/react  ');
    expect(isUrlError(result)).toBe(false);
    if (!isUrlError(result)) {
      expect(result.kind).toBe('repo');
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    }
  });
});
