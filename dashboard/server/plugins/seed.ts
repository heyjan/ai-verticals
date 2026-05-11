/**
 * Nitro server plugin – seeds the SQLite database on first startup.
 *
 * Runs once when the server boots.  If the jobs table is empty it
 * reads the source JSON, classifies every job, bulk-inserts them,
 * and persists the database to disk.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDb, saveDb } from '../database'
import { classifyJob } from '../database/categories'

interface RawJob {
  source: string
  source_id: string
  title: string
  company: string
  location: string
  city: string
  description: string
  salary: string
  job_level: string
  posted_ago: string
  contract_type: string
  sector: string
  url: string
}

export default defineNitroPlugin(async () => {
  const db = await getDb()

  // Check if the table already has data
  const result = db.exec('SELECT COUNT(*) as cnt FROM jobs')
  const count = result[0]?.values[0]?.[0] as number
  if (count > 0) {
    console.log(`[seed] Database already contains ${count} jobs – skipping seed.`)
    return
  }

  // Resolve the data file path relative to the project root
  const dataFileRaw = process.env.DATA_FILE_PATH || '../data/merged_jobs_20260511_220314.json'
  const dataFilePath = resolve(process.cwd(), dataFileRaw)
  console.log(`[seed] Reading jobs from ${dataFilePath}`)

  const raw = await readFile(dataFilePath, 'utf-8')
  const jobs: RawJob[] = JSON.parse(raw)

  console.log(`[seed] Classifying and inserting ${jobs.length} jobs...`)

  const insertStmt = db.prepare(`
    INSERT INTO jobs (
      source, source_id, title, company, location, city,
      description, salary, job_level, posted_ago, contract_type,
      sector, url, category
    ) VALUES (
      :source, :source_id, :title, :company, :location, :city,
      :description, :salary, :job_level, :posted_ago, :contract_type,
      :sector, :url, :category
    )
  `)

  db.run('BEGIN TRANSACTION')

  try {
    for (const job of jobs) {
      const category = classifyJob(job.title, job.description)
      insertStmt.run({
        ':source': job.source || '',
        ':source_id': job.source_id || '',
        ':title': job.title || '',
        ':company': job.company || '',
        ':location': job.location || '',
        ':city': job.city || '',
        ':description': job.description || '',
        ':salary': job.salary || '',
        ':job_level': job.job_level || '',
        ':posted_ago': job.posted_ago || '',
        ':contract_type': job.contract_type || '',
        ':sector': job.sector || '',
        ':url': job.url || '',
        ':category': category,
      })
    }

    db.run('COMMIT')
  }
  catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  finally {
    insertStmt.free()
  }

  // Persist to disk
  await saveDb()

  console.log(`[seed] Successfully seeded ${jobs.length} jobs.`)
})
