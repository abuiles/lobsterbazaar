# Private Deploys

Use this directory for real deploy packages that should stay in the repo workspace but not be committed to git.

Rules:

- Keep `deploys/example` as the only committed example deploy.
- Put real deploy packages under `deploys/private/<deploy-id>/`.
- Do not store operator secrets in deploy packages.
- Treat these files as private operator data even if they only contain merchant metadata.

Typical contents:

- `config.json`
- `merchants.csv`
- `offers.json`

Example:

```text
deploys/private/lobsterbrew/
```
