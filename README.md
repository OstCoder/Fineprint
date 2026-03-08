# fineprint
### *Read between the lines.*

---

## What it does

Fineprint analyzes any Terms of Service or Privacy Policy and turns it into something a normal person can actually understand:

- **Interactive node graph** — visualizes every legally distinct entity: the company, parent corporations, third-party data recipients, governing jurisdictions, and key legal clauses. A "You" node shows exactly what's pointing at you and why.
- **Need to Know list** — AI-ranked privacy risks in plain English, sorted by severity. The most alarming thing is always #1.
- **Real lawsuits** — live federal court dockets and legal news pulled for the company, so you see their track record, not just their promises.
- **Saved analyses** — every document you analyze is saved to your personal dashboard so you can track your privacy exposure across every app you use.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Graph visualization | D3.js (force-directed, static pre-baked layout) |
| AI inference | Groq API — Llama 3 70B |
| Auth & database | Supabase |
| Court records | CourtListener API v4 |
| Legal news | NewsAPI |
| PDF parsing | pdf.js |

No backend server. Everything runs client-side.

---

## Project structure

```
fineprint/
├── index.html          # Landing page
├── login.html          # Auth — Supabase sign in / sign up
├── app.html            # Main app
├── style.css           # Global styles
├── index.js            # All app logic
├── supabase.js         # Supabase client init
├── config.js           # API keys (gitignored)
└── images/
    ├── fineprint-logo.svg
    └── fineprint-favicon.svg
```

## How the AI works

Fineprint sends the raw T&C text to the Groq API with a tightly engineered system prompt that instructs the model to return structured JSON — nodes, edges, and a ranked `need_to_knows` array. The prompt enforces hard constraints:

- Max 8 nodes total
- No internal product nodes (YouTube Kids, Google Takeout etc. are features, not legal entities)
- Only specific clause types: Forced Arbitration, Class Action Waiver, Data Selling, Auto-Renewal, Liability Cap, Content License, Government Data Access
- Edge labels capped at 3 words

The frontend also enforces these constraints as a safety net — even if the model misbehaves, the graph will never render more than 8 nodes.

---

## Inspiration

Higuruma from *Jujutsu Kaisen* is a lawyer who becomes disillusioned when he realizes the legal system is designed to obscure truth from the people it's supposed to protect. That hit close to home. Terms of Service are the most-agreed-to, least-read documents in human history — written by lawyers, for lawyers, specifically so you won't understand them. Fineprint is what Higuruma would have built.

---

## API keys

| Service | Where to get it |
|---|---|
| Groq | [console.groq.com](https://console.groq.com) |
| Supabase | [supabase.com](https://supabase.com) |
| CourtListener | [courtlistener.com/api](https://www.courtlistener.com/api/) |
| NewsAPI | [newsapi.org](https://newsapi.org) |

---

## Built at

HackTJ Hackathon — built in under 24 hours.

---

*The fine print has always been there. We just finally made it readable.*