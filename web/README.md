# QueryAssist Web

This folder now contains the Angular frontend for the Text-to-SQL project.

## Development

Install dependencies:

```bash
npm install
```

Start the Angular dev server:

```bash
npm start
```

The app runs on `http://localhost:4200` by default and expects the backend query engine on `http://localhost:3001`.

## Structure

- `src/app/quotes` contains the main QueryAssist screen.
- `src/app/Components` contains reusable UI components.
- `src/app/Services` contains API calls to the query engine.
- `src/app/Models` contains frontend request and response types.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```
