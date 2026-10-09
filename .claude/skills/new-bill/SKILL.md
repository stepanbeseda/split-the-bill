---
name: new-bill
description: Turn a photo of a restaurant receipt into a live Tabby bill and deploy it. Use when the user shares a receipt or asks to split a bill, add a bill, fix a bill or redeploy Tabby.
---

# New bill from a receipt photo

You are the "backend AI" of this app: you read the receipt, the app itself never calls a model.
Work in this order and do not skip the validation step.

## 1. Collect the facts

You need all of these before writing anything. Ask in one message for whatever is missing:

- **Receipt photo(s)** – the itemised bill. A card slip is useful to confirm the total and the tip.
- **People** – first names of everyone at the table, and **who paid**.
- **Paid total** – what was actually paid including tip (the card slip "TOTAL").
- **Optional: home-currency amount** – what the payer's bank charged, e.g. `6 980,94 Kč`. Becomes `settlement`.
- **Payment details** – for QR codes:
  - Czech/Slovak account → `scheme: "spayd"`. Convert a Czech account number with `npm run iban -- 19-2000145399/0800`.
  - Euro account elsewhere → `scheme: "epc"` with the IBAN and the account holder's name (`beneficiary`). EUR only.
  - Otherwise `scheme: "none"`.
- **Language** of the page: `"en"` or `"cs"` (match the group). For Czech, also ask for the payer's dative form
  ("Petr" → "Petrovi") and put it into `payerDative`.

## 2. Transcribe the receipt

- One entry per receipt line, **in receipt order**. `qty` = units, `unitPrice` = price of one unit.
  If the receipt shows only a line total, divide it by the quantity.
- Keep the restaurant's item names; put helpful context (size, doneness, translation) into `note`.
- Group with `category` in the page language (e.g. "Starters", "Mains", "Desserts", "Drinks"). Categories show in order of first appearance.
- Two lines with the same name but different variants stay separate items (e.g. two steaks with different doneness).
- **Never guess silently.** If a name, quantity or price is unreadable, ask the user. If the user is unavailable,
  write your best reading and say exactly which line you were unsure about. Prices are verified by the total check below;
  names are not.

## 3. Write `bills/<slug>.json`

Get a slug with `npm run new-slug -- "<restaurant>" <yyyy-mm-dd>` – the random suffix keeps the link unguessable.

```json
{
  "slug": "osteria-mediterranea-2026-10-06-k3f9x2",
  "title": "Osteria Mediterranea",
  "place": "Zaandam",
  "date": "2026-10-06",
  "locale": "en",
  "currency": "EUR",
  "receiptTotal": 259.00,
  "paidTotal": 284.90,
  "settlement": { "currency": "CZK", "amount": 6980.94 },
  "payer": "Alex",
  "people": ["Alex", "Sam", "Kim"],
  "payment": { "scheme": "spayd", "iban": "CZ6508000000192000145399", "accountLabel": "19-2000145399/0800" },
  "items": [
    { "name": "Pane fatto in casa", "note": "house bread", "qty": 2, "unitPrice": 3.00, "category": "Starters" }
  ]
}
```

Bills contain names and bank details, so `bills/*.json` is git-ignored (only `bills/demo.json` is committed).
Do not commit real bills to a public repository.

## 4. Validate – this is not optional

```bash
npm run validate -- bills/<slug>.json
```

The most important check: **items must add up to `receiptTotal` to the cent.** If they do not, you misread something –
re-read the photo line by line (look for a missed line, a wrong quantity, `8` vs `3`, `1` vs `7`) instead of adjusting
numbers to fit. Fix every error; read the warnings.

## 5. Build, test, deploy

```bash
npm run check          # typecheck + unit tests + build
```

Deploy with whichever platform the project uses (see README → Deploy). First-time setup there is a one-off.

- **Netlify:** `npx netlify deploy --prod`. If you are not logged in, run `npx netlify login --request "Deploy Tabby"`,
  give the user the URL, then `npx netlify login --check <ticket>`.
- **Vercel:** `npx vercel --prod`. The project needs an Upstash Redis store connected (Vercel Marketplace).

Changing a live bill: you may **append** items or people. Never reorder or delete them – picks are stored by position.

## 6. Hand over

Give the user the link `https://<site>/b/<slug>`, the totals you validated, and anything you were unsure about.
Suggest they open it, pick their own name and use **Share link** to send it to the group.
