export const WRITING_REVIEW_TYPES = [
  'Agree & disagree',
  'Discuss both views',
  'Advantages & Disadvantages',
  'Two-part questions',
  'Problems-causes-solutions',
  'Other',
] as const

export const WRITING_REVIEW_TOPICS = [
  'Education',
  'Lifestyle',
  'Work',
  'Entertainment',
  'Environment',
  'Technology',
  'Social issues',
  'Crime',
  'Government',
  'Advertisement',
  'Sport',
  'Transport',
  'Food & Drinks',
  'Health',
  'Business',
  'Science & Energy',
  'Tourism',
  'Family',
  'Architecture',
  'History',
  'Art',
  'Economics',
  'Plant & Animals',
  'Other',
] as const

export type WritingReviewType = (typeof WRITING_REVIEW_TYPES)[number]
export type WritingReviewTopic = (typeof WRITING_REVIEW_TOPICS)[number]
