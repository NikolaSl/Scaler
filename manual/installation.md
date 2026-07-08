# Installation

Development usage:

```bash
npm install
npm test
npm run build
pi -e ./extensions/scaler/index.ts
```

Inside Pi, run:

```text
/scaler-status
```

The package manifest also points at `./extensions/scaler/index.ts`, so `pi install .` loads the same wrapper and Pi displays the extension as `scaler`.
