# Data files (`app/src/main/assets/www/data/`)

Each file is `{ "schemaVersion": 1, "items": [...] }`; `app-config.json` is a single object. Rules live in `js/validate.js`
(JSON-schema equivalent) and run in the admin forms, on import, and in `npm run validate`.

Common fields: `id` (a-z, 0-9, `-`, 3–64), `status` (`draft|published|archived`; only `published` is shown to users),
`verification` `{status: unverified|verified, lastVerified: YYYY-MM-DD|null, source}` (`verified` requires a date), `updatedAt` (ISO 8601).

| File | Key fields |
|---|---|
| `buses.json` | `name_bn/en`, `operator_bn/en`, `type` (`AC|NON_AC`), `counterIds[]`, `supervisors[{name_bn,name_en,phone,demo}]` |
| `routes.json` | `name_bn/en`, `stops[{id,bn,en}]` (first = origin), `approxDurationMin`, `durationIsEstimate` |
| `schedules.json` | `busId`, `routeId`, `direction` (`outbound` = stop order, `return` = reversed), `departureTime` HH:MM 24h, `operatingDays[]` (`sat..fri`), `counterId` (boarding counter) |
| `counters.json` | `name_bn/en`, `placeId` (a stop id), `address_bn/en`, `phones[{label,number,demo}]` |
| `app-config.json` | `dataVersion`, `dataUpdated`, `isDemoData`, `dayStart/nightStart`, `staleAfterDays`, `aliases` (spelling groups) |

Records link by id (no copying). Arrival times are intentionally not stored; only an approximate duration, always shown as an estimate.
Set `"demo": true` on any phone number that is not verified. When real data is verified, set `isDemoData` to `false`.
