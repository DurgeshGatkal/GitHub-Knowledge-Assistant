/**
 * resolveRef.test.ts — Unit tests for ref resolver.
 * Uses mocked fetch: no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRef } from '../src/github/resolveRef.js';
import type { RefResolverDeps } from '../src/github/resolveRef.js';

function makeDeps(handler: (url: string, init?: RequestInit) => Promise<Response>): RefResolverDeps {
  return {
    fetch: vi.fn(handler),
    githubToken: 'test-token',
  };
}

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('resolveRef', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full SHA directly without network', async () => {
    const fetchMock = vi.fn();
    const deps = makeDeps(fetchMock as any);
    const result = await resolveRef('facebook', 'react', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', deps);
    if ('code' in result) throw new Error('expected result, got error');
    expect(result.sha).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    expect(result.fromSha).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the default branch to a commit SHA when no ref is given', async () => {
    const sha = 'f'.repeat(40);
    const deps = makeDeps(async (url) =>
      url.endsWith('/repos/facebook/react')
        ? jsonResponse({ default_branch: 'main' })
        : jsonResponse({ sha })
    );
    const result = await resolveRef('facebook', 'react', undefined, deps);
    if ('code' in result) throw new Error('expected result, got error: ' + JSON.stringify(result));
    // The branch name must never leak through as a SHA.
    expect(result.sha).toBe(sha);
    expect(result.ref).toBe('main');
    expect(result.fromSha).toBe(false);
    expect(deps.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/facebook/react',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
    );
    expect(deps.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/facebook/react/commits/main',
      expect.anything()
    );
  });

  it('resolves branch name via commits endpoint', async () => {
    const deps = makeDeps(async () => jsonResponse({ sha: 'abc123def456' }));
    const result = await resolveRef('facebook', 'react', 'feature/login', deps);
    if ('code' in result) throw new Error('expected result, got error');
    expect(result.sha).toBe('abc123def456');
    expect(result.ref).toBe('feature/login');
    expect(deps.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/facebook/react/commits/feature%2Flogin',
      expect.anything()
    );
  });

  it('returns REPO_NOT_FOUND on 404', async () => {
    const deps = makeDeps(async () => new Response(null, { status: 404 }));
    const result = await resolveRef('nope', 'repo', undefined, deps);
    if ('sha' in result) throw new Error('expected error, got result');
    expect(result.code).toBe('REPO_NOT_FOUND');
  });

  it('returns GITHUB_RATE_LIMITED on 403', async () => {
    const deps = makeDeps(async () => new Response(null, { status: 403 }));
    const result = await resolveRef('facebook', 'react', 'main', deps);
    if ('sha' in result) throw new Error('expected error, got result');
    expect(result.code).toBe('GITHUB_RATE_LIMITED');
  });

  it('returns REF_NOT_FOUND when branch does not exist', async () => {
    const deps = makeDeps(async () => new Response(null, { status: 404 }));
    const result = await resolveRef('facebook', 'react', 'nonexistent-branch', deps);
    if ('sha' in result) throw new Error('expected error, got result');
    expect(result.code).toBe('REF_NOT_FOUND');
  });

  it('tries slash branch prefixes progressively', async () => {
    const calls: string[] = [];
    const deps: RefResolverDeps = {
      fetch: async (url: string) => {
        calls.push(url);
        if (url.includes('commits/feature%2Flogin%2Fsrc')) {
          return jsonResponse({ sha: 'resolved-sha' });
        }
        return new Response(null, { status: 404 });
      },
      githubToken: undefined,
    };
    const result = await resolveRef('owner', 'repo', 'feature/login/src', deps);
    if ('code' in result) throw new Error('expected result, got error');
    expect(result.sha).toBe('resolved-sha');
    expect(result.ref).toBe('feature/login/src');
    // Full ref tried first and succeeded
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('commits/feature%2Flogin%2Fsrc');
  });

  it('returns NETWORK_ERROR on fetch failure', async () => {
    const deps: RefResolverDeps = {
      fetch: async () => {
        throw new Error('network down');
      },
    };
    const result = await resolveRef('facebook', 'react', 'main', deps);
    if ('sha' in result) throw new Error('expected error, got result');
    expect(result.code).toBe('NETWORK_ERROR');
  });
});
