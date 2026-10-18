# imports/

Real exports (bank statements, Money Manager backups, CSV/JSON dumps) never belong in this repo; `.gitignore` excludes everything here except this README and the synthetic sample.

`sample-operations.csv` shows the column layout the app's own export produces (`/export` in the legacy bot, or the Account screen). All values are made up.

| column | meaning |
|---|---|
| date | ISO 8601 timestamp (UTC) |
| kind | `expense` or `income` |
| amount | positive number, in `currency` |
| currency | `CNY`, `KZT` or `USD` |
| amount_cny | amount converted to the ledger base currency (nullable) |
| note | free text |
| category / account | names, not ids |
