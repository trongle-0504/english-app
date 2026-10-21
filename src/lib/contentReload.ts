import { invalidateData } from './data'

/** Pages that write to content/ themselves; reloading them would wipe what the user is editing. */
const EDITING_PAGES = ['/admin', '/grammar-analyze', '/review', '/practice/essays', '/practice/speaking-ideas', '/practice/writing-review', '/practice/mistakes', '/practice/speaking-review']

// Dev only: the content plugin signals edits under content/. Other pages reload to show the change.
if (import.meta.hot) {
  import.meta.hot.on('content:changed', () => {
    invalidateData()
    if (!EDITING_PAGES.some((prefix) => window.location.pathname.startsWith(prefix))) window.location.reload()
  })
}
