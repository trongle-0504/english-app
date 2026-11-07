import { FeatureGrid } from './FeatureGrid'
import { Hero } from './Hero'
import { LatestPosts } from './LatestPosts'

export default function HomePage() {
  return (
    <>
      <title>NeSy · Today</title>
      <Hero />
      <FeatureGrid />
      <LatestPosts />
    </>
  )
}
