/**
 * test/pageDetection.test.ts — Unit tests for page detection.
 */

import { describe, it, expect } from 'vitest'
import { parsePage, watchNavigation } from '../src/content/pageDetection.js'

describe('parsePage', () => {
  it('parses a repository main page', () => {
    const info = parsePage('https://github.com/facebook/react')
    expect(info.pageKind).toBe('repository')
    expect(info.owner).toBe('facebook')
    expect(info.repo).toBe('react')
    expect(info.ref).toBeUndefined()
  })

  it('parses a tree page with a branch ref', () => {
    const info = parsePage('https://github.com/facebook/react/tree/main/src')
    expect(info.pageKind).toBe('repository')
    expect(info.owner).toBe('facebook')
    expect(info.repo).toBe('react')
    expect(info.ref).toBe('main')
  })

  it('parses a blob page with a commit SHA ref', () => {
    const info = parsePage(
      'https://github.com/facebook/react/blob/a1b2c3d4e5f6/src/index.js'
    )
    expect(info.pageKind).toBe('repository')
    expect(info.ref).toBe('a1b2c3d4e5f6')
  })

  it('parses a pull request page', () => {
    const info = parsePage('https://github.com/facebook/react/pull/12345')
    expect(info.pageKind).toBe('pull_request')
    expect(info.owner).toBe('facebook')
    expect(info.repo).toBe('react')
  })

  it('returns other for non-GitHub URLs', () => {
    const info = parsePage('https://example.com/foo')
    expect(info.pageKind).toBe('other')
  })

  it('returns other for GitHub org pages without repo', () => {
    const info = parsePage('https://github.com/facebook')
    expect(info.pageKind).toBe('other')
  })
})

describe('watchNavigation', () => {
  it('detects ref changes on pushState', () => {
    const calls: any[] = []
    let fakeHref = 'https://github.com/facebook/react'

    // Install a fake pushState BEFORE watchNavigation so it becomes the
    // "original" that watchNavigation wraps.
    const fakePushState = (_a: any, _b: any, url: string) => {
      fakeHref = url
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    const origPushState = history.pushState
    ;(history as any).pushState = fakePushState

    const unsubscribe = watchNavigation(
      (info) => calls.push(info),
      () => fakeHref
    )

    history.pushState(null, '', 'https://github.com/facebook/react/tree/main')
    expect(calls[calls.length - 1]?.ref).toBe('main')

    history.pushState = origPushState
    unsubscribe()
  })
})
