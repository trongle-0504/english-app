import { FeatureGrid } from './FeatureGrid'
import { Hero } from './Hero'
import { LatestPosts } from './LatestPosts'

export default function HomePage() {
  return (
    <>
      <title>NeSy · Hôm nay</title>
      <Hero />
      <FeatureGrid />
      <LatestPosts />
    </>
  )
}
