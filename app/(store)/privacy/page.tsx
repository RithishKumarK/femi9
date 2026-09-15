import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy · Femi9',
  description: 'How Femi9 handles account, order, and website information.',
}

export default function PrivacyPage() {
  return (
    <main className="section">
      {/* `legal` carries the heading/body type scale (app.css). Without it the
          headings fall back to the UA `2em`/`1.5em` defaults against a 15px
          body, which leaves the h1 only 1.33x the h2 on a phone. */}
      <div className="wrap legal" style={{ maxWidth: 820 }}>
        <span className="eyebrow">Femi9</span>
        <h1 className="display" style={{ marginTop: 14 }}>Privacy Policy</h1>
        <p className="pdp-long" style={{ marginTop: 24 }}>
          We collect only the information needed to provide accounts, orders,
          support, and cycle features. We do not sell personal information.
        </p>
        <h2>What we use</h2>
        <p className="pdp-long" style={{ marginTop: 12 }}>
          Contact and delivery details are used to process your requests and
          support your account. Optional cycle and symptom entries are stored
          for your account experience and are encrypted before storage.
        </p>
        <h2>Your choices</h2>
        <p className="pdp-long" style={{ marginTop: 12 }}>
          You can contact Femi9 through the support links on this site to ask
          about, correct, or delete your account information.
        </p>
      </div>
    </main>
  )
}
