# KGK Cloud Storage deployment guide

This repository contains separate frontend and backend packages. Configure them as independent services; do not commit `.env` files or real credentials.

## Render backend

- Root directory: `backend`
- Build command: `npm ci`
- Start command: `npm start`
- Node.js: 20 or newer

Set these Render environment variable names:

- `NODE_ENV` (`production`)
- `PORT` (provided by Render)
- `MONGODB_URI`
- `JWT_SECRET` (at least 32 bytes; generate a strong random value outside the repository)
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `FRONTEND_URL` (one or more exact frontend origins, comma-separated)
- `PUBLIC_API_BASE_URL` (the absolute HTTPS backend URL ending exactly in `/api`)
- `MAX_UPLOAD_SIZE_BYTES` (optional; defaults to 50 MiB)

Use Render-managed secret values for credentials. AWS local profiles are not used in production. Restrict the AWS principal to the required private bucket and object prefix; the application needs `s3:PutObject`, `s3:GetObject` (including HEAD verification), and `s3:DeleteObject` for cleanup. Do not grant public access or bucket-wide listing unless separately required.

## Vercel frontend

- Root directory: `frontend`
- Framework/build command: Vite / `npm run build`
- Output directory: `dist`

Set these Vercel environment variable names:

- `VITE_API_BASE_URL` (the Render backend absolute HTTPS URL ending in `/api`)
- `VITE_MAX_UPLOAD_SIZE_BYTES` (optional user-experience limit; should match `MAX_UPLOAD_SIZE_BYTES`)

No `vercel.json` is required for the current frontend because it does not use URL-based client-side routes.

## AWS S3 browser CORS

The private bucket must allow browser PUT requests from each deployed frontend origin. Allow method `PUT` and request headers `Content-Type` and `Cache-Control`. The PUT is presigned with the declared content length; the browser supplies the corresponding request length. Keep public access blocked. The application uses short-lived presigned URLs; do not configure permanent public object URLs.

## Local development

Copy the placeholder-only `backend/.env.example` and `frontend/.env.example` to local `.env` files and replace only local values. Never commit those copied files. Local in-memory database and local S3 URL fallbacks are development-only.

## Before the first GitHub push

1. Review `git status` and stage only source, manifests/lockfiles, documentation, tests, and placeholder `.env.example` files.
2. Verify `.env`, `.env.*` other than `.env.example`, `node_modules`, and generated `dist` output are ignored.
3. Run `npm ci` and `npm test` from `backend`, `npm ci` and `npm run build` from `frontend`, and `git diff --check`.
4. Review the staged diff for secrets, local machine files, credentials, and generated artifacts. Do not push until every actual secret is stored only in the hosting provider.
