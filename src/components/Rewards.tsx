'use client'

/**
 * Femi9 Rewards — the Bloom points panel on /account.
 *
 * Two things this used to get wrong, both fixed here:
 *  1. The balance was seeded into useState from the prop, so a router.refresh()
 *     updated the hero badge but not this panel — the same page showed two
 *     different numbers and the affordability check ran against the stale one.
 *     The balance is now DERIVED from the prop; the only local state is the
 *     in-flight optimistic spend, cleared the moment fresh server data lands.
 *  2. "Ways to earn" was a hardcoded list advertising a +200 sign-up bonus, a
 *     +250 referral credit and a +100 profile bonus that no code path awards. It
 *     now renders the real settings, and the referral is a link to the programme
 *     rather than a points claim nothing honours.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link } from '@/lib/router-compat'
import { useCart } from '@/store/cart'
import { usePublicSettings } from '@/lib/use-public-settings'
import { IAlert, ICheck, IChevron, ICopy, IGift, IRupee, IStar } from './AppIcons'
import type { RewardOptionView } from '@femi9/core/services/rewards'
import type { AccountCoupon, ActivityItem, EarnRates } from '@femi9/core/services/account'

export interface RewardsProps {
  /** Server truth. The display is derived from this — never seeded into state. */
  pointsBalance: number
  rewardOptions: RewardOptionView[]
  activity: ActivityItem[]
  coupons: AccountCoupon[]
  earnRates: EarnRates
}

/** One-line perk description synthesised from the coupon the reward issues. */
function rewardSub(o: RewardOptionView): string {
  return o.couponType === 'pct'
    ? `${o.couponValue}% off your next order`
    : `Rs.${o.couponValue} off your next order`
}

export function Rewards({ pointsBalance, rewardOptions, activity, coupons, earnRates }: RewardsProps) {
  const router = useRouter()
  const { notify } = useCart()
  const { tharaEnabled } = usePublicSettings()

  // The only local balance state: points spent by a redeem whose refresh has not
  // landed yet. Any new server render (a fresh `coupons` array) clears it.
  const [pendingSpend, setPendingSpend] = useState(0)
  useEffect(() => {
    setPendingSpend(0)
  }, [pointsBalance, coupons])

  const [flashCode, setFlashCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const balance = Math.max(0, pointsBalance - pendingSpend)

  const sorted = useMemo(() => [...rewardOptions].sort((a, b) => a.costPoints - b.costPoints), [rewardOptions])
  const nextTier = useMemo(() => sorted.find((r) => r.costPoints > balance) ?? null, [sorted, balance])
  const prevCost = useMemo(() => {
    const below = [...sorted].reverse().find((r) => r.costPoints <= balance)
    return below ? below.costPoints : 0
  }, [sorted, balance])
  const pct = nextTier
    ? Math.max(0, Math.min(100, Math.round(((balance - prevCost) / (nextTier.costPoints - prevCost)) * 100)))
    : 100

  // Every row here is backed by a real PointsLedger writer. Nothing else is
  // listed, because nothing else pays out.
  const earnRules = [
    { key: 'spend', Icon: IRupee, title: 'Every Rs.1 you spend', pts: `+${earnRates.pointsPerRupee}`, done: false },
    { key: 'review', Icon: IStar, title: 'Write a product review', pts: `+${earnRates.reviewPoints}`, done: false },
    {
      key: 'first',
      Icon: IGift,
      title: 'First order bonus',
      pts: `+${earnRates.firstOrderBonusPoints}`,
      done: earnRates.firstOrderBonusEarned,
    },
  ]

  async function redeem(r: RewardOptionView) {
    if (balance < r.costPoints || busyId) return
    setBusyId(r.id)
    setError(null)
    setFlashCode(null)
    try {
      const res = await fetch('/api/rewards/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rewardOptionId: r.id }),
      })
      const data = (await res.json().catch(() => null)) as { couponCode?: string; error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not redeem that reward right now. Please try again.')
        return
      }
      setPendingSpend((s) => s + r.costPoints)
      if (data?.couponCode) setFlashCode(data.couponCode)
      // The code is also persisted against this account, so the panel below is
      // the permanent copy — this flash is a convenience, not the only delivery.
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      notify('Code copied')
    } catch {
      notify('Select the code and copy it manually.')
    }
  }

  return (
    <div className="m-card m-card--roomy acct-rw">
      <div className="m-card__head">
        <div>
          <h2 className="m-h3">Femi9 Rewards</h2>
          <p>Earn Bloom points on every order and turn them into real discounts.</p>
        </div>
      </div>

      <div className="acct-rw__grid">
        {/* balance + progress */}
        <div className="acct-rw__balance">
          <span className="acct-rw__label">Your balance</span>
          <span className="acct-rw__num m-num">{balance.toLocaleString('en-IN')}</span>
          <span className="acct-rw__unit">Bloom points</span>

          <div
            className="acct-rw__track"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress to your next reward"
          >
            <span className="acct-rw__fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="acct-rw__note">
            {nextTier ? (
              <>
                {(nextTier.costPoints - balance).toLocaleString('en-IN')} points to <b>{nextTier.title}</b>
              </>
            ) : sorted.length > 0 ? (
              <>Every reward below is yours to claim.</>
            ) : (
              <>Earn points on your next order to unlock rewards.</>
            )}
          </p>

          {flashCode && (
            <div className="m-note acct-rw__flash" role="status">
              <ICheck aria-hidden="true" />
              <span>
                Unlocked. Your code <b className="acct-rw__code-inline">{flashCode}</b> is saved below and works at
                checkout.
              </span>
            </div>
          )}
          {error && (
            <p className="m-field__error acct-rw__flash" role="alert">
              <IAlert aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>

        {/* ways to earn */}
        <div className="acct-rw__earn">
          <span className="acct-rw__sublabel">Ways to earn</span>
          <ul className="acct-rw__earn-list">
            {earnRules.map((rule) => {
              const Icon = rule.Icon
              return (
                <li key={rule.key} className={rule.done ? 'is-done' : undefined}>
                  <span className="acct-rw__earn-ic" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="acct-rw__earn-t">{rule.title}</span>
                  <span className="acct-rw__earn-pts m-num">{rule.done ? 'Earned' : rule.pts}</span>
                </li>
              )
            })}
          </ul>
          {/* No points claim attached: nothing credits PointsLedger for a
              referral. The Thara programme pays store credit, and says so.
              Hidden when the programme is off, since /thara answers 404 from
              its API and would strand the visitor on an error card — the same
              gate Nav and Footer already apply. */}
          {tharaEnabled && (
            <Link className="m-linkbtn acct-rw__refer" to="/thara">
              Refer a friend
              <IChevron aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* redeem */}
      <span className="acct-rw__sublabel">Redeem your points</span>
      {rewardOptions.length === 0 ? (
        <p className="m-cap">No rewards in the catalogue just yet - check back soon.</p>
      ) : (
        <div className="acct-rw__redeem">
          {sorted.map((r) => {
            const affordable = balance >= r.costPoints
            const busy = busyId === r.id
            return (
              <article className={`acct-rw__reward${affordable ? ' can' : ''}`} key={r.id}>
                <div className="acct-rw__reward-top">
                  <b>{r.title}</b>
                  <span className="acct-rw__cost m-num">{r.costPoints.toLocaleString('en-IN')} pts</span>
                </div>
                <p className="m-cap">{rewardSub(r)}</p>
                {affordable ? (
                  <button
                    type="button"
                    className="btn btn-dark acct-rw__btn"
                    onClick={() => void redeem(r)}
                    disabled={busy}
                  >
                    {busy ? 'Redeeming…' : 'Redeem'}
                  </button>
                ) : (
                  // No dead control: below the threshold we state the gap instead
                  // of shipping a disabled button.
                  <span className="m-chip m-chip--quiet m-num acct-rw__togo">
                    {(r.costPoints - balance).toLocaleString('en-IN')} points to go
                  </span>
                )}
              </article>
            )
          })}
        </div>
      )}

      {/* reward codes the customer owns */}
      <span className="acct-rw__sublabel">Your reward codes</span>
      {coupons.length === 0 ? (
        <p className="m-cap">Redeemed codes are saved here, so you never have to remember one.</p>
      ) : (
        <ul className="acct-rw__codes">
          {coupons.map((c) => (
            <li className={`acct-rw__code${c.used ? ' is-used' : ''}`} key={c.id}>
              <div className="acct-rw__code-main">
                <span className="acct-rw__code-value m-num">{c.code}</span>
                <span className="m-cap">
                  {c.label}
                  {c.expires && !c.used ? ` · expires ${c.expires}` : ''}
                </span>
              </div>
              {c.used ? (
                <span className="m-status m-status--success">
                  <ICheck aria-hidden="true" />
                  Used
                </span>
              ) : (
                <button
                  type="button"
                  className="m-iconbtn"
                  onClick={() => void copyCode(c.code)}
                  aria-label={`Copy reward code ${c.code}`}
                >
                  <ICopy aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* recent points activity */}
      <span className="acct-rw__sublabel">Recent activity</span>
      {activity.length === 0 ? (
        <p className="m-cap">Points you earn and spend will be listed here.</p>
      ) : (
        <ul className="acct-rw__activity">
          {activity.map((a, idx) => (
            <li key={`${a.label}-${idx}`}>
              <div>
                <b>{a.label}</b>
                <span className="m-cap m-num">{a.date}</span>
              </div>
              <span className="acct-rw__act-pts m-num">{a.pts}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
