/**
 * Job category classification based on keyword matching.
 *
 * Categories are ordered from most specific to least specific so that
 * niche roles (e.g. Training/Annotation, Robotics/Hardware) are matched
 * before broad categories like Engineering/Development.
 */

export interface CategoryDef {
  name: string
  keywords: string[]
}

/**
 * Order matters: earlier entries take priority.  More-specific categories
 * come first so they are not swallowed by broad ones like Engineering.
 */
export const CATEGORIES: CategoryDef[] = [
  {
    name: 'Training/Annotation',
    keywords: [
      'trainer', 'annotator', 'annotation', 'labeling', 'data quality',
    ],
  },
  {
    name: 'Robotics/Hardware',
    keywords: [
      'robotics', 'robot', 'embedded', 'hardware', 'firmware', 'sensor',
      'mechatronics', 'automation',
    ],
  },
  {
    name: 'Research',
    keywords: [
      'research associate', 'wissenschaftlich', 'forscher', 'postdoc',
      'phd', 'professor', 'research fellow',
    ],
  },
  {
    name: 'Data Science/ML',
    keywords: [
      'data scientist', 'machine learning', 'deep learning', 'ml engineer',
      'ai researcher', 'research scientist', 'nlp', 'computer vision',
      'neural', 'llm',
    ],
  },
  {
    name: 'Data Engineering',
    keywords: [
      'data engineer', 'analytics', 'data analyst', 'bi',
      'business intelligence', 'etl', 'data platform',
    ],
  },
  {
    name: 'Product/Design',
    keywords: [
      'product manager', 'product owner', 'ux', 'ui', 'design',
      'user experience',
    ],
  },
  {
    name: 'Consulting',
    keywords: [
      'consultant', 'berater', 'strategy', 'advisory', 'transformation',
    ],
  },
  {
    name: 'Sales/Marketing',
    keywords: [
      'sales', 'marketing', 'growth', 'account',
      'business development', 'vertrieb',
    ],
  },
  {
    name: 'HR/People',
    keywords: [
      'recruiting', 'talent', 'people', 'hr', 'human resources',
      'onboarding', 'employer branding',
    ],
  },
  {
    name: 'Finance/Legal',
    keywords: [
      'finance', 'accounting', 'audit', 'risk', 'compliance', 'legal', 'tax',
    ],
  },
  {
    name: 'Operations/Logistics',
    keywords: [
      'operations', 'logistics', 'supply chain', 'warehouse', 'procurement',
    ],
  },
  {
    name: 'Management',
    keywords: [
      'head of', 'director', 'vp', 'vice president', 'cto', 'ceo',
      'lead', 'manager', 'leiter',
    ],
  },
  {
    name: 'Engineering/Development',
    keywords: [
      'engineer', 'developer', 'entwickler', 'backend', 'frontend',
      'fullstack', 'devops', 'platform', 'infrastructure', 'cloud',
      'software', 'architect',
    ],
  },
]

/**
 * Build a single regex per keyword that respects word boundaries.
 * Multi-word keywords are matched literally; single-word keywords use \b.
 */
function buildRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // For multi-word keywords use the escaped string directly (spaces act as
  // natural word boundaries).  For single-word keywords wrap in \b.
  if (keyword.includes(' ')) {
    return new RegExp(`\\b${escaped}\\b`, 'i')
  }
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

// Pre-compile regexes once at module load time.
const compiledCategories = CATEGORIES.map(cat => ({
  name: cat.name,
  patterns: cat.keywords.map(kw => buildRegex(kw)),
}))

/**
 * Classify a job into a category.
 *
 * Strategy:
 *   1. Check title against each category (in priority order).
 *   2. If no match, check description.
 *   3. Fall back to "Other".
 */
export function classifyJob(title: string, description: string): string {
  const titleLower = (title || '').toLowerCase()
  const descLower = (description || '').toLowerCase()

  // Pass 1 – match against title
  for (const cat of compiledCategories) {
    for (const pattern of cat.patterns) {
      if (pattern.test(titleLower)) {
        return cat.name
      }
    }
  }

  // Pass 2 – match against description
  for (const cat of compiledCategories) {
    for (const pattern of cat.patterns) {
      if (pattern.test(descLower)) {
        return cat.name
      }
    }
  }

  return 'Other'
}
