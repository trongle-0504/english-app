import { FeatureGrid } from './FeatureGrid'
import { Hero } from './Hero'
import { LatestPosts } from './LatestPosts'

export default function HomePage() {
  return (
    <>
      <title>NeSy</title>
      <Hero />
      <FeatureGrid />
      <LatestPosts />
    </>
  )
}
