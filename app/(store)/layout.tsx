'use client'

import { Nav } from '@/components/Nav'
import { Footer } from '@/components/Footer'
import { usePathname } from 'next/navigation'

/**
 * The page background is a static CSS field (.liquid-bg--fallback), not a WebGL
 * canvas — LiquidBackground and FluidCursor were removed in the Hallmark audit.
 */
function PageField() {
  return <div className="liquid-bg liquid-bg--fallback" aria-hidden="true" />
}

/** Storefront chrome: replaces the old react-router StoreLayout + <Outlet />. */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/') return children

  return (
    <>
      <PageField />
      <Nav />
      {children}
      <Footer />
    </>
  )
}
