# Project Agent Guide

This repository uses `AGENTS.md` as the shared source of truth for project-level instructions across coding agents. Tool-specific files such as `.cursorrules` should stay thin and defer to this file when possible.

## Tech Stack

- Frontend: React 18, Vite 5, JavaScript with ESM/JSX
- Backend: Python 3, FastAPI, Uvicorn
- Database/Auth: Supabase Postgres, Supabase Auth, Edge Functions with Deno
- Infra: Vercel for frontend, Render for backend, GitHub Actions for automation

## Project Structure

- `01_frontend/`: React 18 + Vite 5 app deployed on Vercel
- `02_backend/`: FastAPI + Uvicorn service deployed on Render
- `00_OHLCV/`: Python scripts for Binance OHLCV collection and processing
- `supabase/functions/`: Supabase Edge Functions using Deno and `supabase-js`

## Frontend Rules

Applies to `01_frontend/`.

- Use functional components and hooks only.
- Use `fetch` for API calls.
- Read the backend base URL from `VITE_API_URL`.
- Keep API access logic in `src/lib/api.js`.
- Use `lightweight-charts` for chart rendering.
- Use ESM imports only. Do not use CommonJS `require()`.
- Frontend environment variables must use the `VITE_` prefix.

## Backend Rules

Applies to `02_backend/`.

- Use FastAPI with type hints on all endpoints.
- Use Pydantic models for all request and response schemas.
- Use the Supabase Python client for database operations. Do not write raw SQL strings unless the user explicitly asks for it.
- Load environment variables with `python-dotenv`.
- Keep CORS aligned with the deployed Vercel frontend origin.
- Organize routers by domain, such as `routes/ohlcv.py`.
- Return structured JSON responses consistently.

## Supabase Rules

- Use Supabase client libraries instead of direct PostgreSQL connections.
- Enable RLS on every table.
- Use Supabase Auth for authentication.
- In Edge Functions, use the Deno runtime and import from `supabase-js`.

## OHLCV Script Rules

Applies to `00_OHLCV/`.

- Use pandas for data processing.
- Fetch market data through the Binance REST API.
- Store and process timestamps in UTC only.
- Keep scripts runnable both standalone and through GitHub Actions.

## GitHub Actions Rules

- Put workflows in `.github/workflows/`.
- Scheduled Python automation should remain compatible with `daily_run.yml`.
- Never hardcode secrets. Use repository or environment secrets.

## General Coding Rules

- Never hardcode API keys, URLs, or secrets.
- Prefer descriptive variable names such as `is_loading`, `has_error`, and `is_active`.
- Keep functions focused and reasonably small.
- Handle errors explicitly with `try/catch` or `try/except`.
- Add comments only for non-obvious logic.

## Error Handling Rules

- When an error appears, identify the root cause first and then fix it.
- After a fix, verify the failure path as well as the happy path.
- If the same error repeats more than twice, stop patching symptoms and address the underlying cause.
- For import errors, check module paths and package boundaries before changing code broadly.
- For FastAPI `422` errors, inspect the relevant Pydantic schema and request shape first.
- For CORS issues, verify backend CORS configuration before changing frontend calls.

## Working Agreement

- Prefer shared project rules here over duplicating agent-specific instructions in multiple files.
- Keep tool-specific files lightweight and focused on compatibility with that tool.
