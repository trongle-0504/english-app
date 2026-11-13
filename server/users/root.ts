// Multi-user data layout (PLAN-multi-user-v2.md, section 3). Every learner gets a private folder that looks exactly
// like the app's own root, so all existing code that builds paths from ctx.rootDir / ctx.contentDir keeps working and
// can only ever reach that learner's files:
//
//   <DATA_DIR>/users/<uid>/
//     progress/                 real: reviews, review state, planner, coach chats, Writing/Speaking results …
//     content/                  real folder; personal parts are real, shared parts are links into the app's content/
//       vocabulary/ note/ notepad/ review/          real (the learner's own library)
//       grammar/history.json                         real; the other grammar files are links
//       blog collocations essays practice …          links (shared, read-only for the service user)
//     public/                   real; vocab-images note-images notepad-images real, the rest links
//     data/                     real; drills-nightly.json real, news/vapid links to the shared system files
//     models cache              links (STT model, dictionary caches)
//
// The links point at files the service account cannot write (the app folder is owned by the deploying user), so a
// learner's request can read shared content but never change it. Admin edits of shared content are not offered in
// the multi-user app.
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ApiError } from '../api.ts'
import { dataDir } from '../auth/store.ts'

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/

/** The content/ entries that belong to the learner (everything else in content/ is shared). */
export const PERSONAL_CONTENT = ['vocabulary', 'note', 'notepad', 'review'] as const
/** Inside content/grammar only the history of analysed sentences is personal. */
const PERSONAL_GRAMMAR = ['history.json']
/** public/ folders a learner writes to (pictures of their own words, notes and notepad). */
const PERSONAL_PUBLIC = ['vocab-images', 'note-images', 'notepad-images']
/** data/ files a learner owns; the others (news, push keys) are shared system files. */
const PERSONAL_DATA = ['drills-nightly.json']

export const multiUser = () => process.env.MULTI_USER === '1'

export const usersDir = () => path.join(dataDir(), 'users')

/** <DATA_DIR>/users/<uid>; refuses anything that is not a plain id. */
export function userRootDir(uid: string): string {
  if (!SAFE_ID.test(uid)) throw new ApiError(400, 'Invalid user id.')
  const base = usersDir()
  const dir = path.resolve(base, uid)
  if (path.dirname(dir) !== path.resolve(base)) throw new ApiError(400, 'Invalid user id.')
  return dir
}

function link(target: string, at: string) {
  try {
    lstatSync(at)
    return // already there (link or real)
  } catch {
    /* missing */
  }
  if (existsSync(target)) symlinkSync(target, at)
}

/** Empty starting files for a new learner's library, so the content build and the pages see an empty library. */
function seedPersonal(contentDir: string, appContent: string) {
  const files: Record<string, string> = {
    'vocabulary/words.json': '[]\n',
    'note/notes.json': '[]\n',
    'notepad/notes.json': '[]\n',
  }
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(contentDir, rel)
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
  }
  // The topic tree and the example decks are structure, not learner data: linked.
  link(path.join(appContent, 'vocabulary', 'topics.json'), path.join(contentDir, 'vocabulary', 'topics.json'))
  mkdirSync(path.join(contentDir, 'review'), { recursive: true })
  for (const example of ['_example.json', '_example.md']) link(path.join(appContent, 'review', example), path.join(contentDir, 'review', example))
}

const prepared = ((globalThis as { __preparedUserRoots?: Set<string> }).__preparedUserRoots ??= new Set())

/**
 * Creates (or completes) a learner's folder and returns it. Idempotent and cheap after the first call per process.
 * `appRoot` is the app folder (shared content, public, models, cache, data).
 */
export function ensureUserRoot(uid: string, appRoot: string): string {
  const root = userRootDir(uid)
  if (prepared.has(root)) return root
  const appContent = path.join(appRoot, 'content')
  const content = path.join(root, 'content')
  mkdirSync(path.join(root, 'progress'), { recursive: true })
  mkdirSync(content, { recursive: true })
  for (const name of PERSONAL_CONTENT) mkdirSync(path.join(content, name), { recursive: true })
  seedPersonal(content, appContent)
  for (const entry of existsSync(appContent) ? readdirSync(appContent) : []) {
    if ((PERSONAL_CONTENT as readonly string[]).includes(entry) || entry === 'grammar') continue
    link(path.join(appContent, entry), path.join(content, entry))
  }
  const grammar = path.join(content, 'grammar')
  mkdirSync(grammar, { recursive: true })
  for (const entry of existsSync(path.join(appContent, 'grammar')) ? readdirSync(path.join(appContent, 'grammar')) : []) {
    if (!PERSONAL_GRAMMAR.includes(entry)) link(path.join(appContent, 'grammar', entry), path.join(grammar, entry))
  }
  const appPublic = path.join(appRoot, 'public')
  const pub = path.join(root, 'public')
  mkdirSync(pub, { recursive: true })
  for (const name of PERSONAL_PUBLIC) mkdirSync(path.join(pub, name), { recursive: true })
  for (const entry of existsSync(appPublic) ? readdirSync(appPublic) : []) {
    if (!PERSONAL_PUBLIC.includes(entry)) link(path.join(appPublic, entry), path.join(pub, entry))
  }
  const data = path.join(root, 'data')
  mkdirSync(data, { recursive: true })
  const appData = path.join(appRoot, 'data')
  for (const name of ['news.json', 'pipeline_state.json', 'vapid.json']) {
    if (!PERSONAL_DATA.includes(name)) link(path.join(appData, name), path.join(data, name))
  }
  link(path.join(appRoot, 'models'), path.join(root, 'models'))
  link(path.join(appRoot, 'cache'), path.join(root, 'cache'))
  prepared.add(root)
  return root
}

/** Forgets the "already prepared" mark (tests, account deletion). */
export function forgetUserRoot(uid: string) {
  prepared.delete(userRootDir(uid))
}
