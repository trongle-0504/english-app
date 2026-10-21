import {
  AudioLines,
  BookOpen,
  BookText,
  Coins,
  Brain,
  FileText,
  Headphones,
  Layers,
  Library,
  Mic,
  type LucideIcon,
  NotebookPen,
  Repeat,
  PenLine,
  Settings,
  Sparkles,
  MessageSquareQuote,
  ShieldCheck,
  SpellCheck,
  Volume2,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  description?: string
  icon: LucideIcon
  /** An AI tool (Claude / Gemini): shown with a small "AI" badge. */
  ai?: boolean
  /**
   * Paths this item covers besides `to` and the pages under it. With `exact`, pages under `to` do not count:
   * /practice is the quiz list, while /practice/writing belongs to Writing.
   */
  match?: string[]
  exact?: boolean
}

export interface NavGroup {
  label: string
  /** Single link, or a dropdown when `items` is set. */
  to?: string
  items?: NavItem[]
  icon: LucideIcon
  /** Single links: what the page is for (home page cards). */
  description?: string
  /** Single links: matches when the current path starts with any of these. */
  match: string[]
}

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** The current path is this item's page (or a page under it, unless `exact`). */
export function itemMatches(item: NavItem, pathname: string): boolean {
  return (item.exact ? pathname === item.to : under(pathname, item.to)) || (item.match ?? []).some((prefix) => under(pathname, prefix))
}

/**
 * Grouped by IELTS skill — each skill has what to learn, what to practise and its AI tools — then the daily review
 * and the blog, which serve every skill.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Vocabulary',
    icon: BookOpen,
    match: [],
    items: [
      { to: '/collocations', label: 'Collocations', description: 'Bài học collocation theo chủ đề', icon: Layers },
      { to: '/vocabulary', label: 'Topic Vocabulary', description: 'Từ vựng IELTS theo chủ đề', icon: BookOpen },
      { to: '/notes', label: 'Notes', description: 'Cấu trúc, idiom & collocation đã ghi chú', icon: NotebookPen },
      { to: '/practice', label: 'Vocabulary Quiz', description: 'Trắc nghiệm & điền từ', icon: Brain, exact: true, match: ['/practice/quiz'] },
    ],
  },
  {
    label: 'Grammar',
    icon: SpellCheck,
    match: [],
    items: [
      { to: '/grammar', label: 'Grammar Library', description: 'Cấu trúc, cách dùng, dấu hiệu', icon: SpellCheck },
      { to: '/grammar-analyze', label: 'Sentence Analyzer', description: 'Phân tích câu theo Linear Thinking', icon: Sparkles, ai: true },
    ],
  },
  {
    label: 'Writing',
    icon: PenLine,
    match: [],
    items: [
      { to: '/practice/essays', label: 'Model Essays', description: 'Học từ vựng & cách viết từ bài mẫu', icon: Library },
      { to: '/practice/writing', label: 'Writing Practice', description: 'Điền chỗ trống & viết có hướng dẫn', icon: PenLine },
      { to: '/practice/writing-review', label: 'Writing Review', description: 'Sửa bài, đối chiếu Longman & OZDIC', icon: ShieldCheck, ai: true },
      { to: '/practice/mistakes', label: 'Sổ lỗi', description: 'Lỗi hay mắc trong bài của bạn, thành thẻ ôn', icon: NotebookPen },
    ],
  },
  {
    label: 'Speaking',
    icon: Mic,
    match: [],
    items: [
      {
        to: '/practice/speaking-ideas',
        label: 'Speaking Ideas',
        description: 'Cụm từ & câu trả lời mẫu theo Linearthinking',
        icon: MessageSquareQuote,
        ai: true,
      },
      {
        to: '/practice/speaking-review',
        label: 'Speaking Review',
        description: 'Ghi âm câu trả lời, chấm theo 4 tiêu chí IELTS',
        icon: AudioLines,
        ai: true,
      },
      { to: '/practice/speaking', label: 'Read Aloud', description: 'Nghe cách phát âm câu trả lời của bạn', icon: Volume2 },
    ],
  },
  {
    label: 'Listening',
    icon: Headphones,
    match: [],
    items: [
      { to: '/practice/dictation', label: 'Dictation', description: 'Chép chính tả từng câu', icon: Headphones },
      {
        to: '/practice/listening-simplify',
        label: 'Simplify Transcript',
        description: 'Tách trục chính, phần lướt qua và chỗ dẫn tới đáp án',
        icon: Sparkles,
        ai: true,
      },
    ],
  },
  { label: 'Review', to: '/review', icon: Repeat, description: 'Ôn tập ngắt quãng & luyện dùng từ', match: ['/review'] },
  { label: 'Blog', to: '/blog', icon: BookText, description: 'Hướng dẫn kỹ năng & bài luyện theo chủ đề', match: ['/blog'] },
]

export const adminNav: NavItem[] = [
  { to: '/admin/vocabulary', label: 'Vocabulary', icon: BookOpen },
  { to: '/admin/grammar', label: 'Grammar', icon: SpellCheck },
  { to: '/admin/note', label: 'Notes', icon: NotebookPen },
  { to: '/admin/blog', label: 'Blog', icon: FileText },
  { to: '/admin/essays', label: 'Essays', icon: Library },
  { to: '/admin/usage', label: 'Usage', icon: Coins },
]

export const AdminIcon = Settings

export function isGroupActive(group: NavGroup, pathname: string): boolean {
  if (group.items) return group.items.some((item) => itemMatches(item, pathname))
  return group.match.some((prefix) => under(pathname, prefix))
}

/** The most specific item matching the current path. */
export function activeItem(items: NavItem[], pathname: string): NavItem | undefined {
  return items.filter((item) => itemMatches(item, pathname)).sort((a, b) => b.to.length - a.to.length)[0]
}
