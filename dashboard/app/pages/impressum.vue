<script setup lang="ts">
useHead({
  title: 'Impressum — ai-verticals.',
  meta: [{ name: 'robots', content: 'noindex' }],
})
</script>

<template>
  <div class="legal">
    <div class="nav-wrap">
      <nav class="nav">
        <NuxtLink to="/" class="nav-logo">ai-verticals.</NuxtLink>
        <NuxtLink to="/" class="nav-back">← Zurück zur Startseite</NuxtLink>
      </nav>
    </div>

    <main class="content">
      <div class="kicker">□ LEGAL // § 5 TMG</div>
      <h1>Impressum</h1>

      <section>
        <h2>Angaben gemäß § 5 TMG</h2>
        <p>
          Jan Mayer<br>
          Selbstständiger Entwickler &amp; AI Consultant<br>
          Ringstraße 143, 89081 Ulm
        </p>
        <p>
          <strong>Kontakt:</strong><br>
          E-Mail: jan[at]heyjan[dot]de
        </p>
        <p>
          <strong>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV:</strong><br>
          Jan Mayer<br>
          Ringstraße 143<br>
          89081 Ulm
        </p>
      </section>

      <section>
        <h2>Haftungsausschluss</h2>

        <h3>Haftung für Inhalte</h3>
        <p>
          Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die
          Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch
          keine Gewähr übernehmen. Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG
          für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen
          verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch
          nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu
          überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
          Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der
          Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon
          unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der
          Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von
          entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend
          entfernen.
        </p>

        <h3>Haftung für Links</h3>
        <p>
          Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren
          Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden
          Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten
          ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
          Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche
          Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der
          Verlinkung nicht erkennbar. Eine permanente inhaltliche Kontrolle der
          verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte einer
          Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen
          werden wir derartige Links umgehend entfernen.
        </p>

        <h3 id="datenschutz">Datenschutz</h3>
        <p>
          Die Nutzung unserer Webseite ist in der Regel ohne Angabe personenbezogener
          Daten möglich. Soweit auf unseren Seiten personenbezogene Daten
          (beispielsweise Name, Anschrift oder eMail-Adressen) erhoben werden,
          erfolgt dies, soweit möglich, stets auf freiwilliger Basis. Diese Daten
          werden ohne Ihre ausdrückliche Zustimmung nicht an Dritte weitergegeben.
          Wir weisen darauf hin, dass die Datenübertragung im Internet (z.B. bei der
          Kommunikation per E-Mail) Sicherheitslücken aufweisen kann. Ein lückenloser
          Schutz der Daten vor dem Zugriff durch Dritte ist nicht möglich. Der
          Nutzung von im Rahmen der Impressumspflicht veröffentlichten Kontaktdaten
          durch Dritte zur Übersendung von nicht ausdrücklich angeforderter Werbung
          und Informationsmaterialien wird hiermit ausdrücklich widersprochen. Die
          Betreiber der Seiten behalten sich ausdrücklich rechtliche Schritte im
          Falle der unverlangten Zusendung von Werbeinformationen, etwa durch
          Spam-Mails, vor.
        </p>
      </section>
    </main>

    <footer class="footer-bar">
      <span>ai-verticals. © 2026</span>
      <NuxtLink to="/">STARTSEITE</NuxtLink>
    </footer>
  </div>
</template>

<style scoped>
.legal {
  --l-bg: #fbfaf7;
  --l-ink: #16161f;
  --l-sub: #4a4a55;
  --l-faint: #9a9aa8;
  --l-border: #d8d6cf;
  --l-border-soft: #eceae4;
  --l-accent: #d92d2d;
  --l-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --l-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --l-display: 'Space Grotesk', 'IBM Plex Sans', sans-serif;

  background: var(--l-bg);
  color: var(--l-ink);
  font-family: var(--l-sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

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
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
}
.nav-logo { font: 600 18px var(--l-mono); color: var(--l-ink); }
.nav-back { font: 500 13.5px var(--l-sans); color: var(--l-sub); }
.nav-back:hover { color: var(--l-ink); }

.content {
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
  padding: 64px 32px 88px;
  flex: 1;
}
.kicker {
  font: 500 10px var(--l-mono);
  letter-spacing: 2px;
  color: var(--l-accent);
}
h1 {
  margin: 16px 0 0;
  font: 700 44px/1.1 var(--l-display);
  letter-spacing: -1px;
  color: var(--l-ink);
}
section { margin-top: 48px; }
h2 {
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--l-border);
  font: 700 24px/1.2 var(--l-display);
  letter-spacing: -0.5px;
  color: var(--l-ink);
}
h3 {
  margin: 28px 0 8px;
  font: 600 16px var(--l-sans);
  color: var(--l-ink);
}
p {
  margin: 0 0 14px;
  font: 400 14.5px/1.7 var(--l-sans);
  color: var(--l-sub);
  text-wrap: pretty;
}

.footer-bar {
  max-width: 1240px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--l-border-soft);
  padding: 22px 32px;
  font: 500 10px var(--l-mono);
  letter-spacing: 1.5px;
  color: var(--l-faint);
}
.footer-bar a { color: var(--l-faint); }
.footer-bar a:hover { color: var(--l-ink); }

@media (max-width: 720px) {
  h1 { font-size: 32px; }
  .content { padding: 44px 20px 64px; }
}
</style>
