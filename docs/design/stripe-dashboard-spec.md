# Porthmos dashboard: Stripe Dashboard pattern spec

Research date 2026-10-17. Public sources only: docs.stripe.com/stripe-apps/style, /stripe-apps/components (badge, focus view, data table), /stripe-apps/patterns (full-page apps, filter controls, chart layout), /dashboard/basics, /dashboard/search, /test-mode. The live Dashboard needs a login, so layout figures come from pixel measurement of Stripe's documentation mocks (marked "est.", about plus or minus 10%). We copy patterns and proportions only: no Stripe logo, wordmark, icons, illustrations, copy or code. Brand stays Porthmos (green #4EC397, orange #F99510, shield mark).

## Layout
| Item | Stripe | Porthmos |
|---|---|---|
| Sidebar | 232 to 240 px (est.), white, 1 px right keyline, 32 px nav rows, active item = accent text, no fill | 240 px, white, keyline, 34 px rows, active = accent text and icon |
| Top bar | 56 to 64 px (est.), search field left (filled #f5f6f8, no border, 36 px, about half width), icon buttons right | 60 px sticky bar, filled search field opens the command palette, mode pill + help + terms right |
| Content | about 40 px side padding, no visible max width | 40 px side padding (16 px at 390), max width 1280 px |
| Page header | 24 to 28 px bold title, actions right (secondary button, gear) | 28 px / 700 title, one muted sentence under it, actions right |
| Overview | KPIs inline with no cards: 14 px label over 20 to 24 px bold value, 24 px gaps; 2/3 + 1/3 columns | KPI strip with 1 px keylines between tiles, 2/3 + 1/3 `cols` |

## Type (documented tokens)
heading 16/24 700; subheading 11/20 600 uppercase; body 14/20 400; caption 12/16 400. Letter spacing normal. We use IBM Plex Sans (Stripe's font is proprietary), body 14 px, captions 12 to 13 px, section titles 16 to 18 px / 600, page title 28 px / 700, tabular numerals on every figure.

## Colour
Documented text: primary #30313d, secondary #6a7383, disabled #a3acba; keyline #e0e6eb; semantic info #0570de, success #228403, attention #c84801, critical #df1b41. Observed: page ground #f6f8fa, search fill #f5f6f8. Accent appears only on: primary button, active nav item, active tab, links, chip values, the create button, focus rings. Never on body text, table rows or card borders. Porthmos: accent = deep brand green #16774f (5.6:1 on white); orange #F99510 is reserved for test mode, exactly as Stripe reserves orange for test data. Neutrals keep a faint green cast so the brand reads through.

## Spacing
2, 4, 8, 16, 24, 32, 48 px (documented). Gutters 16 px; section gaps 24 to 32 px.

## Tables
Rows 44 to 48 px (est.), 1 px row dividers, no outer frame; header 12 px semibold dark, sentence case, sticky; first column bold. Filter chips: suggested chip "(+) Status" opens a menu; active chip "(x) Status | Refused" with the value in accent; "Clear filters" link. Row actions in an overflow menu; pagination caption "x to y of z results" with Previous and Next. Porthmos adds search in the table toolbar (Stripe uses global search) and row hover in the sunken neutral.

## Badges
Six types: neutral, info, positive, negative, warning, urgent. Observed shape: 20 to 22 px high, 4 to 6 px radius, 1 px tinted border, 12 px / 500. Positive #eafcdd / #217005 / #b0f27e; warning #fdf8c9 / #b13600 / #fbd992; negative #fef4f6 / #c0123c / #fbd3dc. Porthmos map: Released, Confirmed = positive; Held, Waiting = warning (amber); Refused, Failed = negative; Frozen = slate violet; Info, Policy changed = blue; Settled, Explained = neutral. All pairs at least 4.5:1.

## Detail drawer and pages
FocusView: right drawer, small or large, title, blocking backdrop, footer with primary and secondary actions. DetailPage: title + badge + actions, primary column plus a metadata column. Porthmos `DetailDrawer`: 520 px right sheet (full width under 600 px), header with id, badge and big amount, action row, sections Summary (key-value), Timeline, Raw fields (copyable ids, tx hash to Basescan). Opening pushes a URL hash, so Back closes it; Esc closes and focus returns to the row.

## Search and command
Search sits in the top bar; results appear at once, grouped, each group capped, Enter opens. Porthmos palette: Cmd/Ctrl K or "/"; groups Pages, Actions, Treasury, Ledger, Transactions, Terms; arrow keys, Enter, Esc; focus returns to the opener.

## Test mode banner
Stripe marks test data with an orange (or blue) bar at the top of the Dashboard. Porthmos: 28 px full-width orange bar, dark ink (8.6:1), "Test mode: Base Sepolia testnet. No real funds.", sticky on every app route.

## Charts
Module chart 180 px, featured chart 320 px; headline metric above; 2 px lines; 1 px gridlines; legend of short line swatches; x axis shows first and last labels only; sparklines inline with the KPI. Porthmos: KPI sparkline 32 px, delta pill only where history exists ("+1,000.00 vs previous day"); balance chart 240 px step area, crosshair + tooltip on hover and arrow keys.

## Motion
Not documented. Porthmos: 120 ms hover and press, 160 to 200 ms popovers, drawer 200 ms ease-out slide, all off under reduced motion.

## Keyboard
Documented: "?" lists shortcuts. Porthmos adds "/" and Cmd/Ctrl K for search, g then t, c, r, a or b to jump to a page, Esc to close.
