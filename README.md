# Patagonia checkout: blocking Adyen hides 4 of 6 payment methods

A web compatibility case study: what breaks on patagonia.com when a privacy
blocker stops Adyen's checkout script, why it breaks, and how it could be fixed
on both the browser side and the site side.

**Live reproduction:** [repro/](https://nacikr.github.io/patagonia-adyen-webcompat/repro/) ·
**Site-side fix:** [fix/](https://nacikr.github.io/patagonia-adyen-webcompat/fix/)

## Summary

- **Symptom:** With `checkoutshopper-live.adyen.com/checkoutshopper` blocked, the
  payment step shows only PayPal and Apple Pay. Card, Afterpay, Google Pay and
  Klarna disappear. No message is shown to the user.
- **Root cause:** The blocked file is `adyen.js` (Adyen Web SDK 5.68.0). The
  site's `initializeCheckout()` calls the global `AdyenCheckout` without checking
  that it exists, so it throws
  `ReferenceError: AdyenCheckout is not defined` and the payment component is
  never rendered.
- **Why it is blocked at all:** the same Adyen host serves both the payment SDK
  and device-fingerprinting scripts (`fingerprintjs2.js`, `risk.1.0.4.js`).
- **Finding:** Blocking only the fingerprinting scripts keeps all six payment
  methods working. DuckDuckGo's current exception for this site
  ([privacy-configuration](https://github.com/duckduckgo/privacy-configuration),
  `features/tracker-allowlist.json`, reason "Store options won't load") allows
  the whole `checkoutshopper` path, which looks broader than needed.

## Environment

| | |
| --- | --- |
| Browser | Chrome 156.0.8078.47 (Linux, x86_64) |
| Extension | DuckDuckGo Search & Tracker Protection 2026.10.6 |
| Site | patagonia.com checkout (US store), guest checkout |
| Adyen Web SDK | 5.68.0 |
| Date | October 2026 |

Blocking was simulated with Chrome DevTools → Request conditions. A fake address
was used and no order was placed.

## Steps to reproduce

1. Add any item to the bag on patagonia.com and continue to checkout as a guest.
2. Open DevTools → Request conditions and block
   `checkoutshopper-live.adyen.com/checkoutshopper`.
3. Enter a shipping address and continue to the payment step.
4. Only PayPal and Apple Pay are offered. The Console shows:

```
Request was blocked by DevTools: "https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/5.68.0/adyen.js"
renderGenericComponent.js:371 Uncaught (in promise) ReferenceError: AdyenCheckout is not defined
    at N (renderGenericComponent.js:371:11)
    at async Object.renderGenericComponent (renderGenericComponent.js:494:15)
initializeCheckout @ renderGenericComponent.js:371
renderGenericComponent @ renderGenericComponent.js:497
onDomReady @ checkout.js:20
Adyen @ _paymentProviders.js:12
```

## What Adyen loads on the checkout page

| Group | Requests | Purpose |
| --- | --- | --- |
| Needed for payment | `adyen.js`, `adyen.css`, `securedFields.html` ×3, `nocard.svg`, `expiry_date_hint.svg` | Payment component and card number / expiry / CVC iframes |
| Device fingerprinting | `dfp.1.0.0.html` (iframe), `fingerprintjs2.js`, `risk.1.0.4.js`; `df.js` from `live.adyen.com` | Builds a device identifier for fraud scoring |
| Analytics | `analytics?clientKey=…`, `analytics.png`, one 204 beacon | SDK usage statistics |

Everything in the first two groups except `df.js` is loaded by `adyen.js`
itself, which is why blocking `adyen.js` removes all of them at once.

## Experiments

| | `adyen.js` | Fingerprinting scripts | Payment methods shown |
| --- | --- | --- | --- |
| No blocking | loaded | loaded | 6 of 6 (card, Afterpay, Google Pay, Klarna, PayPal, Apple Pay) |
| Experiment 1: block `checkoutshopper` path | blocked | not requested | 2 of 6 (PayPal, Apple Pay) |
| Experiment 2: block fingerprinting only | loaded | blocked | 6 of 6, card fields render |

**Correction to Experiment 2.** My first check of the Console was filtered to
`adyen` and looked clean. Re-running the experiment with my own extension
([Breakage Inspector](https://github.com/nacikr/breakage-inspector)) showed one
uncaught error once `df.js` is blocked:

```
Uncaught ReferenceError: dfDo is not defined
    at https://www.patagonia.com/checkout/?stage=payment:3304:9
```

An inline script on the checkout page calls `dfDo`, which `df.js` normally
defines (most likely Adyen's legacy device-fingerprint helper). The payment
methods still render, so there is no visible breakage, but the same
unguarded-global pattern as `AdyenCheckout` appears a second time.

Screenshots: [`screenshots/`](screenshots/)

## Fixes

### Browser side: a narrower exception

Instead of allowing every request under `checkoutshopper-live.adyen.com/checkoutshopper`,
allow only what the payment form needs and keep blocking the fingerprinting
scripts. The paths split cleanly (host `checkoutshopper-live.adyen.com`;
`<clientKey>` is the shop's public Adyen client key):

| File | URL path | Needed? |
| --- | --- | --- |
| `adyen.js` | `/checkoutshopper/sdk/5.68.0/adyen.js` | Yes |
| `adyen.css` | `/checkoutshopper/sdk/5.68.0/adyen.css` | Yes |
| `securedFields.html` | `/checkoutshopper/securedfields/<clientKey>/4.9.0/securedFields.html` | Yes (card iframes) |
| `fingerprintjs2.js` | `/checkoutshopper/assets/js/<clientKey>/fingerprintjs2.js` | No, keep blocked |
| `risk.1.0.4.js` | `/checkoutshopper/assets/js/<clientKey>/risk.1.0.4.js` | No, keep blocked |

So two narrow rules could replace the current one, in the same format as
`tracker-allowlist.json`:

```json
{
  "rule": "checkoutshopper-live.adyen.com/checkoutshopper/sdk/",
  "domains": ["patagonia.com"],
  "reason": ["Payment methods (card, Afterpay, Google Pay, Klarna) do not load without the Adyen SDK"]
},
{
  "rule": "checkoutshopper-live.adyen.com/checkoutshopper/securedfields/",
  "domains": ["patagonia.com"],
  "reason": ["Card number, expiry and CVC fields are Adyen iframes"]
}
```

This is a proposal, not a tested configuration change. I did not record the
paths of `dfp.1.0.0.html` or the two card icons (`nocard.svg`,
`expiry_date_hint.svg`); if the icons live outside these two paths, they would
be blocked, which is probably only cosmetic.

### Site side: fail visibly

The site should check for the SDK before using it and tell the user what to do.
See [fix/index.html](fix/index.html):

```js
if (typeof window.AdyenCheckout !== 'function') {
  container.innerHTML = FALLBACK; // "Card payments could not load…"
  return;
}
```

## Limits

- No order was placed. I do not know whether Adyen authorises a real payment
  when its risk scripts are blocked; a risk engine may decline or challenge it.
- `df.js` (from `live.adyen.com`) was not blocked by the extension in my tests
  and is outside the existing exception. I did not test what DuckDuckGo's other
  protections do to it.
- The reproduction uses a local stand-in for `adyen.js`, not Adyen's real SDK.

## Files

```
repro/index.html               broken behaviour, mirrors initializeCheckout()
repro/payment-sdk-standin.js   stand-in for adyen.js (defines window.AdyenCheckout)
fix/index.html                 same page with a site-side fallback
screenshots/                   before / after evidence
```

---

I used Claude (an AI assistant) to help structure this write-up and draft the
reproduction pages. The browser investigation, the experiments and the
screenshots are my own work.
