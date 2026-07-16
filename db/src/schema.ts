import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['user', 'admin'])

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
    // Absolute posting date scraped from the source (LinkedIn's
    // <time datetime>, Xing's JSON-LD datePosted). Nullable: Glassdoor
    // only exposes a relative age. Lets us verify scrape freshness.
    postedDate: date('posted_date'),
    contractType: text('contract_type').notNull().default(''),
    sector: text('sector').notNull().default(''),
    url: text('url').notNull().default(''),
    category: text('category').notNull().default('Other'),
    // Soft-delete flag. A listing taken down at the source (e.g. Xing's
    // HTTP 410 "job ad isn't available") is set active=false by the prune
    // job instead of being deleted, so we keep its description and
    // enrichment. Live queries should filter `active = true`.
    active: boolean('active').notNull().default(true),
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
    index('jobs_posted_date_idx').on(t.postedDate),
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

// --- Auth (nuxt-auth-utils) -------------------------------------------------
// A dashboard visitor identity. Created lazily on first OAuth login or first
// passkey (WebAuthn) registration. `email` is nullable because some providers
// (e.g. X/Twitter) never return one; identity is then anchored by the linked
// oauth account row instead.
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  role: userRoleEnum('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// One row per external identity linked to a user. The (provider,
// provider_account_id) pair is globally unique and is what we look up on every
// OAuth callback to decide "returning user" vs "new signup".
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
)

// A registered WebAuthn passkey. `id` is the base64url credential ID returned
// by the authenticator; `publicKey` is the base64url COSE key. `counter` is the
// signature counter used to detect cloned authenticators and is bumped on each
// successful assertion. `transports` is a JSON-encoded string array.
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    backedUp: boolean('backed_up').notNull().default(false),
    transports: text('transports').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webauthn_credentials_user_idx').on(t.userId)],
)

export type CvDocumentContent = {
  type: 'doc'
  content?: unknown[]
}

export type CvPageSettings = {
  size: 'A4' | 'Letter'
  margin: {
    top: number
    right: number
    bottom: number
    left: number
  }
}

// One placement of a text block inside a template slot. `contentOverride`
// detaches this placement from the library block ("tweak just for this CV")
// without forking the block itself.
export type CvSlotAssignment = {
  blockId: number
  contentOverride?: CvDocumentContent | null
}

// Slot name (as defined by the template skeleton) -> ordered block placements.
// Slots that accept repeatable content (e.g. job bullets) hold multiple entries.
export type CvSlotAssignments = Record<string, CvSlotAssignment[]>

export const cvDocuments = pgTable(
  'cv_documents',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: text('template_id').notNull(),
    title: text('title').notNull().default('Untitled CV'),
    content: jsonb('content').$type<CvDocumentContent>().notNull(),
    themeOverrides: jsonb('theme_overrides')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    page: jsonb('page').$type<CvPageSettings>().notNull(),
    // Null for legacy free-form documents; set for slot-composed CVs built in
    // the CV editor. `content` stays the materialized doc used by exports.
    slotAssignments: jsonb('slot_assignments').$type<CvSlotAssignments>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cv_documents_user_idx').on(t.userId),
    index('cv_documents_user_updated_at_idx').on(t.userId, t.updatedAt),
  ],
)

// User-authored templates. Built-in templates live in server code and are
// merged with these at the API layer; text ids keep cv_documents.template_id
// compatible with both.
export const cvTemplates = pgTable(
  'cv_templates',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Untitled Template'),
    layout: text('layout').$type<'one-column' | 'compact-three-column'>().notNull().default('one-column'),
    theme: jsonb('theme').$type<Record<string, unknown>>().notNull(),
    page: jsonb('page').$type<CvPageSettings>().notNull(),
    // TipTap doc: fixed template chrome plus `textBlockSlot` placeholder nodes
    // that the CV editor turns into drop zones.
    skeleton: jsonb('skeleton').$type<CvDocumentContent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cv_templates_user_idx').on(t.userId)],
)

export const cvTextBlocks = pgTable(
  'cv_text_blocks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind').$type<'intro' | 'paragraph' | 'bullet' | 'heading'>().notNull().default('paragraph'),
    // TipTap doc fragment ({ type: 'doc', content: [...] }) so blocks round-trip
    // through the same editor and renderers as full documents.
    content: jsonb('content').$type<CvDocumentContent>().notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cv_text_blocks_user_idx').on(t.userId),
    index('cv_text_blocks_tags_idx').using('gin', t.tags),
  ],
)

export const cvFiles = pgTable(
  'cv_files',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: integer('document_id').references(() => cvDocuments.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'export' | 'upload'>().notNull(),
    format: text('format').$type<'html' | 'pdf' | 'docx' | null>(),
    originalName: text('original_name').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cv_files_user_idx').on(t.userId),
    index('cv_files_document_idx').on(t.documentId),
    uniqueIndex('cv_files_storage_key_unique').on(t.storageKey),
  ],
)

export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
export type Subcategory = typeof subcategories.$inferSelect
export type Tool = typeof tools.$inferSelect
export type CompanyDescription = typeof companyDescriptions.$inferSelect
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type OAuthAccount = typeof oauthAccounts.$inferSelect
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect
export type CvDocument = typeof cvDocuments.$inferSelect
export type NewCvDocument = typeof cvDocuments.$inferInsert
export type CvFile = typeof cvFiles.$inferSelect
export type NewCvFile = typeof cvFiles.$inferInsert
export type CvTemplateRow = typeof cvTemplates.$inferSelect
export type NewCvTemplateRow = typeof cvTemplates.$inferInsert
export type CvTextBlock = typeof cvTextBlocks.$inferSelect
export type NewCvTextBlock = typeof cvTextBlocks.$inferInsert

export { sql }
