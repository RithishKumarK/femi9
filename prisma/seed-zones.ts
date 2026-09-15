import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const def = await prisma.priceZone.upsert({
    where: { name: 'Default' },
    create: { name: 'Default', discountPct: 0, isDefault: true, position: 0 },
    update: { isDefault: true },
  })
  const tn = await prisma.priceZone.upsert({
    where: { name: 'Tamil Nadu' },
    create: { name: 'Tamil Nadu', discountPct: 10, isDefault: false, position: 1 },
    update: {},
  })
  await prisma.zoneRegion.upsert({
    where: { kind_value: { kind: 'state', value: 'Tamil Nadu' } },
    create: { zoneId: tn.id, kind: 'state', value: 'Tamil Nadu' },
    update: { zoneId: tn.id },
  })
  void def
  const zones = await prisma.priceZone.findMany({ include: { _count: { select: { regions: true } } }, orderBy: { position: 'asc' } })
  console.log('Seeded:', zones.map(z => `${z.name} (${z.discountPct}% off, ${z._count.regions} region(s)${z.isDefault ? ', DEFAULT' : ''})`).join('  |  '))
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
