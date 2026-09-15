import type { Metadata } from 'next'
import { AboutScreen } from '@/screens/About'

export const metadata: Metadata = {
  title: 'About Us - Femi9',
  description: 'Built By A Doctor. Backed By Women. Made For Every Body. Learn about Femi9 organic period care and our mission.',
}

export default function AboutPage() {
  return <AboutScreen />
}
