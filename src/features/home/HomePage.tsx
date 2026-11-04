import { FeatureGrid } from './FeatureGrid'
import { Hero } from './Hero'
import { LatestPosts } from './LatestPosts'

export default function HomePage() {
  return (
    <>
      <title>NeuralSymbolic · Mastery Through Connection</title>
      <Hero />
      <FeatureGrid />
      <LatestPosts />
    </>
  )
}
