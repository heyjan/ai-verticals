import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location').notNull(),
    city: text('city').notNull(),
    description: text('description').notNull().default(''),
    salary: text('salary').notNull().default(''),
    jobLevel: text('job_level').notNull().default(''),
    postedAgo: text('posted_ago').notNull().default(''),
    contractType: text('contract_type').notNull().default(''),
    sector: text('sector').notNull().default(''),
    url: text('url').notNull().default(''),
    category: text('category').notNull().default('Other'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('jobs_source_unique').on(t.source, t.sourceId),
    index('jobs_category_idx').on(t.category),
    index('jobs_city_idx').on(t.city),
    index('jobs_company_idx').on(t.company),
    index('jobs_first_seen_at_idx').on(t.firstSeenAt),
    index('jobs_last_seen_at_idx').on(t.lastSeenAt),
  ],
)

export const subcategories = pgTable(
  'subcategories',
  {
    id: serial('id').primaryKey(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    keywords: text('keywords').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('subcategories_category_name_unique').on(t.category, t.name)],
)

export const tools = pgTable('tools', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  keywords: text('keywords').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const jobSubcategories = pgTable(
  'job_subcategories',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    subcategoryId: integer('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.subcategoryId] }),
    index('job_subcategories_subcategory_idx').on(t.subcategoryId),
  ],
)

export const jobTools = pgTable(
  'job_tools',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    toolId: integer('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.toolId] }),
    index('job_tools_tool_idx').on(t.toolId),
  ],
)

export const companyDescriptions = pgTable('company_descriptions', {
  id: serial('id').primaryKey(),
  company: text('company').notNull().unique(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
export type Subcategory = typeof subcategories.$inferSelect
export type Tool = typeof tools.$inferSelect
export type CompanyDescription = typeof companyDescriptions.$inferSelect

export { sql }
