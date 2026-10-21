import { FeatureGrid } from './FeatureGrid'
import { Hero } from './Hero'
import { LatestPosts } from './LatestPosts'

export default function HomePage() {
  return (
    <>
      <title>LinearThinking · Mastery Through Connection</title>
      <Hero />
      <FeatureGrid />
      <LatestPosts />
    </>
  )
}
