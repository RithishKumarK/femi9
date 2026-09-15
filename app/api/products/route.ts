import { ok, handle } from '@femi9/core/api'
import { listProducts } from '@femi9/core/services/products'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => ok(await listProducts('femi9')))
}
