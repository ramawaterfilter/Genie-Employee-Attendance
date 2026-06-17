# Genie: Employee Attendance — RAMA Group

A browser-based tool that turns a raw biometric punch report into a payroll-ready
`.xlsx` workbook in the company's standard format. It runs entirely client-side
(no server, no data leaves the machine), built with **React + Vite** and
**ExcelJS**.

The payroll output template and the FY2026 holiday calendar are **built in**, so
each month you upload only two files: the biometric report and the list of 5-day
working employees.

---

## Prerequisites

- **Node.js 18+** and npm (https://nodejs.org)

## Quick start

```bash
npm install        # install dependencies
npm run dev        # start the dev server (prints a localhost URL)
```

Open the URL it prints (usually http://localhost:5173). To create a static
production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

The contents of `dist/` are static files and can be hosted anywhere (GitHub
Pages, Netlify, an internal server, or opened via any static file server).

## How to use the app

1. Upload the **biometric report** (Daily Attendance Detail Report) and the
   **5-day working employee list**. The payroll month auto-detects from the
   biometric report header.
2. Check **Opening leave balances**. They pre-fill automatically from the previous
   month's saved closing (kept in the browser); the first run uses the embedded
   January 2026 baseline. You can:
   - **upload an EL / CL / CO file** (columns: Employee ID, Name, Opening EL,
     Opening CL, Opening CO) to set/correct balances — matched by ID then name; or
   - **edit any cell** directly. CL is disabled for 5-day staff (not applicable).
3. Click **Run processing**, review the mapping table and the preview tabs
   (Daily Register, Employee Summary, Missing Punch, Comp-Off Review, Audit Log).
   The closing balances are saved automatically and become next month's opening.
4. Click **Export** to download `Attendance_Final_<Month>_<Year>.xlsx`.

Comp-off (CO) is carried forward but only ever *flagged*, never auto-applied.
After export, apply any ML / OD or confirmed comp-off manually.

## Rules baked in

- Cycle: 25th of the previous month -> 24th of the payroll month.
- Sundays = `WO` for everyone; Saturdays = `WO` only for 5-day staff.
- Hours: >= 9h -> Present; 8.5-9h -> Present (flagged for review); < 8.5h -> half day.
- Holidays applied per work schedule from the built-in 2026 list.
- **Leave utilisation (consume available balance before LOP):**
  - **6-day staff:** CL -> EL -> LOP. A full day draws 1 from CL if available,
    else 1 from EL; a half day draws 0.5 from the same priority.
  - **5-day staff:** EL -> LOP (CL not applicable; their CL carries unchanged with
    no accrual).
  - A full day draws from a **single** category and only splits into LOP when no
    single category can cover it (e.g. 0.5 CL + 0.5 LOP = `CL/L`); CL and EL are
    never mixed on the same full day.
  - Consumption is **chronological** within the cycle, and carried-over balance is
    consumed before the month's accrual.
  - **Auto-accrual retained:** +1 EL for everyone, +1 CL for 6-day staff, each month.
  - Closing balance = opening + accrual − availed, and reconciles with the
    recalculated Sheet1 formulas.

## Project structure

```
genie-employee-attendance/
  index.html              Vite entry
  package.json
  vite.config.js
  src/
    main.jsx              React bootstrap
    App.jsx               UI layer (upload, settings, dashboard, preview, export)
    styles.css
    data/
      template.js         built-in payroll template (.xlsx, base64)
      holidays.js         built-in FY2026 holiday list + coverage end date
      logo.js             RAMA logo (PNG data URI)
    lib/                  pure logic (framework-free, unit-testable)
      codeDictionary.js   attendance-code dictionary
      excelHelpers.js     date/time/serial normalisation helpers
      payrollCycle.js     cycle + report-period parsing
      fiveDayParser.js    5-day list parsing + schedule classification
      holidayParser.js    holiday map construction
      templateParser.js   output-template parsing
      biometricParser.js  biometric block parsing (merged-cell aware)
      matcher.js          employee matching (ID-then-name scoring)
      attendanceEngine.js per-day status, LOP/leave, consumption helpers
      runEngine.js        orchestration (chronological CL/EL consumption)
      exportEngine.js     writes the final workbook (re-dates headers, fixes formulas)
      balanceFileParser.js  parses the optional EL/CL/CO opening-balance upload
      balanceStore.js       browser-side month-wise carry-forward of closing balances
```

## Maintenance notes

- **Holiday list (FY2026 completion):** the built-in calendar covers Jan–Dec 2026,
  which is correct for every payroll cycle ending through December 2026. Add the
  Jan/Feb/Mar 2027 holidays to `src/data/holidays.js` (both `6-Day` and `5-Day`
  sections) when published; cycles running past the coverage date raise a warning
  in the Audit Log.
- **Roster / opening balances:** the employee roster and the January opening
  balances are embedded in `src/data/template.js`. Each month the app carries the
  previous month's closing forward automatically (stored in the browser); override
  via the EL/CL/CO upload or by editing the table. To change the roster permanently,
  replace the embedded template. Carried-forward balances live in browser local
  storage, so they are per-machine/per-browser — use the upload to move them or to
  re-baseline on a new device.

© Copyrights owned by RAMA Group of Companies 2026.
