'use client'

import React from 'react'
import { CardSwipe, defaultCards, type CardItem } from './CardSwipe'

export function CardSwipeDemo() {
  const handleBuyNow = (card: CardItem) => {
    // Scroll to product catalog or trigger purchase action
    const target = document.querySelector('#products') || document.querySelector('.grid-products')
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <section
      className="f9-card-swipe-demo"
      style={{
        padding: '40px 20px',
        width: '100%',
        maxWidth: '1380px',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <span
          style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#8A6BA8',
            display: 'inline-block',
            marginBottom: '6px',
          }}
        >
          Organic Period Care Range
        </span>
        <h2
          style={{
            margin: '0 0 10px 0',
            fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
            fontWeight: 800,
            color: '#2C1B4D',
            letterSpacing: '-0.02em',
          }}
        >
          Choose Your Perfect Fit
        </h2>
        <p
          style={{
            margin: '0 auto',
            maxWidth: '640px',
            fontSize: '0.95rem',
            color: '#65557E',
            lineHeight: 1.5,
          }}
        >
          Swipe or drag to explore our doctor-backed organic sanitary pads, panty liners, and overnight period panty range.
        </p>
      </div>

      <CardSwipe cards={defaultCards} onBuyNow={handleBuyNow} />
    </section>
  )
}

export default CardSwipeDemo
