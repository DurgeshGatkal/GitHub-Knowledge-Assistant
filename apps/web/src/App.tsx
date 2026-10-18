/**
 * src/App.tsx — App router.
 *
 * Routes:
 *   /                    Landing page (URL input)
 *   /repo/:owner/:repo/:sha  Repository results page with graph
 *   /job/:jobId          Job polling page
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { RepoResults } from './pages/RepoResults'
import { JobResults } from './pages/JobResults'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/repo/:owner/:repo/:sha" element={<RepoResults />} />
        <Route path="/job/:jobId" element={<JobResults />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  )
}
