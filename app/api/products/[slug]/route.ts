import { ok, notFound, handle } from '@femi9/core/api'
import { getProduct } from '@femi9/core/services/products'

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return handle(async () => {
    const result = await getProduct('femi9', params.slug)
    // getProduct returns null for unknown/inactive slugs → surface as 404
    return result ? ok(result) : notFound()
  })
}
