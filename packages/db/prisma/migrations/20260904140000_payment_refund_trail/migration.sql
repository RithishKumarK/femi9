-- The gateway's own record of a refund, kept where the money is.
--
-- `refundPayment` has always RETURNED the refund id and nothing ever wrote it
-- down: it reached exactly one `console.warn` on the adopt path and was then
-- discarded. So an operator looking at a refunded order could see that our
-- status said 'refunded' and had no way to tie that to anything in the Razorpay
-- dashboard — reconciling a disputed refund meant matching by payment id and
-- eyeballing timestamps.
--
-- `refundedAt` is separate from the Payment row's `createdAt`, which records
-- when the payment INTENT was opened at checkout, not when money moved back.
--
-- Both columns are NULLABLE with no default, so this is purely additive: every
-- existing Payment reads as "no refund recorded", which is true of the ones
-- never refunded and honestly unknown for any refunded before this shipped.
ALTER TABLE "Payment" ADD COLUMN "razorpayRefundId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundedAt" TIMESTAMP(3);
