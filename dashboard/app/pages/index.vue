<script setup lang="ts">
useHead({
  title: 'ai-verticals. · Der deutsche KI-Arbeitsmarkt, live vermessen',
  meta: [
    {
      name: 'description',
      content:
        'ai-verticals analysiert über 10.000 deutsche KI-Stellenanzeigen und macht sichtbar, welche Unternehmen welche Lösungen implementieren, durchsuchbar per Chat.',
    },
  ],
})

// ── Live stats (fallbacks match the design comp) ─────────────────────
const overview = useFetch('/api/stats/overview', { lazy: true })
const growth = useFetch('/api/stats/growth', { lazy: true })

const fmt = (n: number) => n.toLocaleString('de-DE')
const stats = computed(() => {
  const o = overview.data.value as Record<string, any> | undefined
  const g = (growth.data.value as any)?.summary
  return {
    jobs: o?.total ? fmt(o.total) : '5.343',
    companies: o?.totalCompanies ? fmt(o.totalCompanies) : '2.813',
    cities: o?.totalCities ? fmt(o.totalCities) : '617',
    velocity: g?.new_last3 ? String(Math.round(g.new_last3 / 3)) : '152',
  }
})

// ── Hero persona switcher ────────────────────────────────────────────
const personas = [
  {
    label: 'Product Manager',
    title: 'Finden Sie die KI-Use-Cases, die andere schon bauen.',
    sub: 'ai-verticals analysiert über 10.000 deutsche KI-Stellenanzeigen und macht sichtbar, welche Unternehmen welche Lösungen implementieren. Durchsuchbar per Chat, in Sekunden.',
  },
  {
    label: 'Manager',
    title: 'Wissen, wann Ihr Wettbewerber auf KI setzt.',
    sub: 'Jede neue KI-Stelle Ihrer Wettbewerber, in Echtzeit erfasst. Alerts einrichten, Details per Chat abfragen: Marktbewegungen sehen, bevor sie in der Presse stehen.',
  },
  {
    label: 'Consultant',
    title: 'Der deutsche KI-Arbeitsmarkt, quantifiziert.',
    sub: 'KI-Adoption nach Branche, Stadt, Skill und Zeitverlauf: belastbare Daten für Studien, Pitches und Client-Work statt Bauchgefühl.',
  },
  {
    label: 'AI-Karriere',
    title: 'Ihr Weg in den KI-Job, mit dem richtigen CV.',
    sub: 'Sehen, welche Skills wirklich gefragt sind, und mit dem CV Maker aus Ihrem Career Memory für jede Stelle den passenden Lebenslauf bauen.',
  },
]
const persona = ref(0)

// ── Animated chat demo ───────────────────────────────────────────────
interface SqlPart { t: string; c: string }
const convos = [
  {
    label: 'Hat Deloitte diesen Monat KI-Stellen ausgeschrieben?',
    question: 'Hat mein Wettbewerber Deloitte diesen Monat KI-Stellen ausgeschrieben?',
    sql: [
      ['SELECT', 'kw'], [' title, city, posted_at ', ''], ['FROM', 'kw'], [' postings\n', ''],
      ['WHERE', 'kw'], [" company = 'Deloitte' ", ''], ['AND', 'kw'], [" posted_at >= '2026-07-01';", ''],
    ],
    lead: 'Ja, 12 neue KI-Stellen im Juli,',
    rest: 'davon 5 in Berlin. Schwerpunkt: GenAI-Consulting und LLM-Engineering. Auffällig: erstmals eine Rolle für AI Agents / Orchestrierung.',
    chips: ['alle 12 anzeigen', 'Alert einrichten'],
  },
  {
    label: 'Top AI Skills in München?',
    question: 'Welche Skills werden in Münchner AI Stellen am häufigsten verlangt?',
    sql: [
      ['SELECT', 'kw'], [' skill, COUNT(*) ', ''], ['FROM', 'kw'], [' posting_skills\n', ''],
      ['WHERE', 'kw'], [" city = 'München' ", ''], ['AND', 'kw'], [" tags @> '{AI}'\n", ''],
      ['GROUP BY', 'kw'], [' skill ', ''], ['ORDER BY', 'kw'], [' 2 DESC ', ''], ['LIMIT', 'kw'], [' 5;', ''],
    ],
    lead: 'Top 5 in 87 Münchner AI Postings:',
    rest: 'Python (71), LangChain (58), Vektordatenbanken (44), OpenAI API (39), Kubernetes (21). LangChain wächst am schnellsten: +34 % ggü. Q1.',
    chips: ['als Chart anzeigen', 'Postings öffnen'],
  },
  {
    label: 'Welche Banken suchen AI-Engineers?',
    question: 'Welche deutschen Banken suchen gerade AI-Engineers?',
    sql: [
      ['SELECT DISTINCT', 'kw'], [' company, city ', ''], ['FROM', 'kw'], [' postings\n', ''],
      ['WHERE', 'kw'], [" industry = 'Banking' ", ''], ['AND', 'kw'], [' title ', ''], ['ILIKE', 'kw'], [" '%AI%';", ''],
    ],
    lead: '7 Banken, 11 offene Rollen:',
    rest: 'darunter Deutsche Bank (3, Frankfurt), Commerzbank (2) und DZ Bank. 8 der 11 Postings nennen Python als Kernanforderung.',
    chips: ['alle 11 anzeigen', 'Branche abonnieren'],
  },
]
const convo = ref(0)
const chatStep = ref(0)
const chatScript = [
  { step: 1, delay: 600 },
  { step: 2, delay: 1400 },
  { step: 3, delay: 1600 },
  { step: 4, delay: 1200 },
]
let chatTimers: ReturnType<typeof setTimeout>[] = []

function runChat(i = convo.value) {
  chatTimers.forEach(clearTimeout)
  chatTimers = []
  convo.value = i
  chatStep.value = 0
  let acc = 0
  for (const { step, delay } of chatScript) {
    acc += delay
    chatTimers.push(setTimeout(() => { chatStep.value = step }, acc))
  }
}

onMounted(() => runChat(0))
onBeforeUnmount(() => chatTimers.forEach(clearTimeout))

const activeConvo = computed(() => convos[convo.value]!)
const sqlParts = computed<SqlPart[]>(() =>
  activeConvo.value.sql.map(([t, c]) => ({ t: t as string, c: c as string })),
)

// ── Personas grid ────────────────────────────────────────────────────
const personaCards = [
  {
    tag: '01 // PRODUCT MANAGER',
    title: 'Use Cases entdecken',
    text: 'Welche KI-Anwendungsfälle bauen andere gerade? Nach Branche, Rolle und Tool filtern und Roadmap-Entscheidungen mit Marktdaten belegen.',
    dark: true,
  },
  {
    tag: '02 // MANAGER',
    title: 'Wettbewerber beobachten',
    text: 'Hat der Wettbewerber eine KI-Stelle ausgeschrieben? Alerts in Echtzeit, und der Chatbot beantwortet die Detailfragen.',
    dark: false,
  },
  {
    tag: '03 // CONSULTANT',
    title: 'Markt analysieren',
    text: 'KI-Adoption nach Branche, Stadt und Skill: belastbare Zahlen für Studien, Pitches und Client-Work.',
    dark: false,
  },
  {
    tag: '04 // AI-KARRIERE',
    title: 'In KI einsteigen',
    text: 'Sehen, welche Skills wirklich gefragt sind, und mit dem CV Maker die passende Bewerbung bauen.',
    dark: false,
  },
]

// ── CV maker steps ───────────────────────────────────────────────────
const cvSteps = [
  {
    title: 'CVs hochladen, Textblöcke erhalten',
    text: 'Erfahrungen, Projekte und Skills werden automatisch extrahiert.',
  },
  {
    title: 'Bewährte Templates wählen',
    text: 'Templates, die bei Google, Amazon und Microsoft funktionieren.',
  },
  {
    title: 'Pro Job optimieren',
    text: 'Das Career Memory wählt für jede Stellenanzeige die stärksten Blöcke.',
  },
]

// ── Testimonials (placeholders until real quotes land) ───────────────
const testimonials = [
  {
    quote: '„[Testimonial folgt: Platz für ein Zitat eines Product Managers über Use-Case-Recherche.]"',
    name: 'Name', role: 'Product Manager, Unternehmen',
  },
  {
    quote: '„[Testimonial folgt: Platz für ein Zitat einer Führungskraft über Wettbewerber-Alerts.]"',
    name: 'Name', role: 'Manager, Unternehmen',
  },
  {
    quote: '„[Testimonial folgt: Platz für ein Zitat zum CV Maker / Karriereeinstieg in KI.]"',
    name: 'Name', role: 'AI Engineer, Unternehmen',
  },
]

// ── FAQ ──────────────────────────────────────────────────────────────
const faq = [
  { q: 'Woher kommen die Daten?', a: 'Wir erfassen laufend öffentliche KI-Stellenanzeigen deutscher Unternehmen: aktuell über 10.000 Postings von mehr als 2.800 Firmen in 600+ Städten. Der Datensatz wächst täglich um durchschnittlich 152 Jobs.' },
  { q: 'Wie funktioniert der Chatbot?', a: 'Sie stellen Ihre Frage in natürlicher Sprache. Der Chatbot übersetzt sie per SQL-Tool-Call in eine Datenbankabfrage und antwortet direkt aus dem vollständigen Datensatz, inklusive Quellen-Links zu den Postings.' },
  { q: 'Was sind Search Credits?', a: 'Jede Chatbot-Anfrage verbraucht einen Credit. Basic enthält 100 Credits pro Monat, Pro 500. Das Dashboard selbst ist unbegrenzt nutzbar.' },
  { q: 'Was ist das Career Memory?', a: 'Ihr persönliches Archiv aus Textblöcken (Erfahrungen, Projekte, Skills), extrahiert aus Ihren hochgeladenen CVs. Bei jeder Bewerbung wählt der CV Maker daraus automatisch die Blöcke, die am besten zur Stellenanzeige passen. Career Memory ist Teil des Pro-Plans.' },
  { q: 'Welche CV-Templates gibt es?', a: 'Formate, die sich in Bewerbungsprozessen nachweislich bei Google, Amazon und Microsoft bewährt haben: klar strukturiert, ATS-freundlich, auf Deutsch und Englisch.' },
  { q: 'Kann ich monatlich kündigen?', a: 'Ja. Beide Pläne sind monatlich kündbar, ohne Mindestlaufzeit.' },
]
const openFaq = ref(-1)

// ── Waitlist ─────────────────────────────────────────────────────────
const email = ref('')
const joined = ref(false)
const waitlistBusy = ref(false)
const waitlistError = ref<string | null>(null)

async function joinWaitlist() {
  const value = email.value.trim()
  if (!value || waitlistBusy.value) return
  waitlistBusy.value = true
  waitlistError.value = null
  try {
    await $fetch('/api/waitlist', { method: 'POST', body: { email: value } })
    joined.value = true
  } catch (e: any) {
    waitlistError.value = e?.data?.message || 'Das hat nicht geklappt, bitte erneut versuchen.'
  } finally {
    waitlistBusy.value = false
  }
}
</script>

<template>
  <div class="landing">
    <!-- ════════ NAV ════════ -->
    <div class="nav-wrap">
      <nav class="nav">
        <NuxtLink to="/" class="nav-logo">ai-verticals.</NuxtLink>
        <div class="nav-links">
          <a href="#chat">Chatbot</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#cv">CV Maker</a>
          <a href="#pricing">Preise</a>
          <a href="#faq">FAQ</a>
          <NuxtLink to="/login" class="nav-login">Login</NuxtLink>
          <a href="#waitlist" class="nav-cta">Waitlist beitreten</a>
        </div>
      </nav>
    </div>

    <!-- ════════ HERO ════════ -->
    <header class="hero">
      <div class="persona-tabs">
        <button
          v-for="(p, i) in personas"
          :key="p.label"
          class="persona-tab"
          :class="{ 'persona-tab--active': persona === i }"
          @click="persona = i"
        >{{ p.label }}</button>
      </div>
      <h1 class="hero-title">{{ personas[persona]!.title }}</h1>
      <p class="hero-sub">{{ personas[persona]!.sub }}</p>
      <div class="hero-cta-row">
        <a href="#waitlist" class="btn-primary">Waitlist beitreten</a>
      </div>
    </header>

    <div class="shell">
      <NuxtLink to="/dashboard" class="browser-frame">
        <div class="browser-bar">
          <span class="browser-dot" /><span class="browser-dot" /><span class="browser-dot" />
          <span class="browser-url">app.ai-verticals.de/dashboard</span>
        </div>
        <img src="/landing/dashboard-live.png" alt="Live Dashboard" class="browser-shot">
      </NuxtLink>
      <div class="logo-strip">
        <span>DELOITTE</span><span>SAP</span><span>ADESSO SE</span><span>CHECK24</span><span>DATAANNOTATION</span><span>+{{ stats.companies }} WEITERE</span>
      </div>
    </div>

    <!-- ════════ CHAT (dark) ════════ -->
    <section id="chat" class="chat-section">
      <div class="chat-grid">
        <div class="chat-copy">
          <div class="kicker kicker--dark">□ AI.AGENT // AGENT.TOOL</div>
          <h2 class="chat-title">Echte Insights aus 10.000+ AI Stellenanzeigen.</h2>
          <p class="chat-sub">
            Der Chatbot übersetzt Ihre Frage in SQL und antwortet direkt aus dem kompletten
            Datensatz. Wettbewerber, Use Cases, Skills, Städte: keine Filter-Klickerei, einfach fragen.
          </p>
          <div class="chip-block">
            <div class="chip-label">BELIEBTE FRAGEN · ANKLICKEN ZUM AUSPROBIEREN</div>
            <div class="chip-row">
              <button
                v-for="(c, i) in convos"
                :key="c.label"
                class="q-chip"
                :class="{ 'q-chip--active': convo === i }"
                @click="runChat(i)"
              >{{ c.label }}</button>
            </div>
          </div>
        </div>

        <div class="chat-window">
          <div class="chat-window-bar">
            <span class="chat-window-label">CHAT.SESSION // AGENT.TOOL</span>
            <span class="chat-window-status">● CONNECTED</span>
          </div>
          <div class="chat-body">
            <div v-if="chatStep >= 1" class="msg msg-user">{{ activeConvo.question }}</div>
            <div v-if="chatStep >= 2" class="msg msg-sql"><span
              v-for="(s, i) in sqlParts"
              :key="i"
              :class="s.c === 'kw' ? 'sql-kw' : 'sql-plain'"
            >{{ s.t }}</span></div>
            <div v-if="chatStep >= 3" class="msg msg-answer">
              <strong>{{ activeConvo.lead }}</strong> {{ activeConvo.rest }}
            </div>
            <div v-if="chatStep >= 4" class="msg-actions">
              <span v-for="chip in activeConvo.chips" :key="chip" class="action-chip">{{ chip }}</span>
            </div>
            <div class="chat-input">
              <div class="chat-input-text">{{ chatStep >= 4 ? 'Nächste Frage stellen…' : '' }}<span class="caret">▌</span></div>
              <button class="chat-run" @click="runChat()">RUN</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ════════ DASHBOARD ════════ -->
    <section id="dashboard" class="shell section">
      <div class="kicker center">□ MARKET.INTELLIGENCE</div>
      <h2 class="section-title">Der deutsche KI-Arbeitsmarkt, live vermessen.</h2>
      <div class="dash-grid">
        <div class="card card--flush">
          <img src="/landing/skills-graph.png" alt="Skills-Graph" class="card-img">
          <div class="card-body">
            <div class="card-title">Skills &amp; Tools als Landkarte</div>
            <p class="card-text">
              Welche Tools dominieren welche Kohorte? Python, LangChain, RAG, AI Agents,
              pro Funktion, Branche und Stadt aufgeschlüsselt.
            </p>
          </div>
        </div>
        <div class="dash-col">
          <div class="card card--pad">
            <div class="card-tag">GROWTH.TIMESERIES</div>
            <div class="card-title">Wachstum &amp; Momentum</div>
            <p class="card-text">
              Neue Jobs, Firmen und Städte im Zeitverlauf. Erkennen, wann eine Branche
              anzieht, bevor es alle wissen.
            </p>
            <div class="stat-row">
              <div class="stat"><div class="stat-num">{{ stats.jobs }}</div><div class="stat-cap">JOBS</div></div>
              <div class="stat"><div class="stat-num">{{ stats.companies }}</div><div class="stat-cap">COMPANIES</div></div>
              <div class="stat"><div class="stat-num">{{ stats.cities }}</div><div class="stat-cap">CITIES</div></div>
              <div class="stat"><div class="stat-num stat-num--accent">{{ stats.velocity }}<span class="stat-unit">/d</span></div><div class="stat-cap">VELOCITY</div></div>
            </div>
          </div>
          <div class="card card--pad">
            <div class="card-tag">COMPETITOR.ALERTS</div>
            <div class="card-title">Wettbewerber-Alerts</div>
            <p class="card-text">
              Firmen auf die Watchlist setzen: Benachrichtigung, sobald dort eine neue
              KI-Stelle erscheint.
            </p>
            <div class="alert-demo">
              <span class="alert-dot" />
              <span>ALERT · Deloitte · „Senior AI Agent Engineer" · vor 2 h</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ════════ PERSONAS ════════ -->
    <section class="shell section">
      <div class="kicker center">□ FÜR WEN</div>
      <h2 class="section-title">Ein Datensatz, vier Use Cases.</h2>
      <div class="persona-grid">
        <div
          v-for="card in personaCards"
          :key="card.tag"
          class="persona-card"
          :class="{ 'persona-card--dark': card.dark }"
        >
          <div class="persona-card-tag" :class="{ 'persona-card-tag--accent': card.dark }">{{ card.tag }}</div>
          <div class="persona-card-title">{{ card.title }}</div>
          <p class="persona-card-text">{{ card.text }}</p>
        </div>
      </div>
    </section>

    <!-- ════════ CV MAKER ════════ -->
    <section id="cv" class="shell section">
      <div class="cv-panel">
        <div class="cv-copy">
          <div class="kicker">□ CV.MAKER // CAREER.MEMORY</div>
          <h2 class="cv-title">Ein CV pro Job. Automatisch.</h2>
          <p class="cv-sub">
            Bestehende CVs hochladen: der CV Maker zerlegt sie in wiederverwendbare
            Textblöcke, baut daraus Ihr Career Memory und optimiert den Lebenslauf für
            jede Stelle individuell.
          </p>
          <div class="cv-steps">
            <div v-for="(s, i) in cvSteps" :key="s.title" class="cv-step">
              <span class="cv-step-num">{{ String(i + 1).padStart(2, '0') }}</span>
              <div>
                <div class="cv-step-title">{{ s.title }}</div>
                <div class="cv-step-text">{{ s.text }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="cv-visual">
          <div class="cv-doc cv-doc--left">
            <div class="cv-doc-tag">TEMPLATE // GOOGLE</div>
            <div class="ph ph-h8 w-70 ink" /><div class="ph ph-h5 w-45 mid mt-6" />
            <div class="ph-group"><div class="ph ph-h4 w-100" /><div class="ph ph-h4 w-92" /><div class="ph ph-h4 w-96" /><div class="ph ph-h4 w-60" /></div>
            <div class="ph ph-h5 w-40 mid mt-14" />
            <div class="ph-group ph-group--tight"><div class="ph ph-h4 w-100" /><div class="ph ph-h4 w-85" /></div>
          </div>
          <div class="cv-doc cv-doc--main">
            <div class="cv-doc-head">
              <span class="cv-doc-tag">OPTIMIERT FÜR</span>
              <span class="cv-doc-match">MATCH 94%</span>
            </div>
            <div class="cv-doc-job">Senior AI Product Manager · SAP</div>
            <div class="ph ph-h8 w-75 ink" />
            <div class="cv-doc-skills">
              <span>RAG</span><span>LangChain</span><span class="cv-skill--hit">AI Agents</span>
            </div>
            <div class="ph-group"><div class="ph ph-h4 w-100" /><div class="ph ph-h4 w-94" /><div class="ph ph-h4 w-88" /></div>
            <div class="cv-doc-note"><span>Career Memory:</span> Block „LLM-Rollout bei Kunde X" eingesetzt, passt zu Anforderung 3.</div>
          </div>
          <div class="cv-doc cv-doc--right">
            <div class="cv-doc-tag">TEMPLATE // AMAZON</div>
            <div class="ph ph-h8 w-65 ink" /><div class="ph ph-h5 w-50 mid mt-6" />
            <div class="ph-group"><div class="ph ph-h4 w-100" /><div class="ph ph-h4 w-88" /><div class="ph ph-h4 w-94" /></div>
            <div class="ph ph-h5 w-38 mid mt-14" />
            <div class="ph-group ph-group--tight"><div class="ph ph-h4 w-100" /><div class="ph ph-h4 w-70" /></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ════════ PRICING ════════ -->
    <section id="pricing" class="shell section">
      <div class="kicker center">□ PREISE</div>
      <h2 class="section-title">Zwei Pläne. Keine Überraschungen.</h2>
      <div class="pricing-grid">
        <div class="price-card">
          <div class="price-tag">BASIC</div>
          <div class="price-row"><span class="price-amount">25 €</span><span class="price-per">/ Monat</span></div>
          <p class="price-desc">Voller Zugriff auf Dashboard und Chatbot.</p>
          <div class="price-features">
            <div><span class="check">✓</span>Live-Dashboard, alle Ansichten</div>
            <div><span class="check">✓</span>SQL-Chatbot · 100 Search Credits / Monat</div>
            <div><span class="check">✓</span>CV Maker mit allen Templates</div>
            <div><span class="check">✓</span>Wettbewerber-Alerts · 3 Firmen</div>
            <div class="feature-muted"><span>–</span>Career Memory</div>
          </div>
          <a href="#waitlist" class="btn-outline">Waitlist beitreten</a>
        </div>
        <div class="price-card price-card--pro">
          <div class="price-badge">EMPFOHLEN</div>
          <div class="price-tag price-tag--accent">PRO</div>
          <div class="price-row"><span class="price-amount price-amount--light">50 €</span><span class="price-per">/ Monat</span></div>
          <p class="price-desc price-desc--dark">Für alle, die den Markt täglich nutzen.</p>
          <div class="price-features price-features--light">
            <div><span class="check">✓</span>Alles aus Basic</div>
            <div><span class="check">✓</span>SQL-Chatbot · 500 Search Credits / Monat</div>
            <div><span class="check">✓</span><span><strong>Career Memory</strong>: CV pro Job automatisch optimiert</span></div>
            <div><span class="check">✓</span>Wettbewerber-Alerts · unbegrenzt</div>
            <div><span class="check">✓</span>Prioritäts-Support</div>
          </div>
            <a href="#waitlist" class="btn-primary btn-block">Waitlist beitreten</a>
        </div>
      </div>
    </section>

    <!-- ════════ TESTIMONIALS ════════ -->
    <section class="shell section section--tight">
      <div class="testimonial-grid">
        <div v-for="t in testimonials" :key="t.role" class="testimonial-card">
          <div class="stars">★★★★★</div>
          <p class="testimonial-quote">{{ t.quote }}</p>
          <div class="testimonial-name">{{ t.name }}<div class="testimonial-role">{{ t.role }}</div></div>
        </div>
      </div>
    </section>

    <!-- ════════ FAQ ════════ -->
    <section id="faq" class="faq">
      <div class="kicker center">□ FAQ</div>
      <h2 class="section-title faq-title">Häufige Fragen</h2>
      <div class="faq-list">
        <div v-for="(f, i) in faq" :key="f.q" class="faq-item">
          <button class="faq-q" @click="openFaq = openFaq === i ? -1 : i">
            <span>{{ f.q }}</span>
            <span class="faq-icon">{{ openFaq === i ? '−' : '+' }}</span>
          </button>
          <p v-if="openFaq === i" class="faq-a">{{ f.a }}</p>
        </div>
      </div>
    </section>

    <!-- ════════ WAITLIST CTA + FOOTER ════════ -->
    <section id="waitlist" class="cta-section">
      <div class="cta-inner">
        <div class="kicker kicker--dark">□ WAITLIST // EARLY.ACCESS</div>
        <h2 class="cta-title">Der KI-Arbeitsmarkt wartet nicht. Sie auch nicht.</h2>
        <p class="cta-sub">Jetzt eintragen: Early-Access-Plätze werden in Wellen freigeschaltet.</p>
        <form class="waitlist-form" @submit.prevent="joinWaitlist">
          <input
            v-model="email"
            type="email"
            required
            placeholder="ihre@email.de"
            class="waitlist-input"
            :disabled="joined"
          >
          <button type="submit" class="waitlist-btn" :disabled="waitlistBusy || joined">
            {{ joined ? '✓ EINGETRAGEN' : waitlistBusy ? '…' : 'WAITLIST →' }}
          </button>
        </form>
        <p v-if="waitlistError" class="waitlist-error">{{ waitlistError }}</p>

        <div class="footer-bar">
          <span>ai-verticals. © 2026</span>
          <span class="footer-links">
            <NuxtLink to="/impressum">IMPRESSUM</NuxtLink><NuxtLink to="/impressum#datenschutz">DATENSCHUTZ</NuxtLink><a href="mailto:jan@heyjan.de">KONTAKT</a>
          </span>
          <span>{{ stats.jobs }} RECORDS · <span class="live-dot">● ACTIVE</span></span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ── Landing palette (self-contained; intentionally not the app tokens) ── */
.landing {
  --l-bg: #fbfaf7;
  --l-ink: #16161f;
  --l-sub: #4a4a55;
  --l-faint: #9a9aa8;
  --l-ghost: #5a5a68;
  --l-border: #d8d6cf;
  --l-border-soft: #eceae4;
  --l-accent: #d92d2d;
  --l-accent-dark: #a81f1f;
  --l-green: #3ba55d;
  --l-dark: #111118;
  --l-dark-panel: #16161f;
  --l-dark-line: #26262f;
  --l-dark-border: #34343f;
  --l-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --l-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --l-display: 'Inter Tight', sans-serif;

  background: var(--l-bg);
  color: var(--l-ink);
  font-family: var(--l-sans);
  min-height: 100vh;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.shell { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
.section { padding-top: 88px; }
.section--tight { padding-top: 40px; }

.kicker {
  font: 500 10px var(--l-mono);
  letter-spacing: 2px;
  color: var(--l-accent);
}
.kicker.center { text-align: center; }
.kicker--dark { color: var(--l-accent); }

.section-title {
  margin: 16px auto 0;
  font: 700 40px/1.1 var(--l-display);
  color: var(--l-ink);
  letter-spacing: -1px;
  text-align: center;
  max-width: 700px;
  text-wrap: balance;
}

.live-dot { color: var(--l-green); }

/* ── Nav ─────────────────────────────────────────────────────────── */
.nav-wrap {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(251, 250, 247, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--l-border-soft);
}
.nav {
  max-width: 1240px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
}
.nav-logo {
  font: 600 18px var(--l-mono);
  color: var(--l-ink);
}
.nav-links {
  display: flex;
  gap: 28px;
  align-items: center;
  font: 500 13.5px var(--l-sans);
}
.nav-links a { color: var(--l-sub); transition: color 0.15s; }
.nav-links a:hover { color: var(--l-ink); }
.nav-login { color: var(--l-faint) !important; }
.nav-cta {
  border: 1.5px solid var(--l-ink);
  border-radius: 99px;
  padding: 9px 20px;
  font-weight: 600;
  color: var(--l-ink) !important;
  transition: all 0.15s;
}
.nav-cta:hover { background: var(--l-ink); color: #fff !important; }

/* ── Hero ────────────────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 64px 32px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}
.persona-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  background: var(--l-border-soft);
  border-radius: 99px;
  padding: 5px;
}
.persona-tab {
  border: 0;
  background: transparent;
  border-radius: 99px;
  padding: 7px 16px;
  cursor: pointer;
  font: 500 12.5px var(--l-sans);
  color: var(--l-sub);
  transition: all 0.2s;
}
.persona-tab--active { background: var(--l-ink); color: #fff; }
.hero-title {
  margin: 0;
  font: 700 56px/1.08 var(--l-display);
  color: var(--l-ink);
  letter-spacing: -1.5px;
  max-width: 860px;
  text-wrap: balance;
}
.hero-sub {
  margin: 0;
  font: 400 18px/1.6 var(--l-sans);
  color: var(--l-sub);
  max-width: 620px;
  text-wrap: pretty;
}
.hero-cta-row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: center; }

.btn-primary {
  display: inline-block;
  background: var(--l-accent);
  color: #fff;
  border-radius: 99px;
  padding: 14px 30px;
  font: 600 15px var(--l-sans);
  transition: background 0.15s;
}
.btn-primary:hover { background: var(--l-accent-dark); color: #fff; }
.btn-block { text-align: center; margin-top: auto; padding: 13px; font-size: 14px; }
.btn-outline {
  margin-top: auto;
  text-align: center;
  border: 1.5px solid var(--l-ink);
  border-radius: 99px;
  padding: 13px;
  font: 600 14px var(--l-sans);
  color: var(--l-ink);
  transition: all 0.15s;
}
.btn-outline:hover { background: var(--l-ink); color: #fff; }

/* ── Browser frame + logo strip ──────────────────────────────────── */
.browser-frame {
  display: block;
  border: 1px solid var(--l-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 60px -20px rgba(22, 22, 31, 0.25);
  background: #fff;
}
.browser-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--l-border-soft);
}
.browser-dot { width: 10px; height: 10px; border-radius: 99px; background: #e4e2db; }
.browser-url { margin-left: 14px; font: 400 11px var(--l-mono); color: var(--l-faint); }
.browser-shot { display: block; width: 100%; height: auto; }
.logo-strip {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 36px;
  margin: 28px 0 32px;
  font: 500 12px var(--l-mono);
  letter-spacing: 1px;
  color: var(--l-faint);
}

/* ── Chat section (dark) ─────────────────────────────────────────── */
.chat-section { background: var(--l-dark); margin-top: 24px; }
.chat-grid {
  max-width: 1240px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  gap: 56px;
  padding: 110px 32px;
  align-items: center;
}
.chat-copy { display: flex; flex-direction: column; gap: 24px; }
.chat-title {
  margin: 0;
  font: 700 clamp(30px, 3.4vw, 44px)/1.08 var(--l-display);
  color: #fff;
  letter-spacing: -1px;
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.chat-sub {
  margin: 0;
  font: 400 16px/1.65 var(--l-sans);
  color: var(--l-faint);
  max-width: 440px;
  text-wrap: pretty;
}
.chip-block { display: flex; flex-direction: column; gap: 8px; }
.chip-label { font: 500 9px var(--l-mono); letter-spacing: 2px; color: var(--l-ghost); }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; max-width: 480px; }
.q-chip {
  border: 1px solid var(--l-dark-border);
  color: #c8c8d2;
  background: transparent;
  padding: 8px 13px;
  font: 400 11.5px var(--l-mono);
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}
.q-chip:hover { border-color: var(--l-accent); color: #fff; }
.q-chip--active {
  border-color: var(--l-accent);
  color: #fff;
  background: rgba(217, 45, 45, 0.12);
}

.chat-window {
  border: 1px solid var(--l-dark-border);
  background: var(--l-dark-panel);
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.6);
}
.chat-window-bar {
  display: flex;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--l-dark-line);
}
.chat-window-label { font: 500 9px var(--l-mono); letter-spacing: 2px; color: var(--l-ghost); }
.chat-window-status { font: 500 9px var(--l-mono); color: var(--l-green); }
.chat-body {
  padding: 26px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 420px;
}
.msg { animation: fadeUp 0.4s ease both; }
.msg-user {
  align-self: flex-end;
  background: var(--l-dark-line);
  color: #fff;
  padding: 12px 16px;
  font: 400 14px/1.5 var(--l-sans);
  max-width: 380px;
  border-radius: 10px 10px 2px 10px;
}
.msg-sql {
  align-self: flex-start;
  background: #0d0d12;
  border: 1px solid var(--l-dark-line);
  padding: 11px 15px;
  font: 400 11.5px/1.65 var(--l-mono);
  max-width: 460px;
  white-space: pre-wrap;
}
.sql-kw { color: var(--l-accent); }
.sql-plain { color: #7a8aa0; }
.msg-answer {
  align-self: flex-start;
  background: #1e1e28;
  color: #e8e8ee;
  padding: 13px 16px;
  font: 400 14px/1.55 var(--l-sans);
  border-radius: 10px 10px 10px 2px;
  max-width: 460px;
}
.msg-actions { display: flex; gap: 6px; animation: fadeUp 0.4s ease both; }
.action-chip {
  border: 1px solid var(--l-dark-border);
  color: var(--l-faint);
  padding: 6px 11px;
  font: 400 10.5px var(--l-mono);
}
.chat-input {
  display: flex;
  border: 1px solid var(--l-dark-border);
  background: #0d0d12;
  margin-top: auto;
}
.chat-input-text {
  flex: 1;
  padding: 11px 14px;
  font: 400 12px var(--l-mono);
  color: var(--l-ghost);
}
.caret { color: var(--l-accent); animation: blink 1s step-end infinite; }
.chat-run {
  padding: 11px 16px;
  color: var(--l-faint);
  font: 500 11px var(--l-mono);
  border: 0;
  border-left: 1px solid var(--l-dark-border);
  background: transparent;
  cursor: pointer;
}
.chat-run:hover { color: #fff; }

/* ── Dashboard section ───────────────────────────────────────────── */
.dash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 48px;
}
.dash-col { display: flex; flex-direction: column; gap: 28px; }
.card {
  border: 1px solid var(--l-border);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}
.card--pad { padding: 22px 26px; flex: 1; }
.card-img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--l-border-soft); }
.card-body { padding: 22px 26px; }
.card-tag { font: 500 9px var(--l-mono); letter-spacing: 2px; color: var(--l-faint); margin-bottom: 8px; }
.card-title { font: 600 17px var(--l-sans); color: var(--l-ink); }
.card-text { margin: 8px 0 0; font: 400 14px/1.6 var(--l-sans); color: var(--l-sub); text-wrap: pretty; }
.stat-row { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; }
.stat-num { font: 600 22px var(--l-mono); color: var(--l-ink); }
.stat-num--accent { color: var(--l-accent); }
.stat-unit { font-size: 12px; color: var(--l-faint); }
.stat-cap {
  font: 500 8.5px var(--l-mono);
  letter-spacing: 1.5px;
  color: var(--l-faint);
  margin-top: 3px;
}
.alert-demo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  border: 1px solid var(--l-border-soft);
  border-radius: 8px;
  padding: 11px 14px;
  background: var(--l-bg);
  font: 400 12px var(--l-mono);
  color: var(--l-sub);
}
.alert-dot { width: 8px; height: 8px; border-radius: 99px; background: var(--l-accent); flex: none; }

/* ── Personas grid ───────────────────────────────────────────────── */
.persona-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-top: 44px;
}
.persona-card {
  border: 1px solid var(--l-border);
  border-radius: 12px;
  background: #fff;
  padding: 24px 22px;
}
.persona-card--dark { border-color: var(--l-ink); background: var(--l-ink); }
.persona-card-tag { font: 500 9px var(--l-mono); letter-spacing: 1.5px; color: var(--l-faint); }
.persona-card-tag--accent { color: var(--l-accent); }
.persona-card-title { font: 600 16px var(--l-sans); color: var(--l-ink); margin-top: 10px; }
.persona-card--dark .persona-card-title { color: #fff; }
.persona-card-text { margin: 8px 0 0; font: 400 12.5px/1.55 var(--l-sans); color: var(--l-sub); text-wrap: pretty; }
.persona-card--dark .persona-card-text { color: var(--l-faint); }

/* ── CV maker ────────────────────────────────────────────────────── */
.cv-panel {
  border-radius: 16px;
  background: var(--l-border-soft);
  padding: 64px 56px;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 48px;
  align-items: center;
  overflow: hidden;
  margin-top: 64px;
}
.cv-copy { display: flex; flex-direction: column; gap: 20px; }
.cv-title {
  margin: 0;
  font: 700 40px/1.1 var(--l-display);
  color: var(--l-ink);
  letter-spacing: -1px;
  text-wrap: balance;
}
.cv-sub { margin: 0; font: 400 16px/1.65 var(--l-sans); color: var(--l-sub); text-wrap: pretty; }
.cv-steps { border-top: 1px solid var(--l-border); }
.cv-step {
  display: flex;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--l-border);
  align-items: baseline;
}
.cv-step:last-child { border-bottom: 0; }
.cv-step-num { font: 600 12px var(--l-mono); color: var(--l-accent); flex: none; }
.cv-step-title { font: 600 14.5px var(--l-sans); color: var(--l-ink); }
.cv-step-text { font: 400 13px/1.5 var(--l-sans); color: var(--l-sub); margin-top: 3px; }

.cv-visual { display: flex; align-items: center; justify-content: center; min-width: 0; }
.cv-doc {
  background: #fff;
  border: 1px solid var(--l-border);
  border-radius: 8px;
  padding: 18px;
  overflow: hidden;
}
.cv-doc--left, .cv-doc--right {
  flex: 1 1 120px;
  min-width: 0;
  max-width: 180px;
  box-shadow: 0 12px 30px -12px rgba(22, 22, 31, 0.25);
}
.cv-doc--left { transform: rotate(-3deg); margin-right: -48px; }
.cv-doc--right { transform: rotate(3deg); margin-left: -48px; }
.cv-doc--main {
  flex: 0 1 220px;
  min-width: 180px;
  border: 1.5px solid var(--l-ink);
  padding: 20px;
  box-shadow: 0 20px 44px -14px rgba(22, 22, 31, 0.35);
  position: relative;
  z-index: 2;
}
.cv-doc-tag { font: 500 8px var(--l-mono); letter-spacing: 1.5px; color: var(--l-faint); }
.cv-doc-head { display: flex; justify-content: space-between; align-items: center; }
.cv-doc-match { font: 500 8px var(--l-mono); color: var(--l-accent); }
.cv-doc-job { font: 600 11px var(--l-sans); color: var(--l-ink); margin-top: 4px; }
.cv-doc-skills { display: flex; gap: 4px; margin-top: 10px; }
.cv-doc-skills span {
  font: 500 8px var(--l-mono);
  background: var(--l-border-soft);
  padding: 3px 7px;
  border-radius: 3px;
  color: var(--l-ink);
}
.cv-doc-skills .cv-skill--hit { background: var(--l-accent); color: #fff; }
.cv-doc-note {
  border: 1px dashed var(--l-accent);
  border-radius: 5px;
  padding: 8px 10px;
  margin-top: 12px;
  font: 400 9px/1.5 var(--l-sans);
  color: var(--l-sub);
}
.cv-doc-note span { color: var(--l-accent); font-weight: 600; }

/* Placeholder "text" bars inside the CV cards */
.ph { background: var(--l-border-soft); border-radius: 2px; }
.ph.ink { background: var(--l-ink); }
.ph.mid { background: var(--l-border); }
.ph-h8 { height: 8px; margin-top: 12px; }
.ph-h5 { height: 5px; }
.ph-h4 { height: 4px; }
.mt-6 { margin-top: 6px; }
.mt-14 { margin-top: 14px; }
.w-100 { width: 100%; } .w-96 { width: 96%; } .w-94 { width: 94%; } .w-92 { width: 92%; }
.w-88 { width: 88%; } .w-85 { width: 85%; } .w-75 { width: 75%; } .w-70 { width: 70%; }
.w-65 { width: 65%; } .w-60 { width: 60%; } .w-50 { width: 50%; } .w-45 { width: 45%; }
.w-40 { width: 40%; } .w-38 { width: 38%; }
.ph-group { display: flex; flex-direction: column; gap: 5px; margin-top: 14px; }
.ph-group--tight { margin-top: 8px; }

/* ── Pricing ─────────────────────────────────────────────────────── */
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 380px));
  gap: 24px;
  justify-content: center;
  margin-top: 44px;
}
.price-card {
  border: 1px solid var(--l-border);
  border-radius: 14px;
  background: #fff;
  padding: 32px 30px;
  display: flex;
  flex-direction: column;
}
.price-card--pro {
  border: 1.5px solid var(--l-ink);
  background: var(--l-ink);
  position: relative;
}
.price-badge {
  position: absolute;
  top: -11px;
  right: 26px;
  background: var(--l-accent);
  color: #fff;
  font: 600 9.5px var(--l-mono);
  letter-spacing: 1.5px;
  padding: 5px 11px;
  border-radius: 99px;
}
.price-tag { font: 500 10px var(--l-mono); letter-spacing: 2px; color: var(--l-faint); }
.price-tag--accent { color: var(--l-accent); }
.price-row { display: flex; align-items: baseline; gap: 6px; margin-top: 14px; }
.price-amount { font: 700 44px var(--l-display); color: var(--l-ink); }
.price-amount--light { color: #fff; }
.price-per { font: 400 14px var(--l-sans); color: var(--l-faint); }
.price-desc { margin: 10px 0 0; font: 400 13.5px/1.5 var(--l-sans); color: var(--l-sub); }
.price-desc--dark { color: var(--l-faint); }
.price-features {
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin: 24px 0;
  font: 400 13.5px/1.4 var(--l-sans);
  color: var(--l-ink);
}
.price-features--light { color: #fff; }
.price-features > div { display: flex; gap: 10px; }
.check { color: var(--l-green); font-weight: 600; }
.feature-muted { color: var(--l-faint); }

/* ── Testimonials ────────────────────────────────────────────────── */
.testimonial-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.testimonial-card {
  border: 1px solid var(--l-border);
  border-radius: 12px;
  background: #fff;
  padding: 26px 24px;
}
.stars { font: 500 9px var(--l-mono); letter-spacing: 1.5px; color: var(--l-accent); }
.testimonial-quote { margin: 12px 0 0; font: 400 14.5px/1.6 var(--l-sans); color: var(--l-ink); text-wrap: pretty; }
.testimonial-name { margin-top: 16px; font: 600 13px var(--l-sans); color: var(--l-ink); }
.testimonial-role { font: 400 12px var(--l-sans); color: var(--l-faint); margin-top: 2px; }

/* ── FAQ ─────────────────────────────────────────────────────────── */
.faq { max-width: 760px; margin: 0 auto; padding: 40px 32px 72px; }
.faq-title { margin-bottom: 36px; font-size: 36px; }
.faq-list { border-top: 1px solid var(--l-border); }
.faq-item { border-bottom: 1px solid var(--l-border); }
.faq-q {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 4px;
  cursor: pointer;
  border: 0;
  background: transparent;
  text-align: left;
  font: 600 15.5px var(--l-sans);
  color: var(--l-ink);
}
.faq-icon { font: 400 18px var(--l-mono); color: var(--l-accent); flex: none; }
.faq-a {
  margin: 0;
  padding: 0 4px 20px;
  font: 400 14.5px/1.65 var(--l-sans);
  color: var(--l-sub);
  max-width: 640px;
  text-wrap: pretty;
}

/* ── Waitlist CTA + footer ───────────────────────────────────────── */
.cta-section { background: var(--l-dark); }
.cta-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 80px 32px 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}
.cta-title {
  margin: 0;
  font: 700 46px/1.08 var(--l-display);
  color: #fff;
  letter-spacing: -1px;
  max-width: 680px;
  text-wrap: balance;
}
.cta-sub { margin: 0; font: 400 16px/1.6 var(--l-sans); color: var(--l-faint); max-width: 480px; }
.waitlist-form { display: flex; width: 440px; max-width: 100%; }
.waitlist-input {
  flex: 1;
  border: 1px solid var(--l-dark-border);
  border-right: none;
  padding: 14px 16px;
  font: 400 13px var(--l-mono);
  color: #fff;
  background: #1a1a23;
  outline: none;
  min-width: 0;
}
.waitlist-input::placeholder { color: var(--l-ghost); }
.waitlist-btn {
  background: var(--l-accent);
  color: #fff;
  border: 0;
  padding: 14px 24px;
  font: 600 12px var(--l-mono);
  letter-spacing: 1px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}
.waitlist-btn:hover:not(:disabled) { background: var(--l-accent-dark); }
.waitlist-btn:disabled { cursor: default; }
.waitlist-error { margin: 0; font: 400 12px var(--l-mono); color: var(--l-accent); }
.footer-bar {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-top: 1px solid var(--l-dark-line);
  margin-top: 56px;
  padding: 22px 0;
  font: 500 10px var(--l-mono);
  letter-spacing: 1.5px;
  color: var(--l-ghost);
}
.footer-links { display: flex; gap: 22px; }
.footer-links a { color: var(--l-ghost); }
.footer-links a:hover { color: #fff; }

/* ── Responsive ──────────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .chat-grid { grid-template-columns: 1fr; gap: 40px; padding: 72px 32px; }
  .dash-grid { grid-template-columns: 1fr; }
  .persona-grid { grid-template-columns: repeat(2, 1fr); }
  .cv-panel { grid-template-columns: 1fr; padding: 48px 36px; }
  .testimonial-grid { grid-template-columns: 1fr; }
  .pricing-grid { grid-template-columns: minmax(0, 380px); }
}

@media (max-width: 720px) {
  .nav-links { gap: 16px; font-size: 12.5px; }
  .nav-links a:not(.nav-cta):not(.nav-login) { display: none; }
  .hero-title { font-size: 38px; letter-spacing: -1px; }
  .section-title { font-size: 30px; }
  .cta-title { font-size: 32px; }
  .cv-title { font-size: 30px; }
  .persona-grid { grid-template-columns: 1fr; }
  .cv-visual { flex-direction: column; gap: 16px; }
  .cv-doc--left, .cv-doc--right { display: none; }
  .cv-doc--main { flex: none; width: 100%; }
  .shell, .hero, .faq { padding-left: 20px; padding-right: 20px; }
  .section { padding-top: 56px; }
  .footer-bar { justify-content: center; text-align: center; }
}
</style>
