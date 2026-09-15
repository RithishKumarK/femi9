// Survey (and optionally fix) em dashes in every text column of the database.
// Read-only unless --apply is passed.
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

const cols = await prisma.$queryRawUnsafe(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type IN ('text', 'character varying', 'ARRAY')
  ORDER BY table_name, column_name
`)

const q = (s) => '"' + s.replace(/"/g, '""') + '"'
const findings = []

for (const c of cols) {
  const t = q(c.table_name)
  const col = q(c.column_name)
  // array columns need array_to_string before a LIKE
  const expr = c.data_type === 'ARRAY' ? `array_to_string(${col}, ' ')` : col
  let n = 0
  try {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM ${t} WHERE ${expr} LIKE '%' || chr(8212) || '%'`,
    )
    n = r[0].n
  } catch (e) {
    continue // non-text ARRAY (e.g. enum[]), skip
  }
  if (n > 0) findings.push({ ...c, rows: n, expr })
}

if (!findings.length) {
  console.log('No em dashes found in any text column.')
} else {
  console.log('Rows containing an em dash:')
  for (const f of findings) console.log(`  ${f.table_name}.${f.column_name} (${f.data_type}): ${f.rows}`)
}

if (APPLY && findings.length) {
  console.log('\nApplying replacements...')
  for (const f of findings) {
    const t = q(f.table_name)
    const col = q(f.column_name)
    let sql
    if (f.data_type === 'ARRAY') {
      // rebuild the array element by element
      sql = `UPDATE ${t} SET ${col} = ARRAY(SELECT replace(e, chr(8212), '-') FROM unnest(${col}) AS e)
             WHERE array_to_string(${col}, ' ') LIKE '%' || chr(8212) || '%'`
    } else {
      sql = `UPDATE ${t} SET ${col} = replace(${col}, chr(8212), '-')
             WHERE ${col} LIKE '%' || chr(8212) || '%'`
    }
    const n = await prisma.$executeRawUnsafe(sql)
    console.log(`  ${f.table_name}.${f.column_name}: ${n} rows updated`)
  }
}

await prisma.$disconnect()
