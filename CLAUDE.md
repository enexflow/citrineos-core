# CLAUDE.md — citrineos-core (fork enexflow)

> **Fork enexflow de CitrineOS** (CSMS OCPP 2.0.1). Garde les changements **upstream-friendly** et documente toute divergence. Cette gouvernance Claude est **propre à enexflow**.

## Stack

- **TypeScript**, **npm workspaces** (pas pnpm) : `00_Base`, `01_Data`, `02_Util`, `03_Modules/*` (Certificates, Configuration, EVDriver, Monitoring, OcppRouter, Reporting, SmartCharging, Tenant, Transactions), `Server`.
- **OCPP 2.0.1** (CSMS). Migrations + `sync-db`. Renovate gère les deps.

## Règles

- **Discipline de fork** : préfère des changements rebasables sur l'upstream ; isole les specifics enexflow ; évite les refactos massives qui compliquent le sync.
- **Gate avant PR** : `npm run lint` + `npm run test` (+ `npm run prettier`). Build : `npm run build`. (`npm run install-all` / `fresh` pour bootstrap.)
- **Branches/PR** : partir de `env/dev` à jour, PR vers `env/dev`, conventional commits **ASCII**, ne pas merger soi-même.
- Testable via le multiplexeur OCPP + le simulateur `mont_blanc` (profil docker `citrine`, côté sizopt).

## Divergences du fork

- **LocationAuthorizer (TECH-2463)** : `02_Util/src/authorizer/LocationAuthorizer.ts`, branché dans `Server/src/citrineOSServer.ts` sur EVDriver et Transactions (1.6 Authorize, 1.6 StartTransaction, 2.0.1 Authorize, 2.0.1 TransactionEvent). Refuse un badge local (`tenantPartnerId` null, `ocpiAuthMethod` hors COMMAND/AUTH_REQUEST, type ISO14443 ou MacAddress) sans location ou dont les locations n'incluent pas celle de la station. Upstream, un token sans location est accepté partout et la 1.6 ne vérifie rien.
  - Flag `locationAuthorizationMode` (`off` / `log-only` / `enforce`, défaut `log-only`), surchargeable par `CITRINEOS_LOCATIONAUTHORIZATIONMODE`.
  - Ne jamais appeler `authorization.save()` dans un authorizer local : le trigger AuthorizationNotify pousserait des PATCH Tokens aux partenaires OCPI.
  - Mapper 1.6 (`01_Data/.../mapper/1.6/AuthorizationMapper.ts`) : `NotAtThisLocation` -> `Invalid` (upstream lève une exception).

## Cross-repo

Souvent travaillé depuis **sizopt** via `--add-dir` (voir sizopt `docs/ai/CROSS_REPO.md`). Le support OCPI vit dans le repo voisin `citrineos-ocpi`.
